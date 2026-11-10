import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { audioDb } from '@/db/audioDb';
import type { AudioBufferRecord } from '@/db/audioDb';
import { audioEngine } from '@/engine/audioEngine';
import { processChangeSpeedChannels } from '@/lib/changeSpeedEffect';
import type { IClip, IProject, ITrack } from '@/types/project';
import { projectService, type ChangeSpeedTrackAudio } from './projectService';

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
    id: 'project-change-speed',
    name: 'Change Speed transaction',
    tracks: [
      track('track-a', [clip('a', 0, 1), clip('after-a', 2, 0.5)]),
      track('track-b', [clip('b', 0, 1), clip('after-b', 2, 0.5)]),
    ],
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

function target(trackId: string, clipId: string, channels = 1): ChangeSpeedTrackAudio {
  return {
    trackId,
    clips: [{
      clipId,
      sourceOffset: 0,
      sampleData: Array.from({ length: channels }, () => (
        Float32Array.from({ length: 10 }, (_, index) => index / 10)
      )),
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

describe('ProjectService Change Speed transactions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setCurrentProject(makeProject());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    (projectService as unknown as { currentProject: IProject | null }).currentProject = null;
  });

  it('commits two tracks once, halves PCM and selection, and shifts later clips', async () => {
    const project = makeProject();
    setCurrentProject(project);
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    const inputs = [target('track-a', 'a'), target('track-b', 'b', 2)];
    const changed = await projectService.changeSpeedSelectionOnTracks(
      project.id, { start: 0, end: 1 }, { percentChange: 100 }, inputs,
    );

    expect(changed).toBe(2);
    expect(save).toHaveBeenCalledTimes(1);
    expect(audioDb.audioBuffers.put).toHaveBeenCalledTimes(2);
    const actual = pcm(writes()[0]);
    expect(actual).toHaveLength(5);
    [0, 0.2, 0.4, 0.6, 0.8].forEach((expected, index) => {
      expect(actual[index]).toBeCloseTo(expected, 1);
    });
    expect(writes()[1].channels).toBe(2);
    const saved = save.mock.calls[0][0];
    expect(saved.selection).toEqual({ start: 0, end: 0.5 });
    expect(saved.tracks[0].clips.map((item) => [item.id, item.startTime, item.duration])).toEqual([
      ['a', 0, 0.5], ['after-a', 1.5, 0.5],
    ]);
    expect(saved.tracks[1].clips.map((item) => [item.id, item.startTime, item.duration])).toEqual([
      ['b', 0, 0.5], ['after-b', 1.5, 0.5],
    ]);
    expect(saved.tracks[0].clips[0]).toMatchObject({ originalDuration: 0.5, stretchRatio: 1 });
    expect(project.tracks[0].clips[0].audioBufferId).toBe('buffer-a');
    expect(inputs[0].clips[0].sampleData[0]).toHaveLength(10);
  });

  it('sorts clips, scales selection gaps, and shifts only later untouched clips', async () => {
    const project = makeProject();
    project.tracks = [track('track-a', [
      clip('first', 0, 0.4), clip('second', 0.6, 0.4), clip('after', 1.5, 0.5),
    ])];
    setCurrentProject(project);
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    await projectService.changeSpeedSelectionOnTracks(
      project.id,
      { start: 0, end: 1 },
      { percentChange: 100 },
      [{
        trackId: 'track-a',
        clips: [
          { clipId: 'second', sourceOffset: 0, sampleData: [new Float32Array(4).fill(0.5)] },
          { clipId: 'first', sourceOffset: 0, sampleData: [new Float32Array(4).fill(0.25)] },
        ],
      }],
    );

    const saved = save.mock.calls[0][0];
    expect(saved.tracks[0].clips.map((item) => [item.id, item.startTime, item.duration])).toEqual([
      ['first', 0, 0.2], ['second', 0.3, 0.2], ['after', 1, 0.5],
    ]);
    expect(saved.selection).toEqual({ start: 0, end: 0.5 });
  });

  it('splices a partial selection and normalizes existing stretch metadata safely', async () => {
    const project = makeProject();
    project.tracks = [track('track-a', [
      { ...clip('a', 0, 1), stretchRatio: 2, offset: 0.25 }, clip('after', 1.5, 0.5),
    ])];
    setCurrentProject(project);
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    const source = Float32Array.from({ length: 20 }, (_, index) => index / 20);
    await projectService.changeSpeedSelectionOnTracks(
      project.id,
      { start: 0.25, end: 0.75 },
      { percentChange: 100 },
      [{ trackId: 'track-a', clips: [{ clipId: 'a', sourceOffset: 0.5, sampleData: [source] }] }],
    );

    const expectedMiddle = processChangeSpeedChannels(
      [source.slice(7, 12)], { percentChange: 100 }, 10,
    )[0];
    expect(pcm(writes()[0])).toEqual([
      ...source.slice(0, 7), ...expectedMiddle, ...source.slice(12),
    ]);
    const saved = save.mock.calls[0][0];
    expect(saved.tracks[0].clips[0]).toMatchObject({
      startTime: 0, duration: 0.8, offset: 0.5, originalDuration: 1.8, stretchRatio: 1,
    });
    expect(saved.tracks[0].clips[1].startTime).toBe(1.25);
    expect(saved.selection).toEqual({ start: 0.25, end: 0.5 });
    expect(source).toEqual(Float32Array.from({ length: 20 }, (_, index) => index / 20));
  });

  it('skips the official zero-percent no-op without any writes', async () => {
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    await expect(projectService.changeSpeedSelectionOnTracks(
      'project-change-speed', { start: 0, end: 1 }, { percentChange: 0 }, [target('track-a', 'a')],
    )).resolves.toBe(0);
    expect(save).not.toHaveBeenCalled();
    expect(audioDb.audioBuffers.put).not.toHaveBeenCalled();
  });

  it('performs no writes when any target is invalid or incomplete', async () => {
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    await expect(projectService.changeSpeedSelectionOnTracks(
      'project-change-speed', { start: 0, end: 1 }, { percentChange: 100 },
      [target('track-a', 'a'), target('track-b', 'missing')],
    )).rejects.toThrow('目标片段不可用');
    await expect(projectService.changeSpeedSelectionOnTracks(
      'project-change-speed', { start: 0, end: 2.5 }, { percentChange: 100 },
      [target('track-a', 'a')],
    )).rejects.toThrow('选区片段覆盖不完整');
    expect(audioDb.audioBuffers.put).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('rejects non-finite source samples before any staged write', async () => {
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    const invalid = target('track-a', 'a');
    invalid.clips[0].sampleData[0][4] = Number.NaN;
    await expect(projectService.changeSpeedSelectionOnTracks(
      'project-change-speed', { start: 0, end: 1 }, { percentChange: 100 }, [invalid],
    )).rejects.toThrow('非有限');
    expect(audioDb.audioBuffers.put).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('rolls back every staged buffer when a later audio write fails', async () => {
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    vi.mocked(audioDb.audioBuffers.put)
      .mockResolvedValueOnce('first-write')
      .mockRejectedValueOnce(new Error('quota exceeded'));
    await expect(projectService.changeSpeedSelectionOnTracks(
      'project-change-speed', { start: 0, end: 1 }, { percentChange: 100 },
      [target('track-a', 'a'), target('track-b', 'b')],
    )).rejects.toThrow('quota exceeded');

    const ids = writes().map((record) => record.id);
    expect(audioDb.audioBuffers.delete).toHaveBeenCalledTimes(2);
    expect(vi.mocked(audioDb.audioBuffers.delete).mock.calls.map(([id]) => id)).toEqual(ids);
    expect(audioEngine.evictBuffer).toHaveBeenCalledTimes(2);
    expect(save).not.toHaveBeenCalled();
  });
});
