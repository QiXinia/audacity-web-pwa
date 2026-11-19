import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { audioDb, type AudioBufferRecord } from '@/db/audioDb';
import { audioEngine } from '@/engine/audioEngine';
import { projectService } from '@/services/projectService';
import type { IClip, IProject, ITrack } from '@/types/project';

vi.mock('@/db/audioDb', () => ({
  audioDb: {
    projects: {},
    audioBuffers: { get: vi.fn(), put: vi.fn(), delete: vi.fn() },
    clipboard: {},
    historySnapshots: {},
  },
  serializeTracks: (tracks: unknown) => JSON.stringify(tracks),
  deserializeTracks: (data: string) => JSON.parse(data),
  serializeSelection: (selection: unknown) => selection ? JSON.stringify(selection) : null,
  deserializeSelection: (data: string | null) => data ? JSON.parse(data) : null,
}));

vi.mock('@/engine/audioEngine', () => ({
  audioEngine: { cacheBuffer: vi.fn(), evictBuffer: vi.fn(), getCachedBuffer: vi.fn(() => null) },
}));

function makeClip(id: string, startTime: number): IClip {
  return {
    id,
    audioBufferId: `buffer-${id}`,
    startTime,
    offset: 0.01,
    duration: 0.02,
    originalDuration: 0.04,
    stretchRatio: 2,
    gain: -3,
    fadeIn: 0.001,
    fadeOut: 0.002,
    name: `name-${id}`,
  };
}

function makeTrack(id: string, clips: IClip[]): ITrack {
  return {
    id,
    name: `Track ${id}`,
    type: 'audio',
    gain: -1,
    pan: 0.25,
    muted: false,
    solo: false,
    armed: false,
    color: `${id}-color`,
    clips,
    effects: [],
  };
}

const clipA1 = makeClip('a1', 0);
const clipA2 = makeClip('a2', 0.1);
const clipB = makeClip('b', 0.2);
const clipKeep = makeClip('keep', 0);

function makeProject(): IProject {
  return {
    id: 'resample-project',
    name: 'Resample integration',
    sampleRate: 1000,
    timeSignature: { numerator: 4, denominator: 4 },
    tempo: 120,
    tracks: [
      makeTrack('a', [clipA1, clipA2]),
      makeTrack('b', [clipB]),
      makeTrack('keep', [clipKeep]),
    ],
    cursorPosition: 0,
    selection: { start: 0, end: 0.2 },
    viewState: { horizontalZoom: 100, verticalZoom: 1, scrollX: 0, viewMode: 'waveform' },
    updatedAt: 100,
    createdAt: 50,
  };
}

function record(id: string, sampleRate: number, channels: readonly number[][]): AudioBufferRecord {
  const length = channels[0]?.length ?? 0;
  return {
    id,
    projectId: 'resample-project',
    sampleRate,
    channels: channels.length,
    length,
    duration: length / sampleRate,
    channelData: channels.map((channel) => Float32Array.from(channel).buffer),
    createdAt: 1,
  };
}

const records = new Map<string, AudioBufferRecord>([
  ['buffer-a1', record('buffer-a1', 1000, [[0.5, 0.5, 0.5, 0.5]])],
  ['buffer-a2', record('buffer-a2', 500, [[-0.25, -0.25]])],
  ['buffer-b', record('buffer-b', 2000, [[1.6, 1.6, 1.6, 1.6]])],
  ['buffer-keep', record('buffer-keep', 1000, [[0.75, 0.75]])],
]);

function setCurrentProject(project: IProject): void {
  (projectService as unknown as { currentProject: IProject }).currentProject = project;
}

describe('ProjectService Resample transactions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    records.set('buffer-a1', record('buffer-a1', 1000, [[0.5, 0.5, 0.5, 0.5]]));
    records.set('buffer-a2', record('buffer-a2', 500, [[-0.25, -0.25]]));
    setCurrentProject(makeProject());
    vi.mocked(audioDb.audioBuffers.get as unknown as (
      id: string,
    ) => Promise<AudioBufferRecord | undefined>).mockImplementation(async (id: string) => records.get(id));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    (projectService as unknown as { currentProject: IProject | null }).currentProject = null;
  });

  it('resamples every selected source clip once and preserves project and clip metadata', async () => {
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    const result = await projectService.resampleTracksOnTracks('resample-project', ['b', 'a'], 2000);

    expect(result).toEqual({ trackCount: 2, clipCount: 3, outputSampleCount: 20, sampleRate: 2000 });
    expect(save).toHaveBeenCalledTimes(1);
    const saved = save.mock.calls[0]![0];
    expect(saved.sampleRate).toBe(1000);
    expect(saved.tracks.map((track) => track.id)).toEqual(['a', 'b', 'keep']);
    expect(saved.tracks[2]).toMatchObject({ name: 'Track keep', gain: -1, pan: 0.25 });
    expect(saved.tracks[0]).toMatchObject({ gain: -1, pan: 0.25, color: 'a-color' });
    expect(saved.tracks[0]!.clips[0]).toMatchObject({
      id: 'a1', startTime: 0, offset: 0.01, duration: 0.02, originalDuration: 0.04,
      stretchRatio: 2, gain: -3, fadeIn: 0.001, fadeOut: 0.002, name: 'name-a1',
    });
    expect(saved.tracks[0]!.clips[0]!.audioBufferId).not.toBe('buffer-a1');
    expect(saved.tracks[2]!.clips[0]!.audioBufferId).toBe('buffer-keep');
    expect(audioDb.audioBuffers.get).toHaveBeenCalledTimes(3);
    expect(audioDb.audioBuffers.get).not.toHaveBeenCalledWith('buffer-keep');

    const writes = vi.mocked(audioDb.audioBuffers.put).mock.calls.map((call) => call[0]);
    expect(writes).toHaveLength(3);
    expect(writes.map((write) => write.sampleRate)).toEqual([2000, 2000, 2000]);
    expect(writes.map((write) => write.length)).toEqual([8, 8, 4]);
    expect(Array.from(new Float32Array(writes[0]!.channelData[0]!))).toEqual(new Array(8).fill(0.5));
    expect(Array.from(new Float32Array(writes[1]!.channelData[0]!))).toEqual(new Array(8).fill(-0.25));
    expect(Array.from(new Float32Array(writes[2]!.channelData[0]!))).toEqual(new Array(4).fill(Math.fround(1.6)));
    expect(audioEngine.cacheBuffer).toHaveBeenCalledTimes(3);
  });

  it('updates an empty track rate without a phantom PCM write', async () => {
    const project = makeProject();
    project.tracks = [makeTrack('empty', [])];
    setCurrentProject(project);
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();

    await expect(projectService.resampleTracksOnTracks('resample-project', ['empty'], 22050))
      .resolves.toEqual({ trackCount: 1, clipCount: 0, outputSampleCount: 0, sampleRate: 22050 });
    expect(audioDb.audioBuffers.put).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]![0].tracks[0]!.sampleRate).toBe(22050);
  });

  it('rejects invalid rates, duplicate targets, missing PCM and non-finite PCM before writes', async () => {
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    await expect(projectService.resampleTracksOnTracks('resample-project', ['a'], 0))
      .rejects.toThrow(/1 至 1000000/);
    await expect(projectService.resampleTracksOnTracks('resample-project', ['a', 'a'], 2000))
      .rejects.toThrow(/重复指定/);
    records.delete('buffer-a2');
    await expect(projectService.resampleTracksOnTracks('resample-project', ['a'], 2000))
      .rejects.toThrow(/无法读取片段/);
    records.set('buffer-a2', record('buffer-a2', 500, [[0, Number.NaN]]));
    await expect(projectService.resampleTracksOnTracks('resample-project', ['a'], 2000))
      .rejects.toThrow(/非有限数值/);
    expect(audioDb.audioBuffers.put).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('converts source-rate PCM to the requested timeline rate without changing the cached raw PCM', async () => {
    const projected = await projectService.loadAudioChannels('buffer-a2', 1000);
    expect(projected).toHaveLength(1);
    expect(projected?.[0]).toHaveLength(4);
    expect(Array.from(projected?.[0] ?? [])).toEqual(new Array(4).fill(-0.25));
    expect(audioEngine.cacheBuffer).toHaveBeenCalledTimes(1);
    const cached = vi.mocked(audioEngine.cacheBuffer).mock.calls[0]!;
    expect(cached[0]).toBe('buffer-a2');
    expect(cached[1][0]).toHaveLength(2);
    expect(cached[2]).toBe(500);

    const raw = await projectService.loadAudioChannels('buffer-a2');
    expect(raw?.[0]).toHaveLength(2);
  });

  it('cleans every staged resampled buffer when the project save fails', async () => {
    vi.spyOn(projectService, 'saveProject').mockRejectedValue(new Error('save failed'));
    await expect(projectService.resampleTracksOnTracks('resample-project', ['a'], 2000))
      .rejects.toThrow('save failed');
    expect(audioDb.audioBuffers.put).toHaveBeenCalledTimes(2);
    expect(audioDb.audioBuffers.delete).toHaveBeenCalledTimes(2);
    expect(audioEngine.evictBuffer).toHaveBeenCalledTimes(2);
    expect(audioEngine.cacheBuffer).not.toHaveBeenCalled();
  });
});
