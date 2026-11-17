import { describe, expect, it } from 'vitest';
import {
  buildDbLinearRulerValues,
  buildDbRulerValues,
  dbValueToLinearWaveY,
  dbValueToWaveY,
  sampleToDbDisplayValue,
  sampleToDbWaveY,
  sampleToLinearWaveY,
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

describe('Audacity Linear (dB) and half-wave coordinates', () => {
  it('maps linear samples against -1..1 or 0..1 without changing their values', () => {
    expect(sampleToLinearWaveY(1, 76)).toBe(4);
    expect(sampleToLinearWaveY(0, 76)).toBe(38);
    expect(sampleToLinearWaveY(-1, 76)).toBe(72);
    expect(sampleToLinearWaveY(0.5, 76)).toBe(21);
    expect(sampleToLinearWaveY(1, 76, 1, true)).toBe(4);
    expect(sampleToLinearWaveY(0.5, 76, 1, true)).toBe(38);
    expect(sampleToLinearWaveY(0, 76, 1, true)).toBe(72);
    expect(sampleToLinearWaveY(-0.5, 76, 1, true)).toBe(72);
  });

  it('uses the full channel height for logarithmic half-wave display', () => {
    expect(sampleToDbWaveY(1, 76, -96, 1, true)).toBe(4);
    expect(sampleToDbWaveY(0, 76, -96, 1, true)).toBe(72);
    expect(sampleToDbWaveY(-1, 76, -96, 1, true)).toBe(72);
    expect(sampleToDbWaveY(0.0001, 76, -96, 1, true)).toBeCloseTo(60.6666666667, 8);
  });

  it('converts Linear (dB) ticks to amplitude and pins the floor to zero', () => {
    expect(dbValueToLinearWaveY(0, 76, -60)).toBe(4);
    expect(dbValueToLinearWaveY(-60, 76, -60)).toBe(38);
    expect(dbValueToLinearWaveY(-60, 76, -60, 1, false, true)).toBe(72);
    expect(dbValueToLinearWaveY(-6, 76, -60)).toBeCloseTo(
      sampleToLinearWaveY(10 ** (-6 / 20), 76),
      10,
    );
  });

  it('builds official-style Linear (dB) boundary and intermediate steps', () => {
    expect(buildDbLinearRulerValues(100, -60)).toEqual([-60, -6, 0]);
    expect(buildDbLinearRulerValues(76, -60)).toEqual([-60, 0]);
    expect(buildDbLinearRulerValues(76, -60, 1, true)).toEqual([-60, -6, 0]);
    expect(buildDbLinearRulerValues(76, -60, 1, false, true)).toEqual([-60, -9, -3, 0]);
  });
});
