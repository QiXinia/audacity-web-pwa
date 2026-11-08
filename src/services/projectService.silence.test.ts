import { afterEach, describe, expect, it, vi } from 'vitest';
import { audioDb } from '@/db/audioDb';
import { audioEngine } from '@/engine/audioEngine';
import { projectService } from '@/services/projectService';
import type { IClip, IProject } from '@/types/project';

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

function makeClip(id: string, startTime: number, offset: number): IClip {
  return {
    id,
    audioBufferId: 'shared-source',
    startTime,
    offset,
    duration: 1,
    originalDuration: 4,
    stretchRatio: 1,
    gain: 0,
    fadeIn: 0,
    fadeOut: 0,
  };
}

function makeProject(): IProject {
  return {
    id: 'silence-project',
    name: 'Silence selection',
    sampleRate: 10,
    timeSignature: { numerator: 4, denominator: 4 },
    tempo: 120,
    tracks: [{
      id: 'track',
      name: 'Track',
      type: 'audio',
      gain: 0,
      pan: 0,
      muted: false,
      solo: false,
      armed: false,
      color: '',
      effects: [],
      clips: [makeClip('left', 0, 0), makeClip('right', 1, 1)],
    }],
    cursorPosition: 0,
    selection: { start: 1.25, end: 1.75 },
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

describe('ProjectService silence selection', () => {
  it('copy-on-writes only overlapping clips and preserves every clip boundary', async () => {
    const project = makeProject();
    (projectService as unknown as { currentProject: IProject }).currentProject = project;
    const left = Float32Array.from({ length: 40 }, (_, index) => index + 1);
    const right = Float32Array.from({ length: 40 }, (_, index) => index + 101);
    const originalLeft = new Float32Array(left);
    const originalRight = new Float32Array(right);
    vi.spyOn(projectService, 'loadAudioChannels').mockResolvedValue([left, right]);
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    const beforeBoundaries = project.tracks[0].clips.map((clip) => ({
      startTime: clip.startTime,
      duration: clip.duration,
      offset: clip.offset,
      originalDuration: clip.originalDuration,
      stretchRatio: clip.stretchRatio,
    }));

    await expect(projectService.silenceSelectionOnTrack(
      project.id,
      'track',
      { start: 1.25, end: 1.75 },
    )).resolves.toBe(1);

    const [unchanged, changed] = project.tracks[0].clips;
    expect(unchanged.audioBufferId).toBe('shared-source');
    expect(changed.audioBufferId).not.toBe('shared-source');
    expect(project.tracks[0].clips.map((clip) => ({
      startTime: clip.startTime,
      duration: clip.duration,
      offset: clip.offset,
      originalDuration: clip.originalDuration,
      stretchRatio: clip.stretchRatio,
    }))).toEqual(beforeBoundaries);
    expect(left).toEqual(originalLeft);
    expect(right).toEqual(originalRight);

    const put = vi.mocked(audioDb.audioBuffers.put);
    expect(put).toHaveBeenCalledTimes(1);
    const record = put.mock.calls[0][0];
    const storedLeft = new Float32Array(record.channelData[0]);
    const storedRight = new Float32Array(record.channelData[1]);
    // Clip-local 0.25–0.75 + offset 1 => source 1.25–1.75 s => samples 12–18.
    expect(Array.from(storedLeft.slice(12, 18))).toEqual(new Array(6).fill(0));
    expect(Array.from(storedRight.slice(12, 18))).toEqual(new Array(6).fill(0));
    expect(storedLeft[11]).toBe(originalLeft[11]);
    expect(storedLeft[18]).toBe(originalLeft[18]);
    expect(vi.mocked(audioEngine.cacheBuffer)).toHaveBeenCalledWith(
      changed.audioBufferId,
      expect.any(Array),
      10,
    );
    expect(save).toHaveBeenCalledWith(project);
  });

  it('does not write a buffer or project when the track has no selected samples', async () => {
    const project = makeProject();
    (projectService as unknown as { currentProject: IProject }).currentProject = project;
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();

    await expect(projectService.silenceSelectionOnTrack(
      project.id,
      'track',
      { start: 8, end: 9 },
    )).resolves.toBe(0);
    expect(vi.mocked(audioDb.audioBuffers.put)).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('rejects an invalid selection before touching project data', async () => {
    await expect(projectService.silenceSelectionOnTrack(
      'missing',
      'track',
      { start: 1, end: 1 },
    )).rejects.toThrow(/正时长/);
    expect(vi.mocked(audioDb.audioBuffers.put)).not.toHaveBeenCalled();
  });
});

describe('ProjectService multi-track silence selection', () => {
  function makeTwoTrackProject(): IProject {
    const project = makeProject();
    const second = structuredClone(project.tracks[0]);
    second.id = 'track-2';
    second.clips = [{ ...makeClip('second', 1, 1), audioBufferId: 'second-source' }];
    project.tracks.push(second);
    return project;
  }

  it('copy-on-writes overlapping clips across tracks and saves once', async () => {
    const project = makeTwoTrackProject();
    (projectService as unknown as { currentProject: IProject }).currentProject = project;
    vi.spyOn(projectService, 'loadAudioChannels').mockImplementation(async () => [
      Float32Array.from({ length: 40 }, (_, index) => index + 1),
      Float32Array.from({ length: 40 }, (_, index) => index + 101),
    ]);
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();

    await expect(projectService.silenceSelectionOnTracks(
      project.id, ['track', 'track-2'], { start: 1.25, end: 1.75 },
    )).resolves.toBe(2);

    expect(vi.mocked(audioDb.audioBuffers.put)).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenCalledTimes(1);
    const saved = save.mock.calls[0][0];
    expect(saved.tracks[0].clips[0].audioBufferId).toBe('shared-source');
    expect(saved.tracks[0].clips[1].audioBufferId).not.toBe('shared-source');
    expect(saved.tracks[1].clips[0].audioBufferId).not.toBe('second-source');
    expect(project.tracks[0].clips[1].audioBufferId).toBe('shared-source');
    expect(project.tracks[1].clips[0].audioBufferId).toBe('second-source');
    for (const call of vi.mocked(audioDb.audioBuffers.put).mock.calls) {
      const record = call[0];
      expect(Array.from(new Float32Array(record.channelData[0]).slice(12, 18)))
        .toEqual(new Array(6).fill(0));
      expect(Array.from(new Float32Array(record.channelData[1]).slice(12, 18)))
        .toEqual(new Array(6).fill(0));
    }
  });

  it('does not commit partial silence when a later track has unavailable audio', async () => {
    const project = makeTwoTrackProject();
    (projectService as unknown as { currentProject: IProject }).currentProject = project;
    vi.spyOn(projectService, 'loadAudioChannels').mockImplementation(async (bufferId) =>
      bufferId === 'second-source' ? null : [new Float32Array(40)]);
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();

    await expect(projectService.silenceSelectionOnTracks(
      project.id, ['track', 'track-2'], { start: 1.25, end: 1.75 },
    )).rejects.toThrow(/音频不可用/);

    expect(vi.mocked(audioDb.audioBuffers.put)).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(project.tracks[0].clips[1].audioBufferId).toBe('shared-source');
  });
});
