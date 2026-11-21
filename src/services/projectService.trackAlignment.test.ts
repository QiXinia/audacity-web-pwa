import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { audioDb, type ProjectRecord } from '@/db/audioDb';
import { audioEngine } from '@/engine/audioEngine';
import { projectService } from '@/services/projectService';
import type { IClip, IProject, ITrack } from '@/types/project';

vi.mock('@/db/audioDb', () => ({
  audioDb: {
    projects: { get: vi.fn(), put: vi.fn(), delete: vi.fn() },
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
  audioEngine: { cacheBuffer: vi.fn(), evictBuffer: vi.fn() },
}));

const mutableService = projectService as unknown as {
  currentProject: IProject | null;
  currentProjectId: string | null;
  saveQueue: Promise<void>;
  projectToRecord(project: IProject): ProjectRecord;
};

function makeClip(id: string, startTime: number): IClip {
  return {
    id,
    audioBufferId: `buffer-${id}`,
    startTime,
    offset: 0,
    duration: 1,
    originalDuration: 1,
    stretchRatio: 1,
    gain: 0,
    fadeIn: 0,
    fadeOut: 0,
  };
}

function makeTrack(id: string, startTime: number): ITrack {
  return {
    id,
    name: id,
    type: 'audio',
    gain: 0,
    pan: 0,
    muted: false,
    solo: false,
    armed: false,
    color: '',
    clips: [makeClip(`clip-${id}`, startTime)],
    effects: [],
  };
}

function makeProject(): IProject {
  return {
    id: 'track-alignment-project',
    name: 'Track alignment',
    sampleRate: 44100,
    timeSignature: { numerator: 4, denominator: 4 },
    tempo: 120,
    tracks: [makeTrack('track-a', 5), makeTrack('track-b', 1), makeTrack('track-c', 3)],
    cursorPosition: 0,
    selection: null,
    viewState: { horizontalZoom: 100, verticalZoom: 1, scrollX: 0, viewMode: 'waveform' },
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
  const record = records.get('track-alignment-project');
  return record ? JSON.parse(record.tracksData) as ITrack[] : [];
}

function delayNextProjectPut(): () => void {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let delayed = false;
  vi.mocked(audioDb.projects.put).mockImplementation((async (record: ProjectRecord) => {
    if (!delayed) {
      delayed = true;
      await gate;
    }
    records.set(record.id, { ...record });
    return record.id;
  }) as never);
  return release;
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
  vi.mocked(audioDb.projects.delete).mockImplementation(((id: string) => {
    records.delete(id);
    return Promise.resolve();
  }) as never);
  vi.mocked(audioDb.audioBuffers.where).mockReturnValue({
    equals: () => ({ toArray: async () => [] }),
  } as never);
  vi.mocked(audioDb.historySnapshots.where).mockReturnValue({
    equals: () => ({ delete: async () => 0 }),
  } as never);
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
});

afterEach(() => {
  mutableService.currentProject = null;
  mutableService.currentProjectId = null;
  mutableService.saveQueue = Promise.resolve();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('ProjectService atomic track alignment', () => {
  it('aligns the latest queued project and preserves earlier additions and renames', async () => {
    const before = installProject();
    const release = delayNextProjectPut();
    const renaming = projectService.updateTrack(before.id, 'track-a', { name: 'Renamed A' });
    await vi.waitFor(() => expect(audioDb.projects.put).toHaveBeenCalledTimes(1));
    const adding = projectService.addTrack(before.id);
    const aligning = projectService.alignTracks(before.id, ['track-a'], 'start-zero', {
      cursorPosition: 0,
      selection: null,
    });
    release();

    await renaming;
    const added = await adding;
    const result = await aligning;
    expect(added).not.toBeNull();
    expect(result?.before.tracks.map((track) => track.id))
      .toEqual(['track-a', 'track-b', 'track-c', added!.id]);
    expect(result?.before.tracks[0]?.name).toBe('Renamed A');
    expect(result?.after.tracks.map((track) => track.id))
      .toEqual(['track-a', 'track-b', 'track-c', added!.id]);
    expect(result?.after.tracks[0]?.clips[0]?.startTime).toBe(0);
    expect(result?.after.tracks[0]?.name).toBe('Renamed A');
    expect(persistedTracks().map((track) => track.id))
      .toEqual(['track-a', 'track-b', 'track-c', added!.id]);
    expect(persistedTracks()[0]?.name).toBe('Renamed A');
    expect(before.tracks[0]?.name).toBe('track-a');
    expect(before.tracks[0]?.clips[0]?.startTime).toBe(5);
  });

  it('keeps DoAlign selection, sync-lock, and analysis-label movement on the latest tracks', async () => {
    const before = installProject();
    before.cursorPosition = 6;
    before.selection = { start: 6, end: 8 };
    before.analysisLabels = [
      { id: 'label-a', kind: 'manual', trackId: 'track-a', start: 5, end: 6, text: 'A' },
      { id: 'label-b', kind: 'manual', trackId: 'track-b', start: 1, end: 2, text: 'B' },
    ];
    records.set(before.id, mutableService.projectToRecord(before));

    const result = await projectService.alignTracks(before.id, ['track-a'], 'start-zero', {
      cursorPosition: 6,
      selection: { start: 6, end: 8 },
      moveSelectionWithTracks: true,
      syncLockTracks: true,
    });

    expect(result?.after.tracks.map((track) => track.clips[0]?.startTime)).toEqual([0, -4, -2]);
    expect(result?.after.cursorPosition).toBe(1);
    expect(result?.after.selection).toEqual({ start: 1, end: 3 });
    expect(result?.after.analysisLabels?.map((label) => [label.start, label.end]))
      .toEqual([[0, 1], [-4, -3]]);
    expect(result?.before.selection).toEqual({ start: 6, end: 8 });
    const persisted = await projectService.getProject(before.id);
    expect(persisted?.selection).toEqual({ start: 1, end: 3 });
    expect(persisted?.tracks.map((track) => track.clips[0]?.startTime)).toEqual([0, -4, -2]);
  });

  it('aligns only surviving targets when an earlier queued removal wins', async () => {
    const before = installProject();
    const release = delayNextProjectPut();
    const removing = projectService.removeTracks(before.id, ['track-a']);
    await vi.waitFor(() => expect(audioDb.projects.put).toHaveBeenCalledTimes(1));
    const aligning = projectService.alignTracks(before.id, ['track-a', 'track-b'], 'start-zero', {
      cursorPosition: 0,
      selection: null,
    });
    release();

    await removing;
    const result = await aligning;
    expect(result?.after.tracks.map((track) => track.id)).toEqual(['track-b', 'track-c']);
    expect(result?.after.tracks.map((track) => track.clips[0]?.startTime)).toEqual([0, 3]);
    expect(persistedTracks().map((track) => track.id)).toEqual(['track-b', 'track-c']);
  });

  it('does not change memory or persistence when alignment fails', async () => {
    const before = installProject();
    const originalRecord = records.get(before.id);
    vi.mocked(audioDb.projects.put).mockRejectedValue(new Error('storage unavailable'));

    await expect(projectService.alignTracks(before.id, ['track-a'], 'start-zero', {
      cursorPosition: 0,
      selection: null,
    })).rejects.toThrow('storage unavailable');
    expect(records.get(before.id)).toEqual(originalRecord);
    expect(mutableService.currentProject).toBe(before);
    expect(before.tracks[0]?.clips[0]?.startTime).toBe(5);
  });

  it('does not recreate a project when permanent deletion wins before alignment', async () => {
    const before = installProject();
    const release = delayNextProjectPut();
    const updating = projectService.updateTrack(before.id, 'track-a', { name: 'Queue gate' });
    await vi.waitFor(() => expect(audioDb.projects.put).toHaveBeenCalledTimes(1));
    const deleting = projectService.permanentlyDeleteProject(before.id);
    const aligning = projectService.alignTracks(before.id, ['track-a'], 'start-zero', {
      cursorPosition: 0,
      selection: null,
    });
    release();

    await updating;
    await deleting;
    await expect(aligning).resolves.toBeNull();
    expect(records.has(before.id)).toBe(false);
    expect(mutableService.currentProject).toBeNull();
  });

  it('does not write for empty or unknown targets', async () => {
    const before = installProject();

    await expect(projectService.alignTracks(before.id, [], 'start-zero', {
      cursorPosition: 0,
      selection: null,
    })).resolves.toBeNull();
    await expect(projectService.alignTracks(before.id, ['missing'], 'start-zero', {
      cursorPosition: 0,
      selection: null,
    })).resolves.toBeNull();
    expect(audioDb.projects.put).not.toHaveBeenCalled();
    expect(mutableService.currentProject).toBe(before);
  });
});
