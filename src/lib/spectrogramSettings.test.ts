import { describe, expect, it } from 'vitest';
import {
  barkToHz,
  erbToHz,
  getDefaultSpectrogramSettings,
  getSpectrogramColorValue,
  getSpectrogramHighBoostDb,
  getSpectrogramRgb,
  getTrackSpectrogramSettings,
  hzToBark,
  hzToErb,
  melToHz,
  hzToMel,
  normalizeSpectrogramSettings,
  spectrogramFrequencyToPosition,
  spectrogramPositionToFrequency,
  updateTrackSpectrogramSettings,
} from '@/lib/spectrogramSettings';
import type { IProject, ISpectrogramSettings, ITrack, SpectrogramScale } from '@/types/project';

function settings(scale: SpectrogramScale, minFreq = 20, maxFreq = 20000): ISpectrogramSettings {
  return {
    scale, minFreq, maxFreq, gainDb: 20, rangeDb: 80, highBoostDbPerDec: 0, colorScheme: 'roseus',
  };
}

const track: ITrack = {
  id: 'track-a', name: 'A', type: 'audio', gain: 0, pan: 0, muted: false, solo: false,
  armed: false, color: '#fff', effects: [],
  clips: [{ id: 'clip-a', audioBufferId: 'pcm-a', startTime: 0, offset: 0, duration: 1, originalDuration: 1 }],
};
const project: IProject = {
  id: 'project-a', name: 'A', sampleRate: 44100, tracks: [track], cursorPosition: 0,
  selection: null, spectralSelection: null, viewState: { horizontalZoom: 100, verticalZoom: 1, scrollX: 0, viewMode: 'spectrum' },
  updatedAt: 1, createdAt: 1, timeSignature: { numerator: 4, denominator: 4 }, tempo: 120,
};

describe('Audacity Spectrogram settings', () => {
  it('uses the official global defaults and clamps the maximum to Nyquist', () => {
    expect(getDefaultSpectrogramSettings(44100)).toEqual(settings('mel', 0, 20000));
    expect(getDefaultSpectrogramSettings(8000).maxFreq).toBe(4000);
    expect(getTrackSpectrogramSettings(track, 44100)).toEqual(settings('mel', 0, 20000));
  });

  it('round-trips all six official NumberScale mappings', () => {
    for (const scale of ['linear', 'mel', 'bark', 'erb', 'logarithmic', 'period'] as const) {
      const current = settings(scale);
      for (const frequency of [20, 100, 1000, 5000, 20000]) {
        const position = spectrogramFrequencyToPosition(frequency, 44100, current);
        expect(spectrogramPositionToFrequency(position, 44100, current)).toBeCloseTo(frequency, 1);
      }
      expect(spectrogramFrequencyToPosition(20, 44100, current)).toBe(0);
      expect(spectrogramFrequencyToPosition(20000, 44100, current)).toBe(1);
    }
  });

  it('matches the official Mel, Bark and ERB formulas and logarithmic lower bound', () => {
    expect(hzToMel(1000)).toBeCloseTo(1127 * Math.log(1 + 1000 / 700));
    expect(melToHz(hzToMel(1000))).toBeCloseTo(1000);
    expect(barkToHz(hzToBark(1000))).toBeCloseTo(1000);
    expect(erbToHz(hzToErb(1000))).toBeCloseTo(1000);
    expect(normalizeSpectrogramSettings(settings('logarithmic', 0), 44100).minFreq).toBe(1);
    expect(normalizeSpectrogramSettings(settings('period', 0), 44100).minFreq).toBe(1);
  });

  it('applies official color gain/range and frequency high boost', () => {
    expect(getSpectrogramColorValue(-80, { gainDb: 20, rangeDb: 80 })).toBe(0.25);
    expect(getSpectrogramColorValue(0, { gainDb: 20, rangeDb: 80 })).toBe(1);
    expect(getSpectrogramColorValue(-200, { gainDb: 20, rangeDb: 80 })).toBe(0);
    expect(getSpectrogramHighBoostDb(1000, 48000, 48000, 20)).toBe(0);
    expect(getSpectrogramHighBoostDb(10000, 48000, 48000, 20)).toBeCloseTo(20);
    expect(getSpectrogramHighBoostDb(0, 48000, 48000, 20)).toBeCloseTo(-60);
  });

  it('uses the official Roseus endpoints and Audacity grayscale/classic mappings', () => {
    expect(getSpectrogramRgb(0, 'roseus')).toEqual([1, 1, 1]);
    expect(getSpectrogramRgb(0, 'classic')).toEqual([191, 191, 191]);
    expect(getSpectrogramRgb(1, 'classic')).toEqual([255, 251, 251]);
    expect(getSpectrogramRgb(0, 'grayscale')).toEqual([214, 214, 214]);
    expect(getSpectrogramRgb(0, 'inverse-grayscale')).toEqual([0, 0, 0]);
  });

  it('persists per-track overrides without changing PCM and restores global settings', () => {
    const override = settings('bark', 40, 12000);
    const updated = updateTrackSpectrogramSettings(project, track.id, override, false);
    expect(updated).not.toBe(project);
    expect(updated.tracks[0]!.spectrogramUseGlobalSettings).toBe(false);
    expect(updated.tracks[0]!.spectrogramSettings).toEqual(override);
    expect(updated.tracks[0]!.clips[0]).toBe(track.clips[0]);
    expect(getTrackSpectrogramSettings(updated.tracks[0]!, 44100)).toEqual(override);

    const restored = updateTrackSpectrogramSettings(updated, track.id, override, true);
    expect(restored.tracks[0]!.spectrogramUseGlobalSettings).toBe(true);
    expect(restored.tracks[0]!.spectrogramSettings).toBeUndefined();
    expect(getTrackSpectrogramSettings(restored.tracks[0]!, 44100)).toEqual(settings('mel', 0, 20000));
  });
});
