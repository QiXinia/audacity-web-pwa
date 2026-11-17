import { describe, expect, it } from 'vitest';
import {
  getResampledLength,
  parseResampleRate,
  resampleChannels,
  RESAMPLE_RATE_CHOICES,
} from './resampleEffect';

describe('Audacity Resample core', () => {
  it('accepts the official editable rate range and rejects invalid text', () => {
    expect(RESAMPLE_RATE_CHOICES).toContain(44100);
    expect(parseResampleRate(' 22050 ')).toBe(22050);
    expect(parseResampleRate('+48000')).toBe(48000);
    expect(parseResampleRate('1')).toBe(1);
    expect(parseResampleRate('1000000')).toBe(1_000_000);
    for (const invalid of ['', '0', '-1', '1000001', '44100.5', '44.1k', '1e6']) {
      expect(parseResampleRate(invalid)).toBeNull();
    }
  });

  it('rounds output length from the source and destination rates', () => {
    expect(getResampledLength(44100, 44100, 22050)).toBe(22050);
    expect(getResampledLength(1000, 1000, 2000)).toBe(2000);
    expect(getResampledLength(3, 48000, 44100)).toBe(3);
    expect(getResampledLength(1, 1_000_000, 1)).toBe(1);
  });

  it('copies same-rate PCM without aliasing the input', () => {
    const input = Float32Array.from([0, 0.25, -0.5, 1.6]);
    const output = resampleChannels([input], 44100, 44100);
    expect(output[0]).toEqual(input);
    expect(output[0]).not.toBe(input);
    output[0]![0] = 0.75;
    expect(input[0]).toBe(0);
  });

  it('preserves stereo DC and floating-point values beyond full scale', () => {
    const left = Float32Array.from({ length: 32 }, () => 1.6);
    const right = Float32Array.from({ length: 32 }, () => -0.4);
    const [outLeft, outRight] = resampleChannels([left, right], 1000, 2000);
    expect(outLeft).toHaveLength(64);
    expect(outRight).toHaveLength(64);
    expect(Math.max(...outLeft!.map((value) => Math.abs(value - 1.6)))).toBeLessThan(1e-6);
    expect(Math.max(...outRight!.map((value) => Math.abs(value + 0.4)))).toBeLessThan(1e-6);
  });

  it('reconstructs a band-limited sine when downsampling', () => {
    const source = Float32Array.from(
      { length: 1000 },
      (_, index) => 0.8 * Math.sin(2 * Math.PI * 20 * index / 1000),
    );
    const [output] = resampleChannels([source], 1000, 500);
    expect(output).toHaveLength(500);
    for (let index = 50; index < 450; index += 1) {
      const expected = 0.8 * Math.sin(2 * Math.PI * 20 * index / 500);
      expect(Math.abs(output![index]! - expected)).toBeLessThan(0.0002);
    }
  });

  it('rejects invalid channels, rates and non-finite PCM', () => {
    expect(() => resampleChannels([], 44100, 22050)).toThrow(/至少需要一个音频声道/);
    expect(() => resampleChannels([new Float32Array()], 44100, 22050)).toThrow(/等长且非空/);
    expect(() => resampleChannels([
      new Float32Array(2), new Float32Array(3),
    ], 44100, 22050)).toThrow(/等长且非空/);
    expect(() => resampleChannels([
      Float32Array.from([0, Number.NaN]),
    ], 44100, 22050)).toThrow(/非有限数值/);
    expect(() => resampleChannels([new Float32Array(2)], 0, 22050)).toThrow(/1 至 1000000/);
    expect(() => resampleChannels([new Float32Array(2)], 44100, 44100.5)).toThrow(/1 至 1000000/);
  });

  it('rejects excessive output before allocating it', () => {
    expect(() => resampleChannels([new Float32Array(21)], 1, 1_000_000))
      .toThrow(/超过浏览器内存上限/);
  });
});
