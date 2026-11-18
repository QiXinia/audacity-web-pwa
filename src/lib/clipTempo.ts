import type { IClip, IProject, ITrack } from '@/types/project';
import { getClipStretchRatio, type ClipKey } from '@/lib/clipEditing';

function positiveTempo(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/** WaveClip defaults mStretchToMatchProjectTempo to true, including legacy clips. */
export function isClipStretchToMatchTempo(clip: IClip): boolean {
  return clip.stretchToMatchTempo !== false;
}

/**
 * Toggle Audacity 4 "Stretch with tempo changes" without changing the current
 * playback interval. Enabling re-bases clipTempo to the current project tempo;
 * disabling freezes the currently effective tempo. Subsequent project changes
 * decide whether the visible duration follows the project or remains frozen.
 */
export function toggleClipStretchToMatchTempo(project: IProject, key: ClipKey): IProject {
  const projectTempo = positiveTempo(project.tempo);
  if (projectTempo === null) throw new RangeError('工程 BPM 无效');
  let found = false;
  const tracks = project.tracks.map((track) => {
    if (track.id !== key.trackId) return track;
    let changed = false;
    const clips = track.clips.map((clip) => {
      if (clip.id !== key.clipId) return clip;
      found = true;
      changed = true;
      const enabled = !isClipStretchToMatchTempo(clip);
      return {
        ...clip,
        stretchToMatchTempo: enabled,
        clipTempo: enabled
          ? projectTempo
          : positiveTempo(clip.clipTempo) ?? projectTempo,
      };
    });
    return changed ? { ...track, clips } : track;
  });
  if (!found) throw new RangeError('要切换节拍跟随的片段已不存在');
  return { ...project, tracks };
}

/**
 * Audacity 4 WaveClip::OnProjectTempoChange, mapped to the PWA ratio convention.
 * AU4 GetStretchRatio is timeline/source; IClip.stretchRatio is source/timeline.
 * Therefore a following clip's PWA ratio scales by newTempo/oldClipTempo, while
 * its visible duration scales inversely. All clip positions retain beat time.
 */
export function applyProjectTempoToTracks(
  tracks: readonly ITrack[],
  oldTempo: number,
  newTempo: number,
): ITrack[] {
  if (
    !Number.isFinite(oldTempo) || oldTempo <= 0
    || !Number.isFinite(newTempo) || newTempo <= 0
    || oldTempo === newTempo
  ) return [...tracks];

  const positionScale = oldTempo / newTempo;
  return tracks.map((track) => {
    let trackChanged = false;
    const clips = track.clips.map((clip) => {
      if (
        !Number.isFinite(clip.startTime)
        || !Number.isFinite(clip.duration) || clip.duration <= 0
      ) return clip;

      const following = isClipStretchToMatchTempo(clip);
      const rawAudioTempo = positiveTempo(clip.rawAudioTempo) ?? oldTempo;
      const startTime = clip.startTime * positionScale;
      if (!following) {
        trackChanged = true;
        return {
          ...clip,
          startTime,
          rawAudioTempo,
          stretchToMatchTempo: false,
        };
      }

      const oldClipTempo = positiveTempo(clip.clipTempo) ?? oldTempo;
      const oldRatio = getClipStretchRatio(clip);
      const requestedRatio = oldRatio * newTempo / oldClipTempo;
      // Reuse the playback bound instead of creating a second ratio contract.
      const stretchRatio = getClipStretchRatio({ ...clip, stretchRatio: requestedRatio });
      const sourceDuration = clip.duration * oldRatio;
      const duration = sourceDuration / stretchRatio;
      if (!Number.isFinite(duration) || duration <= 0) {
        throw new RangeError('工程 BPM 变化产生了无效片段时长');
      }
      const durationScale = duration / clip.duration;
      trackChanged = true;
      return {
        ...clip,
        startTime,
        duration,
        stretchRatio,
        rawAudioTempo,
        clipTempo: newTempo,
        stretchToMatchTempo: true,
        fadeIn: Math.max(0, clip.fadeIn * durationScale),
        fadeOut: Math.max(0, clip.fadeOut * durationScale),
      };
    });
    return trackChanged ? { ...track, clips } : track;
  });
}
