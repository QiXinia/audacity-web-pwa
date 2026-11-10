import { describe, expect, it } from 'vitest';
import { timeStretchChannelsJs } from '@/engine/timeStretch';
import { processChangeSpeedChannels } from '@/lib/changeSpeedEffect';
import {
  MAX_CHANGE_PITCH_PERCENT,
  MIN_CHANGE_PITCH_PERCENT,
  changePitchRatio,
  isChangePitchBypassed,
  nearestPitchFromFrequency,
  percentChangeFromFrequencies,
  percentChangeFromPitchSlider,
  percentChangeFromSemitones,
  pitchToFrequency,
  processChangePitchChannels,
  semitonesFromPercentChange,
  sliderFromPitchPercent,
  targetPitchFromSemitones,
  validateChangePitchSettings,
} from './changePitchEffect';

function binMagnitude(samples: Float32Array, sampleRate: number, frequency: number): number {
  let real = 0;
  let imaginary = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const angle = 2 * Math.PI * frequency * index / sampleRate;
    real += samples[index] * Math.cos(angle);
    imaginary -= samples[index] * Math.sin(angle);
  }
  return Math.hypot(real, imaginary) / samples.length;
}

describe('Change Pitch official parameter contract', () => {
  it('uses the official -99..3000 range and exponential semitone mapping', () => {
    expect(MIN_CHANGE_PITCH_PERCENT).toBe(-99);
    expect(MAX_CHANGE_PITCH_PERCENT).toBe(3000);
    expect(changePitchRatio({ percentChange: 100 })).toBe(2);
    expect(semitonesFromPercentChange(100)).toBeCloseTo(12, 12);
    expect(semitonesFromPercentChange(-50)).toBeCloseTo(-12, 12);
    expect(percentChangeFromSemitones(12)).toBeCloseTo(100, 12);
    expect(percentChangeFromSemitones(-12)).toBeCloseTo(-50, 12);
    expect(percentChangeFromSemitones(1)).toBeCloseTo(5.9463094, 6);
    expect(isChangePitchBypassed({ percentChange: 0 })).toBe(true);
  });

  it('links directed frequencies, note names and octaves', () => {
    expect(pitchToFrequency(9, 4)).toBeCloseTo(440, 12);
    expect(pitchToFrequency(0, 4)).toBeCloseTo(261.6255653, 6);
    expect(percentChangeFromFrequencies(440, 880)).toBe(100);
    expect(percentChangeFromFrequencies(880, 440)).toBe(-50);
    expect(nearestPitchFromFrequency(440)).toEqual({ pitch: 9, octave: 4 });
    expect(nearestPitchFromFrequency(261.6255653)).toEqual({ pitch: 0, octave: 4 });
    expect(targetPitchFromSemitones(9, 12)).toBe(9);
    expect(targetPitchFromSemitones(0, -1)).toBe(11);
    expect(() => percentChangeFromFrequencies(0, 440)).toThrow('大于零');
  });

  it('warps only the positive slider half and clamps values above 400 percent', () => {
    expect(percentChangeFromPitchSlider(-99)).toBe(-99);
    expect(percentChangeFromPitchSlider(100)).toBeCloseTo(400.0366, 3);
    expect(sliderFromPitchPercent(percentChangeFromPitchSlider(50))).toBeCloseTo(50, 10);
    expect(sliderFromPitchPercent(3000)).toBe(100);
  });

  it.each([-99.001, 3000.001, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid percent %s',
    (percentChange) => {
      expect(() => validateChangePitchSettings({ percentChange })).toThrow('音高变化');
    },
  );
});

describe('Change Pitch deterministic fixed-duration kernel', () => {
  it('raises a sine by one octave without changing length or input', () => {
    const sampleRate = 8192;
    const source = Float32Array.from(
      { length: 2048 },
      (_, index) => Math.sin(2 * Math.PI * 256 * index / sampleRate) * 0.5,
    );
    const original = source.slice();
    const output = processChangePitchChannels([source], { percentChange: 100 }, sampleRate)[0];
    expect(output).toHaveLength(source.length);
    expect(source).toEqual(original);
    const interior = output.slice(256, -256);
    const target = binMagnitude(interior, sampleRate, 512);
    const originalFrequency = binMagnitude(interior, sampleRate, 256);
    expect(target).toBeGreaterThan(originalFrequency * 2);
    expect(target).toBeGreaterThan(0.05);
  });

  it('lowers pitch, preserves stereo alignment and repeats deterministically', () => {
    const sampleRate = 4096;
    const left = Float32Array.from(
      { length: 1024 },
      (_, index) => Math.sin(2 * Math.PI * 256 * index / sampleRate) * 0.4,
    );
    const right = left.map((value) => value * 0.5);
    const first = processChangePitchChannels([left, right], { percentChange: -50 }, sampleRate);
    const second = processChangePitchChannels([left, right], { percentChange: -50 }, sampleRate);
    expect(first[0]).toHaveLength(1024);
    expect(first[1]).toHaveLength(1024);
    expect(first).toEqual(second);
    const interior = first[0].slice(256, -256);
    expect(binMagnitude(interior, sampleRate, 128)).toBeGreaterThan(
      binMagnitude(interior, sampleRate, 256) * 2,
    );
    for (let index = 0; index < first[0].length; index += 1) {
      expect(first[1][index]).toBeCloseTo(first[0][index] * 0.5, 5);
    }
  });

  it('handles tiny, extreme-ratio and constant inputs with exact finite output lengths', () => {
    for (const percentChange of [-99, -50, 100, 3000]) {
      const output = processChangePitchChannels(
        [new Float32Array(7).fill(0.25)], { percentChange }, 1000,
      )[0];
      expect(output).toHaveLength(7);
      for (const value of output) expect(Number.isFinite(value)).toBe(true);
    }
    expect(processChangePitchChannels(
      [new Float32Array(7).fill(0.25)], { percentChange: 0 }, 1000,
    )[0]).toEqual(new Float32Array(7).fill(0.25));
  });

  it('pads sub-128-frame intermediates to the real WSOLA threshold', () => {
    const source = Float32Array.from([0, 0.5, 1, 0.5, 0, -0.5, -1]);
    const settings = { percentChange: 100 };
    const resampled = processChangeSpeedChannels([source], settings, 1000);
    const padded = resampled.map((channel) => Float32Array.from(
      { length: 128 }, (_, index) => channel[index % channel.length],
    ));
    const expected = timeStretchChannelsJs(padded, 128 / source.length, 48_000);
    expect(processChangePitchChannels([source], settings, 1000)).toEqual(expected);
  });

  it('rejects empty, ragged, non-finite and invalid-rate inputs', () => {
    expect(() => processChangePitchChannels([], { percentChange: 100 }, 10)).toThrow('声道');
    expect(() => processChangePitchChannels(
      [new Float32Array(2), new Float32Array(3)], { percentChange: 100 }, 10,
    )).toThrow('等长');
    expect(() => processChangePitchChannels(
      [Float32Array.from([0, Number.NaN])], { percentChange: 100 }, 10,
    )).toThrow('非有限');
    expect(() => processChangePitchChannels(
      [new Float32Array(2)], { percentChange: 100 }, 0,
    )).toThrow('采样率');
  });

  it('fails closed before allocating outputs beyond the browser memory budget', () => {
    expect(() => processChangePitchChannels(
      [new Float32Array(300_000)], { percentChange: -99 }, 48_000,
    )).toThrow('内存上限');
    expect(() => processChangePitchChannels(
      [new Float32Array(20_000_001)], { percentChange: 0 }, 48_000,
    )).toThrow('内存上限');
  });
});
