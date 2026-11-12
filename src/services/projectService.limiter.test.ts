import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { audioDb, type AudioBufferRecord } from '@/db/audioDb';
import { audioEngine } from '@/engine/audioEngine';
import type { IClip, IProject, ITrack } from '@/types/project';
import {
  DEFAULT_LIMITER_SETTINGS,
  processLimiterChannels,
} from '@/lib/limiterEffect';
import { projectService, type LimiterTrackAudio } from './projectService';

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

vi.mock('@/lib/limiterEffect', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/limiterEffect')>();
  return { ...actual, processLimiterChannels: vi.fn(actual.processLimiterChannels) };
});

function clip(id: string, startTime = 0): IClip {
  return {
    id,
    audioBufferId: `buffer-${id}`,
    startTime,
    duration: 1,
    originalDuration: 1,
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
    id: 'project-limiter',
    name: 'Limiter transaction',
    tracks: [track('track-a', [clip('a'), clip('b', 1)]), track('track-b', [clip('c')])],
    cursorPosition: 0,
    selection: { start: 0.5, end: 1.75 },
    viewState: { horizontalZoom: 100, verticalZoom: 1, scrollX: 0, viewMode: 'waveform' },
    createdAt: 50,
    updatedAt: 100,
    sampleRate: 4,
    timeSignature: { numerator: 4, denominator: 4 },
    tempo: 120,
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

const settings = { ...DEFAULT_LIMITER_SETTINGS };

describe('ProjectService Limiter transactions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(processLimiterChannels).mockImplementation((channels) => (
      channels.map((channel) => channel.map((sample) => sample * 0.5))
    ));
    setCurrentProject(makeProject());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    (projectService as unknown as { currentProject: IProject | null }).currentProject = null;
  });

  it('concatenates ordered ranges, preserves unselected PCM, selection and compensates latency once per track', async () => {
    const project = makeProject();
    project.tracks = [track('track-a', [clip('a'), { ...clip('b', 1), stretchRatio: 2 }])];
    setCurrentProject(project);
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    const first = new Float32Array([1, 2, 3, 4]);
    const second = new Float32Array([5, 6, 7, 8]);
    const targets: LimiterTrackAudio[] = [{
      trackId: 'track-a',
      clips: [
        { clipId: 'b', sourceOffset: 0, sampleData: [second] },
        { clipId: 'a', sourceOffset: 0, sampleData: [first] },
      ],
    }];

    const changed = await projectService.limiterSelectionOnTracks(
      project.id, { start: 0.5, end: 1.75 }, settings, targets,
    );

    expect(changed).toBe(2);
    expect(processLimiterChannels).toHaveBeenCalledTimes(1);
    expect(vi.mocked(processLimiterChannels).mock.calls[0][0][0]).toEqual(Float32Array.from([3, 4, 5, 6, 7]));
    expect(vi.mocked(processLimiterChannels).mock.calls[0][2]).toBe(4);
    const records = writes();
    expect(records).toHaveLength(2);
    expect(pcm(records[0])).toEqual(Float32Array.from([1, 2, 1.5, 2]));
    expect(pcm(records[1])).toEqual(Float32Array.from([2.5, 3, 3.5, 8]));
    expect(first).toEqual(Float32Array.from([1, 2, 3, 4]));
    expect(second).toEqual(Float32Array.from([5, 6, 7, 8]));
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0].selection).toEqual({ start: 0.5, end: 1.75 });
    expect(save.mock.calls[0][0].tracks[0].clips[1]).toMatchObject({ id: 'b', stretchRatio: 2, startTime: 1 });
    expect(audioEngine.cacheBuffer).toHaveBeenCalledTimes(2);
  });

  it('uses independent track states with one project commit', async () => {
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    const targets: LimiterTrackAudio[] = [
      { trackId: 'track-a', clips: [
        { clipId: 'a', sourceOffset: 0, sampleData: [new Float32Array([1, 2, 3, 4])] },
        { clipId: 'b', sourceOffset: 0, sampleData: [new Float32Array([5, 6, 7, 8])] },
      ] },
      { trackId: 'track-b', clips: [
        { clipId: 'c', sourceOffset: 0, sampleData: [new Float32Array([9, 10, 11, 12])] },
      ] },
    ];
    await expect(projectService.limiterSelectionOnTracks(
      'project-limiter', { start: 0.5, end: 1.75 }, settings, targets,
    )).resolves.toBe(3);
    expect(processLimiterChannels).toHaveBeenCalledTimes(2);
    expect(vi.mocked(processLimiterChannels).mock.calls[1][0][0]).toEqual(Float32Array.from([11, 12]));
    expect(save).toHaveBeenCalledTimes(1);
    expect(writes()).toHaveLength(3);
  });

  it('validates every target before processing or writing', async () => {
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    await expect(projectService.limiterSelectionOnTracks(
      'project-limiter', { start: 0.5, end: 1.75 }, settings,
      [
        { trackId: 'track-a', clips: [
          { clipId: 'a', sourceOffset: 0, sampleData: [new Float32Array([1, 2, 3, 4])] },
          { clipId: 'b', sourceOffset: 0, sampleData: [new Float32Array([5, 6, 7, 8])] },
        ] },
        { trackId: 'track-b', clips: [
          { clipId: 'missing', sourceOffset: 0, sampleData: [new Float32Array([1, 2, 3, 4])] },
        ] },
      ],
    )).rejects.toThrow('目标片段不可用');
    expect(processLimiterChannels).not.toHaveBeenCalled();
    expect(audioDb.audioBuffers.put).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('stages nothing when a later track fails processing', async () => {
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    vi.mocked(processLimiterChannels)
      .mockImplementationOnce((channels) => channels.map((channel) => channel.map((sample) => sample * 0.5)))
      .mockImplementationOnce(() => { throw new Error('non-finite PCM'); });
    const targets: LimiterTrackAudio[] = [
      { trackId: 'track-a', clips: [
        { clipId: 'a', sourceOffset: 0, sampleData: [new Float32Array([1, 2, 3, 4])] },
        { clipId: 'b', sourceOffset: 0, sampleData: [new Float32Array([5, 6, 7, 8])] },
      ] },
      { trackId: 'track-b', clips: [
        { clipId: 'c', sourceOffset: 0, sampleData: [new Float32Array([9, 10, 11, 12])] },
      ] },
    ];
    await expect(projectService.limiterSelectionOnTracks(
      'project-limiter', { start: 0.5, end: 1.75 }, settings, targets,
    )).rejects.toThrow('non-finite PCM');
    expect(audioDb.audioBuffers.put).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('deletes every staged buffer when the single project commit fails', async () => {
    vi.spyOn(projectService, 'saveProject').mockRejectedValueOnce(new Error('database locked'));
    const targets: LimiterTrackAudio[] = [
      { trackId: 'track-a', clips: [
        { clipId: 'a', sourceOffset: 0, sampleData: [new Float32Array([1, 2, 3, 4])] },
        { clipId: 'b', sourceOffset: 0, sampleData: [new Float32Array([5, 6, 7, 8])] },
      ] },
      { trackId: 'track-b', clips: [
        { clipId: 'c', sourceOffset: 0, sampleData: [new Float32Array([9, 10, 11, 12])] },
      ] },
    ];
    await expect(projectService.limiterSelectionOnTracks(
      'project-limiter', { start: 0.5, end: 1.75 }, settings, targets,
    )).rejects.toThrow('database locked');
    expect(audioDb.audioBuffers.delete).toHaveBeenCalledTimes(3);
    expect(audioEngine.evictBuffer).toHaveBeenCalledTimes(3);
    expect(audioEngine.cacheBuffer).not.toHaveBeenCalled();
  });

  it('does not bypass neutral Limiter parameters and still commits processed audio', async () => {
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    const neutral = {
      thresholdDb: 0,
      makeupTargetDb: 0,
      kneeWidthDb: 0,
      lookaheadMs: 0,
      releaseMs: 0,
    };
    await expect(projectService.limiterSelectionOnTracks(
      'project-limiter', { start: 0, end: 1 }, neutral,
      [{ trackId: 'track-a', clips: [
        { clipId: 'a', sourceOffset: 0, sampleData: [new Float32Array([1, 2, 3, 4])] },
      ] }],
    )).resolves.toBe(1);
    expect(processLimiterChannels).toHaveBeenCalledTimes(1);
    expect(audioDb.audioBuffers.put).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledTimes(1);
  });
});
