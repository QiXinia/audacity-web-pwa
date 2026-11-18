import type { IProject } from '@/types/project';
import type { ClipKey } from '@/lib/clipEditing';

/** Audacity 4 ClipItem/TextInputField: commit the entered title verbatim. */
export function renameClipTitle(project: IProject, key: ClipKey, newTitle: string): IProject {
  let changed = false;
  const tracks = project.tracks.map((track) => {
    if (track.id !== key.trackId) return track;
    let trackChanged = false;
    const clips = track.clips.map((clip) => {
      if (clip.id !== key.clipId || clip.name === newTitle) return clip;
      trackChanged = true;
      changed = true;
      return { ...clip, name: newTitle };
    });
    return trackChanged ? { ...track, clips } : track;
  });
  return changed ? { ...project, tracks } : project;
}
