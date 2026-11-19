import { describe, expect, it } from 'vitest';
import { moveTrackInOrder } from './trackMove';

const tracks = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];

describe('moveTrackInOrder', () => {
  it.each([
    ['up', ['a', 'c', 'b', 'd']],
    ['down', ['a', 'b', 'd', 'c']],
    ['top', ['c', 'a', 'b', 'd']],
    ['bottom', ['a', 'b', 'd', 'c']],
  ] as const)('moves one track %s while preserving every other relative position', (direction, expected) => {
    const original = structuredClone(tracks);
    const moved = moveTrackInOrder(tracks, 'c', direction);
    expect(moved.map((track) => track.id)).toEqual(expected);
    expect(tracks).toEqual(original);
    expect(moved.find((track) => track.id === 'c')).toBe(tracks[2]);
  });

  it.each([
    ['a', 'up'], ['a', 'top'], ['d', 'down'], ['d', 'bottom'],
  ] as const)('treats boundary command %s/%s as a no-op', (trackId, direction) => {
    const moved = moveTrackInOrder(tracks, trackId, direction);
    expect(moved.map((track) => track.id)).toEqual(tracks.map((track) => track.id));
    expect(moved).not.toBe(tracks);
  });

  it('does not invent a track for an unknown id or an empty list', () => {
    expect(moveTrackInOrder(tracks, 'missing', 'top').map((track) => track.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(moveTrackInOrder([], 'missing', 'bottom')).toEqual([]);
  });
});
