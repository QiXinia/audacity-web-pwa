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

function makeEffect(id: string, type: IEffect['type'] = 'gain'): IEffect {
  return { id, type, bypassed: false, params: { gain: 3 } };
}

function makeProject(): IProject {
  const track: ITrack = {
    id: 'track-a', name: 'Original track', type: 'audio', gain: 0, pan: 0,
    muted: false, solo: false, armed: false, color: '#66A3FF', clips: [],
    effects: [makeEffect('fx-a'), makeEffect('fx-b', 'highPass'), makeEffect('fx-c', 'reverb')],
  };
  track.effects[1]!.bypassed = true;
  track.effects[1]!.params = { frequency: 240, q: 1.2 };
  return {
    id: 'effect-replace-project', name: 'Effect replace', sampleRate: 44100,
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
  const record = records.get('effect-replace-project');
  if (!record) throw new Error('Missing persisted project');
  return (JSON.parse(record.tracksData) as ITrack[])[0]!;
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

describe('ProjectService realtime effect replacement', () => {
  it('replaces only the requested slot with a fresh active effect and exact history snapshots', async () => {
    const project = installProject();
    const result = await projectService.replaceEffectOnTrack(project.id, 'track-a', 'fx-b', 'lowPass');

    expect(result?.index).toBe(1);
    expect(result?.replacement.id).not.toBe('fx-b');
    expect(result?.replacement).toMatchObject({
      type: 'lowPass', bypassed: false, params: { frequency: 8000, q: 0.7 },
    });
    expect(result?.after.tracks[0]?.effects.map((effect) => effect.id)).toEqual([
      'fx-a', result?.replacement.id, 'fx-c',
    ]);
    expect(result?.before.tracks[0]?.effects.map((effect) => effect.id)).toEqual(['fx-a', 'fx-b', 'fx-c']);
    expect(project.tracks[0]?.effects.map((effect) => effect.id)).toEqual(['fx-a', 'fx-b', 'fx-c']);
    expect(persistedTrack().effects[1]).toMatchObject({ type: 'lowPass', params: { frequency: 8000 } });
  });

  it('matches native replacement of the same type by resetting its settings and identity', async () => {
    const project = installProject();
    const result = await projectService.replaceEffectOnTrack(project.id, 'track-a', 'fx-b', 'highPass');

    expect(result?.replacement.id).not.toBe('fx-b');
    expect(result?.replacement).toMatchObject({
      type: 'highPass', bypassed: false, params: { frequency: 80, q: 0.7 },
    });
    expect(result?.replacement.params).not.toEqual({ frequency: 240, q: 1.2 });
  });

  it('does not write for an unknown project, track, or effect', async () => {
    const project = installProject();
    await expect(projectService.replaceEffectOnTrack('missing', 'track-a', 'fx-b', 'gain')).resolves.toBeNull();
    await expect(projectService.replaceEffectOnTrack(project.id, 'missing', 'fx-b', 'gain')).resolves.toBeNull();
    await expect(projectService.replaceEffectOnTrack(project.id, 'track-a', 'missing', 'gain')).resolves.toBeNull();
    expect(audioDb.projects.put).not.toHaveBeenCalled();
  });

  it('keeps memory and storage unchanged when replacement cannot be saved', async () => {
    const project = installProject();
    vi.mocked(audioDb.projects.put).mockRejectedValue(new Error('storage unavailable'));

    await expect(projectService.replaceEffectOnTrack(project.id, 'track-a', 'fx-b', 'lowPass'))
      .rejects.toThrow('storage unavailable');
    expect(mutableService.currentProject).toBe(project);
    expect(project.tracks[0]?.effects[1]?.id).toBe('fx-b');
    expect(persistedTrack().effects[1]?.id).toBe('fx-b');
  });
});
