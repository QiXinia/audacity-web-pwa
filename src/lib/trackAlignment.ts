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
  /** DoAlign moves the time selection only for its fixed-delta commands. */
  selectionDelta: number;
  label: 'Align End to End' | 'Align Together'
    | 'Align Start' | 'Align End' | 'Align/Move Start' | 'Align/Move End'
    | 'Align/Move End to End' | 'Align/Move Together';
}

export function getTrackStartTime(track: ITrack): number {
  if (track.clips.length === 0) return 0;
  return track.clips.reduce((start, clip) => Math.min(start, clip.startTime), Infinity);
}

export function getTrackEndTime(track: ITrack): number {
  if (track.clips.length === 0) return 0;
  return track.clips.reduce((end, clip) => Math.max(end, clip.startTime + clip.duration), -Infinity);
}

export function getTrackAlignLabel(
  mode: TrackAlignMode,
  moveSelectionWithTracks = false,
): TrackAlignmentResult['label'] {
  if (mode === 'end-to-end') return moveSelectionWithTracks ? 'Align/Move End to End' : 'Align End to End';
  if (mode === 'together') return moveSelectionWithTracks ? 'Align/Move Together' : 'Align Together';
  if (mode.startsWith('start-')) return moveSelectionWithTracks ? 'Align/Move Start' : 'Align Start';
  return moveSelectionWithTracks ? 'Align/Move End' : 'Align End';
}

function moveTrack(track: ITrack, delta: number): ITrack {
  if (delta === 0 || track.clips.length === 0) return track;
  return {
    ...track,
    clips: track.clips.map((clip) => ({ ...clip, startTime: clip.startTime + delta })),
  };
}

/**
 * SyncLock::IsSyncLockSelected for the currently supported track types.
 * Audio tracks form maximal contiguous groups; a group is sync-lock selected
 * when any of its members is selected. Future separator track types extend
 * the else branch without changing the alignment algorithm.
 */
export function getSyncLockSelectedTrackIds(
  tracks: readonly ITrack[],
  selectedTrackIds: readonly string[],
  syncLockTracks: boolean,
): ReadonlySet<string> {
  const selected = new Set(selectedTrackIds);
  const syncSelected = new Set<string>();
  if (!syncLockTracks || selected.size === 0) return syncSelected;

  let group: ITrack[] = [];
  const flushGroup = () => {
    if (group.some((track) => selected.has(track.id))) {
      for (const track of group) syncSelected.add(track.id);
    }
    group = [];
  };
  for (const track of tracks) {
    if (track.type === 'audio') group.push(track);
    else flushGroup();
  }
  flushGroup();
  return syncSelected;
}

/** Mirror TrackMenus.cpp DoAlign without mutating tracks, clips, or their order. */
export function alignTracks(
  tracks: readonly ITrack[],
  selectedTrackIds: readonly string[],
  mode: TrackAlignMode,
  selection: { start: number; end: number } | null,
  moveSelectionWithTracks = false,
  syncLockTracks = false,
): TrackAlignmentResult {
  const selected = new Set(selectedTrackIds);
  const selectedTracks = tracks.filter((track) => selected.has(track.id));
  const deltas = new Map<string, number>(selectedTracks.map((track) => [track.id, 0]));
  const label = getTrackAlignLabel(mode, moveSelectionWithTracks);
  if (selectedTracks.length === 0) return { tracks: [...tracks], deltas, selectionDelta: 0, label };

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
  let resultTracks = aligned;
  if (sharedDelta !== null && sharedDelta !== 0 && syncLockTracks) {
    // DoAlign moves every selected or sync-lock selected track by one shared
    // delta. No-sync modes deliberately never enter this branch.
    const syncSelected = getSyncLockSelectedTrackIds(tracks, selectedTrackIds, true);
    resultTracks = aligned.map((track, index) => {
      if (selected.has(track.id) || !syncSelected.has(track.id)) return track;
      deltas.set(track.id, sharedDelta);
      return moveTrack(tracks[index]!, sharedDelta);
    });
  }
  return { tracks: resultTracks, deltas, selectionDelta: sharedDelta ?? 0, label };
}

/** Keep track-scoped analysis labels attached to the same timeline content. */
export function alignProjectTracks(
  project: IProject,
  selectedTrackIds: readonly string[],
  mode: TrackAlignMode,
  selection: { start: number; end: number } | null,
  options: { moveSelectionWithTracks?: boolean; syncLockTracks?: boolean } = {},
): IProject {
  const moveSelectionWithTracks = options.moveSelectionWithTracks ?? false;
  const result = alignTracks(
    project.tracks,
    selectedTrackIds,
    mode,
    selection,
    moveSelectionWithTracks,
    options.syncLockTracks ?? false,
  );
  const selectionDelta = moveSelectionWithTracks ? result.selectionDelta : 0;
  return {
    ...project,
    tracks: result.tracks,
    cursorPosition: selectionDelta === 0
      ? project.cursorPosition
      : project.cursorPosition + selectionDelta,
    selection: project.selection ? {
      start: project.selection.start + selectionDelta,
      end: project.selection.end + selectionDelta,
    } : null,
    analysisLabels: project.analysisLabels?.map((label) => {
      const delta = result.deltas.get(label.trackId) ?? 0;
      return delta === 0 ? label : { ...label, start: label.start + delta, end: label.end + delta };
    }),
  };
}
