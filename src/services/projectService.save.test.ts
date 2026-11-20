import { afterEach, describe, expect, it, vi } from 'vitest';
import Dexie from 'dexie';
import { audioDb, type ProjectRecord } from '@/db/audioDb';
import { projectService } from '@/services/projectService';
import type { IProject } from '@/types/project';

vi.mock('@/db/audioDb', () => ({
  audioDb: {
    projects: { put: vi.fn() },
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
});
