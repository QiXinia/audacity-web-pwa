import { afterEach, describe, expect, it, vi } from 'vitest';
import { audioDb } from '@/db/audioDb';
import { audioEngine } from '@/engine/audioEngine';
import { defaultClipFixSettings } from '@/lib/clipFixEffect';
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

function makeProject(): IProject {
  return {
    id: 'clip-fix-project',
    name: 'Clip Fix',
    sampleRate: 10,
    timeSignature: { numerator: 4, denominator: 4 },
    tempo: 120,
    tracks: [{
      id: 'track-1',
      name: 'Track 1',
      type: 'audio',
      gain: 0,
      pan: 0,
      muted: false,
      solo: false,
      armed: false,
      color: '',
      effects: [],
      clips: [{
        id: 'clip-1',
        audioBufferId: 'buffer-1',
        startTime: 0,
        offset: 0,
        duration: 1,
        originalDuration: 1,
        stretchRatio: 1,
        gain: 0,
        fadeIn: 0,
        fadeOut: 0,
      }],
    }],
    cursorPosition: 0,
    selection: { start: 0, end: 1 },
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

describe('ProjectService Clip Fix', () => {
  it('replaces selected clipped audio in one atomic commit without changing duration', async () => {
    const project = makeProject();
    (projectService as unknown as { currentProject: IProject }).currentProject = project;
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    const input = [Float32Array.from([0, 0.2, 0.5, 0.95, 0.95, 0.95, 0.5, 0.2, 0, 0])];
    const targets = [{
      trackId: 'track-1',
      clips: [{ clipId: 'clip-1', sourceOffset: 0, sampleData: input }],
    }];

    const changed = await projectService.clipFixSelectionOnTracks(
      project.id,
      { start: 0, end: 1 },
      defaultClipFixSettings,
      targets,
    );

    expect(changed).toBe(1);
    expect(audioDb.audioBuffers.put).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledTimes(1);
    const cached = vi.mocked(audioEngine.cacheBuffer).mock.calls[0][1][0];
    expect(cached.length).toBe(10);
    expect(cached[4]).not.toBeCloseTo(0.95 * 10 ** (-9 / 20), 8);
    const clip = save.mock.calls[0][0].tracks[0].clips[0];
    expect(clip.duration).toBe(1);
    expect(clip.originalDuration).toBe(1);
  });

  it('rejects empty targets before writing', async () => {
    const project = makeProject();
    (projectService as unknown as { currentProject: IProject }).currentProject = project;
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    await expect(projectService.clipFixSelectionOnTracks(
      project.id,
      { start: 0, end: 1 },
      defaultClipFixSettings,
      [],
    )).rejects.toThrow();
    expect(save).not.toHaveBeenCalled();
  });
});
