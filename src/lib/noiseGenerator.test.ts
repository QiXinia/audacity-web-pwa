import { describe, expect, it } from 'vitest';
import { generateNoise, type NoiseType } from '@/lib/noiseGenerator';

function referenceWhite(seed: number, count: number): number[] {
  let state = (seed >>> 0) || 0x6d2b79f5;
  return Array.from({ length: count }, () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x80000000 - 1;
  });
}

function generate(type: NoiseType, overrides: Partial<Parameters<typeof generateNoise>[0]> = {}) {
  return generateNoise({
    type,
    amplitude: 0.8,
    duration: 0.01,
    sampleRate: 44100,
    seed: 123456789,
    ...overrides,
  });
}

describe('Audacity-compatible noise generation', () => {
  it('matches an independent white-noise sequence and honors amplitude and sample count', () => {
    const result = generate('white', { duration: 8 / 44100 });
    const expected = referenceWhite(123456789, 8).map((sample) => sample * 0.8);

    expect(result).toHaveLength(8);
    expected.forEach((sample, index) => expect(result[index]).toBeCloseTo(sample, 6));
    expect(Math.max(...result)).toBeLessThanOrEqual(0.8);
    expect(Math.min(...result)).toBeGreaterThanOrEqual(-0.8);
  });

  it('reproduces all three algorithms from an explicit seed and resets their state', () => {
    for (const type of ['white', 'pink', 'brownian'] as const) {
      const first = generate(type);
      const second = generate(type);
      expect(first).toHaveLength(441);
      expect(first).toEqual(second);
      expect(Array.from(first).every(Number.isFinite)).toBe(true);
      expect(Array.from(first).some((sample) => sample !== 0)).toBe(true);
    }
    expect(generate('pink')).not.toEqual(generate('white'));
    expect(generate('brownian')).not.toEqual(generate('white'));
    expect(generate('white', { seed: 987654321 })).not.toEqual(generate('white'));
  });

  it('uses Audacity Brownian sample-rate leakage, scaling and bounce boundary', () => {
    const sampleRate = 44100;
    const amplitude = 0.5;
    const white = referenceWhite(123456789, 1)[0];
    const expected = amplitude * white * Math.max(9 / Math.sqrt(sampleRate), 0.01);
    const result = generate('brownian', { amplitude, duration: 1 / sampleRate });

    expect(result).toHaveLength(1);
    expect(result[0]).toBeCloseTo(expected, 7);
    const long = generate('brownian', { duration: 1 });
    expect(long).toHaveLength(sampleRate);
    expect(Array.from(long).every((sample) => Number.isFinite(sample) && Math.abs(sample) <= 0.8)).toBe(true);
  });

  it('allows zero amplitude without inventing signal', () => {
    for (const type of ['white', 'pink', 'brownian'] as const) {
      expect(Array.from(generate(type, { amplitude: 0 })).every((sample) => sample === 0)).toBe(true);
    }
  });

  it('rejects invalid parameters and sub-sample durations', () => {
    expect(() => generate('white', { sampleRate: 0 })).toThrow(/Sample rate/);
    expect(() => generate('white', { amplitude: -0.01 })).toThrow(/Amplitude/);
    expect(() => generate('white', { amplitude: 1.01 })).toThrow(/Amplitude/);
    expect(() => generate('white', { duration: 0 })).toThrow(/Duration/);
    expect(() => generate('white', { duration: 0.1 / 44100 })).toThrow(/at least one sample/);
    expect(() => generate('unsupported' as NoiseType)).toThrow(/Unsupported noise type/);
  });
});
