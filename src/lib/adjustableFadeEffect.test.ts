import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ADJUSTABLE_FADE_SETTINGS,
  processAdjustableFadeChannels,
  validateAdjustableFadeSettings,
  type AdjustableFadeSettings,
} from './adjustableFadeEffect';

function settings(overrides: Partial<AdjustableFadeSettings> = {}): AdjustableFadeSettings {
  return { ...DEFAULT_ADJUSTABLE_FADE_SETTINGS, ...overrides };
}

describe('Adjustable Fade DSP', () => {
  it('linearly fades up from silence to original level', () => {
    const input = [Float32Array.of(1, 1, 1, 1, 1)];
    const [output] = processAdjustableFadeChannels(input, settings());
    expect(Array.from(output)).toEqual([0, 0.25, 0.5, 0.75, 1]);
  });

  it('linearly fades down from original level to silence', () => {
    const [output] = processAdjustableFadeChannels(
      [Float32Array.of(1, 1, 1, 1, 1)],
      settings({ fadeType: 'down', startGain: 100, endGain: 0 }),
    );
    expect(Array.from(output)).toEqual([1, 0.75, 0.5, 0.25, 0]);
  });

  it('supports partial percentage fades without changing endpoint count', () => {
    const [output] = processAdjustableFadeChannels(
      [Float32Array.of(2, 2, 2)],
      settings({ startGain: 20, endGain: 80 }),
    );
    expect(output[0]).toBeCloseTo(0.4);
    expect(output[1]).toBeCloseTo(1);
    expect(output[2]).toBeCloseTo(1.6);
  });

  it('converts dB gain controls', () => {
    const [output] = processAdjustableFadeChannels(
      [Float32Array.of(1, 1, 1)],
      settings({ units: 'db', startGain: -6, endGain: 0 }),
    );
    expect(output[0]).toBeCloseTo(10 ** (-6 / 20));
    expect(output[1]).toBeCloseTo((10 ** (-6 / 20) + 1) / 2);
    expect(output[2]).toBe(1);
  });

  it('bends a simple fade with positive and negative mid adjustment', () => {
    const base = [Float32Array.of(1, 1, 1, 1, 1)];
    const [positive] = processAdjustableFadeChannels(base, settings({ midFadeAdjustPercent: 50 }));
    const [negative] = processAdjustableFadeChannels(base, settings({ midFadeAdjustPercent: -50 }));
    expect(positive[2]).toBeCloseTo(Math.sin(Math.PI / 4));
    expect(negative[2]).toBeCloseTo(0.5 ** 2);
  });

  it('produces raised-cosine S-curve fades', () => {
    const [output] = processAdjustableFadeChannels(
      [Float32Array.of(1, 1, 1, 1, 1)],
      settings({ fadeType: 'sCurveUp' }),
    );
    expect(output[0]).toBe(0);
    expect(output[2]).toBeCloseTo(0.5);
    expect(output[4]).toBe(1);
  });

  it('applies handy presets and ignores custom endpoint fields', () => {
    const [output] = processAdjustableFadeChannels(
      [Float32Array.of(1, 1, 1, 1, 1)],
      settings({ preset: 'sCurveOut', startGain: 50, endGain: 50 }),
    );
    expect(output[0]).toBe(1);
    expect(output[2]).toBeCloseTo(0.5);
    expect(output[4]).toBe(0);
  });

  it('processes every equal-length channel independently', () => {
    const output = processAdjustableFadeChannels(
      [Float32Array.of(1, 1, 1), Float32Array.of(4, 4, 4)],
      settings(),
    );
    expect(Array.from(output[0])).toEqual([0, 0.5, 1]);
    expect(Array.from(output[1])).toEqual([0, 2, 4]);
  });

  it('rejects invalid controls and unsafe inputs', () => {
    expect(() => validateAdjustableFadeSettings(settings({ midFadeAdjustPercent: 101 }))).toThrow();
    expect(() => validateAdjustableFadeSettings(settings({ startGain: -1 }))).toThrow();
    expect(() => validateAdjustableFadeSettings(settings({ units: 'db', startGain: 101 }))).toThrow();
    expect(() => processAdjustableFadeChannels([new Float32Array(0)], settings())).toThrow();
    expect(() => processAdjustableFadeChannels(
      [Float32Array.of(1, Number.NaN)],
      settings(),
    )).toThrow();
  });
});
