import { describe, expect, it } from 'vitest';
import type { ClipKey } from '@/lib/clipEditing';
import {
  planMultiClipJoin,
  planMultiClipSelection,
  removeMultiClipSelection,
} from '@/lib/multiClipEditing';
import type { IClip, IProject } from '@/types/project';

const clip = (id: string, startTime: number, duration = 1): IClip => ({
  id, audioBufferId: `buffer-${id}`, startTime, offset: 0, duration,
  originalDuration: duration, stretchRatio: 1, gain: 0, fadeIn: 0, fadeOut: 0, name: id,
});
const key = (trackId: string, clipId: string): ClipKey => ({ trackId, clipId });

function project(): IProject {
  return {
    id: 'multi-clip-unit', name: 'Multi Clip unit', sampleRate: 100,
    tracks: [
      {
        id: 'track-a', name: 'A', type: 'audio', gain: 0, pan: 0,
        muted: false, solo: false, armed: false, color: '', effects: [],
        clips: [clip('a1', 0), clip('a2', 2), clip('a3', 5)],
      },
      {
        id: 'track-b', name: 'B', type: 'audio', gain: 0, pan: 0,
        muted: false, solo: false, armed: false, color: '', effects: [], clips: [clip('b1', 0, 2)],
      },
    ],
    cursorPosition: 0, selection: null, spectralSelection: null,
    viewState: { horizontalZoom: 100, verticalZoom: 1, scrollX: 0, viewMode: 'waveform' },
    updatedAt: 100, createdAt: 50, timeSignature: { numerator: 4, denominator: 4 }, tempo: 120,
  };
}

describe('multi Clip selection planning', () => {
  it('resolves actual selected Clips in project order and computes their outer span', () => {
    const plan = planMultiClipSelection(project(), [key('track-a', 'a3'), key('track-b', 'b1'), key('track-a', 'a1')]);
    expect(plan?.tracks.map((track) => [track.trackId, track.clips.map((item) => item.id)])).toEqual([
      ['track-a', ['a1', 'a3']], ['track-b', ['b1']],
    ]);
    expect(plan?.start).toBe(0);
    expect(plan?.end).toBe(6);
  });

  it('deletes only selected Clips without moving an unselected Clip', () => {
    const result = removeMultiClipSelection(project(), [key('track-a', 'a1'), key('track-a', 'a3')], false);
    expect(result?.tracks[0]?.clips.map((item) => [item.id, item.startTime])).toEqual([['a2', 2]]);
    expect(result?.tracks[1]?.clips.map((item) => item.id)).toEqual(['b1']);
  });

  it('per-track ripple subtracts the selected durations from following Clips only', () => {
    const result = removeMultiClipSelection(project(), [key('track-a', 'a1'), key('track-a', 'a2')], true);
    expect(result?.tracks[0]?.clips.map((item) => [item.id, item.startTime])).toEqual([['a3', 3]]);
    expect(result?.tracks[1]?.clips.map((item) => [item.id, item.startTime])).toEqual([['b1', 0]]);
  });
});

describe('Audacity multi Clip Join eligibility', () => {
  it('allows same-track selected Clips separated by silence', () => {
    expect(planMultiClipJoin(project(), [key('track-a', 'a1'), key('track-a', 'a2')])).toMatchObject({
      trackId: 'track-a', start: 0, end: 3,
    });
  });

  it('rejects a span containing an unselected Clip', () => {
    expect(planMultiClipJoin(project(), [key('track-a', 'a1'), key('track-a', 'a3')])).toBeNull();
  });

  it('rejects cross-track, single and missing selections', () => {
    expect(planMultiClipJoin(project(), [key('track-a', 'a1'), key('track-b', 'b1')])).toBeNull();
    expect(planMultiClipJoin(project(), [key('track-a', 'a1')])).toBeNull();
    expect(planMultiClipJoin(project(), [key('track-a', 'a1'), key('track-a', 'missing')])).toBeNull();
  });
});
