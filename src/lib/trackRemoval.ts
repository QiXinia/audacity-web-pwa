/**
 * Resolve Audacity's TrackFocus target after TrackUtilities::DoRemoveTracks.
 *
 * If a track precedes the first removed track, Audacity prefers the next
 * surviving track and falls back to that preceding track. If removal starts at
 * the beginning of the track list, its TrackIter fallback focuses the last
 * surviving track. Removing every track leaves no focus target.
 */
export function resolveRemoveTrackFocus(
  trackIds: readonly string[],
  removedTrackIds: readonly string[],
): string | null {
  const removed = new Set(removedTrackIds);
  const firstRemovedIndex = trackIds.findIndex((trackId) => removed.has(trackId));
  if (firstRemovedIndex < 0) return null;

  const surviving = trackIds.filter((trackId) => !removed.has(trackId));
  if (surviving.length === 0) return null;
  if (firstRemovedIndex === 0) return surviving[surviving.length - 1]!;

  const preceding = trackIds[firstRemovedIndex - 1]!;
  const next = trackIds.slice(firstRemovedIndex + 1).find((trackId) => !removed.has(trackId));
  return next ?? preceding;
}
