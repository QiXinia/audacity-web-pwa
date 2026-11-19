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
    pitchCents: 120,
    gain: -3,
    fadeIn: 0.001,
    fadeOut: 0.002,
    name: `name-${id}`,
  };
}

function makeTrack(id: string, clips: IClip[], sampleRate = 1000): ITrack {
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
    sampleFormat: 'float32',
    sampleRate,
  };
}

function makeProject(): IProject {
  return {
    id: 'track-media-project',
    name: 'Track media integration',
    sampleRate: 1000,
    timeSignature: { numerator: 4, denominator: 4 },
    tempo: 120,
    tracks: [
      makeTrack('a', [makeClip('a1', 0), makeClip('a2', 0.1)]),
      makeTrack('b', [makeClip('b', 0.2)]),
      makeTrack('empty', []),
      makeTrack('keep', [makeClip('keep', 0)]),
    ],
    cursorPosition: 0,
    selection: null,
    viewState: { horizontalZoom: 100, verticalZoom: 1, scrollX: 0, viewMode: 'waveform' },
    updatedAt: 100,
    createdAt: 50,
  };
}

function record(id: string, sampleRate: number, channels: readonly number[][]): AudioBufferRecord {
  const length = channels[0]?.length ?? 0;
  return {
    id,
    projectId: 'track-media-project',
    sampleRate,
    channels: channels.length,
    length,
    duration: length / sampleRate,
    channelData: channels.map((channel) => Float32Array.from(channel).buffer),
    createdAt: 1,
  };
}

let records: Map<string, AudioBufferRecord>;

function setCurrentProject(project: IProject): void {
  (projectService as unknown as { currentProject: IProject }).currentProject = project;
}

describe('ProjectService Track Format and Rate transactions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    records = new Map([
      ['buffer-a1', record('buffer-a1', 1000, [[-1, -0.5 / 32768, 0.5 / 32768, 1]])],
      ['buffer-a2', record('buffer-a2', 500, [[0.25, -0.25]])],
      ['buffer-b', record('buffer-b', 2000, [[0.5, 0.5]])],
      ['buffer-keep', record('buffer-keep', 1000, [[0.75]])],
    ]);
    setCurrentProject(makeProject());
    vi.mocked(audioDb.audioBuffers.get as unknown as (
      id: string,
    ) => Promise<AudioBufferRecord | undefined>).mockImplementation(async (id: string) => records.get(id));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    (projectService as unknown as { currentProject: IProject | null }).currentProject = null;
  });

  it('converts selected and empty track formats atomically while preserving clip timing and other tracks', async () => {
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    const result = await projectService.changeTrackFormatOnTracks(
      'track-media-project', ['a', 'empty'], 'int16',
    );
    expect(result).toEqual({ trackCount: 2, clipCount: 2 });
    expect(save).toHaveBeenCalledTimes(1);
    const saved = save.mock.calls[0]![0];
    expect(saved.tracks.map((track) => [track.id, track.sampleFormat])).toEqual([
      ['a', 'int16'], ['b', 'float32'], ['empty', 'int16'], ['keep', 'float32'],
    ]);
    const original = makeProject().tracks[0]!;
    const converted = saved.tracks[0]!;
    converted.clips.forEach((clip, index) => {
      expect(clip.audioBufferId).not.toBe(original.clips[index]!.audioBufferId);
      expect({ ...clip, audioBufferId: original.clips[index]!.audioBufferId })
        .toEqual(original.clips[index]);
    });
    expect(saved.tracks[3]!.clips[0]!.audioBufferId).toBe('buffer-keep');

    const writes = vi.mocked(audioDb.audioBuffers.put).mock.calls.map((call) => call[0]);
    expect(writes).toHaveLength(2);
    expect(writes.map((write) => write.sampleRate)).toEqual([1000, 500]);
    expect(Array.from(new Float32Array(writes[0]!.channelData[0]!))).toEqual([
      -1, 0, 0, 32767 / 32768,
    ]);
    expect(Array.from(new Float32Array(writes[1]!.channelData[0]!))).toEqual([0.25, -0.25]);
    expect(records.get('buffer-a1')!.sampleRate).toBe(1000);
    expect(audioEngine.cacheBuffer).toHaveBeenCalledTimes(2);
  });

  it('rejects missing or non-finite PCM before any format write', async () => {
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    records.set('buffer-a2', record('buffer-a2', 500, [[Number.NaN]]));
    await expect(projectService.changeTrackFormatOnTracks('track-media-project', ['a'], 'int24'))
      .rejects.toThrow(/有限/);
    records.delete('buffer-a2');
    await expect(projectService.changeTrackFormatOnTracks('track-media-project', ['a'], 'int24'))
      .rejects.toThrow(/无法读取片段/);
    expect(audioDb.audioBuffers.put).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('cleans all staged format buffers if the project save fails', async () => {
    vi.spyOn(projectService, 'saveProject').mockRejectedValue(new Error('format save failed'));
    await expect(projectService.changeTrackFormatOnTracks('track-media-project', ['a'], 'int16'))
      .rejects.toThrow('format save failed');
    expect(audioDb.audioBuffers.put).toHaveBeenCalledTimes(2);
    expect(audioDb.audioBuffers.delete).toHaveBeenCalledTimes(2);
    expect(audioEngine.evictBuffer).toHaveBeenCalledTimes(2);
    expect(audioEngine.cacheBuffer).not.toHaveBeenCalled();
  });

  it('changes rate without resampling PCM and scales every changed clip independently', async () => {
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    const result = await projectService.changeTrackRateOnTracks('track-media-project', ['a'], 2000);
    expect(result).toEqual({ trackCount: 1, clipCount: 2 });
    const saved = save.mock.calls[0]![0];
    expect(saved.tracks[0]!.sampleRate).toBe(2000);
    expect(saved.tracks[0]!.clips[0]).toMatchObject({
      startTime: 0, offset: 0.005, duration: 0.01, originalDuration: 0.02,
      stretchRatio: 2, pitchCents: 120, fadeIn: 0.0005, fadeOut: 0.001,
    });
    expect(saved.tracks[0]!.clips[1]).toMatchObject({
      startTime: 0.025, offset: 0.0025, duration: 0.005, originalDuration: 0.01,
      stretchRatio: 2, pitchCents: 120, fadeIn: 0.00025, fadeOut: 0.0005,
    });
    expect(saved.tracks[1]!.sampleRate).toBe(1000);
    expect(saved.tracks[3]!.clips[0]!.audioBufferId).toBe('buffer-keep');

    const writes = vi.mocked(audioDb.audioBuffers.put).mock.calls.map((call) => call[0]);
    expect(writes).toHaveLength(2);
    expect(writes.every((write) => write.sampleRate === 2000)).toBe(true);
    expect(Array.from(new Float32Array(writes[0]!.channelData[0]!))).toEqual(
      Array.from(new Float32Array(records.get('buffer-a1')!.channelData[0]!)),
    );
    expect(Array.from(new Float32Array(writes[1]!.channelData[0]!))).toEqual([0.25, -0.25]);
    expect(records.get('buffer-a2')!.sampleRate).toBe(500);
  });

  it('keeps clips already at the target rate and updates empty-track rate with a no-op boundary', async () => {
    const project = makeProject();
    project.tracks[0]!.sampleRate = 1000;
    setCurrentProject(project);
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    const mixed = await projectService.changeTrackRateOnTracks('track-media-project', ['a'], 1000);
    expect(mixed).toEqual({ trackCount: 1, clipCount: 1 });
    const savedMixed = save.mock.calls[0]![0];
    expect(savedMixed.tracks[0]!.clips[0]!.audioBufferId).toBe('buffer-a1');
    expect(savedMixed.tracks[0]!.clips[1]!.audioBufferId).not.toBe('buffer-a2');

    save.mockClear();
    const empty = await projectService.changeTrackRateOnTracks('track-media-project', ['empty'], 2000);
    expect(empty).toEqual({ trackCount: 1, clipCount: 0 });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]![0].tracks[2]!.sampleRate).toBe(2000);
    expect(audioDb.audioBuffers.put).toHaveBeenCalledTimes(1);

    setCurrentProject(save.mock.calls[0]![0]);
    save.mockClear();
    vi.mocked(audioDb.audioBuffers.put).mockClear();
    await expect(projectService.changeTrackRateOnTracks('track-media-project', ['empty'], 2000))
      .resolves.toEqual({ trackCount: 0, clipCount: 0 });
    expect(save).not.toHaveBeenCalled();
    expect(audioDb.audioBuffers.put).not.toHaveBeenCalled();
  });

  it('keeps an established integer sample format when resampling output PCM', async () => {
    const project = makeProject();
    project.tracks = [{ ...project.tracks[0]!, clips: [project.tracks[0]!.clips[0]!], sampleFormat: 'int16' }];
    setCurrentProject(project);
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    await projectService.resampleTracksOnTracks('track-media-project', ['a'], 2000);
    expect(save.mock.calls[0]![0].tracks[0]!.sampleFormat).toBe('int16');
    const writes = vi.mocked(audioDb.audioBuffers.put).mock.calls.map((call) => call[0]);
    expect(writes).toHaveLength(1);
    for (const sample of new Float32Array(writes[0]!.channelData[0]!)) {
      expect(Math.abs(sample * 32768 - Math.round(sample * 32768))).toBeLessThan(0.001);
      expect(sample).toBeLessThanOrEqual(32767 / 32768);
    }
  });

  it('rejects duplicate targets and a later missing rate source before any write', async () => {
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    await expect(projectService.changeTrackRateOnTracks('track-media-project', ['a', 'a'], 2000))
      .rejects.toThrow(/重复指定/);
    records.delete('buffer-a2');
    await expect(projectService.changeTrackRateOnTracks('track-media-project', ['a'], 2000))
      .rejects.toThrow(/无法读取片段/);
    expect(audioDb.audioBuffers.put).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });
});
