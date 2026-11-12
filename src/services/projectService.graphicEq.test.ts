import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { audioDb, type AudioBufferRecord } from '@/db/audioDb';
import {
  DEFAULT_GRAPHIC_EQ_SETTINGS,
  GRAPHIC_EQ_BAND_COUNT,
  processGraphicEqChannels,
  type GraphicEqSettings,
} from '@/lib/graphicEqEffect';
import type { IClip, IProject, ITrack } from '@/types/project';
import { projectService, type GraphicEqTrackAudio } from './projectService';

vi.mock('@/db/audioDb', () => ({
  audioDb: {
    projects: {}, audioBuffers: { put: vi.fn(), delete: vi.fn() }, clipboard: {}, historySnapshots: {},
  },
  serializeTracks: (tracks: unknown) => JSON.stringify(tracks),
  deserializeTracks: (data: string) => JSON.parse(data),
  serializeSelection: (selection: unknown) => selection ? JSON.stringify(selection) : null,
  deserializeSelection: (data: string | null) => data ? JSON.parse(data) : null,
}));
vi.mock('@/engine/audioEngine', () => ({ audioEngine: { cacheBuffer: vi.fn(), evictBuffer: vi.fn() } }));

const gainsDb = Array(GRAPHIC_EQ_BAND_COUNT).fill(0) as number[];
gainsDb[7] = 6; gainsDb[17] = -3;
const settings: GraphicEqSettings = { gainsDb };

function clip(id: string, duration = 0.00125): IClip {
  return {
    id, audioBufferId: `buffer-${id}`, startTime: 0, duration, originalDuration: duration,
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
    id: 'project-graphic-eq', name: 'Graphic EQ transaction',
    tracks: [track('track-a', [clip('a')]), track('track-b', [clip('b')])],
    cursorPosition: 0, selection: { start: 0, end: 0.00125 },
    viewState: { horizontalZoom: 100, verticalZoom: 1, scrollX: 0, viewMode: 'waveform' },
    createdAt: 50, updatedAt: 100, sampleRate: 8000,
    timeSignature: { numerator: 4, denominator: 4 }, tempo: 120,
  };
}
const source = () => Float32Array.from([0, 0.1, -0.2, 0.25, 0.5, -0.25, 0.125, -0.05, 0.2, -0.1]);
function target(trackId: string, clipId: string, channels: Float32Array[] = [source()]): GraphicEqTrackAudio {
  return { trackId, clips: [{ clipId, sourceOffset: 0, sampleData: channels }] };
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

describe('ProjectService Graphic EQ transactions', () => {
  beforeEach(() => { vi.clearAllMocks(); setCurrentProject(makeProject()); });
  afterEach(() => {
    vi.restoreAllMocks();
    (projectService as unknown as { currentProject: IProject | null }).currentProject = null;
  });

  it('processes all targets before one commit and preserves unselected PCM', async () => {
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    const left = source();
    const stereo = [source(), Float32Array.from(source(), (sample) => sample * 0.5)];
    const changed = await projectService.graphicEqSelectionOnTracks(
      'project-graphic-eq', { start: 0.00025, end: 0.001 }, settings,
      [target('track-a', 'a', [left]), target('track-b', 'b', stereo)],
    );
    expect(changed).toBe(2);
    expect(save).toHaveBeenCalledTimes(1);
    const records = writes();
    const monoExpected = processGraphicEqChannels([left.slice(2, 8)], settings, 8000)[0];
    expect(pcm(records[0]).slice(0, 2)).toEqual(left.slice(0, 2));
    expect(pcm(records[0]).slice(2, 8)).toEqual(monoExpected);
    expect(pcm(records[0]).slice(8)).toEqual(left.slice(8));
    const stereoExpected = processGraphicEqChannels(stereo.map((channel) => channel.slice(2, 8)), settings, 8000);
    expect(pcm(records[1], 0).slice(2, 8)).toEqual(stereoExpected[0]);
    expect(pcm(records[1], 1).slice(2, 8)).toEqual(stereoExpected[1]);
    expect(left).toEqual(source());
    expect(stereo[1][4]).toBe(0.25);
    expect(save.mock.calls[0][0].tracks[0].clips[0].audioBufferId).not.toBe('buffer-a');
    expect(save.mock.calls[0][0].selection).toEqual({ start: 0.00025, end: 0.001 });
  });

  it('uses continuous overlap-add across clips and treats the timeline gap as silence', async () => {
    const project = makeProject();
    project.tracks = [track('track-a', [
      { ...clip('a', 0.000625) },
      { ...clip('a2', 0.00125), startTime: 0.00125, duration: 0.000625, originalDuration: 0.000625 },
    ])];
    setCurrentProject(project);
    vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    const first = Float32Array.from([0.1, 0.2, 0.1, -0.1, 0.2]);
    const second = Float32Array.from([0.4, -0.2, 0.2, 0.1, -0.1]);
    await projectService.graphicEqSelectionOnTracks(
      project.id, { start: 0, end: 0.001875 }, settings,
      [{ trackId: 'track-a', clips: [
        { clipId: 'a', sourceOffset: 0, sampleData: [first] },
        { clipId: 'a2', sourceOffset: 0, sampleData: [second] },
      ] }],
    );
    const assembled = new Float32Array(15);
    assembled.set(first, 0); assembled.set(second, 10);
    const expected = processGraphicEqChannels([assembled], settings, 8000)[0];
    const records = writes();
    expect(pcm(records[0])).toEqual(expected.slice(0, 5));
    expect(pcm(records[1])).toEqual(expected.slice(10));
    expect(first).toEqual(Float32Array.from([0.1, 0.2, 0.1, -0.1, 0.2]));
  });

  it('rejects a non-finite later track without writing the valid earlier track', async () => {
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    const invalid = source(); invalid[4] = Number.NaN;
    await expect(projectService.graphicEqSelectionOnTracks(
      'project-graphic-eq', { start: 0, end: 0.00125 }, settings,
      [target('track-a', 'a'), target('track-b', 'b', [invalid])],
    )).rejects.toThrow('非有限值');
    expect(audioDb.audioBuffers.put).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(audioDb.audioBuffers.delete).not.toHaveBeenCalled();
  });

  it('rejects incomplete or duplicate ownership before any write', async () => {
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    await expect(projectService.graphicEqSelectionOnTracks(
      'project-graphic-eq', { start: 0, end: 0.00125 }, settings,
      [{ trackId: 'track-a', clips: [] }],
    )).rejects.toThrow('完整轨道');
    await expect(projectService.graphicEqSelectionOnTracks(
      'project-graphic-eq', { start: 0, end: 0.00125 }, settings,
      [target('track-a', 'a'), target('track-a', 'a')],
    )).rejects.toThrow('重复轨道');
    expect(audioDb.audioBuffers.put).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('cleans every staged buffer when a later audio write fails', async () => {
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    vi.mocked(audioDb.audioBuffers.put)
      .mockResolvedValueOnce('first-write')
      .mockRejectedValueOnce(new Error('quota exceeded'));
    await expect(projectService.graphicEqSelectionOnTracks(
      'project-graphic-eq', { start: 0, end: 0.00125 }, settings,
      [target('track-a', 'a'), target('track-b', 'b')],
    )).rejects.toThrow('quota exceeded');
    const ids = writes().map((record) => record.id);
    expect(vi.mocked(audioDb.audioBuffers.delete).mock.calls.map(([id]) => id)).toEqual(ids);
    expect(save).not.toHaveBeenCalled();
  });

  it('cleans every staged buffer when the single project commit fails', async () => {
    vi.spyOn(projectService, 'saveProject').mockRejectedValueOnce(new Error('database locked'));
    await expect(projectService.graphicEqSelectionOnTracks(
      'project-graphic-eq', { start: 0, end: 0.00125 }, settings,
      [target('track-a', 'a'), target('track-b', 'b')],
    )).rejects.toThrow('database locked');
    expect(audioDb.audioBuffers.delete).toHaveBeenCalledTimes(2);
  });

  it('treats flat bands as a no-op without reading or writing audio', async () => {
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    await expect(projectService.graphicEqSelectionOnTracks(
      'project-graphic-eq', { start: 0, end: 0.00125 },
      DEFAULT_GRAPHIC_EQ_SETTINGS as GraphicEqSettings, [],
    )).resolves.toBe(0);
    expect(audioDb.audioBuffers.put).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });
});
