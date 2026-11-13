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

function makeProject(): IProject {
  return {
    id: 'split-project',
    name: 'Split',
    sampleRate: 10,
    timeSignature: { numerator: 4, denominator: 4 },
    tempo: 120,
    tracks: [{
      id: 'stereo-track',
      name: 'Stereo',
      type: 'audio',
      gain: 3,
      pan: 0,
      muted: false,
      solo: false,
      armed: false,
      color: '',
      effects: [],
      clips: [{
        id: 'stereo-clip',
        audioBufferId: 'stereo-buffer',
        startTime: 0.2,
        offset: 0,
        duration: 2,
        originalDuration: 2,
        stretchRatio: 1,
        gain: 0,
        fadeIn: 0,
        fadeOut: 0,
        name: 'Original',
      }],
    }],
    cursorPosition: 0,
    selection: null,
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

describe('ProjectService split stereo tracks', () => {
  it('replaces one stereo track with hard-panned left and right mono tracks', async () => {
    const project = makeProject();
    (projectService as unknown as { currentProject: IProject }).currentProject = project;
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    const left = new Float32Array([0.1, 0.2, 0.3]);
    const right = new Float32Array([0.4, 0.5, 0.6]);

    const created = await projectService.splitStereoToMonoTracks(project.id, [{
      trackId: 'stereo-track',
      clips: [{ clipId: 'stereo-clip', sourceOffset: 0, sampleData: [left, right] }],
    }]);

    expect(created).toBe(2);
    expect(vi.mocked(audioDb.audioBuffers.put)).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenCalledTimes(1);
    const saved = save.mock.calls[0][0];
    expect(saved.tracks).toHaveLength(2);
    expect(saved.tracks.map((track) => track.pan)).toEqual([-1, 1]);
    expect(saved.tracks.map((track) => track.name)).toEqual(['Stereo L', 'Stereo R']);
    expect(saved.tracks[0].clips[0].startTime).toBe(0.2);
    expect(saved.tracks[0].clips[0].name).toBe('Original L');
    expect(saved.tracks[1].clips[0].name).toBe('Original R');
    expect(vi.mocked(audioEngine.cacheBuffer).mock.calls[0][1][0]).toEqual(left);
    expect(vi.mocked(audioEngine.cacheBuffer).mock.calls[1][1][0]).toEqual(right);
  });

  it('rejects incomplete clip coverage before writing', async () => {
    const project = makeProject();
    (projectService as unknown as { currentProject: IProject }).currentProject = project;
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();

    await expect(projectService.splitStereoToMonoTracks(project.id, [{
      trackId: 'stereo-track',
      clips: [],
    }])).rejects.toThrow(/片段覆盖不完整/);
    expect(vi.mocked(audioDb.audioBuffers.put)).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('rejects a mono clip instead of guessing a split', async () => {
    const project = makeProject();
    (projectService as unknown as { currentProject: IProject }).currentProject = project;
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();

    await expect(projectService.splitStereoToMonoTracks(project.id, [{
      trackId: 'stereo-track',
      clips: [{
        clipId: 'stereo-clip',
        sourceOffset: 0,
        sampleData: [new Float32Array(3)],
      }],
    }])).rejects.toThrow(/无法拆分的 1 声道/);
    expect(vi.mocked(audioDb.audioBuffers.put)).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });
});
