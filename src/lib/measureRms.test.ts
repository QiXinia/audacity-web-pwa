import { describe, expect, it } from 'vitest';
import { formatRmsDb, measureRmsSelection, type MeasureRmsClip } from './measureRms';

function clip(id: string, channels: Float32Array[], startTime = 0, sourceOffset = 0): MeasureRmsClip {
  return { clipId: id, startTime, duration: channels[0].length / 1000, sourceOffset, channels };
}

describe('Audacity Measure RMS', () => {
  it('measures mono only inside the quantized selection and source offset', () => {
    const samples = new Float32Array(200).fill(1);
    samples[100] = Number.NaN;
    const result = measureRmsSelection([
      clip('a', [samples], 0, 0.05),
    ], { start: 0, end: 0.05 }, 1000);

    expect(result.channels).toHaveLength(1);
    expect(result.channels[0]).toEqual({ rms: 1, rmsDb: 0, sampleCount: 50 });
    expect(result.stereo).toBeNull();
    expect(result.start).toBe(0);
    expect(result.end).toBe(0.05);
  });

  it('reproduces official Left, Right and quadratic Stereo results', () => {
    const result = measureRmsSelection([
      clip('stereo', [new Float32Array(100).fill(0.5), new Float32Array(100).fill(0.25)]),
    ], { start: 0, end: 0.1 }, 1000);

    expect(result.channels[0].rmsDb).toBeCloseTo(-6.0206, 4);
    expect(result.channels[1].rmsDb).toBeCloseTo(-12.0412, 4);
    expect(result.stereo?.rms).toBeCloseTo(Math.sqrt(0.15625), 12);
    expect(result.stereo?.rmsDb).toBeCloseTo(-8.0618, 4);
    expect(result.stereo?.sampleCount).toBe(100);
    expect(formatRmsDb(result.stereo!.rmsDb)).toBe('-8.0618 dB');
  });

  it('returns -Inf dB for digital silence without converting it to zero dB', () => {
    const result = measureRmsSelection([
      clip('silence', [new Float32Array(20), new Float32Array(20)]),
    ], { start: 0, end: 0.02 }, 1000);

    expect(result.channels.map(({ rmsDb }) => rmsDb)).toEqual([-Infinity, -Infinity]);
    expect(result.stereo?.rmsDb).toBe(-Infinity);
    expect(formatRmsDb(result.stereo!.rmsDb)).toBe('-Inf dB');
  });

  it('combines multiple clips while excluding empty timeline gaps and retaining real zeros', () => {
    const first = new Float32Array([1, 0]);
    const second = new Float32Array([0, 1]);
    const result = measureRmsSelection([
      clip('b', [second], 0.01),
      clip('a', [first], 0),
    ], { start: 0, end: 0.02 }, 1000);

    expect(result.channels[0].sampleCount).toBe(4);
    expect(result.channels[0].rms).toBe(Math.sqrt(0.5));
  });

  it('rejects empty selections and selections without audio', () => {
    const audio = [clip('a', [new Float32Array(10).fill(1)])];
    expect(() => measureRmsSelection(audio, { start: 0.1, end: 0.1 }, 1000)).toThrow('有效的音频时间选区');
    expect(() => measureRmsSelection(audio, { start: 0.1, end: 0.2 }, 1000)).toThrow('没有可测量的音频');
    expect(() => measureRmsSelection(audio, { start: 0, end: 0.01 }, 0)).toThrow('有效的音频时间选区');
  });

  it('rejects non-finite samples before producing a result', () => {
    const samples = new Float32Array(10).fill(0.5);
    samples[4] = Infinity;
    expect(() => measureRmsSelection([
      clip('bad', [samples]),
    ], { start: 0, end: 0.01 }, 1000)).toThrow('非有限采样值');
  });

  it('rejects inconsistent channel layouts and unsupported multichannel audio', () => {
    expect(() => measureRmsSelection([
      clip('a', [new Float32Array(10), new Float32Array(10)]),
      clip('b', [new Float32Array(10)], 0.01),
    ], { start: 0, end: 0.02 }, 1000)).toThrow('声道布局不一致');
    expect(() => measureRmsSelection([
      clip('a', [new Float32Array(10), new Float32Array(10), new Float32Array(10)]),
    ], { start: 0, end: 0.01 }, 1000)).toThrow('仅支持单声道或立体声');
  });

  it('validates dB formatting input', () => {
    expect(formatRmsDb(0)).toBe('0.0000 dB');
    expect(() => formatRmsDb(Number.NaN)).toThrow('无效');
    expect(() => formatRmsDb(Infinity)).toThrow('无效');
  });
});
