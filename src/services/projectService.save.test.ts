import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Dexie from 'dexie';
import {
  audioDb,
  type AudioBufferRecord,
  type HistorySnapshotRecord,
  type ProjectRecord,
} from '@/db/audioDb';
import { audioEngine } from '@/engine/audioEngine';
import { projectService } from '@/services/projectService';
import type { IProject } from '@/types/project';

vi.mock('@/db/audioDb', () => ({
  audioDb: {
    projects: { get: vi.fn(), put: vi.fn(), delete: vi.fn(), filter: vi.fn() },
    audioBuffers: { where: vi.fn(), delete: vi.fn() },
    clipboard: {},
    historySnapshots: { where: vi.fn() },
    transaction: vi.fn(),
  },
  serializeTracks: (tracks: unknown) => JSON.stringify(tracks),
  deserializeTracks: (data: string) => JSON.parse(data),
  serializeSelection: (selection: unknown) => selection ? JSON.stringify(selection) : null,
  deserializeSelection: (data: string | null) => data ? JSON.parse(data) : null,
}));

vi.mock('@/engine/audioEngine', () => ({
  audioEngine: { evictBuffer: vi.fn() },
}));

const mutableService = projectService as unknown as {
  currentProject: IProject | null;
  currentProjectId: string | null;
  saveQueue: Promise<void>;
};

function makeProject(name: string): IProject {
  return {
    id: 'save-race-project',
    name,
    sampleRate: 44100,
    timeSignature: { numerator: 4, denominator: 4 },
    tempo: 120,
    tracks: [],
    cursorPosition: 0,
    selection: null,
    viewState: {
      horizontalZoom: 100,
      verticalZoom: 1,
      scrollX: 0,
      viewMode: 'waveform',
    },
    updatedAt: 100,
    createdAt: 50,
  };
}

function makeRecord(name: string, status: ProjectRecord['status'] = 'active'): ProjectRecord {
  return {
    id: 'save-race-project',
    name,
    sampleRate: 44100,
    duration: 0,
    trackCount: 0,
    status,
    updatedAt: 100,
    createdAt: 50,
    deletedAt: status === 'deleted' ? 90 : undefined,
    tracksData: '[]',
    viewStateData: '{}',
    tempo: 120,
    timeSignature: { numerator: 4, denominator: 4 },
    cursorPosition: 0,
    selectionData: null,
  };
}

function mockDelayedFirstPut(initial: ProjectRecord) {
  const state: { persisted: ProjectRecord | undefined; secondWrite?: ProjectRecord } = {
    persisted: initial,
  };
  let writeCount = 0;
  vi.mocked(audioDb.projects.get).mockImplementation(() => (
    Dexie.Promise.resolve(state.persisted ? { ...state.persisted } : undefined)
  ));
  vi.mocked(audioDb.projects.put).mockImplementation((record) => {
    writeCount += 1;
    const delay = writeCount === 1 ? 25 : 0;
    if (writeCount === 2) state.secondWrite = record;
    return new Dexie.Promise<string>((resolve) => {
      setTimeout(() => {
        state.persisted = record;
        resolve(record.id);
      }, delay);
    });
  });
  return state;
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Dexie.Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function makeBuffer(id: string, projectId: string): AudioBufferRecord {
  return {
    id,
    projectId,
    sampleRate: 44100,
    channels: 1,
    length: 0,
    duration: 0,
    channelData: [],
    createdAt: 1,
  };
}

function makeHistory(
  id: number,
  projectId: string,
  stackType: HistorySnapshotRecord['stackType'] = 'undo',
): HistorySnapshotRecord {
  return {
    id,
    projectId,
    stackType,
    index: id,
    label: `history-${id}`,
    snapshotData: '{}',
    timestamp: id,
  };
}

function mockPermanentDeleteState(
  initialRecords: ProjectRecord[],
  initialBuffers: AudioBufferRecord[],
  initialSnapshots: HistorySnapshotRecord[] = [],
) {
  const records = new Map(initialRecords.map((record) => [record.id, { ...record }]));
  const buffers = new Map(initialBuffers.map((buffer) => [buffer.id, buffer]));
  const snapshots = new Map(initialSnapshots.map((snapshot) => [snapshot.id, { ...snapshot }]));
  let writeCount = 0;

  vi.mocked(audioDb.projects.get).mockImplementation((id) => {
    const record = records.get(id as unknown as string);
    return Dexie.Promise.resolve(record ? { ...record } : undefined);
  });
  vi.mocked(audioDb.projects.put).mockImplementation((record) => {
    writeCount += 1;
    const delay = writeCount === 1 ? 25 : 0;
    return new Dexie.Promise<string>((resolve) => {
      setTimeout(() => {
        records.set(record.id, record);
        resolve(record.id);
      }, delay);
    });
  });
  vi.mocked(audioDb.projects.delete).mockImplementation((id) => {
    records.delete(id);
    return Dexie.Promise.resolve();
  });
  vi.mocked(audioDb.projects.filter).mockImplementation((predicate) => ({
    toArray: () => Dexie.Promise.resolve(
      [...records.values()].filter(predicate).map((record) => ({ ...record })),
    ),
  } as never));
  vi.mocked(audioDb.audioBuffers.where).mockImplementation(() => ({
    equals: (projectId: string) => ({
      toArray: () => Dexie.Promise.resolve(
        [...buffers.values()].filter((buffer) => buffer.projectId === projectId),
      ),
    }),
  } as never));
  vi.mocked(audioDb.audioBuffers.delete).mockImplementation((id) => {
    buffers.delete(id);
    return Dexie.Promise.resolve();
  });
  vi.mocked(audioDb.historySnapshots.where).mockImplementation(() => ({
    equals: (projectId: string) => ({
      delete: () => {
        let deleted = 0;
        for (const [id, snapshot] of snapshots) {
          if (snapshot.projectId === projectId) {
            snapshots.delete(id);
            deleted += 1;
          }
        }
        return Dexie.Promise.resolve(deleted);
      },
    }),
  } as never));
  vi.mocked(audioDb.transaction).mockImplementation((async (...args: unknown[]) => {
    const operation = args[args.length - 1];
    if (typeof operation !== 'function') {
      throw new TypeError('Missing transaction callback');
    }
    const recordSnapshot = new Map(records);
    const bufferSnapshot = new Map(buffers);
    const historySnapshot = new Map(snapshots);
    try {
      return await (operation as () => Promise<unknown>)();
    } catch (error) {
      records.clear();
      for (const [id, record] of recordSnapshot) records.set(id, record);
      buffers.clear();
      for (const [id, buffer] of bufferSnapshot) buffers.set(id, buffer);
      snapshots.clear();
      for (const [id, snapshot] of historySnapshot) snapshots.set(id, snapshot);
      throw error;
    }
  }) as never);

  return { records, buffers, snapshots };
}

beforeEach(() => {
  // saveProject updates an existing record; createProject owns new records.
  vi.mocked(audioDb.projects.get).mockImplementation(() => (
    Dexie.Promise.resolve(makeRecord('existing'))
  ));
  vi.mocked(audioDb.transaction).mockImplementation((async (...args: unknown[]) => {
    const operation = args[args.length - 1];
    if (typeof operation !== 'function') throw new TypeError('Missing transaction callback');
    return (operation as () => Promise<unknown>)();
  }) as never);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.useRealTimers();
  mutableService.currentProject = null;
  mutableService.currentProjectId = null;
  mutableService.saveQueue = Promise.resolve();
});

describe('ProjectService ordered project saves', () => {
  it('keeps the latest snapshot when an older write would otherwise finish last', async () => {
    const writes: ProjectRecord[] = [];
    let persisted: ProjectRecord | undefined;
    vi.mocked(audioDb.projects.put).mockImplementation((record) => {
      writes.push(record);
      return new Dexie.Promise<string>((resolve) => {
        setTimeout(() => {
          persisted = record;
          resolve(record.id);
        }, record.name === 'before' ? 25 : 0);
      });
    });

    const before = makeProject('before');
    const after = makeProject('after');
    const firstSave = projectService.saveProject(before);
    const secondSave = projectService.saveProject(after);
    await Promise.all([firstSave, secondSave]);

    expect(writes.map(({ name }) => name)).toEqual(['before', 'after']);
    expect(persisted?.name).toBe('after');
    expect(mutableService.currentProject).toBe(after);
  });

  it('continues with a later save after an earlier database write fails', async () => {
    let persisted: ProjectRecord | undefined;
    vi.mocked(audioDb.projects.put).mockImplementation((record) => {
      if (record.name === 'fails') return Dexie.Promise.reject(new Error('first write failed'));
      persisted = record;
      return Dexie.Promise.resolve(record.id);
    });

    const failedSave = projectService.saveProject(makeProject('fails'));
    const laterProject = makeProject('later');
    const laterSave = projectService.saveProject(laterProject);
    const results = await Promise.allSettled([failedSave, laterSave]);

    expect(results[0]).toMatchObject({ status: 'rejected' });
    expect(results[1]).toMatchObject({ status: 'fulfilled' });
    expect(persisted?.name).toBe('later');
    expect(mutableService.currentProject).toBe(laterProject);
  });

  it('captures each record at invocation time before a queued write starts', async () => {
    const writes: ProjectRecord[] = [];
    vi.mocked(audioDb.projects.put).mockImplementation((record) => {
      writes.push(record);
      return Dexie.Promise.resolve(record.id);
    });

    const project = makeProject('before');
    const firstSave = projectService.saveProject(project);
    project.name = 'after';
    const secondSave = projectService.saveProject(project);
    await Promise.all([firstSave, secondSave]);

    expect(writes.map(({ name }) => name)).toEqual(['before', 'after']);
    expect(mutableService.currentProject).toBe(project);
    expect(mutableService.currentProject.name).toBe('after');
  });

  it('keeps a later rename when an older save finishes last', async () => {
    const state = mockDelayedFirstPut(makeRecord('initial'));
    const save = projectService.saveProject(makeProject('before'));
    await Promise.resolve();
    const rename = projectService.renameProject('save-race-project', 'renamed');
    await Promise.all([save, rename]);

    expect(state.persisted?.name).toBe('renamed');
    expect(mutableService.currentProject?.name).toBe('renamed');
  });

  it('keeps a later soft deletion when an older save finishes last', async () => {
    const state = mockDelayedFirstPut(makeRecord('before'));
    const save = projectService.saveProject(makeProject('before'));
    await Promise.resolve();
    const deletion = projectService.deleteProject('save-race-project');
    await Promise.all([save, deletion]);

    expect(state.persisted?.status).toBe('deleted');
    expect(state.persisted?.deletedAt).toEqual(expect.any(Number));
  });

  it('keeps later restore metadata when an older save finishes last', async () => {
    vi.spyOn(Date, 'now').mockReturnValueOnce(1000).mockReturnValueOnce(2000);
    const state = mockDelayedFirstPut(makeRecord('before', 'deleted'));
    const save = projectService.saveProject(makeProject('before'));
    await Promise.resolve();
    const restoration = projectService.restoreProject('save-race-project');
    await Promise.all([save, restoration]);

    expect(state.secondWrite?.updatedAt).toEqual(expect.any(Number));
    expect(state.persisted?.status).toBe('active');
    expect(state.persisted?.deletedAt).toBeUndefined();
    expect(state.persisted?.updatedAt).toBe(state.secondWrite?.updatedAt);
  });

  it('does not resurrect a permanently deleted project when an older save finishes last', async () => {
    const state = mockPermanentDeleteState(
      [makeRecord('before', 'deleted')],
      [makeBuffer('buffer-to-delete', 'save-race-project')],
    );
    const save = projectService.saveProject(makeProject('before'));
    await Promise.resolve();
    const deletion = projectService.permanentlyDeleteProject('save-race-project');
    await Promise.all([save, deletion]);

    expect(state.records.has('save-race-project')).toBe(false);
    expect(state.buffers.size).toBe(0);
    expect(mutableService.currentProject).toBeNull();
    expect(audioEngine.evictBuffer).toHaveBeenCalledWith('buffer-to-delete');
  });

  it('does not let a pending new-project write recreate a permanently deleted project', async () => {
    const state = mockPermanentDeleteState([], []);
    const putReached = deferred();
    const releasePut = deferred();
    let pendingRecord: ProjectRecord | undefined;
    vi.mocked(audioDb.projects.put).mockImplementation((record) => {
      pendingRecord = record;
      putReached.resolve();
      return releasePut.promise.then(() => {
        state.records.set(record.id, { ...record });
        return record.id;
      });
    });

    const creating = projectService.createProject('pending-create');
    await putReached.promise;
    const id = pendingRecord!.id;
    const deleting = projectService.permanentlyDeleteProject(id);
    // Let the unqueued legacy deletion run before the stalled creation write.
    await Promise.resolve();
    releasePut.resolve();
    const [created] = await Promise.all([creating, deleting]);

    expect(created.id).toBe(id);
    expect(state.records.has(id)).toBe(false);
    expect(mutableService.currentProject).toBeNull();
    expect(mutableService.currentProjectId).toBeNull();
  });

  it('does not resurrect projects while clearing the trash behind an older save', async () => {
    const state = mockPermanentDeleteState(
      [
        makeRecord('before', 'deleted'),
        { ...makeRecord('other', 'deleted'), id: 'other-project' },
        { ...makeRecord('active'), id: 'active-project' },
      ],
      [
        makeBuffer('buffer-to-delete', 'save-race-project'),
        makeBuffer('other-buffer', 'other-project'),
        makeBuffer('active-buffer', 'active-project'),
      ],
    );
    const save = projectService.saveProject(makeProject('before'));
    await Promise.resolve();
    const clearing = projectService.clearDeletedProjects();
    await Promise.all([save, clearing]);

    expect([...state.records.keys()]).toEqual(['active-project']);
    expect([...state.buffers.keys()]).toEqual(['active-buffer']);
    expect(mutableService.currentProject).toBeNull();
    expect(audioEngine.evictBuffer).toHaveBeenCalledTimes(2);
  });

  it('continues with a later save after permanent deletion fails', async () => {
    const state = mockPermanentDeleteState(
      [makeRecord('before', 'deleted')],
      [],
    );
    vi.mocked(audioDb.projects.delete).mockImplementation(() => (
      Dexie.Promise.reject(new Error('delete failed'))
    ));

    const deletion = projectService.permanentlyDeleteProject('save-race-project');
    const laterSave = projectService.saveProject(makeProject('after-failed-delete'));
    const results = await Promise.allSettled([deletion, laterSave]);

    expect(results[0]).toMatchObject({ status: 'rejected' });
    expect(results[1]).toMatchObject({ status: 'fulfilled' });
    expect(state.records.get('save-race-project')?.name).toBe('after-failed-delete');
  });

  it('rolls back a permanent deletion when an audio buffer delete fails', async () => {
    const originalRecord = makeRecord('before', 'deleted');
    const state = mockPermanentDeleteState(
      [originalRecord],
      [
        makeBuffer('buffer-a', 'save-race-project'),
        makeBuffer('buffer-b', 'save-race-project'),
      ],
    );
    mutableService.currentProject = makeProject('before');
    mutableService.currentProjectId = 'save-race-project';
    vi.mocked(audioDb.audioBuffers.delete).mockImplementation((id) => {
      if (id === 'buffer-b') {
        return Dexie.Promise.reject(new Error('buffer delete failed'));
      }
      state.buffers.delete(id);
      return Dexie.Promise.resolve();
    });

    await expect(projectService.permanentlyDeleteProject('save-race-project'))
      .rejects.toThrow('buffer delete failed');

    expect(state.records.get('save-race-project')).toEqual(originalRecord);
    expect([...state.buffers.keys()]).toEqual(['buffer-a', 'buffer-b']);
    expect(audioEngine.evictBuffer).not.toHaveBeenCalled();
    expect(mutableService.currentProject?.id).toBe('save-race-project');
    expect(mutableService.currentProjectId).toBe('save-race-project');
    expect(audioDb.transaction).toHaveBeenCalledWith(
      'rw',
      audioDb.projects,
      audioDb.audioBuffers,
      audioDb.historySnapshots,
      expect.any(Function),
    );
  });

  it('cleans up only committed projects when clearing trash partially fails', async () => {
    const state = mockPermanentDeleteState(
      [
        makeRecord('first', 'deleted'),
        { ...makeRecord('second', 'deleted'), id: 'other-project' },
        { ...makeRecord('third', 'deleted'), id: 'third-project' },
      ],
      [
        makeBuffer('buffer-a', 'save-race-project'),
        makeBuffer('buffer-b1', 'other-project'),
        makeBuffer('buffer-b2', 'other-project'),
        makeBuffer('buffer-c', 'third-project'),
      ],
    );
    mutableService.currentProject = makeProject('first');
    mutableService.currentProjectId = 'save-race-project';
    vi.mocked(audioDb.audioBuffers.delete).mockImplementation((id) => {
      if (id === 'buffer-b2') {
        return Dexie.Promise.reject(new Error('second project failed'));
      }
      state.buffers.delete(id);
      return Dexie.Promise.resolve();
    });

    await expect(projectService.clearDeletedProjects()).rejects.toThrow('second project failed');

    expect(state.records.has('save-race-project')).toBe(false);
    expect(state.records.has('other-project')).toBe(true);
    expect(state.records.has('third-project')).toBe(true);
    expect([...state.buffers.keys()]).toEqual(['buffer-b1', 'buffer-b2', 'buffer-c']);
    expect(audioEngine.evictBuffer).toHaveBeenCalledTimes(1);
    expect(audioEngine.evictBuffer).toHaveBeenCalledWith('buffer-a');
    expect(mutableService.currentProject).toBeNull();
    expect(mutableService.currentProjectId).toBeNull();
  });

  it('continues with a later save after an audio buffer delete fails', async () => {
    const state = mockPermanentDeleteState(
      [makeRecord('before', 'deleted')],
      [makeBuffer('buffer-a', 'save-race-project')],
    );
    vi.mocked(audioDb.audioBuffers.delete).mockImplementation(() => (
      Dexie.Promise.reject(new Error('buffer delete failed'))
    ));
    const laterProject = makeProject('after-buffer-failure');

    const deletion = projectService.permanentlyDeleteProject('save-race-project');
    const laterSave = projectService.saveProject(laterProject);
    const results = await Promise.allSettled([deletion, laterSave]);

    expect(results[0]).toMatchObject({ status: 'rejected' });
    expect(results[1]).toMatchObject({ status: 'fulfilled' });
    expect(state.records.get('save-race-project')).toMatchObject({
      name: 'after-buffer-failure',
      status: 'deleted',
    });
    expect([...state.buffers.keys()]).toEqual(['buffer-a']);
    expect(audioEngine.evictBuffer).not.toHaveBeenCalled();
    expect(mutableService.currentProject).toBe(laterProject);
  });

  it('deletes only the permanent project history snapshots after commit', async () => {
    const state = mockPermanentDeleteState(
      [makeRecord('before', 'deleted')],
      [makeBuffer('buffer-a', 'save-race-project')],
      [
        makeHistory(1, 'save-race-project'),
        makeHistory(2, 'other-project'),
        makeHistory(3, 'save-race-project', 'redo'),
      ],
    );

    await projectService.permanentlyDeleteProject('save-race-project');

    expect(state.records.has('save-race-project')).toBe(false);
    expect(state.buffers.size).toBe(0);
    expect([...state.snapshots.keys()]).toEqual([2]);
    expect(audioDb.historySnapshots.where).toHaveBeenCalledWith('projectId');
    expect(audioDb.transaction).toHaveBeenCalledWith(
      'rw',
      audioDb.projects,
      audioDb.audioBuffers,
      audioDb.historySnapshots,
      expect.any(Function),
    );
    expect(audioEngine.evictBuffer).toHaveBeenCalledWith('buffer-a');
  });

  it('rolls back project, buffers and history when history deletion fails', async () => {
    const originalRecord = makeRecord('before', 'deleted');
    const originalHistory = [
      makeHistory(1, 'save-race-project'),
      makeHistory(2, 'save-race-project', 'redo'),
      makeHistory(3, 'other-project'),
    ];
    const state = mockPermanentDeleteState(
      [originalRecord],
      [makeBuffer('buffer-a', 'save-race-project')],
      originalHistory,
    );
    mutableService.currentProject = makeProject('before');
    mutableService.currentProjectId = 'save-race-project';
    vi.mocked(audioDb.historySnapshots.where).mockImplementation(() => ({
      equals: () => ({
        delete: () => Dexie.Promise.reject(new Error('history delete failed')),
      }),
    } as never));

    await expect(projectService.permanentlyDeleteProject('save-race-project'))
      .rejects.toThrow('history delete failed');

    expect(state.records.get('save-race-project')).toEqual(originalRecord);
    expect([...state.buffers.keys()]).toEqual(['buffer-a']);
    expect([...state.snapshots.values()]).toEqual(originalHistory);
    expect(audioEngine.evictBuffer).not.toHaveBeenCalled();
    expect(mutableService.currentProject?.id).toBe('save-race-project');
    expect(mutableService.currentProjectId).toBe('save-race-project');
    expect(audioDb.transaction).toHaveBeenCalledWith(
      'rw',
      audioDb.projects,
      audioDb.audioBuffers,
      audioDb.historySnapshots,
      expect.any(Function),
    );
  });

  it('clears deleted project histories without touching active project history', async () => {
    const state = mockPermanentDeleteState(
      [
        makeRecord('first', 'deleted'),
        { ...makeRecord('second', 'deleted'), id: 'other-project' },
        { ...makeRecord('active'), id: 'active-project' },
      ],
      [
        makeBuffer('buffer-a', 'save-race-project'),
        makeBuffer('buffer-b', 'other-project'),
        makeBuffer('buffer-c', 'active-project'),
      ],
      [
        makeHistory(1, 'save-race-project'),
        makeHistory(2, 'other-project'),
        makeHistory(3, 'active-project'),
        makeHistory(4, 'save-race-project', 'redo'),
        makeHistory(5, 'other-project', 'redo'),
        makeHistory(6, 'active-project', 'redo'),
      ],
    );

    await projectService.clearDeletedProjects();

    expect([...state.records.keys()]).toEqual(['active-project']);
    expect([...state.buffers.keys()]).toEqual(['buffer-c']);
    expect([...state.snapshots.keys()]).toEqual([3, 6]);
    expect(audioEngine.evictBuffer).toHaveBeenCalledTimes(2);
  });
});

describe('ProjectService project activation races', () => {
  function mockActivationRecords() {
    const records = new Map<string, ProjectRecord>([
      ['project-a', { ...makeRecord('project-a'), id: 'project-a' }],
      ['project-b', { ...makeRecord('project-b'), id: 'project-b' }],
    ]);
    vi.mocked(audioDb.projects.get).mockImplementation((id) => {
      const record = records.get(id as unknown as string);
      return Dexie.Promise.resolve(record ? { ...record } : undefined);
    });
    return records;
  }

  it('does not replace a newly opened project when an older save finishes', async () => {
    const records = mockActivationRecords();
    const putReached = deferred();
    const releasePut = deferred();
    vi.mocked(audioDb.projects.put).mockImplementation((record) => {
      if (record.id !== 'project-a') {
        records.set(record.id, { ...record });
        return Dexie.Promise.resolve(record.id);
      }
      putReached.resolve();
      return releasePut.promise.then(() => {
        records.set(record.id, { ...record });
        return record.id;
      });
    });

    const saving = projectService.saveProject({
      ...makeProject('edited-project-a'),
      id: 'project-a',
    });
    await putReached.promise;
    const opened = await projectService.openProject('project-b');
    releasePut.resolve();
    await saving;

    expect(opened?.id).toBe('project-b');
    expect(projectService.getCurrentProject()?.id).toBe('project-b');
    expect(projectService.getCurrentProjectId()).toBe('project-b');
  });

  it('does not replace a newly created project when an older save finishes', async () => {
    const records = mockActivationRecords();
    const putReached = deferred();
    const releasePut = deferred();
    vi.mocked(audioDb.projects.put).mockImplementation((record) => {
      if (record.id !== 'project-a') {
        records.set(record.id, { ...record });
        return Dexie.Promise.resolve(record.id);
      }
      putReached.resolve();
      return releasePut.promise.then(() => {
        records.set(record.id, { ...record });
        return record.id;
      });
    });

    const saving = projectService.saveProject({
      ...makeProject('edited-project-a'),
      id: 'project-a',
    });
    await putReached.promise;
    const creating = projectService.createProject('new-project');
    releasePut.resolve();
    await saving;
    const created = await creating;

    expect(projectService.getCurrentProject()).toBe(created);
    expect(projectService.getCurrentProjectId()).toBe(created.id);
  });

  it('keeps the latest open request active when an earlier read resolves last', async () => {
    const records = mockActivationRecords();
    const releaseFirstRead = deferred<ProjectRecord | undefined>();
    vi.mocked(audioDb.projects.get).mockImplementation((id) => {
      const recordId = id as unknown as string;
      if (recordId === 'project-a') return releaseFirstRead.promise;
      const record = records.get(recordId);
      return Dexie.Promise.resolve(record ? { ...record } : undefined);
    });

    const firstOpen = projectService.openProject('project-a');
    const latest = await projectService.openProject('project-b');
    releaseFirstRead.resolve(records.get('project-a'));
    const earlier = await firstOpen;

    expect(earlier?.id).toBe('project-a');
    expect(latest?.id).toBe('project-b');
    expect(projectService.getCurrentProject()?.id).toBe('project-b');
    expect(projectService.getCurrentProjectId()).toBe('project-b');
  });

  it('discards an open read that resolves after its project is permanently deleted', async () => {
    const originalA = { ...makeRecord('project-a'), id: 'project-a' };
    const originalB = { ...makeRecord('project-b'), id: 'project-b' };
    const state = mockPermanentDeleteState([originalA, originalB], []);
    const releaseFirstRead = deferred<ProjectRecord | undefined>();
    vi.mocked(audioDb.projects.get).mockImplementation((id) => {
      const recordId = id as unknown as string;
      if (recordId === 'project-a') return releaseFirstRead.promise;
      const record = state.records.get(recordId);
      return Dexie.Promise.resolve(record ? { ...record } : undefined);
    });

    const firstOpen = projectService.openProject('project-a');
    const latest = await projectService.openProject('project-b');
    await projectService.permanentlyDeleteProject('project-a');
    releaseFirstRead.resolve(originalA);

    await expect(firstOpen).resolves.toBeNull();
    expect(latest?.id).toBe('project-b');
    expect(projectService.getCurrentProject()?.id).toBe('project-b');
    expect(projectService.getCurrentProjectId()).toBe('project-b');
  });

  it('discards an open read that resolves after clearing the trash', async () => {
    const original = { ...makeRecord('project-a', 'deleted'), id: 'project-a' };
    const state = mockPermanentDeleteState([original], []);
    const releaseOpenRead = deferred<ProjectRecord | undefined>();
    vi.mocked(audioDb.projects.get).mockImplementation(() => releaseOpenRead.promise);

    const opening = projectService.openProject('project-a');
    await projectService.clearDeletedProjects();
    releaseOpenRead.resolve(original);

    await expect(opening).resolves.toBeNull();
    expect(state.records.size).toBe(0);
    expect(projectService.getCurrentProject()).toBeNull();
    expect(projectService.getCurrentProjectId()).toBeNull();
  });

  it('allows a pending open to finish when permanent deletion fails', async () => {
    const original = { ...makeRecord('project-a'), id: 'project-a' };
    mockPermanentDeleteState([original], []);
    const releaseOpenRead = deferred<ProjectRecord | undefined>();
    vi.mocked(audioDb.projects.get).mockImplementation(() => releaseOpenRead.promise);
    vi.mocked(audioDb.projects.delete).mockImplementation(() => (
      Dexie.Promise.reject(new Error('delete failed'))
    ));

    const opening = projectService.openProject('project-a');
    await expect(projectService.permanentlyDeleteProject('project-a'))
      .rejects.toThrow('delete failed');
    releaseOpenRead.resolve(original);

    await expect(opening).resolves.toMatchObject({ id: 'project-a' });
    expect(projectService.getCurrentProject()?.id).toBe('project-a');
    expect(projectService.getCurrentProjectId()).toBe('project-a');
  });

  it('returns and activates the newer record used by final revalidation', async () => {
    const stale = {
      ...makeRecord('stale-snapshot'),
      id: 'project-a',
      updatedAt: 100,
    };
    const latest = {
      ...stale,
      name: 'latest-snapshot',
      updatedAt: 200,
    };
    vi.mocked(audioDb.projects.get)
      .mockImplementationOnce(() => Dexie.Promise.resolve({ ...stale }))
      .mockImplementationOnce(() => Dexie.Promise.resolve({ ...latest }));

    const opened = await projectService.openProject('project-a');

    expect(opened).toMatchObject({
      id: 'project-a',
      name: 'latest-snapshot',
      updatedAt: 200,
    });
    expect(projectService.getCurrentProject()).toBe(opened);
    expect(projectService.getCurrentProjectId()).toBe('project-a');
  });

  it('rejects a soft-deleted project instead of opening it from the recycle bin', async () => {
    const deleted = {
      ...makeRecord('trashed-project', 'deleted'),
      id: 'project-a',
    };
    vi.mocked(audioDb.projects.get).mockImplementation(() => (
      Dexie.Promise.resolve({ ...deleted })
    ));

    await expect(projectService.openProject('project-a')).resolves.toBeNull();
    expect(projectService.getCurrentProject()).toBeNull();
    expect(projectService.getCurrentProjectId()).toBeNull();
  });

  it('discards an open when soft deletion wins before final revalidation', async () => {
    const active = {
      ...makeRecord('active-before-open'),
      id: 'project-a',
      updatedAt: 100,
    };
    const deleted = {
      ...active,
      status: 'deleted' as const,
      deletedAt: 150,
      updatedAt: 200,
    };
    vi.mocked(audioDb.projects.get)
      .mockImplementationOnce(() => Dexie.Promise.resolve({ ...active }))
      .mockImplementationOnce(() => Dexie.Promise.resolve({ ...deleted }));

    await expect(projectService.openProject('project-a')).resolves.toBeNull();
    expect(projectService.getCurrentProject()).toBeNull();
    expect(projectService.getCurrentProjectId()).toBeNull();
  });
});
