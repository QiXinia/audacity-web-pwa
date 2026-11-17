import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { audioDb } from '@/db/audioDb';
import type { AudioBufferRecord } from '@/db/audioDb';
import { audioEngine } from '@/engine/audioEngine';
import { projectService, type MixAndRenderTrackAudio } from '@/services/projectService';
import type { IClip, IProject, ITrack } from '@/types/project';

vi.mock('@/db/audioDb', () => ({
  audioDb: {
    projects: {},
    audioBuffers: { put: vi.fn(), delete: vi.fn() },
    clipboard: {},
    historySnapshots: {},
  },
  serializeTracks: (tracks: unknown) => JSON.stringify(tracks),
  deserializeTracks: (data: string) => JSON.parse(data),
  serializeSelection: (selection: unknown) => selection ? JSON.stringify(selection) : null,
  deserializeSelection: (data: string | null) => data ? JSON.parse(data) : null,
}));

vi.mock('@/engine/audioEngine', () => ({
  audioEngine: { cacheBuffer: vi.fn(), evictBuffer: vi.fn() },
}));

function clip(id: string, startTime: number): IClip {
  return {
    id,
    audioBufferId: `buffer-${id}`,
    startTime,
    offset: 0,
    duration: 0.2,
    originalDuration: 0.2,
    stretchRatio: 1,
    gain: 0,
    fadeIn: 0,
    fadeOut: 0,
    name: id,
  };
}

function track(id: string, name: string, startTime: number): ITrack {
  return {
    id,
    name,
    type: 'audio',
    gain: 0,
    pan: 0,
    muted: false,
    solo: false,
    armed: false,
    color: `${name}-color`,
    clips: [clip(`clip-${id}`, startTime)],
    effects: [],
  };
}

function makeProject(): IProject {
  return {
    id: 'mix-project',
    name: 'Mix integration',
    sampleRate: 10,
    timeSignature: { numerator: 4, denominator: 4 },
    tempo: 120,
    tracks: [
      track('a', 'Voice', 0),
      track('b', 'Music', 0.2),
      track('keep', 'Keep', 0),
    ],
    analysisLabels: [{
      id: 'label-a', kind: 'manual', trackId: 'a', channelIndex: 0,
      start: 0, end: 0.1, text: 'source label',
    }],
    cursorPosition: 0,
    selection: { start: 0, end: 0.4 },
    viewState: { horizontalZoom: 100, verticalZoom: 1, scrollX: 0, viewMode: 'waveform' },
    updatedAt: 100,
    createdAt: 50,
  };
}

function target(trackId: string, values: readonly number[]): MixAndRenderTrackAudio {
  return {
    trackId,
    clips: [{
      clipId: `clip-${trackId}`,
      sourceOffset: 0,
      sampleData: [Float32Array.from(values)],
    }],
  };
}

function setCurrentProject(project: IProject): void {
  (projectService as unknown as { currentProject: IProject }).currentProject = project;
}

function writtenRecord(): AudioBufferRecord {
  return vi.mocked(audioDb.audioBuffers.put).mock.calls[0]![0];
}

describe('ProjectService Mix and Render transactions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setCurrentProject(makeProject());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    (projectService as unknown as { currentProject: IProject | null }).currentProject = null;
  });

  it('replaces only selected tracks, inserts before the following track and commits once', async () => {
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    const result = await projectService.mixAndRenderOnTracks('mix-project', [
      target('a', [1, 1]),
      target('b', [0.5, 0.5]),
    ], false);

    expect(result).toMatchObject({
      trackName: 'Mix', inputTrackCount: 2, channelCount: 1, startTime: 0, endTime: 0.4,
    });
    expect(save).toHaveBeenCalledTimes(1);
    const saved = save.mock.calls[0]![0];
    expect(saved.tracks.map((item) => item.name)).toEqual(['Mix', 'Keep']);
    expect(saved.tracks[0]).toMatchObject({ gain: 0, pan: 0, effects: [] });
    expect(saved.tracks[0]!.clips[0]).toMatchObject({
      startTime: 0, duration: 0.4, originalDuration: 0.4, stretchRatio: 1,
    });
    expect(saved.analysisLabels?.[0]).toMatchObject({ trackId: result.trackId, text: 'source label' });
    expect(saved.analysisLabels?.[0]?.channelIndex).toBeUndefined();
    expect(saved.selection).toEqual({ start: 0, end: 0.4 });
    expect(Array.from(new Float32Array(writtenRecord().channelData[0]))).toEqual([1, 1, 0.5, 0.5]);
    expect(audioEngine.cacheBuffer).toHaveBeenCalledTimes(1);
    expect(audioDb.audioBuffers.delete).not.toHaveBeenCalled();
  });

  it('to New Track preserves inputs, keeps a single input name and inserts after it', async () => {
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    const result = await projectService.mixAndRenderOnTracks('mix-project', [
      target('a', [0.25, 0.75]),
    ], true);

    expect(result).toMatchObject({ trackName: 'Voice', inputTrackCount: 1, channelCount: 1 });
    const saved = save.mock.calls[0]![0];
    expect(saved.tracks.map((item) => item.id)).toEqual(['a', result.trackId, 'b', 'keep']);
    expect(saved.tracks[1]).toMatchObject({ name: 'Voice', color: 'Voice-color', gain: 0, pan: 0 });
    expect(saved.tracks[0]!.clips[0]!.audioBufferId).toBe('buffer-clip-a');
    expect(saved.analysisLabels?.[0]?.trackId).toBe('a');
    expect(Array.from(new Float32Array(writtenRecord().channelData[0]))).toEqual([0.25, 0.75]);
  });

  it('rejects incomplete coverage and invalid PCM without any persistent write', async () => {
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    await expect(projectService.mixAndRenderOnTracks('mix-project', [{
      trackId: 'a', clips: [],
    }], false)).rejects.toThrow(/片段覆盖不完整/);

    await expect(projectService.mixAndRenderOnTracks('mix-project', [
      target('a', [1, Number.NaN]),
    ], false)).rejects.toThrow(/非有限数值/);
    expect(audioDb.audioBuffers.put).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('cleans the staged PCM buffer when the project save fails', async () => {
    vi.spyOn(projectService, 'saveProject').mockRejectedValue(new Error('save failed'));
    await expect(projectService.mixAndRenderOnTracks('mix-project', [
      target('a', [1, 1]),
    ], false)).rejects.toThrow('save failed');
    expect(audioDb.audioBuffers.put).toHaveBeenCalledTimes(1);
    expect(audioDb.audioBuffers.delete).toHaveBeenCalledTimes(1);
    expect(audioEngine.cacheBuffer).not.toHaveBeenCalled();
  });
});
