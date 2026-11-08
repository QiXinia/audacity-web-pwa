import { describe, expect, it } from 'vitest';
import {
  DEFAULT_HORIZONTAL_ZOOM,
  MAX_HORIZONTAL_ZOOM,
  MIN_HORIZONTAL_ZOOM,
  horizontalZoomForDuration,
  normalizeHorizontalZoom,
  stepHorizontalZoom,
} from '@/lib/horizontalZoom';

describe('horizontal zoom controls', () => {
  it('uses Audacity normal zoom and 2x steps within the supported canvas bounds', () => {
    expect(DEFAULT_HORIZONTAL_ZOOM).toBe(44100 / 512);
    expect(stepHorizontalZoom(100, 'in')).toBe(200);
    expect(stepHorizontalZoom(100, 'out')).toBe(50);
    expect(stepHorizontalZoom(MAX_HORIZONTAL_ZOOM, 'in')).toBe(MAX_HORIZONTAL_ZOOM);
    expect(stepHorizontalZoom(MIN_HORIZONTAL_ZOOM, 'out')).toBe(MIN_HORIZONTAL_ZOOM);
  });

  it('normalizes invalid legacy values and clamps unsafe scales', () => {
    for (const value of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(normalizeHorizontalZoom(value)).toBe(DEFAULT_HORIZONTAL_ZOOM);
    }
    expect(normalizeHorizontalZoom(Number.NaN, 120)).toBe(120);
    expect(normalizeHorizontalZoom(1)).toBe(MIN_HORIZONTAL_ZOOM);
    expect(normalizeHorizontalZoom(1000)).toBe(MAX_HORIZONTAL_ZOOM);
  });

  it('fits a positive duration to the usable width and rejects unavailable geometry', () => {
    expect(horizontalZoomForDuration(4, 800)).toBe(199.75);
    expect(horizontalZoomForDuration(0.001, 800)).toBe(MAX_HORIZONTAL_ZOOM);
    expect(horizontalZoomForDuration(1000, 800)).toBe(MIN_HORIZONTAL_ZOOM);
    for (const [duration, width] of [[0, 800], [-1, 800], [1, 0], [1, 1], [Number.NaN, 800], [1, Number.NaN]]) {
      expect(horizontalZoomForDuration(duration, width)).toBeNull();
    }
  });
});
