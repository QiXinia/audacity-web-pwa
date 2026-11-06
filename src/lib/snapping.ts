import { clamp } from '@/lib/audioUtils';
import {
  boundClipStretchSelectionDelta,
  boundClipTrimDelta,
  clipKeyId,
  type ClipKey,
} from '@/lib/clipEditing';
import type { IClip, IProject, SnapMode } from '@/types/project';

export const DEFAULT_SNAP_TOLERANCE_PIXELS = 8;
const EPSILON = 1e-9;

export type ClipSnapOperation = 'move' | 'trim-left' | 'trim-right' | 'stretch-left' | 'stretch-right';

export interface SnapSettings {
  enabled: boolean;
  mode: SnapMode;
  points: readonly number[];
  toleranceSeconds: number;
  sampleRate: number;
  tempo: number;
}

function finiteTime(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function cleanTime(value: number): number {
  return Number(value.toPrecision(15));
}

/** Audacity-style clip-boundary candidates, excluding clips being edited. */
export function collectClipSnapPoints(project: IProject, excludedKeys: readonly ClipKey[] = []): number[] {
  const excluded = new Set(excludedKeys.map(clipKeyId));
  const points = [0];
  for (const track of project.tracks) {
    for (const clip of track.clips) {
      if (excluded.has(clipKeyId({ trackId: track.id, clipId: clip.id }))) continue;
      if (finiteTime(clip.startTime)) points.push(clip.startTime);
      const end = clip.startTime + clip.duration;
      if (finiteTime(end)) points.push(end);
    }
  }
  return [...new Set(points)].sort((a, b) => a - b);
}

function gridStep(settings: SnapSettings): number {
  switch (settings.mode) {
    case 'samples':
      return Number.isFinite(settings.sampleRate) && settings.sampleRate > 0
        ? 1 / settings.sampleRate
        : 0;
    case 'milliseconds':
      return 0.001;
    case 'seconds':
      return 1;
    case 'beats':
      return Number.isFinite(settings.tempo) && settings.tempo > 0 ? 60 / settings.tempo : 0;
    default:
      return 0;
  }
}

function resolveSnapTarget(time: number, settings: SnapSettings): number | null {
  if (!settings.enabled || !Number.isFinite(time)) return null;

  if (settings.mode !== 'clips') {
    const step = gridStep(settings);
    if (step <= 0) return null;
    return cleanTime(Math.max(0, Math.round(time / step) * step));
  }

  if (!Number.isFinite(settings.toleranceSeconds) || settings.toleranceSeconds <= 0) return null;
  let nearest: number | null = null;
  let nearestDistance = Infinity;
  for (const point of settings.points) {
    if (!finiteTime(point)) continue;
    const distance = Math.abs(time - point);
    if (
      distance < settings.toleranceSeconds
      && (distance < nearestDistance - EPSILON || (Math.abs(distance - nearestDistance) <= EPSILON && point < (nearest ?? Infinity)))
    ) {
      nearest = point;
      nearestDistance = distance;
    }
  }
  return nearest;
}

/** Snap a cursor/selection position to clip points or the selected time grid. */
export function snapTimelineTime(time: number, settings: SnapSettings): number {
  return resolveSnapTarget(time, settings) ?? time;
}

function clipsForKeys(project: IProject, keys: readonly ClipKey[]): IClip[] {
  const selected = new Set(keys.map(clipKeyId));
  return project.tracks.flatMap((track) =>
    track.clips.filter((clip) => selected.has(clipKeyId({ trackId: track.id, clipId: clip.id }))),
  );
}

function operationBounds(
  project: IProject,
  keys: readonly ClipKey[],
  operation: ClipSnapOperation,
  requestedDelta: number,
): number {
  if (operation === 'move') {
    const clips = clipsForKeys(project, keys);
    if (clips.length === 0 || !Number.isFinite(requestedDelta)) return 0;
    const earliest = Math.min(...clips.map((clip) => clip.startTime));
    return Math.max(requestedDelta, -earliest);
  }
  if (operation.startsWith('trim-')) {
    return boundClipTrimDelta(project, [...keys], operation === 'trim-left' ? 'left' : 'right', requestedDelta);
  }
  return boundClipStretchSelectionDelta(
    project,
    [...keys],
    operation === 'stretch-left' ? 'left' : 'right',
    requestedDelta,
  );
}

/**
 * Resolve one shared delta for a clip group. Both edges participate in moves;
 * only the dragged edge participates in trim/stretch. Unsafe candidates are
 * rejected against the same source-window and ratio bounds as the edit itself.
 */
export function snapClipSelectionDelta(
  project: IProject,
  keys: readonly ClipKey[],
  operation: ClipSnapOperation,
  requestedDelta: number,
  settings: SnapSettings,
): number {
  const clips = clipsForKeys(project, keys);
  if (clips.length === 0 || !Number.isFinite(requestedDelta)) return 0;
  const constrain = (delta: number) => operationBounds(project, keys, operation, delta);
  const baseDelta = constrain(requestedDelta);
  if (!settings.enabled || Math.abs(requestedDelta) <= EPSILON) return baseDelta;

  const edges: number[] = [];
  for (const clip of clips) {
    if (operation === 'move' || operation.endsWith('-left')) edges.push(clip.startTime);
    if (operation === 'move' || operation.endsWith('-right')) edges.push(clip.startTime + clip.duration);
  }

  let bestDelta = baseDelta;
  let bestDistance = Infinity;
  let bestMovement = Infinity;
  for (const edge of edges) {
    if (!finiteTime(edge)) continue;
    const target = resolveSnapTarget(edge + baseDelta, settings);
    if (target === null) continue;
    const candidate = cleanTime(target - edge);
    // Reject a snap that would violate a group/source/ratio bound.
    if (Math.abs(constrain(candidate) - candidate) > EPSILON) continue;
    const distance = Math.abs(edge + baseDelta - target);
    const movement = Math.abs(candidate - baseDelta);
    if (
      distance < bestDistance - EPSILON
      || (Math.abs(distance - bestDistance) <= EPSILON && movement < bestMovement - EPSILON)
    ) {
      bestDelta = candidate;
      bestDistance = distance;
      bestMovement = movement;
    }
  }
  return bestDelta;
}
