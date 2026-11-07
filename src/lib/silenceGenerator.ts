import { getClipStretchRatio } from '@/lib/clipEditing';
import type { IClip } from '@/types/project';

export interface SilenceSettings {
  duration: number;
  sampleRate: number;
}

function getSampleLength(duration: number, sampleRate: number): number {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new RangeError('Sample rate must be greater than zero');
  }
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new RangeError('Duration must be greater than zero');
  }
  const length = Math.round(duration * sampleRate);
  if (!Number.isSafeInteger(length) || length < 1) {
    throw new RangeError('Duration must produce at least one sample');
  }
  return length;
}

/** Audacity SilenceBase generates audio of zero amplitude. */
export function generateSilence({ duration, sampleRate }: SilenceSettings): Float32Array {
  return new Float32Array(getSampleLength(duration, sampleRate));
}

/**
 * Silence Audio semantics: replace the selected source samples with zeroes
 * without changing clip timing or mutating a buffer shared by other clips.
 * Returns null when the selection does not overlap any source samples.
 */
export function silenceClipSelection(
  channelData: Float32Array[],
  clip: IClip,
  selection: { start: number; end: number },
  sampleRate: number,
): Float32Array[] | null {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new RangeError('Sample rate must be greater than zero');
  }
  if (channelData.length === 0) throw new RangeError('Clip has no audio channels');
  if (
    !Number.isFinite(selection.start)
    || !Number.isFinite(selection.end)
    || selection.end <= selection.start
  ) return null;

  const overlapStart = Math.max(selection.start, clip.startTime);
  const overlapEnd = Math.min(selection.end, clip.startTime + clip.duration);
  if (overlapEnd <= overlapStart) return null;

  const ratio = getClipStretchRatio(clip);
  const sourceStart = clip.offset + (overlapStart - clip.startTime) * ratio;
  const sourceEnd = clip.offset + (overlapEnd - clip.startTime) * ratio;
  const output = channelData.map((channel) => new Float32Array(channel));
  let didOverlapSamples = false;

  output.forEach((channel) => {
    const startIndex = Math.max(0, Math.floor(sourceStart * sampleRate));
    const endIndex = Math.min(channel.length, Math.ceil(sourceEnd * sampleRate));
    if (endIndex > startIndex) {
      channel.fill(0, startIndex, endIndex);
      didOverlapSamples = true;
    }
  });

  return didOverlapSamples ? output : null;
}
