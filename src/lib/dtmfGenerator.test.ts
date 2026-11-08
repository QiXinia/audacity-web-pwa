import { describe, expect, it } from 'vitest';
import {
  calculateDtmfTiming,
  DTMF_DEFAULT_AMPLITUDE,
  DTMF_DEFAULT_DUTY_CYCLE,
  DTMF_DEFAULT_SEQUENCE,
  generateDtmf,
  isValidDtmfSequence,
} from '@/lib/dtmfGenerator';

function expectedTone(symbolFrequencies: readonly [number, number], index: number, sampleRate: number, amplitude: number) {
  return amplitude * 0.5 * (
    Math.sin(2 * Math.PI * symbolFrequencies[0] * index / sampleRate)
    + Math.sin(2 * Math.PI * symbolFrequencies[1] * index / sampleRate)
  );
}

describe('Audacity-compatible DTMF generation', () => {
  it('uses the official defaults and accepts exactly the documented symbol alphabet', () => {
    expect(DTMF_DEFAULT_SEQUENCE).toBe('audacity');
    expect(DTMF_DEFAULT_DUTY_CYCLE).toBe(55);
    expect(DTMF_DEFAULT_AMPLITUDE).toBe(0.8);
    expect(isValidDtmfSequence('0123456789*#ABCDabcdefghijklmnopqrstuvwxyz')).toBe(true);
    for (const invalid of ['', 'E', 'hello world', '1,2', 'é']) {
      expect(isValidDtmfSequence(invalid)).toBe(false);
    }
  });

  it.each([
    ['1', [697, 1209]],
    ['a', [697, 1336]],
    ['A', [697, 1633]],
    ['z', [852, 1477]],
    ['*', [941, 1209]],
    ['D', [941, 1633]],
  ] as const)('combines the independent frequency pair for %s', (sequence, pair) => {
    const sampleRate = 8000;
    const amplitude = 0.6;
    const result = generateDtmf({ sequence, amplitude, dutyCycle: 55, duration: 0.02, sampleRate });
    expect(result).toHaveLength(160);
    // Sample 50 is outside both 4 ms / 32-sample fade regions.
    expect(result[50]).toBeCloseTo(expectedTone(pair, 50, sampleRate, amplitude), 6);
  });

  it('matches the official 4 ms fade-in and fade-out weights', () => {
    const sampleRate = 1000;
    const amplitude = 0.8;
    const result = generateDtmf({ sequence: '1', amplitude, dutyCycle: 55, duration: 0.05, sampleRate });
    const pair = [697, 1209] as const;
    expect(result).toHaveLength(50);
    expect(result[1]).toBeCloseTo(expectedTone(pair, 1, sampleRate, amplitude) * 0.25, 6);
    expect(result[10]).toBeCloseTo(expectedTone(pair, 10, sampleRate, amplitude), 6);
    expect(result[49]).toBeCloseTo(expectedTone(pair, 49, sampleRate, amplitude) * 0.25, 6);
  });

  it('uses N tones and N-1 silences, then redistributes the remainder sample', () => {
    const result = generateDtmf({
      sequence: '12', amplitude: 0.8, dutyCycle: 50, duration: 1, sampleRate: 1000,
    });
    expect(result).toHaveLength(1000);
    expect(calculateDtmfTiming({ sequence: '12', duration: 1, dutyCycle: 50 })).toEqual({
      toneDuration: 1 / 3,
      silenceDuration: 1 / 3,
    });
    // 334 samples of '1', 333 zero samples, then 333 samples of '2'.
    expect(Array.from(result.slice(334, 667))).toEqual(new Array(333).fill(0));
    expect(result.slice(0, 334).some((sample) => sample !== 0)).toBe(true);
    expect(result.slice(667).some((sample) => sample !== 0)).toBe(true);
  });

  it('keeps the documented 11-tone / 75% case at the exact requested sample count', () => {
    const result = generateDtmf({
      sequence: '1234567890A', amplitude: 0.8, dutyCycle: 75, duration: 4, sampleRate: 44100,
    });
    expect(result).toHaveLength(176400);
    expect(Number.isFinite(result[0])).toBe(true);
    expect(Number.isFinite(result[result.length - 1])).toBe(true);
  });

  it('handles single-tone, zero-amplitude, and extreme duty cycles deterministically', () => {
    const single = generateDtmf({ sequence: '0', amplitude: 0.8, dutyCycle: 0, duration: 0.01, sampleRate: 1000 });
    expect(single).toHaveLength(10);
    expect(calculateDtmfTiming({ sequence: '0', duration: 2, dutyCycle: 0 })).toEqual({
      toneDuration: 2,
      silenceDuration: 0,
    });
    const zero = generateDtmf({ sequence: '12', amplitude: 0, dutyCycle: 100, duration: 0.01, sampleRate: 1000 });
    expect(Array.from(zero).every((sample) => sample === 0)).toBe(true);
    const silent = generateDtmf({ sequence: '12', amplitude: 0.8, dutyCycle: 0, duration: 1, sampleRate: 1000 });
    expect(Array.from(silent)).toEqual(new Array(1000).fill(0));
    const joined = generateDtmf({ sequence: '12', amplitude: 0.8, dutyCycle: 100, duration: 0.01, sampleRate: 1000 });
    expect(joined).toEqual(generateDtmf({ sequence: '12', amplitude: 0.8, dutyCycle: 100, duration: 0.01, sampleRate: 1000 }));
  });

  it('fails closed for invalid settings instead of guessing or looping', () => {
    const valid = { sequence: '12', amplitude: 0.8, dutyCycle: 55, duration: 1, sampleRate: 44100 };
    expect(() => generateDtmf({ ...valid, sequence: '' })).toThrow(/sequence/);
    expect(() => generateDtmf({ ...valid, sequence: 'E' })).toThrow(/sequence/);
    expect(() => generateDtmf({ ...valid, amplitude: -0.1 })).toThrow(/Amplitude/);
    expect(() => generateDtmf({ ...valid, amplitude: 1.1 })).toThrow(/Amplitude/);
    expect(() => generateDtmf({ ...valid, dutyCycle: -1 })).toThrow(/Duty cycle/);
    expect(() => generateDtmf({ ...valid, dutyCycle: 101 })).toThrow(/Duty cycle/);
    expect(() => generateDtmf({ ...valid, duration: 0 })).toThrow(/Duration/);
    expect(() => generateDtmf({ ...valid, duration: 0.00001 })).toThrow(/at least one sample/);
    expect(() => generateDtmf({ ...valid, sampleRate: 0 })).toThrow(/Sample rate/);
  });
});
