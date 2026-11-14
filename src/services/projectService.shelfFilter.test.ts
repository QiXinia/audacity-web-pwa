import { afterEach, describe, expect, it, vi } from 'vitest';
import { audioDb } from '@/db/audioDb';
import { audioEngine } from '@/engine/audioEngine';
import {
  DEFAULT_SHELF_FILTER_SETTINGS,
  processShelfFilterChannels,
} from '@/lib/shelfFilterEffect';
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
    id: 'shelf-filter-project',
    name: 'Shelf Filter',
    sampleRate: 1000,
    timeSignature: { numerator: 4, denominator: 4 },
    tempo: 120,
    tracks: [{
      id: 'track-1', name: 'Track 1', type: 'audio', gain: 0, pan: 0,
      muted: false, solo: false, armed: false, color: '', effects: [],
      clips: [{
        id: 'clip-1', audioBufferId: 'buffer-1', startTime: 0, offset: 0,
        duration: 0.01, originalDuration: 0.01, stretchRatio: 1, gain: 0, fadeIn: 0, fadeOut: 0,
      }],
    }],
    cursorPosition: 0,
    selection: { start: 0, end: 0.01 },
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

describe('ProjectService Shelf Filter', () => {
  it('atomically replaces only selected samples while preserving timeline and unselected prefix', async () => {
    const project = makeProject();
    (projectService as unknown as { currentProject: IProject }).currentProject = project;
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    const input = [Float32Array.from([0.2, 0.4, -0.8, 0.7, -0.3, 0.1, 0.9, -0.6, 0.2, -0.1])];
    const targets = [{ trackId: 'track-1', clips: [{ clipId: 'clip-1', sourceOffset: 0, sampleData: input }] }];
    const settings = { type: 'low' as const, frequencyHz: 100, gainDb: 6 };

    const changed = await projectService.shelfFilterSelectionOnTracks(
      project.id, { start: 0.002, end: 0.008 }, settings, targets,
    );
    const expected = processShelfFilterChannels(
      [input[0].slice(2, 8)], settings, project.sampleRate,
    )[0];

    expect(changed).toBe(1);
    expect(audioDb.audioBuffers.put).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledTimes(1);
    const cached = vi.mocked(audioEngine.cacheBuffer).mock.calls[0][1][0];
    expect(Array.from(cached.slice(0, 2))).toEqual(Array.from(input[0].slice(0, 2)));
    expect(Array.from(cached.slice(2, 8))).toEqual(Array.from(expected));
    expect(Array.from(cached.slice(8))).toEqual(Array.from(input[0].slice(8)));
    const clip = save.mock.calls[0][0].tracks[0].clips[0];
    expect(clip.duration).toBe(0.01);
    expect(clip.originalDuration).toBe(0.01);
  });

  it('rejects empty targets and invalid Nyquist settings before any write', async () => {
    const project = makeProject();
    (projectService as unknown as { currentProject: IProject }).currentProject = project;
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    await expect(projectService.shelfFilterSelectionOnTracks(
      project.id, { start: 0, end: 0.01 }, DEFAULT_SHELF_FILTER_SETTINGS, [],
    )).rejects.toThrow();
    await expect(projectService.shelfFilterSelectionOnTracks(
      project.id,
      { start: 0, end: 0.01 },
      { type: 'high', frequencyHz: 500, gainDb: 6 },
      [{ trackId: 'track-1', clips: [] }],
    )).rejects.toThrow('Nyquist');
    expect(save).not.toHaveBeenCalled();
    expect(audioDb.audioBuffers.put).not.toHaveBeenCalled();
  });
});
