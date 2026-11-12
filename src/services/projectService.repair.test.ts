import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { audioDb, type AudioBufferRecord } from '@/db/audioDb';
import { audioEngine } from '@/engine/audioEngine';
import type { IClip, IProject, ITrack } from '@/types/project';
import { createRepairRandom, interpolateRepairAudio } from '@/lib/repairEffect';
import { projectService, type RepairTrackAudio } from './projectService';

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

function clip(id: string, startTime = 0, duration = 0.04): IClip {
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
    id: 'project-repair',
    name: 'Repair transaction',
    tracks: [track('track-a', [clip('a')]), track('track-b', [clip('b')])],
    cursorPosition: 0,
    selection: { start: 0.008, end: 0.012 },
    viewState: { horizontalZoom: 100, verticalZoom: 1, scrollX: 0, viewMode: 'waveform' },
    createdAt: 50,
    updatedAt: 100,
    sampleRate: 1000,
    timeSignature: { numerator: 4, denominator: 4 },
    tempo: 120,
  };
}

function makeTarget(project: IProject, trackId: string, channels = 2): RepairTrackAudio {
  const sourceTrack = project.tracks.find(({ id }) => id === trackId)!;
  return {
    trackId,
    clips: sourceTrack.clips.map((sourceClip, clipIndex) => ({
      clipId: sourceClip.id,
      sourceOffset: 0,
      sampleData: Array.from({ length: channels }, (_, channel) => Float32Array.from(
        { length: Math.round(sourceClip.duration * project.sampleRate) },
        (_, index) => Math.sin(index * 0.17 + clipIndex + channel * 0.4) * 0.6,
      )),
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

describe('ProjectService Repair transactions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setCurrentProject(makeProject());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    (projectService as unknown as { currentProject: IProject | null }).currentProject = null;
  });

  it('repairs both channels on two tracks with one atomic project commit', async () => {
    const project = makeProject();
    setCurrentProject(project);
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    const inputs = [makeTarget(project, 'track-a'), makeTarget(project, 'track-b')];
    const changed = await projectService.repairSelectionOnTracks(
      project.id, { start: 0.008, end: 0.012 }, inputs,
    );

    expect(changed).toBe(2);
    expect(save).toHaveBeenCalledTimes(1);
    expect(audioDb.audioBuffers.put).toHaveBeenCalledTimes(2);
    const random = createRepairRandom();
    const expected = inputs.map((input) => input.clips[0].sampleData.map((channel) => (
      interpolateRepairAudio(channel, 8, 4, random)
    )));
    writes().forEach((record, recordIndex) => {
      expected[recordIndex].forEach((channel, channelIndex) => {
        expect(pcm(record, channelIndex)).toEqual(channel);
      });
    });
    expect(inputs[0].clips[0].sampleData[0][8]).toBe(Math.fround(Math.sin(8 * 0.17) * 0.6));
    expect(save.mock.calls[0][0].tracks[0].clips[0].audioBufferId).not.toBe('buffer-a');
    expect(project.tracks[0].clips[0].audioBufferId).toBe('buffer-a');
    expect(audioEngine.cacheBuffer).toHaveBeenCalledTimes(2);
  });

  it('shares interpolation context across adjacent clips and writes only their selected edges', async () => {
    const project = makeProject();
    project.tracks = [track('track-a', [clip('a', 0, 0.02), clip('a2', 0.02, 0.02)])];
    setCurrentProject(project);
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    const input = makeTarget(project, 'track-a', 1);
    const changed = await projectService.repairSelectionOnTracks(
      project.id, { start: 0.018, end: 0.022 }, [input],
    );

    expect(changed).toBe(2);
    const context = Float32Array.from([
      ...input.clips[0].sampleData[0],
      ...input.clips[1].sampleData[0],
    ]);
    const expected = interpolateRepairAudio(context, 18, 4, createRepairRandom());
    const records = writes();
    expect(pcm(records[0])).toEqual(expected.slice(0, 20));
    expect(pcm(records[1])).toEqual(expected.slice(20));
    expect(pcm(records[0]).slice(0, 18)).toEqual(input.clips[0].sampleData[0].slice(0, 18));
    expect(pcm(records[1]).slice(2)).toEqual(input.clips[1].sampleData[0].slice(2));
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('rejects selections over 128 samples per track without writes', async () => {
    const project = makeProject();
    project.tracks = [track('track-a', [clip('a', 0, 0.2)])];
    setCurrentProject(project);
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    await expect(projectService.repairSelectionOnTracks(
      project.id, { start: 0.01, end: 0.14 }, [makeTarget(project, 'track-a')],
    )).rejects.toThrow('最多修复 128 个采样');
    expect(audioDb.audioBuffers.put).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('rejects stretched selected clips before processing', async () => {
    const project = makeProject();
    project.tracks = [track('track-a', [{ ...clip('a'), stretchRatio: 2 }])];
    setCurrentProject(project);
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    await expect(projectService.repairSelectionOnTracks(
      project.id, { start: 0.008, end: 0.012 }, [makeTarget(project, 'track-a')],
    )).rejects.toThrow('不能用于包含时间拉伸或变调剪辑的选区');
    expect(audioDb.audioBuffers.put).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('rejects a whole-track selection with no surrounding context', async () => {
    const project = makeProject();
    project.tracks = [track('track-a', [clip('a')])];
    setCurrentProject(project);
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    await expect(projectService.repairSelectionOnTracks(
      project.id, { start: 0, end: 0.04 }, [makeTarget(project, 'track-a')],
    )).rejects.toThrow('至少一侧有音频上下文');
    expect(audioDb.audioBuffers.put).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('accepts exactly 128 damaged samples when surrounding context exists', async () => {
    const project = makeProject();
    project.tracks = [track('track-a', [clip('a', 0, 0.3)])];
    setCurrentProject(project);
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    const input = makeTarget(project, 'track-a', 1);
    const changed = await projectService.repairSelectionOnTracks(
      project.id, { start: 0.01, end: 0.138 }, [input],
    );
    expect(changed).toBe(1);
    expect(writes()).toHaveLength(1);
    const actual = pcm(writes()[0]);
    expect(actual).toHaveLength(300);
    expect(actual.slice(0, 10)).toEqual(input.clips[0].sampleData[0].slice(0, 10));
    expect(actual.slice(138)).toEqual(input.clips[0].sampleData[0].slice(138));
    expect(actual.every((sample) => Number.isFinite(sample))).toBe(true);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('deletes every staged buffer when a later audio write fails', async () => {
    const project = makeProject();
    setCurrentProject(project);
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    vi.mocked(audioDb.audioBuffers.put)
      .mockResolvedValueOnce('first-write')
      .mockRejectedValueOnce(new Error('quota exceeded'));
    await expect(projectService.repairSelectionOnTracks(
      project.id, { start: 0.008, end: 0.012 },
      [makeTarget(project, 'track-a'), makeTarget(project, 'track-b')],
    )).rejects.toThrow('quota exceeded');
    const ids = writes().map((record) => record.id);
    expect(vi.mocked(audioDb.audioBuffers.delete).mock.calls.map(([id]) => id)).toEqual(ids);
    expect(audioEngine.evictBuffer).toHaveBeenCalledTimes(2);
    expect(save).not.toHaveBeenCalled();
  });
});
