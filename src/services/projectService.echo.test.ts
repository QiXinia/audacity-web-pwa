import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { audioDb } from '@/db/audioDb';
import type { AudioBufferRecord } from '@/db/audioDb';
import { audioEngine } from '@/engine/audioEngine';
import type { IClip, IProject, ITrack } from '@/types/project';
import { projectService, type EchoTrackAudio } from './projectService';

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
    id: 'project-echo',
    name: 'Echo transaction',
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

function target(trackId: string, clipId: string, channels = 1): EchoTrackAudio {
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

describe('ProjectService Echo transactions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setCurrentProject(makeProject());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    (projectService as unknown as { currentProject: IProject | null }).currentProject = null;
  });

  it('commits both tracks once with exact recursive PCM and preserves input buffers', async () => {
    const project = makeProject();
    setCurrentProject(project);
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    const inputs = [target('track-a', 'a'), target('track-b', 'b', 2)];
    const changed = await projectService.echoSelectionOnTracks(
      project.id, { start: 0, end: 1 }, 0.2, 0.5, inputs,
    );

    expect(changed).toBe(2);
    expect(save).toHaveBeenCalledTimes(1);
    expect(audioDb.audioBuffers.put).toHaveBeenCalledTimes(2);
    const records = writes();
    const expected = [1, 1, 1.5, 1.5, 1.75, 1.75, 1.875, 1.875, 1.9375, 1.9375];
    expect(pcm(records[0])).toEqual(expected);
    expect(pcm(records[1])).toEqual(expected);
    expect(pcm(records[1], 1)).toEqual(expected);
    expect(inputs.every((input) => input.clips[0].sampleData.every((channel) => Array.from(channel).every((value) => value === 1)))).toBe(true);
    const saved = save.mock.calls[0][0];
    expect(saved.tracks[0].clips[0].audioBufferId).not.toBe('buffer-a');
    expect(saved.tracks[1].clips[0].audioBufferId).not.toBe('buffer-b');
    expect(project.tracks[0].clips[0].audioBufferId).toBe('buffer-a');
    expect(audioEngine.cacheBuffer).toHaveBeenCalledTimes(2);
  });

  it('carries one track history across clips even when inputs arrive out of order', async () => {
    const project = makeProject();
    project.tracks = [track('track-a', [clip('first', 0, 0.5), clip('second', 0.5, 0.5)])];
    setCurrentProject(project);
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    await projectService.echoSelectionOnTracks(
      project.id,
      { start: 0, end: 1 },
      0.2,
      0.5,
      [{
        trackId: 'track-a',
        clips: [
          { clipId: 'second', sourceOffset: 0, sampleData: [new Float32Array(5).fill(1)] },
          { clipId: 'first', sourceOffset: 0, sampleData: [new Float32Array(5).fill(1)] },
        ],
      }],
    );

    const records = writes();
    expect(pcm(records[0])).toEqual([1, 1, 1.5, 1.5, 1.75]);
    expect(pcm(records[1])).toEqual([1.75, 1.875, 1.875, 1.9375, 1.9375]);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('renders source offsets and resets stretch metadata without changing clip duration', async () => {
    const project = makeProject();
    project.tracks = [track('track-a', [{ ...clip('a', 0, 1), stretchRatio: 2, offset: 0.25 }])];
    setCurrentProject(project);
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    await projectService.echoSelectionOnTracks(
      project.id,
      { start: 0, end: 0.5 },
      0.2,
      0.5,
      [{ trackId: 'track-a', clips: [{ clipId: 'a', sourceOffset: 0.5, sampleData: [new Float32Array(20).fill(1)] }] }],
    );

    expect(pcm(writes()[0])).toEqual([
      1, 1, 1, 1, 1,
      1, 1, 1.5, 1.5, 1.75,
      1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
    ]);
    expect(save.mock.calls[0][0].tracks[0].clips[0]).toMatchObject({
      duration: 1,
      offset: 0.5,
      originalDuration: 2,
      stretchRatio: 1,
    });
  });

  it('performs no writes when any target is invalid', async () => {
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    await expect(projectService.echoSelectionOnTracks(
      'project-echo', { start: 0, end: 1 }, 0.2, 0.5,
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
    await expect(projectService.echoSelectionOnTracks(
      'project-echo', { start: 0, end: 1 }, 0.2, 0.5,
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
    await expect(projectService.echoSelectionOnTracks(
      'project-echo', { start: 0, end: 1 }, 0.2, 0.5,
      [target('track-a', 'a'), target('track-b', 'b')],
    )).rejects.toThrow('database locked');

    expect(audioDb.audioBuffers.delete).toHaveBeenCalledTimes(2);
    expect(audioEngine.evictBuffer).toHaveBeenCalledTimes(2);
    expect(audioEngine.cacheBuffer).not.toHaveBeenCalled();
  });
});

describe('ProjectService Invert transactions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setCurrentProject(makeProject());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    (projectService as unknown as { currentProject: IProject | null }).currentProject = null;
  });

  it('inverts the exact selection on every track with one commit and preserves input PCM', async () => {
    const project = makeProject();
    setCurrentProject(project);
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    const inputs = [target('track-a', 'a', 2), target('track-b', 'b')];
    inputs[0].clips[0].sampleData = [
      Float32Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]),
      Float32Array.from([0, -1, -2, -3, -4, -5, -6, -7, -8, -9]),
    ];
    inputs[1].clips[0].sampleData = [new Float32Array(10).fill(0.5)];

    const changed = await projectService.invertSelectionOnTracks(
      project.id, { start: 0.2, end: 0.7 }, inputs,
    );

    expect(changed).toBe(2);
    expect(save).toHaveBeenCalledTimes(1);
    expect(audioDb.audioBuffers.put).toHaveBeenCalledTimes(2);
    const records = writes();
    expect(pcm(records[0])).toEqual([0, 1, -2, -3, -4, -5, -6, 7, 8, 9]);
    expect(pcm(records[0], 1)).toEqual([0, -1, 2, 3, 4, 5, 6, -7, -8, -9]);
    expect(pcm(records[1])).toEqual([0.5, 0.5, -0.5, -0.5, -0.5, -0.5, -0.5, 0.5, 0.5, 0.5]);
    expect(Array.from(inputs[0].clips[0].sampleData[0])).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(project.tracks[0].clips[0].audioBufferId).toBe('buffer-a');
    expect(audioEngine.cacheBuffer).toHaveBeenCalledTimes(2);
  });

  it('renders the effective stretched source range and resets stretch metadata', async () => {
    const project = makeProject();
    project.tracks = [track('track-a', [{ ...clip('a', 0, 1), stretchRatio: 2, offset: 0.25 }])];
    setCurrentProject(project);
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    const input = Float32Array.from({ length: 20 }, (_, index) => index + 1);

    await projectService.invertSelectionOnTracks(
      project.id,
      { start: 0.2, end: 0.7 },
      [{ trackId: 'track-a', clips: [{ clipId: 'a', sourceOffset: 0.5, sampleData: [input] }] }],
    );

    expect(pcm(writes()[0])).toEqual([
      1, 2, 3, 4, 5, 6, 7, -8, -9, -10,
      -11, -12, 13, 14, 15, 16, 17, 18, 19, 20,
    ]);
    expect(save.mock.calls[0][0].tracks[0].clips[0]).toMatchObject({
      duration: 1,
      offset: 0.5,
      originalDuration: 2,
      stretchRatio: 1,
    });
  });

  it('performs no writes when any target is invalid', async () => {
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    await expect(projectService.invertSelectionOnTracks(
      'project-echo', { start: 0, end: 1 },
      [target('track-a', 'a'), target('track-b', 'missing')],
    )).rejects.toThrow('目标片段不可用');

    expect(audioDb.audioBuffers.put).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });
});

describe('ProjectService Stereo To Mono transactions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setCurrentProject(makeProject());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    (projectService as unknown as { currentProject: IProject | null }).currentProject = null;
  });

  it('mixes stereo clips to mono with one commit while leaving mono clips intact', async () => {
    const project = makeProject();
    project.tracks = [
      track('stereo', [clip('s', 0, 1)]),
      track('mono', [clip('m', 0, 1)]),
    ];
    setCurrentProject(project);
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    const targets = [
      {
        trackId: 'stereo',
        clips: [{
          clipId: 's',
          sourceOffset: 0,
          sampleData: [Float32Array.from([0.2, 0.4]), Float32Array.from([0.6, -0.2])],
        }],
      },
      {
        trackId: 'mono',
        clips: [{ clipId: 'm', sourceOffset: 0, sampleData: [Float32Array.from([0.3, 0.7])] }],
      },
    ];

    const changed = await projectService.stereoToMonoOnTracks(project.id, targets);

    expect(changed).toBe(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(audioDb.audioBuffers.put).toHaveBeenCalledTimes(1);
    const values = pcm(writes()[0]);
    expect(values).toHaveLength(2);
    expect(values[0]).toBeCloseTo(0.4);
    expect(values[1]).toBeCloseTo(0.1);
    expect(save.mock.calls[0][0].tracks[1].clips[0].audioBufferId).toBe('buffer-m');
    expect(save.mock.calls[0][0].tracks[0].clips[0]).toMatchObject({ offset: 0, stretchRatio: 1 });
  });

  it('fails closed when clip coverage is incomplete', async () => {
    const project = makeProject();
    project.tracks = [track('track-a', [clip('a', 0, 0.5), clip('b', 0.5, 0.5)])];
    setCurrentProject(project);
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    await expect(projectService.stereoToMonoOnTracks(
      'project-echo',
      [target('track-a', 'a', 2)],
    )).rejects.toThrow('片段覆盖不完整');

    expect(audioDb.audioBuffers.put).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });
});
