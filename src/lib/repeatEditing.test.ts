import { describe, expect, it } from 'vitest';
import {
  getMaxRepeatCount,
  insertRepeatedSelectionClips,
  validateRepeatCount,
} from '@/lib/repeatEditing';
import type { IClip, ITrack } from '@/types/project';

function makeClip(id: string, startTime: number, duration: number, extra: Partial<IClip> = {}): IClip {
  return {
    id,
    audioBufferId: `buffer-${id}`,
    startTime,
    offset: 0,
    duration,
    originalDuration: duration,
    stretchRatio: 1,
    gain: 0,
    fadeIn: 0,
    fadeOut: 0,
    name: id,
    ...extra,
  };
}

function makeTrack(clips: IClip[]): ITrack {
  return {
    id: 'track', name: 'Track', type: 'audio', gain: 0, pan: 0,
    muted: false, solo: false, armed: false, color: '', effects: [], clips,
  };
}

function template(duration: number): IClip {
  return makeClip('template', 0, duration, { audioBufferId: 'rendered-selection' });
}

function ids() {
  let index = 0;
  return () => `new-${++index}`;
}

describe('Repeat selection editing', () => {
  it('inserts the requested copies and shifts later clips without mutating the source track', () => {
    const original = makeTrack([
      makeClip('selected', 0, 1),
      makeClip('later', 2, 1),
    ]);
    const result = insertRepeatedSelectionClips(
      original, { start: 0, end: 1 }, 2, template(1), ids(),
    );

    expect(result.track.clips.map((clip) => [clip.id, clip.startTime, clip.duration])).toEqual([
      ['selected', 0, 1],
      ['new-1', 1, 1],
      ['new-2', 2, 1],
      ['later', 4, 1],
    ]);
    expect(result.insertedClips).toHaveLength(2);
    expect(result.insertedClips.map((clip) => clip.audioBufferId)).toEqual([
      'rendered-selection', 'rendered-selection',
    ]);
    expect(result.insertedClips.map((clip) => clip.name)).toEqual(['template 1', 'template 2']);
    expect(original.clips.map((clip) => [clip.id, clip.startTime])).toEqual([
      ['selected', 0], ['later', 2],
    ]);
  });

  it('splits a stretched clip at the insertion point and shifts its right source window', () => {
    const original = makeTrack([
      makeClip('crossing', 0, 4, {
        offset: 1, originalDuration: 9, stretchRatio: 2, fadeIn: 0.2, fadeOut: 0.3,
      }),
    ]);
    const result = insertRepeatedSelectionClips(
      original, { start: 0.5, end: 2 }, 2, template(1.5), ids(),
    );

    expect(result.track.clips).toHaveLength(4);
    const left = result.track.clips.find((clip) => clip.id === 'crossing')!;
    const right = result.track.clips.find((clip) => clip.id === 'new-1')!;
    expect(left).toMatchObject({ startTime: 0, duration: 2, offset: 1, fadeOut: 0 });
    expect(right).toMatchObject({ startTime: 5, duration: 2, offset: 5, fadeIn: 0 });
    expect(result.insertedClips.map((clip) => clip.startTime)).toEqual([2, 3.5]);
    expect(original.clips[0]).toMatchObject({ startTime: 0, duration: 4, offset: 1 });
  });

  it('keeps clips wholly before the insertion point unchanged', () => {
    const before = makeClip('before', 0, 0.5, { fadeOut: 0.1 });
    const result = insertRepeatedSelectionClips(
      makeTrack([before]), { start: 0.25, end: 0.5 }, 1, template(0.25), ids(),
    );
    expect(result.track.clips[0]).toBe(before);
    expect(result.track.clips[1]).toMatchObject({ startTime: 0.5, duration: 0.25 });
  });

  it('rejects invalid selections, counts and mismatched rendered audio', () => {
    const track = makeTrack([makeClip('source', 0, 1)]);
    expect(() => insertRepeatedSelectionClips(
      track, { start: 0, end: 0 }, 1, template(0), ids(),
    )).toThrow(/正时长/);
    expect(() => insertRepeatedSelectionClips(
      track, { start: 0, end: 1 }, 0, template(1), ids(),
    )).toThrow(/正整数/);
    expect(() => insertRepeatedSelectionClips(
      track, { start: 0, end: 1 }, 1, template(0.5), ids(),
    )).toThrow(/完全一致/);
  });

  it('enforces Audacity-compatible positive integer count limits', () => {
    expect(getMaxRepeatCount(10)).toBe(214748364);
    expect(validateRepeatCount(1, 44100)).toBe(1);
    expect(() => validateRepeatCount(0, 44100)).toThrow(/整数/);
    expect(() => validateRepeatCount(1.5, 44100)).toThrow(/整数/);
    expect(() => validateRepeatCount(getMaxRepeatCount(10) + 1, 10)).toThrow(/整数/);
  });
});
