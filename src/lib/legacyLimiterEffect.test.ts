import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LEGACY_LIMITER_SETTINGS,
  processLegacyLimiterChannels,
  validateLegacyLimiterSettings,
  type LegacyLimiterSettings,
} from './legacyLimiterEffect';

function settings(overrides: Partial<LegacyLimiterSettings> = {}): LegacyLimiterSettings {
  return { ...DEFAULT_LEGACY_LIMITER_SETTINGS, ...overrides };
}

function dbToLinear(value: number): number {
  return 10 ** (value / 20);
}

describe('Audacity Legacy limiter official controls', () => {
  it('uses the official defaults and validates every control range', () => {
    expect(DEFAULT_LEGACY_LIMITER_SETTINGS).toEqual({
      type: 'softLimit', inputGainLeftDb: 0, inputGainRightDb: 0,
      limitToDb: -3, holdMs: 10, applyMakeupGain: false,
    });
    expect(() => validateLegacyLimiterSettings(settings({ type: 'other' as LegacyLimiterSettings['type'] }))).toThrow('Type');
    expect(() => validateLegacyLimiterSettings(settings({ inputGainLeftDb: -0.1 }))).toThrow('mono/Left');
    expect(() => validateLegacyLimiterSettings(settings({ inputGainRightDb: 10.1 }))).toThrow('Right channel');
    expect(() => validateLegacyLimiterSettings(settings({ limitToDb: -10.1 }))).toThrow('Limit to');
    expect(() => validateLegacyLimiterSettings(settings({ holdMs: 0 }))).toThrow('Hold');
    expect(() => validateLegacyLimiterSettings(settings({ applyMakeupGain: 1 as unknown as boolean }))).toThrow('布尔');
  });

  it('hard-clips to the selected linear threshold without changing interior samples', () => {
    const input = Float32Array.from([-2, -0.5, 0, 0.5, 2]);
    const [actual] = processLegacyLimiterChannels([input], settings({ type: 'hardClip', limitToDb: 0 }), 44100);
    expect(actual).toEqual(Float32Array.from([-1, -0.5, 0, 0.5, 1]));
    expect(input).toEqual(Float32Array.from([-2, -0.5, 0, 0.5, 2]));
  });

  it('applies the official 0.999 make-up target to Hard Clip', () => {
    const threshold = dbToLinear(-3);
    const [actual] = processLegacyLimiterChannels(
      [Float32Array.from([-2, 0.25, 2])],
      settings({ type: 'hardClip', applyMakeupGain: true }),
      44100,
    );
    expect(actual[0]).toBeCloseTo(-0.999, 6);
    expect(actual[1]).toBeCloseTo(0.25 * 0.999 / threshold, 6);
    expect(actual[2]).toBeCloseTo(0.999, 6);
  });

  it('uses independent mono/Left and Right pre-gains', () => {
    const [left, right] = processLegacyLimiterChannels(
      [Float32Array.of(0.5), Float32Array.of(0.5)],
      settings({ type: 'hardClip', limitToDb: 0, inputGainLeftDb: 6, inputGainRightDb: 0 }),
      44100,
    );
    expect(left[0]).toBeCloseTo(0.5 * dbToLinear(6), 6);
    expect(right[0]).toBe(0.5);
    const [mono] = processLegacyLimiterChannels(
      [Float32Array.of(0.5)], settings({ type: 'hardClip', limitToDb: 0, inputGainRightDb: 10 }), 44100,
    );
    expect(mono[0]).toBe(0.5);
  });

  it('keeps the Soft Clip linear region transparent and saturates large inputs at Limit to', () => {
    const threshold = dbToLinear(-3);
    const [small] = processLegacyLimiterChannels(
      [Float32Array.from([-0.1, 0, 0.1])], settings({ type: 'softClip' }), 44100,
    );
    expect(small[0]).toBeCloseTo(-0.1, 6);
    expect(small[1]).toBe(0);
    expect(small[2]).toBeCloseTo(0.1, 6);
    const [large] = processLegacyLimiterChannels(
      [Float32Array.from([-10, 10])], settings({ type: 'softClip' }), 44100,
    );
    expect(large[0]).toBeCloseTo(-threshold, 6);
    expect(large[1]).toBeCloseTo(threshold, 6);
  });

  it('matches the official Soft Clip knee oracle and 0.999 make-up ceiling', () => {
    const kneeInput = 1 / Math.PI;
    const [knee] = processLegacyLimiterChannels(
      [Float32Array.of(kneeInput)], settings({ type: 'softClip', limitToDb: 0 }), 44100,
    );
    expect(knee[0]).toBeCloseTo(kneeInput, 6);
    const [makeup] = processLegacyLimiterChannels(
      [Float32Array.from([-10, 10])], settings({ type: 'softClip', applyMakeupGain: true }), 44100,
    );
    expect(makeup[0]).toBeCloseTo(-0.999, 6);
    expect(makeup[1]).toBeCloseTo(0.999, 6);
  });

  it('leaves below-threshold audio unchanged in Hard Limit', () => {
    const input = Float32Array.from({ length: 80 }, (_, index) => (index % 2 ? -0.1 : 0.1));
    const [actual] = processLegacyLimiterChannels([input], settings({ type: 'hardLimit' }), 3000);
    expect(actual).toEqual(input);
  });

  it('uses initial peak padding so a leading Hard Limit transient is attenuated immediately', () => {
    const threshold = dbToLinear(-3);
    const input = new Float32Array(60);
    input[0] = 1;
    const [actual] = processLegacyLimiterChannels([input], settings({ type: 'hardLimit' }), 3000);
    expect(actual[0]).toBeCloseTo(threshold, 6);
    expect(actual.subarray(1).every((sample) => sample === 0)).toBe(true);
  });

  it('bounds a constant Hard Limit signal and applies 0.999 make-up gain', () => {
    const threshold = dbToLinear(-3);
    const input = new Float32Array(100).fill(1);
    const [limited] = processLegacyLimiterChannels([input], settings({ type: 'hardLimit' }), 3000);
    expect(limited[0]).toBeCloseTo(threshold, 6);
    expect(limited[99]).toBeCloseTo(threshold, 6);
    const [makeup] = processLegacyLimiterChannels(
      [input], settings({ type: 'hardLimit', applyMakeupGain: true }), 3000,
    );
    expect(makeup[0]).toBeCloseTo(0.999, 6);
    expect(makeup[99]).toBeCloseTo(0.999, 6);
  });

  it('reproduces Soft Limit initial pause and subsequent envelope behavior', () => {
    const threshold = dbToLinear(-3);
    const input = new Float32Array(60).fill(0.1);
    const [actual] = processLegacyLimiterChannels([input], settings({ type: 'softLimit' }), 3000);
    expect(actual[0]).toBeCloseTo(0.09, 6);
    expect(actual[29]).toBeCloseTo(0.09, 6);
    expect(actual[30]).toBeCloseTo(0.1, 6);
    const [peakInput] = processLegacyLimiterChannels(
      [new Float32Array(60).fill(1)], settings({ type: 'softLimit', applyMakeupGain: true }), 3000,
    );
    expect(peakInput[0]).toBeCloseTo(0.999, 6);
    expect(peakInput[59]).toBeCloseTo(0.999, 6);
    expect(threshold).toBeLessThan(1);
  });

  it('rejects invalid PCM, channel layouts and sample rates before processing', () => {
    expect(() => processLegacyLimiterChannels([], settings(), 44100)).toThrow('单声道或立体声');
    expect(() => processLegacyLimiterChannels([new Float32Array(1), new Float32Array(1), new Float32Array(1)], settings(), 44100)).toThrow('单声道或立体声');
    expect(() => processLegacyLimiterChannels([new Float32Array()], settings(), 44100)).toThrow('非空');
    expect(() => processLegacyLimiterChannels([new Float32Array(1), new Float32Array(2)], settings(), 44100)).toThrow('等长');
    expect(() => processLegacyLimiterChannels([Float32Array.of(Number.NaN)], settings(), 44100)).toThrow('非有限');
    expect(() => processLegacyLimiterChannels([new Float32Array(1)], settings(), 0)).toThrow('采样率');
  });
});
