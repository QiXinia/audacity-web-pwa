import { describe, expect, it } from 'vitest';
import {
  buildLinearRulerTicks,
  formatLinearRulerLabel,
  linearRulerIncrements,
} from '@/lib/linearRuler';

function majorValues(height: number, verticalZoom = 1, halfWave = false) {
  return buildLinearRulerTicks({ height, verticalZoom, halfWave }).major.map((tick) => tick.value);
}

describe('Audacity Linear (amp) ruler increments', () => {
  it('selects the official major/minor families from the available channel height', () => {
    expect(linearRulerIncrements(400)).toEqual({ major: 0.1, minor: 0.05 });
    expect(linearRulerIncrements(200)).toEqual({ major: 0.5, minor: 0.1 });
    expect(linearRulerIncrements(100)).toEqual({ major: 0.5, minor: 0.25 });
    expect(linearRulerIncrements(76)).toEqual({ major: 1, minor: 0.5 });
  });

  it('scales increments to vertical zoom and half-wave display bounds', () => {
    expect(linearRulerIncrements(100, 2)).toEqual({ major: 0.25, minor: 0.125 });
    expect(linearRulerIncrements(100, 1, true)).toEqual({ major: 0.25, minor: 0.125 });
    expect(majorValues(100, 2)).toEqual([-0.5, -0.25, 0, 0.25, 0.5]);
    expect(majorValues(100, 1, true)).toEqual([0, 0.25, 0.5, 0.75, 1]);
  });

  it('formats absolute labels with the official 1–4 digit precision', () => {
    expect(formatLinearRulerLabel(-1, 1)).toBe('1.0');
    expect(formatLinearRulerLabel(-0.5, 0.5)).toBe('0.5');
    expect(formatLinearRulerLabel(-0.25, 0.25)).toBe('0.25');
    expect(formatLinearRulerLabel(-0.125, 0.125)).toBe('0.125');
  });
});

describe('Audacity Linear (amp) channel ticks', () => {
  it('uses ±1 full-wave and 0..1 half-wave bounds with shared waveform coordinates', () => {
    const full = buildLinearRulerTicks({ height: 76 });
    expect(full.major.map((tick) => [tick.value, tick.y, tick.label])).toEqual([
      [-1, 72, '1.0'],
      [0, 38, '0.0'],
      [1, 4, '1.0'],
    ]);
    expect(full.minor.map((tick) => tick.value)).toEqual([-0.5, 0.5]);
    expect(full.major[0].negative).toBe(true);
    expect(full.major[1].fullWidth).toBe(true);

    const half = buildLinearRulerTicks({ height: 76, halfWave: true });
    expect(half.major.map((tick) => [tick.value, tick.y])).toEqual([[0, 72], [0.5, 38], [1, 4]]);
    expect(half.major.some((tick) => tick.negative)).toBe(false);
  });

  it('uses full-width zero and stereo boundary ticks', () => {
    const upper = buildLinearRulerTicks({ height: 76, channel: 0, stereo: true });
    const lower = buildLinearRulerTicks({ height: 76, channel: 1, stereo: true });
    expect(upper.major.find((tick) => tick.value === -1)?.fullWidth).toBe(true);
    expect(upper.major.find((tick) => tick.value === 1)?.fullWidth).toBe(false);
    expect(lower.major.find((tick) => tick.value === 1)?.fullWidth).toBe(true);
    expect(lower.major.find((tick) => tick.value === -1)?.fullWidth).toBe(false);
  });

  it('collapses channels below 40px to the middle major tick and zero minor tick', () => {
    const full = buildLinearRulerTicks({ height: 38, channel: 1, stereo: true });
    expect(full.collapsed).toBe(true);
    expect(full.major.map((tick) => tick.value)).toEqual([0]);
    expect(full.major[0]).toMatchObject({ label: '0.0', fullWidth: true, bold: true });
    expect(full.minor.map((tick) => tick.value)).toEqual([0]);

    const half = buildLinearRulerTicks({ height: 38, verticalZoom: 2, halfWave: true });
    expect(half.major.map((tick) => [tick.value, tick.label])).toEqual([[0.25, '0.25']]);
    expect(half.minor.map((tick) => tick.value)).toEqual([0]);
  });
});
