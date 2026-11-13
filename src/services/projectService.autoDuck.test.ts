import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { audioDb } from '@/db/audioDb';
import type { AudioBufferRecord } from '@/db/audioDb';
import { audioEngine } from '@/engine/audioEngine';
import type { IClip, IProject, ITrack } from '@/types/project';
import {
  DEFAULT_AUTO_DUCK_SETTINGS,
  processAutoDuckChannels,
  type AutoDuckSettings,
} from '@/lib/autoDuckEffect';
import { projectService, type AutoDuckTrackAudio } from './projectService';

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

const settings: AutoDuckSettings = {
  ...DEFAULT_AUTO_DUCK_SETTINGS,
  thresholdDb: -20,
  maximumPause: 0.3,
  outerFadeDownLen: 0.2,
  outerFadeUpLen: 0.2,
};

function clip(id: string, startTime = 0, duration = 15): IClip {
  return {
    id, audioBufferId: `buffer-${id}`, startTime, duration, originalDuration: duration,
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
    id: 'project-auto-duck', name: 'Auto Duck transaction',
    tracks: [
      track('track-a', [clip('a')]),
      track('control', [clip('control')]),
      track('track-b', [clip('b')]),
    ],
    cursorPosition: 0, selection: { start: 0, end: 15 },
    viewState: { horizontalZoom: 100, verticalZoom: 1, scrollX: 0, viewMode: 'waveform' },
    createdAt: 50, updatedAt: 100, sampleRate: 10,
    timeSignature: { numerator: 4, denominator: 4 }, tempo: 120,
  };
}

function controlPcm(): Float32Array {
  const control = new Float32Array(150);
  control.fill(1, 8, 12);
  return control;
}

function target(trackId: string, clipId: string, channels = 1): AutoDuckTrackAudio {
  return {
    trackId,
    clips: [{
      clipId,
      sourceOffset: 0,
      sampleData: trackId === 'control'
        ? [controlPcm(), ...Array.from({ length: channels - 1 }, () => new Float32Array(150))]
        : Array.from({ length: channels }, () => new Float32Array(150).fill(1)),
    }],
  };
}

function allTargets(): AutoDuckTrackAudio[] {
  return [target('track-a', 'a', 2), target('control', 'control'), target('track-b', 'b')];
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

describe('ProjectService Auto Duck transactions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setCurrentProject(makeProject());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    (projectService as unknown as { currentProject: IProject | null }).currentProject = null;
  });

  it('ducks every non-control target and never rewrites the control track', async () => {
    const project = makeProject();
    setCurrentProject(project);
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    const inputs = allTargets();
    const changed = await projectService.autoDuckSelectionOnTracks(
      project.id, { start: 0, end: 15 }, settings, inputs, 'control',
    );

    expect(changed).toBe(2);
    expect(save).toHaveBeenCalledTimes(1);
    expect(audioDb.audioBuffers.put).toHaveBeenCalledTimes(2);
    const records = writes();
    const expected = processAutoDuckChannels([new Float32Array(150).fill(1)], controlPcm(), settings, 10)[0];
    expect(pcm(records[0])).toEqual(Array.from(expected));
    expect(pcm(records[0], 1)).toEqual(Array.from(expected));
    expect(pcm(records[1])).toEqual(Array.from(expected));
    expect(save.mock.calls[0][0].tracks[1].clips[0].audioBufferId).toBe('buffer-control');
    expect(inputs[0].clips[0].sampleData[0].every((value) => value === 1)).toBe(true);
    expect(audioEngine.cacheBuffer).toHaveBeenCalledTimes(2);
  });

  it('persists the exact selection for redo and reload', async () => {
    const project = makeProject();
    project.selection = null;
    setCurrentProject(project);
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    const selection = { start: 0, end: 15 };
    await projectService.autoDuckSelectionOnTracks(
      project.id, selection, settings, allTargets(), 'control',
    );
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ selection }));
  });

  it('returns zero without writes when the control track never crosses threshold', async () => {
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    const inputs = allTargets();
    inputs[1].clips[0].sampleData = [new Float32Array(150), new Float32Array(150).fill(1)];
    const changed = await projectService.autoDuckSelectionOnTracks(
      'project-auto-duck', { start: 0, end: 15 }, settings, inputs, 'control',
    );
    expect(changed).toBe(0);
    expect(save).not.toHaveBeenCalled();
    expect(audioDb.audioBuffers.put).not.toHaveBeenCalled();
    expect(audioDb.audioBuffers.delete).not.toHaveBeenCalled();
  });

  it('rejects a missing control track or a control-only selection before processing', async () => {
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    await expect(projectService.autoDuckSelectionOnTracks(
      'project-auto-duck', { start: 0, end: 15 }, settings, allTargets(), 'missing',
    )).rejects.toThrow('控制轨不在选区音频中');
    await expect(projectService.autoDuckSelectionOnTracks(
      'project-auto-duck', { start: 0, end: 15 }, settings, [target('control', 'control')], 'control',
    )).rejects.toThrow('至少需要一条目标轨和一条控制轨');
    expect(save).not.toHaveBeenCalled();
    expect(audioDb.audioBuffers.put).not.toHaveBeenCalled();
  });

  it('maps source offsets while preserving clip timing and stretch metadata', async () => {
    const project = makeProject();
    project.tracks[0].clips[0] = {
      ...clip('a'), stretchRatio: 2, offset: 0.25, originalDuration: 7.5,
    };
    setCurrentProject(project);
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    const inputs = allTargets();
    inputs[0].clips[0].sourceOffset = 0.5;
    inputs[0].clips[0].sampleData = [new Float32Array(300).fill(1), new Float32Array(300).fill(1)];
    await projectService.autoDuckSelectionOnTracks(
      project.id, { start: 0, end: 15 }, settings, inputs, 'control',
    );
    const actual = pcm(writes()[0]);
    expect(actual.slice(0, 5)).toEqual([1, 1, 1, 1, 1]);
    expect(actual.slice(5, 155)).not.toEqual(new Array(150).fill(1));
    expect(actual.slice(155)).toEqual(new Array(145).fill(1));
    expect(save.mock.calls[0][0].tracks[0].clips[0]).toMatchObject({
      duration: 15, offset: 0.25, originalDuration: 7.5, stretchRatio: 2,
    });
  });

  it('performs no writes when any target clip is invalid', async () => {
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    await expect(projectService.autoDuckSelectionOnTracks(
      'project-auto-duck', { start: 0, end: 15 }, settings,
      [target('track-a', 'missing'), target('control', 'control'), target('track-b', 'b')], 'control',
    )).rejects.toThrow('目标片段不可用');
    expect(audioDb.audioBuffers.put).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(audioDb.audioBuffers.delete).not.toHaveBeenCalled();
  });

  it('deletes every staged target buffer when a later write fails', async () => {
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    vi.mocked(audioDb.audioBuffers.put)
      .mockResolvedValueOnce('first-write')
      .mockRejectedValueOnce(new Error('quota exceeded'));
    await expect(projectService.autoDuckSelectionOnTracks(
      'project-auto-duck', { start: 0, end: 15 }, settings, allTargets(), 'control',
    )).rejects.toThrow('quota exceeded');
    const ids = writes().map((record) => record.id);
    expect(audioDb.audioBuffers.delete).toHaveBeenCalledTimes(2);
    expect(vi.mocked(audioDb.audioBuffers.delete).mock.calls.map(([id]) => id)).toEqual(ids);
    expect(audioEngine.evictBuffer).toHaveBeenCalledTimes(2);
    expect(save).not.toHaveBeenCalled();
  });

  it('deletes every staged target buffer when the single project commit fails', async () => {
    vi.spyOn(projectService, 'saveProject').mockRejectedValueOnce(new Error('database locked'));
    await expect(projectService.autoDuckSelectionOnTracks(
      'project-auto-duck', { start: 0, end: 15 }, settings, allTargets(), 'control',
    )).rejects.toThrow('database locked');
    expect(audioDb.audioBuffers.delete).toHaveBeenCalledTimes(2);
    expect(audioEngine.evictBuffer).toHaveBeenCalledTimes(2);
    expect(audioEngine.cacheBuffer).not.toHaveBeenCalled();
  });
});
