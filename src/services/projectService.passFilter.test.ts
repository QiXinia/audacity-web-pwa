import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { audioDb, type AudioBufferRecord } from '@/db/audioDb';
import { audioEngine } from '@/engine/audioEngine';
import type { IClip, IProject, ITrack } from '@/types/project';
import {
  createPassFilterState,
  processPassFilter,
  type PassFilterSettings,
} from '@/lib/passFilterEffect';
import { projectService, type PassFilterTrackAudio } from './projectService';

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

const settings: PassFilterSettings = { kind: 'highpass', frequencyHz: 100, rolloff: 36 };
const sourceSamples = () => Float32Array.from([0, 1, -0.5, 0.25, 0.75, -1, 0.125, -0.25, 0.5, -0.75]);

function clip(id: string, startTime = 0): IClip {
  return {
    id, audioBufferId: `buffer-${id}`, startTime, duration: 0.01, originalDuration: 0.01,
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
    id: 'project-pass-filter', name: 'High/Low Pass transaction',
    tracks: [track('track-a', [clip('a')]), track('track-b', [clip('b')])],
    cursorPosition: 0, selection: { start: 0, end: 0.01 },
    viewState: { horizontalZoom: 100, verticalZoom: 1, scrollX: 0, viewMode: 'waveform' },
    createdAt: 50, updatedAt: 100, sampleRate: 1000,
    timeSignature: { numerator: 4, denominator: 4 }, tempo: 120,
  };
}
function target(trackId: string, clipId: string, channels = 1): PassFilterTrackAudio {
  return {
    trackId,
    clips: [{ clipId, sourceOffset: 0, sampleData: Array.from({ length: channels }, sourceSamples) }],
  };
}
function setCurrentProject(project: IProject | null) {
  (projectService as unknown as { currentProject: IProject | null }).currentProject = project;
}
function writes(): AudioBufferRecord[] {
  return vi.mocked(audioDb.audioBuffers.put).mock.calls.map(([record]) => record);
}
function pcm(record: AudioBufferRecord, channel = 0): Float32Array {
  return new Float32Array(record.channelData[channel]);
}

describe('ProjectService High/Low Pass transactions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setCurrentProject(makeProject());
  });
  afterEach(() => {
    vi.restoreAllMocks();
    setCurrentProject(null);
  });

  it('filters only selected samples on both tracks and commits once without mutating inputs', async () => {
    const project = makeProject();
    setCurrentProject(project);
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    const inputs = [target('track-a', 'a'), target('track-b', 'b', 2)];
    const inputSnapshot = inputs.map((item) => item.clips[0].sampleData.map((channel) => new Float32Array(channel)));
    const changed = await projectService.passFilterSelectionOnTracks(
      project.id, { start: 0.002, end: 0.008 }, settings, inputs,
    );
    expect(changed).toBe(2);
    expect(save).toHaveBeenCalledTimes(1);
    expect(audioDb.audioBuffers.put).toHaveBeenCalledTimes(2);
    const records = writes();
    for (let recordIndex = 0; recordIndex < records.length; recordIndex += 1) {
      for (let channel = 0; channel < records[recordIndex].channelData.length; channel += 1) {
        const actual = pcm(records[recordIndex], channel);
        const source = inputs[recordIndex].clips[0].sampleData[channel];
        const expected = processPassFilter(source.slice(2, 8), settings, project.sampleRate);
        expect(actual.slice(0, 2)).toEqual(source.slice(0, 2));
        expect(actual.slice(2, 8)).toEqual(expected);
        expect(actual.slice(8)).toEqual(source.slice(8));
      }
    }
    inputs.forEach((item, index) => item.clips[0].sampleData.forEach((channel, channelIndex) => {
      expect(channel).toEqual(inputSnapshot[index][channelIndex]);
    }));
    const saved = save.mock.calls[0][0];
    expect(saved.tracks[0].clips[0].audioBufferId).not.toBe('buffer-a');
    expect(saved.tracks[1].clips[0].audioBufferId).not.toBe('buffer-b');
    expect(project.tracks[0].clips[0].audioBufferId).toBe('buffer-a');
    expect(audioEngine.cacheBuffer).toHaveBeenCalledTimes(2);
  });

  it('preserves per-channel filter history across selected clips and their timing metadata', async () => {
    const project = makeProject();
    project.tracks = [track('track-a', [
      { ...clip('a'), duration: 0.005, originalDuration: 0.005 },
      { ...clip('a2', 0.005), duration: 0.005, originalDuration: 0.005, stretchRatio: 2 },
    ])];
    setCurrentProject(project);
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    const first = Float32Array.from([1, 0, 0, 0, 0]);
    const second = new Float32Array(5);
    await projectService.passFilterSelectionOnTracks(project.id, { start: 0, end: 0.01 }, settings, [{
      trackId: 'track-a',
      clips: [
        { clipId: 'a', sourceOffset: 0, sampleData: [first] },
        { clipId: 'a2', sourceOffset: 0, sampleData: [second] },
      ],
    }]);
    const state = createPassFilterState(settings, project.sampleRate);
    const expectedFirst = processPassFilter(first, settings, project.sampleRate, state);
    const expectedSecond = processPassFilter(second, settings, project.sampleRate, state);
    const records = writes();
    expect(pcm(records[0])).toEqual(expectedFirst);
    expect(pcm(records[1])).toEqual(expectedSecond);
    expect(expectedSecond).not.toEqual(processPassFilter(second, settings, project.sampleRate));
    expect(save.mock.calls[0][0].tracks[0].clips[1]).toMatchObject({ stretchRatio: 2, startTime: 0.005 });
  });

  it('maps source offsets without changing selected boundaries', async () => {
    const project = makeProject();
    project.tracks = [track('track-a', [{
      ...clip('a'), stretchRatio: 2, offset: 0.0025, originalDuration: 0.005,
    }])];
    setCurrentProject(project);
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    const source = sourceSamples();
    await projectService.passFilterSelectionOnTracks(project.id, { start: 0, end: 0.005 }, settings, [{
      trackId: 'track-a', clips: [{ clipId: 'a', sourceOffset: 0.005, sampleData: [source] }],
    }]);
    const actual = pcm(writes()[0]);
    expect(actual.slice(0, 5)).toEqual(source.slice(0, 5));
    expect(actual.slice(5, 10)).toEqual(processPassFilter(source.slice(5, 10), settings, 1000));
    expect(save.mock.calls[0][0].tracks[0].clips[0]).toMatchObject({
      duration: 0.01, offset: 0.0025, originalDuration: 0.005, stretchRatio: 2,
    });
  });

  it.each([
    { patch: { frequencyHz: 0.05 }, message: '0.1' },
    { patch: { frequencyHz: 500 }, message: 'Nyquist' },
    { patch: { rolloff: 7 }, message: 'Roll-off' },
  ])('rejects invalid settings before writing: $message', async ({ patch, message }) => {
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    await expect(projectService.passFilterSelectionOnTracks(
      'project-pass-filter', { start: 0, end: 0.01 },
      { ...settings, ...patch } as PassFilterSettings,
      [target('track-a', 'a')],
    )).rejects.toThrow(message);
    expect(audioDb.audioBuffers.put).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('performs no writes when any target is invalid', async () => {
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    await expect(projectService.passFilterSelectionOnTracks(
      'project-pass-filter', { start: 0, end: 0.01 }, settings,
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
    await expect(projectService.passFilterSelectionOnTracks(
      'project-pass-filter', { start: 0, end: 0.01 }, settings,
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
    await expect(projectService.passFilterSelectionOnTracks(
      'project-pass-filter', { start: 0, end: 0.01 }, settings,
      [target('track-a', 'a'), target('track-b', 'b')],
    )).rejects.toThrow('database locked');
    const ids = writes().map((record) => record.id);
    expect(audioDb.audioBuffers.delete).toHaveBeenCalledTimes(2);
    expect(vi.mocked(audioDb.audioBuffers.delete).mock.calls.map(([id]) => id)).toEqual(ids);
    expect(audioEngine.evictBuffer).toHaveBeenCalledTimes(2);
  });
});
