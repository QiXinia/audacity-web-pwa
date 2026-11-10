import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { audioDb } from '@/db/audioDb';
import type { AudioBufferRecord } from '@/db/audioDb';
import { audioEngine } from '@/engine/audioEngine';
import { processChangePitchChannels } from '@/lib/changePitchEffect';
import type { IClip, IProject, ITrack } from '@/types/project';
import { projectService, type ChangePitchTrackAudio } from './projectService';

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
    id: 'project-change-pitch', name: 'Change Pitch transaction',
    tracks: [
      track('track-a', [clip('a', 0, 1), clip('after-a', 2, 0.5)]),
      track('track-b', [clip('b', 0, 1), clip('after-b', 2, 0.5)]),
    ],
    cursorPosition: 0, selection: { start: 0, end: 1 },
    viewState: { horizontalZoom: 100, verticalZoom: 1, scrollX: 0, viewMode: 'waveform' },
    createdAt: 50, updatedAt: 100, sampleRate: 10,
    timeSignature: { numerator: 4, denominator: 4 }, tempo: 120,
  };
}

function target(trackId: string, clipId: string, channels = 1): ChangePitchTrackAudio {
  return {
    trackId,
    clips: [{
      clipId, sourceOffset: 0,
      sampleData: Array.from({ length: channels }, (_, channel) => (
        Float32Array.from({ length: 10 }, (_, index) => Math.sin(index + channel) * 0.25)
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

describe('ProjectService Change Pitch transactions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setCurrentProject(makeProject());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    (projectService as unknown as { currentProject: IProject | null }).currentProject = null;
  });

  it('commits two tracks once with exact duration, selection and later clip boundaries', async () => {
    const project = makeProject();
    setCurrentProject(project);
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    const inputs = [target('track-a', 'a'), target('track-b', 'b', 2)];
    const original = structuredClone(project);
    const changed = await projectService.changePitchSelectionOnTracks(
      project.id, { start: 0, end: 1 }, { percentChange: 100 }, inputs,
    );

    expect(changed).toBe(2);
    expect(save).toHaveBeenCalledTimes(1);
    expect(audioDb.audioBuffers.put).toHaveBeenCalledTimes(2);
    expect(pcm(writes()[0])).toHaveLength(10);
    expect(writes()[1].channels).toBe(2);
    const saved = save.mock.calls[0][0];
    expect(saved.selection).toEqual({ start: 0, end: 1 });
    expect(saved.tracks[0].clips.map((item) => [item.id, item.startTime, item.duration])).toEqual([
      ['a', 0, 1], ['after-a', 2, 0.5],
    ]);
    expect(saved.tracks[0].clips[0]).toMatchObject({
      startTime: 0, duration: 1, originalDuration: 1, offset: 0, stretchRatio: 1,
    });
    expect(saved.tracks[0].clips[0].audioBufferId).not.toBe('buffer-a');
    expect(project).toEqual(original);
    expect(inputs[0].clips[0].sampleData[0]).toHaveLength(10);
  });

  it('splices only a partial selection and preserves trim and stretch metadata', async () => {
    const project = makeProject();
    project.tracks = [track('track-a', [
      { ...clip('a', 0, 1), stretchRatio: 2, offset: 0.25 }, clip('after', 1.5, 0.5),
    ])];
    project.selection = null;
    setCurrentProject(project);
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    const source = Float32Array.from({ length: 20 }, (_, index) => Math.sin(index / 3) * 0.3);
    const original = source.slice();
    await projectService.changePitchSelectionOnTracks(
      project.id, { start: 0.25, end: 0.75 }, { percentChange: -50 },
      [{ trackId: 'track-a', clips: [{ clipId: 'a', sourceOffset: 0.5, sampleData: [source] }] }],
    );

    const expectedMiddle = processChangePitchChannels(
      [source.slice(7, 12)], { percentChange: -50 }, 10,
    )[0];
    expect(pcm(writes()[0])).toEqual([...source.slice(0, 7), ...expectedMiddle, ...source.slice(12)]);
    const saved = save.mock.calls[0][0];
    expect(saved.tracks[0].clips[0]).toMatchObject({
      startTime: 0, duration: 1, offset: 0.25, originalDuration: 1, stretchRatio: 2,
    });
    expect(saved.tracks[0].clips[1].startTime).toBe(1.5);
    expect(saved.selection).toEqual({ start: 0.25, end: 0.75 });
    expect(source).toEqual(original);
  });

  it('skips the official zero-percent no-op without any writes', async () => {
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    await expect(projectService.changePitchSelectionOnTracks(
      'project-change-pitch', { start: 0, end: 1 }, { percentChange: 0 }, [target('track-a', 'a')],
    )).resolves.toBe(0);
    expect(save).not.toHaveBeenCalled();
    expect(audioDb.audioBuffers.put).not.toHaveBeenCalled();
  });

  it('performs no writes when any target is invalid, duplicated or incomplete', async () => {
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    await expect(projectService.changePitchSelectionOnTracks(
      'project-change-pitch', { start: 0, end: 1 }, { percentChange: 100 },
      [target('track-a', 'a'), target('track-b', 'missing')],
    )).rejects.toThrow('选区片段覆盖不完整');
    await expect(projectService.changePitchSelectionOnTracks(
      'project-change-pitch', { start: 0, end: 2.5 }, { percentChange: 100 }, [target('track-a', 'a')],
    )).rejects.toThrow('选区片段覆盖不完整');
    await expect(projectService.changePitchSelectionOnTracks(
      'project-change-pitch', { start: 0, end: 1 }, { percentChange: 3001 }, [target('track-a', 'a')],
    )).rejects.toThrow('音高变化');
    expect(audioDb.audioBuffers.put).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('rejects non-finite source samples before any staged write', async () => {
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    const invalid = target('track-a', 'a');
    invalid.clips[0].sampleData[0][4] = Number.NaN;
    await expect(projectService.changePitchSelectionOnTracks(
      'project-change-pitch', { start: 0, end: 1 }, { percentChange: 100 }, [invalid],
    )).rejects.toThrow('非有限');
    expect(audioDb.audioBuffers.put).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('rolls back every staged buffer when a later audio write fails', async () => {
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    vi.mocked(audioDb.audioBuffers.put)
      .mockResolvedValueOnce('first-write')
      .mockRejectedValueOnce(new Error('quota exceeded'));
    await expect(projectService.changePitchSelectionOnTracks(
      'project-change-pitch', { start: 0, end: 1 }, { percentChange: 100 },
      [target('track-a', 'a'), target('track-b', 'b')],
    )).rejects.toThrow('quota exceeded');

    const ids = writes().map((record) => record.id);
    expect(audioDb.audioBuffers.delete).toHaveBeenCalledTimes(2);
    expect(vi.mocked(audioDb.audioBuffers.delete).mock.calls.map(([id]) => id)).toEqual(ids);
    expect(audioEngine.evictBuffer).toHaveBeenCalledTimes(2);
    expect(save).not.toHaveBeenCalled();
  });
});
