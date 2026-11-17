import { describe, expect, it } from 'vitest';
import type { IClip, IProject, ITrack } from '@/types/project';
import { alignProjectTracks, alignTracks, getTrackEndTime, getTrackStartTime } from './trackAlignment';

function makeTrack(id: string, clips: Array<readonly [number, number]>): ITrack {
  return {
    id,
    name: id,
    type: 'audio',
    gain: 0,
    pan: 0,
    muted: false,
    solo: false,
    armed: false,
    color: '',
    clips: clips.map(([startTime, duration], index): IClip => ({
      id: `${id}-${index}`,
      audioBufferId: `buffer-${id}-${index}`,
      startTime,
      duration,
      offset: 0,
      originalDuration: duration,
      stretchRatio: 1,
      gain: 0,
      fadeIn: 0,
      fadeOut: 0,
    })),
    effects: [],
  };
}

function starts(result: { tracks: ITrack[] }, id: string): number[] {
  return result.tracks.find((track) => track.id === id)!.clips.map((clip) => clip.startTime);
}

describe('Audacity DoAlign track alignment', () => {
  it('uses the earliest clip start and latest clip end, with empty tracks at zero', () => {
    const track = makeTrack('a', [[8, 1], [3, 2], [6, 0]]);
    expect(getTrackStartTime(track)).toBe(3);
    expect(getTrackEndTime(track)).toBe(9);
    expect(getTrackStartTime(makeTrack('empty', []))).toBe(0);
    expect(getTrackEndTime(makeTrack('empty', []))).toBe(0);
  });

  it('aligns the earliest selected start to zero and leaves unselected tracks untouched', () => {
    const tracks = [makeTrack('a', [[5, 2]]), makeTrack('b', [[2, 1]]), makeTrack('c', [[7, 1]])];
    const result = alignTracks(tracks, ['a', 'b'], 'start-zero', null);
    expect(starts(result, 'a')).toEqual([3]);
    expect(starts(result, 'b')).toEqual([0]);
    expect(result.tracks[2]).toBe(tracks[2]);
    expect(result.label).toBe('Align Start');
    expect(starts({ tracks }, 'a')).toEqual([5]);
  });

  it('uses cursor/selection start and selection end for start alignment', () => {
    const tracks = [makeTrack('a', [[5, 1]]), makeTrack('b', [[3, 2]])];
    expect(starts(alignTracks(tracks, ['a', 'b'], 'start-selection-start', { start: 4, end: 9 }), 'a')).toEqual([6]);
    expect(starts(alignTracks(tracks, ['a', 'b'], 'start-selection-end', { start: 4, end: 9 }), 'a')).toEqual([11]);
  });

  it('aligns the latest selected end to either selection boundary', () => {
    const tracks = [makeTrack('a', [[5, 1]]), makeTrack('b', [[3, 4]])];
    const toStart = alignTracks(tracks, ['a', 'b'], 'end-selection-start', { start: 2, end: 9 });
    expect(starts(toStart, 'a')).toEqual([0]);
    expect(starts(toStart, 'b')).toEqual([-2]);
    expect(toStart.label).toBe('Align End');
    const toEnd = alignTracks(tracks, ['a', 'b'], 'end-selection-end', { start: 2, end: 9 });
    expect(starts(toEnd, 'a')).toEqual([7]);
    expect(starts(toEnd, 'b')).toEqual([5]);
  });

  it('places selected tracks end to end in project order using the first selected start', () => {
    const tracks = [
      makeTrack('a', [[4, 2]]),
      makeTrack('b', [[8, 1], [12, 1]]),
      makeTrack('skip', [[20, 3]]),
      makeTrack('c', [[1, 3]]),
    ];
    const result = alignTracks(tracks, ['c', 'a', 'b'], 'end-to-end', null);
    expect(starts(result, 'a')).toEqual([4]);
    expect(starts(result, 'b')).toEqual([6, 10]);
    expect(starts(result, 'c')).toEqual([11]);
    expect(result.tracks[2]).toBe(tracks[2]);
    expect(result.label).toBe('Align End to End');
  });

  it('moves every selected track to the average start for Align Together', () => {
    const tracks = [makeTrack('a', [[2, 2]]), makeTrack('b', [[6, 1]]), makeTrack('c', [[10, 4]])];
    const result = alignTracks(tracks, ['a', 'b', 'c'], 'together', null);
    expect(starts(result, 'a')).toEqual([6]);
    expect(starts(result, 'b')).toEqual([6]);
    expect(starts(result, 'c')).toEqual([6]);
    expect(result.label).toBe('Align Together');
  });

  it('returns no movement without selected tracks and shifts track-scoped labels by the same delta', () => {
    const tracks = [makeTrack('a', [[3, 1]])];
    expect(alignTracks(tracks, [], 'start-zero', null).tracks[0]).toBe(tracks[0]);
    const project = {
      tracks,
      analysisLabels: [
        { id: 'a-label', kind: 'manual', trackId: 'a', start: 3.5, end: 3.75, text: 'A' },
        { id: 'b-label', kind: 'manual', trackId: 'b', start: 4, end: 5, text: 'B' },
      ],
    } as IProject;
    const aligned = alignProjectTracks(project, ['a'], 'start-zero', null);
    expect(aligned.analysisLabels![0]).toMatchObject({ start: 0.5, end: 0.75 });
    expect(aligned.analysisLabels![1]).toBe(project.analysisLabels![1]);
  });

  it('moves selection and cursor with fixed-delta tracks only when the official preference is enabled', () => {
    const tracks = [makeTrack('a', [[5, 2]]), makeTrack('b', [[1, 1]])];
    const project = {
      tracks,
      cursorPosition: 6,
      selection: { start: 6, end: 8 },
    } as IProject;
    const stationary = alignProjectTracks(project, ['a', 'b'], 'start-zero', project.selection);
    expect(stationary.selection).toEqual({ start: 6, end: 8 });
    expect(stationary.cursorPosition).toBe(6);

    const moved = alignProjectTracks(
      project,
      ['a', 'b'],
      'start-zero',
      project.selection,
      { moveSelectionWithTracks: true },
    );
    expect(starts(moved, 'a')).toEqual([4]);
    expect(starts(moved, 'b')).toEqual([0]);
    expect(moved.selection).toEqual({ start: 5, end: 7 });
    expect(moved.cursorPosition).toBe(5);
    expect(alignTracks(tracks, ['a', 'b'], 'start-zero', project.selection, true).label)
      .toBe('Align/Move Start');
  });

  it('preserves official negative selection bounds and never moves selection for no-sync modes', () => {
    const tracks = [makeTrack('a', [[5, 1]]), makeTrack('b', [[3, 4]])];
    const project = {
      tracks,
      cursorPosition: 2,
      selection: { start: 2, end: 9 },
    } as IProject;
    const moved = alignProjectTracks(
      project,
      ['a', 'b'],
      'end-selection-start',
      project.selection,
      { moveSelectionWithTracks: true },
    );
    expect(moved.selection).toEqual({ start: -3, end: 4 });
    expect(moved.cursorPosition).toBe(-3);
    expect(alignTracks(tracks, ['a', 'b'], 'end-selection-start', project.selection, true).label)
      .toBe('Align/Move End');

    for (const mode of ['end-to-end', 'together'] as const) {
      const aligned = alignProjectTracks(
        project,
        ['a', 'b'],
        mode,
        project.selection,
        { moveSelectionWithTracks: true },
      );
      expect(aligned.selection).toEqual(project.selection);
      expect(aligned.cursorPosition).toBe(project.cursorPosition);
      const noSync = alignTracks(tracks, ['a', 'b'], mode, project.selection, true);
      expect(noSync.selectionDelta).toBe(0);
      // DoAlign still changes the short history label when moveSel is enabled,
      // although these two modes have delta == 0 and never move the selection.
      expect(noSync.label).toBe(mode === 'end-to-end' ? 'Align/Move End to End' : 'Align/Move Together');
    }
  });
});
