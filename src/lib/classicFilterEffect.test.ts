import { describe, expect, it } from 'vitest';
import {
  CLASSIC_FILTER_TYPES,
  DEFAULT_CLASSIC_FILTER_SETTINGS,
  classicFilterMagnitudeAtFrequency,
  createClassicFilterState,
  processClassicFilter,
  processClassicFilterChannels,
  validateClassicFilterSettings,
  type ClassicFilterSettings,
} from './classicFilterEffect';

const base: ClassicFilterSettings = { ...DEFAULT_CLASSIC_FILTER_SETTINGS, order: 5 };

function signal(length: number, phase = 0): Float32Array {
  return Float32Array.from({ length }, (_, index) => (
    0.5 * Math.sin(index * 0.11 + phase) + 0.2 * Math.cos(index * 0.027)
  ));
}

describe('Classic Filters parameter and response contract', () => {
  it('uses the official defaults', () => {
    expect(DEFAULT_CLASSIC_FILTER_SETTINGS).toEqual({
      filterType: 'butterworth',
      subtype: 'lowpass',
      order: 1,
      cutoffHz: 1000,
      passbandRippleDb: 1,
      stopbandAttenuationDb: 30,
    });
  });

  it('creates floor((order + 1) / 2) biquads for every type and order', () => {
    for (const filterType of CLASSIC_FILTER_TYPES) {
      for (let order = 1; order <= 10; order += 1) {
        const state = createClassicFilterState({ ...base, filterType, order }, 48000);
        expect(state.sections).toHaveLength(Math.floor((order + 1) / 2));
        for (const item of state.sections) {
          expect([item.b0, item.b1, item.b2, item.a1, item.a2].every(Number.isFinite)).toBe(true);
        }
      }
    }
  });

  it.each([
    { order: 0 }, { order: 11 }, { order: 2.5 },
    { cutoffHz: 0 }, { cutoffHz: Number.NaN }, { cutoffHz: 24000 },
    { passbandRippleDb: -0.1 }, { passbandRippleDb: 100.1 },
    { stopbandAttenuationDb: -1 }, { stopbandAttenuationDb: Number.POSITIVE_INFINITY },
  ])('rejects invalid settings: %o', (patch) => {
    expect(() => validateClassicFilterSettings({ ...base, ...patch }, 48000)).toThrow(RangeError);
  });

  it('enforces the official Nyquist minus one cutoff limit', () => {
    expect(() => validateClassicFilterSettings({ ...base, cutoffHz: 499 }, 1000)).not.toThrow();
    expect(() => validateClassicFilterSettings({ ...base, cutoffHz: 499.01 }, 1000)).toThrow(/Nyquist/);
    expect(() => validateClassicFilterSettings(base, 2)).toThrow(/采样率/);
  });

  it('rejects unknown filter families and directions', () => {
    expect(() => validateClassicFilterSettings({ ...base, filterType: 'delay' as never })).toThrow(/类型/);
    expect(() => validateClassicFilterSettings({ ...base, subtype: 'bandpass' as never })).toThrow(/Subtype/);
  });

  it('gives Butterworth its −3 dB cutoff and correct DC behavior', () => {
    for (const subtype of ['lowpass', 'highpass'] as const) {
      for (let order = 1; order <= 10; order += 1) {
        const settings = { ...base, filterType: 'butterworth' as const, subtype, order };
        expect(classicFilterMagnitudeAtFrequency(settings, 48000, 1000)).toBeCloseTo(1 / Math.sqrt(2), 12);
      }
      expect(classicFilterMagnitudeAtFrequency(
        { ...base, filterType: 'butterworth', subtype }, 48000, 0,
      )).toBe(subtype === 'lowpass' ? 1 : 0);
    }
  });

  it('keeps all response families finite and normalized across the spectrum', () => {
    for (const filterType of CLASSIC_FILTER_TYPES) {
      for (const subtype of ['lowpass', 'highpass'] as const) {
        for (const order of [1, 2, 5, 10]) {
          const settings = { ...base, filterType, subtype, order };
          for (const frequency of [0, 1, 20, 100, 1000, 5000, 12000, 23999, 30000]) {
            const magnitude = classicFilterMagnitudeAtFrequency(settings, 48000, frequency);
            expect(Number.isFinite(magnitude)).toBe(true);
            expect(magnitude).toBeGreaterThanOrEqual(0);
            expect(magnitude).toBeLessThanOrEqual(1 + 1e-12);
          }
        }
      }
    }
  });

  it('rejects invalid response frequencies', () => {
    expect(() => classicFilterMagnitudeAtFrequency(base, 48000, -1)).toThrow(/响应频率/);
    expect(() => classicFilterMagnitudeAtFrequency(base, 48000, Number.NaN)).toThrow(/响应频率/);
  });
});

describe('Classic Filters streaming and channel safety', () => {
  it('matches mono processing when stereo state is continued across arbitrary chunks', () => {
    const settings = { ...base, filterType: 'chebyshev2' as const, subtype: 'highpass' as const, order: 5 };
    const left = signal(517), right = signal(517, 0.7);
    const expected = processClassicFilterChannels([left, right], settings, 48000);
    const states = [createClassicFilterState(settings, 48000), createClassicFilterState(settings, 48000)];
    const actual = [new Float32Array(left.length), new Float32Array(right.length)];
    for (const [start, end] of [[0, 1], [1, 127], [127, 128], [128, 517]]) {
      const chunk = processClassicFilterChannels([
        left.slice(start, end), right.slice(start, end),
      ], settings, 48000, states);
      actual[0].set(chunk[0], start);
      actual[1].set(chunk[1], start);
    }
    expect(actual[0]).toEqual(expected[0]);
    expect(actual[1]).toEqual(expected[1]);
    expect(actual[0]).not.toEqual(actual[1]);
  });

  it('does not mutate input and supports an empty selection chunk', () => {
    const input = signal(16);
    const snapshot = new Float32Array(input);
    const state = createClassicFilterState(base, 48000);
    expect(processClassicFilter(new Float32Array(), base, 48000, state)).toHaveLength(0);
    const output = processClassicFilter(input, base, 48000, state);
    expect(input).toEqual(snapshot);
    expect(output).not.toBe(input);
    expect(output.some((value, index) => value !== input[index])).toBe(true);
  });

  it('rejects state reuse with different parameters', () => {
    const state = createClassicFilterState(base, 48000);
    expect(() => processClassicFilter(signal(4), { ...base, order: 6 }, 48000, state)).toThrow(/状态与当前参数/);
    expect(() => processClassicFilter(signal(4), base, 44100, state)).toThrow(/Nyquist|状态与当前参数/);
  });

  it('rejects non-finite samples instead of poisoning filter history', () => {
    const state = createClassicFilterState(base, 48000);
    expect(() => processClassicFilter(Float32Array.of(0, Number.NaN), base, 48000, state)).toThrow(/非有限/);
    expect(state.sections.every((item) => item.previousOutput === 0)).toBe(true);
  });

  it('rejects missing, unequal, or mismatched channel state', () => {
    expect(() => processClassicFilterChannels([], base, 48000)).toThrow(/至少/);
    expect(() => processClassicFilterChannels([signal(3), signal(4)], base, 48000)).toThrow(/等长/);
    expect(() => processClassicFilterChannels([signal(3), signal(3)], base, 48000, [
      createClassicFilterState(base, 48000),
    ])).toThrow(/每个输入声道/);
  });
});
