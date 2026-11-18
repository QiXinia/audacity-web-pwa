import { getClipStretchRatio, type ClipKey } from '@/lib/clipEditing';
import type { IClip, IProject } from '@/types/project';

/** Audacity WAVETRACK_MERGE_POINT_TOLERANCE. */
export const CLIP_SILENCE_MIN_SECONDS = 0.01;

export interface ClipSilenceRegion {
  /** Inclusive source-frame position. */
  startFrame: number;
  /** Exclusive source-frame position. */
  endFrame: number;
}

/**
 * Match WaveTrack::Disjoin: only exact zeroes present in every channel count.
 * The source's length+1 > minSamples condition is retained intentionally.
 */
export function findExactSilenceRegions(
  channels: readonly Float32Array[],
  startFrame: number,
  endFrame: number,
  minSilenceFrames: number,
): ClipSilenceRegion[] {
  if (channels.length === 0 || endFrame <= startFrame || minSilenceFrames < 1) return [];
  const regions: ClipSilenceRegion[] = [];
  let sequenceStart = -1;

  for (let frame = startFrame; frame < endFrame; frame += 1) {
    const allZeroes = channels.every((channel) => channel[frame] === 0);
    if (sequenceStart < 0 && allZeroes) {
      sequenceStart = frame;
    } else if (sequenceStart >= 0 && (frame === endFrame - 1 || !allZeroes)) {
      const sequenceEnd = frame === endFrame - 1 && allZeroes ? endFrame : frame;
      if (sequenceEnd - sequenceStart + 1 > minSilenceFrames) {
        regions.push({ startFrame: sequenceStart, endFrame: sequenceEnd });
      }
      sequenceStart = -1;
    }
  }
  return regions;
}

/**
 * Non-destructive equivalent of Disjoin + SplitDelete for one PWA clip.
 * Silent source regions are removed from the timeline; remaining clips share
 * the original PCM buffer and retain their stretch, pitch, tempo and metadata.
 */
export function splitClipAtSilences(
  project: IProject,
  key: ClipKey,
  channels: readonly Float32Array[],
  createId: () => string,
): { project: IProject; didChange: boolean; regions: ClipSilenceRegion[] } {
  const noChange = { project, didChange: false, regions: [] };
  if (
    channels.length === 0
    || !Number.isFinite(project.sampleRate)
    || project.sampleRate <= 0
  ) return noChange;

  const trackIndex = project.tracks.findIndex((track) => track.id === key.trackId);
  if (trackIndex < 0) return noChange;
  const clipIndex = project.tracks[trackIndex].clips.findIndex((clip) => clip.id === key.clipId);
  if (clipIndex < 0) return noChange;
  const clip = project.tracks[trackIndex].clips[clipIndex];
  const sourceLength = Math.min(...channels.map((channel) => channel.length));
  if (!Number.isFinite(sourceLength) || sourceLength <= 0) return noChange;

  const sampleRate = project.sampleRate;
  const ratio = getClipStretchRatio(clip);
  const visibleStart = Math.max(0, Math.min(sourceLength, Math.round(clip.offset * sampleRate)));
  const visibleEnd = Math.max(
    visibleStart,
    Math.min(sourceLength, Math.round((clip.offset + clip.duration * ratio) * sampleRate)),
  );
  if (visibleEnd <= visibleStart) return noChange;

  const minSilenceFrames = Math.max(1, Math.round(CLIP_SILENCE_MIN_SECONDS * sampleRate));
  const regions = findExactSilenceRegions(channels, visibleStart, visibleEnd, minSilenceFrames);
  if (regions.length === 0) return noChange;

  const clips: IClip[] = [];
  let segmentStart = visibleStart;
  const appendSegment = (segmentEnd: number) => {
    if (segmentEnd <= segmentStart) return;
    const keepsOriginalFadeIn = segmentStart === visibleStart;
    const keepsOriginalFadeOut = segmentEnd === visibleEnd;
    clips.push({
      ...clip,
      id: createId(),
      startTime: clip.startTime + (segmentStart - visibleStart) / sampleRate / ratio,
      offset: segmentStart / sampleRate,
      duration: (segmentEnd - segmentStart) / sampleRate / ratio,
      stretchRatio: ratio,
      fadeIn: keepsOriginalFadeIn ? clip.fadeIn : 0,
      fadeOut: keepsOriginalFadeOut ? clip.fadeOut : 0,
    });
  };

  for (const region of regions) {
    appendSegment(region.startFrame);
    segmentStart = Math.max(segmentStart, region.endFrame);
  }
  appendSegment(visibleEnd);

  return {
    didChange: true,
    regions,
    project: {
      ...project,
      tracks: project.tracks.map((track, index) => index !== trackIndex ? track : {
        ...track,
        clips: [
          ...track.clips.slice(0, clipIndex),
          ...clips,
          ...track.clips.slice(clipIndex + 1),
        ].sort((left, right) => left.startTime - right.startTime || left.id.localeCompare(right.id)),
      }),
    },
  };
}
