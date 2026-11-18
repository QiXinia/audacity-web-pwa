import { describe, expect, it, vi } from 'vitest';
import type { IClip, IProject } from '@/types/project';
import { splitClipSelectionAtTime } from '@/lib/clipEditing';
import { renameClipTitle } from '@/lib/clipTitle';

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
    optimizeForVoice: true,
    rawAudioTempo: 90,
    clipTempo: 120,
    colorIndex: 9,
    gain: 0,
    fadeIn: 0.1,
    fadeOut: 0.2,
    name: `Clip ${id}`,
    ...overrides,
  };
}

function project(value: IClip = clip('clip-a')): IProject {
  return {
    id: 'title-project',
    name: 'Title',
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

describe('Audacity 4 Rename clip', () => {
  it('renames exactly one clip immutably without changing audio or visual properties', () => {
    const source = project();
    const result = renameClipTitle(source, key, 'Lead vocal');
    const edited = result.tracks[0].clips[0];
    expect(result).not.toBe(source);
    expect(edited).toMatchObject({
      name: 'Lead vocal',
      audioBufferId: 'buffer-clip-a', startTime: 0, offset: 0, duration: 2,
      originalDuration: 2, stretchRatio: 1.5, pitchCents: 1200,
      optimizeForVoice: true, rawAudioTempo: 90, clipTempo: 120,
      colorIndex: 9, fadeIn: 0.1, fadeOut: 0.2,
    });
    expect(result.tracks[0].clips[1]).toBe(source.tracks[0].clips[1]);
    expect(source.tracks[0].clips[0].name).toBe('Clip clip-a');
  });

  it('treats an identical title and missing clips as no-ops', () => {
    const source = project();
    expect(renameClipTitle(source, key, 'Clip clip-a')).toBe(source);
    expect(renameClipTitle(source, { trackId: 'track-a', clipId: 'missing' }, 'New')).toBe(source);
    expect(renameClipTitle(source, { trackId: 'missing', clipId: 'clip-a' }, 'New')).toBe(source);
  });

  it.each(['', '  Lead Vocal  ', '   ', '人声 🎙️', 'x'.repeat(256)])(
    'commits the official raw title %j without trimming or length policy',
    (title) => {
      const source = project();
      const result = renameClipTitle(source, key, title);
      expect(result.tracks[0].clips[0].name).toBe(title);
    },
  );

  it('retains the edited title on both sides of a split', () => {
    const renamed = renameClipTitle(project(), key, 'Verse 1');
    let id = 0;
    const result = splitClipSelectionAtTime(renamed, [key], 1, () => `split-${++id}`);
    expect(result.didSplit).toBe(true);
    expect(result.project.tracks[0].clips.slice(0, 2).map((item) => item.name)).toEqual(['Verse 1', 'Verse 1']);
  });

  it('round-trips Unicode, whitespace and empty titles through project persistence', async () => {
    const { deserializeHistorySnapshot, deserializeTracks, serializeHistorySnapshot, serializeTracks } = await vi.importActual<typeof import('@/db/audioDb')>('@/db/audioDb');
    const tracks = [{
      ...project().tracks[0],
      clips: [clip('clip-a', { name: '' }), clip('clip-b', { name: '  人声 🎙️  ' })],
    }];
    expect(deserializeTracks(serializeTracks(tracks))[0].clips.map((item) => item.name))
      .toEqual(['', '  人声 🎙️  ']);
    const restored = deserializeHistorySnapshot<IProject>(serializeHistorySnapshot(project(clip('clip-a', { name: '  Take 01  ' }))));
    expect(restored?.tracks[0].clips[0].name).toBe('  Take 01  ');
  });
});
