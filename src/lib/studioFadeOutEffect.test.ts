import { describe, expect, it } from 'vitest';
import {
  processStudioFadeOutChannels,
  raisedCosineGain,
} from '@/lib/studioFadeOutEffect';

describe('Studio Fade Out DSP', () => {
  it('provides deterministic raised-cosine endpoints', () => {
    expect(raisedCosineGain(5, 0)).toBeCloseTo(1);
    expect(raisedCosineGain(5, 2)).toBeCloseTo(0.5);
    expect(raisedCosineGain(5, 4)).toBeCloseTo(0);
  });

  it('uses only raised-cosine gain for selections shorter than 0.2 seconds', () => {
    const input = [Float32Array.of(1, 1, 1, 1, 1, 1, 1, 1, 1, 1)];
    const output = processStudioFadeOutChannels(input, 100)[0];
    expect(output).toHaveLength(10);
    expect(output[0]).toBeCloseTo(1);
    expect(output[9]).toBeCloseTo(0);
    for (let i = 0; i < output.length; i += 1) {
      expect(output[i]).toBeCloseTo(raisedCosineGain(10, i));
    }
  });

  it('crossfades to a swept low-pass for long selections', () => {
    const sampleRate = 1000;
    const length = 300;
    const input = new Float32Array(length);
    for (let i = 0; i < length; i += 1) {
      input[i] = Math.sin((2 * Math.PI * 400 * i) / sampleRate);
    }
    const output = processStudioFadeOutChannels([input], sampleRate)[0];
    expect(output[0]).toBeCloseTo(input[0], 5);
    expect(output[length - 1]).toBeCloseTo(0);
    const tailEnergy = output.slice(250).reduce((total, value) => total + value * value, 0);
    expect(tailEnergy).toBeLessThan(0.01);
  });

  it('preserves low-frequency content more than high-frequency content near the end', () => {
    const sampleRate = 1000;
    const length = 300;
    const low = new Float32Array(length);
    const high = new Float32Array(length);
    for (let i = 0; i < length; i += 1) {
      low[i] = Math.sin((2 * Math.PI * 20 * i) / sampleRate);
      high[i] = Math.sin((2 * Math.PI * 400 * i) / sampleRate);
    }
    const [lowOut, highOut] = processStudioFadeOutChannels([low, high], sampleRate);
    const lowEnergy = lowOut.slice(200).reduce((total, value) => total + value * value, 0);
    const highEnergy = highOut.slice(200).reduce((total, value) => total + value * value, 0);
    expect(lowEnergy).toBeGreaterThan(highEnergy);
  });

  it('does not mutate input and processes every channel independently', () => {
    const sampleRate = 1000;
    const left = new Float32Array(300).fill(0.5);
    const right = new Float32Array(300).fill(-0.5);
    const leftSnapshot = [...left];
    const output = processStudioFadeOutChannels([left, right], sampleRate);
    expect(output).toHaveLength(2);
    expect([...left]).toEqual(leftSnapshot);
    expect(output[0][0]).toBeCloseTo(0.5);
    expect(output[1][0]).toBeCloseTo(-0.5);
    expect(output.every((channel) => channel.every(Number.isFinite))).toBe(true);
  });

  it.each([
    { channels: [], sampleRate: 1000, reason: 'empty channels' },
    { channels: [Float32Array.of(1, 2)], sampleRate: 1000, reason: 'too short' },
    { channels: [Float32Array.of(1, 2, 3)], sampleRate: 2, reason: 'bad sample rate' },
    { channels: [Float32Array.of(1, Number.NaN, 3)], sampleRate: 1000, reason: 'non-finite' },
    { channels: [Float32Array.of(1, 2, 3), Float32Array.of(1, 2)], sampleRate: 1000, reason: 'unequal' },
  ])('rejects $reason', ({ channels, sampleRate }) => {
    expect(() => processStudioFadeOutChannels(channels, sampleRate)).toThrow();
  });
});
