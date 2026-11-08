import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VERTICAL_ZOOM,
  MAX_VERTICAL_ZOOM,
  MIN_VERTICAL_ZOOM,
  normalizeVerticalZoom,
  stepVerticalZoom,
} from '@/lib/verticalZoom';

describe('vertical zoom controls', () => {
  it('uses Audacity display-bound steps and stops at the supported limits', () => {
    expect(stepVerticalZoom(1, 'in')).toBe(2);
    expect(stepVerticalZoom(2, 'out')).toBe(1);
    expect(stepVerticalZoom(MIN_VERTICAL_ZOOM, 'out')).toBe(MIN_VERTICAL_ZOOM);
    expect(stepVerticalZoom(MAX_VERTICAL_ZOOM, 'in')).toBe(MAX_VERTICAL_ZOOM);
  });

  it('normalizes invalid or out-of-range persisted values', () => {
    for (const value of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(normalizeVerticalZoom(value)).toBe(DEFAULT_VERTICAL_ZOOM);
    }
    expect(normalizeVerticalZoom(0.25)).toBe(MIN_VERTICAL_ZOOM);
    expect(normalizeVerticalZoom(1024)).toBe(MAX_VERTICAL_ZOOM);
  });
});
