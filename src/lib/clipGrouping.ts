import { clipKeyId, type ClipKey } from '@/lib/clipEditing';
import type { IClip, IProject } from '@/types/project';

export interface ClipGroupState {
  selectedCount: number;
  containsGroup: boolean;
  isSelectionGrouped: boolean;
  canGroup: boolean;
  canUngroup: boolean;
}

interface SelectedClip {
  trackId: string;
  clip: IClip;
}

function isGrouped(clip: IClip): boolean {
  return Number.isSafeInteger(clip.groupId) && (clip.groupId ?? -1) >= 0;
}

function resolveSelectedClips(project: IProject, keys: readonly ClipKey[]): SelectedClip[] {
  const seen = new Set<string>();
  const selected: SelectedClip[] = [];
  for (const key of keys) {
    const id = clipKeyId(key);
    if (seen.has(id)) continue;
    seen.add(id);
    const track = project.tracks.find((candidate) => candidate.id === key.trackId);
    const clip = track?.clips.find((candidate) => candidate.id === key.clipId);
    if (track && clip) selected.push({ trackId: track.id, clip });
  }
  return selected;
}

/** Mirrors Audacity 4 selectionContainsGroup/isSelectionGrouped action rules. */
export function getClipGroupState(project: IProject, keys: readonly ClipKey[]): ClipGroupState {
  const selected = resolveSelectedClips(project, keys);
  const selectedCount = selected.length;
  const groupIds = new Set(selected.map(({ clip }) => isGrouped(clip) ? clip.groupId! : -1));
  const containsGroup = selected.some(({ clip }) => isGrouped(clip));
  const isSelectionGrouped = selectedCount > 0 && groupIds.size === 1 && !groupIds.has(-1);
  return {
    selectedCount,
    containsGroup,
    isSelectionGrouped,
    canGroup: selectedCount > 1 && !isSelectionGrouped,
    canUngroup: selectedCount > 1 && containsGroup,
  };
}

/**
 * Group exactly the selected Clips. As in Audacity, the first selected existing
 * group ID is reused; otherwise the next project-wide positive ID is assigned.
 */
export function groupClips(project: IProject, keys: readonly ClipKey[]): IProject | null {
  const selected = resolveSelectedClips(project, keys);
  if (!getClipGroupState(project, keys).canGroup) return null;
  const existingGroupId = selected.find(({ clip }) => isGrouped(clip))?.clip.groupId;
  let newGroupId = existingGroupId;
  if (newGroupId === undefined) {
    const maximum = project.tracks.flatMap((track) => track.clips)
      .reduce((max, clip) => isGrouped(clip) ? Math.max(max, clip.groupId!) : max, 0);
    if (maximum >= Number.MAX_SAFE_INTEGER) return null;
    newGroupId = maximum + 1;
  }
  const selectedIds = new Set(keys.map(clipKeyId));
  return {
    ...project,
    tracks: project.tracks.map((track) => ({
      ...track,
      clips: track.clips.map((clip) => selectedIds.has(clipKeyId({ trackId: track.id, clipId: clip.id }))
        ? { ...clip, groupId: newGroupId }
        : clip),
    })),
  };
}

/** Ungroup exactly the selected Clips; unselected members of the same old group are unchanged. */
export function ungroupClips(project: IProject, keys: readonly ClipKey[]): IProject | null {
  if (!getClipGroupState(project, keys).canUngroup) return null;
  const selectedIds = new Set(keys.map(clipKeyId));
  return {
    ...project,
    tracks: project.tracks.map((track) => ({
      ...track,
      clips: track.clips.map((clip) => {
        if (!selectedIds.has(clipKeyId({ trackId: track.id, clipId: clip.id }))) return clip;
        const next = { ...clip };
        delete next.groupId;
        return next;
      }),
    })),
  };
}
