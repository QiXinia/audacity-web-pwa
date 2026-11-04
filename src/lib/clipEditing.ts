import type { IClip, IProject } from '@/types/project';
import { clamp } from '@/lib/audioUtils';

export const MIN_CLIP_DURATION = 0.05;
export const MIN_STRETCH_RATIO = 0.25;
export const MAX_STRETCH_RATIO = 4;

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
    ? clamp(ratio, MIN_STRETCH_RATIO, MAX_STRETCH_RATIO)
    : 1;
}

export function updateClipSelection(
  current: ClipKey[],
  key: ClipKey,
  additive: boolean,
): ClipKey[] {
  if (!additive) return [key];
  const id = clipKeyId(key);
  return current.some((item) => clipKeyId(item) === id)
    ? current.filter((item) => clipKeyId(item) !== id)
    : [...current, key];
}

function selectedClipSet(keys: ClipKey[]): Set<string> {
  return new Set(keys.map(clipKeyId));
}

function clipsForKeys(project: IProject, keys: ClipKey[]): IClip[] {
  const selected = selectedClipSet(keys);
  return project.tracks.flatMap((track) =>
    track.clips.filter((clip) => selected.has(clipKeyId({ trackId: track.id, clipId: clip.id }))),
  );
}

export function trimClipSelection(
  project: IProject,
  keys: ClipKey[],
  edge: 'left' | 'right',
  requestedDelta: number,
): IProject {
  const clips = clipsForKeys(project, keys);
  if (clips.length === 0 || !Number.isFinite(requestedDelta)) return project;

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
  if (upper < lower) return project;
  const delta = clamp(requestedDelta, lower, upper);
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

export function stretchClipSelection(
  project: IProject,
  keys: ClipKey[],
  edge: 'left' | 'right',
  requestedDelta: number,
): IProject {
  const clips = clipsForKeys(project, keys);
  if (clips.length === 0 || !Number.isFinite(requestedDelta)) return project;

  let lower = -Infinity;
  let upper = Infinity;
  for (const clip of clips) {
    const sourceAvailable = Math.max(0, clip.originalDuration - clip.offset);
    const shortest = Math.max(MIN_CLIP_DURATION, sourceAvailable / MAX_STRETCH_RATIO);
    const longest = Math.max(shortest, sourceAvailable / MIN_STRETCH_RATIO);
    if (edge === 'right') {
      lower = Math.max(lower, shortest - clip.duration);
      upper = Math.min(upper, longest - clip.duration);
    } else {
      lower = Math.max(lower, -clip.startTime, clip.duration - longest);
      upper = Math.min(upper, clip.duration - shortest);
    }
  }
  if (upper < lower) return project;
  const delta = clamp(requestedDelta, lower, upper);
  if (Math.abs(delta) < 0.000001) return project;

  const selected = selectedClipSet(keys);
  return {
    ...project,
    tracks: project.tracks.map((track) => ({
      ...track,
      clips: track.clips.map((clip) => {
        if (!selected.has(clipKeyId({ trackId: track.id, clipId: clip.id }))) return clip;
        const sourceAvailable = Math.max(0, clip.originalDuration - clip.offset);
        const duration = edge === 'right' ? clip.duration + delta : clip.duration - delta;
        return {
          ...clip,
          startTime: edge === 'left' ? clip.startTime + delta : clip.startTime,
          duration,
          stretchRatio: clamp(
            sourceAvailable / duration,
            MIN_STRETCH_RATIO,
            MAX_STRETCH_RATIO,
          ),
        };
      }),
    })),
  };
}

export function resetClipStretch(project: IProject, keys: ClipKey[]): IProject {
  const selected = selectedClipSet(keys);
  return {
    ...project,
    tracks: project.tracks.map((track) => ({
      ...track,
      clips: track.clips.map((clip) => {
        if (!selected.has(clipKeyId({ trackId: track.id, clipId: clip.id }))) return clip;
        const sourceAvailable = Math.max(MIN_CLIP_DURATION, clip.originalDuration - clip.offset);
        const end = clip.startTime + clip.duration;
        return {
          ...clip,
          startTime: Math.max(0, end - sourceAvailable),
          duration: sourceAvailable,
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

export function deleteClipSelection(project: IProject, keys: ClipKey[]): IProject {
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
