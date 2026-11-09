import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { audioDb } from '@/db/audioDb';
import type { AudioBufferRecord } from '@/db/audioDb';
import { audioEngine } from '@/engine/audioEngine';
import type { IClip, IProject, ITrack } from '@/types/project';
import { processWahWahChannels, type WahWahSettings } from '@/lib/wahWahEffect';
import { projectService, type WahWahTrackAudio } from './projectService';

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

const settings: WahWahSettings = {
  frequencyHz: 1,
  phaseDegrees: 0,
  depthPercent: 50,
  resonance: 2,
  frequencyOffsetPercent: 20,
  outputGainDb: 0,
};

function clip(id: string, startTime: number, duration: number): IClip {
  return {
    id,
    audioBufferId: `buffer-${id}`,
    startTime,
    duration,
    originalDuration: duration,
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
    id: 'project-wah-wah',
    name: 'Wah Wah transaction',
    tracks: [track('track-a', [clip('a', 0, 1)]), track('track-b', [clip('b', 0, 1)])],
    cursorPosition: 0,
    selection: { start: 0, end: 1 },
    viewState: { horizontalZoom: 100, verticalZoom: 1, scrollX: 0, viewMode: 'waveform' },
    createdAt: 50,
    updatedAt: 100,
    sampleRate: 10,
    timeSignature: { numerator: 4, denominator: 4 },
    tempo: 120,
  };
}

function target(trackId: string, clipId: string, channels = 1): WahWahTrackAudio {
  return {
    trackId,
    clips: [{
      clipId,
      sourceOffset: 0,
      sampleData: Array.from({ length: channels }, () => new Float32Array(10).fill(1)),
    }],
  };
}

function setCurrentProject(project: IProject) {
  (projectService as unknown as { currentProject: IProject }).currentProject = project;
}

function writes(): AudioBufferRecord[] {
  return vi.mocked(audioDb.audioBuffers.put).mock.calls.map(([record]) => record);
}

function pcm(record: AudioBufferRecord, channel = 0): number[] {
  return Array.from(new Float32Array(record.channelData[channel]));
}

describe('ProjectService Wah Wah transactions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setCurrentProject(makeProject());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    (projectService as unknown as { currentProject: IProject | null }).currentProject = null;
  });

  it('filters only selected samples on both tracks and commits once', async () => {
    const project = makeProject();
    setCurrentProject(project);
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    const inputs = [target('track-a', 'a'), target('track-b', 'b', 2)];
    const changed = await projectService.wahWahSelectionOnTracks(
      project.id, { start: 0.2, end: 0.8 }, settings, inputs,
    );

    expect(changed).toBe(2);
    expect(save).toHaveBeenCalledTimes(1);
    expect(audioDb.audioBuffers.put).toHaveBeenCalledTimes(2);
    const records = writes();
    const expected = processWahWahChannels([new Float32Array(6).fill(1)], settings, 10)[0];
    for (const [record, channel] of [[records[0], 0], [records[1], 0], [records[1], 1]] as const) {
      const actual = pcm(record, channel);
      expect(actual.slice(0, 2)).toEqual([1, 1]);
      expect(actual.slice(2, 8)).toEqual(Array.from(expected));
      expect(actual.slice(8)).toEqual([1, 1]);
    }
    expect(inputs.every((input) => input.clips[0].sampleData.every((channel) => (
      Array.from(channel).every((value) => value === 1)
    )))).toBe(true);
    const saved = save.mock.calls[0][0];
    expect(saved.tracks[0].clips[0].audioBufferId).not.toBe('buffer-a');
    expect(saved.tracks[1].clips[0].audioBufferId).not.toBe('buffer-b');
    expect(project.tracks[0].clips[0].audioBufferId).toBe('buffer-a');
    expect(audioEngine.cacheBuffer).toHaveBeenCalledTimes(2);
  });

  it('maps source offsets while preserving clip timing and stretch metadata', async () => {
    const project = makeProject();
    project.tracks = [track('track-a', [{
      ...clip('a', 0, 1), stretchRatio: 2, offset: 0.25, originalDuration: 0.5,
    }])];
    setCurrentProject(project);
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    await projectService.wahWahSelectionOnTracks(
      project.id,
      { start: 0, end: 0.5 },
      settings,
      [{
        trackId: 'track-a',
        clips: [{ clipId: 'a', sourceOffset: 0.5, sampleData: [new Float32Array(20).fill(1)] }],
      }],
    );

    const actual = pcm(writes()[0]);
    expect(actual.slice(0, 5)).toEqual([1, 1, 1, 1, 1]);
    expect(actual.slice(5, 10)).not.toEqual([1, 1, 1, 1, 1]);
    expect(actual.slice(10)).toEqual(new Array(10).fill(1));
    expect(save.mock.calls[0][0].tracks[0].clips[0]).toMatchObject({
      duration: 1,
      offset: 0.25,
      originalDuration: 0.5,
      stretchRatio: 2,
    });
  });

  it('performs no writes when any target is invalid', async () => {
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    await expect(projectService.wahWahSelectionOnTracks(
      'project-wah-wah', { start: 0, end: 1 }, settings,
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
    await expect(projectService.wahWahSelectionOnTracks(
      'project-wah-wah', { start: 0, end: 1 }, settings,
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
    await expect(projectService.wahWahSelectionOnTracks(
      'project-wah-wah', { start: 0, end: 1 }, settings,
      [target('track-a', 'a'), target('track-b', 'b')],
    )).rejects.toThrow('database locked');

    expect(audioDb.audioBuffers.delete).toHaveBeenCalledTimes(2);
    expect(audioEngine.evictBuffer).toHaveBeenCalledTimes(2);
    expect(audioEngine.cacheBuffer).not.toHaveBeenCalled();
  });
});
