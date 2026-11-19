export type TrackMoveDirection = 'up' | 'down' | 'top' | 'bottom';

type TrackIdentity = { id: string };

/**
 * Mirror Audacity 4's single-track Move track commands without mutating the
 * source array or any track/clip objects. Boundary and unknown-track commands
 * are no-ops and therefore must not create a history entry.
 */
export function moveTrackInOrder<T extends TrackIdentity>(
  tracks: readonly T[],
  trackId: string,
  direction: TrackMoveDirection,
): T[] {
  const currentIndex = tracks.findIndex((track) => track.id === trackId);
  if (currentIndex < 0) return [...tracks];

  const targetIndex = direction === 'up'
    ? Math.max(0, currentIndex - 1)
    : direction === 'down'
      ? Math.min(tracks.length - 1, currentIndex + 1)
      : direction === 'top'
        ? 0
        : tracks.length - 1;
  if (targetIndex === currentIndex) return [...tracks];

  const ordered = [...tracks];
  const [track] = ordered.splice(currentIndex, 1);
  ordered.splice(targetIndex, 0, track!);
  return ordered;
}
