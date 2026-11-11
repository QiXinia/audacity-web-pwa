import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { audioDb, type AudioBufferRecord } from '@/db/audioDb';
import { audioEngine } from '@/engine/audioEngine';
import type { IClip, IProject, ITrack } from '@/types/project';
import {
  createDistortionState,
  DEFAULT_DISTORTION_SETTINGS,
  processDistortionChannels,
  processDistortionSelection,
  type DistortionSettings,
} from '@/lib/distortionEffect';
import { projectService, type DistortionTrackAudio } from './projectService';

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

const settings: DistortionSettings = {
  ...DEFAULT_DISTORTION_SETTINGS,
  thresholdDb: -6,
  param1: 0,
  param2: 0,
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
    id: 'project-distortion',
    name: 'Distortion transaction',
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

function target(trackId: string, clipId: string, channels = 1): DistortionTrackAudio {
  return {
    trackId,
    clips: [{
      clipId,
      sourceOffset: 0,
      sampleData: Array.from({ length: channels }, (_, channel) => Float32Array.from([
        0, 1, -0.5, 0.25, 0.75, -1, 0.125, -0.25, 0.5 + channel * 0.1, -0.75,
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

describe('ProjectService Distortion transactions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setCurrentProject(makeProject());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    (projectService as unknown as { currentProject: IProject | null }).currentProject = null;
  });

  it('processes only selected samples on both tracks and commits once', async () => {
    const project = makeProject();
    setCurrentProject(project);
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    const inputs = [target('track-a', 'a'), target('track-b', 'b', 2)];
    const changed = await projectService.distortionSelectionOnTracks(
      project.id, { start: 0.002, end: 0.008 }, settings, inputs,
    );

    expect(changed).toBe(2);
    expect(save).toHaveBeenCalledTimes(1);
    expect(audioDb.audioBuffers.put).toHaveBeenCalledTimes(2);
    const records = writes();
    for (const [inputIndex, record] of records.entries()) {
      const input = inputs[inputIndex].clips[0].sampleData;
      const expected = processDistortionChannels(
        input.map((channel) => channel.slice(2, 8)), settings, project.sampleRate,
      );
      input.forEach((source, channel) => {
        const actual = pcm(record, channel);
        expect(actual.slice(0, 2)).toEqual(source.slice(0, 2));
        expect(actual.slice(2, 8)).toEqual(expected[channel]);
        expect(actual.slice(8)).toEqual(source.slice(8));
      });
    }
    expect(inputs[0].clips[0].sampleData[0]).toEqual(Float32Array.from([
      0, 1, -0.5, 0.25, 0.75, -1, 0.125, -0.25, 0.5, -0.75,
    ]));
    expect(project.tracks[0].clips[0].audioBufferId).toBe('buffer-a');
    expect(save.mock.calls[0][0].tracks[0].clips[0].audioBufferId).not.toBe('buffer-a');
    expect(audioEngine.cacheBuffer).toHaveBeenCalledTimes(2);
  });

  it('preserves DC history across selected clips and stretch metadata', async () => {
    const project = makeProject();
    project.sampleRate = 200;
    project.selection = { start: 0, end: 0.1 };
    project.tracks = [track('track-a', [
      { ...clip('a'), duration: 0.05, originalDuration: 0.05 },
      { ...clip('a2', 0.05), duration: 0.05, originalDuration: 0.05, stretchRatio: 2 },
    ])];
    setCurrentProject(project);
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    const first = Float32Array.from([1, -1, 1, -1, 1, -1, 1, -1, 1, -1]);
    const second = Float32Array.from([-1, 1, -1, 1, -1, 1, -1, 1, -1, 1]);
    const dcSettings: DistortionSettings = {
      ...DEFAULT_DISTORTION_SETTINGS,
      type: 'even-harmonics',
      param1: 0,
      dcBlock: true,
    };
    await projectService.distortionSelectionOnTracks(
      project.id, { start: 0, end: 0.1 }, dcSettings,
      [{
        trackId: 'track-a',
        clips: [
          { clipId: 'a', sourceOffset: 0, sampleData: [first] },
          { clipId: 'a2', sourceOffset: 0, sampleData: [second] },
        ],
      }],
    );

    const state = createDistortionState(dcSettings, project.sampleRate, 1);
    const expectedFirst = processDistortionSelection([first], 0, first.length, state)[0];
    const expectedSecond = processDistortionSelection([second], 0, second.length, state)[0];
    const records = writes();
    expect(pcm(records[0])).toEqual(expectedFirst);
    expect(pcm(records[1])).toEqual(expectedSecond);
    expect(expectedSecond).not.toEqual(processDistortionChannels([second], dcSettings, project.sampleRate)[0]);
    expect(save.mock.calls[0][0].tracks[0].clips[1]).toMatchObject({ stretchRatio: 2, startTime: 0.05 });
  });

  it('maps source offsets without changing selected boundaries', async () => {
    const project = makeProject();
    project.tracks = [track('track-a', [{
      ...clip('a'), stretchRatio: 2, offset: 0.0025, originalDuration: 0.005,
    }])];
    setCurrentProject(project);
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    const source = Float32Array.from([0, 1, -0.5, 0.25, 0.75, -1, 0.125, -0.25, 0.5, -0.75]);
    await projectService.distortionSelectionOnTracks(
      project.id, { start: 0, end: 0.005 }, settings,
      [{ trackId: 'track-a', clips: [{ clipId: 'a', sourceOffset: 0.005, sampleData: [source] }] }],
    );
    const actual = pcm(writes()[0]);
    expect(actual.slice(0, 5)).toEqual(source.slice(0, 5));
    expect(actual.slice(5, 10)).toEqual(processDistortionChannels([source.slice(5, 10)], settings, 1000)[0]);
    expect(save.mock.calls[0][0].tracks[0].clips[0]).toMatchObject({
      duration: 0.01, offset: 0.0025, originalDuration: 0.005, stretchRatio: 2,
    });
  });

  it('performs no writes when target ownership is invalid', async () => {
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    await expect(projectService.distortionSelectionOnTracks(
      'project-distortion', { start: 0, end: 0.01 }, settings,
      [target('track-a', 'a'), target('track-b', 'missing')],
    )).rejects.toThrow('目标片段不可用');
    await expect(projectService.distortionSelectionOnTracks(
      'project-distortion', { start: 0, end: 0.01 }, settings, [],
    )).rejects.toThrow('选区内没有可处理的音频');
    expect(audioDb.audioBuffers.put).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('deletes every staged buffer when a later audio write fails', async () => {
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    vi.mocked(audioDb.audioBuffers.put)
      .mockResolvedValueOnce('first-write')
      .mockRejectedValueOnce(new Error('quota exceeded'));
    await expect(projectService.distortionSelectionOnTracks(
      'project-distortion', { start: 0, end: 0.01 }, settings,
      [target('track-a', 'a'), target('track-b', 'b')],
    )).rejects.toThrow('quota exceeded');
    expect(audioDb.audioBuffers.delete).toHaveBeenCalledTimes(2);
    expect(audioEngine.evictBuffer).toHaveBeenCalledTimes(2);
    expect(save).not.toHaveBeenCalled();
  });

  it('deletes every staged buffer when the single project commit fails', async () => {
    vi.spyOn(projectService, 'saveProject').mockRejectedValueOnce(new Error('database locked'));
    await expect(projectService.distortionSelectionOnTracks(
      'project-distortion', { start: 0, end: 0.01 }, settings,
      [target('track-a', 'a'), target('track-b', 'b')],
    )).rejects.toThrow('database locked');
    expect(audioDb.audioBuffers.delete).toHaveBeenCalledTimes(2);
    expect(audioEngine.evictBuffer).toHaveBeenCalledTimes(2);
    expect(audioEngine.cacheBuffer).not.toHaveBeenCalled();
  });
});
