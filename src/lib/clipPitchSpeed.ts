import type { IClip, IProject } from '@/types/project';
import { clamp } from '@/lib/audioUtils';
import { getClipStretchRatio, type ClipKey } from '@/lib/clipEditing';
import { processChangeSpeedChannels } from '@/lib/changeSpeedEffect';
import { timeStretchChannelsJs, type TimeStretchOptions } from '@/engine/timeStretch';
import { wasmProcessor } from '@/wasm/processor';
import { processStaffPadTimeAndPitchChannels } from '@/lib/staffPadTimeAndPitch';

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
  if (!Number.isFinite(numeric)) return 100;
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

/**
 * Audacity 4.0.2 StaffPadTimeAndPitch.cpp GetFftSize.
 * C++ std::round rounds halfway cases away from zero, unlike Math.round for
 * negative values, so keep that boundary behavior explicit.
 */
export function getAudacityTimeAndPitchFftSize(
  sampleRate: number,
  preserveFormants: boolean,
): number {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new RangeError('采样率必须是有限的正数');
  }
  const octaveOffset = Math.log2(sampleRate / 44100);
  const roundedOffset = Math.sign(octaveOffset) * Math.floor(Math.abs(octaveOffset) + 0.5);
  const fftSize = 2 ** ((preserveFormants ? 11 : 12) + roundedOffset);
  if (!Number.isSafeInteger(fftSize) || fftSize < 64) {
    throw new RangeError('采样率超出了音高与速度分析窗的有效范围');
  }
  return fftSize;
}

export function getClipPitchTimeStretchOptions(
  sampleRate: number,
  optimizeForVoice: boolean,
): TimeStretchOptions {
  const windowSize = getAudacityTimeAndPitchFftSize(sampleRate, optimizeForVoice);
  return optimizeForVoice
    ? { windowSize, searchRadius: windowSize / 4 }
    : { windowSize };
}

/**
 * Non-destructive clip rendering. Voice mode uses the browser StaffPad port,
 * including its phase-locked vocoder and cepstral FormantShifter. The normal
 * path keeps the existing resample-plus-stretch implementation with Audacity's
 * sample-rate-dependent analysis window.
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
  const stretchRatio = getClipStretchRatio(clip);

  if (optimizeForVoice) {
    return processStaffPadTimeAndPitchChannels(channels, {
      sampleRate,
      // IClip stores source seconds / timeline seconds; StaffPad uses its reciprocal.
      timeRatio: 1 / stretchRatio,
      pitchRatio,
      preserveFormants: true,
      fftSize: getAudacityTimeAndPitchFftSize(sampleRate, true),
    });
  }

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
      getClipPitchTimeStretchOptions(sampleRate, optimizeForVoice),
    );
  }

  if (stretchRatio !== 1) {
    processed = wasmProcessor.timeStretch(processed, stretchRatio, sampleRate);
  }
  return processed;
}

/** Audacity enables Render/Reset only when pitch or speed actually differs. */
export function hasClipPitchOrSpeed(clip: IClip): boolean {
  return getClipPitchCents(clip) !== 0 || Math.abs(getClipStretchRatio(clip) - 1) > 1e-9;
}

/**
 * Bake the visible play region into independent PCM. As in Audacity 4.0.2
 * GetRenderedCopy, up to one second of raw, unstretched source context on
 * either side lets the stretcher reach a steady state before the visible boundaries.
 */
export function renderClipPitchAndSpeedChannels(
  clip: IClip,
  channels: readonly Float32Array[],
  sampleRate: number,
): Float32Array[] {
  if (!hasClipPitchOrSpeed(clip)) {
    throw new RangeError('片段没有可渲染的音高或速度调整');
  }
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new RangeError('采样率必须是有限的正数');
  }
  if (!Number.isFinite(clip.offset) || clip.offset < 0 || !Number.isFinite(clip.duration) || clip.duration <= 0) {
    throw new RangeError('片段播放区间无效');
  }
  if (
    channels.length === 0
    || channels[0].length === 0
    || channels.some((channel) => channel.length !== channels[0].length)
  ) {
    throw new RangeError('音频声道必须非空且长度一致');
  }

  const sourceLength = channels[0].length;
  const sourceDuration = sourceLength / sampleRate;
  if (clip.offset >= sourceDuration) throw new RangeError('片段起点超出源音频');
  const ratio = getClipStretchRatio(clip);
  const visibleStart = Math.max(0, Math.round(clip.offset * sampleRate));
  const visibleEnd = Math.min(
    sourceLength,
    Math.max(visibleStart + 1, Math.round((clip.offset + clip.duration * ratio) * sampleRate)),
  );
  if (visibleEnd <= visibleStart) throw new RangeError('片段没有可渲染的源音频');

  // GetRenderedCopy retains one second of raw, unstretched source on each side.
  // That source context is independent of the speed ratio: the official code
  // extends the timeline by its stretchRatio, which cancels again when the
  // ClipTimeAndPitchSource maps the interval back to raw samples.
  const contextSamples = sampleRate;
  const contextStart = Math.max(0, visibleStart - contextSamples);
  const contextEnd = Math.min(sourceLength, visibleEnd + contextSamples);
  const processed = processClipPitchAndSpeedChannels(
    clip,
    channels.map((channel) => channel.slice(contextStart, contextEnd)),
    sampleRate,
  );

  const leadingOutputFrames = Math.max(0, Math.round((visibleStart - contextStart) / ratio));
  const outputFrames = Math.max(1, Math.round(clip.duration * sampleRate));
  const toleratedShortfall = Math.max(2, Math.ceil(sampleRate / 1000));
  return processed.map((channel) => {
    const available = channel.length - leadingOutputFrames;
    if (available <= 0) throw new Error('音高与速度渲染没有产生可见播放区间');
    const copyLength = Math.min(outputFrames, available);
    if (outputFrames - copyLength > toleratedShortfall) {
      throw new Error('音高与速度渲染的输出长度不足');
    }
    const rendered = new Float32Array(outputFrames);
    rendered.set(channel.subarray(leadingOutputFrames, leadingOutputFrames + copyLength));
    return rendered;
  });
}

/** Replace only the target clip; old/new buffers both remain available to history. */
export function replaceClipWithRenderedPitchAndSpeed(
  project: IProject,
  key: ClipKey,
  audioBufferId: string,
  renderedDuration: number,
): IProject {
  if (!audioBufferId) throw new RangeError('渲染音频 buffer 不能为空');
  if (!Number.isFinite(renderedDuration) || renderedDuration <= 0) {
    throw new RangeError('渲染音频时长必须是有限的正数');
  }
  let found = false;
  const tracks = project.tracks.map((track) => {
    if (track.id !== key.trackId) return track;
    let changed = false;
    const clips = track.clips.map((clip) => {
      if (clip.id !== key.clipId) return clip;
      found = true;
      if (!hasClipPitchOrSpeed(clip)) {
        throw new RangeError('片段没有可渲染的音高或速度调整');
      }
      changed = true;
      return {
        ...clip,
        audioBufferId,
        offset: 0,
        duration: renderedDuration,
        originalDuration: renderedDuration,
        stretchRatio: 1,
        pitchCents: 0,
        optimizeForVoice: false,
      };
    });
    return changed ? { ...track, clips } : track;
  });
  if (!found) throw new RangeError('要渲染的片段已不存在');
  return { ...project, tracks };
}
