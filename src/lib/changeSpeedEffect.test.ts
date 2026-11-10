import { describe, expect, it } from 'vitest';
import {
  changeSpeedRatio,
  durationAfterChangeSpeed,
  isChangeSpeedBypassed,
  MAX_CHANGE_SPEED_PERCENT,
  MIN_CHANGE_SPEED_PERCENT,
  percentChangeFromMultiplier,
  percentChangeFromSpeedDuration,
  percentChangeFromSpeedSlider,
  percentChangeFromVinyl,
  processChangeSpeedChannels,
  sliderFromSpeedPercent,
  validateChangeSpeedSettings,
  vinylTransitionFromPercent,
} from './changeSpeedEffect';

describe('Change Speed official parameters', () => {
  it('uses the official -99..4900 percent range and reciprocal duration mapping', () => {
    expect(MIN_CHANGE_SPEED_PERCENT).toBe(-99);
    expect(MAX_CHANGE_SPEED_PERCENT).toBe(4900);
    expect(changeSpeedRatio({ percentChange: 100 })).toBe(2);
    expect(changeSpeedRatio({ percentChange: -99 })).toBeCloseTo(0.01);
    expect(changeSpeedRatio({ percentChange: 4900 })).toBe(50);
    expect(durationAfterChangeSpeed(2, { percentChange: 100 })).toBe(1);
    expect(durationAfterChangeSpeed(2, { percentChange: -50 })).toBe(4);
    expect(isChangeSpeedBypassed({ percentChange: 0 })).toBe(true);
  });

  it('derives percent from multiplier and duration, including homologous ratios', () => {
    expect(percentChangeFromMultiplier(2)).toBe(100);
    expect(percentChangeFromMultiplier(0.5)).toBe(-50);
    expect(percentChangeFromSpeedDuration(1, 0.5)).toBe(100);
    expect(percentChangeFromSpeedDuration(1, 2)).toBe(-50);
    expect(() => percentChangeFromMultiplier(0)).toThrow('大于零');
    expect(() => percentChangeFromSpeedDuration(1, 0)).toThrow('大于零');
  });

  it('maps all six directed standard-vinyl transitions', () => {
    expect(percentChangeFromVinyl('33.333333333333336', '45')).toBeCloseTo(35);
    expect(percentChangeFromVinyl('33.333333333333336', '78')).toBeCloseTo(134);
    expect(percentChangeFromVinyl('45', '33.333333333333336')).toBeCloseTo(-25.9259259);
    expect(percentChangeFromVinyl('45', '78')).toBeCloseTo(73.3333333);
    expect(percentChangeFromVinyl('78', '33.333333333333336')).toBeCloseTo(-57.2649573);
    expect(percentChangeFromVinyl('78', '45')).toBeCloseTo(-42.3076923);
    expect(vinylTransitionFromPercent(35)).toEqual(['33.333333333333336', '45']);
    expect(vinylTransitionFromPercent(73.3333333)).toEqual(['45', '78']);
    expect(vinylTransitionFromPercent(10)).toBeNull();
  });

  it('warps only the positive slider half and unwarp values above the slider maximum', () => {
    expect(percentChangeFromSpeedSlider(-99)).toBe(-99);
    const warpedMaximum = percentChangeFromSpeedSlider(100);
    expect(warpedMaximum).toBeCloseTo(400.0366, 3);
    expect(sliderFromSpeedPercent(percentChangeFromSpeedSlider(50))).toBeCloseTo(50, 10);
    expect(sliderFromSpeedPercent(400)).toBeCloseTo(99.99291955648023, 10);
    expect(sliderFromSpeedPercent(4900)).toBe(100);
  });

  it.each([-99.001, 4900.001, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid percent %s',
    (percentChange) => {
      expect(() => validateChangeSpeedSettings({ percentChange })).toThrow('速度变化');
    },
  );
});

describe('Change Speed deterministic resampling', () => {
  it('shortens a ramp and raises its traversal rate without changing input or channel alignment', () => {
    const source = Float32Array.from({ length: 10 }, (_, index) => index / 10);
    const original = source.slice();
    const stereo = [source, new Float32Array(10).fill(0.2)];
    const output = processChangeSpeedChannels(stereo, { percentChange: 100 }, 1000);
    expect(output).toHaveLength(2);
    expect(output[0]).toHaveLength(5);
    [0, 0.2, 0.4, 0.6, 0.8].forEach((expected, index) => {
      // A band-limited filter has a small, deterministic edge transient on a ten-sample ramp.
      expect(output[0][index]).toBeCloseTo(expected, 1);
    });
    expect(output[0][2]).toBeCloseTo(0.4, 2);
    for (const value of output[1]) expect(value).toBeCloseTo(0.2, 5);
    expect(source).toEqual(original);
    expect(output[0]).not.toBe(source);
  });

  it('lengthens homologous input deterministically and preserves finite stored Float32 values', () => {
    const source = Float32Array.from([0, 1, 0, -1]);
    const first = processChangeSpeedChannels([source], { percentChange: -50 }, 10)[0];
    const second = processChangeSpeedChannels([source], { percentChange: -50 }, 10)[0];
    expect(first).toHaveLength(8);
    expect(first).toEqual(second);
    for (const value of first) expect(Number.isFinite(value)).toBe(true);
  });

  it('attenuates an aliasing Nyquist sequence during 2x downsampling', () => {
    const source = Float32Array.from({ length: 64 }, (_, index) => index % 2 === 0 ? 1 : -1);
    const output = processChangeSpeedChannels([source], { percentChange: 100 }, 64)[0];
    const interiorPeak = Math.max(...Array.from(output.slice(4, -4), Math.abs));
    expect(interiorPeak).toBeLessThan(0.05);
  });

  it('supports both extreme ratios while enforcing exact output lengths', () => {
    expect(processChangeSpeedChannels(
      [new Float32Array(2).fill(0.25)], { percentChange: -99 }, 10,
    )[0]).toHaveLength(200);
    expect(processChangeSpeedChannels(
      [new Float32Array(100).fill(0.25)], { percentChange: 4900 }, 10,
    )[0]).toHaveLength(2);
  });

  it('rejects empty, ragged, non-finite and invalid-rate inputs before writing output', () => {
    expect(() => processChangeSpeedChannels([], { percentChange: 100 }, 10)).toThrow('声道');
    expect(() => processChangeSpeedChannels(
      [new Float32Array(2), new Float32Array(3)], { percentChange: 100 }, 10,
    )).toThrow('等长');
    expect(() => processChangeSpeedChannels(
      [Float32Array.from([0, Number.NaN])], { percentChange: 100 }, 10,
    )).toThrow('非有限');
    expect(() => processChangeSpeedChannels(
      [new Float32Array(2)], { percentChange: 100 }, 0,
    )).toThrow('采样率');
  });

  it('fails closed before allocating outputs beyond the browser memory budget', () => {
    expect(() => processChangeSpeedChannels(
      [new Float32Array(300_000)], { percentChange: -99 }, 48_000,
    )).toThrow('内存上限');
  });
});
