import type { IProject, ITrack, ViewMode } from '@/types/project';

export const TRACK_VISUALIZATION_MODES = ['waveform', 'spectrum', 'both'] as const;
export type TrackVisualizationMode = typeof TRACK_VISUALIZATION_MODES[number];

const VIEW_MODES: readonly ViewMode[] = [
  'waveform', 'waveformDb', 'waveformDbLinear', 'spectrum', 'both',
];

function isViewMode(value: unknown): value is ViewMode {
  return typeof value === 'string' && VIEW_MODES.includes(value as ViewMode);
}

/** Legacy tracks inherit the Workspace default until their own view is changed. */
export function getTrackViewMode(track: ITrack, fallback: ViewMode): ViewMode {
  return isViewMode(track.viewMode) ? track.viewMode : fallback;
}

export function getTrackHalfWave(track: ITrack, fallback: boolean): boolean {
  return typeof track.halfWave === 'boolean' ? track.halfWave : fallback;
}

export function getTrackVisualizationMode(viewMode: ViewMode): TrackVisualizationMode {
  return viewMode === 'spectrum' || viewMode === 'both' ? viewMode : 'waveform';
}

/** Audacity TrackViewType is per track; view-only changes do not rewrite clips or audio. */
export function setTrackViewMode(
  project: IProject,
  trackId: string,
  viewMode: ViewMode,
): IProject {
  if (!isViewMode(viewMode)) return project;
  let changed = false;
  const tracks = project.tracks.map((track) => {
    if (track.id !== trackId || track.viewMode === viewMode) return track;
    changed = true;
    return { ...track, viewMode };
  });
  return changed ? { ...project, tracks } : project;
}

/** Half-wave remains an independent per-track view state in every visualization mode. */
export function setTrackHalfWave(
  project: IProject,
  trackId: string,
  halfWave: boolean,
): IProject {
  let changed = false;
  const tracks = project.tracks.map((track) => {
    if (track.id !== trackId || track.halfWave === halfWave) return track;
    changed = true;
    return { ...track, halfWave };
  });
  return changed ? { ...project, tracks } : project;
}
