import { describe, expect, it } from 'vitest';
import {
  collectClipSnapPoints,
  snapClipSelectionDelta,
  snapTimelineTime,
  type SnapSettings,
} from '@/lib/snapping';
import {
  moveClipSelection,
  stretchClipSelection,
  trimClipSelection,
  type ClipKey,
} from '@/lib/clipEditing';
import type { IClip, IProject } from '@/types/project';

function clip(id: string, overrides: Partial<IClip> = {}): IClip {
  return {
    id,
    audioBufferId: `buffer-${id}`,
    startTime: 1,
    offset: 0,
    duration: 4,
    originalDuration: 4,
    stretchRatio: 1,
    gain: 0,
    fadeIn: 0,
    fadeOut: 0,
    ...overrides,
  };
}

function project(): IProject {
  return {
    id: 'project',
    name: 'test',
    createdAt: 0,
    updatedAt: 0,
    sampleRate: 4,
    timeSignature: { numerator: 4, denominator: 4 },
    tempo: 120,
    cursorPosition: 0,
    selection: null,
    viewState: { horizontalZoom: 100, verticalZoom: 1, scrollX: 0, viewMode: 'waveform' },
    tracks: [
      {
        id: 'track-a', name: 'A', type: 'audio', gain: 0, pan: 0, muted: false,
        solo: false, armed: false, color: '', effects: [], clips: [clip('a'), clip('b', { startTime: 6 })],
      },
      {
        id: 'track-b', name: 'B', type: 'audio', gain: 0, pan: 0, muted: false,
        solo: false, armed: false, color: '', effects: [], clips: [clip('c', { startTime: 2, duration: 2, originalDuration: 2 })],
      },
    ],
  };
}

const a = { trackId: 'track-a', clipId: 'a' } satisfies ClipKey;
const c = { trackId: 'track-b', clipId: 'c' } satisfies ClipKey;

function settings(source: IProject, overrides: Partial<SnapSettings> = {}): SnapSettings {
  return {
    enabled: true,
    mode: 'clips',
    points: collectClipSnapPoints(source, [a]),
    toleranceSeconds: 0.1,
    sampleRate: source.sampleRate,
    tempo: source.tempo,
    timeSignature: source.timeSignature,
    ...overrides,
  };
}

describe('timeline snapping', () => {
  it('collects sorted unique boundaries and excludes the clips being edited', () => {
    expect(collectClipSnapPoints(project(), [a])).toEqual([0, 2, 4, 6, 10]);
  });

  it('uses pixel-derived tolerance for the nearest clip boundary', () => {
    const source = project();
    const config = settings(source, { points: [0, 6] });
    expect(snapTimelineTime(5.96, config)).toBe(6);
    expect(snapTimelineTime(5.89, config)).toBe(5.89);
  });

  it('breaks equal-distance clip-point ties deterministically', () => {
    const source = project();
    const config = settings(source, { points: [1.1, 0.9], toleranceSeconds: 0.2 });
    expect(snapTimelineTime(1, config)).toBe(0.9);
  });

  it.each([
    ['samples', 2.26, 2.25],
    ['milliseconds', 1.23456, 1.235],
    ['seconds', 1.5, 2],
    ['beats', 1.26, 1.5],
    ['bars', 0.9, 0],
    ['bars', 1, 2],
    ['bars', 1.1, 2],
  ] as const)('snaps to the %s grid', (mode, time, expected) => {
    const source = project();
    expect(snapTimelineTime(time, settings(source, { mode }))).toBeCloseTo(expected, 12);
  });

  it('uses the project time signature for bar snapping and fails closed for invalid timing', () => {
    const source = project();
    expect(snapTimelineTime(1.9, settings(source, {
      mode: 'bars',
      tempo: 90,
      timeSignature: { numerator: 6, denominator: 8 },
    }))).toBeCloseTo(2, 12);
    expect(snapTimelineTime(1.234, settings(source, { mode: 'beats', tempo: 0 }))).toBe(1.234);
    expect(snapTimelineTime(1.234, settings(source, {
      mode: 'bars',
      timeSignature: { numerator: 4, denominator: 3 },
    }))).toBe(1.234);
  });

  it('leaves time unchanged for an invalid grid or when snapping is disabled', () => {
    const source = project();
    expect(snapTimelineTime(2.26, settings(source, { mode: 'samples', sampleRate: 0 }))).toBe(2.26);
    expect(snapTimelineTime(2.26, settings(source, { enabled: false }))).toBe(2.26);
  });
});

describe('clip operation snapping', () => {
  it('moves a clip by the delta that aligns its edges with another clip', () => {
    const source = project();
    const config = settings(source);
    const delta = snapClipSelectionDelta(source, [a], 'move', 0.96, config);
    expect(delta).toBeCloseTo(1, 12);
    const result = moveClipSelection(source, [a], delta);
    expect(result.tracks[0].clips[0].startTime).toBeCloseTo(2, 12);
    expect(result.tracks[0].clips[0].startTime + result.tracks[0].clips[0].duration).toBeCloseTo(6, 12);
  });

  it('does not snap to the selected clip itself or beyond tolerance', () => {
    const source = project();
    expect(snapClipSelectionDelta(source, [a], 'move', 0.01, settings(source))).toBeCloseTo(0.01, 12);
    expect(snapClipSelectionDelta(source, [a], 'move', 0.5, settings(source))).toBeCloseTo(0.5, 12);
  });

  it('returns the bounded raw delta when snapping is disabled', () => {
    const source = project();
    expect(snapClipSelectionDelta(source, [a], 'move', 0.96, settings(source, { enabled: false }))).toBeCloseTo(0.96, 12);
    expect(snapClipSelectionDelta(source, [a], 'move', -10, settings(source, { enabled: false }))).toBe(-1);
  });

  it('clamps a multi-clip move before snapping its leftmost edge to zero', () => {
    const source = project();
    const config = settings(source, { points: collectClipSnapPoints(source, [a, c]) });
    const delta = snapClipSelectionDelta(source, [a, c], 'move', -10, config);
    expect(delta).toBe(-1);
    const result = moveClipSelection(source, [a, c], delta);
    expect(result.tracks[0].clips[0].startTime).toBe(0);
    expect(result.tracks[1].clips[0].startTime).toBe(1);
  });

  it('snaps trim and stretch without bypassing source availability', () => {
    const source = project();
    source.tracks[0].clips[0] = clip('a', { originalDuration: 10 });
    const config = settings(source);
    const trimDelta = snapClipSelectionDelta(source, [a], 'trim-right', 0.96, config);
    const stretchDelta = snapClipSelectionDelta(source, [a], 'stretch-right', 0.96, config);
    expect(trimDelta).toBeCloseTo(1, 12);
    expect(stretchDelta).toBeCloseTo(1, 12);
    expect(trimClipSelection(source, [a], 'right', trimDelta).tracks[0].clips[0].duration).toBeCloseTo(5, 12);
    const stretched = stretchClipSelection(source, [a], 'right', stretchDelta).tracks[0].clips[0];
    expect(stretched.duration).toBeCloseTo(5, 12);
    expect(stretched.stretchRatio).toBeCloseTo(0.8, 12);

    source.tracks[0].clips[0] = clip('a');
    expect(snapClipSelectionDelta(source, [a], 'trim-right', 0.96, settings(source))).toBe(0);
  });

  it('preserves the current trimmed source window when snap-stretching again', () => {
    const source = project();
    source.tracks[0].clips[0] = clip('a', {
      offset: 1,
      duration: 2,
      originalDuration: 10,
      stretchRatio: 2,
    });
    const delta = snapClipSelectionDelta(source, [a], 'stretch-right', 0.96, settings(source));
    const edited = stretchClipSelection(source, [a], 'right', delta).tracks[0].clips[0];
    expect(delta).toBeCloseTo(1, 12);
    expect(edited.duration).toBeCloseTo(3, 12);
    expect(edited.stretchRatio).toBeCloseTo(4 / 3, 12);
    expect(edited.offset + edited.duration * edited.stretchRatio).toBeCloseTo(5, 12);
  });

  it('snaps a movement delta to project samples', () => {
    const source = project();
    const delta = snapClipSelectionDelta(source, [a], 'move', 0.13, settings(source, { mode: 'samples' }));
    expect(delta).toBeCloseTo(0.25, 12);
    expect(moveClipSelection(source, [a], delta).tracks[0].clips[0].startTime).toBeCloseTo(1.25, 12);
  });

  it('fails safely for missing selections and non-finite deltas', () => {
    const source = project();
    expect(snapClipSelectionDelta(source, [], 'move', 1, settings(source))).toBe(0);
    expect(snapClipSelectionDelta(source, [a], 'move', Number.NaN, settings(source))).toBe(0);
  });
});
