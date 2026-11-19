import { describe, expect, it, vi } from 'vitest';
import type { IClip, IProject, ITrack } from '@/types/project';
import { duplicateTrackInProject } from './trackDuplicate';

function clip(id: string, audioBufferId: string, groupId?: number): IClip {
  return {
    id, audioBufferId, startTime: 1, offset: 0.25, duration: 2, originalDuration: 4,
    stretchRatio: 0.5, pitchCents: 175, optimizeForVoice: true, stretchToMatchTempo: false,
    rawAudioTempo: 96, clipTempo: 120, colorIndex: 3, groupId,
    gain: -1.5, fadeIn: 0.1, fadeOut: 0.2, name: `Clip ${id}`,
  };
}

function track(id: string, clips: IClip[]): ITrack {
  return {
    id, name: `Track ${id}`, type: 'audio', gain: -3, pan: 0.4,
    muted: true, solo: false, armed: true, color: '#abcdef', clips,
    viewMode: 'both', halfWave: true,
    effects: [{ id: `effect-${id}`, type: 'reverb', bypassed: false, params: { decay: 2, wet: 0.3 } }],
    spectrogramUseGlobalSettings: false,
    spectrogramSettings: {
      scale: 'mel', minFreq: 30, maxFreq: 16000, gainDb: 4, rangeDb: 90,
      highBoostDbPerDec: 2, colorScheme: 'roseus', algorithm: 'reassignment',
      windowType: 'hann', windowSize: 4096, zeroPaddingFactor: 2,
    },
  };
}

function project(tracks: ITrack[]): IProject {
  return {
    id: 'duplicate-project', name: 'Duplicate', sampleRate: 44100,
    timeSignature: { numerator: 4, denominator: 4 }, tempo: 120, tracks,
    cursorPosition: 0, selection: null,
    viewState: { horizontalZoom: 100, verticalZoom: 1, scrollX: 0, viewMode: 'waveform' },
    updatedAt: 100, createdAt: 50,
  };
}

function ids(): () => string {
  let value = 0;
  return () => `new-${++value}`;
}

describe('duplicateTrackInProject', () => {
  it('copies the complete track with independent identities and one new buffer per unique source', () => {
    const source = track('source', [
      clip('a', 'buffer-a', 7),
      clip('b', 'buffer-a', 7),
      clip('c', 'buffer-b'),
    ]);
    const other = track('other', [clip('d', 'buffer-d', 8)]);
    const input = project([source, other]);
    const original = structuredClone(input);

    const result = duplicateTrackInProject(input, 'source', ids())!;
    const copy = result.track;

    expect(result.project.tracks).toHaveLength(3);
    expect(result.project.tracks[0]).toBe(source);
    expect(result.project.tracks[1]).toBe(other);
    expect(result.project.tracks[2]).toBe(copy);
    expect(input).toEqual(original);
    expect(copy).not.toBe(source);
    expect(copy.id).not.toBe(source.id);
    expect(copy).toMatchObject({
      name: source.name, gain: -3, pan: 0.4, muted: true, solo: false,
      armed: true, color: '#abcdef', viewMode: 'both', halfWave: true,
      spectrogramUseGlobalSettings: false,
    });
    expect(copy.clips.map((item) => item.id)).not.toEqual(source.clips.map((item) => item.id));
    expect(copy.clips[0]).toMatchObject({
      startTime: 1, offset: 0.25, duration: 2, originalDuration: 4,
      stretchRatio: 0.5, pitchCents: 175, optimizeForVoice: true,
      stretchToMatchTempo: false, rawAudioTempo: 96, clipTempo: 120,
      colorIndex: 3, gain: -1.5, fadeIn: 0.1, fadeOut: 0.2,
    });
    expect(copy.clips[0]!.audioBufferId).toBe(copy.clips[1]!.audioBufferId);
    expect(copy.clips[0]!.audioBufferId).not.toBe('buffer-a');
    expect(copy.clips[2]!.audioBufferId).not.toBe('buffer-b');
    expect(result.audioBufferCopies).toHaveLength(2);
    expect(copy.clips.map((item) => item.groupId)).toEqual([9, 9, undefined]);
    expect(source.clips.map((item) => item.groupId)).toEqual([7, 7, undefined]);
    expect(copy.effects[0]).not.toBe(source.effects[0]);
    expect(copy.effects[0]!.id).not.toBe(source.effects[0]!.id);
    expect(copy.effects[0]!.params).toEqual(source.effects[0]!.params);
    expect(copy.effects[0]!.params).not.toBe(source.effects[0]!.params);
    expect(copy.spectrogramSettings).toEqual(source.spectrogramSettings);
    expect(copy.spectrogramSettings).not.toBe(source.spectrogramSettings);
  });

  it('dissolves a copied group only when it spans an uncopied track', () => {
    const source = track('source', [clip('a', 'buffer-a', 4)]);
    const other = track('other', [clip('b', 'buffer-b', 4)]);
    const input = project([source, other]);
    const result = duplicateTrackInProject(input, 'source', ids())!;

    expect(result.track.clips[0]!.groupId).toBeUndefined();
    expect(input.tracks[0]!.clips[0]!.groupId).toBe(4);
    expect(input.tracks[1]!.clips[0]!.groupId).toBe(4);
  });

  it('assigns distinct fresh IDs to multiple complete groups', () => {
    const source = track('source', [
      clip('a', 'buffer-a', 2), clip('b', 'buffer-b', 5), clip('c', 'buffer-c'),
    ]);
    const input = project([source, track('other', [clip('d', 'buffer-d', 9)])]);
    const result = duplicateTrackInProject(input, 'source', ids())!;
    expect(result.track.clips.map((item) => item.groupId)).toEqual([10, 11, undefined]);
  });

  it('duplicates an empty track without inventing audio buffers', () => {
    const input = project([track('source', [])]);
    const result = duplicateTrackInProject(input, 'source', ids())!;
    expect(result.track.clips).toEqual([]);
    expect(result.audioBufferCopies).toEqual([]);
    expect(result.project.tracks).toHaveLength(2);
  });

  it('returns null for an unknown track without generating identities', () => {
    const createId = vi.fn(ids());
    expect(duplicateTrackInProject(project([track('source', [])]), 'missing', createId)).toBeNull();
    expect(createId).not.toHaveBeenCalled();
  });

  it('reports group-id exhaustion instead of creating an unsafe group', () => {
    const source = track('source', [clip('a', 'buffer-a', Number.MAX_SAFE_INTEGER)]);
    expect(() => duplicateTrackInProject(project([source]), 'source', ids()))
      .toThrow('没有可用的 Clip Group ID');
  });
});
