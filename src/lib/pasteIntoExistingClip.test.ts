import { describe, expect, it } from 'vitest';
import {
  findClipAtTime,
  matchPastedChannelCount,
  mergeClipboardPcmIntoClip,
  replaceTrackWithMergedClip,
} from './pasteIntoExistingClip';
import type { IClip, ITrack } from '@/types/project';

function clip(id: string, startTime = 0, duration = 2, overrides: Partial<IClip> = {}): IClip {
  return {
    id,
    audioBufferId: `pcm-${id}`,
    startTime,
    offset: 0,
    duration,
    originalDuration: duration,
    stretchRatio: 1,
    gain: 0,
    fadeIn: 0,
    fadeOut: 0,
    name: id,
    ...overrides,
  };
}

function track(clips: IClip[]): ITrack {
  return { id: 'track', name: 'track', type: 'audio', gain: 0, pan: 0, muted: false, solo: false, armed: false, color: '', effects: [], clips };
}

function pcm(values: number[]): Float32Array {
  return Float32Array.from(values);
}

describe('findClipAtTime', () => {
  it('uses Audacity start-inclusive/end-exclusive boundaries and chooses the following clip at a shared edge', () => {
    const first = clip('first', 0, 2);
    const second = clip('second', 2, 2);
    const source = track([first, second]);
    expect(findClipAtTime(source, 0)?.id).toBe('first');
    expect(findClipAtTime(source, 1.999)?.id).toBe('first');
    expect(findClipAtTime(source, 2)?.id).toBe('second');
    expect(findClipAtTime(source, 4)).toBeNull();
    expect(findClipAtTime(source, Number.NaN)).toBeNull();
  });
});

describe('mergeClipboardPcmIntoClip', () => {
  it('matches the official paste-at-start regression: one clip with twice the audio', () => {
    const original = clip('source', 0, 2);
    const result = mergeClipboardPcmIntoClip({
      clip: original,
      existingChannels: [pcm([0.25, 0.5])],
      sourceOffset: 0,
      pastedChannels: [pcm([0.25, 0.5])],
      pasteTime: 0,
      sampleRate: 1,
    });
    expect(Array.from(result.channels[0]!)).toEqual([0.25, 0.5, 0.25, 0.5]);
    expect(result.clip).toMatchObject({
      id: 'source', startTime: 0, offset: 0, duration: 4, originalDuration: 4,
      stretchRatio: 1, gain: 0, fadeIn: 0, fadeOut: 0,
    });
  });

  it('inserts at the effective stretched source window while preserving trimmed-out PCM', () => {
    const original = clip('stretched', 10, 4, {
      offset: 2, originalDuration: 4, stretchRatio: 2, pitchCents: 120, optimizeForVoice: true,
    });
    const result = mergeClipboardPcmIntoClip({
      clip: original,
      existingChannels: [pcm([0, 1, 2, 3, 4, 5, 6, 7])],
      sourceOffset: 1,
      pastedChannels: [pcm([9, 9])],
      pasteTime: 12,
      sampleRate: 1,
    });
    expect(Array.from(result.channels[0]!)).toEqual([0, 1, 2, 9, 9, 3, 4, 5, 6, 7]);
    expect(result.clip).toMatchObject({
      startTime: 10, offset: 1, duration: 6, originalDuration: 10,
      stretchRatio: 1, pitchCents: 0, optimizeForVoice: false, stretchToMatchTempo: false,
    });
    expect(Array.from(result.channels[0]!.subarray(1, 7))).toEqual([1, 2, 9, 9, 3, 4]);
  });

  it('bakes old fades without fading the inserted PCM', () => {
    const result = mergeClipboardPcmIntoClip({
      clip: clip('fades', 0, 2, { fadeIn: 1, fadeOut: 1 }),
      existingChannels: [pcm([1, 1, 1, 1])],
      sourceOffset: 0,
      pastedChannels: [pcm([0.5, 0.5])],
      pasteTime: 1,
      sampleRate: 2,
    });
    expect(Array.from(result.channels[0]!)).toEqual([0, 0.5, 0.5, 0.5, 1, 0.5]);
    expect(result.clip.fadeIn).toBe(0);
    expect(result.clip.fadeOut).toBe(0);
  });

  it('bakes the old gain but leaves pasted samples unchanged', () => {
    const result = mergeClipboardPcmIntoClip({
      clip: clip('gain', 0, 2, { gain: -6 }),
      existingChannels: [pcm([0.5, 0.5])],
      sourceOffset: 0,
      pastedChannels: [pcm([0.5, 0.5])],
      pasteTime: 0,
      sampleRate: 1,
    });
    expect(result.channels[0]![0]).toBeCloseTo(0.5, 6);
    expect(result.channels[0]![1]).toBeCloseTo(0.5, 6);
    expect(result.channels[0]![2]).toBeCloseTo(0.5 * Math.pow(10, -6 / 20), 6);
    expect(result.clip.gain).toBe(0);
  });

  it('duplicates mono into a stereo destination and downmixes stereo into mono', () => {
    const stereo = mergeClipboardPcmIntoClip({
      clip: clip('stereo'),
      existingChannels: [pcm([1, 1]), pcm([2, 2])],
      sourceOffset: 0,
      pastedChannels: [pcm([0.5])],
      pasteTime: 0,
      sampleRate: 1,
    });
    expect(Array.from(stereo.channels[0]!)).toEqual([0.5, 1, 1]);
    expect(Array.from(stereo.channels[1]!)).toEqual([0.5, 2, 2]);
    const mono = mergeClipboardPcmIntoClip({
      clip: clip('mono'),
      existingChannels: [pcm([1, 1])],
      sourceOffset: 0,
      pastedChannels: [pcm([1]), pcm([3])],
      pasteTime: 0,
      sampleRate: 1,
    });
    expect(Array.from(mono.channels[0]!)).toEqual([2, 1, 1]);
  });

  it('rejects invalid ranges and malformed channel data', () => {
    const original = clip('source');
    expect(() => mergeClipboardPcmIntoClip({
      clip: original, existingChannels: [pcm([1, 1])], sourceOffset: 0,
      pastedChannels: [pcm([1])], pasteTime: 2, sampleRate: 1,
    })).toThrow(RangeError);
    expect(() => mergeClipboardPcmIntoClip({
      clip: original, existingChannels: [pcm([1]), pcm([1, 1])], sourceOffset: 0,
      pastedChannels: [pcm([1])], pasteTime: 0, sampleRate: 1,
    })).toThrow('equal lengths');
    expect(() => matchPastedChannelCount([pcm([1]), pcm([2]), pcm([3])], 2)).toThrow('mismatched channels');
  });
});

describe('replaceTrackWithMergedClip', () => {
  function mergedFixture() {
    const original = clip('source', 0, 2);
    const following = clip('following', 2.5, 1, { offset: 4, originalDuration: 8 });
    const merged = { ...original, duration: 3, originalDuration: 3 };
    return { original, following, merged };
  }

  it('overlap trims only the expansion range and retains the following source window', () => {
    const { original, following, merged } = mergedFixture();
    let id = 0;
    const result = replaceTrackWithMergedClip(track([original, following]), original, merged, 'overlap', () => `new-${++id}`);
    expect(result.clips.map((item) => item.id)).toEqual(['source', 'following']);
    expect(result.clips[0]).toBe(merged);
    expect(result.clips[1]).toMatchObject({ startTime: 3, duration: 0.5, offset: 4.5 });
  });

  it('per-track insertion moves following clips without changing their source window', () => {
    const { original, following, merged } = mergedFixture();
    let id = 0;
    const result = replaceTrackWithMergedClip(track([original, following]), original, merged, 'insert', () => `new-${++id}`);
    expect(result.clips.map((item) => item.id)).toEqual(['source', 'following']);
    expect(result.clips[1]).toMatchObject({ startTime: 3.5, duration: 1, offset: 4 });
  });
});
