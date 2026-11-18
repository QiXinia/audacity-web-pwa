import { describe, expect, it, vi } from 'vitest';
import type { IClip, IProject } from '@/types/project';
import {
  isClipStretchToMatchTempo,
  toggleClipStretchToMatchTempo,
} from '@/lib/clipTempo';
import { updateProjectTempo } from '@/lib/musicalTiming';
import { applyClipPitchAndSpeed } from '@/lib/clipPitchSpeed';

const key = { trackId: 'track-a', clipId: 'clip-a' } as const;

function clip(overrides: Partial<IClip> = {}): IClip {
  return {
    id: 'clip-a',
    audioBufferId: 'buffer-a',
    startTime: 0.2,
    offset: 0.2,
    duration: 0.5,
    originalDuration: 1,
    stretchRatio: 1,
    gain: 0,
    fadeIn: 0.1,
    fadeOut: 0.2,
    ...overrides,
  };
}

function project(value: IClip = clip(), tempo = 188): IProject {
  return {
    id: 'tempo-project',
    name: 'Tempo',
    createdAt: 0,
    updatedAt: 0,
    sampleRate: 44100,
    timeSignature: { numerator: 4, denominator: 4 },
    tempo,
    tracks: [{
      id: 'track-a', name: 'Track', type: 'audio', gain: 0, pan: 0,
      muted: false, solo: false, armed: false, color: '', effects: [], clips: [value],
    }],
    cursorPosition: 0,
    selection: null,
    viewState: { horizontalZoom: 100, verticalZoom: 1, scrollX: 0, viewMode: 'waveform' },
  };
}

describe('Audacity 4 Stretch with tempo changes', () => {
  it('maps the official legacy 188→94 BPM case to the reciprocal PWA ratio', () => {
    const source = project(clip({ rawAudioTempo: 130 }));
    const result = updateProjectTempo(source, 94);
    const edited = result.tracks[0].clips[0];
    expect(edited.stretchRatio).toBeCloseTo(0.5, 12);
    expect(edited.duration).toBeCloseTo(1, 12);
    expect(edited.startTime).toBeCloseTo(0.4, 12);
    expect(edited.rawAudioTempo).toBe(130);
    expect(edited.clipTempo).toBe(94);
    expect(edited.stretchToMatchTempo).toBe(true);
    expect(edited.offset).toBe(0.2);
    expect(edited.originalDuration).toBe(1);
    expect(edited.duration * (edited.stretchRatio ?? 1)).toBeCloseTo(0.5, 12);
    expect(edited.fadeIn).toBeCloseTo(0.2, 12);
    expect(edited.fadeOut).toBeCloseTo(0.4, 12);
    expect(source.tracks[0].clips[0].duration).toBe(0.5);
  });

  it('honours an explicit frozen clipTempo over the project tempo', () => {
    const ratio = 150 / 188;
    const source = project(clip({
      rawAudioTempo: 130,
      clipTempo: 150,
      stretchToMatchTempo: false,
      stretchRatio: ratio,
    }));
    const edited = updateProjectTempo(source, 94).tracks[0].clips[0];
    expect(edited.stretchRatio).toBeCloseTo(ratio, 12);
    expect(edited.duration).toBe(0.5);
    expect(edited.startTime).toBeCloseTo(0.4, 12);
    expect(edited.clipTempo).toBe(150);
    expect(edited.rawAudioTempo).toBe(130);
    expect(edited.fadeIn).toBe(0.1);
    expect(edited.fadeOut).toBe(0.2);
  });

  it('disabling freezes the inherited tempo and preserves the current playback interval', () => {
    const source = project();
    const disabled = toggleClipStretchToMatchTempo(source, key);
    const frozen = disabled.tracks[0].clips[0];
    expect(frozen.stretchToMatchTempo).toBe(false);
    expect(frozen.clipTempo).toBe(188);
    expect(frozen.stretchRatio).toBe(1);
    expect(frozen.duration).toBe(0.5);
    expect(frozen.startTime).toBe(0.2);

    const edited = updateProjectTempo(disabled, 94).tracks[0].clips[0];
    expect(edited.stretchRatio).toBe(1);
    expect(edited.duration).toBe(0.5);
    expect(edited.startTime).toBeCloseTo(0.4, 12);
    expect(edited.clipTempo).toBe(188);
    expect(edited.rawAudioTempo).toBe(188);
  });

  it('re-enabling preserves the current interval and follows only later project changes', () => {
    const source = project(clip({ rawAudioTempo: 130, stretchToMatchTempo: false }));
    const changed = updateProjectTempo(source, 94);
    const enabled = toggleClipStretchToMatchTempo(changed, key);
    const rebound = enabled.tracks[0].clips[0];
    expect(rebound.stretchToMatchTempo).toBe(true);
    expect(rebound.clipTempo).toBe(94);
    expect(rebound.stretchRatio).toBe(1);
    expect(rebound.duration).toBe(0.5);
    expect(rebound.startTime).toBeCloseTo(0.4, 12);

    const followed = updateProjectTempo(enabled, 47).tracks[0].clips[0];
    expect(followed.stretchRatio).toBeCloseTo(0.5, 12);
    expect(followed.duration).toBeCloseTo(1, 12);
    expect(followed.startTime).toBeCloseTo(0.8, 12);
    expect(followed.clipTempo).toBe(47);
  });

  it('uses an explicit matching clipTempo before rebasing it to the new project tempo', () => {
    const ratio = 150 / 130;
    const source = project(clip({
      rawAudioTempo: 130,
      clipTempo: 150,
      stretchRatio: ratio,
      stretchToMatchTempo: true,
    }));
    const edited = updateProjectTempo(source, 94).tracks[0].clips[0];
    expect(edited.stretchRatio).toBeCloseTo(94 / 130, 12);
    expect(edited.duration).toBeCloseTo(0.5 * 150 / 94, 12);
    expect(edited.startTime).toBeCloseTo(0.4, 12);
    expect(edited.clipTempo).toBe(94);
  });

  it('infers missing rawAudioTempo from the old project tempo on the first change', () => {
    const source = project(clip({ rawAudioTempo: undefined, clipTempo: undefined }), 120);
    expect(isClipStretchToMatchTempo(source.tracks[0].clips[0])).toBe(true);
    const edited = updateProjectTempo(source, 60).tracks[0].clips[0];
    expect(edited.rawAudioTempo).toBe(120);
    expect(edited.clipTempo).toBe(60);
    expect(edited.stretchRatio).toBeCloseTo(0.5, 12);
    expect(edited.duration).toBeCloseTo(1, 12);
  });

  it('keeps source windows finite at the official 1…999 BPM boundaries', () => {
    const fastest = updateProjectTempo(project(clip({ duration: 1 }), 1), 999).tracks[0].clips[0];
    expect(fastest.stretchRatio).toBe(10);
    expect(fastest.duration).toBeCloseTo(0.1, 12);
    expect(fastest.duration * (fastest.stretchRatio ?? 1)).toBeCloseTo(1, 12);

    const slowest = updateProjectTempo(project(clip({ duration: 1 }), 999), 1).tracks[0].clips[0];
    expect(slowest.stretchRatio).toBe(0.01);
    expect(slowest.duration).toBeCloseTo(100, 12);
    expect(slowest.duration * (slowest.stretchRatio ?? 1)).toBeCloseTo(1, 12);
    expect(Number.isFinite(slowest.startTime)).toBe(true);
  });

  it('composes with Pitch and speed edits without introducing a second ratio model', () => {
    const source = project(clip({ duration: 4, originalDuration: 4, offset: 0 }), 120);
    const disabled = toggleClipStretchToMatchTempo(source, key);
    const faster = applyClipPitchAndSpeed(disabled, key, {
      pitchCents: 0, speedPercentage: 200, optimizeForVoice: false,
    });
    const frozen = updateProjectTempo(faster, 60).tracks[0].clips[0];
    expect(frozen.stretchRatio).toBe(2);
    expect(frozen.duration).toBe(2);

    const enabled = toggleClipStretchToMatchTempo(updateProjectTempo(faster, 60), key);
    const slower = applyClipPitchAndSpeed(enabled, key, {
      pitchCents: 0, speedPercentage: 50, optimizeForVoice: false,
    });
    const followed = updateProjectTempo(slower, 120).tracks[0].clips[0];
    expect(followed.stretchRatio).toBeCloseTo(1, 12);
    expect(followed.duration).toBeCloseTo(4, 12);
    expect(followed.duration * (followed.stretchRatio ?? 1)).toBeCloseTo(4, 12);
  });

  it('persists tempo fields, normalizes malformed values, and rejects missing clips', async () => {
    const source = project(clip({
      stretchToMatchTempo: false,
      rawAudioTempo: 130,
      clipTempo: 150,
    }));
    const { deserializeTracks } = await vi.importActual<typeof import('@/db/audioDb')>('@/db/audioDb');
    const restored = deserializeTracks(JSON.stringify(source.tracks))[0].clips[0];
    expect(restored.stretchToMatchTempo).toBe(false);
    expect(restored.rawAudioTempo).toBe(130);
    expect(restored.clipTempo).toBe(150);

    const malformed = deserializeTracks(JSON.stringify([{
      ...source.tracks[0],
      clips: [{ ...clip(), stretchToMatchTempo: 'yes', rawAudioTempo: -1, clipTempo: Number.NaN }],
    }]))[0].clips[0];
    expect(malformed.stretchToMatchTempo).toBe(false);
    expect(malformed.rawAudioTempo).toBeUndefined();
    expect(malformed.clipTempo).toBeUndefined();
    expect(() => toggleClipStretchToMatchTempo(source, { trackId: 'missing', clipId: 'missing' }))
      .toThrow('片段已不存在');
  });
});
