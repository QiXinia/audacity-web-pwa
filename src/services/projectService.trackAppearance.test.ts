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
    pan: 0,
    muted: false,
    solo: false,
    armed: false,
    color: id === 'track-a' ? '#66A3FF' : '#F08080',
    viewMode: 'waveform',
    halfWave: false,
    clips: [makeClip(`clip-${id}`)],
    effects: [],
  };
}

function makeProject(): IProject {
  return {
    id: 'track-appearance-project',
    name: 'Track appearance',
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
  const record = records.get('track-appearance-project');
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

describe('ProjectService atomic track appearance', () => {
  it('changes color on the latest queued project and preserves later track additions', async () => {
    const before = installProject();
    const release = delayNextProjectPut();
    const renaming = projectService.updateTrack(before.id, 'track-a', { name: 'Renamed A' });
    await vi.waitFor(() => expect(audioDb.projects.put).toHaveBeenCalledTimes(1));
    const coloring = projectService.updateTrackAppearance(before.id, 'track-b', {
      type: 'color', colorIndex: 9,
    });
    const adding = projectService.addTrack(before.id);
    release();

    await renaming;
    const colored = await coloring;
    await adding;
    expect(colored?.tracks[0]?.name).toBe('Renamed A');
    expect(colored?.tracks[1]?.color).toBe('#48BECF');
    expect(persistedTracks().map((track) => track.id)).toHaveLength(3);
    expect(persistedTracks()[0]?.name).toBe('Renamed A');
    expect(persistedTracks()[1]?.color).toBe('#48BECF');
  });

  it('serializes color, visualization, Half-wave, and metadata without overwriting earlier edits', async () => {
    const before = installProject();
    const coloring = projectService.updateTrackAppearance(before.id, 'track-b', {
      type: 'color', colorIndex: 3,
    });
    const renaming = projectService.updateTrack(before.id, 'track-b', { name: 'Latest name' });
    const viewing = projectService.updateTrackAppearance(before.id, 'track-b', {
      type: 'viewMode', viewMode: 'both',
    });
    const halfWave = projectService.updateTrackAppearance(before.id, 'track-b', {
      type: 'halfWave', halfWave: true,
    });

    await coloring;
    await renaming;
    const viewed = await viewing;
    const halved = await halfWave;
    expect(viewed?.tracks[1]).toMatchObject({ name: 'Latest name', color: '#DA8CCC', viewMode: 'both' });
    expect(halved?.tracks[1]).toMatchObject({
      name: 'Latest name', color: '#DA8CCC', viewMode: 'both', halfWave: true,
    });
    expect(persistedTracks()[1]).toMatchObject({
      name: 'Latest name', color: '#DA8CCC', viewMode: 'both', halfWave: true,
    });
    expect(persistedTracks()[0]).toMatchObject({ color: '#66A3FF', viewMode: 'waveform', halfWave: false });
  });

  it('does not write for no-op, invalid, or unknown appearance changes', async () => {
    const before = installProject();

    await expect(projectService.updateTrackAppearance(before.id, 'track-a', {
      type: 'color', colorIndex: 1,
    })).resolves.toBeNull();
    await expect(projectService.updateTrackAppearance(before.id, 'track-a', {
      type: 'viewMode', viewMode: 'waveform',
    })).resolves.toBeNull();
    await expect(projectService.updateTrackAppearance(before.id, 'track-a', {
      type: 'halfWave', halfWave: false,
    })).resolves.toBeNull();
    await expect(projectService.updateTrackAppearance(before.id, 'track-a', {
      type: 'color', colorIndex: 99,
    })).resolves.toBeNull();
    await expect(projectService.updateTrackAppearance(before.id, 'missing', {
      type: 'halfWave', halfWave: true,
    })).resolves.toBeNull();
    expect(audioDb.projects.put).not.toHaveBeenCalled();
    expect(mutableService.currentProject).toBe(before);
  });

  it('does not change memory or persistence when an appearance write fails', async () => {
    const before = installProject();
    vi.mocked(audioDb.projects.put).mockRejectedValue(new Error('storage unavailable'));

    await expect(projectService.updateTrackAppearance(before.id, 'track-b', {
      type: 'viewMode', viewMode: 'spectrum',
    })).rejects.toThrow('storage unavailable');
    expect(mutableService.currentProject).toBe(before);
    expect(mutableService.currentProject?.tracks[1]?.viewMode).toBe('waveform');
    expect(persistedTracks()[1]?.viewMode).toBe('waveform');
  });

  it('does not recreate a project when permanent deletion wins before a queued appearance write', async () => {
    const before = installProject();
    const release = delayNextProjectPut();
    const updating = projectService.updateTrack(before.id, 'track-a', { name: 'Queue gate' });
    await vi.waitFor(() => expect(audioDb.projects.put).toHaveBeenCalledTimes(1));
    const deleting = projectService.permanentlyDeleteProject(before.id);
    const coloring = projectService.updateTrackAppearance(before.id, 'track-a', {
      type: 'color', colorIndex: 7,
    });
    release();

    await updating;
    await deleting;
    await expect(coloring).resolves.toBeNull();
    expect(records.has(before.id)).toBe(false);
    expect(mutableService.currentProject).toBeNull();
  });
});
