import {
  buildClipLoopChannels,
  getLoopPlaybackStart,
  normalizeLoopRegion,
  wrapLoopCursor,
} from '@/lib/loopPlayback';

function source(overrides: Partial<Parameters<typeof buildClipLoopChannels>[0]> = {}) {
  return {
    channelData: [new Float32Array([1, 2, 3, 4, 5, 6])],
    sampleRate: 2,
    sourceOffset: 0,
    clipStart: 0,
    clipDuration: 3,
    fadeIn: 0,
    fadeOut: 0,
    ...overrides,
  };
}

describe('loop region boundaries', () => {
  it('accepts only finite forward regions starting at or after zero', () => {
    expect(normalizeLoopRegion({ start: 1, end: 2 })).toEqual({ start: 1, end: 2 });
    expect(normalizeLoopRegion(null)).toBeNull();
    expect(normalizeLoopRegion({ start: -1, end: 2 })).toBeNull();
    expect(normalizeLoopRegion({ start: 2, end: 2 })).toBeNull();
    expect(normalizeLoopRegion({ start: 3, end: 2 })).toBeNull();
    expect(normalizeLoopRegion({ start: 0, end: Number.POSITIVE_INFINITY })).toBeNull();
  });

  it('preserves a cursor inside the region and rewinds an outside cursor', () => {
    const region = { start: 2, end: 4 };
    expect(getLoopPlaybackStart(region, 1)).toBe(2);
    expect(getLoopPlaybackStart(region, 3.5)).toBe(3.5);
    expect(getLoopPlaybackStart(region, 4)).toBe(2);
    expect(getLoopPlaybackStart(region, 8)).toBe(2);
  });

  it('wraps the visible playhead across one or several loop cycles', () => {
    expect(wrapLoopCursor(10, 11.5, { start: 2, end: 4 })).toEqual({ startTime: 10, position: 1.5 });
    expect(wrapLoopCursor(10, 14, { start: 2, end: 4 })).toEqual({ startTime: 12, position: 2 });
    expect(wrapLoopCursor(10, 17, { start: 2, end: 4 })).toEqual({ startTime: 14, position: 3 });
  });
});

describe('clip loop rendering', () => {
  it('keeps clip timing and surrounding silence on the full loop period', () => {
    const channels = buildClipLoopChannels(
      source({ clipStart: 1, clipDuration: 2 }),
      { start: 0, end: 4 },
    );
    expect(channels).toHaveLength(1);
    expect(Array.from(channels![0])).toEqual([0, 0, 1, 2, 3, 4, 0, 0]);
  });

  it('honours trimmed source offsets without mutating the source PCM', () => {
    const input = new Float32Array([1, 2, 3, 4, 5, 6]);
    const channels = buildClipLoopChannels(
      source({ channelData: [input], sourceOffset: 1, clipDuration: 2 }),
      { start: 0, end: 3 },
    );
    expect(Array.from(channels![0])).toEqual([3, 4, 5, 6, 0, 0]);
    expect(Array.from(input)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('returns no source for clips outside the loop region', () => {
    expect(buildClipLoopChannels(source({ clipStart: 5 }), { start: 0, end: 2 })).toBeNull();
    expect(buildClipLoopChannels(source({ clipStart: -2, clipDuration: 1 }), { start: 0, end: 2 })).toBeNull();
  });

  it('bakes deterministic fade-in and fade-out gains into every loop buffer', () => {
    const channels = buildClipLoopChannels(
      source({
        channelData: [new Float32Array(4).fill(1)],
        sampleRate: 4,
        clipDuration: 1,
        fadeIn: 0.5,
        fadeOut: 0.5,
      }),
      { start: 0, end: 1 },
    );
    expect(Array.from(channels![0])).toEqual([0, 0.5, 1, 0.5]);
  });

  it('preserves stereo channels and clamps playback to two output channels', () => {
    const channels = buildClipLoopChannels(
      source({
        channelData: [
          new Float32Array([1, 2, 3, 4]),
          new Float32Array([10, 20, 30, 40]),
          new Float32Array([100, 200, 300, 400]),
        ],
        clipDuration: 2,
      }),
      { start: 0, end: 2 },
    );
    expect(channels).toHaveLength(2);
    expect(Array.from(channels![0])).toEqual([1, 2, 3, 4]);
    expect(Array.from(channels![1])).toEqual([10, 20, 30, 40]);
  });
});
