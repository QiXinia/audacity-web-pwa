import type { ClipKey } from '@/lib/clipEditing';
import { deleteClipSelection } from '@/lib/clipEditing';
import type { RangeJoinGroup } from '@/lib/selectionStructure';
import type { IClip, IProject } from '@/types/project';

export interface MultiClipTrackSelection {
  trackId: string;
  clips: IClip[];
}

export interface MultiClipSelectionPlan {
  tracks: MultiClipTrackSelection[];
  start: number;
  end: number;
}

function uniqueKeys(keys: readonly ClipKey[]): ClipKey[] {
  const seen = new Set<string>();
  return keys.filter((key) => {
    const id = `${key.trackId}\u0000${key.clipId}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

/** Resolve actual selected Clips without widening the operation to their time span. */
export function planMultiClipSelection(
  project: IProject,
  keys: readonly ClipKey[],
): MultiClipSelectionPlan | null {
  const selected = new Set(uniqueKeys(keys).map((key) => `${key.trackId}\u0000${key.clipId}`));
  if (selected.size === 0) return null;
  const tracks = project.tracks.flatMap((track): MultiClipTrackSelection[] => {
    if (track.type !== 'audio') return [];
    const clips = track.clips
      .filter((clip) => selected.has(`${track.id}\u0000${clip.id}`))
      .sort((left, right) => left.startTime - right.startTime || left.id.localeCompare(right.id));
    return clips.length > 0 ? [{ trackId: track.id, clips }] : [];
  });
  if (tracks.length === 0) return null;
  const clips = tracks.flatMap((track) => track.clips);
  return {
    tracks,
    start: Math.min(...clips.map((clip) => clip.startTime)),
    end: Math.max(...clips.map((clip) => clip.startTime + clip.duration)),
  };
}

/**
 * Audacity 4 joins two or more selected Clips only when they share one track
 * and no unselected Clip intersects their outer span. Silence gaps are allowed.
 */
export function planMultiClipJoin(
  project: IProject,
  keys: readonly ClipKey[],
): RangeJoinGroup | null {
  const deduplicated = uniqueKeys(keys);
  if (deduplicated.length < 2) return null;
  const plan = planMultiClipSelection(project, deduplicated);
  if (!plan || plan.tracks.length !== 1) return null;
  const group = plan.tracks[0]!;
  const selectedCount = group.clips.length;
  if (selectedCount !== deduplicated.length) return null;
  const selectedIds = new Set(group.clips.map((clip) => clip.id));
  const track = project.tracks.find((candidate) => candidate.id === group.trackId);
  if (!track) return null;
  if (track.clips.some((clip) => (
    !selectedIds.has(clip.id)
    && clip.startTime < plan.end
    && clip.startTime + clip.duration > plan.start
  ))) return null;
  return { trackId: group.trackId, start: plan.start, end: plan.end, clips: group.clips };
}

/** Delete exactly the selected Clips; per-track ripple moves only following audio on those tracks. */
export function removeMultiClipSelection(
  project: IProject,
  keys: readonly ClipKey[],
  moveFollowingClips: boolean,
): IProject | null {
  if (!moveFollowingClips) return deleteClipSelection(project, keys);
  const plan = planMultiClipSelection(project, keys);
  if (!plan) return null;
  const selected = new Set(uniqueKeys(keys).map((key) => `${key.trackId}\u0000${key.clipId}`));
  let didChange = false;
  const tracks = project.tracks.map((track) => {
    if (track.type !== 'audio') return track;
    let shift = 0;
    let trackChanged = false;
    const clips: IClip[] = [];
    const ordered = [...track.clips].sort((left, right) => (
      left.startTime - right.startTime || left.id.localeCompare(right.id)
    ));
    for (const clip of ordered) {
      if (selected.has(`${track.id}\u0000${clip.id}`)) {
        shift += clip.duration;
        trackChanged = true;
        didChange = true;
      } else {
        clips.push(shift > 0 ? { ...clip, startTime: clip.startTime - shift } : clip);
      }
    }
    return trackChanged ? { ...track, clips } : track;
  });
  return didChange ? { ...project, tracks } : null;
}
