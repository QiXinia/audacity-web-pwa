import { getClipStretchRatio } from '@/lib/clipEditing';
import { replaceTrackSelectionWithClip } from '@/lib/generatorEditing';
import type { IClip, IProject, ITrack } from '@/types/project';

export type SelectionPasteMode = 'overlap' | 'per-track' | 'all-tracks';

function snapped(time: number, sampleRate: number): number {
  return Math.round(time * sampleRate) / sampleRate;
}

/** Insert timeline blank space while retaining every source window and clip property. */
export function insertBlankSpaceOnTracks(
  project: IProject,
  requestedStart: number,
  requestedDuration: number,
  selectedTrackIds: readonly string[],
  createId: () => string,
): { project: IProject; didChange: boolean } {
  if (
    !Number.isFinite(project.sampleRate) || project.sampleRate <= 0
    || !Number.isFinite(requestedStart) || !Number.isFinite(requestedDuration)
  ) return { project, didChange: false };
  const start = Math.max(0, snapped(requestedStart, project.sampleRate));
  const duration = snapped(requestedDuration, project.sampleRate);
  const targetTracks = new Set(selectedTrackIds);
  if (duration <= 0 || targetTracks.size === 0) return { project, didChange: false };
  let didChange = false;
  const tracks = project.tracks.map((track) => {
    if (!targetTracks.has(track.id)) return track;
    let trackChanged = false;
    const clips = track.clips.flatMap((clip): IClip[] => {
      const clipEnd = clip.startTime + clip.duration;
      if (clipEnd <= start) return [clip];
      trackChanged = true;
      didChange = true;
      if (clip.startTime >= start) return [{ ...clip, startTime: clip.startTime + duration }];
      const leftDuration = start - clip.startTime;
      const rightDuration = clipEnd - start;
      return [
        { ...clip, duration: leftDuration, fadeOut: 0 },
        {
          ...clip,
          id: createId(),
          startTime: start + duration,
          offset: clip.offset + leftDuration * getClipStretchRatio(clip),
          duration: rightDuration,
          fadeIn: 0,
        },
      ];
    });
    return trackChanged
      ? { ...track, clips: clips.sort((left, right) => left.startTime - right.startTime || left.id.localeCompare(right.id)) }
      : track;
  });
  return didChange ? { project: { ...project, tracks }, didChange: true } : { project, didChange: false };
}

/**
 * Paste a rendered clipboard clip. Overlap replaces only the occupied range;
 * insert first makes room on this track, matching Audacity's paste behaviors.
 */
export function pasteClipIntoTrack(
  track: ITrack,
  clip: IClip,
  mode: 'overlap' | 'insert',
  createId: () => string,
): ITrack {
  if (
    !Number.isFinite(clip.startTime) || clip.startTime < 0
    || !Number.isFinite(clip.duration) || clip.duration <= 0
  ) throw new RangeError('Paste clip requires a non-negative start and positive duration');
  if (mode === 'overlap') {
    return replaceTrackSelectionWithClip(
      track,
      { start: clip.startTime, end: clip.startTime + clip.duration },
      clip,
      createId,
    );
  }
  const start = clip.startTime;
  const duration = clip.duration;
  const clips = track.clips.flatMap((existing): IClip[] => {
    const existingEnd = existing.startTime + existing.duration;
    if (existingEnd <= start) return [existing];
    if (existing.startTime >= start) return [{ ...existing, startTime: existing.startTime + duration }];
    const leftDuration = start - existing.startTime;
    return [
      { ...existing, duration: leftDuration, fadeOut: 0 },
      {
        ...existing,
        id: createId(),
        startTime: start + duration,
        offset: existing.offset + leftDuration * getClipStretchRatio(existing),
        duration: existingEnd - start,
        fadeIn: 0,
      },
    ];
  });
  clips.push(clip);
  clips.sort((left, right) => left.startTime - right.startTime || left.id.localeCompare(right.id));
  return { ...track, clips };
}
