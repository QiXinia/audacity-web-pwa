import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { audioDb, type AudioBufferRecord } from '@/db/audioDb';
import { audioEngine } from '@/engine/audioEngine';
import type { IClip, IProject, ITrack } from '@/types/project';
import {
  CLICK_REMOVAL_INEFFECTIVE_ERROR,
  DEFAULT_CLICK_REMOVAL_SETTINGS,
  processClickRemovalChannels,
} from '@/lib/clickRemovalEffect';
import { projectService, type ClickRemovalTrackAudio } from './projectService';

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

function officialInput(length = 8192): Float32Array {
  const input = new Float32Array(length);
  for (let index = 0; index < input.length; index += 1) {
    input[index] = Math.fround((((index * 37) % 2001) - 1000) / 50000);
  }
  if (length > 5005) {
    for (let index = 1500; index < 1503; index += 1) {
      input[index] = Math.fround(input[index] + Math.fround(index % 2 ? -0.9 : 0.9));
    }
    for (let index = 5000; index < 5005; index += 1) {
      input[index] = Math.fround(input[index] + Math.fround(index % 2 ? 0.8 : -0.8));
    }
  }
  return input;
}

function clip(id: string, startTime = 0, duration = 8.192): IClip {
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
    id: 'project-click-removal',
    name: 'Click Removal transaction',
    tracks: [track('track-a', [clip('a')]), track('track-b', [clip('b')])],
    cursorPosition: 0,
    selection: { start: 0, end: 8.192 },
    viewState: { horizontalZoom: 100, verticalZoom: 1, scrollX: 0, viewMode: 'waveform' },
    createdAt: 50,
    updatedAt: 100,
    sampleRate: 1000,
    timeSignature: { numerator: 4, denominator: 4 },
    tempo: 120,
  };
}

function makeTarget(project: IProject, trackId: string, channels = 1): ClickRemovalTrackAudio {
  const sourceTrack = project.tracks.find(({ id }) => id === trackId)!;
  return {
    trackId,
    clips: sourceTrack.clips.map((sourceClip) => ({
      clipId: sourceClip.id,
      sourceOffset: 0,
      sampleData: Array.from(
        { length: channels },
        () => officialInput(Math.round(sourceClip.duration * project.sampleRate)),
      ),
    })),
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

describe('ProjectService Click Removal transactions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setCurrentProject(makeProject());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    (projectService as unknown as { currentProject: IProject | null }).currentProject = null;
  });

  it('processes two tracks and commits all replacement buffers exactly once', async () => {
    const project = makeProject();
    setCurrentProject(project);
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    const inputs = [makeTarget(project, 'track-a'), makeTarget(project, 'track-b')];
    const originals = inputs.map((input) => new Float32Array(input.clips[0].sampleData[0]));
    const changed = await projectService.clickRemovalSelectionOnTracks(
      project.id,
      { start: 0, end: 8.192 },
      DEFAULT_CLICK_REMOVAL_SETTINGS,
      inputs,
    );

    expect(changed).toBe(2);
    expect(save).toHaveBeenCalledTimes(1);
    expect(audioDb.audioBuffers.put).toHaveBeenCalledTimes(2);
    writes().forEach((record, index) => {
      const expected = processClickRemovalChannels(
        [originals[index]],
        DEFAULT_CLICK_REMOVAL_SETTINGS,
      );
      expect(pcm(record)).toEqual(expected.sampleData[0]);
      expect(inputs[index].clips[0].sampleData[0]).toEqual(originals[index]);
    });
    expect(save.mock.calls[0][0].tracks[0].clips[0].audioBufferId).not.toBe('buffer-a');
    expect(save.mock.calls[0][0].selection).toEqual({ start: 0, end: 8.192 });
    expect(project.tracks[0].clips[0].audioBufferId).toBe('buffer-a');
    expect(audioEngine.cacheBuffer).toHaveBeenCalledTimes(2);
  });

  it('joins short clips across a timeline gap before processing and writes both edges', async () => {
    const project = makeProject();
    project.tracks = [track('track-a', [clip('a', 0, 3), clip('b', 4, 3)])];
    setCurrentProject(project);
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    const input = makeTarget(project, 'track-a');
    input.clips[0].sampleData[0][1500] = 0.9;
    input.clips[1].sampleData[0][1000] = -0.9;
    const changed = await projectService.clickRemovalSelectionOnTracks(
      project.id, { start: 0, end: 7 }, DEFAULT_CLICK_REMOVAL_SETTINGS, [input],
    );
    expect(changed).toBe(2);
    expect(writes()).toHaveLength(2);
    expect(save).toHaveBeenCalledTimes(1);
    expect(pcm(writes()[0])).toHaveLength(3000);
    expect(pcm(writes()[1])).toHaveLength(3000);
  });

  it('rejects a <=4096-sample per-track selection without any writes', async () => {
    const project = makeProject();
    setCurrentProject(project);
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    await expect(projectService.clickRemovalSelectionOnTracks(
      project.id, { start: 0, end: 4.096 }, DEFAULT_CLICK_REMOVAL_SETTINGS,
      [makeTarget(project, 'track-a')],
    )).rejects.toThrow('Selection must be larger than 4096 samples.');
    expect(audioDb.audioBuffers.put).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('reports the official ineffective-audio error without committing unchanged audio', async () => {
    const project = makeProject();
    setCurrentProject(project);
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    const input = makeTarget(project, 'track-a');
    input.clips[0].sampleData = [new Float32Array(8192)];
    await expect(projectService.clickRemovalSelectionOnTracks(
      project.id, { start: 0, end: 8.192 }, DEFAULT_CLICK_REMOVAL_SETTINGS, [input],
    )).rejects.toThrow(CLICK_REMOVAL_INEFFECTIVE_ERROR);
    expect(audioDb.audioBuffers.put).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('honors zero-parameter skip without a project or history-producing write', async () => {
    const project = makeProject();
    setCurrentProject(project);
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    const changed = await projectService.clickRemovalSelectionOnTracks(
      project.id, { start: 0, end: 8.192 }, { threshold: 0, width: 20 },
      [makeTarget(project, 'track-a')],
    );
    expect(changed).toBe(0);
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
    await expect(projectService.clickRemovalSelectionOnTracks(
      project.id, { start: 0, end: 8.192 }, DEFAULT_CLICK_REMOVAL_SETTINGS,
      [makeTarget(project, 'track-a'), makeTarget(project, 'track-b')],
    )).rejects.toThrow('quota exceeded');
    const ids = writes().map((record) => record.id);
    expect(vi.mocked(audioDb.audioBuffers.delete).mock.calls.map(([id]) => id)).toEqual(ids);
    expect(audioEngine.evictBuffer).toHaveBeenCalledTimes(2);
    expect(save).not.toHaveBeenCalled();
  });
});
