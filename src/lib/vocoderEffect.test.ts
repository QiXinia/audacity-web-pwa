import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VOCODER_SETTINGS,
  processVocoderChannels,
  type VocoderSettings,
} from './vocoderEffect';

const sampleRate = 8000;

function tone(length: number, frequency: number, amplitude = 0.8): Float32Array {
  const output = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    output[index] = amplitude * Math.sin(2 * Math.PI * frequency * index / sampleRate);
  }
  return output;
}

const settings: VocoderSettings = {
  ...DEFAULT_VOCODER_SETTINGS,
  bandCount: 10,
  carrierWavePercent: 100,
};

describe('vocoderEffect', () => {
  it('processes mono input with a generated carrier and normalizes to unit peak', () => {
    const input = tone(2048, 220);
    const output = processVocoderChannels([input], settings, sampleRate);
    expect(output).toHaveLength(1);
    expect(output[0]).toHaveLength(input.length);
    let peak = 0;
    for (const value of output[0]) {
      expect(Number.isFinite(value)).toBe(true);
      peak = Math.max(peak, Math.abs(value));
    }
    expect(peak).toBeCloseTo(1, 5);
  });

  it('uses the right stereo channel as external carrier and can preserve both channels', () => {
    const modulator = tone(2048, 220);
    const carrier = tone(2048, 440, 0.5);
    const output = processVocoderChannels([modulator, carrier], settings, sampleRate);
    expect(output).toHaveLength(2);
    expect(output[0]).not.toBe(modulator);
    expect(Array.from(output[0].slice(0, 8))).toEqual(Array.from(modulator.slice(0, 8)));
  });

  it('returns only the synthesized channel when right-only is selected', () => {
    const output = processVocoderChannels(
      [tone(2048, 220), tone(2048, 440)],
      { ...settings, outputChoice: 'rightOnly' },
      sampleRate,
    );
    expect(output).toHaveLength(1);
  });

  it('rejects a mono carrier configuration with no modulation source', () => {
    expect(() => processVocoderChannels(
      [tone(2048, 220)],
      {
        ...settings,
        carrierWavePercent: 0,
        whiteNoisePercent: 0,
        radarNeedlesPercent: 0,
      },
      sampleRate,
    )).toThrow('没有调制载波');
  });

  it('rejects invalid band counts and unequal channel lengths', () => {
    expect(() => processVocoderChannels(
      [tone(100, 220)],
      { ...settings, bandCount: 5 },
      sampleRate,
    )).toThrow('频带数量');
    expect(() => processVocoderChannels(
      [tone(100, 220), tone(99, 440)],
      settings,
      sampleRate,
    )).toThrow('等长');
  });

  it('supports a mixed noise and radar carrier', () => {
    const output = processVocoderChannels(
      [tone(2048, 220)],
      {
        ...settings,
        carrierWavePercent: 20,
        whiteNoisePercent: 40,
        radarNeedlesPercent: 40,
        radarNeedlesFrequencyHz: 20,
      },
      sampleRate,
    );
    expect(output[0].length).toBe(2048);
    let peak = 0;
    for (const value of output[0]) peak = Math.max(peak, Math.abs(value));
    expect(peak).toBeCloseTo(1, 5);
  });
});
