import { describe, expect, it } from 'vitest';
import { insertBlankSpaceOnTracks, pasteClipIntoTrack } from '@/lib/selectionPaste';
import type { IClip, IProject, ITrack } from '@/types/project';

function clip(id: string, startTime = 0, duration = 4, overrides: Partial<IClip> = {}): IClip {
  return {
    id, audioBufferId: `pcm-${id}`, startTime, duration, offset: 2,
    originalDuration: 12, stretchRatio: 2, gain: -3, fadeIn: 0.2, fadeOut: 0.3,
    pitchCents: 120, rawAudioTempo: 100, clipTempo: 120, name: id, ...overrides,
  };
}

function track(id: string, clips: IClip[] = []): ITrack {
  return { id, name: id, type: 'audio', gain: 0, pan: 0, muted: false, solo: false, armed: false, color: '', effects: [], clips };
}

function project(): IProject {
  return {
    id: 'p', name: 'p', sampleRate: 10, createdAt: 0, updatedAt: 0, tempo: 120,
    timeSignature: { numerator: 4, denominator: 4 }, cursorPosition: 0, selection: null,
    viewState: { horizontalZoom: 100, verticalZoom: 1, scrollX: 0, viewMode: 'waveform' },
    tracks: [track('a', [clip('source'), clip('following', 6, 1)]), track('b', [clip('other')])],
  };
}

function ids() {
  let value = 0;
  return () => `new-${++value}`;
}

const pasted = () => clip('pasted', 1, 2, { offset: 0, originalDuration: 2, stretchRatio: 1, pitchCents: 0, gain: 0, fadeIn: 0, fadeOut: 0 });

describe('Audacity Paste and overlap', () => {
  it('replaces only the occupied range and retains non-destructive remnants', () => {
    const source = project();
    const result = pasteClipIntoTrack(source.tracks[0]!, pasted(), 'overlap', ids());
    const [left, inserted, right, following] = result.clips;
    expect(left).toMatchObject({ id: 'source', startTime: 0, duration: 1, offset: 2, fadeOut: 0 });
    expect(inserted).toMatchObject({ id: 'pasted', startTime: 1, duration: 2 });
    expect(right).toMatchObject({ startTime: 3, duration: 1, offset: 8, stretchRatio: 2, pitchCents: 120, fadeIn: 0, fadeOut: 0.3 });
    expect(following).toBe(source.tracks[0]!.clips[1]);
    expect(source.tracks[0]!.clips).toHaveLength(2);
  });
});

describe('Audacity Paste and make room', () => {
  it('splits a spanning clip and shifts its right source window without touching another track', () => {
    const source = project();
    const result = pasteClipIntoTrack(source.tracks[0]!, pasted(), 'insert', ids());
    expect(result.clips.map((item) => [item.id, item.startTime, item.duration])).toEqual([
      ['source', 0, 1], ['pasted', 1, 2], ['new-1', 3, 3], ['following', 8, 1],
    ]);
    expect(result.clips[2]).toMatchObject({ audioBufferId: 'pcm-source', offset: 4, originalDuration: 12, stretchRatio: 2, pitchCents: 120 });
    expect(source.tracks[0]!.clips[0]).toMatchObject({ startTime: 0, duration: 4, offset: 2 });
  });

  it('inserts blank space across every selected track before an all-tracks ripple paste', () => {
    const source = project();
    const result = insertBlankSpaceOnTracks(source, 1, 2, ['a', 'b'], ids());
    expect(result.didChange).toBe(true);
    for (const item of result.project.tracks) {
      expect(item.clips[0]).toMatchObject({ startTime: 0, duration: 1 });
      expect(item.clips[1]).toMatchObject({ startTime: 3, duration: 3, offset: 4 });
    }
    expect(result.project.tracks[0]!.clips[2]).toMatchObject({ id: 'following', startTime: 8 });
  });

  it('limits per-track insertion to the requested target and snaps to project samples', () => {
    const source = project();
    const result = insertBlankSpaceOnTracks(source, 1.04, 2.04, ['a'], ids());
    expect(result.project.tracks[0]!.clips.map((item) => item.startTime)).toEqual([0, 3, 8]);
    expect(result.project.tracks[1]).toBe(source.tracks[1]);
  });

  it('rejects invalid insertion requests without modifying the project', () => {
    const source = project();
    for (const [start, duration] of [[NaN, 2], [1, 0], [1, -1]]) {
      const result = insertBlankSpaceOnTracks(source, start, duration, ['a'], ids());
      expect(result.project).toBe(source);
      expect(result.didChange).toBe(false);
    }
    expect(insertBlankSpaceOnTracks(source, 1, 2, [], ids()).project).toBe(source);
    expect(() => pasteClipIntoTrack(source.tracks[0]!, pasted(), 'insert', ids())).not.toThrow();
    expect(() => pasteClipIntoTrack(source.tracks[0]!, clip('bad', -1, 2), 'insert', ids())).toThrow(RangeError);
  });
});
