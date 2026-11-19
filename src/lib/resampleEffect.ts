// Audacity 4.0.2 Tracks -> Resample: constant-rate, whole-clip PCM conversion.
// Official references: TrackMenus.cpp OnResample, WaveTrack.cpp Resample,
// WaveClip.cpp Resample and au3-math/Resample.cpp (libsoxr).

import type { HighQualitySampleRateConverter } from '@/types/project';
import { resampleChannelsWithSoxr } from '@/lib/soxrResampler';

export const MIN_RESAMPLE_RATE = 1;
export const MAX_RESAMPLE_RATE = 1_000_000;
export const MAX_RESAMPLE_TOTAL_OUTPUT_SAMPLES = 20_000_000;

export const RESAMPLE_RATE_CHOICES = Object.freeze([
  8000, 11025, 16000, 22050, 32000, 44100,
  48000, 88200, 96000, 176400, 192000, 352800, 384000,
]);

export const SAMPLE_RATE_CONVERTER_OPTIONS: ReadonlyArray<{
  value: HighQualitySampleRateConverter;
  label: string;
}> = [
  { value: 'lowQuality', label: 'Low Quality (Fastest)' },
  { value: 'mediumQuality', label: 'Medium Quality' },
  { value: 'highQuality', label: 'High Quality' },
  { value: 'bestQuality', label: 'Best Quality (Slowest)' },
];

export const DEFAULT_SAMPLE_RATE_CONVERTER: HighQualitySampleRateConverter = 'bestQuality';
export const SOXR_FALLBACK_WARNING =
  'libsoxr WASM 加载或处理失败，已使用确定性浏览器降级；输出不保证与 Audacity 的 libsoxr 一致。';

export type ResampleBackend = 'libsoxr-wasm' | 'typescript-fallback' | 'same-rate';

export interface ResampleChannelsResult {
  channels: Float32Array[];
  backend: ResampleBackend;
  warning?: string;
}

/** Match the editable official combo box: integer text from 1 to 1,000,000. */
export function parseResampleRate(value: string): number | null {
  const trimmed = value.trim();
  if (!/^[+-]?\d+$/.test(trimmed)) return null;
  const rate = Number(trimmed);
  return Number.isSafeInteger(rate)
    && rate >= MIN_RESAMPLE_RATE
    && rate <= MAX_RESAMPLE_RATE
    ? rate
    : null;
}

export function validateResampleRate(rate: number): void {
  if (
    !Number.isSafeInteger(rate)
    || rate < MIN_RESAMPLE_RATE
    || rate > MAX_RESAMPLE_RATE
  ) {
    throw new RangeError('采样率必须是 1 至 1000000 Hz 的整数');
  }
}

/** Conservative allocation/preflight estimate; libsoxr determines final frames. */
export function getResampledLength(
  inputLength: number,
  fromRate: number,
  toRate: number,
): number {
  if (!Number.isSafeInteger(inputLength) || inputLength < 1) {
    throw new RangeError('Resample 输入必须包含至少一个采样');
  }
  validateResampleRate(fromRate);
  validateResampleRate(toRate);
  const outputLength = Math.max(1, Math.round(inputLength * toRate / fromRate));
  if (!Number.isSafeInteger(outputLength)) {
    throw new RangeError('Resample 输出长度超出安全整数范围');
  }
  return outputLength;
}

function validateChannels(channels: readonly Float32Array[]): number {
  if (channels.length === 0) throw new RangeError('Resample 至少需要一个音频声道');
  const inputLength = channels[0]?.length ?? 0;
  if (inputLength < 1 || channels.some((channel) => channel.length !== inputLength)) {
    throw new RangeError('Resample 输入声道必须等长且非空');
  }
  for (const channel of channels) {
    for (let index = 0; index < channel.length; index += 1) {
      if (!Number.isFinite(channel[index])) {
        throw new RangeError(`Resample 输入在第 ${index} 个采样包含非有限数值`);
      }
    }
  }
  return inputLength;
}

/** Previous deterministic browser path, retained only as an explicit fallback. */
function resampleChannelsWithSinc(
  channels: readonly Float32Array[],
  inputLength: number,
  outputLength: number,
): Float32Array[] {
  const sourceStep = inputLength / outputLength;
  const cutoff = Math.min(1, 1 / sourceStep);
  const radius = Math.min(Math.ceil(8 / cutoff), inputLength + 8);
  const output = channels.map(() => new Float32Array(outputLength));
  const sums = new Float64Array(channels.length);

  for (let outputIndex = 0; outputIndex < outputLength; outputIndex += 1) {
    const position = outputIndex * sourceStep;
    const first = Math.ceil(position - radius);
    const last = Math.floor(position + radius);
    let normalization = 0;
    sums.fill(0);
    for (let sourceIndex = first; sourceIndex <= last; sourceIndex += 1) {
      const offset = position - sourceIndex;
      const windowPosition = offset / radius;
      const blackman = 0.42
        + 0.5 * Math.cos(Math.PI * windowPosition)
        + 0.08 * Math.cos(2 * Math.PI * windowPosition);
      const x = offset * cutoff;
      const sinc = Math.abs(x) < 1e-12 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
      const weight = blackman * sinc;
      if (weight === 0) continue;
      normalization += weight;
      const clampedIndex = Math.max(0, Math.min(inputLength - 1, sourceIndex));
      for (let channelIndex = 0; channelIndex < channels.length; channelIndex += 1) {
        sums[channelIndex] += channels[channelIndex][clampedIndex] * weight;
      }
    }
    if (!Number.isFinite(normalization) || Math.abs(normalization) < 1e-12) {
      throw new Error(`Resample 在第 ${outputIndex} 个采样无法确定重采样权重`);
    }
    for (let channelIndex = 0; channelIndex < channels.length; channelIndex += 1) {
      const value = sums[channelIndex] / normalization;
      if (!Number.isFinite(value)) {
        throw new RangeError(`Resample 在第 ${outputIndex} 个采样产生非有限输出`);
      }
      output[channelIndex][outputIndex] = value;
    }
  }
  return output;
}

/**
 * Prefer the same libsoxr 0.1.3 algorithms and block protocol as Audacity.
 * If WASM cannot be loaded, retain the previous deterministic sinc path and
 * return an explicit warning so the UI never presents it as libsoxr output.
 */
export async function resampleChannelsDetailed(
  channels: readonly Float32Array[],
  fromRate: number,
  toRate: number,
  quality: HighQualitySampleRateConverter = DEFAULT_SAMPLE_RATE_CONVERTER,
): Promise<ResampleChannelsResult> {
  const inputLength = validateChannels(channels);
  if (!SAMPLE_RATE_CONVERTER_OPTIONS.some((option) => option.value === quality)) {
    throw new RangeError(`未知的采样率转换器质量：${quality}`);
  }
  const outputLength = getResampledLength(inputLength, fromRate, toRate);
  const totalOutput = outputLength * channels.length;
  if (
    !Number.isSafeInteger(totalOutput)
    || totalOutput > MAX_RESAMPLE_TOTAL_OUTPUT_SAMPLES
  ) {
    throw new RangeError('Resample 输出超过浏览器内存上限，请降低采样率或减少片段');
  }
  if (fromRate === toRate) {
    return { channels: channels.map((channel) => channel.slice()), backend: 'same-rate' };
  }

  const maximumOutputFramesPerChannel = Math.floor(MAX_RESAMPLE_TOTAL_OUTPUT_SAMPLES / channels.length);
  try {
    return {
      channels: await resampleChannelsWithSoxr(
        channels,
        fromRate,
        toRate,
        quality,
        maximumOutputFramesPerChannel,
      ),
      backend: 'libsoxr-wasm',
    };
  } catch (error) {
    const warning = `${SOXR_FALLBACK_WARNING} 原因：${error instanceof Error ? error.message : String(error)}`;
    console.warn(warning, error);
    return {
      channels: resampleChannelsWithSinc(channels, inputLength, outputLength),
      backend: 'typescript-fallback',
      warning,
    };
  }
}

export async function resampleChannels(
  channels: readonly Float32Array[],
  fromRate: number,
  toRate: number,
  quality: HighQualitySampleRateConverter = DEFAULT_SAMPLE_RATE_CONVERTER,
): Promise<Float32Array[]> {
  return (await resampleChannelsDetailed(channels, fromRate, toRate, quality)).channels;
}
