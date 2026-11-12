import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { audioDb } from '@/db/audioDb';
import type { AudioBufferRecord } from '@/db/audioDb';
import { audioEngine } from '@/engine/audioEngine';
import type { IClip, IProject, ITrack } from '@/types/project';
import {
  createReverbState,
  DEFAULT_REVERB_SETTINGS,
  processReverbChannels,
  type ReverbSettings,
} from '@/lib/reverbEffect';
import { projectService, type ReverbTrackAudio } from './projectService';

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

const settings: ReverbSettings = {
  ...DEFAULT_REVERB_SETTINGS,
  roomSize: 20,
  preDelayMs: 0,
  wetGainDb: 0,
  dryGainDb: 0,
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
    id: 'project-reverb',
    name: 'Reverb transaction',
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

function target(trackId: string, clipId: string, channels = 1): ReverbTrackAudio {
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

describe('ProjectService Reverb transactions', () => {
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
    const changed = await projectService.reverbSelectionOnTracks(
      project.id, { start: 0.002, end: 0.008 }, settings, inputs,
    );

    expect(changed).toBe(2);
    expect(save).toHaveBeenCalledTimes(1);
    expect(audioDb.audioBuffers.put).toHaveBeenCalledTimes(2);
    const records = writes();
    for (const [inputIndex, record] of records.entries()) {
      const input = inputs[inputIndex].clips[0].sampleData;
      const expected = processReverbChannels(
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
    const saved = save.mock.calls[0][0];
    expect(saved.tracks[0].clips[0].audioBufferId).not.toBe('buffer-a');
    expect(saved.tracks[1].clips[0].audioBufferId).not.toBe('buffer-b');
    expect(project.tracks[0].clips[0].audioBufferId).toBe('buffer-a');
    expect(audioEngine.cacheBuffer).toHaveBeenCalledTimes(2);
  });

  it('keeps zero-width stereo selection channels independent through the atomic service', async () => {
    const project = makeProject();
    project.tracks = [track('track-a', [clip('a')])];
    setCurrentProject(project);
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    const left = Float32Array.from([0.75, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const right = Float32Array.from([-0.25, 0, 0, 0, 0, 0, 0, 0, 0.5, 0]);
    const zeroWidth = { ...settings, stereoWidth: 0, wetOnly: true };
    await projectService.reverbSelectionOnTracks(
      project.id, { start: 0, end: 0.01 }, zeroWidth,
      [{ trackId: 'track-a', clips: [{ clipId: 'a', sourceOffset: 0, sampleData: [left, right] }] }],
    );

    const record = writes()[0];
    expect(pcm(record, 0)).toEqual(processReverbChannels([left], zeroWidth, project.sampleRate)[0]);
    expect(pcm(record, 1)).toEqual(processReverbChannels([right], zeroWidth, project.sampleRate)[0]);
    expect(pcm(record, 0)).not.toEqual(pcm(record, 1));
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('preserves pre-delay and reverb history across selected clips and stretch metadata', async () => {
    const project = makeProject();
    project.tracks = [track('track-a', [
      { ...clip('a'), duration: 0.005, originalDuration: 0.005 },
      { ...clip('a2', 0.005), duration: 0.005, originalDuration: 0.005, stretchRatio: 2 },
    ])];
    setCurrentProject(project);
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    const first = Float32Array.from([1, 0, 0, 0, 0]);
    const second = new Float32Array(5);
    const wetSettings = { ...settings, reverberance: 100, wetOnly: true };
    await projectService.reverbSelectionOnTracks(
      project.id, { start: 0, end: 0.01 }, wetSettings,
      [{
        trackId: 'track-a',
        clips: [
          { clipId: 'a', sourceOffset: 0, sampleData: [first] },
          { clipId: 'a2', sourceOffset: 0, sampleData: [second] },
        ],
      }],
    );

    const state = createReverbState(wetSettings, project.sampleRate, 1);
    const expectedFirst = processReverbChannels([first], wetSettings, project.sampleRate, state)[0];
    const expectedSecond = processReverbChannels([second], wetSettings, project.sampleRate, state)[0];
    const records = writes();
    expect(pcm(records[0])).toEqual(expectedFirst);
    expect(pcm(records[1])).toEqual(expectedSecond);
    expect(expectedSecond.some((sample) => sample !== 0)).toBe(true);
    expect(save.mock.calls[0][0].tracks[0].clips[1]).toMatchObject({ stretchRatio: 2, startTime: 0.005 });
  });

  it('maps source offsets without changing selected boundaries', async () => {
    const project = makeProject();
    project.tracks = [track('track-a', [{
      ...clip('a'), stretchRatio: 2, offset: 0.0025, originalDuration: 0.005,
    }])];
    setCurrentProject(project);
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    const source = Float32Array.from([0, 1, -0.5, 0.25, 0.75, -1, 0.125, -0.25, 0.5, -0.75]);
    await projectService.reverbSelectionOnTracks(
      project.id, { start: 0, end: 0.005 }, settings,
      [{ trackId: 'track-a', clips: [{ clipId: 'a', sourceOffset: 0.005, sampleData: [source] }] }],
    );
    const actual = pcm(writes()[0]);
    expect(actual.slice(0, 5)).toEqual(source.slice(0, 5));
    expect(actual.slice(5, 10)).toEqual(processReverbChannels([source.slice(5, 10)], settings, 1000)[0]);
    expect(save.mock.calls[0][0].tracks[0].clips[0]).toMatchObject({
      duration: 0.01, offset: 0.0025, originalDuration: 0.005, stretchRatio: 2,
    });
  });

  it('performs no writes when a target or selected-clip ownership is invalid', async () => {
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    await expect(projectService.reverbSelectionOnTracks(
      'project-reverb', { start: 0, end: 0.01 }, settings,
      [target('track-a', 'a'), target('track-b', 'missing')],
    )).rejects.toThrow('目标片段不可用');
    await expect(projectService.reverbSelectionOnTracks(
      'project-reverb', { start: 0, end: 0.01 }, settings, [],
    )).rejects.toThrow('选区内没有可处理的音频');
    expect(audioDb.audioBuffers.put).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(audioDb.audioBuffers.delete).not.toHaveBeenCalled();
  });

  it('deletes every staged buffer when a later audio write fails', async () => {
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    vi.mocked(audioDb.audioBuffers.put)
      .mockResolvedValueOnce('first-write')
      .mockRejectedValueOnce(new Error('quota exceeded'));
    await expect(projectService.reverbSelectionOnTracks(
      'project-reverb', { start: 0, end: 0.01 }, settings,
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
    await expect(projectService.reverbSelectionOnTracks(
      'project-reverb', { start: 0, end: 0.01 }, settings,
      [target('track-a', 'a'), target('track-b', 'b')],
    )).rejects.toThrow('database locked');
    expect(audioDb.audioBuffers.delete).toHaveBeenCalledTimes(2);
    expect(audioEngine.evictBuffer).toHaveBeenCalledTimes(2);
    expect(audioEngine.cacheBuffer).not.toHaveBeenCalled();
  });
});
