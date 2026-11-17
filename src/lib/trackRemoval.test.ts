import { describe, expect, it } from 'vitest';
import { resolveRemoveTrackFocus } from './trackRemoval';

describe('resolveRemoveTrackFocus', () => {
  it('focuses the next surviving track after a middle removal', () => {
    expect(resolveRemoveTrackFocus(['a', 'b', 'c'], ['b'])).toBe('c');
  });

  it('falls back to the preceding track when no next track survives', () => {
    expect(resolveRemoveTrackFocus(['a', 'b', 'c'], ['c'])).toBe('b');
  });

  it('uses the official last-track fallback when removal starts at the beginning', () => {
    expect(resolveRemoveTrackFocus(['a', 'b', 'c', 'd'], ['a', 'c'])).toBe('d');
  });

  it('skips later removed tracks when finding the next survivor', () => {
    expect(resolveRemoveTrackFocus(['a', 'b', 'c', 'd', 'e'], ['b', 'd'])).toBe('c');
  });

  it('returns null when every track is removed or there was no target', () => {
    expect(resolveRemoveTrackFocus(['a', 'b'], ['a', 'b'])).toBeNull();
    expect(resolveRemoveTrackFocus(['a', 'b'], [])).toBeNull();
    expect(resolveRemoveTrackFocus([], [])).toBeNull();
  });
});
