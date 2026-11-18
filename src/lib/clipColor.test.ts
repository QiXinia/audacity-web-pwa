import { describe, expect, it, vi } from 'vitest';
import type { IClip, IProject } from '@/types/project';
import { splitClipSelectionAtTime } from '@/lib/clipEditing';
import {
  CLIP_COLORS,
  getClipColor,
  getClipColorIndex,
  normalizeClipColorIndex,
  setClipColor,
} from '@/lib/clipColor';

const key = { trackId: 'track-a', clipId: 'clip-a' } as const;

function clip(id: string, overrides: Partial<IClip> = {}): IClip {
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
    ...overrides,
  };
}

function project(value: IClip = clip('clip-a')): IProject {
  return {
    id: 'color-project',
    name: 'Color',
    createdAt: 0,
    updatedAt: 0,
    sampleRate: 44100,
    timeSignature: { numerator: 4, denominator: 4 },
    tempo: 120,
    tracks: [{
      id: 'track-a', name: 'Track', type: 'audio', gain: 0, pan: 0,
      muted: false, solo: false, armed: false, color: '#123456', effects: [],
      clips: [value, clip('clip-b', { startTime: 3 })],
    }],
    cursorPosition: 0,
    selection: null,
    viewState: { horizontalZoom: 100, verticalZoom: 1, scrollX: 0, viewMode: 'waveform' },
  };
}

describe('Audacity 4 Clip color', () => {
  it('matches the official nine theme names, indexes and color values', () => {
    expect(CLIP_COLORS.map((entry) => [entry.index, entry.name, entry.color])).toEqual([
      [1, 'Blue', '#66A3FF'], [2, 'Violet', '#9996FC'], [3, 'Magenta', '#DA8CCC'],
      [4, 'Red', '#F08080'], [5, 'Orange', '#FF9E65'], [6, 'Yellow', '#E8C050'],
      [7, 'Green', '#74BE59'], [8, 'Turquoise', '#34B494'], [9, 'Cyan', '#48BECF'],
    ]);
  });

  it('inherits the current track color for legacy, automatic and malformed values', () => {
    expect(getClipColor(clip('clip-a'), '#123456')).toBe('#123456');
    expect(getClipColor(clip('clip-a', { colorIndex: 0 }), '#123456')).toBe('#123456');
    for (const malformed of [-1, 1.5, 10, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(normalizeClipColorIndex(malformed)).toBe(0);
      expect(getClipColor(clip('clip-a', { colorIndex: malformed }), '#123456')).toBe('#123456');
    }
  });

  it('changes only the requested clip and leaves the source project immutable', () => {
    const source = project();
    const result = setClipColor(source, key, 4);
    expect(result).not.toBe(source);
    expect(result.tracks[0].clips[0].colorIndex).toBe(4);
    expect(getClipColor(result.tracks[0].clips[0], '#123456')).toBe('#F08080');
    expect(result.tracks[0].clips[1]).toBe(source.tracks[0].clips[1]);
    expect(source.tracks[0].clips[0].colorIndex).toBeUndefined();
  });

  it('returns to Same as track color without changing audio or tempo fields', () => {
    const source = project(clip('clip-a', { colorIndex: 4 }));
    const result = setClipColor(source, key, 0);
    const edited = result.tracks[0].clips[0];
    expect(getClipColorIndex(edited)).toBe(0);
    expect(getClipColor(edited, '#654321')).toBe('#654321');
    expect(edited).toMatchObject({
      audioBufferId: 'buffer-clip-a', startTime: 0, offset: 0, duration: 2,
      originalDuration: 2, stretchRatio: 1.5, pitchCents: 1200,
      clipTempo: 120, rawAudioTempo: 90, fadeIn: 0.1, fadeOut: 0.2,
    });
  });

  it('treats repeated colors and missing clips as no-ops', () => {
    const source = project(clip('clip-a', { colorIndex: 4 }));
    expect(setClipColor(source, key, 4)).toBe(source);
    expect(setClipColor(source, { trackId: 'track-a', clipId: 'missing' }, 2)).toBe(source);
    expect(setClipColor(source, { trackId: 'missing', clipId: 'clip-a' }, 2)).toBe(source);
  });

  it('normalizes invalid requested colors to the automatic track color', () => {
    const source = project(clip('clip-a', { colorIndex: 4 }));
    expect(setClipColor(source, key, 99).tracks[0].clips[0].colorIndex).toBe(0);
    expect(setClipColor(source, key, 1.5).tracks[0].clips[0].colorIndex).toBe(0);
  });

  it('retains a custom color on both sides of an Audacity split', () => {
    const source = project(clip('clip-a', { colorIndex: 7 }));
    let id = 0;
    const result = splitClipSelectionAtTime(source, [key], 1, () => `split-${++id}`);
    expect(result.didSplit).toBe(true);
    expect(result.project.tracks[0].clips.slice(0, 2).map((item) => item.colorIndex)).toEqual([7, 7]);
    expect(source.tracks[0].clips[0].colorIndex).toBe(7);
  });

  it('persists valid colors and repairs malformed stored indexes on reload', async () => {
    const { deserializeTracks, serializeTracks } = await vi.importActual<typeof import('@/db/audioDb')>('@/db/audioDb');
    const serialized = serializeTracks([{
      ...project().tracks[0],
      clips: [
        clip('clip-a', { colorIndex: 9 }),
        clip('clip-b', { colorIndex: 10 }),
        clip('clip-c', { colorIndex: 1.5 }),
        clip('clip-d'),
      ],
    }]);
    const restored = deserializeTracks(serialized)[0].clips;
    expect(restored.map((item) => item.colorIndex)).toEqual([9, 0, 0, 0]);
    expect(getClipColor(restored[0], '#123456')).toBe('#48BECF');
    expect(getClipColor(restored[3], '#123456')).toBe('#123456');
  });
});
