import { describe, expect, it } from 'vitest';
import {
  bpmAfterChangeTempo,
  changeTempoRatio,
  durationAfterChangeTempo,
  isChangeTempoBypassed,
  percentChangeFromBpm,
  percentChangeFromDuration,
  percentChangeFromSlider,
  processChangeTempoChannels,
  sliderFromPercentChange,
  validateChangeTempoSettings,
} from './changeTempoEffect';

describe('Change Tempo Audacity parameter contract', () => {
  it('maps percentage to speed and duration without changing pitch semantics', () => {
    expect(changeTempoRatio({ percentChange: 100 })).toBe(2);
    expect(changeTempoRatio({ percentChange: -50 })).toBe(0.5);
    expect(durationAfterChangeTempo(2, { percentChange: 100 })).toBe(1);
    expect(durationAfterChangeTempo(2, { percentChange: -50 })).toBe(4);
    expect(isChangeTempoBypassed({ percentChange: 0 })).toBe(true);
  });

  it('links BPM and length fields in both directions', () => {
    expect(bpmAfterChangeTempo(120, { percentChange: 100 })).toBe(240);
    expect(bpmAfterChangeTempo(0, { percentChange: 100 })).toBe(0);
    expect(percentChangeFromBpm(120, 240)).toBeCloseTo(100, 12);
    expect(percentChangeFromDuration(2, 0.5)).toBeCloseTo(300, 12);
  });

  it('uses the official slider warp only above zero', () => {
    expect(percentChangeFromSlider(-95)).toBe(-95);
    expect(percentChangeFromSlider(100)).toBeCloseTo(400.036851, 3);
    expect(sliderFromPercentChange(percentChangeFromSlider(100))).toBeCloseTo(100, 10);
    expect(percentChangeFromSlider(1000)).toBeCloseTo(400.036851, 3);
  });

  it.each([-95.001, 3000.001, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid percentage %s',
    (percentChange) => {
      expect(() => validateChangeTempoSettings({ percentChange })).toThrow('Tempo 变化');
    },
  );
});

describe('Change Tempo WSOLA transaction kernel', () => {
  it('shortens and lengthens linear PCM by exact sample-rounded lengths', () => {
    const source = Float32Array.from({ length: 10 }, (_, index) => index / 10);
    const faster = processChangeTempoChannels([source], { percentChange: 100 }, 10);
    const slower = processChangeTempoChannels([source], { percentChange: -50 }, 10);
    expect(faster[0]).toEqual(Float32Array.from([0, 0.2, 0.4, 0.6, 0.8]));
    expect(slower[0]).toEqual(Float32Array.from(
      { length: 20 },
      (_, index) => {
        const position = index / 2;
        const left = Math.floor(position);
        const right = Math.min(source.length - 1, left + 1);
        return source[left] + (source[right] - source[left]) * (position - left);
      },
    ));
    expect(source).toEqual(Float32Array.from({ length: 10 }, (_, index) => index / 10));
  });

  it('keeps stereo channels aligned at shared analysis positions', () => {
    const left = Float32Array.from({ length: 1000 }, (_, index) => Math.sin(index * 0.03));
    const right = new Float32Array(left);
    const output = processChangeTempoChannels([left, right], { percentChange: 25 }, 1000);
    expect(output).toHaveLength(2);
    expect(output[0]).toHaveLength(800);
    expect(output[1]).toEqual(output[0]);
  });

  it('rejects unequal, empty and non-finite channels before processing', () => {
    expect(() => processChangeTempoChannels([], { percentChange: 10 }, 10)).toThrow('声道');
    expect(() => processChangeTempoChannels(
      [new Float32Array(2), new Float32Array(3)],
      { percentChange: 10 },
      10,
    )).toThrow('等长');
    expect(() => processChangeTempoChannels(
      [Float32Array.from([0, Number.NaN])],
      { percentChange: 10 },
      10,
    )).toThrow('非有限');
  });

  it('handles 20,000,000 output samples without length or numeric overflow', {
    timeout: 120_000,
  }, () => {
    const source = new Float32Array(1_000_000);
    for (let index = 0; index < source.length; index += 1) {
      source[index] = Math.sin(index * 0.01);
    }
    const sourceFirst = source[0];
    const sourceLast = source[source.length - 1];

    const output = processChangeTempoChannels([source], { percentChange: -95 }, 48_000);

    expect(output).toHaveLength(1);
    expect(output[0]).toHaveLength(20_000_000);
    expect(output[0]).not.toBe(source);
    for (const index of [0, 1, 1023, 1_000_000, 10_000_000, 19_999_998, 19_999_999]) {
      expect(Number.isFinite(output[0][index])).toBe(true);
    }
    expect(source[0]).toBe(sourceFirst);
    expect(source[source.length - 1]).toBe(sourceLast);
  });
});
