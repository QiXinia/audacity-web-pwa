import { getClipStretchRatio } from '@/lib/clipEditing';
import type { GeneratorSelection } from '@/lib/generatorEditing';
import type { IClip, ITrack } from '@/types/project';

/** Audacity's Repeat dialog uses the signed 32-bit sample-count ceiling. */
export const MAX_REPEAT_SAMPLE_COUNT = 2147483647;

export function getMaxRepeatCount(sampleRate: number): number {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) return 1;
  return Math.max(1, Math.floor(MAX_REPEAT_SAMPLE_COUNT / sampleRate));
}

export function validateRepeatCount(repeatCount: number, sampleRate: number): number {
  if (
    !Number.isSafeInteger(repeatCount)
    || repeatCount < 1
    || repeatCount > getMaxRepeatCount(sampleRate)
  ) {
    throw new RangeError(`重复次数必须是 1–${getMaxRepeatCount(sampleRate)} 的整数`);
  }
  return repeatCount;
}

/**
 * Insert rendered copies immediately after a selection. Later audio is shifted
 * right so repeating can never overwrite or overlap unselected clips. A clip
 * crossing the insertion point is split without flattening its stretch window.
 */
export function insertRepeatedSelectionClips(
  track: ITrack,
  selection: GeneratorSelection,
  repeatCount: number,
  repeatedClip: IClip,
  createId: () => string,
): { track: ITrack; insertedClips: IClip[] } {
  if (
    !Number.isFinite(selection.start)
    || !Number.isFinite(selection.end)
    || selection.start < 0
    || selection.end <= selection.start
  ) throw new RangeError('重复选区必须是有限的正时长区间');
  if (!Number.isSafeInteger(repeatCount) || repeatCount < 1) {
    throw new RangeError('重复次数必须是正整数');
  }

  const selectionDuration = selection.end - selection.start;
  if (
    !repeatedClip.audioBufferId
    || !Number.isFinite(repeatedClip.duration)
    || Math.abs(repeatedClip.duration - selectionDuration) > 1e-9
  ) throw new RangeError('重复音频必须与选区时长完全一致');

  const insertedDuration = selectionDuration * repeatCount;
  if (!Number.isFinite(insertedDuration)) throw new RangeError('重复后的时长超出可表示范围');

  const clips = track.clips.flatMap((clip): IClip[] => {
    const clipEnd = clip.startTime + clip.duration;
    if (clipEnd <= selection.end) return [clip];
    if (clip.startTime >= selection.end) {
      return [{ ...clip, startTime: clip.startTime + insertedDuration }];
    }

    const leftDuration = selection.end - clip.startTime;
    const rightDuration = clipEnd - selection.end;
    return [
      {
        ...clip,
        duration: leftDuration,
        fadeOut: 0,
      },
      {
        ...clip,
        id: createId(),
        startTime: selection.end + insertedDuration,
        offset: clip.offset + leftDuration * getClipStretchRatio(clip),
        duration: rightDuration,
        fadeIn: 0,
      },
    ];
  });

  const insertedClips = Array.from({ length: repeatCount }, (_, index): IClip => ({
    ...repeatedClip,
    id: createId(),
    startTime: selection.end + index * selectionDuration,
    duration: selectionDuration,
    originalDuration: selectionDuration,
    offset: 0,
    stretchRatio: 1,
    gain: 0,
    fadeIn: 0,
    fadeOut: 0,
    name: `${repeatedClip.name || '重复选区'} ${index + 1}`,
  }));
  clips.push(...insertedClips);
  clips.sort((a, b) => a.startTime - b.startTime || a.id.localeCompare(b.id));
  return { track: { ...track, clips }, insertedClips };
}
