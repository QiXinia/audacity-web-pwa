import { describe, expect, it } from 'vitest';
import {
  deleteClipSelection,
  getClipStretchRatio,
  moveClipSelection,
  resetClipStretch,
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
  it('toggles non-contiguous Shift selections without reordering clips', () => {
    let selected = updateClipSelection([], a, false);
    selected = updateClipSelection(selected, c, true);
    selected = updateClipSelection(selected, b, true);
    expect(selected).toEqual([a, c, b]);
    expect(updateClipSelection(selected, c, true)).toEqual([a, b]);
    expect(updateClipSelection(selected, b, false)).toEqual([b]);
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

  it('resets stretch and deletes only selected clips across tracks', () => {
    const source = project();
    source.tracks[0].clips[0].stretchRatio = 2;
    source.tracks[0].clips[0].duration = 2;
    const reset = resetClipStretch(source, [a]);
    expect(reset.tracks[0].clips[0].duration).toBe(4);
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
