import { afterEach, describe, expect, it, vi } from 'vitest';
import { audioDb } from '@/db/audioDb';
import { audioEngine } from '@/engine/audioEngine';
import { projectService } from '@/services/projectService';
import type { IProject } from '@/types/project';

vi.mock('@/db/audioDb', () => ({
  audioDb: {
    projects: {},
    audioBuffers: { put: vi.fn() },
    clipboard: {},
    historySnapshots: {},
  },
  serializeTracks: (tracks: unknown) => JSON.stringify(tracks),
  deserializeTracks: (data: string) => JSON.parse(data),
  serializeSelection: (selection: unknown) => selection ? JSON.stringify(selection) : null,
  deserializeSelection: (data: string | null) => data ? JSON.parse(data) : null,
}));

vi.mock('@/engine/audioEngine', () => ({
  audioEngine: { cacheBuffer: vi.fn() },
}));

function makeProject(): IProject {
  return {
    id: 'generator-project', name: 'Generator replacement', sampleRate: 10,
    timeSignature: { numerator: 4, denominator: 4 }, tempo: 120,
    tracks: [{
      id: 'track', name: 'Track', type: 'audio', gain: 0, pan: 0,
      muted: false, solo: false, armed: false, color: '', effects: [],
      clips: [{
        id: 'source', audioBufferId: 'source-buffer', startTime: 0, offset: 0,
        duration: 4, originalDuration: 4, stretchRatio: 1, gain: 0, fadeIn: 0, fadeOut: 0,
      }],
    }],
    cursorPosition: 0, selection: { start: 1, end: 2 },
    viewState: { horizontalZoom: 100, verticalZoom: 1, scrollX: 0, viewMode: 'waveform' },
    updatedAt: 100, createdAt: 50,
  };
}

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  (projectService as unknown as { currentProject: IProject | null }).currentProject = null;
});

describe('ProjectService generated selection replacement', () => {
  it('stores one generated buffer and atomically replaces the selected timeline range', async () => {
    const project = makeProject();
    (projectService as unknown as { currentProject: IProject }).currentProject = project;
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    const samples = Float32Array.from({ length: 10 }, (_, index) => index / 10);

    const generated = await projectService.addRecordingToTrack(
      project.id, 'track', [samples], 10, 1, 'Tone', { start: 1, end: 2 },
    );

    expect(generated).toMatchObject({ startTime: 1, duration: 1, offset: 0 });
    expect(project.tracks[0].clips.map((clip) => ({
      startTime: clip.startTime, duration: clip.duration, offset: clip.offset,
    }))).toEqual([
      { startTime: 0, duration: 1, offset: 0 },
      { startTime: 1, duration: 1, offset: 0 },
      { startTime: 2, duration: 2, offset: 2 },
    ]);
    expect(vi.mocked(audioDb.audioBuffers.put)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(audioEngine.cacheBuffer)).toHaveBeenCalledWith(
      generated!.audioBufferId, [samples], 10,
    );
    expect(save).toHaveBeenCalledWith(project);
  });

  it('keeps legacy cursor insertion unchanged when no replacement is requested', async () => {
    const project = makeProject();
    (projectService as unknown as { currentProject: IProject }).currentProject = project;
    vi.spyOn(projectService, 'saveProject').mockResolvedValue();

    await projectService.addRecordingToTrack(
      project.id, 'track', [new Float32Array(10)], 10, 3, 'Cursor tone',
    );

    expect(project.tracks[0].clips.map((clip) => clip.id)).toHaveLength(2);
    expect(project.tracks[0].clips[0]).toMatchObject({ id: 'source', duration: 4 });
    expect(project.tracks[0].clips[1]).toMatchObject({ startTime: 3, duration: 1 });
  });

  it('rejects a mismatched replacement before writing a buffer or project', async () => {
    const project = makeProject();
    (projectService as unknown as { currentProject: IProject }).currentProject = project;
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();

    await expect(projectService.addRecordingToTrack(
      project.id, 'track', [new Float32Array(5)], 10, 1, 'Bad tone', { start: 1, end: 2 },
    )).rejects.toThrow(/exactly cover/);
    expect(vi.mocked(audioDb.audioBuffers.put)).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });
});
