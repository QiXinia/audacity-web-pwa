import { beforeEach, describe, expect, it, vi } from 'vitest';
import { audioDb } from '@/db/audioDb';
import { audioEngine } from '@/engine/audioEngine';
import type { IClip, IProject, ITrack } from '@/types/project';
import {
  DEFAULT_NOISE_GATE_SETTINGS,
  processNoiseGateChannels,
} from '@/lib/noiseGateEffect';
import { projectService } from './projectService';

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
  const clip: IClip = {
    id: 'clip-1', audioBufferId: 'old-buffer', startTime: 0, duration: 0.2,
    originalDuration: 0.2, stretchRatio: 1, offset: 0, gain: 0, fadeIn: 0, fadeOut: 0,
    name: 'clip',
  };
  const track: ITrack = {
    id: 'track-1', name: 'Track 1', type: 'audio', gain: 0, pan: 0, muted: false,
    solo: false, armed: false, color: '', clips: [clip], effects: [],
  };
  return {
    id: 'project-1', name: 'Noise Gate', tracks: [track], cursorPosition: 0,
    selection: { start: 0, end: 0.2 }, viewState: {
      horizontalZoom: 100, verticalZoom: 1, scrollX: 0, viewMode: 'waveform',
    }, createdAt: 1, updatedAt: 2, sampleRate: 1000,
    timeSignature: { numerator: 4, denominator: 4 }, tempo: 120,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  (projectService as unknown as { currentProject: IProject }).currentProject = makeProject();
});

describe('ProjectService Noise Gate', () => {
  it('commits one replacement buffer and preserves selection', async () => {
    const pcm = new Float32Array(200);
    pcm.fill(0.9, 80, 120);
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    const changed = await projectService.noiseGateSelectionOnTracks(
      'project-1',
      { start: 0, end: 0.2 },
      DEFAULT_NOISE_GATE_SETTINGS,
      [{ trackId: 'track-1', clips: [{ clipId: 'clip-1', sourceOffset: 0, sampleData: [pcm] }] }],
    );
    expect(changed).toBe(1);
    expect(audioDb.audioBuffers.put).toHaveBeenCalledTimes(1);
    const record = vi.mocked(audioDb.audioBuffers.put).mock.calls[0][0];
    const expected = processNoiseGateChannels([pcm], DEFAULT_NOISE_GATE_SETTINGS, 1000)[0];
    expect(Array.from(new Float32Array(record.channelData[0]))).toEqual(Array.from(expected));
    expect(save.mock.calls[0][0].selection).toEqual({ start: 0, end: 0.2 });
    expect(audioEngine.cacheBuffer).toHaveBeenCalledTimes(1);
  });

  it('rejects an invalid selection before writes', async () => {
    await expect(projectService.noiseGateSelectionOnTracks(
      'project-1',
      { start: 0.2, end: 0.2 },
      DEFAULT_NOISE_GATE_SETTINGS,
      [],
    )).rejects.toThrow('正时长');
    expect(audioDb.audioBuffers.put).not.toHaveBeenCalled();
  });
});
