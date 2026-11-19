import type { DitherType, IClip, TrackSampleFormat } from '@/types/project';
import { createGlibcRandom, GLIBC_RAND_MAX } from '@/lib/glibcRandom';
import { validateResampleRate } from '@/lib/resampleEffect';

export const TRACK_SAMPLE_FORMATS = Object.freeze([
  { value: 'int16', label: '16-bit PCM' },
  { value: 'int24', label: '24-bit PCM' },
  { value: 'float32', label: '32-bit Float' },
] as const satisfies readonly { value: TrackSampleFormat; label: string }[]);

export function getTrackSampleFormatLabel(format: TrackSampleFormat | undefined): string {
  return TRACK_SAMPLE_FORMATS.find((candidate) => candidate.value === (format ?? 'float32'))?.label
    ?? '32-bit Float';
}

export function assertTrackSampleFormat(format: string): asserts format is TrackSampleFormat {
  if (!TRACK_SAMPLE_FORMATS.some((candidate) => candidate.value === format)) {
    throw new RangeError(`不支持的轨道采样格式：${format}`);
  }
}

export const TRACK_DITHER_TYPES = Object.freeze([
  { value: 'none', label: 'None' },
  { value: 'rectangle', label: 'Rectangle' },
  { value: 'triangle', label: 'Triangle' },
  { value: 'shaped', label: 'Shaped' },
] as const satisfies readonly { value: DitherType; label: string }[]);

export function assertDitherType(value: string): asserts value is DitherType {
  if (!TRACK_DITHER_TYPES.some((candidate) => candidate.value === value)) {
    throw new RangeError(`不支持的 dither 类型：${value}`);
  }
}

/** Sequence::ConvertToSampleFormat only dithers when the target is narrower. */
export function shouldUseHighQualityDither(
  sourceFormat: TrackSampleFormat,
  destinationFormat: TrackSampleFormat,
): boolean {
  const bytes: Record<TrackSampleFormat, number> = { int16: 2, int24: 3, float32: 4 };
  return bytes[destinationFormat] < bytes[sourceFormat];
}

// Audacity Dither.cpp performs these operations as float. Explicit fround at
// every arithmetic step keeps the browser oracle aligned with the C++ code.
const f32 = Math.fround;
const SHAPED_BS = Float32Array.from([2.033, -2.165, 1.959, -1.590, 0.6149]);

function roundToNearestEven(value: number): number {
  const lower = Math.floor(value);
  const fraction = value - lower;
  if (fraction < 0.5) return lower;
  if (fraction > 0.5) return lower + 1;
  return lower % 2 === 0 ? lower : lower + 1;
}

interface DitherState {
  phase: number;
  triangle: number;
  buffer: Float32Array;
}

function createDitherState(): DitherState {
  return { phase: 0, triangle: 0, buffer: new Float32Array(8) };
}

function ditherNoise(random: () => number): number {
  // C++ converts both rand() and RAND_MAX to float before dividing.
  const randomFloat = f32(random());
  const randMaxFloat = f32(GLIBC_RAND_MAX);
  return f32(f32(randomFloat / randMaxFloat) - 0.5);
}

function applyDither(
  type: DitherType,
  state: DitherState,
  sample: number,
  random: () => number,
): number {
  if (type === 'none') return sample;
  if (type === 'rectangle') return f32(sample - ditherNoise(random));
  if (type === 'triangle') {
    const noise = ditherNoise(random);
    const result = f32(f32(sample + noise) - state.triangle);
    state.triangle = noise;
    return result;
  }

  const noise = f32(ditherNoise(random) + ditherNoise(random));
  let xe = sample;
  for (let tap = 0; tap < SHAPED_BS.length; tap += 1) {
    const index = (state.phase - tap) & 7;
    xe = f32(xe + f32(state.buffer[index]! * SHAPED_BS[tap]!));
  }
  const result = f32(xe + noise);
  state.phase = (state.phase + 1) & 7;
  // lrintf(result) is converted back to float before the subtraction in C++.
  state.buffer[state.phase] = f32(xe - f32(roundToNearestEven(result)));
  return result;
}

function quantizeSample(
  sample: number,
  bits: 16 | 24,
  type: DitherType,
  state: DitherState,
  random: () => number,
): number {
  if (!Number.isFinite(sample)) throw new RangeError('采样格式转换拒绝非有限采样值');
  const scale = bits === 16 ? 32768 : 8388608;
  const maximum = scale - 1;
  const minimum = -scale;
  const clipped = f32(Math.max(-1, Math.min(1, sample)));
  const scaled = f32(clipped * scale);
  const dithered = applyDither(type, state, scaled, random);
  const integer = Math.max(minimum, Math.min(maximum, roundToNearestEven(dithered)));
  return integer / scale;
}

export interface TrackSampleFormatConversionOptions {
  ditherType?: DitherType;
  /** Deterministic injection for independent C++ oracle tests. */
  random?: () => number;
}

/** Convert complete channels; Triangle/Shaped state resets for each channel. */
export function convertTrackSampleFormatChannels(
  channels: readonly Float32Array[],
  format: TrackSampleFormat,
  options: TrackSampleFormatConversionOptions = {},
): Float32Array[] {
  assertTrackSampleFormat(format);
  const ditherType = options.ditherType ?? 'none';
  assertDitherType(ditherType);
  if (channels.length === 0) throw new RangeError('采样格式转换至少需要一个声道');
  const length = channels[0]?.length ?? 0;
  if (channels.some((channel) => channel.length !== length)) {
    throw new RangeError('采样格式转换要求所有声道等长');
  }
  const random = options.random ?? createGlibcRandom();
  return channels.map((channel) => {
    const output = new Float32Array(length);
    const state = createDitherState();
    for (let index = 0; index < length; index += 1) {
      const sample = channel[index];
      if (!Number.isFinite(sample)) throw new RangeError(`第 ${index} 个采样不是有限数值`);
      output[index] = format === 'float32'
        ? sample
        : quantizeSample(sample, format === 'int16' ? 16 : 24, ditherType, state, random);
    }
    return output;
  });
}

/**
 * Mirror WaveClip::SetRate: preserve source sample positions while changing
 * timeline seconds by oldRate/newRate. PCM samples are not resampled.
 * Browser-only fade durations follow the same timeline scale.
 */
export function scaleClipForTrackRate(
  clip: IClip,
  oldRate: number,
  newRate: number,
): IClip {
  validateResampleRate(oldRate);
  validateResampleRate(newRate);
  if (oldRate === newRate) return { ...clip };
  const ratio = oldRate / newRate;
  return {
    ...clip,
    startTime: clip.startTime * ratio,
    offset: clip.offset * ratio,
    duration: clip.duration * ratio,
    originalDuration: clip.originalDuration * ratio,
    fadeIn: (clip.fadeIn ?? 0) * ratio,
    fadeOut: (clip.fadeOut ?? 0) * ratio,
  };
}
