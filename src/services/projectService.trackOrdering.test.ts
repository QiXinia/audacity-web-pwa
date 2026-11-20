import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { audioDb, type ProjectRecord } from '@/db/audioDb';
import { audioEngine } from '@/engine/audioEngine';
import { historyManager } from '@/services/historyService';
import { projectService } from '@/services/projectService';
import type { IClip, IProject, ITrack } from '@/types/project';

vi.mock('@/db/audioDb', () => ({
  audioDb: {
    projects: { get: vi.fn(), put: vi.fn() },
    audioBuffers: { put: vi.fn(), delete: vi.fn() },
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

function makeTrack(id: string, name: string, startTime: number): ITrack {
  return {
    id,
    name,
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
    id: 'track-ordering-project',
    name: 'Track ordering',
    sampleRate: 44100,
    timeSignature: { numerator: 4, denominator: 4 },
    tempo: 120,
    tracks: [
      makeTrack('track-a', 'Charlie', 5),
      makeTrack('track-b', 'Beta', 1),
      makeTrack('track-c', 'Alpha', 3),
    ],
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
  const record = records.get('track-ordering-project');
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
});

afterEach(() => {
  mutableService.currentProject = null;
  mutableService.currentProjectId = null;
  historyManager.setPersistEnabled(true);
  vi.clearAllMocks();
});

describe('ProjectService atomic track ordering', () => {
  it('preserves a rename queued behind an in-flight track move', async () => {
    const before = installProject();
    const release = delayNextProjectPut();

    const moving = projectService.moveTrack(before.id, 'track-b', 'up');
    await vi.waitFor(() => expect(audioDb.projects.put).toHaveBeenCalledTimes(1));
    const renaming = projectService.updateTrack(before.id, 'track-b', { name: 'Renamed after move' });
    release();

    const moved = await moving;
    await renaming;
    expect(moved?.before.tracks.map((track) => track.id)).toEqual(['track-a', 'track-b', 'track-c']);
    expect(moved?.after.tracks.map((track) => track.id)).toEqual(['track-b', 'track-a', 'track-c']);
    expect(persistedTracks().map((track) => track.id)).toEqual(['track-b', 'track-a', 'track-c']);
    expect(persistedTracks()[0]?.name).toBe('Renamed after move');
    expect(before.tracks.map((track) => track.id)).toEqual(['track-a', 'track-b', 'track-c']);
    expect(before.tracks[1]?.name).toBe('Beta');
  });

  it('sorts a track added behind an in-flight sort instead of discarding it', async () => {
    const before = installProject();
    const release = delayNextProjectPut();

    const sorting = projectService.sortTracks(before.id, 'time');
    await vi.waitFor(() => expect(audioDb.projects.put).toHaveBeenCalledTimes(1));
    const adding = projectService.addTrack(before.id);
    release();

    const sorted = await sorting;
    const added = await adding;
    expect(added).not.toBeNull();
    expect(sorted?.before.tracks.map((track) => track.id)).toEqual(['track-a', 'track-b', 'track-c']);
    expect(sorted?.after.tracks.map((track) => track.id)).toEqual(['track-b', 'track-c', 'track-a']);
    expect(persistedTracks().map((track) => track.id))
      .toEqual(['track-b', 'track-c', 'track-a', added!.id]);
  });

  it('keeps boundary moves write-free and returns independent sort history snapshots', async () => {
    const before = installProject();

    await expect(projectService.moveTrack(before.id, 'track-a', 'up')).resolves.toBeNull();
    expect(audioDb.projects.put).not.toHaveBeenCalled();

    const sorted = await projectService.sortTracks(before.id, 'name');
    expect(sorted?.before.tracks.map((track) => track.id)).toEqual(['track-a', 'track-b', 'track-c']);
    expect(sorted?.after.tracks.map((track) => track.id)).toEqual(['track-c', 'track-b', 'track-a']);
    expect(sorted?.before).not.toBe(before);
    expect(sorted?.before.tracks[0]).not.toBe(before.tracks[0]);
    sorted!.after.tracks[0]!.name = 'Changed only in redo';
    expect(sorted?.before.tracks[2]?.name).toBe('Alpha');
    expect(before.tracks.map((track) => track.id)).toEqual(['track-a', 'track-b', 'track-c']);
  });

  it('rejects a failed move without mutating memory or the persisted project', async () => {
    const before = installProject();
    const originalRecord = records.get(before.id)!;
    vi.mocked(audioDb.projects.put).mockRejectedValue(new Error('quota exceeded') as never);

    await expect(projectService.moveTrack(before.id, 'track-b', 'up')).rejects.toThrow('quota exceeded');
    expect(records.get(before.id)).toEqual(originalRecord);
    expect(persistedTracks().map((track) => track.id)).toEqual(['track-a', 'track-b', 'track-c']);
    expect(mutableService.currentProject).toBe(before);
    expect(before.tracks.map((track) => track.id)).toEqual(['track-a', 'track-b', 'track-c']);
  });

  it('does not recreate a permanently deleted project during reordering', async () => {
    const before = installProject();
    records.clear();

    await expect(projectService.moveTrack(before.id, 'track-b', 'up')).resolves.toBeNull();
    await expect(projectService.sortTracks(before.id, 'name')).resolves.toBeNull();
    expect(records.has(before.id)).toBe(false);
    expect(audioDb.projects.put).not.toHaveBeenCalled();
    expect(mutableService.currentProject).toBe(before);
  });
});
