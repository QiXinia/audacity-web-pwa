import { describe, expect, it } from 'vitest';
import { timeStretchChannelsJs } from '@/engine/timeStretch';

function sine(frequency: number, seconds: number, sampleRate: number, amplitude = 0.5): Float32Array {
  const result = new Float32Array(Math.round(seconds * sampleRate));
  for (let i = 0; i < result.length; i++) {
    result[i] = amplitude * Math.sin((2 * Math.PI * frequency * i) / sampleRate);
  }
  return result;
}

function estimatedFrequency(data: Float32Array, sampleRate: number): number {
  let crossings = 0;
  for (let i = 1; i < data.length; i++) {
    if (data[i - 1] <= 0 && data[i] > 0) crossings++;
  }
  return (crossings * sampleRate) / data.length;
}

describe('WSOLA time stretch', () => {
  it('returns exact copies at normal speed', () => {
    const input = [sine(440, 0.1, 8000), sine(880, 0.1, 8000, 0.25)];
    const output = timeStretchChannelsJs(input, 1, 8000);
    expect(output[0]).toEqual(input[0]);
    expect(output[1]).toEqual(input[1]);
    expect(output[0]).not.toBe(input[0]);
  });

  it('doubles duration without changing the sine frequency', () => {
    const output = timeStretchChannelsJs([sine(440, 1, 8000)], 0.5, 8000)[0];
    expect(output.length).toBe(16000);
    expect(estimatedFrequency(output, 8000)).toBeGreaterThan(425);
    expect(estimatedFrequency(output, 8000)).toBeLessThan(455);
    expect(Array.from(output).every(Number.isFinite)).toBe(true);
  });

  it('halves duration without changing the sine frequency', () => {
    const output = timeStretchChannelsJs([sine(440, 1, 8000)], 2, 8000)[0];
    expect(output.length).toBe(4000);
    expect(estimatedFrequency(output, 8000)).toBeGreaterThan(425);
    expect(estimatedFrequency(output, 8000)).toBeLessThan(455);
  });

  it('keeps stereo channels aligned and preserves both pitches', () => {
    const [left, right] = timeStretchChannelsJs(
      [sine(440, 0.5, 8000, 0.4), sine(880, 0.5, 8000, 0.2)],
      0.75,
      8000,
    );
    expect(left.length).toBe(right.length);
    expect(estimatedFrequency(left, 8000)).toBeGreaterThan(425);
    expect(estimatedFrequency(left, 8000)).toBeLessThan(455);
    expect(estimatedFrequency(right, 8000)).toBeGreaterThan(850);
    expect(estimatedFrequency(right, 8000)).toBeLessThan(910);
  });

  it('preserves constant signal amplitude through overlap-add normalization', () => {
    for (const ratio of [0.5, 2]) {
      const [left, right] = timeStretchChannelsJs(
        [new Float32Array(2000).fill(0.5), new Float32Array(2000).fill(0.25)],
        ratio,
        8000,
      );
      for (const [channel, expected] of [[left, 0.5], [right, 0.25]] as const) {
        for (let i = 64; i < channel.length - 64; i += 97) {
          expect(channel[i]).toBeCloseTo(expected, 4);
        }
      }
    }
  });

  it('handles empty, very short and invalid inputs predictably', () => {
    expect(timeStretchChannelsJs([], 2, 8000)).toEqual([]);
    expect(timeStretchChannelsJs([new Float32Array()], 2, 8000)[0].length).toBe(0);
    expect(timeStretchChannelsJs([new Float32Array(32).fill(0.5)], 2, 8000)[0].length).toBe(16);
    expect(() => timeStretchChannelsJs([new Float32Array(2), new Float32Array(3)], 1, 8000)).toThrow();
    expect(() => timeStretchChannelsJs([new Float32Array(2)], 0, 8000)).toThrow();
  });
});
