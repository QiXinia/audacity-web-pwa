import { describe, expect, it, vi } from 'vitest';
import type { IClip, IProject, ITrack } from '@/types/project';
import { getClipColor, getTrackColorIndex, setTrackColor } from '@/lib/clipColor';

function clip(id: string, colorIndex: number): IClip {
  return {
    id,
    audioBufferId: `buffer-${id}`,
    startTime: 0,
    offset: 0,
    duration: 2,
    originalDuration: 2,
    stretchRatio: 1.5,
    pitchCents: 1200,
    clipTempo: 120,
    rawAudioTempo: 90,
    gain: 0,
    fadeIn: 0.1,
    fadeOut: 0.2,
    colorIndex,
  };
}

function track(id: string, color: string, clips: IClip[]): ITrack {
  return {
    id, name: `Track ${id}`, type: 'audio', gain: -2, pan: 0.25,
    muted: false, solo: false, armed: false, color, clips, effects: [],
  };
}

function makeProject(): IProject {
  return {
    id: 'track-color-project',
    name: 'Track color',
    createdAt: 0,
    updatedAt: 0,
    sampleRate: 44100,
    timeSignature: { numerator: 4, denominator: 4 },
    tempo: 120,
    tracks: [
      track('a', '#66A3FF', [clip('auto', 0), clip('explicit', 4)]),
      track('b', '#9996FC', [clip('other', 0)]),
    ],
    cursorPosition: 0,
    selection: null,
    viewState: { horizontalZoom: 100, verticalZoom: 1, scrollX: 0, viewMode: 'waveform' },
  };
}

describe('Audacity 4 Track color', () => {
  it('checks only an exact theme color and tolerates legacy or custom colors', () => {
    expect(getTrackColorIndex(track('a', '#66A3FF', []))).toBe(1);
    expect(getTrackColorIndex(track('a', '#f08080', []))).toBe(4);
    expect(getTrackColorIndex(track('a', ' #48becf ', []))).toBe(9);
    expect(getTrackColorIndex(track('a', '#123456', []))).toBe(0);
    expect(getTrackColorIndex(track('a', '', []))).toBe(0);
  });

  it('changes only the requested track and preserves automatic and explicit clip semantics', () => {
    const source = makeProject();
    const result = setTrackColor(source, 'a', 7);
    expect(result).not.toBe(source);
    expect(result.tracks[0]).not.toBe(source.tracks[0]);
    expect(result.tracks[0]!.color).toBe('#74BE59');
    expect(result.tracks[0]!.clips).toBe(source.tracks[0]!.clips);
    expect(result.tracks[1]).toBe(source.tracks[1]);
    expect(result.tracks[0]!.clips.map((item) => item.colorIndex)).toEqual([0, 4]);
    expect(getClipColor(result.tracks[0]!.clips[0]!, result.tracks[0]!.color)).toBe('#74BE59');
    expect(getClipColor(result.tracks[0]!.clips[1]!, result.tracks[0]!.color)).toBe('#F08080');
    expect(source.tracks[0]!.color).toBe('#66A3FF');
  });

  it('treats repeated, unknown-track and invalid-color requests as no-ops', () => {
    const source = makeProject();
    expect(setTrackColor(source, 'a', 1)).toBe(source);
    expect(setTrackColor(source, 'missing', 7)).toBe(source);
    for (const invalid of [0, -1, 10, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(setTrackColor(source, 'a', invalid)).toBe(source);
    }
  });

  it('persists the selected track color without rewriting either clip color', async () => {
    const { deserializeTracks, serializeTracks } = await vi.importActual<typeof import('@/db/audioDb')>('@/db/audioDb');
    const edited = setTrackColor(makeProject(), 'a', 9);
    const restored = deserializeTracks(serializeTracks(edited.tracks));
    expect(restored[0]!.color).toBe('#48BECF');
    expect(getTrackColorIndex(restored[0]!)).toBe(9);
    expect(restored[0]!.clips.map((item) => item.colorIndex)).toEqual([0, 4]);
    expect(restored[1]!.color).toBe('#9996FC');
  });
});
