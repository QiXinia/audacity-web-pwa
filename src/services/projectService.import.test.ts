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
  audioEngine: {
    decodeAudioFile: vi.fn(),
    cacheBuffer: vi.fn(),
    evictBuffer: vi.fn(),
  },
}));

function makeProject(): IProject {
  return {
    id: 'import-project', name: 'Import transaction', sampleRate: 10,
    timeSignature: { numerator: 4, denominator: 4 }, tempo: 120,
    tracks: [{
      id: 'track', name: 'Track', type: 'audio', gain: 0, pan: 0,
      muted: false, solo: false, armed: false, color: '', effects: [],
      clips: [{
        id: 'source', audioBufferId: 'source-buffer', startTime: 0, offset: 0,
        duration: 4, originalDuration: 4, stretchRatio: 1, gain: 0, fadeIn: 0, fadeOut: 0,
      }],
    }],
    cursorPosition: 0, selection: { start: 0, end: 0 },
    viewState: { horizontalZoom: 100, verticalZoom: 1, scrollX: 0, viewMode: 'waveform' },
    updatedAt: 100, createdAt: 50,
  };
}

function arrangeDecodedImport(project: IProject) {
  (projectService as unknown as { currentProject: IProject }).currentProject = project;
  const samples = Float32Array.from({ length: 10 }, (_, index) => index / 10);
  vi.mocked(audioEngine.decodeAudioFile).mockResolvedValue({
    channelData: [samples], sampleRate: 10, duration: 1,
  });
  const file = new File([new Uint8Array([1])], 'take.wav', { type: 'audio/wav' });
  return { file, samples };
}

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  (projectService as unknown as { currentProject: IProject | null }).currentProject = null;
});

describe('ProjectService import transaction', () => {
  it('commits a new project object before publishing imported audio to the playback cache', async () => {
    const project = makeProject();
    const { file, samples } = arrangeDecodedImport(project);
    const originalClips = project.tracks[0].clips;
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();

    const clip = await projectService.importAudioToTrack(project.id, 'track', file, 3);

    expect(clip).toMatchObject({ startTime: 3, duration: 1, name: 'take' });
    expect(save).toHaveBeenCalledTimes(1);
    const savedProject = save.mock.calls[0][0];
    expect(savedProject).not.toBe(project);
    expect(savedProject.tracks[0].clips.map(({ id }) => id)).toEqual(['source', clip!.id]);
    expect(project.tracks[0].clips).toBe(originalClips);
    expect(project.tracks[0].clips).toHaveLength(1);
    expect(vi.mocked(audioDb.audioBuffers.put)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(audioEngine.cacheBuffer)).toHaveBeenCalledWith(clip!.audioBufferId, [samples], 10);
    expect(vi.mocked(audioEngine.cacheBuffer).mock.invocationCallOrder[0]).toBeGreaterThan(
      save.mock.invocationCallOrder[0],
    );
  });

  it('discards imported audio and preserves the original project when the project commit fails', async () => {
    const project = makeProject();
    const { file } = arrangeDecodedImport(project);
    const originalClips = project.tracks[0].clips;
    const save = vi.spyOn(projectService, 'saveProject').mockRejectedValue(new Error('import commit failed'));

    await expect(projectService.importAudioToTrack(
      project.id, 'track', file, 3,
    )).rejects.toThrow('import commit failed');

    const pendingIds = vi.mocked(audioDb.audioBuffers.put).mock.calls.map(([record]) => record.id);
    expect(pendingIds).toHaveLength(1);
    expect(vi.mocked(audioDb.audioBuffers.delete).mock.calls.map(([id]) => id)).toEqual(pendingIds);
    expect(vi.mocked(audioEngine.evictBuffer).mock.calls.map(([id]) => id)).toEqual(pendingIds);
    expect(vi.mocked(audioEngine.cacheBuffer)).not.toHaveBeenCalled();
    expect(project.tracks[0].clips).toBe(originalClips);
    expect(project.tracks[0].clips).toHaveLength(1);

    const attemptedProject = save.mock.calls[0][0];
    expect(attemptedProject).not.toBe(project);
    expect(attemptedProject.tracks[0].clips).toHaveLength(2);
  });
});
