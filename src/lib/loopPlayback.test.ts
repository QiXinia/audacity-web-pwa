import {
  buildClipLoopChannels,
  getLoopInteractionMode,
  getLoopPlaybackStart,
  normalizeLoopRegion,
  updateLoopRegionFromInteraction,
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

describe('loop ruler interactions', () => {
  const identity = (time: number) => time;

  it('selects create, move, and edge-resize modes like the official controller', () => {
    const region = { start: 2, end: 4 };
    expect(getLoopInteractionMode(null, 1, 100, false)).toBeNull();
    expect(getLoopInteractionMode(null, 1, 100, true)).toBe('create');
    expect(getLoopInteractionMode(region, 2.03, 100, false)).toBe('resize-start');
    expect(getLoopInteractionMode(region, 3.97, 100, false)).toBe('resize-end');
    expect(getLoopInteractionMode(region, 3, 100, false)).toBe('move');
    expect(getLoopInteractionMode(region, 5, 100, false)).toBeNull();
  });

  it('creates a normalized region in either drag direction and rejects zero length', () => {
    const base = { mode: 'create' as const, region: null, anchorTime: 4, maxTime: 30, snapTime: identity };
    expect(updateLoopRegionFromInteraction({ ...base, currentTime: 2 })).toEqual({ start: 2, end: 4 });
    expect(updateLoopRegionFromInteraction({ ...base, anchorTime: 2, currentTime: 4 })).toEqual({ start: 2, end: 4 });
    expect(updateLoopRegionFromInteraction({ ...base, currentTime: 4 })).toBeNull();
  });

  it('snaps both creation edges using the active timeline snap settings', () => {
    expect(updateLoopRegionFromInteraction({
      mode: 'create', region: null, anchorTime: 2.2, currentTime: 3.7, maxTime: 30,
      snapTime: (time) => Math.round(time),
    })).toEqual({ start: 2, end: 4 });
  });

  it('resizes either edge and normalizes a crossing drag without losing the region', () => {
    const region = { start: 2, end: 4 };
    expect(updateLoopRegionFromInteraction({
      mode: 'resize-start', region, anchorTime: 2, currentTime: 1, maxTime: 30, snapTime: identity,
    })).toEqual({ start: 1, end: 4 });
    expect(updateLoopRegionFromInteraction({
      mode: 'resize-end', region, anchorTime: 4, currentTime: 1, maxTime: 30, snapTime: identity,
    })).toEqual({ start: 1, end: 2 });
    expect(updateLoopRegionFromInteraction({
      mode: 'resize-end', region, anchorTime: 4, currentTime: 2, maxTime: 30, snapTime: identity,
    })).toEqual(region);
  });

  it('preserves loop duration while moving and clamps both timeline boundaries', () => {
    const region = { start: 2, end: 4 };
    expect(updateLoopRegionFromInteraction({
      mode: 'move', region, anchorTime: 3, currentTime: 5, maxTime: 30, snapTime: identity,
    })).toEqual({ start: 4, end: 6 });
    expect(updateLoopRegionFromInteraction({
      mode: 'move', region, anchorTime: 3, currentTime: 0, maxTime: 30, snapTime: identity,
    })).toEqual({ start: 0, end: 2 });
    expect(updateLoopRegionFromInteraction({
      mode: 'move', region, anchorTime: 3, currentTime: 29, maxTime: 10, snapTime: identity,
    })).toEqual({ start: 8, end: 10 });
  });

  it('snaps a moved region by its start or end without changing its duration', () => {
    const region = { start: 2, end: 4 };
    const snapNear = (points: number[]) => (time: number) => {
      const point = points.reduce((best, candidate) =>
        Math.abs(candidate - time) < Math.abs(best - time) ? candidate : best, points[0]);
      return Math.abs(point - time) <= 0.1 ? point : time;
    };
    expect(updateLoopRegionFromInteraction({
      mode: 'move', region, anchorTime: 2.5, currentTime: 3.54, maxTime: 30, snapTime: snapNear([0, 3, 5, 8]),
    })).toEqual({ start: 3, end: 5 });
    expect(updateLoopRegionFromInteraction({
      mode: 'move', region, anchorTime: 2.5, currentTime: 4.54, maxTime: 30, snapTime: snapNear([0, 6, 9]),
    })).toEqual({ start: 4, end: 6 });
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
