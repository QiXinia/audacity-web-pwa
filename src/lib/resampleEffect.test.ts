import { describe, expect, it } from 'vitest';
import {
  getResampledLength,
  MAX_RESAMPLE_TOTAL_OUTPUT_SAMPLES,
  parseResampleRate,
  resampleChannels,
  resampleChannelsDetailed,
  SAMPLE_RATE_CONVERTER_OPTIONS,
  validateResampleRate,
} from './resampleEffect';
import { SOXR_QUALITY_RECIPES } from './soxrResampler';
import type { HighQualitySampleRateConverter } from '@/types/project';
import nativeOracle from '@/test/fixtures/soxrAudacityOracle.json';

describe('resampleEffect', () => {
  it('matches the official editable-rate boundaries', () => {
    expect(parseResampleRate(' 48000 ')).toBe(48000);
    expect(parseResampleRate('+1')).toBe(1);
    expect(parseResampleRate('1000000')).toBe(1000000);
    for (const value of ['', 'abc', '1.5', '0', '-1', '1000001', '1e3', '0x10']) {
      expect(parseResampleRate(value)).toBeNull();
    }
    expect(() => validateResampleRate(44100)).not.toThrow();
    expect(() => validateResampleRate(0)).toThrow();
    expect(() => validateResampleRate(44100.5)).toThrow();
  });

  it('retains the conservative preflight length estimate', () => {
    expect(getResampledLength(44100, 44100, 48000)).toBe(48000);
    expect(getResampledLength(48000, 48000, 44100)).toBe(44100);
    expect(getResampledLength(1, 1000, 1)).toBe(1);
    expect(getResampledLength(137, 1000, 1600)).toBe(219);
  });

  it('maps the four Audacity HQ preferences to Soxr LQ/MQ/HQ/VHQ', () => {
    expect(SAMPLE_RATE_CONVERTER_OPTIONS.map((option) => option.value)).toEqual([
      'lowQuality', 'mediumQuality', 'highQuality', 'bestQuality',
    ]);
    expect(SOXR_QUALITY_RECIPES).toEqual({
      lowQuality: 1,
      mediumQuality: 2,
      highQuality: 4,
      bestQuality: 6,
    });
  });

  it('copies same-rate PCM without allocating a resampler', async () => {
    const source = new Float32Array([-2, -0.5, 0, 0.75, 2]);
    const result = await resampleChannelsDetailed([source], 44100, 44100);
    expect(result.backend).toBe('same-rate');
    expect(result.channels[0]).toEqual(source);
    expect(result.channels[0]).not.toBe(source);
  });

  it('rejects malformed PCM, unsafe sizes and unknown quality through async errors', async () => {
    await expect(resampleChannels([], 44100, 48000)).rejects.toThrow(/声道/);
    await expect(resampleChannels([new Float32Array(2), new Float32Array(3)], 44100, 48000)).rejects.toThrow(/等长/);
    await expect(resampleChannels([new Float32Array(0)], 44100, 48000)).rejects.toThrow(/非空/);
    await expect(resampleChannels([new Float32Array([0, Number.NaN])], 44100, 48000)).rejects.toThrow(/非有限/);
    await expect(resampleChannels([new Float32Array([0, Infinity])], 44100, 48000)).rejects.toThrow(/非有限/);
    await expect(resampleChannels([new Float32Array(2)], 0, 48000)).rejects.toThrow();
    await expect(resampleChannels([new Float32Array(2)], 44100, 1_000_001)).rejects.toThrow();
    await expect(resampleChannels(
      [new Float32Array(2)],
      44100,
      48000,
      'invalid' as HighQualitySampleRateConverter,
    )).rejects.toThrow(/未知/);
    const oversizedLength = Math.floor(MAX_RESAMPLE_TOTAL_OUTPUT_SAMPLES / 2) + 1;
    await expect(resampleChannels([
      new Float32Array(oversizedLength),
      new Float32Array(oversizedLength),
    ], 44100, 44100)).rejects.toThrow(/上限/);
  });
});

function makeOracleInput(length: number, _crossBlock: boolean): Float32Array {
  const input = new Float32Array(length);
  let state = 0x12345678;
  for (let index = 0; index < length; index += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const unit = (state >>> 8) / 8388607.5;
    let value = Math.fround((unit - 1) * 0.75);
    if (index % 97 === 0) value = index % 194 === 0 ? 0.9 : -0.9;
    input[index] = value;
  }
  return input;
}

function fromLittleEndianBase64(base64: string): Float32Array {
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new Float32Array(bytes.buffer);
}

function maximumAbsoluteError(actual: Float32Array, expected: Float32Array): number {
  let maximum = 0;
  for (let index = 0; index < actual.length; index += 1) {
    maximum = Math.max(maximum, Math.abs(actual[index]! - expected[index]!));
  }
  return maximum;
}

function channelStats(channel: Float32Array) {
  let sum = 0;
  let sumSquares = 0;
  let min = Infinity;
  let max = -Infinity;
  for (const sample of channel) {
    sum += sample;
    sumSquares += sample * sample;
    min = Math.min(min, sample);
    max = Math.max(max, sample);
  }
  return { sum, sumSquares, min, max };
}

// Native x86 and Emscripten/WASM floating-point execution is not bit-identical.
// The largest observed mediumQuality upsample error is ~1.03e-5 per sample and
// ~1.25e-5 relative energy difference; 2e-5 bounds retain those real margins.
describe('Audacity native libsoxr 0.1.3 oracle', () => {
  it.each(nativeOracle.cases.filter((item) => item.caseName.startsWith('short-')))(
    '$caseName / $quality matches native PCM within cross-platform float tolerance',
    { timeout: 30_000 },
    async (oracle) => {
      const result = await resampleChannelsDetailed(
        [makeOracleInput(oracle.inputFrames, false)],
        oracle.fromRate,
        oracle.toRate,
        oracle.quality as HighQualitySampleRateConverter,
      );
      const expected = fromLittleEndianBase64(oracle.float32LeBase64!);
      expect(result.backend).toBe('libsoxr-wasm');
      expect(result.channels).toHaveLength(1);
      expect(result.channels[0].length).toBe(oracle.outputFrames);
      expect(maximumAbsoluteError(result.channels[0], expected)).toBeLessThanOrEqual(2e-5);
    },
  );

  it.each(nativeOracle.cases.filter((item) => item.caseName.startsWith('cross-block-')))(
    '$caseName / $quality matches native frame count and signal statistics',
    { timeout: 60_000 },
    async (oracle) => {
      const result = await resampleChannelsDetailed(
        [makeOracleInput(oracle.inputFrames, true)],
        oracle.fromRate,
        oracle.toRate,
        oracle.quality as HighQualitySampleRateConverter,
      );
      expect(result.backend).toBe('libsoxr-wasm');
      expect(result.channels[0].length).toBe(oracle.outputFrames);
      const actual = channelStats(result.channels[0]);
      const expected = oracle.nativeStats;
      expect(Math.abs(actual.sum - expected.sum)).toBeLessThanOrEqual(1e-3);
      expect(Math.abs(actual.sumSquares - expected.sumSquares)).toBeLessThanOrEqual(
        Math.max(1e-3, expected.sumSquares * 2e-5),
      );
      expect(Math.abs(actual.min - expected.min)).toBeLessThanOrEqual(2e-5);
      expect(Math.abs(actual.max - expected.max)).toBeLessThanOrEqual(2e-5);
    },
  );
});
