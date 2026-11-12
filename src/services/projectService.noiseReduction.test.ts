import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { audioDb, type AudioBufferRecord } from '@/db/audioDb';
import { audioEngine } from '@/engine/audioEngine';
import type { IClip, IProject, ITrack } from '@/types/project';
import {
  DEFAULT_NOISE_REDUCTION_SETTINGS,
  processNoiseReductionChannels,
} from '@/lib/noiseReductionEffect';
import { projectService, type NoiseReductionTrackAudio } from './projectService';

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

function input(length = 4096): Float32Array {
  let state = 0x87654321;
  const result = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    result[index] = Math.fround((state / 0x100000000 - 0.5) * 0.06);
  }
  return result;
}

function clip(id: string, startTime = 0, duration = 4.096): IClip {
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
    id: 'project-noise-reduction',
    name: 'Noise Reduction transaction',
    tracks: [track('track-a', [clip('a')]), track('track-b', [clip('b')])],
    cursorPosition: 0,
    selection: { start: 0, end: 4.096 },
    viewState: { horizontalZoom: 100, verticalZoom: 1, scrollX: 0, viewMode: 'waveform' },
    createdAt: 50,
    updatedAt: 100,
    sampleRate: 1000,
    timeSignature: { numerator: 4, denominator: 4 },
    tempo: 120,
  };
}

function makeTarget(project: IProject, trackId: string): NoiseReductionTrackAudio {
  const sourceTrack = project.tracks.find(({ id }) => id === trackId)!;
  return {
    trackId,
    clips: sourceTrack.clips.map((sourceClip) => ({
      clipId: sourceClip.id,
      sourceOffset: 0,
      sampleData: [input(Math.round(sourceClip.duration * project.sampleRate))],
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

describe('ProjectService Noise Reduction transactions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setCurrentProject(makeProject());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    (projectService as unknown as { currentProject: IProject | null }).currentProject = null;
  });

  it('learns a weighted profile without any project or audio-buffer writes', async () => {
    const project = makeProject();
    setCurrentProject(project);
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    const profile = await projectService.learnNoiseReductionProfile(
      project.id,
      { start: 0, end: 4.096 },
      [makeTarget(project, 'track-a'), makeTarget(project, 'track-b')],
    );
    expect(profile.sampleRate).toBe(1000);
    expect(profile.totalWindows).toBe(10);
    expect(profile.means).toHaveLength(1025);
    expect(audioDb.audioBuffers.put).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('processes two tracks and commits every replacement buffer exactly once', async () => {
    const project = makeProject();
    setCurrentProject(project);
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    const targets = [makeTarget(project, 'track-a'), makeTarget(project, 'track-b')];
    const originals = targets.map((target) => new Float32Array(target.clips[0].sampleData[0]));
    const profile = await projectService.learnNoiseReductionProfile(
      project.id, { start: 0, end: 4.096 }, [targets[0]],
    );
    const changed = await projectService.noiseReductionSelectionOnTracks(
      project.id,
      { start: 0, end: 4.096 },
      DEFAULT_NOISE_REDUCTION_SETTINGS,
      profile,
      targets,
    );
    expect(changed).toBe(2);
    expect(save).toHaveBeenCalledTimes(1);
    expect(audioDb.audioBuffers.put).toHaveBeenCalledTimes(2);
    writes().forEach((record, index) => {
      const expected = processNoiseReductionChannels(
        [originals[index]], profile, DEFAULT_NOISE_REDUCTION_SETTINGS,
      );
      expect(pcm(record)).toEqual(expected[0]);
      expect(targets[index].clips[0].sampleData[0]).toEqual(originals[index]);
    });
    expect(save.mock.calls[0][0].selection).toEqual({ start: 0, end: 4.096 });
    expect(project.tracks[0].clips[0].audioBufferId).toBe('buffer-a');
  });

  it('rejects a profile sample-rate mismatch before any write', async () => {
    const project = makeProject();
    setCurrentProject(project);
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    const target = makeTarget(project, 'track-a');
    const profile = await projectService.learnNoiseReductionProfile(
      project.id, { start: 0, end: 4.096 }, [target],
    );
    await expect(projectService.noiseReductionSelectionOnTracks(
      project.id,
      { start: 0, end: 4.096 },
      DEFAULT_NOISE_REDUCTION_SETTINGS,
      { ...profile, sampleRate: 44100 },
      [target],
    )).rejects.toThrow('sample rate of the noise profile must match');
    expect(audioDb.audioBuffers.put).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('deletes all staged buffers when a later audio write fails', async () => {
    const project = makeProject();
    setCurrentProject(project);
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    const targets = [makeTarget(project, 'track-a'), makeTarget(project, 'track-b')];
    const profile = await projectService.learnNoiseReductionProfile(
      project.id, { start: 0, end: 4.096 }, [targets[0]],
    );
    vi.mocked(audioDb.audioBuffers.put)
      .mockResolvedValueOnce('first-write')
      .mockRejectedValueOnce(new Error('quota exceeded'));
    await expect(projectService.noiseReductionSelectionOnTracks(
      project.id,
      { start: 0, end: 4.096 },
      DEFAULT_NOISE_REDUCTION_SETTINGS,
      profile,
      targets,
    )).rejects.toThrow('quota exceeded');
    const ids = writes().map((record) => record.id);
    expect(vi.mocked(audioDb.audioBuffers.delete).mock.calls.map(([id]) => id)).toEqual(ids);
    expect(audioEngine.evictBuffer).toHaveBeenCalledTimes(2);
    expect(save).not.toHaveBeenCalled();
  });
});
