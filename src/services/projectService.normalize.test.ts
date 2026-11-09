import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { audioDb } from '@/db/audioDb';
import type { AudioBufferRecord } from '@/db/audioDb';
import { audioEngine } from '@/engine/audioEngine';
import { DEFAULT_NORMALIZE_SETTINGS, type NormalizeSettings } from '@/lib/normalizeEffect';
import type { IClip, IProject, ITrack } from '@/types/project';
import { projectService, type NormalizeTrackAudio } from './projectService';

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

const settings: NormalizeSettings = {
  ...DEFAULT_NORMALIZE_SETTINGS,
  removeDc: false,
  peakDb: 0,
};

function clip(id: string, startTime = 0): IClip {
  return {
    id,
    audioBufferId: `buffer-${id}`,
    startTime,
    duration: 0.01,
    originalDuration: 0.01,
    stretchRatio: 1,
    offset: 0,
    gain: 0,
    fadeIn: 0,
    fadeOut: 0,
    name: id,
  };
}

function track(id: string, clips: IClip[]): ITrack {
  return {
    id, name: id, type: 'audio', gain: 0, pan: 0, muted: false, solo: false,
    armed: false, color: '', clips, effects: [],
  };
}

function makeProject(): IProject {
  return {
    id: 'project-normalize',
    name: 'Normalize transaction',
    tracks: [track('track-a', [clip('a')]), track('track-b', [clip('b')])],
    cursorPosition: 0,
    selection: { start: 0, end: 0.01 },
    viewState: { horizontalZoom: 100, verticalZoom: 1, scrollX: 0, viewMode: 'waveform' },
    createdAt: 50,
    updatedAt: 100,
    sampleRate: 1000,
    timeSignature: { numerator: 4, denominator: 4 },
    tempo: 120,
  };
}

function target(trackId: string, clipId: string, channels = 1): NormalizeTrackAudio {
  return {
    trackId,
    clips: [{
      clipId,
      sourceOffset: 0,
      sampleData: Array.from({ length: channels }, () => Float32Array.from([
        0, 0.1, -0.2, 0.25, 0.5, -0.25, 0.125, -0.05, 0, 0,
      ])),
    }],
  };
}

function setCurrentProject(project: IProject) {
  (projectService as unknown as { currentProject: IProject }).currentProject = project;
}

function writes(): AudioBufferRecord[] {
  return vi.mocked(audioDb.audioBuffers.put).mock.calls.map(([record]) => record);
}

function pcm(record: AudioBufferRecord, channel = 0): Float32Array {
  return new Float32Array(record.channelData[channel]);
}

describe('ProjectService Normalize transactions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setCurrentProject(makeProject());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    (projectService as unknown as { currentProject: IProject | null }).currentProject = null;
  });

  it('analyses each whole track, processes only selected samples, and commits once', async () => {
    const project = makeProject();
    setCurrentProject(project);
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    const inputs = [target('track-a', 'a'), target('track-b', 'b', 2)];
    const changed = await projectService.normalizeSelectionOnTracks(
      project.id, { start: 0.002, end: 0.008 }, settings, inputs,
    );

    expect(changed).toBe(2);
    expect(save).toHaveBeenCalledTimes(1);
    expect(audioDb.audioBuffers.put).toHaveBeenCalledTimes(2);
    const records = writes();
    const expected = Float32Array.from([0, 0.1, -0.4, 0.5, 1, -0.5, 0.25, -0.1, 0, 0]);
    for (const record of records) {
      expect(pcm(record)).toEqual(expected);
      expect(pcm(record, 0).slice(0, 2)).toEqual(inputs[0].clips[0].sampleData[0].slice(0, 2));
      expect(pcm(record, 0).slice(8)).toEqual(inputs[0].clips[0].sampleData[0].slice(8));
    }
    // Stereo shares the same gain, rather than reaching 0 dB independently.
    expect(pcm(records[1], 1)).toEqual(expected);
    expect(inputs[0].clips[0].sampleData[0][4]).toBe(0.5);
    const saved = save.mock.calls[0][0];
    expect(saved.tracks[0].clips[0].audioBufferId).not.toBe('buffer-a');
    expect(saved.tracks[1].clips[0].audioBufferId).not.toBe('buffer-b');
    expect(project.tracks[0].clips[0].audioBufferId).toBe('buffer-a');
    expect(audioEngine.cacheBuffer).toHaveBeenCalledTimes(2);
  });

  it('shares one cross-clip plan and preserves trim and stretch metadata', async () => {
    const project = makeProject();
    project.tracks = [track('track-a', [
      { ...clip('a'), duration: 0.005, originalDuration: 0.005 },
      { ...clip('a2', 0.005), duration: 0.005, originalDuration: 0.005, stretchRatio: 2, offset: 0.0025 },
    ])];
    setCurrentProject(project);
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    await projectService.normalizeSelectionOnTracks(
      project.id, { start: 0, end: 0.01 }, settings,
      [{
        trackId: 'track-a',
        clips: [
          {
            clipId: 'a', sourceOffset: 0,
            sampleData: [Float32Array.from([0.1, 0.2, 0, 0, 0])],
          },
          {
            clipId: 'a2', sourceOffset: 0,
            sampleData: [Float32Array.from([0.4, -0.2, 0, 0, 0])],
          },
        ],
      }],
    );

    const records = writes();
    expect(pcm(records[0])).toEqual(Float32Array.from([0.25, 0.5, 0, 0, 0]));
    expect(pcm(records[1])).toEqual(Float32Array.from([1, -0.5, 0, 0, 0]));
    expect(save.mock.calls[0][0].tracks[0].clips[1]).toMatchObject({
      stretchRatio: 2,
      offset: 0.0025,
      originalDuration: 0.005,
      startTime: 0.005,
    });
  });

  it('supports DC-only processing and independent stereo gains', async () => {
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    const source = [Float32Array.from([0.25, 0.75]), Float32Array.from([0.5, 1])];
    await projectService.normalizeSelectionOnTracks(
      'project-normalize', { start: 0, end: 0.002 },
      { removeDc: true, normalizePeak: true, peakDb: 0, stereoIndependent: true },
      [{ trackId: 'track-a', clips: [{ clipId: 'a', sourceOffset: 0, sampleData: source }] }],
    );
    const record = writes()[0];
    expect(pcm(record, 0)[0]).toBeCloseTo(-1, 6);
    expect(pcm(record, 0)[1]).toBeCloseTo(1, 6);
    expect(pcm(record, 1)[0]).toBeCloseTo(-1, 6);
    expect(pcm(record, 1)[1]).toBeCloseTo(1, 6);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('skips the disabled effect without writing audio or history', async () => {
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    await expect(projectService.normalizeSelectionOnTracks(
      'project-normalize', { start: 0, end: 0.01 },
      { ...settings, removeDc: false, normalizePeak: false },
      [target('track-a', 'missing')],
    )).resolves.toBe(0);
    expect(audioDb.audioBuffers.put).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('performs no writes when any target is invalid', async () => {
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    await expect(projectService.normalizeSelectionOnTracks(
      'project-normalize', { start: 0, end: 0.01 }, settings,
      [target('track-a', 'a'), target('track-b', 'missing')],
    )).rejects.toThrow('目标片段不可用');
    expect(audioDb.audioBuffers.put).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(audioDb.audioBuffers.delete).not.toHaveBeenCalled();
  });

  it('deletes every staged buffer when a later audio write fails', async () => {
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    vi.mocked(audioDb.audioBuffers.put)
      .mockResolvedValueOnce('first-write')
      .mockRejectedValueOnce(new Error('quota exceeded'));
    await expect(projectService.normalizeSelectionOnTracks(
      'project-normalize', { start: 0, end: 0.01 }, settings,
      [target('track-a', 'a'), target('track-b', 'b')],
    )).rejects.toThrow('quota exceeded');
    const ids = writes().map((record) => record.id);
    expect(audioDb.audioBuffers.delete).toHaveBeenCalledTimes(2);
    expect(vi.mocked(audioDb.audioBuffers.delete).mock.calls.map(([id]) => id)).toEqual(ids);
    expect(audioEngine.evictBuffer).toHaveBeenCalledTimes(2);
    expect(save).not.toHaveBeenCalled();
  });

  it('deletes every staged buffer when the single project commit fails', async () => {
    vi.spyOn(projectService, 'saveProject').mockRejectedValueOnce(new Error('database locked'));
    await expect(projectService.normalizeSelectionOnTracks(
      'project-normalize', { start: 0, end: 0.01 }, settings,
      [target('track-a', 'a'), target('track-b', 'b')],
    )).rejects.toThrow('database locked');
    expect(audioDb.audioBuffers.delete).toHaveBeenCalledTimes(2);
    expect(audioEngine.evictBuffer).toHaveBeenCalledTimes(2);
    expect(audioEngine.cacheBuffer).not.toHaveBeenCalled();
  });
});
