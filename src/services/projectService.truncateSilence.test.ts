import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { audioDb, type AudioBufferRecord } from '@/db/audioDb';
import { audioEngine } from '@/engine/audioEngine';
import type { IClip, IProject, ITrack } from '@/types/project';
import {
  DEFAULT_TRUNCATE_SILENCE_SETTINGS,
  type TruncateSilenceTrackInput,
} from '@/lib/truncateSilenceEffect';
import { projectService } from './projectService';

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

function clip(id: string, startTime = 0, duration = 4): IClip {
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

function track(id: string, clips: IClip[] = [clip(id)]): ITrack {
  return {
    id, name: id, type: 'audio', gain: 0, pan: 0, muted: false, solo: false,
    armed: false, color: '', clips, effects: [],
  };
}

function makeProject(): IProject {
  return {
    id: 'project-truncate-silence',
    name: 'Truncate Silence transaction',
    tracks: [track('track-a', [clip('a')]), track('track-b', [clip('b')])],
    cursorPosition: 0,
    selection: { start: 0, end: 4 },
    viewState: { horizontalZoom: 100, verticalZoom: 1, scrollX: 0, viewMode: 'waveform' },
    createdAt: 50,
    updatedAt: 100,
    sampleRate: 1000,
    timeSignature: { numerator: 4, denominator: 4 },
    tempo: 120,
  };
}

function toneWithSilence(start: number, end: number, duration = 4): Float32Array {
  const pcm = new Float32Array(Math.round(duration * 1000));
  pcm.fill(0.5);
  pcm.fill(0, Math.round(start * 1000), Math.round(end * 1000));
  return pcm;
}

function makeTarget(project: IProject, trackId: string, channels: Float32Array[][]): TruncateSilenceTrackInput {
  const sourceTrack = project.tracks.find(({ id }) => id === trackId)!;
  return {
    trackId,
    clips: sourceTrack.clips.map((sourceClip, index) => ({
      clipId: sourceClip.id,
      sourceOffset: 0,
      sampleData: channels[index],
    })),
  };
}

function setCurrentProject(project: IProject) {
  (projectService as unknown as { currentProject: IProject }).currentProject = project;
}

function writes(): AudioBufferRecord[] {
  return vi.mocked(audioDb.audioBuffers.put).mock.calls.map(([record]) => record);
}

function pcm(record: AudioBufferRecord): Float32Array {
  return new Float32Array(record.channelData[0]);
}

describe('ProjectService Truncate Silence transactions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setCurrentProject(makeProject());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    (projectService as unknown as { currentProject: IProject | null }).currentProject = null;
  });

  it('cuts common silence on two tracks and commits all outputs exactly once', async () => {
    const project = makeProject();
    setCurrentProject(project);
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    const inputs = [
      makeTarget(project, 'track-a', [[toneWithSilence(1, 3)]]),
      makeTarget(project, 'track-b', [[toneWithSilence(1.5, 2.5)]]),
    ];
    const originals = inputs.map((input) => new Float32Array(input.clips[0].sampleData[0]));
    const result = await projectService.truncateSilenceSelectionOnTracks(
      project.id,
      { start: 0, end: 4 },
      DEFAULT_TRUNCATE_SILENCE_SETTINGS,
      inputs,
    );

    expect(result).toMatchObject({ selectionEnd: 3.5, changedTracks: 2 });
    expect(save).toHaveBeenCalledTimes(1);
    expect(audioDb.audioBuffers.put).toHaveBeenCalledTimes(2);
    expect(writes().map((record) => pcm(record).length)).toEqual([3500, 3500]);
    expect(save.mock.calls[0][0].selection).toEqual({ start: 0, end: 3.5 });
    expect(save.mock.calls[0][0].tracks.map(({ clips }) => clips[0].duration)).toEqual([3.5, 3.5]);
    expect(project.tracks.map(({ clips }) => clips[0].audioBufferId)).toEqual(['buffer-a', 'buffer-b']);
    expect(inputs[0].clips[0].sampleData[0]).toEqual(originals[0]);
    expect(inputs[1].clips[0].sampleData[0]).toEqual(originals[1]);
    expect(audioEngine.cacheBuffer).toHaveBeenCalledTimes(2);
  });

  it('ripples following clips by the exact delta and preserves their metadata', async () => {
    const project = makeProject();
    const following = { ...clip('following', 5, 1), gain: -3, offset: 0.25, stretchRatio: 2 };
    project.tracks = [track('track-a', [clip('a'), following])];
    setCurrentProject(project);
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    const input = makeTarget(project, 'track-a', [
      [toneWithSilence(1, 2.5)],
      [new Float32Array(1000).fill(0.5)],
    ]);
    const result = await projectService.truncateSilenceSelectionOnTracks(
      project.id, { start: 0, end: 4 }, DEFAULT_TRUNCATE_SILENCE_SETTINGS, [input],
    );
    expect(result.changedTracks).toBe(1);
    const committed = save.mock.calls[0][0].tracks[0];
    const generated = committed.clips.find(({ name }) => name?.includes('Truncate Silence'));
    const shifted = committed.clips.find(({ id }) => id === 'following');
    expect(generated).toMatchObject({ startTime: 0, duration: 3.05, offset: 0, stretchRatio: 1 });
    expect(shifted).toMatchObject({
      startTime: 4, duration: 1, gain: -3, offset: 0.25, stretchRatio: 2,
    });
    expect(pcm(writes()[0])).toHaveLength(3050);
  });

  it('uses the longest resulting selection for independent track processing', async () => {
    const project = makeProject();
    setCurrentProject(project);
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    const result = await projectService.truncateSilenceSelectionOnTracks(
      project.id,
      { start: 0, end: 4 },
      { ...DEFAULT_TRUNCATE_SILENCE_SETTINGS, truncateDuration: 0, independent: true },
      [
        makeTarget(project, 'track-a', [[toneWithSilence(1, 3)]]),
        makeTarget(project, 'track-b', [[toneWithSilence(1.5, 2.5)]]),
      ],
    );
    expect(result.selectionEnd).toBe(3);
    expect(writes().map((record) => pcm(record).length)).toEqual([2000, 3000]);
    expect(save.mock.calls[0][0].selection).toEqual({ start: 0, end: 3 });
  });

  it('returns a no-op without writes when no qualifying silence exists', async () => {
    const project = makeProject();
    setCurrentProject(project);
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    const result = await projectService.truncateSilenceSelectionOnTracks(
      project.id,
      { start: 0, end: 4 },
      DEFAULT_TRUNCATE_SILENCE_SETTINGS,
      [makeTarget(project, 'track-a', [[new Float32Array(4000).fill(0.5)]])],
    );
    expect(result).toMatchObject({ project, selectionEnd: 4, changedTracks: 0 });
    expect(audioDb.audioBuffers.put).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('rejects incomplete full-track input before any write', async () => {
    const project = makeProject();
    project.tracks = [track('track-a', [clip('a', 0, 2), clip('b', 2, 2)])];
    setCurrentProject(project);
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    const target = makeTarget(project, 'track-a', [
      [toneWithSilence(0.5, 1.5, 2)],
      [toneWithSilence(0.5, 1.5, 2)],
    ]);
    target.clips.pop();
    await expect(projectService.truncateSilenceSelectionOnTracks(
      project.id, { start: 0, end: 4 }, DEFAULT_TRUNCATE_SILENCE_SETTINGS, [target],
    )).rejects.toThrow('完整轨道音频');
    expect(audioDb.audioBuffers.put).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('deletes every staged buffer when a later audio write fails', async () => {
    const project = makeProject();
    setCurrentProject(project);
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    vi.mocked(audioDb.audioBuffers.put)
      .mockResolvedValueOnce('first-write')
      .mockRejectedValueOnce(new Error('quota exceeded'));
    await expect(projectService.truncateSilenceSelectionOnTracks(
      project.id,
      { start: 0, end: 4 },
      { ...DEFAULT_TRUNCATE_SILENCE_SETTINGS, independent: true },
      [
        makeTarget(project, 'track-a', [[toneWithSilence(1, 3)]]),
        makeTarget(project, 'track-b', [[toneWithSilence(1.5, 2.5)]]),
      ],
    )).rejects.toThrow('quota exceeded');
    const ids = writes().map((record) => record.id);
    expect(ids).toHaveLength(2);
    expect(vi.mocked(audioDb.audioBuffers.delete).mock.calls.map(([id]) => id)).toEqual(ids);
    expect(audioEngine.evictBuffer).toHaveBeenCalledTimes(2);
    expect(save).not.toHaveBeenCalled();
  });
});
