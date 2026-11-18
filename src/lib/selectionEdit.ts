import { getClipStretchRatio } from '@/lib/clipEditing';
import type { IClip, IProject } from '@/types/project';

export type SelectionRippleMode = 'leave-gap' | 'per-clip' | 'per-track' | 'all-tracks';

export interface SelectionEditResult {
  project: IProject;
  didChange: boolean;
}

function snapToSample(time: number, sampleRate: number): number {
  return Math.round(time * sampleRate) / sampleRate;
}

/**
 * Audacity 4 range Cut/Delete behavior, expressed with non-destructive clips.
 * Leave-gap uses SplitDelete positioning; per-clip closes only intersected
 * clips; per-track/all-tracks also move following clips like WaveTrack::Clear.
 */
export function applySelectionEdit(
  project: IProject,
  requestedStart: number,
  requestedEnd: number,
  mode: SelectionRippleMode,
  selectedTrackIds: readonly string[],
  createId: () => string,
): SelectionEditResult {
  if (
    !Number.isFinite(requestedStart)
    || !Number.isFinite(requestedEnd)
    || !Number.isFinite(project.sampleRate)
    || project.sampleRate <= 0
  ) return { project, didChange: false };

  const start = Math.max(0, snapToSample(Math.min(requestedStart, requestedEnd), project.sampleRate));
  const end = Math.max(0, snapToSample(Math.max(requestedStart, requestedEnd), project.sampleRate));
  if (end <= start) return { project, didChange: false };

  const requestedTracks = new Set(selectedTrackIds);
  const targetTracks = mode === 'all-tracks'
    ? new Set(project.tracks.map((track) => track.id))
    : requestedTracks;
  if (targetTracks.size === 0) return { project, didChange: false };

  const closeWithinClip = mode !== 'leave-gap';
  const moveFollowingClips = mode === 'per-track' || mode === 'all-tracks';
  const duration = end - start;
  let didChange = false;

  const tracks = project.tracks.map((track) => {
    if (!targetTracks.has(track.id)) return track;

    const clips = track.clips.flatMap((clip): IClip[] => {
      const clipEnd = clip.startTime + clip.duration;
      if (clipEnd <= start) return [clip];
      if (clip.startTime >= end) {
        if (!moveFollowingClips) return [clip];
        didChange = true;
        return [{ ...clip, startTime: clip.startTime - duration }];
      }
      if (clip.startTime >= start && clipEnd <= end) {
        didChange = true;
        return [];
      }

      didChange = true;
      const ratio = getClipStretchRatio(clip);
      const pieces: IClip[] = [];
      if (clip.startTime < start) {
        pieces.push({
          ...clip,
          id: createId(),
          duration: start - clip.startTime,
          fadeOut: 0,
        });
      }
      if (clipEnd > end) {
        pieces.push({
          ...clip,
          id: createId(),
          startTime: closeWithinClip ? start : end,
          offset: clip.offset + (end - clip.startTime) * ratio,
          duration: clipEnd - end,
          fadeIn: 0,
        });
      }
      return pieces;
    }).sort((left, right) => left.startTime - right.startTime || left.id.localeCompare(right.id));

    return { ...track, clips };
  });

  return didChange ? { project: { ...project, tracks }, didChange: true } : { project, didChange: false };
}
