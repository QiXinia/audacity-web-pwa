import { describe, expect, it } from 'vitest';
import {
  buildDbRulerValues,
  dbValueToWaveY,
  sampleToDbDisplayValue,
  sampleToDbWaveY,
} from '@/lib/dbWaveform';

describe('Audacity logarithmic waveform coordinates', () => {
  it('collapses silence and values below the selected floor to the centre line', () => {
    expect(sampleToDbWaveY(0, 76, -96)).toBe(38);
    expect(sampleToDbWaveY(0.0001, 76, -60)).toBe(38);
    expect(sampleToDbWaveY(Number.NaN, 76, -96)).toBe(38);
    expect(sampleToDbDisplayValue(-0.0001, -96)).toBeCloseTo(-1 / 6, 8);
  });

  it('reveals a -80 dB sample on the -96 scale without changing its source value', () => {
    expect(sampleToDbWaveY(0.0001, 76, -96)).toBeCloseTo(32.3333333333, 8);
    expect(sampleToDbWaveY(-0.0001, 76, -96)).toBeCloseTo(43.6666666667, 8);
  });

  it('maps full scale and the negative half-wave to symmetric padded bounds', () => {
    expect(sampleToDbWaveY(1, 76, -60)).toBe(4);
    expect(sampleToDbWaveY(-1, 76, -60)).toBe(72);
    expect(sampleToDbWaveY(0, 0, -60)).toBe(0);
  });

  it('narrows display bounds during vertical zoom, matching Audacity dB zoom-in', () => {
    expect(sampleToDbWaveY(1, 76, -60, 2)).toBe(4);
    expect(sampleToDbWaveY(10 ** (-30 / 20), 76, -60, 2)).toBeCloseTo(4, 8);
    expect(sampleToDbWaveY(0.0001, 76, -96, 2)).toBeCloseTo(26.6666666667, 8);
  });

  it('uses the same coordinates for ruler values and drawn samples', () => {
    const amplitude = 10 ** (-30 / 20);
    expect(dbValueToWaveY(-30, 100, -60)).toBeCloseTo(sampleToDbWaveY(amplitude, 100, -60), 10);
    expect(dbValueToWaveY(-30, 100, -60, 1, true))
      .toBeCloseTo(sampleToDbWaveY(-amplitude, 100, -60), 10);
  });
});

describe('Audacity dB ruler steps', () => {
  it('uses three-dB divisor candidates when the track is tall enough', () => {
    expect(buildDbRulerValues(100, -60, 1, 20)).toEqual([-60, -30, 0]);
    expect(buildDbRulerValues(76, -60, 1, 20)).toEqual([-60, 0]);
    expect(buildDbRulerValues(76, -60, 1, 17)).toEqual([-60, -30, 0]);
  });

  it('moves the upper ruler boundary with vertical zoom and reuses the preference floor', () => {
    expect(buildDbRulerValues(100, -60, 2, 20)).toEqual([-60, -45, -30]);
    expect(buildDbRulerValues(100, -96, 1, 20)).toContain(-96);
    expect(buildDbRulerValues(100, -96, 1, 20)).toContain(0);
  });
});
