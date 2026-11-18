import { describe, expect, it } from 'vitest';
import { getClipGroupState, groupClips, ungroupClips } from '@/lib/clipGrouping';
import type { ClipKey } from '@/lib/clipEditing';
import type { IClip, IProject } from '@/types/project';

function clip(id: string, groupId?: number): IClip {
  return {
    id, audioBufferId: `buffer-${id}`, startTime: 0, offset: 0, duration: 1,
    originalDuration: 1, gain: 0, fadeIn: 0, fadeOut: 0, groupId,
  };
}

function project(): IProject {
  return {
    id: 'group-project', name: 'Groups', sampleRate: 100, createdAt: 0, updatedAt: 0,
    timeSignature: { numerator: 4, denominator: 4 }, tempo: 120,
    cursorPosition: 0, selection: null,
    viewState: { horizontalZoom: 100, verticalZoom: 1, scrollX: 0, viewMode: 'waveform' },
    tracks: [
      { id: 'a', name: 'A', type: 'audio', gain: 0, pan: 0, muted: false, solo: false, armed: false, color: '', effects: [], clips: [clip('a1'), clip('a2', 7)] },
      { id: 'b', name: 'B', type: 'audio', gain: 0, pan: 0, muted: false, solo: false, armed: false, color: '', effects: [], clips: [clip('b1'), clip('b2', 7)] },
    ],
  };
}

const a1 = { trackId: 'a', clipId: 'a1' } satisfies ClipKey;
const a2 = { trackId: 'a', clipId: 'a2' } satisfies ClipKey;
const b1 = { trackId: 'b', clipId: 'b1' } satisfies ClipKey;
const b2 = { trackId: 'b', clipId: 'b2' } satisfies ClipKey;

describe('Audacity Clip grouping', () => {
  it('assigns the next project-wide ID without mutating the source project', () => {
    const source = project();
    const result = groupClips(source, [a1, b1]);
    expect(result).not.toBeNull();
    expect(result!.tracks[0]!.clips.map((item) => item.groupId)).toEqual([8, 7]);
    expect(result!.tracks[1]!.clips.map((item) => item.groupId)).toEqual([8, 7]);
    expect(source.tracks[0]!.clips[0]!.groupId).toBeUndefined();
    expect(getClipGroupState(result!, [a1, b1])).toMatchObject({
      canGroup: false, canUngroup: true, isSelectionGrouped: true,
    });
  });

  it('reuses the first selected existing group when grouping mixed selections', () => {
    const result = groupClips(project(), [b2, a1, b1]);
    expect(result!.tracks[0]!.clips[0]!.groupId).toBe(7);
    expect(result!.tracks[1]!.clips.map((item) => item.groupId)).toEqual([7, 7]);
  });

  it('ungroups only selected clips and rejects undersized or ungrouped selections', () => {
    const source = project();
    expect(groupClips(source, [a1])).toBeNull();
    expect(ungroupClips(source, [a1, b1])).toBeNull();
    const result = ungroupClips(source, [a2, b1]);
    expect(result!.tracks[0]!.clips.map((item) => item.groupId)).toEqual([undefined, undefined]);
    expect(result!.tracks[1]!.clips.map((item) => item.groupId)).toEqual([undefined, 7]);
  });
});
