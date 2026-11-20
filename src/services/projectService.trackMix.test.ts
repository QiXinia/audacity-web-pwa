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

function makeClip(id: string): IClip {
  return {
    id,
    audioBufferId: `buffer-${id}`,
    startTime: 0,
    offset: 0,
    duration: 1,
    originalDuration: 1,
    stretchRatio: 1,
    gain: 0,
    fadeIn: 0,
    fadeOut: 0,
  };
}

function makeTrack(id: string): ITrack {
  return {
    id,
    name: id,
    type: 'audio',
    gain: 0,
    pan: id === 'track-a' ? 0.25 : -0.25,
    muted: id === 'track-b',
    solo: true,
    armed: false,
    color: '',
    clips: [makeClip(`clip-${id}`)],
    effects: [],
  };
}

function makeProject(): IProject {
  return {
    id: 'track-mix-project',
    name: 'Track mix',
    sampleRate: 44100,
    timeSignature: { numerator: 4, denominator: 4 },
    tempo: 120,
    tracks: [makeTrack('track-a'), makeTrack('track-b')],
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
  const record = records.get('track-mix-project');
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

describe('ProjectService atomic track mute and pan', () => {
  it('mutes the latest tracks with Simple Solo semantics and preserves queued edits', async () => {
    const before = installProject();
    const release = delayNextProjectPut();
    const muting = projectService.setTracksMute(before.id, ['track-a', 'track-b'], true);
    await vi.waitFor(() => expect(audioDb.projects.put).toHaveBeenCalledTimes(1));
    const renaming = projectService.updateTrack(before.id, 'track-a', { name: 'Renamed A' });
    const adding = projectService.addTrack(before.id);
    release();

    const result = await muting;
    await renaming;
    await adding;
    expect(result?.before.tracks.map((track) => [track.muted, track.solo])).toEqual([[false, true], [true, true]]);
    expect(result?.after.tracks.map((track) => [track.muted, track.solo])).toEqual([[true, false], [true, false]]);
    expect(persistedTracks().map((track) => track.id)).toHaveLength(3);
    expect(persistedTracks()[0]?.name).toBe('Renamed A');
    expect(persistedTracks().slice(0, 2).map((track) => [track.muted, track.solo])).toEqual([[true, false], [true, false]]);
    expect(before.tracks.map((track) => track.solo)).toEqual([true, true]);
  });

  it('pans only targets and keeps a track added behind the in-flight write', async () => {
    const before = installProject();
    const release = delayNextProjectPut();
    const panning = projectService.setTracksPan(before.id, ['track-b'], -1);
    await vi.waitFor(() => expect(audioDb.projects.put).toHaveBeenCalledTimes(1));
    const adding = projectService.addTrack(before.id);
    release();

    const result = await panning;
    await adding;
    expect(result?.before.tracks.map((track) => track.pan)).toEqual([0.25, -0.25]);
    expect(result?.after.tracks.map((track) => track.pan)).toEqual([0.25, -1]);
    expect(persistedTracks().map((track) => track.id)).toHaveLength(3);
    expect(persistedTracks().slice(0, 2).map((track) => track.pan)).toEqual([0.25, -1]);
  });

  it('still clears Simple Solo when the requested mute state is already set', async () => {
    const before = installProject();
    const result = await projectService.setTracksMute(before.id, ['track-b'], true);

    expect(result?.after.tracks[1]).toMatchObject({ muted: true, solo: false });
    expect(persistedTracks()[1]).toMatchObject({ muted: true, solo: false });
    expect(audioDb.projects.put).toHaveBeenCalledTimes(1);
  });

  it('does not change memory or persistence when a mix write fails', async () => {
    const before = installProject();
    vi.mocked(audioDb.projects.put).mockRejectedValue(new Error('storage unavailable'));

    await expect(projectService.setTracksPan(before.id, ['track-a'], 1)).rejects.toThrow('storage unavailable');
    expect(mutableService.currentProject).toBe(before);
    expect(mutableService.currentProject?.tracks[0]?.pan).toBe(0.25);
    expect(persistedTracks()[0]?.pan).toBe(0.25);
  });

  it('does not recreate a project when permanent deletion wins before a queued mix write', async () => {
    const before = installProject();
    const release = delayNextProjectPut();
    const updating = projectService.updateTrack(before.id, 'track-a', { name: 'Queue gate' });
    await vi.waitFor(() => expect(audioDb.projects.put).toHaveBeenCalledTimes(1));
    const deleting = projectService.permanentlyDeleteProject(before.id);
    const muting = projectService.setTracksMute(before.id, ['track-a'], true);
    release();

    await updating;
    await deleting;
    await expect(muting).resolves.toBeNull();
    expect(records.has(before.id)).toBe(false);
    expect(mutableService.currentProject).toBeNull();
  });

  it('does not write for empty or unknown targets', async () => {
    const before = installProject();

    await expect(projectService.setTracksMute(before.id, [], true)).resolves.toBeNull();
    await expect(projectService.setTracksMute(before.id, ['missing'], true)).resolves.toBeNull();
    await expect(projectService.setTracksPan(before.id, [], 0)).resolves.toBeNull();
    await expect(projectService.setTracksPan(before.id, ['missing'], 0)).resolves.toBeNull();
    expect(audioDb.projects.put).not.toHaveBeenCalled();
    expect(mutableService.currentProject).toBe(before);
  });
});
