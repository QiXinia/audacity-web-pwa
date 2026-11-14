import { afterEach, describe, expect, it, vi } from 'vitest';
import { audioDb } from '@/db/audioDb';
import { audioEngine } from '@/engine/audioEngine';
import { getClipSampleRange } from '@/lib/generatorEditing';
import { processSpectralEditChannels, type SpectralEditSettings } from '@/lib/spectralEditEffect';
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
  const clips = ['clip-1', 'clip-2'].map((id, index) => ({
    id,
    name: `Clip ${index + 1}`,
    audioBufferId: `buffer-${index + 1}`,
    startTime: index * 0.01,
    offset: 0,
    duration: 0.01,
    originalDuration: 0.01,
    stretchRatio: 1,
    gain: 0,
    fadeIn: 0,
    fadeOut: 0,
  }));
  return {
    id: 'spectral-edit-project',
    name: 'Spectral Edit',
    sampleRate: 1000,
    timeSignature: { numerator: 4, denominator: 4 },
    tempo: 120,
    tracks: [{
      id: 'track-1', name: 'Track 1', type: 'audio', gain: 0, pan: 0,
      muted: false, solo: false, armed: false, color: '', effects: [], clips,
    }],
    cursorPosition: 0,
    selection: { start: 0, end: 0.02 },
    viewState: { horizontalZoom: 100, verticalZoom: 1, scrollX: 0, viewMode: 'waveform' },
    updatedAt: 100,
    createdAt: 50,
  };
}

const settings: SpectralEditSettings = {
  kind: 'amplify-center',
  lowHz: 100,
  highHz: 400,
  gainDb: 6,
};

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  (projectService as unknown as { currentProject: IProject | null }).currentProject = null;
});

describe('ProjectService Spectral tools', () => {
  it('joins selected clips, replaces only selected samples and preserves timeline metadata', async () => {
    const project = makeProject();
    (projectService as unknown as { currentProject: IProject }).currentProject = project;
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    const inputs = [0, 1].map(() => Float32Array.from({ length: 10 }, (_, index) => (index + 1) / 1000));
    const targets = [{
      trackId: 'track-1',
      clips: inputs.map((sampleData, index) => ({ clipId: `clip-${index + 1}`, sourceOffset: 0, sampleData: [sampleData] })),
    }];

    const selection = { start: 0.002, end: 0.02 };
    const changed = await projectService.spectralEditSelectionOnTracks(
      project.id, selection, settings, targets,
    );
    const ranges = project.tracks[0].clips.map((clip, index) => getClipSampleRange(
      clip, selection, 0, project.sampleRate, inputs[index].length,
    )!);
    const joined = Float32Array.from(ranges.flatMap((range, index) => Array.from(
      inputs[index].slice(range.startSample, range.endSample),
    )));
    const expected = processSpectralEditChannels([joined], settings, project.sampleRate)[0];

    expect(changed).toBe(2);
    expect(audioDb.audioBuffers.put).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenCalledTimes(1);
    const cached = vi.mocked(audioEngine.cacheBuffer).mock.calls.map((call) => call[1][0]);
    expect(cached).toHaveLength(2);
    let cursor = 0;
    ranges.forEach((range, index) => {
      const length = range.endSample - range.startSample;
      expect(Array.from(cached[index].slice(0, range.startSample))).toEqual(Array.from(inputs[index].slice(0, range.startSample)));
      expect(Array.from(cached[index].slice(range.startSample, range.endSample))).toEqual(Array.from(expected.slice(cursor, cursor + length)));
      expect(Array.from(cached[index].slice(range.endSample))).toEqual(Array.from(inputs[index].slice(range.endSample)));
      cursor += length;
    });
    const savedClips = save.mock.calls[0][0].tracks[0].clips;
    expect(savedClips.map((clip) => [clip.startTime, clip.duration, clip.originalDuration])).toEqual([
      [0, 0.01, 0.01],
      [0.01, 0.01, 0.01],
    ]);
  });

  it('rejects zero gain, empty targets and invalid selections before any write', async () => {
    const project = makeProject();
    (projectService as unknown as { currentProject: IProject }).currentProject = project;
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    const targets = [{
      trackId: 'track-1',
      clips: [{ clipId: 'clip-1', sourceOffset: 0, sampleData: [Float32Array.from({ length: 10 }, () => 0.1)] }],
    }];
    await expect(projectService.spectralEditSelectionOnTracks(
      project.id, { start: 0, end: 0.01 }, { ...settings, gainDb: 0 }, targets,
    )).rejects.toThrow('0 dB');
    await expect(projectService.spectralEditSelectionOnTracks(
      project.id, { start: 0, end: 0.01 }, settings, [],
    )).rejects.toThrow('没有可处理');
    await expect(projectService.spectralEditSelectionOnTracks(
      project.id, { start: 0.01, end: 0.01 }, settings, targets,
    )).rejects.toThrow('正时长');
    await expect(projectService.spectralEditSelectionOnTracks(
      project.id,
      { start: 0, end: 0.01 },
      { kind: 'delete-center', lowHz: 600, highHz: null, gainDb: 0 },
      targets,
    )).rejects.toThrow('不会产生音频变化');
    expect(save).not.toHaveBeenCalled();
    expect(audioDb.audioBuffers.put).not.toHaveBeenCalled();
  });
});
