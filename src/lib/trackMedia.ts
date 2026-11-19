import type { IClip } from '@/types/project';
import type { TrackSampleFormat } from '@/types/project';
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

// Audacity Dither.cpp uses full-scale signed integers and the default
// round-to-nearest, ties-to-even mode. Browser storage remains Float32Array;
// narrowing formats therefore quantize the stored values without claiming to
// reproduce Audacity's optional shaped dither preference.
function roundToNearestEven(value: number): number {
  const lower = Math.floor(value);
  const fraction = value - lower;
  if (fraction < 0.5) return lower;
  if (fraction > 0.5) return lower + 1;
  return lower % 2 === 0 ? lower : lower + 1;
}

function quantizeSample(sample: number, bits: 16 | 24): number {
  if (!Number.isFinite(sample)) throw new RangeError('采样格式转换拒绝非有限采样值');
  const scale = bits === 16 ? 32768 : 8388608;
  const maximum = scale - 1;
  const minimum = -scale;
  const clipped = Math.max(-1, Math.min(1, sample));
  const integer = Math.max(minimum, Math.min(maximum, roundToNearestEven(clipped * scale)));
  return integer / scale;
}

/** Convert complete channels, returning independent PCM even for float32. */
export function convertTrackSampleFormatChannels(
  channels: readonly Float32Array[],
  format: TrackSampleFormat,
): Float32Array[] {
  assertTrackSampleFormat(format);
  if (channels.length === 0) throw new RangeError('采样格式转换至少需要一个声道');
  const length = channels[0]?.length ?? 0;
  if (channels.some((channel) => channel.length !== length)) {
    throw new RangeError('采样格式转换要求所有声道等长');
  }
  return channels.map((channel) => {
    const output = new Float32Array(length);
    for (let index = 0; index < length; index += 1) {
      const sample = channel[index];
      if (!Number.isFinite(sample)) throw new RangeError(`第 ${index} 个采样不是有限数值`);
      output[index] = format === 'float32'
        ? sample
        : quantizeSample(sample, format === 'int16' ? 16 : 24);
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
