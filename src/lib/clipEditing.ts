import type { IClip, IProject } from '@/types/project';
import { clamp } from '@/lib/audioUtils';

export const MIN_CLIP_DURATION = 0.05;
export const MIN_STRETCH_RATIO = 0.25;
export const MAX_STRETCH_RATIO = 4;
// Pitch and speed supports 1…1000%; edge dragging retains its narrower 25…400% range.
const MIN_PLAYBACK_STRETCH_RATIO = 0.01;
const MAX_PLAYBACK_STRETCH_RATIO = 10;

export interface ClipKey {
  trackId: string;
  clipId: string;
}

export function clipKeyId(key: ClipKey): string {
  return `${key.trackId}:${key.clipId}`;
}

/** Source seconds per timeline second. Older projects have no field and use 1. */
export function getClipStretchRatio(clip: IClip): number {
  const ratio = clip.stretchRatio ?? 1;
  return Number.isFinite(ratio) && ratio > 0
    ? clamp(ratio, MIN_PLAYBACK_STRETCH_RATIO, MAX_PLAYBACK_STRETCH_RATIO)
    : 1;
}

function getClipSourceDuration(clip: IClip): number {
  const sourceDuration = clip.duration * getClipStretchRatio(clip);
  return Number.isFinite(sourceDuration) ? Math.max(0, sourceDuration) : 0;
}

function getClipStretchDeltaBounds(clip: IClip, edge: 'left' | 'right') {
  // Stretching changes playback speed, not the trimmed source window.
  const sourceDuration = getClipSourceDuration(clip);
  const shortest = Math.max(MIN_CLIP_DURATION, sourceDuration / MAX_STRETCH_RATIO);
  const longest = Math.max(shortest, sourceDuration / MIN_STRETCH_RATIO);
  return edge === 'right'
    ? { lower: shortest - clip.duration, upper: longest - clip.duration }
    : {
      lower: Math.max(-clip.startTime, clip.duration - longest),
      upper: clip.duration - shortest,
    };
}

/** Bound pointer/keyboard deltas with the same source-window rules as the edit. */
export function boundClipStretchDelta(
  clip: IClip,
  edge: 'left' | 'right',
  requestedDelta: number,
): number {
  if (!Number.isFinite(requestedDelta)) return 0;
  const { lower, upper } = getClipStretchDeltaBounds(clip, edge);
  return clamp(requestedDelta, lower, upper);
}

export type ClipSelectionMode = 'replace' | 'range' | 'toggle';

function findClipLocation(tracks: IProject['tracks'], key: ClipKey) {
  const trackIndex = tracks.findIndex((track) => track.id === key.trackId);
  if (trackIndex < 0) return null;
  const clip = tracks[trackIndex].clips.find((item) => item.id === key.clipId);
  return clip ? { trackIndex, clip } : null;
}

/**
 * Audacity selection semantics: replace on plain activation, Shift selects an
 * ordered same-track item range, and Ctrl/Cmd toggles a clip or its whole group.
 * The existing cross-track Shift time/track rectangle is retained as an extension.
 */
export function updateClipSelection(
  current: readonly ClipKey[],
  key: ClipKey,
  mode: ClipSelectionMode = 'replace',
  tracks: IProject['tracks'] = [],
  anchor: ClipKey | null = null,
): ClipKey[] {
  const target = findClipLocation(tracks, key);
  const groupId = target?.clip.groupId;
  const groupedKeys = target && Number.isSafeInteger(groupId) && (groupId ?? -1) >= 0
    ? tracks.flatMap((track) => track.clips
      .filter((clip) => clip.groupId === groupId)
      .map((clip) => ({ trackId: track.id, clipId: clip.id })))
    : [key];
  if (mode === 'replace') return groupedKeys;
  if (mode === 'toggle') {
    const currentIds = new Set(current.map(clipKeyId));
    const groupedIds = new Set(groupedKeys.map(clipKeyId));
    const wholeGroupSelected = groupedKeys.every((item) => currentIds.has(clipKeyId(item)));
    if (wholeGroupSelected) return current.filter((item) => !groupedIds.has(clipKeyId(item)));
    return [...current, ...groupedKeys.filter((item) => !currentIds.has(clipKeyId(item)))];
  }

  if (!target) return [...current];
  const rangeAnchor = [anchor, ...current]
    .map((candidate) => candidate ? findClipLocation(tracks, candidate) : null)
    .find((candidate) => candidate !== null);
  if (!rangeAnchor) return [key];

  if (rangeAnchor.trackIndex === target.trackIndex) {
    // Audacity 4's itemKeysInRange selects the contiguous sorted item indices,
    // not only clips wholly contained by the endpoint times. In particular, a
    // middle clip remains selected when its tail extends beyond the target.
    const track = tracks[target.trackIndex]!;
    const orderedClips = [...track.clips].sort((left, right) =>
      left.startTime - right.startTime || left.id.localeCompare(right.id),
    );
    const anchorIndex = orderedClips.findIndex((clip) => clip.id === rangeAnchor.clip.id);
    const targetIndex = orderedClips.findIndex((clip) => clip.id === target.clip.id);
    if (anchorIndex < 0 || targetIndex < 0) return [key];
    return orderedClips
      .slice(Math.min(anchorIndex, targetIndex), Math.max(anchorIndex, targetIndex) + 1)
      .map((clip) => ({ trackId: track.id, clipId: clip.id }));
  }

  const firstTrackIndex = Math.min(rangeAnchor.trackIndex, target.trackIndex);
  const lastTrackIndex = Math.max(rangeAnchor.trackIndex, target.trackIndex);
  const rangeStart = Math.min(rangeAnchor.clip.startTime, target.clip.startTime);
  const rangeEnd = Math.max(
    rangeAnchor.clip.startTime + rangeAnchor.clip.duration,
    target.clip.startTime + target.clip.duration,
  );
  const selected: ClipKey[] = [];
  for (let trackIndex = firstTrackIndex; trackIndex <= lastTrackIndex; trackIndex += 1) {
    const track = tracks[trackIndex];
    const orderedClips = [...track.clips].sort((left, right) =>
      left.startTime - right.startTime || left.id.localeCompare(right.id),
    );
    for (const clip of orderedClips) {
      if (clip.startTime < rangeStart || clip.startTime + clip.duration > rangeEnd) continue;
      selected.push({ trackId: track.id, clipId: clip.id });
    }
  }
  return selected.length > 0 ? selected : [key];
}

function selectedClipSet(keys: readonly ClipKey[]): Set<string> {
  return new Set(keys.map(clipKeyId));
}

function clipsForKeys(project: IProject, keys: ClipKey[]): IClip[] {
  const selected = selectedClipSet(keys);
  return project.tracks.flatMap((track) =>
    track.clips.filter((clip) => selected.has(clipKeyId({ trackId: track.id, clipId: clip.id }))),
  );
}

export function boundClipTrimDelta(
  project: IProject,
  keys: ClipKey[],
  edge: 'left' | 'right',
  requestedDelta: number,
): number {
  const clips = clipsForKeys(project, keys);
  if (clips.length === 0 || !Number.isFinite(requestedDelta)) return 0;

  let lower = -Infinity;
  let upper = Infinity;
  for (const clip of clips) {
    const ratio = getClipStretchRatio(clip);
    if (edge === 'left') {
      lower = Math.max(lower, -Math.min(clip.startTime, clip.offset / ratio));
      upper = Math.min(upper, clip.duration - MIN_CLIP_DURATION);
    } else {
      lower = Math.max(lower, MIN_CLIP_DURATION - clip.duration);
      upper = Math.min(
        upper,
        (clip.originalDuration - clip.offset) / ratio - clip.duration,
      );
    }
  }
  return upper < lower ? 0 : clamp(requestedDelta, lower, upper);
}

export function trimClipSelection(
  project: IProject,
  keys: ClipKey[],
  edge: 'left' | 'right',
  requestedDelta: number,
): IProject {
  const delta = boundClipTrimDelta(project, keys, edge, requestedDelta);
  if (Math.abs(delta) < 0.000001) return project;

  const selected = selectedClipSet(keys);
  return {
    ...project,
    tracks: project.tracks.map((track) => ({
      ...track,
      clips: track.clips.map((clip) => {
        if (!selected.has(clipKeyId({ trackId: track.id, clipId: clip.id }))) return clip;
        const ratio = getClipStretchRatio(clip);
        if (edge === 'left') {
          return {
            ...clip,
            startTime: clip.startTime + delta,
            offset: Math.max(0, clip.offset + delta * ratio),
            duration: clip.duration - delta,
            stretchRatio: ratio,
          };
        }
        return { ...clip, duration: clip.duration + delta, stretchRatio: ratio };
      }),
    })),
  };
}

export function boundClipStretchSelectionDelta(
  project: IProject,
  keys: ClipKey[],
  edge: 'left' | 'right',
  requestedDelta: number,
): number {
  const clips = clipsForKeys(project, keys);
  if (clips.length === 0 || !Number.isFinite(requestedDelta)) return 0;

  let lower = -Infinity;
  let upper = Infinity;
  for (const clip of clips) {
    const bounds = getClipStretchDeltaBounds(clip, edge);
    lower = Math.max(lower, bounds.lower);
    upper = Math.min(upper, bounds.upper);
  }
  return upper < lower ? 0 : clamp(requestedDelta, lower, upper);
}

export function stretchClipSelection(
  project: IProject,
  keys: ClipKey[],
  edge: 'left' | 'right',
  requestedDelta: number,
): IProject {
  const delta = boundClipStretchSelectionDelta(project, keys, edge, requestedDelta);
  if (Math.abs(delta) < 0.000001) return project;

  const selected = selectedClipSet(keys);
  return {
    ...project,
    tracks: project.tracks.map((track) => ({
      ...track,
      clips: track.clips.map((clip) => {
        if (!selected.has(clipKeyId({ trackId: track.id, clipId: clip.id }))) return clip;
        const sourceDuration = getClipSourceDuration(clip);
        const duration = edge === 'right' ? clip.duration + delta : clip.duration - delta;
        return {
          ...clip,
          startTime: edge === 'left' ? clip.startTime + delta : clip.startTime,
          duration,
          stretchRatio: clamp(
            sourceDuration / duration,
            MIN_STRETCH_RATIO,
            MAX_STRETCH_RATIO,
          ),
        };
      }),
    })),
  };
}

export function splitClipSelectionAtTime(
  project: IProject,
  keys: ClipKey[],
  time: number,
  createId: () => string,
): { project: IProject; didSplit: boolean } {
  if (!Number.isFinite(time)) return { project, didSplit: false };
  // Match Audacity SplitAt: put the play-region boundary on a project sample.
  const splitTime = Number.isFinite(project.sampleRate) && project.sampleRate > 0
    ? Math.round(time * project.sampleRate) / project.sampleRate
    : time;
  if (!Number.isFinite(splitTime)) return { project, didSplit: false };
  const selected = selectedClipSet(keys);
  let didSplit = false;
  const updated = {
    ...project,
    tracks: project.tracks.map((track) => ({
      ...track,
      clips: track.clips.flatMap((clip): IClip[] => {
        if (
          !selected.has(clipKeyId({ trackId: track.id, clipId: clip.id }))
          || splitTime <= clip.startTime + MIN_CLIP_DURATION
          || splitTime >= clip.startTime + clip.duration - MIN_CLIP_DURATION
        ) return [clip];
        const leftDuration = splitTime - clip.startTime;
        const rightDuration = clip.duration - leftDuration;
        didSplit = true;
        return [
          {
            ...clip,
            id: createId(),
            duration: leftDuration,
            fadeOut: 0,
          },
          {
            ...clip,
            id: createId(),
            startTime: splitTime,
            duration: rightDuration,
            offset: clip.offset + leftDuration * getClipStretchRatio(clip),
            fadeIn: 0,
          },
        ];
      }).sort((a, b) => a.startTime - b.startTime),
    })),
  };
  return { project: didSplit ? updated : project, didSplit };
}

export function resetClipStretch(project: IProject, keys: ClipKey[]): IProject {
  const selected = selectedClipSet(keys);
  return {
    ...project,
    tracks: project.tracks.map((track) => ({
      ...track,
      clips: track.clips.map((clip) => {
        if (!selected.has(clipKeyId({ trackId: track.id, clipId: clip.id }))) return clip;
        const sourceDuration = Math.max(MIN_CLIP_DURATION, getClipSourceDuration(clip));
        return {
          ...clip,
          duration: sourceDuration,
          stretchRatio: 1,
        };
      }),
    })),
  };
}

export function moveClipSelection(
  project: IProject,
  keys: ClipKey[],
  requestedDelta: number,
): IProject {
  const clips = clipsForKeys(project, keys);
  if (clips.length === 0 || !Number.isFinite(requestedDelta)) return project;
  const earliest = Math.min(...clips.map((clip) => clip.startTime));
  const delta = Math.max(requestedDelta, -earliest);
  if (Math.abs(delta) < 0.000001) return project;
  const selected = selectedClipSet(keys);
  return {
    ...project,
    tracks: project.tracks.map((track) => ({
      ...track,
      clips: track.clips
        .map((clip) =>
          selected.has(clipKeyId({ trackId: track.id, clipId: clip.id }))
            ? { ...clip, startTime: clip.startTime + delta }
            : clip,
        )
        .sort((a, b) => a.startTime - b.startTime),
    })),
  };
}

export function deleteClipSelection(project: IProject, keys: readonly ClipKey[]): IProject {
  const selected = selectedClipSet(keys);
  if (selected.size === 0) return project;
  return {
    ...project,
    tracks: project.tracks.map((track) => ({
      ...track,
      clips: track.clips.filter(
        (clip) => !selected.has(clipKeyId({ trackId: track.id, clipId: clip.id })),
      ),
    })),
  };
}
