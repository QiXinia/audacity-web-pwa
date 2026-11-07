import { describe, expect, it } from 'vitest';
import { quantizeSelectionToSamples, replaceTrackSelectionWithClip } from '@/lib/generatorEditing';
import type { IClip, ITrack } from '@/types/project';

function clip(id: string, startTime: number, duration: number, offset = 0): IClip {
  return {
    id,
    audioBufferId: `buffer-${id}`,
    startTime,
    duration,
    offset,
    originalDuration: 20,
    stretchRatio: 1,
    gain: 0,
    fadeIn: 0.1,
    fadeOut: 0.1,
  };
}

function track(clips: IClip[]): ITrack {
  return {
    id: 'track', name: 'Track', type: 'audio', gain: 0, pan: 0,
    muted: false, solo: false, armed: false, color: '', effects: [], clips,
  };
}

function generated(startTime: number, duration: number): IClip {
  return { ...clip('generated', startTime, duration), fadeIn: 0, fadeOut: 0 };
}

describe('generator selection replacement', () => {
  it('quantizes both selection edges to project samples and rejects sub-sample ranges', () => {
    expect(quantizeSelectionToSamples({ start: 0.04, end: 0.26 }, 10)).toEqual({ start: 0, end: 0.3 });
    expect(quantizeSelectionToSamples({ start: 0, end: 0.04 }, 10)).toBeNull();
    expect(quantizeSelectionToSamples({ start: -0.1, end: 1 }, 10)).toBeNull();
    expect(quantizeSelectionToSamples(null, 44100)).toBeNull();
  });

  it('splits one stretched clip and preserves the correct right-hand source offset', () => {
    const original = { ...clip('source', 0, 4, 1), stretchRatio: 2 };
    const result = replaceTrackSelectionWithClip(
      track([original]), { start: 1, end: 2 }, generated(1, 1), () => 'right',
    );

    expect(result.clips.map(({ id, startTime, duration, offset, stretchRatio, fadeIn, fadeOut }) => ({
      id, startTime, duration, offset, stretchRatio, fadeIn, fadeOut,
    }))).toEqual([
      { id: 'source', startTime: 0, duration: 1, offset: 1, stretchRatio: 2, fadeIn: 0.1, fadeOut: 0 },
      { id: 'generated', startTime: 1, duration: 1, offset: 0, stretchRatio: 1, fadeIn: 0, fadeOut: 0 },
      { id: 'right', startTime: 2, duration: 2, offset: 5, stretchRatio: 2, fadeIn: 0, fadeOut: 0.1 },
    ]);
    expect(original.duration).toBe(4);
  });

  it('removes covered clips and trims every partially overlapping edge', () => {
    const outside = clip('outside', 5, 1);
    const result = replaceTrackSelectionWithClip(
      track([clip('a', 0, 1), clip('b', 1, 1), clip('c', 2, 1, 3), outside]),
      { start: 0.5, end: 2.5 },
      generated(0.5, 2),
      () => 'unused',
    );
    expect(result.clips.map((item) => item.id)).toEqual(['a', 'generated', 'c', 'outside']);
    expect(result.clips[0]).toMatchObject({ startTime: 0, duration: 0.5, fadeOut: 0 });
    expect(result.clips[2]).toMatchObject({ startTime: 2.5, duration: 0.5, offset: 3.5, fadeIn: 0 });
    expect(result.clips[3]).toBe(outside);
  });

  it('inserts into empty space without changing distant clips', () => {
    const distant = clip('distant', 4, 1);
    const result = replaceTrackSelectionWithClip(
      track([distant]), { start: 1, end: 3 }, generated(1, 2), () => 'unused',
    );
    expect(result.clips.map((item) => item.id)).toEqual(['generated', 'distant']);
    expect(result.clips[1]).toBe(distant);
  });

  it('rejects a generated clip that does not exactly cover the quantized selection', () => {
    const source = track([clip('source', 0, 4)]);
    expect(() => replaceTrackSelectionWithClip(
      source, { start: 1, end: 2 }, generated(0, 1), () => 'unused',
    )).toThrow(/exactly cover/);
    expect(source.clips[0].duration).toBe(4);
  });
});
