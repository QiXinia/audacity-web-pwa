import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { audioDb } from '@/db/audioDb';
import type { AudioBufferRecord } from '@/db/audioDb';
import { audioEngine } from '@/engine/audioEngine';
import {
  DEFAULT_SLIDING_STRETCH_SETTINGS,
  durationAfterSlidingStretch,
  processSlidingStretchChannels,
  slidingStretchInputTimeToOutput,
  slidingStretchSubrangeSettings,
  type SlidingStretchSettings,
} from '@/lib/slidingStretchEffect';
import type { IClip, IProject, ITrack } from '@/types/project';
import { projectService, type SlidingStretchTrackAudio } from './projectService';

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

function settings(patch: Partial<SlidingStretchSettings>): SlidingStretchSettings {
  return { ...DEFAULT_SLIDING_STRETCH_SETTINGS, ...patch };
}

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
    id: 'project-sliding-stretch',
    name: 'Sliding Stretch transaction',
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

function target(trackId: string, clipId: string, channels = 1): SlidingStretchTrackAudio {
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

describe('ProjectService Sliding Stretch transactions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setCurrentProject(makeProject());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    (projectService as unknown as { currentProject: IProject | null }).currentProject = null;
  });

  it('commits two tracks once, shortens PCM and selection, and shifts later clips', async () => {
    const project = makeProject();
    setCurrentProject(project);
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    const inputs = [target('track-a', 'a'), target('track-b', 'b', 2)];
    const changed = await projectService.slidingStretchSelectionOnTracks(
      project.id,
      { start: 0, end: 1 },
      settings({ initialTempoPercent: 100, finalTempoPercent: 100 }),
      inputs,
    );

    expect(changed).toBe(2);
    expect(save).toHaveBeenCalledTimes(1);
    expect(audioDb.audioBuffers.put).toHaveBeenCalledTimes(2);
    expect(pcm(writes()[0])).toEqual(Array.from(Float32Array.from([0, 0.2, 0.4, 0.6, 0.8])));
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

  it('uses each clip’s global slide subrange and nonlinearly warps gaps', async () => {
    const project = makeProject();
    project.tracks = [track('track-a', [
      clip('first', 0, 0.4), clip('second', 0.6, 0.4), clip('after', 1.5, 0.5),
    ])];
    setCurrentProject(project);
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    const slide = settings({ initialTempoPercent: 0, finalTempoPercent: 100 });
    await projectService.slidingStretchSelectionOnTracks(
      project.id,
      { start: 0, end: 1 },
      slide,
      [{
        trackId: 'track-a',
        clips: [
          { clipId: 'second', sourceOffset: 0, sampleData: [new Float32Array(4).fill(0.5)] },
          { clipId: 'first', sourceOffset: 0, sampleData: [new Float32Array(4).fill(0.25)] },
        ],
      }],
    );

    const saved = save.mock.calls[0][0];
    const firstSettings = slidingStretchSubrangeSettings(slide, 0, 0.4);
    const secondSettings = slidingStretchSubrangeSettings(slide, 0.6, 1);
    const expectedFirstDuration = processSlidingStretchChannels(
      [new Float32Array(4).fill(0.25)], firstSettings, 10,
    )[0].length / 10;
    const expectedSecondDuration = processSlidingStretchChannels(
      [new Float32Array(4).fill(0.5)], secondSettings, 10,
    )[0].length / 10;
    const expectedSecondStart = slidingStretchInputTimeToOutput(0.6, slide)
      * durationAfterSlidingStretch(1, slide);
    const [first, second, after] = saved.tracks[0].clips;
    expect(first.id).toBe('first');
    expect(first.startTime).toBe(0);
    expect(first.duration).toBeCloseTo(expectedFirstDuration, 12);
    expect(second.id).toBe('second');
    expect(second.startTime).toBeCloseTo(expectedSecondStart, 12);
    expect(second.duration).toBe(expectedSecondDuration);
    expect(after.startTime).toBeCloseTo(1.5 + durationAfterSlidingStretch(1, slide) - 1, 12);
    expect(saved.selection.end).toBeCloseTo(durationAfterSlidingStretch(1, slide), 12);
    expect(secondSettings.initialTempoPercent).toBeGreaterThan(firstSettings.initialTempoPercent);
  });

  it('splices a partial selection and normalizes existing stretch metadata safely', async () => {
    const project = makeProject();
    project.tracks = [track('track-a', [
      { ...clip('a', 0, 1), stretchRatio: 2, offset: 0.25 }, clip('after', 1.5, 0.5),
    ])];
    setCurrentProject(project);
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    const source = Float32Array.from({ length: 20 }, (_, index) => index / 20);
    const slide = settings({ initialTempoPercent: 100, finalTempoPercent: 100 });
    await projectService.slidingStretchSelectionOnTracks(
      project.id,
      { start: 0.25, end: 0.75 },
      slide,
      [{ trackId: 'track-a', clips: [{ clipId: 'a', sourceOffset: 0.5, sampleData: [source] }] }],
    );

    const expectedMiddle = processSlidingStretchChannels([source.slice(7, 12)], slide, 10)[0];
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

  it('skips the official all-neutral no-op without any writes', async () => {
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    await expect(projectService.slidingStretchSelectionOnTracks(
      'project-sliding-stretch', { start: 0, end: 1 }, settings({}), [target('track-a', 'a')],
    )).resolves.toBe(0);
    expect(save).not.toHaveBeenCalled();
    expect(audioDb.audioBuffers.put).not.toHaveBeenCalled();
  });

  it('performs no writes when any target is invalid or incomplete', async () => {
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    const slide = settings({ initialTempoPercent: 100, finalTempoPercent: 100 });
    await expect(projectService.slidingStretchSelectionOnTracks(
      'project-sliding-stretch', { start: 0, end: 1 }, slide,
      [target('track-a', 'a'), target('track-b', 'missing')],
    )).rejects.toThrow('目标片段不可用');
    await expect(projectService.slidingStretchSelectionOnTracks(
      'project-sliding-stretch', { start: 0, end: 2.5 }, slide,
      [target('track-a', 'a')],
    )).rejects.toThrow('选区片段覆盖不完整');
    expect(audioDb.audioBuffers.put).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('rolls back every staged buffer when a later audio write fails', async () => {
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    vi.mocked(audioDb.audioBuffers.put)
      .mockResolvedValueOnce('first-write')
      .mockRejectedValueOnce(new Error('quota exceeded'));
    await expect(projectService.slidingStretchSelectionOnTracks(
      'project-sliding-stretch',
      { start: 0, end: 1 },
      settings({ initialTempoPercent: 100, finalTempoPercent: 100 }),
      [target('track-a', 'a'), target('track-b', 'b')],
    )).rejects.toThrow('quota exceeded');

    const ids = writes().map((record) => record.id);
    expect(audioDb.audioBuffers.delete).toHaveBeenCalledTimes(2);
    expect(vi.mocked(audioDb.audioBuffers.delete).mock.calls.map(([id]) => id)).toEqual(ids);
    expect(audioEngine.evictBuffer).toHaveBeenCalledTimes(2);
    expect(save).not.toHaveBeenCalled();
  });
});
