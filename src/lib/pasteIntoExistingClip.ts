import { dbToGain } from '@/lib/audioUtils';
import { pasteClipIntoTrack } from '@/lib/selectionPaste';
import type { IClip, ITrack } from '@/types/project';

/** WaveClip::WithinPlayRegion: start is inclusive and end is exclusive. */
export function findClipAtTime(track: ITrack, time: number): IClip | null {
  if (!Number.isFinite(time)) return null;
  return [...track.clips]
    .sort((left, right) => right.startTime - left.startTime || right.id.localeCompare(left.id))
    .find((clip) => clip.startTime <= time && time < clip.startTime + clip.duration) ?? null;
}

function validateChannels(channels: readonly Float32Array[], label: string): number {
  if (channels.length === 0 || channels[0]!.length === 0) throw new RangeError(`${label} must not be empty`);
  const length = channels[0]!.length;
  if (channels.some((channel) => channel.length !== length)) {
    throw new RangeError(`${label} channels must have equal lengths`);
  }
  return length;
}

/** Match Audacity's mono-to-stereo duplication and stereo-to-mono downmix targets. */
export function matchPastedChannelCount(
  channels: readonly Float32Array[],
  targetChannelCount: number,
): Float32Array[] {
  const length = validateChannels(channels, 'Pasted audio');
  if (!Number.isInteger(targetChannelCount) || targetChannelCount < 1) {
    throw new RangeError('Target channel count must be positive');
  }
  if (channels.length === targetChannelCount) return channels.map((channel) => channel.slice());
  if (channels.length === 1) {
    return Array.from({ length: targetChannelCount }, () => channels[0]!.slice());
  }
  if (targetChannelCount === 1) {
    const mono = new Float32Array(length);
    for (const channel of channels) {
      for (let frame = 0; frame < length; frame += 1) mono[frame] += channel[frame]! / channels.length;
    }
    return [mono];
  }
  throw new RangeError('Only mono duplication or downmix to mono is supported for mismatched channels');
}

export interface MergeClipPcmInput {
  clip: IClip;
  /** Full effective source after pitch/speed processing, at the project sample rate. */
  existingChannels: readonly Float32Array[];
  /** Visible window start inside existingChannels, in seconds. */
  sourceOffset: number;
  /** Clipboard PCM already resampled to the project sample rate. */
  pastedChannels: readonly Float32Array[];
  pasteTime: number;
  sampleRate: number;
}

/**
 * Insert clipboard PCM into an existing clip and return one normalized clip.
 * Existing gain/fades are baked only into the old audio, so pasted samples are
 * not amplified or faded a second time. The original buffer is left untouched.
 */
export function mergeClipboardPcmIntoClip({
  clip,
  existingChannels,
  sourceOffset,
  pastedChannels,
  pasteTime,
  sampleRate,
}: MergeClipPcmInput): { clip: IClip; channels: Float32Array[] } {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) throw new RangeError('Invalid project sample rate');
  if (!Number.isFinite(sourceOffset) || sourceOffset < 0) throw new RangeError('Invalid effective source offset');
  if (!Number.isFinite(pasteTime) || pasteTime < clip.startTime || pasteTime >= clip.startTime + clip.duration) {
    throw new RangeError('Paste position must be inside the existing clip');
  }
  const existingLength = validateChannels(existingChannels, 'Existing audio');
  validateChannels(pastedChannels, 'Pasted audio');
  const insertionFrame = Math.round((sourceOffset + pasteTime - clip.startTime) * sampleRate);
  if (insertionFrame < 0 || insertionFrame > existingLength) {
    throw new RangeError('Paste position exceeds the effective source buffer');
  }
  const pasted = matchPastedChannelCount(pastedChannels, existingChannels.length);
  const pastedFrames = pasted[0]!.length;
  const clipGain = dbToGain(clip.gain);

  const channels = existingChannels.map((source, channelIndex) => {
    const renderedExisting = new Float32Array(source.length);
    for (let frame = 0; frame < source.length; frame += 1) {
      const positionInClip = frame / sampleRate - sourceOffset;
      let fadeGain = 1;
      if (clip.fadeIn > 0 && positionInClip >= 0 && positionInClip < clip.fadeIn) {
        fadeGain = positionInClip / clip.fadeIn;
      }
      if (clip.fadeOut > 0 && positionInClip > clip.duration - clip.fadeOut && positionInClip <= clip.duration) {
        fadeGain = Math.min(fadeGain, Math.max(0, (clip.duration - positionInClip) / clip.fadeOut));
      }
      renderedExisting[frame] = source[frame]! * clipGain * fadeGain;
    }
    const merged = new Float32Array(existingLength + pastedFrames);
    merged.set(renderedExisting.subarray(0, insertionFrame), 0);
    merged.set(pasted[channelIndex]!, insertionFrame);
    merged.set(renderedExisting.subarray(insertionFrame), insertionFrame + pastedFrames);
    return merged;
  });

  const pastedDuration = pastedFrames / sampleRate;
  return {
    channels,
    clip: {
      ...clip,
      offset: sourceOffset,
      duration: clip.duration + pastedDuration,
      originalDuration: channels[0]!.length / sampleRate,
      stretchRatio: 1,
      pitchCents: 0,
      optimizeForVoice: false,
      stretchToMatchTempo: false,
      gain: 0,
      fadeIn: 0,
      fadeOut: 0,
    },
  };
}

/** Make room for the expanded clip without leaving a placeholder or overlaps. */
export function replaceTrackWithMergedClip(
  track: ITrack,
  originalClip: IClip,
  mergedClip: IClip,
  mode: 'overlap' | 'insert',
  createId: () => string,
): ITrack {
  const expansion = mergedClip.duration - originalClip.duration;
  if (!(expansion > 0) || mergedClip.id !== originalClip.id) throw new RangeError('Invalid merged clip expansion');
  const originalEnd = originalClip.startTime + originalClip.duration;
  const placeholderId = createId();
  const roomClip: IClip = {
    ...mergedClip,
    id: placeholderId,
    startTime: originalEnd,
    offset: 0,
    duration: expansion,
    originalDuration: expansion,
  };
  const withRoom = pasteClipIntoTrack(track, roomClip, mode, createId);
  const clips = withRoom.clips.flatMap((clip) => {
    if (clip.id === placeholderId) return [];
    return [clip.id === originalClip.id ? mergedClip : clip];
  });
  return {
    ...withRoom,
    clips: clips.sort((left, right) => left.startTime - right.startTime || left.id.localeCompare(right.id)),
  };
}
