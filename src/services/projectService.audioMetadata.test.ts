import { beforeEach, describe, expect, it, vi } from 'vitest';
import { audioDb, type AudioBufferRecord } from '@/db/audioDb';
import { projectService } from '@/services/projectService';

vi.mock('@/db/audioDb', () => ({
  audioDb: {
    projects: {}, audioBuffers: { get: vi.fn(), put: vi.fn(), delete: vi.fn() },
    clipboard: {}, historySnapshots: {},
  },
  serializeTracks: (tracks: unknown) => JSON.stringify(tracks),
  deserializeTracks: (data: string) => JSON.parse(data),
  serializeSelection: (selection: unknown) => selection ? JSON.stringify(selection) : null,
  deserializeSelection: (data: string | null) => data ? JSON.parse(data) : null,
}));
vi.mock('@/engine/audioEngine', () => ({
  audioEngine: { cacheBuffer: vi.fn(), evictBuffer: vi.fn(), getCachedBuffer: vi.fn(() => null) },
}));
vi.mock('@/wasm/processor', () => ({
  isWasmAvailable: vi.fn(() => false),
  wasmProcessor: { spectrogram: vi.fn(), sliceBuffer: vi.fn() },
}));

const source: AudioBufferRecord = {
  id: 'buffer-a', projectId: 'project-a', sampleRate: 500, channels: 1,
  length: 2, duration: 0.004,
  channelData: [Float32Array.from([-0.25, -0.25]).buffer], createdAt: 1,
};

describe('ProjectService audio buffer metadata', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(audioDb.audioBuffers.get as unknown as (
      id: string,
    ) => Promise<AudioBufferRecord | undefined>).mockImplementation(async (id: string) => (
      id === source.id ? source : undefined
    ));
  });

  it('returns original source metadata without exposing or resampling channel data', async () => {
    await expect(projectService.loadAudioBufferMetadata('buffer-a')).resolves.toEqual({
      id: 'buffer-a', sampleRate: 500, channels: 1, length: 2, duration: 0.004,
    });
    const projected = await projectService.loadAudioChannels('buffer-a', 1000);
    expect(projected?.[0]).toHaveLength(4);
    await expect(projectService.loadAudioBufferMetadata('buffer-a')).resolves.toMatchObject({
      sampleRate: 500, length: 2, duration: 0.004,
    });
  });

  it('returns null for a missing source record', async () => {
    await expect(projectService.loadAudioBufferMetadata('missing')).resolves.toBeNull();
  });
});
