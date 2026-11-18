import type { IClip, IProject } from '@/types/project';
import type { ClipKey } from '@/lib/clipEditing';

/** Audacity 4: zero/undefined inherits the track color; 1…9 selects a theme color. */
export const CLIP_COLOR_INDEX_NONE = 0;

export const CLIP_COLORS = [
  { index: 1, name: 'Blue', color: '#66A3FF' },
  { index: 2, name: 'Violet', color: '#9996FC' },
  { index: 3, name: 'Magenta', color: '#DA8CCC' },
  { index: 4, name: 'Red', color: '#F08080' },
  { index: 5, name: 'Orange', color: '#FF9E65' },
  { index: 6, name: 'Yellow', color: '#E8C050' },
  { index: 7, name: 'Green', color: '#74BE59' },
  { index: 8, name: 'Turquoise', color: '#34B494' },
  { index: 9, name: 'Cyan', color: '#48BECF' },
] as const;

export function normalizeClipColorIndex(value: unknown): number {
  return typeof value === 'number'
    && Number.isInteger(value)
    && value >= CLIP_COLOR_INDEX_NONE
    && value <= CLIP_COLORS.length
    ? value
    : CLIP_COLOR_INDEX_NONE;
}

export function getClipColorIndex(clip: IClip): number {
  return normalizeClipColorIndex(clip.colorIndex);
}

/** Resolve a custom theme index or inherit the current track color. */
export function getClipColor(clip: IClip, trackColor: string): string {
  const index = getClipColorIndex(clip);
  if (index === CLIP_COLOR_INDEX_NONE) return trackColor || CLIP_COLORS[0].color;
  return CLIP_COLORS.find((entry) => entry.index === index)?.color ?? trackColor;
}

/** Change exactly one clip without altering audio, timing, selection or other clips. */
export function setClipColor(project: IProject, key: ClipKey, colorIndex: number): IProject {
  const normalized = normalizeClipColorIndex(colorIndex);
  let changed = false;
  const tracks = project.tracks.map((track) => {
    if (track.id !== key.trackId) return track;
    const clips = track.clips.map((clip) => {
      if (clip.id !== key.clipId || getClipColorIndex(clip) === normalized) return clip;
      changed = true;
      return { ...clip, colorIndex: normalized };
    });
    return changed ? { ...track, clips } : track;
  });
  return changed ? { ...project, tracks } : project;
}
