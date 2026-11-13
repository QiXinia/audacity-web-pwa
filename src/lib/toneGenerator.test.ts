import { describe, expect, it } from 'vitest';
import { generateTone, generateToneChannels, type ToneWaveform } from '@/lib/toneGenerator';

function samples(waveform: ToneWaveform, sampleRate = 8): number[] {
  return Array.from(generateTone({
    waveform,
    frequency: 1,
    amplitude: 1,
    duration: 1,
    sampleRate,
    channelCount: 1,
  }));
}

describe('Audacity-compatible tone generation', () => {
  it('generates a deterministic sine with the requested sample count and amplitude', () => {
    const first = generateTone({ waveform: 'sine', frequency: 440, amplitude: 0.8, duration: 0.01, sampleRate: 44100, channelCount: 1 });
    const second = generateTone({ waveform: 'sine', frequency: 440, amplitude: 0.8, duration: 0.01, sampleRate: 44100, channelCount: 1 });

    expect(first).toHaveLength(441);
    expect(first).toEqual(second);
    expect(first[0]).toBe(0);
    expect(Math.max(...first)).toBeLessThanOrEqual(0.8);
    expect(Math.min(...first)).toBeGreaterThanOrEqual(-0.8);
  });

  it('matches Audacity ToneGenBase sine, square, sawtooth and triangle phases', () => {
    expect(samples('sine').map((value) => Math.round(value * 1000) / 1000)).toEqual([
      0, 0.707, 1, 0.707, 0, -0.707, -1, -0.707,
    ]);
    expect(samples('square')).toEqual([1, 1, 1, 1, -1, -1, -1, -1]);
    expect(samples('sawtooth')).toEqual([0, 0.25, 0.5, 0.75, -1, -0.75, -0.5, -0.25]);
    expect(samples('triangle')).toEqual([0, 0.5, 1, 0.5, 0, -0.5, -1, -0.5]);
  });

  it('implements the Hann-windowed non-aliasing square equation', () => {
    const result = generateTone({
      waveform: 'squareNoAlias',
      frequency: 1000,
      amplitude: 0.5,
      duration: 0.001,
      sampleRate: 8000,
      channelCount: 1,
    });

    expect(result).toHaveLength(8);
    expect(Array.from(result).every(Number.isFinite)).toBe(true);
    expect(result[0]).toBe(0);
    expect(Math.max(...result)).toBeLessThanOrEqual(0.8);
    expect(Math.min(...result)).toBeGreaterThanOrEqual(-0.8);
  });

  it('rejects invalid frequency, amplitude, duration and sample rate', () => {
    const valid = { waveform: 'sine' as const, frequency: 440, amplitude: 0.8, duration: 1, sampleRate: 44100, channelCount: 1 as const };
    expect(() => generateTone({ ...valid, frequency: 22050.01 })).toThrow(/Nyquist/);
    expect(() => generateTone({ ...valid, frequency: 0 })).toThrow(/Frequency/);
    expect(() => generateTone({ ...valid, amplitude: 1.01 })).toThrow(/Amplitude/);
    expect(() => generateTone({ ...valid, amplitude: -0.01 })).toThrow(/Amplitude/);
    expect(() => generateTone({ ...valid, duration: 0 })).toThrow(/Duration/);
    expect(() => generateTone({ ...valid, sampleRate: 0 })).toThrow(/Sample rate/);
  });

  it('generates two equal-length independent stereo channels deterministically', () => {
    const channels = generateToneChannels({
      waveform: 'sine',
      frequency: 440,
      amplitude: 0.8,
      duration: 0.01,
      sampleRate: 44100,
      channelCount: 2,
    });

    expect(channels).toHaveLength(2);
    expect(channels[0]).toHaveLength(441);
    expect(channels[1]).toHaveLength(441);
    expect(channels[0]).toEqual(channels[1]);
    expect(channels[0]).not.toBe(channels[1]);
  });

  it('rejects an unsupported channel count', () => {
    expect(() => generateToneChannels({
      waveform: 'sine',
      frequency: 440,
      amplitude: 0.8,
      duration: 0.01,
      sampleRate: 44100,
      channelCount: 3 as never,
    })).toThrow(/channel count/);
  });
});
