import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { audioDb, type ProjectRecord } from '@/db/audioDb';
import { projectService } from '@/services/projectService';
import type { IEffect, IProject, ITrack } from '@/types/project';

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
}));

const mutableService = projectService as unknown as {
  currentProject: IProject | null;
  currentProjectId: string | null;
  saveQueue: Promise<void>;
  projectToRecord(project: IProject): ProjectRecord;
};

function makeProject(): IProject {
  const track: ITrack = {
    id: 'track-a', name: 'Original track', type: 'audio', gain: 0, pan: 0,
    muted: false, solo: false, armed: false, color: '#66A3FF', clips: [],
    effects: [
      { id: 'fx-a', type: 'gain', bypassed: false, params: { gain: 3 } },
      { id: 'fx-b', type: 'highPass', bypassed: false, params: { frequency: 240, q: 1.2 } },
    ],
  };
  return {
    id: 'effect-mutations-project', name: 'Effect mutations', sampleRate: 44100,
    timeSignature: { numerator: 4, denominator: 4 }, tempo: 120, tracks: [track],
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

function persistedTrack(): ITrack {
  const record = records.get('effect-mutations-project');
  if (!record) throw new Error('Missing persisted project');
  return (JSON.parse(record.tracksData) as ITrack[])[0]!;
}

function effectIds(project: IProject): string[] {
  return project.tracks[0]!.effects.map((effect) => effect.id);
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
    return (operation as () => Promise<unknown>)();
  }) as never);
});

afterEach(() => {
  mutableService.currentProject = null;
  mutableService.currentProjectId = null;
  mutableService.saveQueue = Promise.resolve();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('ProjectService realtime effect mutations', () => {
  it('adds a default active effect immutably with exact history snapshots', async () => {
    const project = installProject();
    const result = await projectService.addEffectToTrack(project.id, 'track-a', 'lowPass');

    expect(result?.effect).toMatchObject({ type: 'lowPass', bypassed: false, params: { frequency: 8000, q: 0.7 } });
    expect(effectIds(result!.before)).toEqual(['fx-a', 'fx-b']);
    expect(effectIds(result!.after)).toEqual(['fx-a', 'fx-b', result!.effect.id]);
    expect(effectIds(project)).toEqual(['fx-a', 'fx-b']);
    expect(persistedTrack().effects[2]).toMatchObject({ type: 'lowPass', params: { frequency: 8000, q: 0.7 } });
  });

  it('keeps add memory and storage unchanged when saving fails', async () => {
    const project = installProject();
    vi.mocked(audioDb.projects.put).mockRejectedValue(new Error('storage unavailable'));

    await expect(projectService.addEffectToTrack(project.id, 'track-a', 'lowPass'))
      .rejects.toThrow('storage unavailable');
    expect(mutableService.currentProject).toBe(project);
    expect(effectIds(project)).toEqual(['fx-a', 'fx-b']);
    expect(persistedTrack().effects).toHaveLength(2);
  });

  it('merges partial parameters without dropping existing fields or mutating the old snapshot', async () => {
    const project = installProject();
    const result = await projectService.updateEffect(project.id, 'track-a', 'fx-b', {
      params: { frequency: 440 },
    });

    expect(result?.before.tracks[0]?.effects[1]?.params).toEqual({ frequency: 240, q: 1.2 });
    expect(result?.after.tracks[0]?.effects[1]?.params).toEqual({ frequency: 440, q: 1.2 });
    expect(project.tracks[0]?.effects[1]?.params).toEqual({ frequency: 240, q: 1.2 });
    expect(persistedTrack().effects[1]?.params).toEqual({ frequency: 440, q: 1.2 });
  });

  it('keeps update memory and storage unchanged when saving fails', async () => {
    const project = installProject();
    vi.mocked(audioDb.projects.put).mockRejectedValue(new Error('storage unavailable'));

    await expect(projectService.updateEffect(project.id, 'track-a', 'fx-a', { bypassed: true }))
      .rejects.toThrow('storage unavailable');
    expect(mutableService.currentProject).toBe(project);
    expect(project.tracks[0]?.effects[0]?.bypassed).toBe(false);
    expect(persistedTrack().effects[0]?.bypassed).toBe(false);
  });

  it('removes only the requested effect immutably with exact history snapshots', async () => {
    const project = installProject();
    const result = await projectService.removeEffectFromTrack(project.id, 'track-a', 'fx-a');

    expect(result?.removed.id).toBe('fx-a');
    expect(result?.index).toBe(0);
    expect(effectIds(result!.before)).toEqual(['fx-a', 'fx-b']);
    expect(effectIds(result!.after)).toEqual(['fx-b']);
    expect(effectIds(project)).toEqual(['fx-a', 'fx-b']);
    expect(persistedTrack().effects.map((effect: IEffect) => effect.id)).toEqual(['fx-b']);
  });

  it('keeps remove memory and storage unchanged when saving fails', async () => {
    const project = installProject();
    vi.mocked(audioDb.projects.put).mockRejectedValue(new Error('storage unavailable'));

    await expect(projectService.removeEffectFromTrack(project.id, 'track-a', 'fx-a'))
      .rejects.toThrow('storage unavailable');
    expect(mutableService.currentProject).toBe(project);
    expect(effectIds(project)).toEqual(['fx-a', 'fx-b']);
    expect(persistedTrack().effects).toHaveLength(2);
  });

  it('does not write for unknown mutation targets', async () => {
    const project = installProject();
    await expect(projectService.addEffectToTrack(project.id, 'missing', 'gain')).resolves.toBeNull();
    await expect(projectService.updateEffect(project.id, 'track-a', 'missing', { bypassed: true })).resolves.toBeNull();
    await expect(projectService.removeEffectFromTrack(project.id, 'track-a', 'missing')).resolves.toBeNull();
    expect(audioDb.projects.put).not.toHaveBeenCalled();
    expect(effectIds(project)).toEqual(['fx-a', 'fx-b']);
  });

  it('serializes consecutive bypass toggles against the latest committed state', async () => {
    const project = installProject();
    const first = projectService.toggleEffectBypass(project.id, 'track-a', 'fx-a');
    const second = projectService.toggleEffectBypass(project.id, 'track-a', 'fx-a');
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult?.before.tracks[0]?.effects[0]?.bypassed).toBe(false);
    expect(firstResult?.after.tracks[0]?.effects[0]?.bypassed).toBe(true);
    expect(secondResult?.before.tracks[0]?.effects[0]?.bypassed).toBe(true);
    expect(secondResult?.after.tracks[0]?.effects[0]?.bypassed).toBe(false);
    expect(persistedTrack().effects[0]?.bypassed).toBe(false);
    expect(project.tracks[0]?.effects[0]?.bypassed).toBe(false);
  });

  it('applies an added effect to the latest queued project without losing a rename', async () => {
    const project = installProject();
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

    const renaming = projectService.updateTrack(project.id, 'track-a', { name: 'Renamed track' });
    await vi.waitFor(() => expect(audioDb.projects.put).toHaveBeenCalledTimes(1));
    const adding = projectService.addEffectToTrack(project.id, 'track-a', 'lowPass');
    release();
    await renaming;
    const added = await adding;

    expect(added?.after.tracks[0]?.name).toBe('Renamed track');
    expect(added?.after.tracks[0]?.effects).toHaveLength(3);
    expect(persistedTrack().name).toBe('Renamed track');
    expect(persistedTrack().effects).toHaveLength(3);
  });
});
