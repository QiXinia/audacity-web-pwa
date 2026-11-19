import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { audioDb, type AudioBufferRecord } from '@/db/audioDb';
import { projectService, type EchoTrackAudio } from '@/services/projectService';
import { audioEngine } from '@/engine/audioEngine';
import type { IClip, IEffect, IProject, ITrack } from '@/types/project';

vi.mock('@/db/audioDb', () => ({
  audioDb: {
    projects: {},
    audioBuffers: { get: vi.fn(), put: vi.fn(), delete: vi.fn() },
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
    cacheBuffer: vi.fn(),
    evictBuffer: vi.fn(),
    getCachedBuffer: vi.fn(() => null),
    renderRealtimeEffects: vi.fn(async (
      channels: readonly Float32Array[],
      _sampleRate: number,
      effects: readonly IEffect[],
    ) => {
      const gain = effects.find((effect) => !effect.bypassed && effect.type === 'gain')?.params.gain;
      const scale = gain === undefined ? 1 : 10 ** (gain / 20);
      return channels.map((channel) => Float32Array.from(channel, (sample) => sample * scale));
    }),
  },
}));

const buffers = new Map<string, AudioBufferRecord>();
const mutableService = projectService as unknown as { currentProject: IProject | null };

function makeClip(id: string, audioBufferId: string): IClip {
  return {
    id,
    audioBufferId,
    startTime: 0,
    offset: 0.1,
    duration: 0.2,
    originalDuration: 0.8,
    stretchRatio: 1.5,
    pitchCents: 120,
    optimizeForVoice: true,
    stretchToMatchTempo: false,
    rawAudioTempo: 100,
    clipTempo: 120,
    colorIndex: 4,
    groupId: 7,
    gain: -3,
    fadeIn: 0.05,
    fadeOut: 0.06,
    name: `${id}-name`,
  };
}

function makeTrack(id: string, channelCount: 1 | 2, clips: IClip[]): ITrack {
  return {
    id,
    name: `Track ${id}`,
    type: 'audio',
    gain: -2,
    pan: 0.35,
    muted: true,
    solo: false,
    armed: false,
    color: '#123456',
    channelCount,
    clips,
    effects: [{ id: `effect-${id}`, type: 'delay', bypassed: false, params: { delay: 0.2 } }],
  };
}

function makeProject(tracks: ITrack[]): IProject {
  return {
    id: 'channel-project',
    name: 'Channel integration',
    sampleRate: 10,
    timeSignature: { numerator: 4, denominator: 4 },
    tempo: 120,
    tracks,
    analysisLabels: [
      { id: 'left-label', kind: 'clipping', trackId: tracks[0]!.id, channelIndex: 0, start: 0, end: 0.1, text: 'left' },
      { id: 'right-label', kind: 'clipping', trackId: tracks[0]!.id, channelIndex: 1, start: 0, end: 0.1, text: 'right' },
    ],
    cursorPosition: 0,
    selection: null,
    viewState: { horizontalZoom: 100, verticalZoom: 1, scrollX: 0, viewMode: 'waveform' },
    updatedAt: 100,
    createdAt: 50,
  };
}

function seedStereo(id = 'stereo-buffer'): void {
  buffers.set(id, {
    id,
    projectId: 'channel-project',
    sampleRate: 10,
    channels: 2,
    length: 4,
    duration: 0.4,
    channelData: [Float32Array.from([1, 2, 3, 4]).buffer, Float32Array.from([10, 20, 30, 40]).buffer],
    createdAt: 1,
  });
}

function monoTarget(track: ITrack, samples: number[], sourceOffset = 0): EchoTrackAudio {
  return {
    trackId: track.id,
    clips: track.clips.map((clip) => ({
      clipId: clip.id,
      sampleData: [Float32Array.from(samples)],
      sourceOffset,
    })),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  buffers.clear();
  vi.mocked(audioDb.audioBuffers.get).mockImplementation(
    (async (id: string) => buffers.get(id)) as never,
  );
  vi.mocked(audioDb.audioBuffers.put).mockImplementation((async (record: AudioBufferRecord) => {
    buffers.set(record.id, record);
    return record.id;
  }) as never);
  vi.spyOn(projectService, 'saveProject').mockImplementation(async (project: IProject) => {
    mutableService.currentProject = project;
  });
});

afterEach(() => {
  mutableService.currentProject = null;
  vi.restoreAllMocks();
});

describe('projectService Audacity 4 track channel operations', () => {
  it('swaps real stereo PCM despite a stale mono field and preserves clip/effect metadata and labels', async () => {
    seedStereo();
    const track = makeTrack('stereo', 1, [makeClip('clip-a', 'stereo-buffer')]);
    mutableService.currentProject = makeProject([track]);
    const beforeClip = structuredClone(track.clips[0]!);

    await expect(projectService.swapStereoChannelsOnTrack('channel-project', 'stereo')).resolves.toBe(1);
    const updated = mutableService.currentProject!;
    expect(updated.tracks[0]!.clips[0]).toMatchObject({
      ...beforeClip,
      audioBufferId: expect.not.stringMatching('stereo-buffer'),
    });
    expect(updated.tracks[0]!.channelCount).toBe(2);
    expect(updated.tracks[0]!.effects).toEqual(track.effects);
    const output = buffers.get(updated.tracks[0]!.clips[0]!.audioBufferId)!;
    expect(Array.from(new Float32Array(output.channelData[0]!))).toEqual([10, 20, 30, 40]);
    expect(Array.from(new Float32Array(output.channelData[1]!))).toEqual([1, 2, 3, 4]);
    expect(Array.from(new Float32Array(buffers.get('stereo-buffer')!.channelData[0]!))).toEqual([1, 2, 3, 4]);
    expect(updated.analysisLabels!.map((label) => label.channelIndex)).toEqual([1, 0]);
    expect(projectService.saveProject).toHaveBeenCalledTimes(1);
  });

  it('splits to hard-panned mono tracks while preserving every non-destructive clip property', async () => {
    seedStereo();
    const track = makeTrack('stereo', 2, [makeClip('clip-a', 'stereo-buffer')]);
    mutableService.currentProject = makeProject([track]);

    const result = await projectService.splitStereoTrackOnTrack('channel-project', 'stereo', 'lr');
    const [left, right] = mutableService.currentProject!.tracks;
    expect(left!.id).toBe(result.leftTrackId);
    expect(right!.id).toBe(result.rightTrackId);
    expect(left!.pan).toBe(-1);
    expect(right!.pan).toBe(1);
    for (const splitTrack of [left!, right!]) {
      expect(splitTrack.name).toBe('Track stereo');
      expect(splitTrack.channelCount).toBe(1);
      expect(splitTrack.muted).toBe(true);
      expect(splitTrack.gain).toBe(-2);
      expect(splitTrack.clips[0]).toMatchObject({
        startTime: 0,
        offset: 0.1,
        duration: 0.2,
        originalDuration: 0.8,
        stretchRatio: 1.5,
        pitchCents: 120,
        optimizeForVoice: true,
        stretchToMatchTempo: false,
        rawAudioTempo: 100,
        clipTempo: 120,
        colorIndex: 4,
        groupId: 7,
        gain: -3,
        fadeIn: 0.05,
        fadeOut: 0.06,
        name: 'clip-a-name',
      });
      expect(splitTrack.effects).toHaveLength(1);
    }
    expect(left!.effects[0]!.id).not.toBe(right!.effects[0]!.id);
    expect(Array.from(new Float32Array(buffers.get(left!.clips[0]!.audioBufferId)!.channelData[0]!))).toEqual([1, 2, 3, 4]);
    expect(Array.from(new Float32Array(buffers.get(right!.clips[0]!.audioBufferId)!.channelData[0]!))).toEqual([10, 20, 30, 40]);
    expect(mutableService.currentProject!.analysisLabels!.map((label) => [label.trackId, label.channelIndex])).toEqual([
      [left!.id, 0], [right!.id, 0],
    ]);
  });

  it('keeps the source pan and name for center split and supports empty stereo tracks', async () => {
    const empty = makeTrack('empty', 2, []);
    mutableService.currentProject = makeProject([empty]);
    const result = await projectService.splitStereoTrackOnTrack('channel-project', 'empty', 'center');
    const [left, right] = mutableService.currentProject!.tracks;
    expect(left).toMatchObject({ name: 'Track empty', pan: 0.35, channelCount: 1, clips: [] });
    expect(right).toMatchObject({ name: 'Track empty', pan: 0.35, channelCount: 1, clips: [] });
    expect(result.leftTrackId).toBe(left!.id);
    expect(audioDb.audioBuffers.put).not.toHaveBeenCalled();
    expect(projectService.saveProject).toHaveBeenCalledTimes(1);
  });

  it('renders adjacent mono tracks into one hard-panned stereo clip including gaps', async () => {
    const left = makeTrack('left', 1, [{ ...makeClip('left-clip', 'left-buffer'), startTime: 0, duration: 0.4, offset: 0 }]);
    const right = makeTrack('right', 1, [{ ...makeClip('right-clip', 'right-buffer'), startTime: 0.2, duration: 0.4, offset: 0 }]);
    left.effects = [];
    right.effects = [];
    left.gain = 0;
    right.gain = 0;
    left.clips[0]!.gain = 0;
    right.clips[0]!.gain = 0;
    left.clips[0]!.fadeIn = 0;
    left.clips[0]!.fadeOut = 0;
    right.clips[0]!.fadeIn = 0;
    right.clips[0]!.fadeOut = 0;
    left.pan = 0.9;
    right.pan = -0.8;
    const keep = makeTrack('keep', 1, []);
    mutableService.currentProject = makeProject([left, right, keep]);

    const result = await projectService.makeStereoTrackFromMono('channel-project', 'left', 'right', [
      monoTarget(left, [1, 1, 1, 1]),
      monoTarget(right, [2, 2, 2, 2]),
    ]);
    const updated = mutableService.currentProject!;
    expect(updated.tracks).toHaveLength(2);
    expect(updated.tracks[0]).toMatchObject({
      id: result.trackId,
      name: 'Track left',
      gain: 0,
      pan: 0,
      channelCount: 2,
      effects: [],
    });
    expect(updated.tracks[1]!.id).toBe('keep');
    expect(updated.tracks[0]!.clips).toHaveLength(1);
    expect(updated.tracks[0]!.clips[0]).toMatchObject({ startTime: 0, duration: 0.6, stretchRatio: 1, gain: 0 });
    const rendered = buffers.get(updated.tracks[0]!.clips[0]!.audioBufferId)!;
    expect(Array.from(new Float32Array(rendered.channelData[0]!))).toEqual([1, 1, 1, 1, 0, 0]);
    expect(Array.from(new Float32Array(rendered.channelData[1]!))).toEqual([0, 0, 2, 2, 2, 2]);
  });

  it('allows an empty mono partner and creates an empty stereo track when both are empty', async () => {
    const left = makeTrack('left', 1, []);
    const right = makeTrack('right', 1, [{ ...makeClip('right-clip', 'right-buffer'), duration: 0.2, offset: 0 }]);
    left.effects = [];
    right.effects = [];
    left.gain = 0;
    right.gain = 0;
    right.clips[0]!.gain = 0;
    right.clips[0]!.fadeIn = 0;
    right.clips[0]!.fadeOut = 0;
    mutableService.currentProject = makeProject([left, right]);
    await projectService.makeStereoTrackFromMono('channel-project', 'left', 'right', [
      { trackId: 'left', clips: [] }, monoTarget(right, [3, 3]),
    ]);
    let output = mutableService.currentProject!.tracks[0]!;
    const rendered = buffers.get(output.clips[0]!.audioBufferId)!;
    expect(Array.from(new Float32Array(rendered.channelData[0]!))).toEqual([0, 0]);
    expect(Array.from(new Float32Array(rendered.channelData[1]!))).toEqual([3, 3]);

    right.clips = [];
    mutableService.currentProject = makeProject([left, right]);
    const emptyResult = await projectService.makeStereoTrackFromMono('channel-project', 'left', 'right', [
      { trackId: 'left', clips: [] }, { trackId: 'right', clips: [] },
    ]);
    output = mutableService.currentProject!.tracks[0]!;
    expect(emptyResult.clipId).toBeNull();
    expect(output).toMatchObject({ channelCount: 2, clips: [] });
  });

  it('renders enabled realtime effects per input and skips bypassed effects before one commit', async () => {
    const left = makeTrack('left', 1, [makeClip('left-clip', 'left-buffer')]);
    const right = makeTrack('right', 1, [makeClip('right-clip', 'right-buffer')]);
    for (const track of [left, right]) {
      track.gain = 0;
      track.clips[0]!.gain = 0;
      track.clips[0]!.fadeIn = 0;
      track.clips[0]!.fadeOut = 0;
      track.clips[0]!.offset = 0;
    }
    left.effects = [{ id: 'gain', type: 'gain', bypassed: false, params: { gain: 20 * Math.log10(0.5) } }];
    right.effects = [{ id: 'delay', type: 'delay', bypassed: true, params: { time: 0.3 } }];
    mutableService.currentProject = makeProject([left, right]);
    await projectService.makeStereoTrackFromMono('channel-project', 'left', 'right', [
      monoTarget(left, [1, 1]), monoTarget(right, [2, 2]),
    ]);

    const output = mutableService.currentProject!.tracks[0]!;
    const rendered = buffers.get(output.clips[0]!.audioBufferId)!;
    expect(Array.from(new Float32Array(rendered.channelData[0]!))).toEqual([0.5, 0.5]);
    expect(Array.from(new Float32Array(rendered.channelData[1]!))).toEqual([2, 2]);
    expect(output.effects).toEqual([]);
    expect(audioEngine.renderRealtimeEffects).toHaveBeenCalledTimes(2);
    expect(vi.mocked(audioEngine.renderRealtimeEffects).mock.calls[0]?.[2]).toEqual(left.effects);
    expect(vi.mocked(audioEngine.renderRealtimeEffects).mock.calls[1]?.[2]).toEqual(right.effects);
    expect(projectService.saveProject).toHaveBeenCalledTimes(1);
  });

  it('keeps the original project untouched when offline effect rendering fails', async () => {
    const left = makeTrack('left', 1, [makeClip('left-clip', 'left-buffer')]);
    const right = makeTrack('right', 1, [makeClip('right-clip', 'right-buffer')]);
    left.effects = [{ id: 'gain', type: 'gain', bypassed: false, params: { gain: -6 } }];
    right.effects = [];
    mutableService.currentProject = makeProject([left, right]);
    const before = mutableService.currentProject;
    vi.mocked(audioEngine.renderRealtimeEffects).mockRejectedValueOnce(new Error('offline renderer unavailable'));
    await expect(projectService.makeStereoTrackFromMono('channel-project', 'left', 'right', [
      monoTarget(left, [1, 1]), monoTarget(right, [2, 2]),
    ])).rejects.toThrow('offline renderer unavailable');
    expect(mutableService.currentProject).toBe(before);
    expect(audioDb.audioBuffers.put).not.toHaveBeenCalled();
    expect(projectService.saveProject).not.toHaveBeenCalled();
  });

  it('rejects malformed channel inputs before any persistent write', async () => {
    const left = makeTrack('left', 1, []);
    const right = makeTrack('right', 1, []);
    left.effects = [];
    right.effects = [];
    mutableService.currentProject = makeProject([left, right]);
    const before = mutableService.currentProject;
    left.clips = [makeClip('left-clip', 'left-buffer')];
    await expect(projectService.makeStereoTrackFromMono('channel-project', 'left', 'right', [
      { trackId: 'left', clips: [{ clipId: 'left-clip', sampleData: [new Float32Array(2), new Float32Array(2)], sourceOffset: 0 }] },
      { trackId: 'right', clips: [] },
    ])).rejects.toThrow('仅支持单声道片段');
    expect(mutableService.currentProject).toBe(before);
    expect(audioDb.audioBuffers.put).not.toHaveBeenCalled();

    right.clips = [makeClip('right-clip', 'right-buffer')];
    await expect(projectService.makeStereoTrackFromMono('channel-project', 'left', 'right', [
      { trackId: 'left', clips: [{ clipId: 'left-clip', sampleData: [new Float32Array(2)], sourceOffset: 0 }] },
      { trackId: 'right', clips: [{ clipId: 'right-clip', sampleData: [new Float32Array(2), new Float32Array(2)], sourceOffset: 0 }] },
    ])).rejects.toThrow('仅支持单声道片段');
    expect(audioDb.audioBuffers.put).not.toHaveBeenCalled();
    expect(projectService.saveProject).not.toHaveBeenCalled();
  });
});
