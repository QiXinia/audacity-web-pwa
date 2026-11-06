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
