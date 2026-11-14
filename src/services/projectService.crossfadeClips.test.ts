import { afterEach, describe, expect, it, vi } from 'vitest';
import { audioDb } from '@/db/audioDb';
import { audioEngine } from '@/engine/audioEngine';
import { projectService } from '@/services/projectService';
import type { IProject } from '@/types/project';

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

function makeTwoClipProject(): IProject {
  const baseClip = {
    audioBufferId: 'old-buffer',
    offset: 0,
    originalDuration: 0.004,
    gain: 1,
    fadeIn: 0,
    fadeOut: 0,
  };
  return {
    id: 'crossfade-project',
    name: 'Crossfade Clips',
    sampleRate: 1000,
    timeSignature: { numerator: 4, denominator: 4 },
    tempo: 120,
    tracks: [{
      id: 'track-1',
      name: 'Track 1',
      type: 'audio',
      gain: 1,
      pan: 0,
      muted: false,
      solo: false,
      armed: false,
      color: '',
      effects: [],
      clips: [
        { ...baseClip, id: 'clip-1', startTime: 0, duration: 0.004 },
        { ...baseClip, id: 'clip-2', startTime: 0.006, duration: 0.004 },
      ],
    }],
    cursorPosition: 0,
    selection: { start: 0.002, end: 0.008 },
    viewState: { horizontalZoom: 100, verticalZoom: 1, scrollX: 0, viewMode: 'waveform' },
    updatedAt: 100,
    createdAt: 50,
  };
}

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  (projectService as unknown as { currentProject: IProject | null }).currentProject = null;
});

describe('ProjectService Crossfade Clips', () => {
  it('merges selected tail and head across a gap while preserving outside portions', async () => {
    const project = makeTwoClipProject();
    (projectService as unknown as { currentProject: IProject }).currentProject = project;
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    const first = Float32Array.from([1, 1, 1, 1]);
    const second = Float32Array.from([1, 1, 1, 1]);
    const target = {
      trackId: 'track-1',
      clips: [
        { clipId: 'clip-1', sourceOffset: 0, sampleData: [first] },
        { clipId: 'clip-2', sourceOffset: 0, sampleData: [second] },
      ],
    };

    const changed = await projectService.crossfadeClipsSelection(
      project.id,
      { start: 0.002, end: 0.008 },
      target,
    );
    const savedProject = save.mock.calls[0][0];
    const savedTrack = savedProject.tracks[0];
    const clips = savedTrack.clips;

    expect(changed).toBe(1);
    expect(audioDb.audioBuffers.put).toHaveBeenCalledTimes(1);
    expect(audioEngine.cacheBuffer).toHaveBeenCalledTimes(1);
    expect(clips).toHaveLength(3);
    expect(clips[0].id).toBe('clip-1');
    expect(clips[0].duration).toBeCloseTo(0.002, 10);
    expect(clips[1].startTime).toBeCloseTo(0.002, 10);
    expect(clips[1].duration).toBeCloseTo(0.006, 10);
    expect(clips[1].name).toBe('Crossfade Clips');
    expect(clips[2].startTime).toBeCloseTo(0.008, 10);
    expect(clips[2].offset).toBeCloseTo(0.002, 10);
    expect(clips[2].duration).toBeCloseTo(0.002, 10);
  });

  it('crossfades a continuous clip from its midpoint', async () => {
    const continuous = makeTwoClipProject();
    const clip = continuous.tracks[0].clips[0];
    continuous.tracks[0].clips = [{
      ...clip,
      id: 'continuous-clip',
      startTime: 0,
      duration: 0.01,
      originalDuration: 0.01,
    }];
    continuous.selection = { start: 0, end: 0.01 };
    (projectService as unknown as { currentProject: IProject }).currentProject = continuous;
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();

    const changed = await projectService.crossfadeClipsSelection(
      continuous.id,
      { start: 0, end: 0.01 },
      {
        trackId: 'track-1',
        clips: [{
          clipId: 'continuous-clip',
          sourceOffset: 0,
          sampleData: [Float32Array.from(Array(10).fill(1))],
        }],
      },
    );

    const merged = save.mock.calls[0][0].tracks[0].clips[0];
    expect(changed).toBe(1);
    expect(merged.startTime).toBeCloseTo(0, 10);
    expect(merged.duration).toBeCloseTo(0.01, 10);
  });

  it('rejects selections spanning more than one track before writing', async () => {
    const project = makeTwoClipProject();
    project.tracks.push({
      ...project.tracks[0],
      id: 'track-2',
      clips: [{
        ...project.tracks[0].clips[0],
        id: 'other-clip',
        startTime: 0.002,
        duration: 0.002,
      }],
    });
    (projectService as unknown as { currentProject: IProject }).currentProject = project;
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();

    await expect(projectService.crossfadeClipsSelection(
      project.id,
      { start: 0.002, end: 0.008 },
      {
        trackId: 'track-1',
        clips: [
          { clipId: 'clip-1', sourceOffset: 0, sampleData: [new Float32Array(4)] },
          { clipId: 'clip-2', sourceOffset: 0, sampleData: [new Float32Array(4)] },
        ],
      },
    )).rejects.toThrow('一条轨道');
    expect(save).not.toHaveBeenCalled();
  });
});
