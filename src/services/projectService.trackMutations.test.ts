import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { audioDb, type ProjectRecord } from '@/db/audioDb';
import { historyManager } from '@/services/historyService';
import { projectService } from '@/services/projectService';
import type { IProject, ITrack } from '@/types/project';

vi.mock('@/db/audioDb', () => ({
  audioDb: {
    projects: { get: vi.fn(), put: vi.fn() },
    audioBuffers: {},
    clipboard: {},
    historySnapshots: {},
    transaction: vi.fn(),
  },
  serializeTracks: (tracks: unknown) => JSON.stringify(tracks),
  deserializeTracks: (data: string) => JSON.parse(data),
  serializeSelection: (selection: unknown) => selection ? JSON.stringify(selection) : null,
  deserializeSelection: (data: string | null) => data ? JSON.parse(data) : null,
  serializeHistorySnapshot: (project: unknown) => JSON.stringify(project),
  deserializeHistorySnapshot: (data: string) => JSON.parse(data),
}));

vi.mock('@/engine/audioEngine', () => ({
  audioEngine: { cacheBuffer: vi.fn(), evictBuffer: vi.fn() },
}));

const mutableService = projectService as unknown as {
  currentProject: IProject | null;
  currentProjectId: string | null;
  saveQueue: Promise<void>;
  projectToRecord(project: IProject): ProjectRecord;
};

function makeTrack(id: string): ITrack {
  return {
    id,
    name: 'Original',
    type: 'audio',
    gain: 0,
    pan: 0,
    muted: false,
    solo: false,
    armed: false,
    color: '',
    clips: [],
    effects: [],
  };
}

function makeProject(): IProject {
  return {
    id: 'track-mutation-project',
    name: 'Track mutation',
    sampleRate: 48000,
    timeSignature: { numerator: 4, denominator: 4 },
    tempo: 120,
    tracks: [makeTrack('track-a')],
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

let records: Map<string, ProjectRecord>;

function installProject(): IProject {
  const project = makeProject();
  records.set(project.id, mutableService.projectToRecord(project));
  mutableService.currentProject = project;
  mutableService.currentProjectId = project.id;
  return project;
}

function persistedTracks(): ITrack[] {
  const record = records.get('track-mutation-project');
  return record ? JSON.parse(record.tracksData) as ITrack[] : [];
}

function delayFirstPut(): void {
  let writes = 0;
  vi.mocked(audioDb.projects.put).mockImplementation(((record: ProjectRecord) => {
    writes += 1;
    const delay = writes === 1 ? 20 : 0;
    return new Promise<string>((resolve) => {
      setTimeout(() => {
        records.set(record.id, { ...record });
        resolve(record.id);
      }, delay);
    });
  }) as never);
}

beforeEach(() => {
  records = new Map();
  vi.mocked(audioDb.projects.get).mockImplementation(((id: string) => {
    const record = records.get(id);
    return Promise.resolve(record ? { ...record } : undefined);
  }) as never);
  vi.mocked(audioDb.projects.put).mockImplementation(((record: ProjectRecord) => {
    records.set(record.id, { ...record });
    return Promise.resolve(record.id);
  }) as never);
  vi.mocked(audioDb.transaction).mockImplementation((async (...args: unknown[]) => {
    const operation = args[args.length - 1];
    if (typeof operation !== 'function') throw new TypeError('Missing transaction callback');
    const snapshot = new Map(records);
    try {
      return await (operation as () => Promise<unknown>)();
    } catch (error) {
      records.clear();
      for (const [id, record] of snapshot) records.set(id, record);
      throw error;
    }
  }) as never);
  historyManager.setPersistEnabled(false);
  historyManager.clear();
});

afterEach(() => {
  historyManager.clear();
  historyManager.setPersistEnabled(true);
  vi.clearAllMocks();
  mutableService.currentProject = null;
  mutableService.currentProjectId = null;
  mutableService.saveQueue = Promise.resolve();
});

describe('ProjectService atomic track mutations', () => {
  it('adds a track through an immutable project snapshot with an intact undo before', async () => {
    const before = installProject();

    const added = await projectService.addTrack(before.id);
    const after = mutableService.currentProject!;

    expect(added).not.toBeNull();
    expect(added?.sampleRate).toBe(48000);
    expect(before.tracks).toHaveLength(1);
    expect(before.updatedAt).toBe(100);
    expect(after).not.toBe(before);
    expect(after.tracks).toHaveLength(2);
    expect(after.tracks[0]).toBe(before.tracks[0]);
    expect(after.tracks[1]?.id).toBe(added?.id);
    expect(persistedTracks().map((track) => track.id)).toEqual(after.tracks.map((track) => track.id));

    historyManager.push({
      id: 'add-track',
      label: '添加轨道',
      execute: () => after,
      undo: () => before,
    }, before);
    const undone = historyManager.undo(after);
    expect(undone?.project).toBe(before);
    expect(undone?.project.tracks).toHaveLength(1);
  });

  it('leaves the project and undo before intact when adding a track fails to save', async () => {
    const before = installProject();
    const originalRecord = records.get(before.id)!;
    vi.mocked(audioDb.projects.put).mockRejectedValue(new Error('quota exceeded') as never);

    await expect(projectService.addTrack(before.id)).rejects.toThrow('quota exceeded');

    expect(records.get(before.id)).toEqual(originalRecord);
    expect(persistedTracks()).toHaveLength(1);
    expect(before.tracks).toHaveLength(1);
    expect(before.updatedAt).toBe(100);
    expect(mutableService.currentProject).toBe(before);
  });

  it('returns no new track and leaves the editor snapshot intact when permanent deletion wins', async () => {
    const before = installProject();
    records.clear();

    await expect(projectService.addTrack(before.id)).resolves.toBeNull();

    expect(audioDb.projects.put).not.toHaveBeenCalled();
    expect(before.tracks).toHaveLength(1);
    expect(before.updatedAt).toBe(100);
    expect(mutableService.currentProject).toBe(before);
    expect(records.has(before.id)).toBe(false);
  });

  it('serializes concurrent additions without losing a track or mutating the original snapshot', async () => {
    const before = installProject();
    delayFirstPut();

    const [first, second] = await Promise.all([
      projectService.addTrack(before.id),
      projectService.addTrack(before.id),
    ]);

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(first?.id).not.toBe(second?.id);
    expect(before.tracks).toHaveLength(1);
    expect(mutableService.currentProject?.tracks).toHaveLength(3);
    expect(mutableService.currentProject?.tracks.map((track) => track.id)).toEqual([
      'track-a', first?.id, second?.id,
    ]);
    expect(persistedTracks().map((track) => track.id)).toEqual([
      'track-a', first?.id, second?.id,
    ]);
  });

  it('updates a track through an immutable project snapshot and returns the committed project', async () => {
    const before = installProject();

    const updated = await projectService.updateTrack(before.id, 'track-a', { name: 'Renamed', gain: -6 });

    expect(updated).not.toBeNull();
    expect(mutableService.currentProject).toBe(updated);
    expect(updated).not.toBe(before);
    expect(updated?.tracks[0]).not.toBe(before.tracks[0]);
    expect(updated?.tracks[0]).toMatchObject({ name: 'Renamed', gain: -6 });
    expect(before.tracks[0]).toMatchObject({ name: 'Original', gain: 0 });
    expect(before.updatedAt).toBe(100);
    expect(persistedTracks()[0]).toMatchObject({ name: 'Renamed', gain: -6 });
  });

  it('leaves the project and undo before intact when a track update fails to save', async () => {
    const before = installProject();
    const originalRecord = records.get(before.id)!;
    vi.mocked(audioDb.projects.put).mockRejectedValue(new Error('storage unavailable') as never);

    await expect(projectService.updateTrack(before.id, 'track-a', { muted: true }))
      .rejects.toThrow('storage unavailable');

    expect(records.get(before.id)).toEqual(originalRecord);
    expect(persistedTracks()[0]?.muted).toBe(false);
    expect(before.tracks[0]?.muted).toBe(false);
    expect(before.updatedAt).toBe(100);
    expect(mutableService.currentProject).toBe(before);
  });

  it('returns no committed project and leaves the editor snapshot intact when permanent deletion wins an update', async () => {
    const before = installProject();
    records.clear();

    await expect(projectService.updateTrack(before.id, 'track-a', { pan: 0.75 })).resolves.toBeNull();

    expect(audioDb.projects.put).not.toHaveBeenCalled();
    expect(before.tracks[0]?.pan).toBe(0);
    expect(before.updatedAt).toBe(100);
    expect(mutableService.currentProject).toBe(before);
    expect(records.has(before.id)).toBe(false);
  });

  it('serializes concurrent property updates without discarding either committed change', async () => {
    const before = installProject();
    delayFirstPut();

    const [gainUpdate, panUpdate] = await Promise.all([
      projectService.updateTrack(before.id, 'track-a', { gain: -3 }),
      projectService.updateTrack(before.id, 'track-a', { pan: 0.5 }),
    ]);

    expect(gainUpdate).not.toBeNull();
    expect(panUpdate).not.toBeNull();
    expect(panUpdate?.tracks[0]).toMatchObject({ gain: -3, pan: 0.5 });
    expect(mutableService.currentProject).toBe(panUpdate);
    expect(persistedTracks()[0]).toMatchObject({ gain: -3, pan: 0.5 });
    expect(before.tracks[0]).toMatchObject({ gain: 0, pan: 0 });
  });

  it('does not save or change the current project for an unknown track update', async () => {
    const before = installProject();

    await expect(projectService.updateTrack(before.id, 'missing', { muted: true })).resolves.toBeNull();

    expect(audioDb.projects.put).not.toHaveBeenCalled();
    expect(mutableService.currentProject).toBe(before);
    expect(before.tracks[0]?.muted).toBe(false);
    expect(persistedTracks()[0]?.muted).toBe(false);
  });
});
