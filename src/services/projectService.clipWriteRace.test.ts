import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { audioDb, type ProjectRecord } from '@/db/audioDb';
import { audioEngine } from '@/engine/audioEngine';
import { moveClipSelection, stretchClipSelection, trimClipSelection } from '@/lib/clipEditing';
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

const clipKey = { trackId: 'track-a', clipId: 'clip-a' } as const;

function makeClip(id: string): IClip {
  return {
    id, audioBufferId: `buffer-${id}`, startTime: 1, offset: 0,
    duration: 2, originalDuration: 2, stretchRatio: 1, gain: 0,
    fadeIn: 0, fadeOut: 0, name: id,
  };
}

function makeTrack(id: string): ITrack {
  return {
    id, name: id, type: 'audio', gain: 0, pan: 0,
    muted: false, solo: false, armed: false, color: '#66A3FF',
    viewMode: 'waveform', halfWave: false,
    clips: [makeClip(id === 'track-a' ? 'clip-a' : `clip-${id}`)], effects: [],
  };
}

function makeProject(): IProject {
  return {
    id: 'clip-write-race-service-project', name: 'Clip write race',
    sampleRate: 44100, timeSignature: { numerator: 4, denominator: 4 }, tempo: 120,
    tracks: [makeTrack('track-a'), makeTrack('track-b')],
    cursorPosition: 0, selection: null,
    viewState: { horizontalZoom: 100, verticalZoom: 1, scrollX: 0, viewMode: 'waveform' },
    updatedAt: 100, createdAt: 50,
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
  const record = records.get('clip-write-race-service-project');
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

describe('ProjectService latest-project clip edits', () => {
  it('trims the latest queued project without overwriting a rename or later track addition', async () => {
    const before = installProject();
    const release = delayNextProjectPut();
    const renaming = projectService.updateTrack(before.id, 'track-a', { name: 'Renamed Alpha' });
    await vi.waitFor(() => expect(audioDb.projects.put).toHaveBeenCalledTimes(1));
    const editing = projectService.editLatestProject(before.id, (latest) =>
      trimClipSelection(latest, [clipKey], 'right', -0.2));
    const adding = projectService.addTrack(before.id);
    release();

    await renaming;
    const edited = await editing;
    await adding;
    expect(edited?.before.tracks[0]?.name).toBe('Renamed Alpha');
    expect(edited?.after.tracks[0]?.clips[0]?.duration).toBeCloseTo(1.8, 10);
    expect(edited?.before.tracks[0]?.clips[0]?.duration).toBe(2);
    expect(persistedTracks().map((track) => track.id)).toHaveLength(3);
    expect(persistedTracks()[0]?.name).toBe('Renamed Alpha');
    expect(persistedTracks()[0]?.clips[0]?.duration).toBeCloseTo(1.8, 10);
  });

  it('serializes trim, stretch, and move on successive latest snapshots', async () => {
    const before = installProject();
    const trimming = projectService.editLatestProject(before.id, (latest) =>
      trimClipSelection(latest, [clipKey], 'right', -0.2));
    const stretching = projectService.editLatestProject(before.id, (latest) =>
      stretchClipSelection(latest, [clipKey], 'right', -0.2));
    const moving = projectService.editLatestProject(before.id, (latest) =>
      moveClipSelection(latest, [clipKey], 0.5));

    await trimming;
    await stretching;
    const moved = await moving;
    expect(moved?.after.tracks[0]?.clips[0]).toMatchObject({ startTime: 1.5, duration: 1.6 });
    expect(moved?.after.tracks[0]?.clips[0]?.stretchRatio).toBeCloseTo(1.125, 10);
    expect(persistedTracks()[0]?.clips[0]).toMatchObject({ startTime: 1.5, duration: 1.6 });
    expect(persistedTracks()[0]?.clips[0]?.stretchRatio).toBeCloseTo(1.125, 10);
  });

  it('does not write a no-op or missing clip edit', async () => {
    const before = installProject();

    await expect(projectService.editLatestProject(before.id, (latest) => latest)).resolves.toBeNull();
    await expect(projectService.editLatestProject(before.id, (latest) =>
      trimClipSelection(latest, [{ trackId: 'missing', clipId: 'missing' }], 'right', -0.2),
    )).resolves.toBeNull();
    expect(audioDb.projects.put).not.toHaveBeenCalled();
    expect(mutableService.currentProject).toBe(before);
  });

  it('does not change memory or persistence when a clip edit write fails', async () => {
    const before = installProject();
    vi.mocked(audioDb.projects.put).mockRejectedValue(new Error('storage unavailable'));

    await expect(projectService.editLatestProject(before.id, (latest) =>
      trimClipSelection(latest, [clipKey], 'right', -0.2),
    )).rejects.toThrow('storage unavailable');
    expect(mutableService.currentProject).toBe(before);
    expect(mutableService.currentProject?.tracks[0]?.clips[0]?.duration).toBe(2);
    expect(persistedTracks()[0]?.clips[0]?.duration).toBe(2);
  });

  it('does not recreate a project when permanent deletion wins before a queued clip edit', async () => {
    const before = installProject();
    const release = delayNextProjectPut();
    const updating = projectService.updateTrack(before.id, 'track-a', { name: 'Queue gate' });
    await vi.waitFor(() => expect(audioDb.projects.put).toHaveBeenCalledTimes(1));
    const deleting = projectService.permanentlyDeleteProject(before.id);
    const editing = projectService.editLatestProject(before.id, (latest) =>
      moveClipSelection(latest, [clipKey], 0.5));
    release();

    await updating;
    await deleting;
    await expect(editing).resolves.toBeNull();
    expect(records.has(before.id)).toBe(false);
    expect(mutableService.currentProject).toBeNull();
  });
});
