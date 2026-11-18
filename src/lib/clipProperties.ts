import type { IClip } from '@/types/project';
import { getClipStretchRatio } from '@/lib/clipEditing';
import { getClipPitchCents, getClipSpeedPercentage } from '@/lib/clipPitchSpeed';

export interface ClipTimeMapping {
  timelineStart: number;
  timelineEnd: number;
  timelineDuration: number;
  sourceStart: number;
  sourceEnd: number;
  sourceDuration: number;
  stretchRatio: number;
  speedPercentage: number;
}

/** Audacity stores clip trimming in source time and stretching on the timeline. */
export function getClipTimeMapping(clip: IClip): ClipTimeMapping {
  const stretchRatio = getClipStretchRatio(clip);
  const sourceDuration = clip.duration * stretchRatio;
  return {
    timelineStart: clip.startTime,
    timelineEnd: clip.startTime + clip.duration,
    timelineDuration: clip.duration,
    sourceStart: clip.offset,
    sourceEnd: clip.offset + sourceDuration,
    sourceDuration,
    stretchRatio,
    speedPercentage: getClipSpeedPercentage(clip),
  };
}

export function formatClipPropertyTime(seconds: number): string {
  return Number.isFinite(seconds) && seconds >= 0 ? `${seconds.toFixed(6)} s` : '—';
}

export function formatClipPitchCents(clip: IClip): string {
  const total = getClipPitchCents(clip);
  if (total === 0) return '0 cents';
  const semitones = Math.trunc(total / 100);
  const cents = total - semitones * 100;
  const parts: string[] = [];
  if (semitones !== 0) parts.push(`${semitones > 0 ? '+' : ''}${semitones} semitones`);
  if (cents !== 0) parts.push(`${cents > 0 ? '+' : ''}${cents} cents`);
  return `${parts.join(' ')} (${total > 0 ? '+' : ''}${total} cents total)`;
}
