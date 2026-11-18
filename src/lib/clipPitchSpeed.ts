import type { IClip, IProject } from '@/types/project';
import { clamp } from '@/lib/audioUtils';
import { getClipStretchRatio, type ClipKey } from '@/lib/clipEditing';
import { processChangeSpeedChannels } from '@/lib/changeSpeedEffect';
import { timeStretchChannelsJs } from '@/engine/timeStretch';
import { wasmProcessor } from '@/wasm/processor';

// Audacity 4.0.2 PitchSection.qml / SpeedSection.qml and ClipSegment.cpp.
export const MIN_CLIP_PITCH_CENTS = -1200;
export const MAX_CLIP_PITCH_CENTS = 1200;
export const MIN_CLIP_SPEED_PERCENT = 1;
export const MAX_CLIP_SPEED_PERCENT = 1000;
export const MIN_CLIP_STRETCH_RATIO = MIN_CLIP_SPEED_PERCENT / 100;
export const MAX_CLIP_STRETCH_RATIO = MAX_CLIP_SPEED_PERCENT / 100;

export interface ClipPitchAndSpeedSettings {
  pitchCents: number;
  speedPercentage: number;
  optimizeForVoice: boolean;
}

export function normalizeClipPitchCents(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric)
    ? clamp(Math.round(numeric), MIN_CLIP_PITCH_CENTS, MAX_CLIP_PITCH_CENTS)
    : 0;
}

export function getClipPitchCents(clip: IClip): number {
  return normalizeClipPitchCents(clip.pitchCents ?? 0);
}

export function normalizeClipSpeedPercentage(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 100;
  return clamp(
    Math.round(numeric * 1000) / 1000,
    MIN_CLIP_SPEED_PERCENT,
    MAX_CLIP_SPEED_PERCENT,
  );
}

export function getClipSpeedPercentage(clip: IClip): number {
  // IClip stores source seconds / timeline seconds; AU4 exposes the reciprocal timeRatio.
  return normalizeClipSpeedPercentage(100 * getClipStretchRatio(clip));
}

export function getClipOptimizeForVoice(clip: IClip): boolean {
  return clip.optimizeForVoice === true;
}

export function splitClipPitchCents(value: number): { semitones: number; cents: number } {
  const total = normalizeClipPitchCents(value);
  const semitones = Math.trunc(total / 100);
  return { semitones, cents: total - semitones * 100 };
}

export function composeClipPitchCents(semitones: number, cents: number): number {
  const safeSemitones = Number.isFinite(semitones) ? Math.trunc(semitones) : 0;
  const safeCents = Number.isFinite(cents) ? Math.trunc(cents) : 0;
  return normalizeClipPitchCents(safeSemitones * 100 + safeCents);
}

export function getClipPitchAndSpeedSettings(clip: IClip): ClipPitchAndSpeedSettings {
  return {
    pitchCents: getClipPitchCents(clip),
    speedPercentage: getClipSpeedPercentage(clip),
    optimizeForVoice: getClipOptimizeForVoice(clip),
  };
}

/** Preserve the visible source interval, as TimeStretching::SetClipStretchRatio does. */
export function applyClipPitchAndSpeed(
  project: IProject,
  key: ClipKey,
  settings: ClipPitchAndSpeedSettings,
): IProject {
  const pitchCents = normalizeClipPitchCents(settings.pitchCents);
  const speedPercentage = normalizeClipSpeedPercentage(settings.speedPercentage);
  const nextRatio = speedPercentage / 100;
  let found = false;
  const tracks = project.tracks.map((track) => {
    if (track.id !== key.trackId) return track;
    let trackChanged = false;
    const clips = track.clips.map((clip) => {
      if (clip.id !== key.clipId) return clip;
      found = true;
      const sourceDuration = clip.duration * getClipStretchRatio(clip);
      const duration = sourceDuration / nextRatio;
      if (!Number.isFinite(duration) || duration <= 0) {
        throw new RangeError('片段速度产生了无效时长');
      }
      const nextClip: IClip = {
        ...clip,
        duration,
        stretchRatio: nextRatio,
        pitchCents,
        optimizeForVoice: settings.optimizeForVoice === true,
      };
      if (
        nextClip.duration !== clip.duration
        || nextClip.stretchRatio !== clip.stretchRatio
        || getClipPitchCents(clip) !== pitchCents
        || getClipOptimizeForVoice(clip) !== nextClip.optimizeForVoice
      ) trackChanged = true;
      return nextClip;
    });
    return trackChanged ? { ...track, clips } : track;
  });
  if (!found) throw new RangeError('要调整的片段已不存在');
  return tracks.some((track, index) => track !== project.tracks[index])
    ? { ...project, tracks }
    : project;
}

const VOICE_TIME_STRETCH_OPTIONS = Object.freeze({
  windowSize: 8192,
  searchRadius: 2048,
});

/**
 * Non-destructive clip rendering. Pitch uses the project's deterministic
 * band-limited resampling + WSOLA path; voice mode uses longer, smoother
 * analysis windows as a browser approximation of Audacity's formant preset.
 */
export function processClipPitchAndSpeedChannels(
  clip: IClip,
  channels: readonly Float32Array[],
  sampleRate: number,
): Float32Array[] {
  if (channels.length === 0) throw new RangeError('至少需要一个音频声道');
  const pitchCents = getClipPitchCents(clip);
  const optimizeForVoice = getClipOptimizeForVoice(clip);
  const pitchRatio = 2 ** (pitchCents / 1200);
  let processed: Float32Array[] = channels.map((channel) => channel.slice());

  if (pitchRatio !== 1) {
    const resampled = processChangeSpeedChannels(
      processed,
      { percentChange: (pitchRatio - 1) * 100 },
      sampleRate,
    );
    processed = timeStretchChannelsJs(
      resampled,
      1 / pitchRatio,
      sampleRate,
      optimizeForVoice ? VOICE_TIME_STRETCH_OPTIONS : undefined,
    );
  }

  const stretchRatio = getClipStretchRatio(clip);
  if (stretchRatio !== 1) {
    processed = optimizeForVoice
      ? timeStretchChannelsJs(processed, stretchRatio, sampleRate, VOICE_TIME_STRETCH_OPTIONS)
      : wasmProcessor.timeStretch(processed, stretchRatio, sampleRate);
  }
  return processed;
}
