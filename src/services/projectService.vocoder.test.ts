import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { audioDb } from '@/db/audioDb';
import type { AudioBufferRecord } from '@/db/audioDb';
import { audioEngine } from '@/engine/audioEngine';
import type { IClip, IProject, ITrack } from '@/types/project';
import { DEFAULT_VOCODER_SETTINGS, type VocoderSettings } from '@/lib/vocoderEffect';
import { projectService, type VocoderTrackAudio } from './projectService';

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

const settings: VocoderSettings = { ...DEFAULT_VOCODER_SETTINGS, bandCount: 10 };

function clip(id: string): IClip {
  return {
    id, audioBufferId: `buffer-${id}`, startTime: 0, duration: 1, originalDuration: 1,
    stretchRatio: 1, offset: 0, gain: 0, fadeIn: 0, fadeOut: 0, name: id,
  };
}

function track(id: string, clips: IClip[]): ITrack {
  return {
    id, name: id, type: 'audio', gain: 0, pan: 0, muted: false, solo: false,
    armed: false, color: '', clips, effects: [],
  };
}

function makeProject(): IProject {
  return {
    id: 'project-vocoder', name: 'Vocoder transaction',
    tracks: [track('track-a', [clip('a')])],
    cursorPosition: 0, selection: { start: 0, end: 1 },
    viewState: { horizontalZoom: 100, verticalZoom: 1, scrollX: 0, viewMode: 'waveform' },
    createdAt: 1, updatedAt: 2, sampleRate: 8000,
    timeSignature: { numerator: 4, denominator: 4 }, tempo: 120,
  };
}

function target(channels = 1): VocoderTrackAudio {
  const data = Array.from({ length: channels }, (_, index) => {
    const output = new Float32Array(8000);
    for (let sample = 0; sample < output.length; sample += 1) {
      output[sample] = 0.7 * Math.sin(2 * Math.PI * (120 + index * 100) * sample / 8000);
    }
    return output;
  });
  return { trackId: 'track-a', clips: [{ clipId: 'a', sourceOffset: 0, sampleData: data }] };
}

function setCurrentProject(project: IProject) {
  (projectService as unknown as { currentProject: IProject }).currentProject = project;
}

function writes(): AudioBufferRecord[] {
  return vi.mocked(audioDb.audioBuffers.put).mock.calls.map(([record]) => record);
}

describe('ProjectService Vocoder transactions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setCurrentProject(makeProject());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    (projectService as unknown as { currentProject: IProject | null }).currentProject = null;
  });

  it('commits processed mono audio once and replaces the clip buffer reference', async () => {
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    const changed = await projectService.vocoderSelectionOnTracks(
      'project-vocoder',
      { start: 0, end: 1 },
      settings,
      [target()],
    );
    expect(changed).toBe(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(audioDb.audioBuffers.put).toHaveBeenCalledTimes(1);
    const record = writes()[0];
    expect(record.channelData).toHaveLength(1);
    expect(new Float32Array(record.channelData[0])).toHaveLength(8000);
    expect(audioEngine.cacheBuffer).toHaveBeenCalledTimes(1);
  });

  it('preserves both stereo channels and performs no writes on invalid targets', async () => {
    const save = vi.spyOn(projectService, 'saveProject').mockResolvedValue();
    await projectService.vocoderSelectionOnTracks(
      'project-vocoder',
      { start: 0, end: 1 },
      { ...settings, outputChoice: 'bothChannels' },
      [target(2)],
    );
    expect(writes()[0].channelData).toHaveLength(2);
    expect(save).toHaveBeenCalledTimes(1);

    vi.clearAllMocks();
    const bad = { ...target(), clips: [{ ...target().clips[0], clipId: 'missing' }] };
    await expect(projectService.vocoderSelectionOnTracks(
      'project-vocoder',
      { start: 0, end: 1 },
      settings,
      [bad],
    )).rejects.toThrow('目标片段不可用');
    expect(audioDb.audioBuffers.put).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });
});
