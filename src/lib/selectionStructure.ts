import { getClipStretchRatio } from '@/lib/clipEditing';
import type { IClip, IProject } from '@/types/project';

export interface TimeRange {
  start: number;
  end: number;
}

export interface RangeJoinGroup {
  trackId: string;
  clips: IClip[];
  start: number;
  end: number;
}

function normalizeRange(range: TimeRange, sampleRate: number): TimeRange | null {
  if (
    !Number.isFinite(sampleRate) || sampleRate <= 0
    || !Number.isFinite(range.start) || !Number.isFinite(range.end)
  ) return null;
  const start = Math.max(0, Math.round(Math.min(range.start, range.end) * sampleRate) / sampleRate);
  const end = Math.max(0, Math.round(Math.max(range.start, range.end) * sampleRate) / sampleRate);
  return end > start ? { start, end } : null;
}

/** Audacity Split on a range: split every intersecting clip at both range boundaries. */
export function splitRangeSelection(
  project: IProject,
  requestedRange: TimeRange,
  selectedTrackIds: readonly string[],
  createId: () => string,
): { project: IProject; didChange: boolean } {
  const range = normalizeRange(requestedRange, project.sampleRate);
  const targetTracks = new Set(selectedTrackIds);
  if (!range || targetTracks.size === 0) return { project, didChange: false };
  let didChange = false;
  const tracks = project.tracks.map((track) => {
    if (!targetTracks.has(track.id)) return track;
    let trackChanged = false;
    const clips = track.clips.flatMap((clip): IClip[] => {
      const clipEnd = clip.startTime + clip.duration;
      if (clipEnd <= range.start || clip.startTime >= range.end) return [clip];
      const boundaries = [range.start, range.end].filter((time) => (
        time > clip.startTime && time < clipEnd
      ));
      if (boundaries.length === 0) return [clip];
      const points = [clip.startTime, ...boundaries, clipEnd];
      const ratio = getClipStretchRatio(clip);
      trackChanged = true;
      didChange = true;
      return points.slice(0, -1).map((pieceStart, index) => {
        const pieceEnd = points[index + 1]!;
        return {
          ...clip,
          id: createId(),
          startTime: pieceStart,
          offset: clip.offset + (pieceStart - clip.startTime) * ratio,
          duration: pieceEnd - pieceStart,
          fadeIn: index === 0 ? clip.fadeIn : 0,
          fadeOut: index === points.length - 2 ? clip.fadeOut : 0,
        };
      });
    });
    return trackChanged
      ? { ...track, clips: clips.sort((left, right) => left.startTime - right.startTime || left.id.localeCompare(right.id)) }
      : track;
  });
  return didChange ? { project: { ...project, tracks }, didChange: true } : { project, didChange: false };
}

/**
 * WaveTrack::Join includes every whole clip intersecting the range and requires
 * at least two clips on a track. The selection does not trim those clips first.
 */
export function planRangeJoin(
  project: IProject,
  requestedRange: TimeRange,
  selectedTrackIds: readonly string[],
): RangeJoinGroup[] {
  const range = normalizeRange(requestedRange, project.sampleRate);
  const targetTracks = new Set(selectedTrackIds);
  if (!range || targetTracks.size === 0) return [];
  return project.tracks.flatMap((track): RangeJoinGroup[] => {
    if (!targetTracks.has(track.id)) return [];
    const clips = track.clips
      .filter((clip) => clip.startTime < range.end && clip.startTime + clip.duration > range.start)
      .sort((left, right) => left.startTime - right.startTime || left.id.localeCompare(right.id));
    if (clips.length < 2) return [];
    return [{
      trackId: track.id,
      clips,
      start: clips[0]!.startTime,
      end: Math.max(...clips.map((clip) => clip.startTime + clip.duration)),
    }];
  });
}
