import { describe, expect, it } from 'vitest';
import { applySelectionEdit, type SelectionRippleMode } from '@/lib/selectionEdit';
import type { IClip, IProject } from '@/types/project';

function clip(id: string, overrides: Partial<IClip> = {}): IClip {
  return {
    id,
    audioBufferId: `buffer-${id}`,
    name: `Clip ${id}`,
    startTime: 1,
    offset: 2,
    duration: 4,
    originalDuration: 12,
    stretchRatio: 2,
    pitchCents: 125,
    clipTempo: 110,
    rawAudioTempo: 100,
    gain: -3,
    fadeIn: 0.2,
    fadeOut: 0.3,
    ...overrides,
  };
}

function makeProject(): IProject {
  return {
    id: 'project',
    name: 'test',
    createdAt: 0,
    updatedAt: 0,
    sampleRate: 10,
    timeSignature: { numerator: 4, denominator: 4 },
    tempo: 120,
    cursorPosition: 0,
    selection: null,
    viewState: { horizontalZoom: 100, verticalZoom: 1, scrollX: 0, viewMode: 'waveform' },
    tracks: [
      {
        id: 'a', name: 'A', type: 'audio', gain: 0, pan: 0, muted: false, solo: false,
        armed: false, color: '', effects: [], clips: [
          clip('a'),
          clip('following', { startTime: 7, offset: 0, duration: 2, originalDuration: 2, stretchRatio: 1 }),
        ],
      },
      {
        id: 'b', name: 'B', type: 'audio', gain: 0, pan: 0, muted: false, solo: false,
        armed: false, color: '', effects: [], clips: [
          clip('other', { startTime: 1, offset: 0, duration: 4, originalDuration: 4, stretchRatio: 1 }),
          clip('other-following', { startTime: 7, offset: 0, duration: 1, originalDuration: 1, stretchRatio: 1 }),
        ],
      },
    ],
  };
}

let nextId = 0;
const createId = () => `new-${nextId += 1}`;

function edit(mode: SelectionRippleMode, start = 2, end = 3, tracks = ['a']) {
  nextId = 0;
  return applySelectionEdit(makeProject(), start, end, mode, tracks, createId);
}

describe('Audacity selection Cut/Delete modes', () => {
  it('leave-gap splits the source window and leaves following clips in place', () => {
    const source = makeProject();
    nextId = 0;
    const result = applySelectionEdit(source, 2, 3, 'leave-gap', ['a'], createId);
    const [left, right, following] = result.project.tracks[0].clips;
    expect(result.didChange).toBe(true);
    expect(left).toMatchObject({ startTime: 1, duration: 1, offset: 2, fadeIn: 0.2, fadeOut: 0 });
    expect(right).toMatchObject({ startTime: 3, duration: 2, offset: 6, fadeIn: 0, fadeOut: 0.3 });
    expect(following).toMatchObject({ id: 'following', startTime: 7 });
    expect(right).toMatchObject({
      audioBufferId: 'buffer-a', originalDuration: 12, stretchRatio: 2,
      pitchCents: 125, clipTempo: 110, rawAudioTempo: 100, gain: -3, name: 'Clip a',
    });
    expect(result.project.tracks[1]).toBe(source.tracks[1]);
  });

  it('per-clip closes only the intersected clip and preserves the following gap', () => {
    const result = edit('per-clip');
    const [left, right, following] = result.project.tracks[0].clips;
    expect(left).toMatchObject({ startTime: 1, duration: 1 });
    expect(right).toMatchObject({ startTime: 2, duration: 2, offset: 6 });
    expect(following).toMatchObject({ startTime: 7 });
  });

  it('per-track also moves the following Clip left by the selection duration', () => {
    const result = edit('per-track');
    const [left, right, following] = result.project.tracks[0].clips;
    expect(left).toMatchObject({ startTime: 1, duration: 1 });
    expect(right).toMatchObject({ startTime: 2, duration: 2, offset: 6 });
    expect(following).toMatchObject({ startTime: 6 });
    expect(result.project.tracks[1].clips.map((item) => item.startTime)).toEqual([1, 7]);
  });

  it('all-tracks applies the same ripple to every project track', () => {
    const result = edit('all-tracks', 2, 3, []);
    expect(result.project.tracks[0].clips.map((item) => item.startTime)).toEqual([1, 2, 6]);
    expect(result.project.tracks[1].clips.map((item) => item.startTime)).toEqual([1, 2, 6]);
    expect(result.project.tracks[1].clips[1]).toMatchObject({ offset: 2, duration: 2 });
  });

  it('per-track ripples following clips even when the selection is in a gap', () => {
    const result = edit('per-track', 5.5, 6, ['a']);
    expect(result.project.tracks[0].clips.map((item) => item.startTime)).toEqual([1, 6.5]);
    expect(result.didChange).toBe(true);
  });

  it('leave-gap and per-clip are exact no-ops in a gap', () => {
    const source = makeProject();
    for (const mode of ['leave-gap', 'per-clip'] as const) {
      const result = applySelectionEdit(source, 5.5, 6, mode, ['a'], createId);
      expect(result.project).toBe(source);
      expect(result.didChange).toBe(false);
    }
  });

  it('removes fully covered clips and keeps partial left/right clips', () => {
    const removed = edit('per-clip', 0, 10, ['a']);
    expect(removed.project.tracks[0].clips).toEqual([]);
    const leftOnly = edit('per-clip', 2, 10, ['a']);
    expect(leftOnly.project.tracks[0].clips).toHaveLength(1);
    expect(leftOnly.project.tracks[0].clips[0]).toMatchObject({ startTime: 1, duration: 1 });
    const rightOnly = edit('per-clip', 0, 2, ['a']);
    expect(rightOnly.project.tracks[0].clips[0]).toMatchObject({ startTime: 0, duration: 3, offset: 4 });
  });

  it('snaps both boundaries to samples like WaveTrack::HandleClear', () => {
    const result = edit('leave-gap', 2.04, 2.96, ['a']);
    const [left, right] = result.project.tracks[0].clips;
    expect(left.duration).toBe(1);
    expect(right).toMatchObject({ startTime: 3, offset: 6, duration: 2 });
  });

  it('normalizes reversed selections and clamps their start to zero', () => {
    const result = edit('per-clip', 2, -1, ['a']);
    expect(result.project.tracks[0].clips[0]).toMatchObject({ startTime: 0, duration: 3, offset: 4 });
  });

  it('returns the original project for invalid or empty selections and missing tracks', () => {
    const source = makeProject();
    for (const [start, end, tracks] of [[2, 2, ['a']], [NaN, 3, ['a']], [2, 3, []], [2, 3, ['missing']]] as const) {
      const result = applySelectionEdit(source, start, end, 'per-track', tracks, createId);
      expect(result.project).toBe(source);
      expect(result.didChange).toBe(false);
    }
  });

  it('keeps the original source window when trim composes two ripple deletes', () => {
    nextId = 0;
    const source = makeProject();
    const after = applySelectionEdit(source, 3, 10, 'all-tracks', [], createId).project;
    const trimmed = applySelectionEdit(after, 0, 2, 'all-tracks', [], createId);
    const clip = trimmed.project.tracks[0].clips[0];
    expect(trimmed.project.tracks[0].clips).toHaveLength(1);
    expect(clip).toMatchObject({
      audioBufferId: 'buffer-a', startTime: 0, duration: 1, offset: 4,
      originalDuration: 12, stretchRatio: 2, pitchCents: 125, clipTempo: 110,
    });
  });

  it('does not modify the input project or untouched clip objects', () => {
    const source = makeProject();
    const result = applySelectionEdit(source, 2, 3, 'per-clip', ['a'], createId);
    expect(source.tracks[0].clips).toHaveLength(2);
    expect(source.tracks[0].clips[0]).toMatchObject({ startTime: 1, duration: 4, offset: 2 });
    expect(result.project.tracks[0].clips[2]).toBe(source.tracks[0].clips[1]);
    expect(result.project.tracks[1]).toBe(source.tracks[1]);
  });
});
