import { describe, expect, it } from 'vitest';
import type { IClip, ITrack } from '@/types/project';
import { compareTrackNames, getTrackSortTime, sortTracks } from './trackSorting';

function clip(startTime: number, duration = 1): IClip {
  return {
    id: `${startTime}-${duration}`,
    audioBufferId: 'buffer',
    startTime,
    duration,
    originalDuration: duration,
    offset: 0,
    stretchRatio: 1,
    gain: 0,
    fadeIn: 0,
    fadeOut: 0,
  };
}

function track(id: string, name: string, clips: IClip[]): ITrack {
  return {
    id,
    name,
    type: 'audio',
    gain: 0,
    pan: 0,
    muted: false,
    solo: false,
    armed: false,
    color: '',
    clips,
    effects: [],
  };
}

describe('trackSorting', () => {
  it('sorts by the earliest visible clip start and ignores zero-length clips for the start key', () => {
    const late = track('late', 'Late', [clip(5, 2), clip(-100, 0)]);
    const early = track('early', 'Early', [clip(1)]);
    const middle = track('middle', 'Middle', [clip(3), clip(2)]);

    expect(getTrackSortTime(late)).toBe(5);
    expect(sortTracks([late, middle, early], 'time').map((item) => item.id))
      .toEqual(['early', 'middle', 'late']);
  });

  it('uses zero for empty tracks, track end for zero-length-only tracks, and keeps equal keys stable', () => {
    const empty = track('empty', 'Empty', []);
    const zeroOnly = track('zero', 'Zero', [clip(4, 0)]);
    const first = track('first', 'First', [clip(2)]);
    const second = track('second', 'Second', [clip(2)]);

    expect(getTrackSortTime(empty)).toBe(0);
    expect(getTrackSortTime(zeroOnly)).toBe(4);
    expect(sortTracks([zeroOnly, first, second, empty], 'time').map((item) => item.id))
      .toEqual(['empty', 'first', 'second', 'zero']);
  });

  it('sorts names case-insensitively before applying the lowercase-first tie break', () => {
    const upperBeta = track('upper', 'Beta', []);
    const alpha = track('alpha', 'alpha', []);
    const lowerBeta = track('lower', 'beta', []);

    expect(compareTrackNames('beta', 'Beta')).toBeLessThan(0);
    expect(sortTracks([upperBeta, alpha, lowerBeta], 'name').map((item) => item.id))
      .toEqual(['alpha', 'lower', 'upper']);
  });

  it('keeps exactly equal names stable', () => {
    const first = track('first', 'Same', []);
    const second = track('second', 'Same', []);

    expect(sortTracks([first, second], 'name')).toEqual([first, second]);
  });

  it('does not mutate tracks, clips, or the source ordering', () => {
    const source = [track('b', 'b', [clip(2)]), track('a', 'a', [clip(1)])];
    const snapshot = structuredClone(source);
    const result = sortTracks(source, 'time');

    expect(result.map((item) => item.id)).toEqual(['a', 'b']);
    expect(result[0]).toBe(source[1]);
    expect(result[0]!.clips[0]).toBe(source[1]!.clips[0]);
    expect(source).toEqual(snapshot);
  });
});
