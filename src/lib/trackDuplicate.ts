import type { IClip, IProject, ITrack } from '@/types/project';

export interface TrackAudioBufferCopy {
  sourceBufferId: string;
  targetBufferId: string;
}

export interface TrackDuplicateResult {
  project: IProject;
  track: ITrack;
  audioBufferCopies: TrackAudioBufferCopy[];
}

function isGrouped(clip: IClip): boolean {
  return Number.isSafeInteger(clip.groupId) && (clip.groupId ?? -1) >= 0;
}

/**
 * Mirror Audacity 4 Track Duplicate without sharing editable track, clip,
 * effect, or audio-buffer identities with the source. Complete copied groups
 * receive fresh IDs; a group spanning an uncopied track is dissolved only in
 * the copy, exactly like remapCopiedClipGroups.
 */
export function duplicateTrackInProject(
  project: IProject,
  trackId: string,
  createId: () => string,
): TrackDuplicateResult | null {
  const source = project.tracks.find((track) => track.id === trackId);
  if (!source) return null;

  const allClips = project.tracks.flatMap((track) => track.clips);
  const maximumGroupId = allClips.reduce(
    (maximum, clip) => isGrouped(clip) ? Math.max(maximum, clip.groupId!) : maximum,
    0,
  );
  let nextGroupId = maximumGroupId + 1;
  const groupIds = [...new Set(source.clips.filter(isGrouped).map((clip) => clip.groupId!))]
    .sort((left, right) => left - right);
  const copiedGroupIds = new Map<number, number | null>();
  for (const groupId of groupIds) {
    const spansUncopiedTrack = project.tracks.some((track) => (
      track.id !== source.id && track.clips.some((clip) => clip.groupId === groupId)
    ));
    if (spansUncopiedTrack) {
      copiedGroupIds.set(groupId, null);
      continue;
    }
    if (!Number.isSafeInteger(nextGroupId)) {
      throw new RangeError('没有可用的 Clip Group ID');
    }
    copiedGroupIds.set(groupId, nextGroupId);
    nextGroupId += 1;
  }

  const bufferIds = new Map<string, string>();
  const clips = source.clips.map((clip) => {
    let targetBufferId = bufferIds.get(clip.audioBufferId);
    if (!targetBufferId) {
      targetBufferId = createId();
      bufferIds.set(clip.audioBufferId, targetBufferId);
    }
    const copied: IClip = {
      ...clip,
      id: createId(),
      audioBufferId: targetBufferId,
    };
    if (isGrouped(clip)) {
      const copiedGroupId = copiedGroupIds.get(clip.groupId!);
      if (copiedGroupId === null) delete copied.groupId;
      else copied.groupId = copiedGroupId;
    }
    return copied;
  });

  const track: ITrack = {
    ...source,
    id: createId(),
    clips,
    effects: source.effects.map((effect) => ({
      ...effect,
      id: createId(),
      params: { ...effect.params },
    })),
    spectrogramSettings: source.spectrogramSettings
      ? { ...source.spectrogramSettings }
      : undefined,
  };

  return {
    project: { ...project, tracks: [...project.tracks, track] },
    track,
    audioBufferCopies: [...bufferIds].map(([sourceBufferId, targetBufferId]) => ({
      sourceBufferId,
      targetBufferId,
    })),
  };
}
