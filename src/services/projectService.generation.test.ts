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
    expect(save).toHaveBeenCalledTimes(1);
    const savedProject = save.mock.calls[0][0];
    expect(savedProject).not.toBe(project);
    expect(savedProject.tracks[0].clips.map((clip) => ({
      startTime: clip.startTime, duration: clip.duration, offset: clip.offset,
    }))).toEqual([
      { startTime: 0, duration: 1, offset: 0 },
      { startTime: 1, duration: 1, offset: 0 },
      { startTime: 2, duration: 2, offset: 2 },
    ]);
    expect(project.tracks[0].clips).toHaveLength(1);
    expect(vi.mocked(audioDb.audioBuffers.put)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(audioEngine.cacheBuffer)).toHaveBeenCalledWith(
      generated!.audioBufferId, [samples], 10,
    );
  });

  it('keeps legacy cursor insertion unchanged when no replacement is requested', async () => {
    const project = makeProject();
    (projectService as unknown as { currentProject: IProject }).currentProject = project;
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();

    await projectService.addRecordingToTrack(
      project.id, 'track', [new Float32Array(10)], 10, 3, 'Cursor tone',
    );

    const savedProject = save.mock.calls[0][0];
    expect(savedProject.tracks[0].clips.map((clip) => clip.id)).toHaveLength(2);
    expect(savedProject.tracks[0].clips[0]).toMatchObject({ id: 'source', duration: 4 });
    expect(savedProject.tracks[0].clips[1]).toMatchObject({ startTime: 3, duration: 1 });
    expect(project.tracks[0].clips).toHaveLength(1);
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

describe('ProjectService multi-track generation', () => {
  function makeTwoTrackProject(): IProject {
    const project = makeProject();
    const second = structuredClone(project.tracks[0]);
    second.id = 'track-2';
    second.clips[0].id = 'source-2';
    project.tracks.push(second);
    return project;
  }

  it('stores independent audio per track and commits the project once', async () => {
    const project = makeTwoTrackProject();
    (projectService as unknown as { currentProject: IProject }).currentProject = project;
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    const samples = Float32Array.from({ length: 10 }, (_, index) => index / 10);

    const clips = await projectService.addGeneratedAudioToTracks(project.id, [
      { trackId: 'track', sampleData: [samples] },
      { trackId: 'track-2', sampleData: [samples] },
    ], 10, 1, 'Tone', { start: 1, end: 2 });

    expect(clips).toHaveLength(2);
    expect(new Set(clips.map((clip) => clip.id)).size).toBe(2);
    expect(new Set(clips.map((clip) => clip.audioBufferId)).size).toBe(2);
    expect(vi.mocked(audioDb.audioBuffers.put)).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenCalledTimes(1);
    const saved = save.mock.calls[0][0];
    expect(saved).not.toBe(project);
    expect(saved.tracks.map((track) => track.clips.length)).toEqual([3, 3]);
    expect(project.tracks.map((track) => track.clips.length)).toEqual([1, 1]);

    const cacheCalls = vi.mocked(audioEngine.cacheBuffer).mock.calls;
    const first = cacheCalls[0][1][0];
    const second = cacheCalls[1][1][0];
    expect(first).not.toBe(second);
    expect(first).not.toBe(samples);
    first[0] = 99;
    expect(second[0]).toBe(0);
    expect(samples[0]).toBe(0);
  });

  it('validates every target before storing bytes or changing the project', async () => {
    const project = makeTwoTrackProject();
    (projectService as unknown as { currentProject: IProject }).currentProject = project;
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();

    await expect(projectService.addGeneratedAudioToTracks(project.id, [
      { trackId: 'track', sampleData: [new Float32Array(10)] },
      { trackId: 'track-2', sampleData: [new Float32Array(5)] },
    ], 10, 1, 'Bad tone', { start: 1, end: 2 })).rejects.toThrow(/exactly cover/);

    expect(vi.mocked(audioDb.audioBuffers.put)).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(project.tracks.map((track) => track.clips.length)).toEqual([1, 1]);
  });

  it('removes every staged buffer when a later track write fails', async () => {
    const project = makeTwoTrackProject();
    (projectService as unknown as { currentProject: IProject }).currentProject = project;
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    vi.mocked(audioDb.audioBuffers.put)
      .mockResolvedValueOnce('first-buffer')
      .mockRejectedValueOnce(new Error('quota exceeded'));

    await expect(projectService.addGeneratedAudioToTracks(project.id, [
      { trackId: 'track', sampleData: [new Float32Array(10)] },
      { trackId: 'track-2', sampleData: [new Float32Array(10)] },
    ], 10, 1, 'Tone', { start: 1, end: 2 })).rejects.toThrow('quota exceeded');

    const pendingIds = vi.mocked(audioDb.audioBuffers.put).mock.calls.map(([record]) => record.id);
    expect(vi.mocked(audioDb.audioBuffers.delete).mock.calls.map(([id]) => id)).toEqual(pendingIds);
    expect(vi.mocked(audioEngine.evictBuffer).mock.calls.map(([id]) => id)).toEqual(pendingIds);
    expect(vi.mocked(audioEngine.cacheBuffer)).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(project.tracks.map((track) => track.clips.length)).toEqual([1, 1]);
  });

  it('removes staged buffers and avoids caching when the project commit fails', async () => {
    const project = makeTwoTrackProject();
    (projectService as unknown as { currentProject: IProject }).currentProject = project;
    const save = vi.spyOn(projectService, 'saveProject').mockRejectedValue(new Error('save failed'));

    await expect(projectService.addGeneratedAudioToTracks(project.id, [
      { trackId: 'track', sampleData: [new Float32Array(10)] },
      { trackId: 'track-2', sampleData: [new Float32Array(10)] },
    ], 10, 1, 'Tone', { start: 1, end: 2 })).rejects.toThrow('save failed');

    const pendingIds = vi.mocked(audioDb.audioBuffers.put).mock.calls.map(([record]) => record.id);
    expect(vi.mocked(audioDb.audioBuffers.delete).mock.calls.map(([id]) => id)).toEqual(pendingIds);
    expect(vi.mocked(audioEngine.evictBuffer).mock.calls.map(([id]) => id)).toEqual(pendingIds);
    expect(vi.mocked(audioEngine.cacheBuffer)).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledTimes(1);
    expect(project.tracks.map((track) => track.clips.length)).toEqual([1, 1]);
  });

  it('continues cleanup and reports cleanup failures without hiding the commit error', async () => {
    const project = makeTwoTrackProject();
    (projectService as unknown as { currentProject: IProject }).currentProject = project;
    vi.spyOn(projectService, 'saveProject').mockRejectedValue(new Error('save failed'));
    vi.mocked(audioDb.audioBuffers.delete)
      .mockRejectedValueOnce(new Error('delete failed'))
      .mockResolvedValueOnce(undefined);

    await expect(projectService.addGeneratedAudioToTracks(project.id, [
      { trackId: 'track', sampleData: [new Float32Array(10)] },
      { trackId: 'track-2', sampleData: [new Float32Array(10)] },
    ], 10, 1, 'Tone', { start: 1, end: 2 })).rejects.toMatchObject({
      name: 'AggregateError',
      message: expect.stringMatching(/清理失败/),
      errors: [expect.objectContaining({ message: 'save failed' }), expect.objectContaining({ message: 'delete failed' })],
    });

    expect(vi.mocked(audioDb.audioBuffers.delete)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(audioEngine.evictBuffer)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(audioEngine.cacheBuffer)).not.toHaveBeenCalled();
  });
});

describe('ProjectService recording transaction', () => {
  it('discards staged recording and preserves the undo snapshot when the project commit fails', async () => {
    const project = makeProject();
    (projectService as unknown as { currentProject: IProject }).currentProject = project;
    const originalClips = project.tracks[0].clips;
    const save = vi.spyOn(projectService, 'saveProject').mockRejectedValue(new Error('recording commit failed'));

    await expect(projectService.addRecordingToTrack(
      project.id, 'track', [new Float32Array(10)], 10, 3, 'Recording',
    )).rejects.toThrow('recording commit failed');

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

describe('ProjectService Repeat selection transaction', () => {
  function makeRepeatProject(): IProject {
    const project = makeProject();
    const second = structuredClone(project.tracks[0]);
    second.id = 'track-2';
    second.clips[0].id = 'source-2';
    project.tracks.push(second);
    return project;
  }

  it('shares one staged buffer per track, shifts following audio and commits the expanded selection once', async () => {
    const project = makeRepeatProject();
    (projectService as unknown as { currentProject: IProject }).currentProject = project;
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    const first = Float32Array.from({ length: 10 }, (_, index) => index / 10);
    const second = Float32Array.from({ length: 10 }, (_, index) => 1 - index / 10);

    const inserted = await projectService.repeatSelectionOnTracks(
      project.id, { start: 1, end: 2 }, 2, [
        { trackId: 'track', sampleData: [first] },
        { trackId: 'track-2', sampleData: [second] },
      ],
    );

    expect(inserted).toHaveLength(4);
    expect(new Set(inserted.map((clip) => clip.id)).size).toBe(4);
    expect(new Set(inserted.map((clip) => clip.audioBufferId)).size).toBe(2);
    expect(inserted.filter((clip) => clip.startTime === 2)[0].audioBufferId)
      .toBe(inserted.filter((clip) => clip.startTime === 3)[0].audioBufferId);
    expect(vi.mocked(audioDb.audioBuffers.put)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(audioEngine.cacheBuffer)).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenCalledTimes(1);

    const saved = save.mock.calls[0][0];
    expect(saved.selection).toEqual({ start: 1, end: 4 });
    expect(saved.tracks.map((track) => track.clips.length)).toEqual([4, 4]);
    expect(saved.tracks[0].clips.map((clip) => ({
      startTime: clip.startTime, duration: clip.duration, offset: clip.offset,
    }))).toEqual([
      { startTime: 0, duration: 2, offset: 0 },
      { startTime: 2, duration: 1, offset: 0 },
      { startTime: 3, duration: 1, offset: 0 },
      { startTime: 4, duration: 2, offset: 2 },
    ]);
    expect(project.selection).toEqual({ start: 1, end: 2 });
    expect(project.tracks.map((track) => track.clips.length)).toEqual([1, 1]);
    first[0] = 99;
    const storedFirst = vi.mocked(audioDb.audioBuffers.put).mock.calls[0][0].channelData[0];
    expect(new Float32Array(storedFirst)[0]).not.toBe(99);
  });

  it('cleans every staged Repeat buffer when a later track write fails', async () => {
    const project = makeRepeatProject();
    (projectService as unknown as { currentProject: IProject }).currentProject = project;
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    vi.mocked(audioDb.audioBuffers.put)
      .mockResolvedValueOnce('first-repeat-buffer')
      .mockRejectedValueOnce(new Error('repeat quota exceeded'));

    await expect(projectService.repeatSelectionOnTracks(
      project.id, { start: 1, end: 2 }, 1, [
        { trackId: 'track', sampleData: [new Float32Array(10)] },
        { trackId: 'track-2', sampleData: [new Float32Array(10)] },
      ],
    )).rejects.toThrow('repeat quota exceeded');

    const pendingIds = vi.mocked(audioDb.audioBuffers.put).mock.calls.map(([record]) => record.id);
    expect(vi.mocked(audioDb.audioBuffers.delete).mock.calls.map(([id]) => id)).toEqual(pendingIds);
    expect(vi.mocked(audioEngine.evictBuffer).mock.calls.map(([id]) => id)).toEqual(pendingIds);
    expect(vi.mocked(audioEngine.cacheBuffer)).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(project.tracks.map((track) => track.clips.length)).toEqual([1, 1]);
  });

  it('rejects invalid counts and sample lengths before writing bytes or project history', async () => {
    const project = makeRepeatProject();
    (projectService as unknown as { currentProject: IProject }).currentProject = project;
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    const targets = [{ trackId: 'track', sampleData: [new Float32Array(10)] }];

    await expect(projectService.repeatSelectionOnTracks(
      project.id, { start: 1, end: 2 }, 0, targets,
    )).rejects.toThrow(/整数/);
    await expect(projectService.repeatSelectionOnTracks(
      project.id, { start: 1, end: 2 }, 1.5, targets,
    )).rejects.toThrow(/整数/);
    await expect(projectService.repeatSelectionOnTracks(
      project.id, { start: 1, end: 2 }, 1,
      [{ trackId: 'track', sampleData: [new Float32Array(5)] }],
    )).rejects.toThrow(/等长/);

    expect(vi.mocked(audioDb.audioBuffers.put)).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(project.tracks[0].clips).toHaveLength(1);
  });
});
