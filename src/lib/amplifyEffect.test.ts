import { describe, expect, it } from 'vitest';
import {
  amplificationDbFromRatio,
  clampAmplifyRatio,
  DEFAULT_AMPLIFY_SETTINGS,
  defaultAmplifyRatio,
  isAmplifyAllowed,
  MAX_AMPLIFICATION_DB,
  MAX_AMPLIFY_RATIO,
  measureAmplifyPeak,
  MIN_AMPLIFICATION_DB,
  MIN_AMPLIFY_RATIO,
  newPeakDbFromRatio,
  processAmplifyChannels,
  ratioFromAmplificationDb,
  ratioFromNewPeakDb,
  validateAmplifySettings,
} from './amplifyEffect';

describe('Audacity Amplify DSP', () => {
  it('uses the official ratio bounds and converts both linked dB controls', () => {
    expect(DEFAULT_AMPLIFY_SETTINGS).toEqual({ ratio: 1, allowClipping: false });
    expect(MIN_AMPLIFICATION_DB).toBeCloseTo(-50, 2);
    expect(MAX_AMPLIFICATION_DB).toBeCloseTo(50, 3);
    expect(clampAmplifyRatio(0)).toBe(MIN_AMPLIFY_RATIO);
    expect(clampAmplifyRatio(Infinity)).toBe(MAX_AMPLIFY_RATIO);
    expect(ratioFromAmplificationDb(6)).toBeCloseTo(10 ** (6 / 20), 12);
    expect(amplificationDbFromRatio(2)).toBeCloseTo(6.020599913, 8);
    expect(ratioFromNewPeakDb(-6, 0.5)).toBeCloseTo(10 ** (-6 / 20) / 0.5, 12);
    expect(newPeakDbFromRatio(2, 0.25)).toBeCloseTo(-6.020599913, 8);
    expect(defaultAmplifyRatio(0.25)).toBe(4);
    expect(defaultAmplifyRatio(0)).toBe(1);
    expect(() => ratioFromNewPeakDb(0, 0)).toThrow('非静音');
  });

  it('measures one peak across clips and channels, including negative extrema', () => {
    expect(measureAmplifyPeak([
      Float32Array.from([0.1, -0.4]),
      Float32Array.from([0.25, 0.5]),
      Float32Array.from([-0.75, 0.2]),
    ])).toBe(0.75);
    expect(measureAmplifyPeak([new Float32Array(4)])).toBe(0);
    expect(() => measureAmplifyPeak([Float32Array.from([NaN])])).toThrow('非有限');
  });

  it('blocks a new peak above 0 dB unless clipping is explicitly allowed', () => {
    expect(isAmplifyAllowed({ ratio: 2, allowClipping: false }, 0.5)).toBe(true);
    expect(isAmplifyAllowed({ ratio: 2.01, allowClipping: false }, 0.5)).toBe(false);
    expect(isAmplifyAllowed({ ratio: 2.01, allowClipping: true }, 0.5)).toBe(true);
    expect(isAmplifyAllowed({ ratio: 1, allowClipping: false }, 0)).toBe(false);
    expect(isAmplifyAllowed({ ratio: 1, allowClipping: true }, 0)).toBe(true);
  });

  it('multiplies without mutating input and preserves values above full scale only by request', () => {
    const source = [Float32Array.from([0.25, -0.5]), Float32Array.from([0.125, -0.25])];
    const snapshot = source.map((channel) => channel.slice());
    const output = processAmplifyChannels(source, { ratio: 3, allowClipping: true });
    expect(output[0]).toEqual(Float32Array.from([0.75, -1.5]));
    expect(output[1]).toEqual(Float32Array.from([0.375, -0.75]));
    expect(source).toEqual(snapshot);
    expect(output[0]).not.toBe(source[0]);
  });

  it('validates ratio, channel shape and finite samples', () => {
    expect(() => validateAmplifySettings({ ratio: MIN_AMPLIFY_RATIO, allowClipping: false })).not.toThrow();
    expect(() => validateAmplifySettings({ ratio: MAX_AMPLIFY_RATIO, allowClipping: true })).not.toThrow();
    expect(() => validateAmplifySettings({ ratio: 0, allowClipping: false })).toThrow('放大倍率');
    expect(() => validateAmplifySettings({ ratio: NaN, allowClipping: false })).toThrow('放大倍率');
    expect(() => processAmplifyChannels([], DEFAULT_AMPLIFY_SETTINGS)).toThrow('至少需要一个音频声道');
    expect(() => processAmplifyChannels([
      new Float32Array(1), new Float32Array(2),
    ], DEFAULT_AMPLIFY_SETTINGS)).toThrow('必须等长');
    expect(() => processAmplifyChannels([
      Float32Array.from([Infinity]),
    ], DEFAULT_AMPLIFY_SETTINGS)).toThrow('非有限');
  });
});
