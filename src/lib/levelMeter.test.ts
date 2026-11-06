import {
  decayDbfs,
  dbfsToMeterPercent,
  formatDbfs,
  MIN_METER_DBFS,
  peakToDbfs,
  readAnalyserPeakDbfs,
  silentStereoLevels,
} from './levelMeter';

describe('audio level meter', () => {
  it('converts linear peaks to clamped dBFS values', () => {
    expect(peakToDbfs(0.5)).toBeCloseTo(-6.0206, 3);
    expect(peakToDbfs(0.25)).toBeCloseTo(-12.0412, 3);
    expect(peakToDbfs(1)).toBe(0);
    expect(peakToDbfs(2)).toBe(0);
    expect(peakToDbfs(0.0001)).toBe(MIN_METER_DBFS);
  });

  it('fails closed to silence for invalid or absent peaks', () => {
    expect(peakToDbfs(0)).toBe(MIN_METER_DBFS);
    expect(peakToDbfs(-0.5)).toBe(MIN_METER_DBFS);
    expect(peakToDbfs(Number.NaN)).toBe(MIN_METER_DBFS);
    expect(peakToDbfs(Number.POSITIVE_INFINITY)).toBe(MIN_METER_DBFS);
    expect(silentStereoLevels()).toEqual({ left: MIN_METER_DBFS, right: MIN_METER_DBFS });
  });

  it('reads absolute per-channel peaks and ignores non-finite samples', () => {
    const analyser = {
      getFloatTimeDomainData: (buffer: Float32Array) => {
        buffer.set([0.1, -0.5, Number.NaN, 0.25]);
      },
    };
    expect(readAnalyserPeakDbfs(analyser, new Float32Array(4))).toBeCloseTo(-6.0206, 3);
    expect(readAnalyserPeakDbfs(analyser, new Float32Array())).toBe(MIN_METER_DBFS);
  });

  it.each([
    [0, 100],
    [-20, 50],
    [-30, 30],
    [-40, 15],
    [-50, 7.5],
    [-60, 0],
  ])('maps %d dBFS to %d%% of the Audacity-style scale', (dbfs, expected) => {
    expect(dbfsToMeterPercent(dbfs)).toBeCloseTo(expected, 6);
  });

  it('clamps meter positions and formats the visible numeric value', () => {
    expect(dbfsToMeterPercent(6)).toBe(100);
    expect(dbfsToMeterPercent(-100)).toBe(0);
    expect(dbfsToMeterPercent(Number.NaN)).toBe(0);
    expect(formatDbfs(-6.0206)).toBe('-6.0');
    expect(formatDbfs(-60)).toBe('-∞');
  });

  it('rises immediately and decays by 36 dB per second without lingering below silence', () => {
    expect(decayDbfs(-60, -6, 1 / 60)).toBe(-6);
    expect(decayDbfs(-6, -60, 0.5)).toBe(-24);
    expect(decayDbfs(-6, -12, 0.5)).toBe(-12);
    expect(decayDbfs(-59.9, -60, 1)).toBe(-60);
    expect(decayDbfs(-6, -60, -1)).toBe(-6);
  });
});
