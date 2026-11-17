import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { audioDb } from '@/db/audioDb';
import type { AudioBufferRecord } from '@/db/audioDb';
import { audioEngine } from '@/engine/audioEngine';
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

function clip(id: string, startTime = 0, duration = 0.01): IClip {
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
    id: 'project-remove-dc',
    name: 'Remove DC transaction',
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

function target(trackId: string, clipId: string): NormalizeTrackAudio {
  return {
    trackId,
    clips: [{
      clipId,
      sourceOffset: 0,
      sampleData: [Float32Array.from([1, 1, 3, 5, 7, 9, 11, 13, 20, 20])],
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

describe('ProjectService Remove DC offset transactions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setCurrentProject(makeProject());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    (projectService as unknown as { currentProject: IProject | null }).currentProject = null;
  });

  it('subtracts each channel mean only inside the selection and commits once', async () => {
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    const source = [
      Float32Array.from([1, 1, 3, 5, 7, 9, 11, 13, 20, 20]),
      Float32Array.from([10, 10, 4, 4, 4, 4, 4, 4, 30, 30]),
    ];
    const changed = await projectService.removeDcOffsetSelectionOnTracks(
      'project-remove-dc', { start: 0.002, end: 0.008 },
      [{ trackId: 'track-a', clips: [{ clipId: 'a', sourceOffset: 0, sampleData: source }] }],
    );

    expect(changed).toBe(1);
    expect(save).toHaveBeenCalledTimes(1);
    const record = writes()[0];
    expect(pcm(record, 0)).toEqual(Float32Array.from([1, 1, -5, -3, -1, 1, 3, 5, 20, 20]));
    expect(pcm(record, 1)).toEqual(Float32Array.from([10, 10, 0, 0, 0, 0, 0, 0, 30, 30]));
    expect(source[0]).toEqual(Float32Array.from([1, 1, 3, 5, 7, 9, 11, 13, 20, 20]));
    expect(save.mock.calls[0][0].selection).toEqual({ start: 0.002, end: 0.008 });
    expect(audioEngine.cacheBuffer).toHaveBeenCalledTimes(1);
  });

  it('uses one per-channel mean across selected clips and preserves clip geometry', async () => {
    const project = makeProject();
    project.tracks = [track('track-a', [
      { ...clip('a', 0, 0.004), duration: 0.004, originalDuration: 0.004 },
      {
        ...clip('a2', 0.004, 0.004),
        duration: 0.004,
        originalDuration: 0.004,
        stretchRatio: 2,
        offset: 0.002,
      },
    ])];
    setCurrentProject(project);
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    await projectService.removeDcOffsetSelectionOnTracks(
      project.id, { start: 0, end: 0.008 },
      [{
        trackId: 'track-a',
        clips: [
          { clipId: 'a', sourceOffset: 0, sampleData: [Float32Array.from([1, 3, 5, 7])] },
          { clipId: 'a2', sourceOffset: 0, sampleData: [Float32Array.from([9, 11, 13, 15])] },
        ],
      }],
    );

    expect(pcm(writes()[0])).toEqual(Float32Array.from([-7, -5, -3, -1]));
    expect(pcm(writes()[1])).toEqual(Float32Array.from([1, 3, 5, 7]));
    expect(save.mock.calls[0][0].tracks[0].clips[1]).toMatchObject({
      startTime: 0.004,
      duration: 0.004,
      originalDuration: 0.004,
      stretchRatio: 2,
      offset: 0.002,
    });
  });

  it('performs no writes when any target is invalid', async () => {
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    await expect(projectService.removeDcOffsetSelectionOnTracks(
      'project-remove-dc', { start: 0, end: 0.01 },
      [target('track-a', 'a'), target('track-b', 'missing')],
    )).rejects.toThrow('目标片段不可用');
    expect(audioDb.audioBuffers.put).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(audioDb.audioBuffers.delete).not.toHaveBeenCalled();
  });

  it('deletes every staged buffer when the single project commit fails', async () => {
    vi.spyOn(projectService, 'saveProject').mockRejectedValueOnce(new Error('database locked'));
    await expect(projectService.removeDcOffsetSelectionOnTracks(
      'project-remove-dc', { start: 0, end: 0.01 },
      [target('track-a', 'a'), target('track-b', 'b')],
    )).rejects.toThrow('database locked');
    expect(audioDb.audioBuffers.delete).toHaveBeenCalledTimes(2);
    expect(audioEngine.evictBuffer).toHaveBeenCalledTimes(2);
    expect(audioEngine.cacheBuffer).not.toHaveBeenCalled();
  });
});
