import { describe, expect, it } from 'vitest';
import { findClippedSampleRanges } from '@/lib/clippingDetection';

describe('clipping detection', () => {
  it('treats samples touching either full-scale bound as clipped', () => {
    expect(findClippedSampleRanges(new Float32Array([1, -1, 0.999, -0.999]))).toEqual([
      { startSample: 0, endSample: 2 },
    ]);
  });

  it('keeps separate runs and includes above-full-scale samples', () => {
    expect(findClippedSampleRanges(new Float32Array([1, 0, -1.25, -1, 0.5]))).toEqual([
      { startSample: 0, endSample: 1 },
      { startSample: 2, endSample: 4 },
    ]);
  });

  it('supports precise sample subranges', () => {
    expect(findClippedSampleRanges(new Float32Array([1, 1, -1, -1]), 1, 3)).toEqual([
      { startSample: 1, endSample: 3 },
    ]);
  });

  it('returns an empty list without clipping', () => {
    expect(findClippedSampleRanges(new Float32Array([0, 0.999, -0.999]))).toEqual([]);
  });

  it('rejects invalid ranges before scanning', () => {
    expect(() => findClippedSampleRanges(new Float32Array([1]), -1, 1)).toThrow();
    expect(() => findClippedSampleRanges(new Float32Array([1]), 0, 2)).toThrow();
  });
});
