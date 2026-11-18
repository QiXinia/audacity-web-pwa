import { describe, expect, it } from 'vitest';
import { planRangeJoin, splitRangeSelection } from '@/lib/selectionStructure';
import type { IClip, IProject, ITrack } from '@/types/project';

function clip(id: string, startTime: number, duration: number, overrides: Partial<IClip> = {}): IClip {
  return {
    id, audioBufferId: `pcm-${id}`, startTime, duration, offset: 2,
    originalDuration: 20, stretchRatio: 2, gain: -2, fadeIn: 0.1, fadeOut: 0.2,
    pitchCents: 100, rawAudioTempo: 95, clipTempo: 120, name: id, ...overrides,
  };
}

function track(id: string, clips: IClip[]): ITrack {
  return { id, name: id, type: 'audio', gain: 0, pan: 0, muted: false, solo: false, armed: false, color: '', effects: [], clips };
}

function project(): IProject {
  return {
    id: 'p', name: 'p', sampleRate: 10, createdAt: 0, updatedAt: 0, tempo: 120,
    timeSignature: { numerator: 4, denominator: 4 }, cursorPosition: 0, selection: null,
    viewState: { horizontalZoom: 100, verticalZoom: 1, scrollX: 0, viewMode: 'waveform' },
    tracks: [
      track('a', [clip('whole', 1, 4), clip('inside', 6, 1), clip('after', 9, 2)]),
      track('b', [clip('other', 0, 12)]),
    ],
  };
}

function ids() {
  let value = 0;
  return () => `new-${++value}`;
}

describe('Audacity range Split', () => {
  it('splits both boundaries and preserves source windows and all non-timing metadata', () => {
    const source = project();
    const result = splitRangeSelection(source, { start: 2, end: 4 }, ['a'], ids());
    expect(result.didChange).toBe(true);
    const [left, middle, right] = result.project.tracks[0]!.clips;
    expect(left).toMatchObject({ startTime: 1, duration: 1, offset: 2, fadeIn: 0.1, fadeOut: 0 });
    expect(middle).toMatchObject({ startTime: 2, duration: 2, offset: 4, fadeIn: 0, fadeOut: 0 });
    expect(right).toMatchObject({ startTime: 4, duration: 1, offset: 8, fadeIn: 0, fadeOut: 0.2 });
    expect(right).toMatchObject({ audioBufferId: 'pcm-whole', originalDuration: 20, stretchRatio: 2, pitchCents: 100, gain: -2 });
    expect(result.project.tracks[1]).toBe(source.tracks[1]);
    expect(source.tracks[0]!.clips).toHaveLength(3);
  });

  it('snaps reversed boundaries to samples and leaves clips with no interior boundary untouched', () => {
    const source = project();
    const result = splitRangeSelection(source, { start: 4.04, end: 1.96 }, ['a'], ids());
    expect(result.project.tracks[0]!.clips.slice(0, 3).map((item) => item.startTime)).toEqual([1, 2, 4]);
    expect(result.project.tracks[0]!.clips[3]).toBe(source.tracks[0]!.clips[1]);
    expect(result.project.tracks[0]!.clips[4]).toBe(source.tracks[0]!.clips[2]);
  });

  it('returns the original project for invalid ranges, missing tracks or no interior split', () => {
    const source = project();
    for (const range of [{ start: 2, end: 2 }, { start: NaN, end: 3 }, { start: 5, end: 5.5 }]) {
      const result = splitRangeSelection(source, range, ['a'], ids());
      expect(result.project).toBe(source);
      expect(result.didChange).toBe(false);
    }
    expect(splitRangeSelection(source, { start: 2, end: 4 }, [], ids()).project).toBe(source);
  });
});

describe('Audacity WaveTrack::Join planning', () => {
  it('includes whole intersecting clips, preserves outside audio and fills the model span', () => {
    const source = project();
    source.tracks[0]!.clips = [clip('first', 0, 3), clip('second', 5, 2), clip('outside', 10, 1)];
    const groups = planRangeJoin(source, { start: 2, end: 5.5 }, ['a']);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ trackId: 'a', start: 0, end: 7 });
    expect(groups[0]!.clips.map((item) => item.id)).toEqual(['first', 'second']);
    expect(groups[0]!.clips[0]).toBe(source.tracks[0]!.clips[0]);
  });

  it('requires two intersecting clips on the same track', () => {
    const source = project();
    expect(planRangeJoin(source, { start: 6, end: 7 }, ['a'])).toEqual([]);
    source.tracks[1]!.clips = [clip('b-first', 0, 3), clip('b-second', 5, 2)];
    expect(planRangeJoin(source, { start: 0, end: 12 }, ['a', 'b'])).toHaveLength(2);
  });

  it('normalizes selection boundaries and rejects empty targets', () => {
    const source = project();
    const groups = planRangeJoin(source, { start: 7.04, end: 0.96 }, ['a']);
    expect(groups[0]!.clips.map((item) => item.id)).toEqual(['whole', 'inside']);
    expect(planRangeJoin(source, { start: 0, end: 20 }, [], )).toEqual([]);
    expect(planRangeJoin(source, { start: 2, end: 2 }, ['a'])).toEqual([]);
  });
});
