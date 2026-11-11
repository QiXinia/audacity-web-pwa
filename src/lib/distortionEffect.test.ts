import { describe, expect, it } from 'vitest';
import {
  createDistortionState,
  DEFAULT_DISTORTION_SETTINGS,
  DISTORTION_TYPE_LABELS,
  DISTORTION_TYPES,
  getDistortionControlMeta,
  processDistortionChannels,
  processDistortionSelection,
  validateDistortionSettings,
  type DistortionSettings,
} from './distortionEffect';

const settings = (patch: Partial<DistortionSettings>): DistortionSettings => ({
  ...DEFAULT_DISTORTION_SETTINGS,
  ...patch,
});

describe('Audacity DistortionBase tables', () => {
  it('exposes all eleven official types and their control visibility', () => {
    expect(DISTORTION_TYPES).toHaveLength(11);
    expect(Object.keys(DISTORTION_TYPE_LABELS)).toEqual(DISTORTION_TYPES);
    expect(getDistortionControlMeta('hard-clipping')).toMatchObject({
      threshold: 'Clipping level', param1: 'Drive', param2: 'Make-up Gain', repeats: null, dcBlock: false,
    });
    expect(getDistortionControlMeta('leveller')).toMatchObject({
      threshold: null, noiseFloor: 'Noise Floor', param2: null, repeats: 'Degree of Levelling',
    });
    expect(getDistortionControlMeta('even-harmonics').dcBlock).toBe(true);
    expect(getDistortionControlMeta('rectifier').dcBlock).toBe(true);
  });

  it('matches the official hard-clipping threshold without drive or make-up gain', () => {
    const threshold = 10 ** (-6 / 20);
    const output = processDistortionChannels([
      Float32Array.from([-1, -0.5, 0, 0.5, 1]),
    ], settings({ thresholdDb: -6, param1: 0, param2: 0 }), 48000)[0];
    expect(output[0]).toBeCloseTo(-threshold, 6);
    expect(output[1]).toBeCloseTo(-0.5, 6);
    expect(output[2]).toBe(0);
    expect(output[3]).toBeCloseTo(0.5, 6);
    expect(output[4]).toBeCloseTo(threshold, 6);
  });

  it('matches the analytic soft-clipping log curve above threshold', () => {
    const threshold = 10 ** (-6 / 20);
    const ratio = 2 ** 3.5;
    const expected = threshold + (Math.exp(ratio * (threshold - 0.75)) - 1) / -ratio;
    const output = processDistortionChannels([
      Float32Array.from([-0.75, 0.75]),
    ], settings({ type: 'soft-clipping', thresholdDb: -6, param1: 50, param2: 0 }), 48000)[0];
    expect(output[1]).toBeCloseTo(expected, 4);
    expect(output[0]).toBeCloseTo(-expected, 4);
  });

  it.each([
    ['hard-clipping', settings({ thresholdDb: 0, param1: 0, param2: 0 })],
    ['soft-clipping', settings({ type: 'soft-clipping', thresholdDb: 0, param2: 0 })],
    ['soft-overdrive', settings({ type: 'soft-overdrive', param1: 0, param2: 100 })],
    ['hard-overdrive', settings({ type: 'hard-overdrive', param1: 0, param2: 100 })],
    ['cubic-curve', settings({ type: 'cubic-curve', param1: 0, param2: 100 })],
    ['even-harmonics', settings({ type: 'even-harmonics', param1: 0 })],
    ['sine-curve', settings({ type: 'sine-curve', param1: 0, param2: 100 })],
    ['leveller', settings({ type: 'leveller', param1: 0, repeats: 0 })],
    ['rectifier', settings({ type: 'rectifier', param1: 0 })],
    ['hard-limiter', settings({ type: 'hard-limiter', thresholdDb: 0, param1: 100, param2: 0 })],
  ] as const)('keeps the documented linear boundary of %s', (_type, configuration) => {
    const input = Float32Array.from([-1, -0.75, -0.25, 0, 0.25, 0.75, 1]);
    const output = processDistortionChannels([input], configuration, 48000)[0];
    output.forEach((sample, index) => expect(sample).toBeCloseTo(input[index], 5));
  });

  it('matches half-wave and full-wave rectification exactly at table points', () => {
    const input = Float32Array.from([-1, -0.5, 0, 0.5, 1]);
    expect(processDistortionChannels([input], settings({ type: 'rectifier', param1: 50 }), 48000)[0])
      .toEqual(Float32Array.from([0, 0, 0, 0.5, 1]));
    expect(processDistortionChannels([input], settings({ type: 'rectifier', param1: 100 }), 48000)[0])
      .toEqual(Float32Array.from([1, 0.5, 0, 0.5, 1]));
  });

  it('matches Hard Limiter 1413 wet/residual mixing and has no hard-clip drive pre-gain', () => {
    const threshold = 10 ** (-6 / 20);
    const output = processDistortionChannels([
      Float32Array.from([1]),
    ], settings({ type: 'hard-limiter', thresholdDb: -6, param1: 75, param2: 25 }), 48000)[0];
    expect(output[0]).toBeCloseTo(threshold * 0.5 + 0.25, 6);
  });

  it('keeps every default mode finite, deterministic and input-immutable', () => {
    const source = Float32Array.from([-2, -1, -0.25, 0, 0.25, 1, 2]);
    for (const type of DISTORTION_TYPES) {
      const input = source.slice();
      const configuration = settings({ type });
      const first = processDistortionChannels([input], configuration, 48000)[0];
      const second = processDistortionChannels([input], configuration, 48000)[0];
      expect(first).toEqual(second);
      expect(input).toEqual(source);
      expect(first.every(Number.isFinite)).toBe(true);
    }
  });
});

describe('Audacity Distortion selection and DC state', () => {
  it('changes only the selected half-open sample range', () => {
    const input = Float32Array.from([-1, -0.5, 0.5, 1]);
    const state = createDistortionState(settings({ thresholdDb: 0, param1: 0, param2: 0 }), 48000, 1);
    const output = processDistortionSelection([input], 1, 3, state)[0];
    expect(output[0]).toBe(input[0]);
    expect(output[3]).toBe(input[3]);
    expect(output.slice(1, 3)).toEqual(input.slice(1, 3));
    expect(output).not.toBe(input);
  });

  it('matches the official rolling-average DC filter and persists it across clips', () => {
    const configuration = settings({ type: 'even-harmonics', param1: 0, dcBlock: true });
    const input = Float32Array.from([1, -1, 1, 1]);
    const whole = processDistortionChannels([input], configuration, 40)[0];
    expect(whole).toEqual(Float32Array.from([0, -1, 1, 0]));
    const state = createDistortionState(configuration, 40, 1);
    const first = processDistortionSelection([input.slice(0, 2)], 0, 2, state)[0];
    const second = processDistortionSelection([input.slice(2)], 0, 2, state)[0];
    expect(new Float32Array([...first, ...second])).toEqual(whole);
  });

  it('keeps stereo DC queues independent', () => {
    const configuration = settings({ type: 'even-harmonics', param1: 0, dcBlock: true });
    const output = processDistortionChannels([
      Float32Array.from([1, -1, 1, 1]),
      Float32Array.from([1, 1, -1, -1]),
    ], configuration, 40);
    expect(output[0]).toEqual(Float32Array.from([0, -1, 1, 0]));
    expect(output[1]).toEqual(Float32Array.from([0, 0, -1, 0]));
  });

  it('rejects invalid settings, ranges, channels and non-finite selected samples', () => {
    expect(() => validateDistortionSettings(settings({ repeats: 1.5 }))).toThrow('0–5');
    expect(() => validateDistortionSettings(settings({ thresholdDb: 1 }))).toThrow('阈值');
    expect(() => createDistortionState(settings({ dcBlock: true }), 10, 1)).toThrow('20 Hz');
    const state = createDistortionState(settings({}), 48000, 1);
    expect(() => processDistortionSelection([new Float32Array(1)], 0, 0, state)).toThrow('非空整数采样区间');
    expect(() => processDistortionChannels([
      Float32Array.from([Number.NaN]),
    ], settings({}), 48000)).toThrow('非有限值');
    expect(() => processDistortionChannels([], settings({}), 48000)).toThrow('单声道或立体声');
  });
});
