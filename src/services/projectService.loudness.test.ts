import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { audioDb, type AudioBufferRecord } from '@/db/audioDb';
import { audioEngine } from '@/engine/audioEngine';
import { DEFAULT_LOUDNESS_SETTINGS, type LoudnessSettings } from '@/lib/loudnessEffect';
import type { IClip, IProject, ITrack } from '@/types/project';
import { projectService, type LoudnessTrackAudio } from './projectService';

vi.mock('@/db/audioDb', () => ({
  audioDb: {
    projects: {}, audioBuffers: { put: vi.fn(), delete: vi.fn() }, clipboard: {}, historySnapshots: {},
  },
  serializeTracks: (tracks: unknown) => JSON.stringify(tracks),
  deserializeTracks: (data: string) => JSON.parse(data),
  serializeSelection: (selection: unknown) => selection ? JSON.stringify(selection) : null,
  deserializeSelection: (data: string | null) => data ? JSON.parse(data) : null,
}));

vi.mock('@/engine/audioEngine', () => ({
  audioEngine: { cacheBuffer: vi.fn(), evictBuffer: vi.fn() },
}));

const rmsSettings: LoudnessSettings = {
  ...DEFAULT_LOUDNESS_SETTINGS, algorithm: 'rms', rmsLevel: -20, dualMono: false,
};

function clip(id: string, duration = 0.00125): IClip {
  return {
    id, audioBufferId: `buffer-${id}`, startTime: 0, duration, originalDuration: duration,
    stretchRatio: 1, offset: 0, gain: 0, fadeIn: 0, fadeOut: 0, name: id,
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
    id: 'project-loudness', name: 'Loudness transaction',
    tracks: [track('track-a', [clip('a')]), track('track-b', [clip('b')])],
    cursorPosition: 0, selection: { start: 0, end: 0.00125 },
    viewState: { horizontalZoom: 100, verticalZoom: 1, scrollX: 0, viewMode: 'waveform' },
    createdAt: 50, updatedAt: 100, sampleRate: 8000,
    timeSignature: { numerator: 4, denominator: 4 }, tempo: 120,
  };
}

const source = () => Float32Array.from([0, 0.1, -0.2, 0.25, 0.5, -0.25, 0.125, -0.05, 0.2, -0.1]);

function target(trackId: string, clipId: string, channels: Float32Array[] = [source()]): LoudnessTrackAudio {
  return { trackId, clips: [{ clipId, sourceOffset: 0, sampleData: channels }] };
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

describe('ProjectService Loudness transactions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setCurrentProject(makeProject());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    (projectService as unknown as { currentProject: IProject | null }).currentProject = null;
  });

  it('analyses all targets first, preserves unselected samples and commits once', async () => {
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    const leftInput = source();
    const stereo = [source(), Float32Array.from(source(), (sample) => sample * 0.5)];
    const changed = await projectService.loudnessSelectionOnTracks(
      'project-loudness', { start: 0.00025, end: 0.001 }, rmsSettings,
      [target('track-a', 'a', [leftInput]), target('track-b', 'b', stereo)],
    );
    expect(changed).toBe(2);
    expect(save).toHaveBeenCalledTimes(1);
    const records = writes();
    expect(records).toHaveLength(2);
    for (const record of records) {
      expect(pcm(record).slice(0, 2)).toEqual(leftInput.slice(0, 2));
      expect(pcm(record).slice(8)).toEqual(leftInput.slice(8));
    }
    const monoRms = Math.sqrt(pcm(records[0]).slice(2, 8).reduce((sum, sample) => sum + sample * sample, 0) / 6);
    expect(20 * Math.log10(monoRms)).toBeCloseTo(-20, 5);
    const stereoLeftRms = Math.sqrt(pcm(records[1], 0).slice(2, 8).reduce((sum, sample) => sum + sample * sample, 0) / 6);
    const stereoRightRms = Math.sqrt(pcm(records[1], 1).slice(2, 8).reduce((sum, sample) => sum + sample * sample, 0) / 6);
    expect(20 * Math.log10(Math.sqrt((stereoLeftRms ** 2 + stereoRightRms ** 2) / 2))).toBeCloseTo(-20, 5);
    expect(pcm(records[1], 1)[4] / stereo[1][4]).toBeCloseTo(pcm(records[1], 0)[4] / leftInput[4], 6);
    expect(leftInput).toEqual(source());
    expect(stereo[1][4]).toBe(0.25);
    expect(save.mock.calls[0][0].tracks[0].clips[0].audioBufferId).not.toBe('buffer-a');
    expect(audioEngine.cacheBuffer).toHaveBeenCalledTimes(2);
  });

  it('shares one RMS gain across clips and keeps the inter-clip gap out of audio writes', async () => {
    const project = makeProject();
    project.tracks = [track('track-a', [
      { ...clip('a', 0.000625) },
      { ...clip('a2', 0.00125), startTime: 0.00125, duration: 0.000625, originalDuration: 0.000625 },
    ])];
    setCurrentProject(project);
    vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    const inputs: LoudnessTrackAudio[] = [{
      trackId: 'track-a', clips: [
        { clipId: 'a', sourceOffset: 0, sampleData: [Float32Array.from([0.1, 0.2, 0.1, -0.1, 0.2])] },
        { clipId: 'a2', sourceOffset: 0, sampleData: [Float32Array.from([0.4, -0.2, 0.2, 0.1, -0.1])] },
      ],
    }];
    await projectService.loudnessSelectionOnTracks(
      project.id, { start: 0, end: 0.001875 }, rmsSettings, inputs,
    );
    const records = writes();
    expect(records).toHaveLength(2);
    const gain = pcm(records[0])[0] / 0.1;
    expect(pcm(records[1])[0] / 0.4).toBeCloseTo(gain, 6);
    expect(inputs[0].clips[0].sampleData[0]).toEqual(Float32Array.from([0.1, 0.2, 0.1, -0.1, 0.2]));
  });

  it('rejects a silent later track without writing the valid earlier track', async () => {
    const project = makeProject();
    project.tracks = [track('track-a', [clip('a', 1)]), track('track-b', [clip('b', 1)])];
    setCurrentProject(project);
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    await expect(projectService.loudnessSelectionOnTracks(
      project.id, { start: 0, end: 1 }, DEFAULT_LOUDNESS_SETTINGS,
      [target('track-a', 'a', [new Float32Array(8000).fill(0.1)]),
       target('track-b', 'b', [new Float32Array(8000)])],
    )).rejects.toThrow('静音');
    expect(audioDb.audioBuffers.put).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(audioDb.audioBuffers.delete).not.toHaveBeenCalled();
  });

  it('rejects incomplete or duplicate track ownership before any write', async () => {
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    await expect(projectService.loudnessSelectionOnTracks(
      'project-loudness', { start: 0, end: 0.00125 }, rmsSettings,
      [{ trackId: 'track-a', clips: [] }],
    )).rejects.toThrow('完整轨道');
    await expect(projectService.loudnessSelectionOnTracks(
      'project-loudness', { start: 0, end: 0.00125 }, rmsSettings,
      [target('track-a', 'a'), target('track-a', 'a')],
    )).rejects.toThrow('重复轨道');
    expect(audioDb.audioBuffers.put).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('cleans every staged buffer when a later audio write fails', async () => {
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    vi.mocked(audioDb.audioBuffers.put)
      .mockResolvedValueOnce('first-write')
      .mockRejectedValueOnce(new Error('quota exceeded'));
    await expect(projectService.loudnessSelectionOnTracks(
      'project-loudness', { start: 0, end: 0.00125 }, rmsSettings,
      [target('track-a', 'a'), target('track-b', 'b')],
    )).rejects.toThrow('quota exceeded');
    const ids = writes().map((record) => record.id);
    expect(audioDb.audioBuffers.delete).toHaveBeenCalledTimes(2);
    expect(vi.mocked(audioDb.audioBuffers.delete).mock.calls.map(([id]) => id)).toEqual(ids);
    expect(audioEngine.evictBuffer).toHaveBeenCalledTimes(2);
    expect(save).not.toHaveBeenCalled();
  });

  it('cleans every staged buffer when the single project commit fails', async () => {
    vi.spyOn(projectService, 'saveProject').mockRejectedValueOnce(new Error('database locked'));
    await expect(projectService.loudnessSelectionOnTracks(
      'project-loudness', { start: 0, end: 0.00125 }, rmsSettings,
      [target('track-a', 'a'), target('track-b', 'b')],
    )).rejects.toThrow('database locked');
    expect(audioDb.audioBuffers.delete).toHaveBeenCalledTimes(2);
    expect(audioEngine.evictBuffer).toHaveBeenCalledTimes(2);
    expect(audioEngine.cacheBuffer).not.toHaveBeenCalled();
  });
});
