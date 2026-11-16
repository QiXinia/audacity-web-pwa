import { describe, expect, it } from 'vitest';
import {
  evaluateContrast,
  formatContrastDifference,
  measureContrastSelection,
  serializeContrastResults,
  type ContrastClip,
  type ContrastMeasurement,
} from './contrastAnalysis';

function mono(samples: number[], startTime = 0, sourceOffset = 0): ContrastClip {
  return {
    clipId: `clip-${startTime}`,
    startTime,
    duration: samples.length / 4,
    sourceOffset,
    channels: [new Float32Array(samples)],
  };
}

function measurement(rmsDb: number, start = 0, end = 1): ContrastMeasurement {
  return { start, end, rmsDb, rms: 10 ** (rmsDb / 20), sampleCounts: [4] };
}

describe('Audacity Contrast RMS measurement', () => {
  it('uses 20*log10(RMS) and retains actual silent samples inside a clip', () => {
    const result = measureContrastSelection([mono([1, 0, 1, 0])], { start: 0, end: 1 }, 4);
    expect(result.rms).toBeCloseTo(Math.sqrt(0.5), 12);
    expect(result.rmsDb).toBeCloseTo(20 * Math.log10(Math.sqrt(0.5)), 12);
    expect(result.sampleCounts).toEqual([4]);
  });

  it('ignores timeline gaps instead of diluting RMS with empty space', () => {
    const first = mono([1, 1], 0);
    const second = mono([0, 0], 1.5);
    const result = measureContrastSelection([second, first], { start: 0, end: 2 }, 4);
    expect(result.sampleCounts).toEqual([4]);
    expect(result.rms).toBeCloseTo(Math.sqrt(0.5), 12);
  });

  it('honors clip and source-offset sample boundaries', () => {
    const result = measureContrastSelection(
      [mono([0, 1, 2, 3], 0, 0.25)],
      { start: 0.25, end: 0.75 },
      4,
    );
    expect(result.sampleCounts).toEqual([2]);
    expect(result.rms).toBeCloseTo(Math.sqrt(6.5), 12);
  });

  it('averages channel mean squares as Audacity does for stereo', () => {
    const clip: ContrastClip = {
      ...mono([1, 1]),
      channels: [new Float32Array([1, 1]), new Float32Array([0, 0])],
    };
    const result = measureContrastSelection([clip], { start: 0, end: 0.5 }, 4);
    expect(result.rms).toBeCloseTo(Math.sqrt(0.5), 12);
    expect(result.rmsDb).toBeCloseTo(-3.0102999566, 8);
    expect(result.sampleCounts).toEqual([2, 2]);
  });

  it('represents digital silence as negative infinity dB', () => {
    const result = measureContrastSelection([mono([0, 0, 0, 0])], { start: 0, end: 1 }, 4);
    expect(result.rms).toBe(0);
    expect(result.rmsDb).toBe(Number.NEGATIVE_INFINITY);
  });

  it('rejects empty, invalid, inconsistent and non-finite inputs instead of guessing', () => {
    expect(() => measureContrastSelection([], { start: 0, end: 1 }, 4)).toThrow('选区内没有可测量的音频');
    expect(() => measureContrastSelection([mono([1, 1])], { start: 0, end: 0 }, 4)).toThrow('有效的音频时间选区');
    expect(() => measureContrastSelection([mono([1, Number.NaN])], { start: 0, end: 0.5 }, 4)).toThrow('非有限采样值');
    const inconsistent: ContrastClip = { ...mono([1, 1]), channels: [new Float32Array([1, 1]), new Float32Array([1])] };
    expect(() => measureContrastSelection([inconsistent], { start: 0, end: 0.5 }, 4)).toThrow('声道长度不一致');
  });
});

describe('Audacity WCAG result ordering and formatting', () => {
  it('uses a strict greater-than 20 dB threshold', () => {
    expect(evaluateContrast(0, -20).kind).toBe('fail');
    expect(evaluateContrast(0, -20.0001).kind).toBe('pass');
    expect(evaluateContrast(-10, -31).differenceDb).toBe(21);
  });

  it('does not pass an exact -20 dB gain because of floating-point noise', () => {
    const foregroundDb = 20 * Math.log10(0.8 / Math.sqrt(2));
    const backgroundDb = 20 * Math.log10(0.08 / Math.sqrt(2));
    const result = evaluateContrast(foregroundDb, backgroundDb);
    expect(result.differenceDb).toBeCloseTo(20, 12);
    expect(result.kind).toBe('fail');
    expect(formatContrastDifference(result.differenceDb)).toBe('20.00 dB RMS');

    const exported = serializeContrastResults({
      projectName: 'Exact threshold',
      foreground: measurement(foregroundDb),
      background: measurement(backgroundDb),
      now: new Date(2026, 10, 16, 12, 50, 0),
    });
    expect(exported).toContain('Difference = 20.00 RMS dB.');
    expect(exported).toContain('Success Criteria 1.4.7 of WCAG 2.0: Fail');
  });

  it('checks excessive foreground, excessive background and reversed levels first', () => {
    expect(evaluateContrast(2, -50).kind).toBe('foreground-too-high');
    expect(evaluateContrast(-10, 1).kind).toBe('background-too-high');
    expect(evaluateContrast(-40, -10).kind).toBe('background-higher');
  });

  it('handles silence and indeterminate differences like the official dialog', () => {
    expect(evaluateContrast(-10, Number.NEGATIVE_INFINITY).kind).toBe('pass');
    expect(evaluateContrast(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY).kind).toBe('fail');
    expect(formatContrastDifference(Number.NaN)).toBe('indeterminate');
    expect(formatContrastDifference(Number.POSITIVE_INFINITY)).toBe('Infinite dB difference');
    expect(formatContrastDifference(20)).toBe('20.00 dB RMS');
  });
});

describe('Audacity Contrast text export', () => {
  it('exports times, RMS, signed difference, strict pass result and collection date', () => {
    const text = serializeContrastResults({
      projectName: 'Narration.aup3',
      foreground: measurement(-6, 1.25, 2.5),
      background: measurement(-30, 4, 5),
      now: new Date(2026, 9, 28, 14, 3, 2),
    });
    expect(text).toContain('WCAG 2.0 Success Criteria 1.4.7 Contrast Results');
    expect(text).toContain('Filename = Narration.aup3.');
    expect(text).toContain('Time started =  0 hour(s),  0 minute(s), 1.25 seconds.');
    expect(text).toContain('Time ended =  0 hour(s),  0 minute(s), 2.50 seconds.');
    expect(text).toContain('RMS = -6.00 dB.');
    expect(text).toContain('RMS = -30.00 dB.');
    expect(text).toContain('Difference = 24.00 RMS dB.');
    expect(text).toContain('Success Criteria 1.4.7 of WCAG 2.0: Pass');
    expect(text).toContain('28 October 2026 14h 03m 02s');
  });

  it('exports silence as zero and does not pass a reversed signed difference', () => {
    const text = serializeContrastResults({
      projectName: 'silent',
      foreground: measurement(Number.NEGATIVE_INFINITY),
      background: measurement(-30),
      now: new Date(2026, 0, 1),
    });
    expect(text).toContain('RMS = zero.');
    expect(text).toContain('Difference = infinite RMS dB.');
    expect(text).toContain('Success Criteria 1.4.7 of WCAG 2.0: Fail');
  });
});
