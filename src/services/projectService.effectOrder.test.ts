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

function makeEffect(id: string): IEffect {
  return { id, type: 'gain', bypassed: false, params: { gain: 0 } };
}

function makeProject(): IProject {
  const track: ITrack = {
    id: 'track-a', name: 'Original track', type: 'audio', gain: 0, pan: 0,
    muted: false, solo: false, armed: false, color: '#66A3FF', clips: [],
    effects: ['fx-a', 'fx-b', 'fx-c'].map(makeEffect),
  };
  return {
    id: 'effect-order-project', name: 'Effect order', sampleRate: 44100,
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
  const record = records.get('effect-order-project');
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

describe('ProjectService realtime effect ordering', () => {
  it('persists an arbitrary move and returns exact before/after history snapshots', async () => {
    const project = installProject();
    const result = await projectService.moveEffectToIndex(project.id, 'track-a', 'fx-a', 2);

    expect(result?.fromIndex).toBe(0);
    expect(result?.toIndex).toBe(2);
    expect(effectIds(result!.after)).toEqual(['fx-b', 'fx-c', 'fx-a']);
    expect(effectIds(result!.before)).toEqual(['fx-a', 'fx-b', 'fx-c']);
    expect(effectIds(project)).toEqual(['fx-a', 'fx-b', 'fx-c']);
    expect(persistedTrack().effects.map((effect) => effect.id)).toEqual(['fx-b', 'fx-c', 'fx-a']);
    expect(mutableService.currentProject).toBe(result?.after);
  });

  it('does not write no-op, unknown, fractional, or out-of-range moves', async () => {
    const project = installProject();
    for (const [effectId, index] of [
      ['fx-a', 0], ['fx-a', -1], ['fx-a', 3], ['fx-a', 1.5],
      ['fx-a', Number.NaN], ['missing', 1],
    ] as const) {
      await expect(projectService.moveEffectToIndex(project.id, 'track-a', effectId, index)).resolves.toBeNull();
    }
    await expect(projectService.moveEffectToIndex(project.id, 'missing', 'fx-a', 1)).resolves.toBeNull();
    expect(audioDb.projects.put).not.toHaveBeenCalled();
    expect(effectIds(project)).toEqual(['fx-a', 'fx-b', 'fx-c']);
  });

  it('applies the move to the latest queued project without losing a rename', async () => {
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
    const moving = projectService.moveEffectToIndex(project.id, 'track-a', 'fx-c', 0);
    release();
    await renaming;
    const moved = await moving;

    expect(moved?.after.tracks[0]?.name).toBe('Renamed track');
    expect(effectIds(moved!.after)).toEqual(['fx-c', 'fx-a', 'fx-b']);
    expect(persistedTrack().name).toBe('Renamed track');
    expect(persistedTrack().effects.map((effect) => effect.id)).toEqual(['fx-c', 'fx-a', 'fx-b']);
  });

  it('keeps memory and storage unchanged when the move cannot be saved', async () => {
    const project = installProject();
    vi.mocked(audioDb.projects.put).mockRejectedValue(new Error('storage unavailable'));

    await expect(projectService.moveEffectToIndex(project.id, 'track-a', 'fx-b', 2))
      .rejects.toThrow('storage unavailable');
    expect(mutableService.currentProject).toBe(project);
    expect(effectIds(project)).toEqual(['fx-a', 'fx-b', 'fx-c']);
    expect(persistedTrack().effects.map((effect) => effect.id)).toEqual(['fx-a', 'fx-b', 'fx-c']);
  });
});
