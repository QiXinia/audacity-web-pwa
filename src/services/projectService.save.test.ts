import { afterEach, describe, expect, it, vi } from 'vitest';
import Dexie from 'dexie';
import { audioDb, type ProjectRecord } from '@/db/audioDb';
import { projectService } from '@/services/projectService';
import type { IProject } from '@/types/project';

vi.mock('@/db/audioDb', () => ({
  audioDb: {
    projects: { get: vi.fn(), put: vi.fn() },
    audioBuffers: {},
    clipboard: {},
    historySnapshots: {},
  },
  serializeTracks: (tracks: unknown) => JSON.stringify(tracks),
  deserializeTracks: (data: string) => JSON.parse(data),
  serializeSelection: (selection: unknown) => selection ? JSON.stringify(selection) : null,
  deserializeSelection: (data: string | null) => data ? JSON.parse(data) : null,
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
});
