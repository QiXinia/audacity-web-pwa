import type { ITrack } from '@/types/project';

export type TrackSortMode = 'time' | 'name';

/**
 * Audacity DoSortTracks starts with the track end, then lowers it to the
 * earliest non-empty clip's play start. Empty tracks therefore sort at zero,
 * while a track containing only zero-length clips retains its track end.
 */
export function getTrackSortTime(track: ITrack): number {
  if (track.clips.length === 0) return 0;

  let trackEnd = -Infinity;
  for (const clip of track.clips) {
    trackEnd = Math.max(trackEnd, clip.startTime + clip.duration);
  }

  let sortTime = trackEnd;
  for (const clip of track.clips) {
    if (clip.duration > 0) sortTime = Math.min(sortTime, clip.startTime);
  }
  return sortTime;
}

/** Audacity compares names without case first, then puts lowercase before uppercase. */
export function compareTrackNames(left: string, right: string): number {
  const foldedLeft = left.toLowerCase();
  const foldedRight = right.toLowerCase();
  if (foldedLeft < foldedRight) return -1;
  if (foldedLeft > foldedRight) return 1;
  if (left === right) return 0;
  return left > right ? -1 : 1;
}

/** Stable insertion order mirrors TrackMenus.cpp without mutating the source array. */
export function sortTracks(tracks: readonly ITrack[], mode: TrackSortMode): ITrack[] {
  const ordered: ITrack[] = [];
  for (const track of tracks) {
    const index = ordered.findIndex((existing) => mode === 'name'
      ? compareTrackNames(track.name, existing.name) < 0
      : getTrackSortTime(track) < getTrackSortTime(existing));
    if (index < 0) ordered.push(track);
    else ordered.splice(index, 0, track);
  }
  return ordered;
}
