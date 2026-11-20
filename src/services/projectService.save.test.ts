import { afterEach, describe, expect, it, vi } from 'vitest';
import Dexie from 'dexie';
import { audioDb, type AudioBufferRecord, type ProjectRecord } from '@/db/audioDb';
import { audioEngine } from '@/engine/audioEngine';
import { projectService } from '@/services/projectService';
import type { IProject } from '@/types/project';

vi.mock('@/db/audioDb', () => ({
  audioDb: {
    projects: { get: vi.fn(), put: vi.fn(), delete: vi.fn(), filter: vi.fn() },
    audioBuffers: { where: vi.fn(), delete: vi.fn() },
    clipboard: {},
    historySnapshots: {},
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

function mockPermanentDeleteState(
  initialRecords: ProjectRecord[],
  initialBuffers: AudioBufferRecord[],
) {
  const records = new Map(initialRecords.map((record) => [record.id, { ...record }]));
  const buffers = new Map(initialBuffers.map((buffer) => [buffer.id, buffer]));
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

  return { records, buffers };
}

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.useRealTimers();
  mutableService.currentProject = null;
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
});
