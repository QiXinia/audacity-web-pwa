import type { IClip, ITrack } from '@/types/project';
import { getClipStretchRatio } from '@/lib/clipEditing';

function equalTrim(left: number, right: number): boolean {
  return Math.abs(left - right) <= Number.EPSILON * Math.max(Math.abs(left), Math.abs(right), 1);
}

function equalPitchAndSpeed(left: IClip, right: IClip): boolean {
  return getClipStretchRatio(left) === getClipStretchRatio(right)
    && (left.pitchCents ?? 0) === (right.pitchCents ?? 0)
    && (left.optimizeForVoice ?? false) === (right.optimizeForVoice ?? false)
    && (left.stretchToMatchTempo ?? true) === (right.stretchToMatchTempo ?? true)
    && left.rawAudioTempo === right.rawAudioTempo
    && left.clipTempo === right.clipTempo;
}

/**
 * Audacity 4 canMergeMonoTracksToStereo: mismatched positions, trims,
 * pitch/speed, or realtime effects require the official render warning.
 */
export function needsMakeStereoRenderWarning(
  left: ITrack,
  right: ITrack,
  sampleRate: number,
): boolean {
  if (left.effects.length > 0 || right.effects.length > 0) return true;
  const epsilon = 0.5 / sampleRate;
  return left.clips.some((leftClip) => !right.clips.some((rightClip) => (
    Math.abs(leftClip.startTime - rightClip.startTime) < epsilon
    && Math.abs(
      (leftClip.startTime + leftClip.duration) - (rightClip.startTime + rightClip.duration),
    ) < epsilon
    && equalTrim(leftClip.offset, rightClip.offset)
    && equalTrim(leftClip.originalDuration, rightClip.originalDuration)
    && equalPitchAndSpeed(leftClip, rightClip)
  )));
}
