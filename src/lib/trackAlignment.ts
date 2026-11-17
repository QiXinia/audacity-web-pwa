import type { IProject, ITrack } from '@/types/project';

export type TrackAlignMode =
  | 'end-to-end'
  | 'together'
  | 'start-zero'
  | 'start-selection-start'
  | 'start-selection-end'
  | 'end-selection-start'
  | 'end-selection-end';

export interface TrackAlignmentResult {
  tracks: ITrack[];
  /** Timeline displacement for every selected track, including empty tracks. */
  deltas: ReadonlyMap<string, number>;
  label: 'Align End to End' | 'Align Together' | 'Align Start' | 'Align End';
}

export function getTrackStartTime(track: ITrack): number {
  if (track.clips.length === 0) return 0;
  return track.clips.reduce((start, clip) => Math.min(start, clip.startTime), Infinity);
}

export function getTrackEndTime(track: ITrack): number {
  if (track.clips.length === 0) return 0;
  return track.clips.reduce((end, clip) => Math.max(end, clip.startTime + clip.duration), -Infinity);
}

export function getTrackAlignLabel(mode: TrackAlignMode): TrackAlignmentResult['label'] {
  if (mode === 'end-to-end') return 'Align End to End';
  if (mode === 'together') return 'Align Together';
  return mode.startsWith('start-') ? 'Align Start' : 'Align End';
}

function moveTrack(track: ITrack, delta: number): ITrack {
  if (delta === 0 || track.clips.length === 0) return track;
  return {
    ...track,
    clips: track.clips.map((clip) => ({ ...clip, startTime: clip.startTime + delta })),
  };
}

/** Mirror TrackMenus.cpp DoAlign without mutating tracks, clips, or their order. */
export function alignTracks(
  tracks: readonly ITrack[],
  selectedTrackIds: readonly string[],
  mode: TrackAlignMode,
  selection: { start: number; end: number } | null,
): TrackAlignmentResult {
  const selected = new Set(selectedTrackIds);
  const selectedTracks = tracks.filter((track) => selected.has(track.id));
  const deltas = new Map<string, number>(selectedTracks.map((track) => [track.id, 0]));
  const label = getTrackAlignLabel(mode);
  if (selectedTracks.length === 0) return { tracks: [...tracks], deltas, label };

  if ((mode === 'start-selection-start' || mode === 'start-selection-end'
    || mode === 'end-selection-start' || mode === 'end-selection-end') && !selection) {
    throw new Error('对齐命令缺少光标或选区时间');
  }

  let sharedDelta: number | null = null;
  let togetherTarget: number | null = null;
  if (mode === 'start-zero' || mode === 'start-selection-start' || mode === 'start-selection-end') {
    const earliest = Math.min(...selectedTracks.map(getTrackStartTime));
    const target = mode === 'start-zero' ? 0
      : mode === 'start-selection-start' ? selection!.start : selection!.end;
    sharedDelta = target - earliest;
  } else if (mode === 'end-selection-start' || mode === 'end-selection-end') {
    const latest = Math.max(0, ...selectedTracks.map(getTrackEndTime));
    sharedDelta = (mode === 'end-selection-start' ? selection!.start : selection!.end) - latest;
  } else if (mode === 'together') {
    togetherTarget = selectedTracks.reduce((sum, track) => sum + getTrackStartTime(track), 0)
      / selectedTracks.length;
  }

  let nextPosition = mode === 'end-to-end' ? getTrackStartTime(selectedTracks[0]!) : 0;
  const aligned = tracks.map((track) => {
    if (!selected.has(track.id)) return track;
    let delta: number;
    if (mode === 'end-to-end') {
      delta = nextPosition - getTrackStartTime(track);
      nextPosition += getTrackEndTime(track) - getTrackStartTime(track);
    } else {
      delta = sharedDelta ?? togetherTarget! - getTrackStartTime(track);
    }
    deltas.set(track.id, delta);
    return moveTrack(track, delta);
  });
  return { tracks: aligned, deltas, label };
}

/** Keep track-scoped analysis labels attached to the same timeline content. */
export function alignProjectTracks(
  project: IProject,
  selectedTrackIds: readonly string[],
  mode: TrackAlignMode,
  selection: { start: number; end: number } | null,
): IProject {
  const result = alignTracks(project.tracks, selectedTrackIds, mode, selection);
  return {
    ...project,
    tracks: result.tracks,
    analysisLabels: project.analysisLabels?.map((label) => {
      const delta = result.deltas.get(label.trackId) ?? 0;
      return delta === 0 ? label : { ...label, start: label.start + delta, end: label.end + delta };
    }),
  };
}
