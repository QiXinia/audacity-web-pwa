import { afterEach, describe, expect, it, vi } from 'vitest';
import { audioDb } from '@/db/audioDb';
import { audioEngine } from '@/engine/audioEngine';
import { projectService } from '@/services/projectService';
import { DEFAULT_CROSSFADE_SETTINGS } from '@/lib/crossfadeTracksEffect';
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

function makeProject(): IProject {
  const tracks = [1, 2].map((index) => ({
    id: `track-${index}`,
    name: `Track ${index}`,
    type: 'audio' as const,
    gain: 0,
    pan: 0,
    muted: false,
    solo: false,
    armed: false,
    color: '',
    effects: [],
    clips: [{
      id: `clip-${index}`,
      audioBufferId: `buffer-${index}`,
      startTime: 0,
      offset: 0,
      duration: 4,
      originalDuration: 4,
      stretchRatio: 1,
      gain: 0,
      fadeIn: 0,
      fadeOut: 0,
    }],
  }));
  return {
    id: 'crossfade-project',
    name: 'Crossfade',
    sampleRate: 10,
    timeSignature: { numerator: 4, denominator: 4 },
    tempo: 120,
    tracks,
    cursorPosition: 0,
    selection: { start: 1, end: 2 },
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

describe('ProjectService crossfade tracks', () => {
  it('fades the upper track out and lower track in with one atomic commit', async () => {
    const project = makeProject();
    (projectService as unknown as { currentProject: IProject }).currentProject = project;
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    const targets = project.tracks.map((track) => ({
      trackId: track.id,
      clips: [{
        clipId: track.clips[0].id,
        sourceOffset: 0,
        sampleData: [new Float32Array(40).fill(1)],
      }],
    }));

    const changed = await projectService.crossfadeSelectionOnTracks(
      project.id,
      { start: 0.9, end: 2 },
      { ...DEFAULT_CROSSFADE_SETTINGS, direction: 'out-in' },
      targets,
    );

    expect(changed).toBe(2);
    expect(vi.mocked(audioDb.audioBuffers.put)).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenCalledTimes(1);
    const saved = save.mock.calls[0][0];
    const upper = vi.mocked(audioEngine.cacheBuffer).mock.calls[0][1][0];
    const lower = vi.mocked(audioEngine.cacheBuffer).mock.calls[1][1][0];
    expect(upper[9]).toBe(1);
    expect(upper[14]).toBeCloseTo(0.5, 6);
    expect(upper[14]).toBeCloseTo(1 - lower[14], 6);
    expect(lower[9]).toBe(0);
    expect(saved.selection).toEqual({ start: 0.9, end: 2 });
  });

  it('rejects fewer than two tracks before storing any buffer or project', async () => {
    const project = makeProject();
    (projectService as unknown as { currentProject: IProject }).currentProject = project;
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();

    await expect(projectService.crossfadeSelectionOnTracks(
      project.id,
      { start: 1, end: 2 },
      DEFAULT_CROSSFADE_SETTINGS,
      [],
    )).rejects.toThrow(/至少需要两条/);
    expect(vi.mocked(audioDb.audioBuffers.put)).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });
});
