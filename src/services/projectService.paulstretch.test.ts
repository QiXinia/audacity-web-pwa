import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { audioDb } from '@/db/audioDb';
import type { AudioBufferRecord } from '@/db/audioDb';
import { audioEngine } from '@/engine/audioEngine';
import { processPaulstretchChannels } from '@/lib/paulstretchEffect';
import type { IClip, IProject, ITrack } from '@/types/project';
import { projectService, type PaulstretchTrackAudio } from './projectService';

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
    id: 'project-paulstretch', name: 'Paulstretch transaction',
    tracks: [
      track('track-a', [clip('a', 0, 1), clip('after-a', 2, 0.5)]),
      track('track-b', [clip('b', 0, 1), clip('after-b', 2, 0.5)]),
    ],
    cursorPosition: 0, selection: { start: 0, end: 1 },
    viewState: { horizontalZoom: 100, verticalZoom: 1, scrollX: 0, viewMode: 'waveform' },
    createdAt: 50, updatedAt: 100, sampleRate: 1000,
    timeSignature: { numerator: 4, denominator: 4 }, tempo: 120,
  };
}

function target(trackId: string, clipId: string, channels = 1): PaulstretchTrackAudio {
  return {
    trackId,
    clips: [{
      clipId, sourceOffset: 0,
      sampleData: Array.from({ length: channels }, (_, channel) => (
        Float32Array.from({ length: 1000 }, (_, index) => (
          Math.sin(index * 0.07 + channel) * 0.25
        ))
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

const settings = { stretchFactor: 2, timeResolution: 0.25 };

describe('ProjectService Paulstretch transactions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setCurrentProject(makeProject());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    (projectService as unknown as { currentProject: IProject | null }).currentProject = null;
  });

  it('commits two tracks once with exact durations, warped selection and later boundaries', async () => {
    const project = makeProject();
    setCurrentProject(project);
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    const inputs = [target('track-a', 'a'), target('track-b', 'b', 2)];
    const original = structuredClone(project);
    const changed = await projectService.paulstretchSelectionOnTracks(
      project.id, { start: 0, end: 1 }, settings, inputs,
    );

    expect(changed).toBe(2);
    expect(save).toHaveBeenCalledTimes(1);
    expect(audioDb.audioBuffers.put).toHaveBeenCalledTimes(2);
    expect(pcm(writes()[0])).toHaveLength(2000);
    expect(writes()[1].channels).toBe(2);
    const saved = save.mock.calls[0][0];
    expect(saved.selection).toEqual({ start: 0, end: 2 });
    expect(saved.tracks[0].clips.map((item) => [item.id, item.startTime, item.duration])).toEqual([
      ['a', 0, 2], ['after-a', 3, 0.5],
    ]);
    expect(saved.tracks[0].clips[0]).toMatchObject({
      originalDuration: 2, offset: 0, stretchRatio: 1,
    });
    expect(saved.tracks[0].clips[0].audioBufferId).not.toBe('buffer-a');
    expect(project).toEqual(original);
    expect(inputs[0].clips[0].sampleData[0]).toHaveLength(1000);
  });

  it('splices only a partial selection and preserves source outside the selection', async () => {
    const project = makeProject();
    project.tracks = [track('track-a', [
      { ...clip('a', 0, 1), stretchRatio: 2, offset: 0.25 }, clip('after', 1.5, 0.5),
    ])];
    project.selection = null;
    setCurrentProject(project);
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    const source = Float32Array.from({ length: 1000 }, (_, index) => Math.sin(index / 30) * 0.3);
    const original = source.slice();
    await projectService.paulstretchSelectionOnTracks(
      project.id, { start: 0.25, end: 0.75 }, settings,
      [{ trackId: 'track-a', clips: [{ clipId: 'a', sourceOffset: 0, sampleData: [source] }] }],
    );

    const expectedMiddle = processPaulstretchChannels([source.slice(250, 750)], settings, 1000)[0];
    expect(pcm(writes()[0])).toEqual([
      ...source.slice(0, 250), ...expectedMiddle, ...source.slice(750),
    ]);
    const saved = save.mock.calls[0][0];
    expect(saved.tracks[0].clips[0]).toMatchObject({
      startTime: 0, duration: 1.5, offset: 0, originalDuration: 1.5, stretchRatio: 1,
    });
    expect(saved.tracks[0].clips[1].startTime).toBe(2);
    expect(saved.selection).toEqual({ start: 0.25, end: 1.25 });
    expect(source).toEqual(original);
  });

  it('performs no writes when any target is invalid, duplicated, incomplete or too short', async () => {
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    await expect(projectService.paulstretchSelectionOnTracks(
      'project-paulstretch', { start: 0, end: 1 }, settings,
      [target('track-a', 'a'), target('track-b', 'missing')],
    )).rejects.toThrow('目标片段不可用');
    await expect(projectService.paulstretchSelectionOnTracks(
      'project-paulstretch', { start: 0, end: 2.5 }, settings, [target('track-a', 'a')],
    )).rejects.toThrow('选区片段覆盖不完整');
    await expect(projectService.paulstretchSelectionOnTracks(
      'project-paulstretch', { start: 0, end: 1 },
      { ...settings, stretchFactor: 0 }, [target('track-a', 'a')],
    )).rejects.toThrow('拉伸倍数');
    await expect(projectService.paulstretchSelectionOnTracks(
      'project-paulstretch', { start: 0, end: 0.1 }, settings, [target('track-a', 'a')],
    )).rejects.toThrow('选区太短');
    expect(audioDb.audioBuffers.put).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('rejects non-finite source samples before any staged write', async () => {
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    const invalid = target('track-a', 'a');
    invalid.clips[0].sampleData[0][400] = Number.NaN;
    await expect(projectService.paulstretchSelectionOnTracks(
      'project-paulstretch', { start: 0, end: 1 }, settings, [invalid],
    )).rejects.toThrow('非有限');
    expect(audioDb.audioBuffers.put).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('rolls back every staged buffer when a later audio write fails', async () => {
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    vi.mocked(audioDb.audioBuffers.put)
      .mockResolvedValueOnce('first-write')
      .mockRejectedValueOnce(new Error('quota exceeded'));
    await expect(projectService.paulstretchSelectionOnTracks(
      'project-paulstretch', { start: 0, end: 1 }, settings,
      [target('track-a', 'a'), target('track-b', 'b')],
    )).rejects.toThrow('quota exceeded');

    const ids = writes().map((record) => record.id);
    expect(audioDb.audioBuffers.delete).toHaveBeenCalledTimes(2);
    expect(vi.mocked(audioDb.audioBuffers.delete).mock.calls.map(([id]) => id)).toEqual(ids);
    expect(audioEngine.evictBuffer).toHaveBeenCalledTimes(2);
    expect(save).not.toHaveBeenCalled();
  });
});
