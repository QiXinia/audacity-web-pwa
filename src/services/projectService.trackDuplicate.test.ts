import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { audioDb, type ProjectRecord } from '@/db/audioDb';
import { audioEngine } from '@/engine/audioEngine';
import { projectService } from '@/services/projectService';
import type { IProject, ITrack } from '@/types/project';

vi.mock('@/db/audioDb', () => ({
  audioDb: {
    projects: { get: vi.fn(), put: vi.fn() },
    audioBuffers: { put: vi.fn(), delete: vi.fn() },
    clipboard: {}, historySnapshots: {},
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
vi.mock('@/wasm/processor', () => ({ isWasmAvailable: vi.fn(() => false), wasmProcessor: {} }));

const mutableService = projectService as unknown as {
  currentProject: IProject | null;
  currentProjectId: string | null;
  saveQueue: Promise<void>;
  projectToRecord(project: IProject): ProjectRecord;
};

function makeProject(): IProject {
  return {
    id: 'duplicate-service-project', name: 'Duplicate service', sampleRate: 10,
    timeSignature: { numerator: 4, denominator: 4 }, tempo: 120,
    tracks: [{
      id: 'source', name: 'Lead', type: 'audio', gain: -2, pan: 0.25,
      muted: false, solo: false, armed: false, color: '#123456', effects: [],
      clips: [
        {
          id: 'a', audioBufferId: 'buffer-a', startTime: 0, offset: 0,
          duration: 2, originalDuration: 2, stretchRatio: 1, gain: 0, fadeIn: 0, fadeOut: 0,
        },
        {
          id: 'b', audioBufferId: 'buffer-a', startTime: 2, offset: 1,
          duration: 1, originalDuration: 2, stretchRatio: 1, gain: 0, fadeIn: 0, fadeOut: 0,
        },
        {
          id: 'c', audioBufferId: 'buffer-b', startTime: 4, offset: 0,
          duration: 1, originalDuration: 1, stretchRatio: 1, gain: 0, fadeIn: 0, fadeOut: 0,
        },
      ],
    }],
    cursorPosition: 0, selection: null,
    viewState: { horizontalZoom: 100, verticalZoom: 1, scrollX: 0, viewMode: 'waveform' },
    updatedAt: 100, createdAt: 50,
  };
}

function mockSources(sources: Record<string, Float32Array[]>): void {
  vi.spyOn(projectService, 'loadAudioChannels').mockImplementation(async (bufferId) => sources[bufferId] ?? null);
  vi.spyOn(projectService, 'loadAudioBufferMetadata').mockImplementation(async (bufferId) => {
    const channels = sources[bufferId];
    if (!channels) return null;
    const length = channels[0]?.length ?? 0;
    return { id: bufferId, sampleRate: 10, channels: channels.length, length, duration: length / 10 };
  });
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
  const record = records.get('duplicate-service-project');
  return record ? JSON.parse(record.tracksData) as ITrack[] : [];
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
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  mutableService.currentProject = null;
  mutableService.currentProjectId = null;
  mutableService.saveQueue = Promise.resolve();
});

describe('ProjectService complete Track duplicate', () => {
  it('copies every unique PCM buffer once and commits the complete track atomically', async () => {
    const project = installProject();
    const sourceA = Float32Array.from([0.1, 0.2]);
    const sourceB = Float32Array.from([0.3]);
    mockSources({ 'buffer-a': [sourceA], 'buffer-b': [sourceB] });

    const copy = await projectService.duplicateTrack(project.id, 'source');
    expect(copy).not.toBeNull();
    expect(copy!.id).not.toBe('source');
    expect(copy!.name).toBe('Lead');
    expect(copy!.clips).toHaveLength(3);
    expect(copy!.clips[0]!.audioBufferId).toBe(copy!.clips[1]!.audioBufferId);
    expect(audioDb.projects.put).toHaveBeenCalledTimes(1);
    expect(persistedTracks().map((track) => track.id)).toEqual(['source', copy!.id]);
    expect(mutableService.currentProject?.tracks.map((track) => track.id)).toEqual(['source', copy!.id]);
    expect(mutableService.currentProject?.tracks[0]).toBe(project.tracks[0]);
    expect(vi.mocked(audioDb.audioBuffers.put)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(audioEngine.cacheBuffer)).toHaveBeenCalledTimes(2);

    sourceA[0] = 99;
    const firstStored = vi.mocked(audioDb.audioBuffers.put).mock.calls[0]![0];
    expect(new Float32Array(firstStored.channelData[0]!)[0]).not.toBe(99);
    expect(project.tracks).toHaveLength(1);
    expect(project.tracks[0]!.clips.map((clip) => clip.audioBufferId)).toEqual(['buffer-a', 'buffer-a', 'buffer-b']);
  });

  it('returns null for an unknown track without loading or writing audio', async () => {
    const project = installProject();
    const load = vi.spyOn(projectService, 'loadAudioChannels');

    await expect(projectService.duplicateTrack(project.id, 'missing')).resolves.toBeNull();
    expect(load).not.toHaveBeenCalled();
    expect(audioDb.projects.put).not.toHaveBeenCalled();
    expect(vi.mocked(audioDb.audioBuffers.put)).not.toHaveBeenCalled();
  });

  it('rejects a missing source buffer before any project or PCM write', async () => {
    const project = installProject();
    mockSources({});

    await expect(projectService.duplicateTrack(project.id, 'source'))
      .rejects.toThrow('无法读取片段音频缓冲');
    expect(audioDb.projects.put).not.toHaveBeenCalled();
    expect(vi.mocked(audioDb.audioBuffers.put)).not.toHaveBeenCalled();
    expect(vi.mocked(audioEngine.cacheBuffer)).not.toHaveBeenCalled();
    expect(mutableService.currentProject).toBe(project);
  });

  it('cleans every newly staged buffer when the project commit fails', async () => {
    const project = installProject();
    project.tracks[0]!.clips = [project.tracks[0]!.clips[0]!];
    records.set(project.id, mutableService.projectToRecord(project));
    const originalRecord = records.get(project.id)!;
    mockSources({ 'buffer-a': [Float32Array.from([0.1, 0.2])] });
    vi.mocked(audioDb.projects.put).mockRejectedValue(new Error('storage unavailable') as never);

    await expect(projectService.duplicateTrack(project.id, 'source')).rejects.toThrow('storage unavailable');
    const staged = vi.mocked(audioDb.audioBuffers.put).mock.calls[0]![0];
    expect(vi.mocked(audioDb.audioBuffers.delete)).toHaveBeenCalledWith(staged.id);
    expect(vi.mocked(audioEngine.evictBuffer)).toHaveBeenCalledWith(staged.id);
    expect(vi.mocked(audioEngine.cacheBuffer)).not.toHaveBeenCalled();
    expect(records.get(project.id)).toEqual(originalRecord);
    expect(mutableService.currentProject).toBe(project);
  });
});
