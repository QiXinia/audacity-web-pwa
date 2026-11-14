import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NOTCH_FILTER_SETTINGS,
  createNotchFilterState,
  notchFilterMagnitudeAtFrequency,
  processNotchFilter,
  processNotchFilterChannels,
} from './notchFilterEffect';

describe('Audacity Notch Filter', () => {
  it('creates a deep null at the selected frequency and preserves DC and Nyquist gain', () => {
    expect(notchFilterMagnitudeAtFrequency(DEFAULT_NOTCH_FILTER_SETTINGS, 1000, 60)).toBeCloseTo(0, 10);
    expect(notchFilterMagnitudeAtFrequency(DEFAULT_NOTCH_FILTER_SETTINGS, 1000, 0)).toBeCloseTo(1, 10);
    expect(notchFilterMagnitudeAtFrequency(DEFAULT_NOTCH_FILTER_SETTINGS, 1000, 500)).toBeCloseTo(1, 10);
  });

  it('makes higher Q produce a narrower notch', () => {
    const wide = { frequencyHz: 100, q: 0.1 };
    const narrow = { frequencyHz: 100, q: 10 };
    const nearby = 105;
    expect(notchFilterMagnitudeAtFrequency(wide, 1000, nearby))
      .toBeLessThan(notchFilterMagnitudeAtFrequency(narrow, 1000, nearby));
    expect(notchFilterMagnitudeAtFrequency(wide, 1000, 100)).toBeCloseTo(0, 10);
    expect(notchFilterMagnitudeAtFrequency(narrow, 1000, 100)).toBeCloseTo(0, 10);
  });

  it('processes finite audio without mutating input and keeps output length', () => {
    const input = Float32Array.from([0.2, -0.4, 0.8, -0.1, 0.3, 0.7]);
    const snapshot = Array.from(input);
    const output = processNotchFilter(input, DEFAULT_NOTCH_FILTER_SETTINGS, 1000);
    expect(output).toHaveLength(input.length);
    expect(Array.from(input)).toEqual(snapshot);
    expect(output).not.toBe(input);
  });

  it('preserves biquad state across adjacent clip buffers', () => {
    const first = Float32Array.from([1, 0, 0, 0]);
    const second = Float32Array.from([0, 0, 0, 0]);
    const state = createNotchFilterState(DEFAULT_NOTCH_FILTER_SETTINGS, 1000);
    const firstOutput = processNotchFilter(first, DEFAULT_NOTCH_FILTER_SETTINGS, 1000, state);
    const secondOutput = processNotchFilter(second, DEFAULT_NOTCH_FILTER_SETTINGS, 1000, state);
    const freshSecond = processNotchFilter(second, DEFAULT_NOTCH_FILTER_SETTINGS, 1000);
    expect(Array.from(secondOutput)).not.toEqual(Array.from(freshSecond));
    expect(firstOutput).toHaveLength(4);
  });

  it('processes stereo channels independently', () => {
    const left = Float32Array.from([0.1, 0.2, 0.3, 0.4]);
    const right = Float32Array.from([0.8, -0.7, 0.6, -0.5]);
    const [outLeft, outRight] = processNotchFilterChannels(
      [left, right], DEFAULT_NOTCH_FILTER_SETTINGS, 1000,
    );
    expect(Array.from(outLeft)).not.toEqual(Array.from(outRight));
    expect(outLeft).toHaveLength(4);
  });

  it('rejects invalid frequencies, Q values and unequal channel lengths', () => {
    expect(() => processNotchFilter(Float32Array.from([1]), { frequencyHz: 0.05, q: 1 }, 1000))
      .toThrow('0.1 Hz');
    expect(() => processNotchFilter(Float32Array.from([1]), { frequencyHz: 500, q: 1 }, 1000))
      .toThrow('Nyquist');
    expect(() => processNotchFilter(Float32Array.from([1]), { frequencyHz: 60, q: 1001 }, 1000))
      .toThrow('Q');
    expect(() => processNotchFilterChannels(
      [Float32Array.from([1, 2]), Float32Array.from([1])], DEFAULT_NOTCH_FILTER_SETTINGS, 1000,
    )).toThrow('等长');
  });
});
