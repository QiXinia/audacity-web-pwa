import { describe, expect, it } from 'vitest';
import {
  boundClipStretchDelta,
  deleteClipSelection,
  getClipStretchRatio,
  moveClipSelection,
  resetClipStretch,
  splitClipSelectionAtTime,
  stretchClipSelection,
  trimClipSelection,
  updateClipSelection,
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
    sampleRate: 44100,
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
const b = { trackId: 'track-a', clipId: 'b' } satisfies ClipKey;
const c = { trackId: 'track-b', clipId: 'c' } satisfies ClipKey;

describe('clip selection editing', () => {
  it('toggles non-contiguous Ctrl selections without reordering clips', () => {
    let selected = updateClipSelection([], a, 'replace');
    selected = updateClipSelection(selected, c, 'toggle');
    selected = updateClipSelection(selected, b, 'toggle');
    expect(selected).toEqual([a, c, b]);
    expect(updateClipSelection(selected, c, 'toggle')).toEqual([a, b]);
    expect(updateClipSelection(selected, b, 'replace')).toEqual([b]);
  });

  it('selects the official Shift time/track rectangle in either direction', () => {
    const source = project();
    const middle = {
      id: 'track-middle', name: 'Middle', type: 'audio' as const, gain: 0, pan: 0,
      muted: false, solo: false, armed: false, color: '', effects: [],
      clips: [
        clip('middle-late', { startTime: 7, duration: 1, originalDuration: 1 }),
        clip('middle-inside', { startTime: 2, duration: 1, originalDuration: 1 }),
        clip('middle-partial', { startTime: 4.5, duration: 1, originalDuration: 1 }),
      ],
    };
    source.tracks.splice(1, 0, middle);
    const inside = { trackId: 'track-middle', clipId: 'middle-inside' } satisfies ClipKey;

    expect(updateClipSelection([a], c, 'range', source.tracks, a)).toEqual([a, inside, c]);
    expect(updateClipSelection([c], a, 'range', source.tracks, c)).toEqual([a, inside, c]);
    expect(updateClipSelection([], c, 'range', source.tracks, null)).toEqual([c]);
  });

  it('clamps a group left trim by the shortest duration and source start', () => {
    const result = trimClipSelection(project(), [a, c], 'left', 10);
    expect(result.tracks[0].clips[0].duration).toBeCloseTo(2.05);
    expect(result.tracks[1].clips[0].duration).toBeCloseTo(0.05);
    const moved = trimClipSelection(project(), [a, c], 'left', -10);
    // offset = 0 means there is no hidden source audio available to extend left.
    expect(moved.tracks[0].clips[0].startTime).toBe(1);
    expect(moved.tracks[1].clips[0].startTime).toBe(2);
  });

  it('uses source-time deltas when trimming a stretched clip', () => {
    const source = project();
    source.tracks[0].clips[0] = clip('a', { duration: 2, originalDuration: 4, stretchRatio: 2, offset: 1 });
    const result = trimClipSelection(source, [a], 'left', 0.5);
    expect(result.tracks[0].clips[0].offset).toBeCloseTo(2);
    expect(result.tracks[0].clips[0].duration).toBeCloseTo(1.5);
    expect(result.tracks[0].clips[0].stretchRatio).toBe(2);
  });

  it('limits right trim by source availability divided by stretch ratio', () => {
    const source = project();
    source.tracks[0].clips[0] = clip('a', { duration: 2, originalDuration: 4, stretchRatio: 2 });
    const result = trimClipSelection(source, [a], 'right', 10);
    expect(result.tracks[0].clips[0].duration).toBeCloseTo(2);
  });

  it('preserves the trimmed source window when stretching a clip again', () => {
    const source = project();
    source.tracks[0].clips[0] = clip('a', {
      offset: 1,
      duration: 2,
      originalDuration: 10,
      stretchRatio: 2,
    });
    const result = stretchClipSelection(source, [a], 'right', 1);
    const edited = result.tracks[0].clips[0];
    expect(edited.duration).toBe(3);
    expect(edited.stretchRatio).toBeCloseTo(4 / 3);
    expect(edited.offset + edited.duration * edited.stretchRatio).toBeCloseTo(5);
  });

  it('resets speed without restoring audio removed by trimming', () => {
    const source = project();
    source.tracks[0].clips[0] = clip('a', {
      offset: 1,
      duration: 2,
      originalDuration: 10,
      stretchRatio: 2,
    });
    const result = resetClipStretch(source, [a]);
    const edited = result.tracks[0].clips[0];
    expect(edited.startTime).toBe(1);
    expect(edited.offset).toBe(1);
    expect(edited.duration).toBe(4);
    expect(edited.stretchRatio).toBe(1);
  });

  it('uses current-source and timeline bounds for stretch pointer deltas', () => {
    const original = clip('a');
    expect(boundClipStretchDelta(original, 'right', 40)).toBe(12);
    expect(boundClipStretchDelta(original, 'left', 10)).toBe(3);
    expect(boundClipStretchDelta(original, 'left', -10)).toBe(-1);

    const trimmed = clip('trimmed', {
      startTime: 2,
      offset: 1,
      duration: 2,
      originalDuration: 10,
      stretchRatio: 2,
    });
    expect(boundClipStretchDelta(trimmed, 'right', 40)).toBe(14);
    expect(boundClipStretchDelta(trimmed, 'left', 10)).toBe(1);
    expect(boundClipStretchDelta(trimmed, 'left', -10)).toBe(-2);
  });

  it('moves every selected clip together and clamps the leftmost to zero', () => {
    const result = moveClipSelection(project(), [a, c], -10);
    expect(result.tracks[0].clips[0].startTime).toBe(0);
    expect(result.tracks[1].clips[0].startTime).toBe(1);
    expect(result.tracks[0].clips[1].startTime).toBe(6);
  });

  it('stretches the right edge without consuming more source samples', () => {
    const result = stretchClipSelection(project(), [a], 'right', -2);
    const edited = result.tracks[0].clips[0];
    expect(edited.duration).toBe(2);
    expect(edited.stretchRatio).toBe(2);
    expect(edited.offset).toBe(0);
    expect(edited.originalDuration).toBe(4);
  });

  it('keeps the right edge fixed during left stretch', () => {
    const result = stretchClipSelection(project(), [a], 'left', 1);
    const edited = result.tracks[0].clips[0];
    expect(edited.startTime).toBe(2);
    expect(edited.duration).toBe(3);
    expect(edited.startTime + edited.duration).toBe(5);
    expect(edited.stretchRatio).toBeCloseTo(4 / 3);
  });

  it('clamps a group stretch using the shortest clip', () => {
    const result = stretchClipSelection(project(), [a, c], 'right', -10);
    expect(result.tracks[0].clips[0].duration).toBeCloseTo(2.5);
    expect(result.tracks[1].clips[0].duration).toBeCloseTo(0.5);
    expect(result.tracks[1].clips[0].stretchRatio).toBe(4);
  });

  it('splits a stretched clip while preserving source buffers, ratio, and offsets', () => {
    const source = project();
    source.tracks[0].clips[0] = {
      ...source.tracks[0].clips[0],
      startTime: 0.1,
      duration: 5,
      originalDuration: 4,
      stretchRatio: 0.8,
      fadeIn: 0.2,
      fadeOut: 0.3,
    };
    let nextId = 0;
    const { project: result, didSplit } = splitClipSelectionAtTime(source, [a], 2, () => `split-${++nextId}`);
    expect(didSplit).toBe(true);
    const [left, right, untouched] = result.tracks[0].clips;
    expect(left.audioBufferId).toBe('buffer-a');
    expect(right.audioBufferId).toBe('buffer-a');
    expect(left.duration).toBeCloseTo(1.9);
    expect(left.offset).toBe(0);
    expect(left.stretchRatio).toBe(0.8);
    expect(left.originalDuration).toBe(4);
    expect(left.fadeOut).toBe(0);
    expect(right.startTime).toBe(2);
    expect(right.duration).toBeCloseTo(3.1);
    expect(right.offset).toBeCloseTo(1.52);
    expect(right.stretchRatio).toBe(0.8);
    expect(right.originalDuration).toBe(4);
    expect(right.fadeIn).toBe(0);
    expect(right.fadeOut).toBe(0.3);
    expect(untouched.id).toBe('b');
    expect(splitClipSelectionAtTime(source, [a], 0.11, () => 'unused')).toEqual({ project: source, didSplit: false });
  });

  it('snaps to project samples and splits every intersected clip in a cross-track selection', () => {
    const source = project();
    source.sampleRate = 4;
    let nextId = 0;
    const { project: result, didSplit } = splitClipSelectionAtTime(
      source,
      [a, c],
      2.26,
      () => `part-${++nextId}`,
    );
    expect(didSplit).toBe(true);
    expect(result.tracks[0].clips.map((item) => item.id)).toEqual(['part-1', 'part-2', 'b']);
    expect(result.tracks[1].clips.map((item) => item.id)).toEqual(['part-3', 'part-4']);
    const [leftA, rightA, untouched] = result.tracks[0].clips;
    expect(leftA.duration).toBe(1.25);
    expect(rightA.startTime).toBe(2.25);
    expect(rightA.duration).toBe(2.75);
    expect(rightA.offset).toBe(1.25);
    expect(leftA.audioBufferId).toBe('buffer-a');
    expect(rightA.audioBufferId).toBe('buffer-a');
    const [leftC, rightC] = result.tracks[1].clips;
    expect(leftC.duration).toBe(0.25);
    expect(rightC.startTime).toBe(2.25);
    expect(rightC.duration).toBe(1.75);
    expect(rightC.offset).toBe(0.25);
    expect(leftC.audioBufferId).toBe('buffer-c');
    expect(rightC.audioBufferId).toBe('buffer-c');
    expect(untouched).toBe(source.tracks[0].clips[1]);
    expect(source.tracks[0].clips.map((item) => item.id)).toEqual(['a', 'b']);
    expect(source.tracks[1].clips.map((item) => item.id)).toEqual(['c']);
  });

  it('resets stretch while preserving the clip start and deletes only selected clips across tracks', () => {
    const source = project();
    source.tracks[0].clips[0].stretchRatio = 2;
    source.tracks[0].clips[0].duration = 2;
    const reset = resetClipStretch(source, [a]);
    expect(reset.tracks[0].clips[0].startTime).toBe(1);
    expect(reset.tracks[0].clips[0].duration).toBe(4);
    expect(reset.tracks[0].clips[0].startTime + reset.tracks[0].clips[0].duration).toBe(5);
    const result = deleteClipSelection(reset, [a, c]);
    expect(result.tracks[0].clips.map((item) => item.id)).toEqual(['b']);
    expect(result.tracks[1].clips).toEqual([]);
  });

  it('treats a missing legacy ratio as 100 percent', () => {
    const legacy = clip('legacy');
    delete legacy.stretchRatio;
    expect(getClipStretchRatio(legacy)).toBe(1);
  });
});
