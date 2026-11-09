import { getClipStretchRatio } from '@/lib/clipEditing';
import type { IClip, ITrack } from '@/types/project';

export interface GeneratorSelection {
  start: number;
  end: number;
  /** Nyquist generators may replace a selection with their chosen duration. */
  allowDurationChange?: boolean;
}

/**
 * Resolve Audacity-style generation targets in project track order.
 * Clip selections are this editor's multi-track selection surface; without
 * one, retain the legacy active-track then first-track fallback.
 */
export function resolveGeneratorTrackIds(
  tracks: readonly Pick<ITrack, 'id'>[],
  selectedTrackId: string | null,
  selectedClips: readonly { trackId: string }[],
): string[] {
  const explicitlySelected = new Set(selectedClips.map(({ trackId }) => trackId));
  const selected = tracks
    .filter(({ id }) => explicitlySelected.has(id))
    .map(({ id }) => id);
  if (selected.length > 0) return selected;
  if (selectedTrackId && tracks.some(({ id }) => id === selectedTrackId)) {
    return [selectedTrackId];
  }
  return tracks[0] ? [tracks[0].id] : [];
}

export function getClipSampleRange(
  clip: Pick<IClip, 'startTime' | 'duration'>,
  selection: GeneratorSelection,
  sourceOffset: number,
  sampleRate: number,
  channelLength: number,
): { startSample: number; endSample: number } | null {
  if (!Number.isFinite(sourceOffset) || sourceOffset < 0) {
    throw new RangeError('片段源偏移必须是非负有限时间');
  }
  const overlapStart = Math.max(clip.startTime, selection.start);
  const overlapEnd = Math.min(clip.startTime + clip.duration, selection.end);
  if (overlapEnd <= overlapStart) return null;
  const offsetInClip = overlapStart - clip.startTime + sourceOffset;
  const startSample = Math.max(0, Math.floor(offsetInClip * sampleRate));
  const endSample = Math.min(
    channelLength,
    Math.floor((offsetInClip + overlapEnd - overlapStart) * sampleRate),
  );
  return endSample > startSample ? { startSample, endSample } : null;
}

/** Match Audacity's sample-based selection boundaries and exact Duration display. */
export function quantizeSelectionToSamples(
  selection: GeneratorSelection | null,
  sampleRate: number,
): GeneratorSelection | null {
  if (
    !selection
    || !Number.isFinite(sampleRate)
    || sampleRate <= 0
    || !Number.isFinite(selection.start)
    || !Number.isFinite(selection.end)
  ) return null;

  const startSample = Math.round(selection.start * sampleRate);
  const endSample = Math.round(selection.end * sampleRate);
  if (startSample < 0 || endSample <= startSample) return null;
  return { start: startSample / sampleRate, end: endSample / sampleRate };
}

/**
 * Replace a track's selected timeline range with one generated clip.
 * Unaffected clip edges remain non-destructive, including stretched source offsets.
 */
export function replaceTrackSelectionWithClip(
  track: ITrack,
  selection: GeneratorSelection,
  generatedClip: IClip,
  createId: () => string,
): ITrack {
  if (
    !Number.isFinite(selection.start)
    || !Number.isFinite(selection.end)
    || selection.start < 0
    || selection.end <= selection.start
  ) throw new RangeError('Generator replacement requires a positive selection');
  if (!Number.isFinite(generatedClip.duration) || generatedClip.duration <= 0) {
    throw new RangeError('Generated clip must have a positive finite duration');
  }
  if (Math.abs(generatedClip.startTime - selection.start) > 1e-9) {
    throw new RangeError('Generated clip must start at the selection');
  }
  if (
    !selection.allowDurationChange
    && Math.abs(generatedClip.duration - (selection.end - selection.start)) > 1e-9
  ) throw new RangeError('Generated clip must exactly cover the selection');

  const timelineDelta = selection.allowDurationChange
    ? generatedClip.duration - (selection.end - selection.start)
    : 0;
  const clips = track.clips.flatMap((clip): IClip[] => {
    const clipEnd = clip.startTime + clip.duration;
    if (clipEnd <= selection.start) return [clip];
    if (clip.startTime >= selection.end) {
      return timelineDelta === 0
        ? [clip]
        : [{ ...clip, startTime: clip.startTime + timelineDelta }];
    }

    const ratio = getClipStretchRatio(clip);
    const leftDuration = Math.max(0, Math.min(clipEnd, selection.start) - clip.startTime);
    const rightStart = Math.max(clip.startTime, selection.end);
    const rightDuration = Math.max(0, clipEnd - rightStart);
    const result: IClip[] = [];

    if (leftDuration > 0) {
      result.push({
        ...clip,
        duration: leftDuration,
        fadeOut: 0,
      });
    }
    if (rightDuration > 0) {
      result.push({
        ...clip,
        id: leftDuration > 0 ? createId() : clip.id,
        startTime: rightStart + timelineDelta,
        offset: clip.offset + (rightStart - clip.startTime) * ratio,
        duration: rightDuration,
        fadeIn: 0,
      });
    }
    return result;
  });

  clips.push(generatedClip);
  clips.sort((a, b) => a.startTime - b.startTime);
  return { ...track, clips };
}
