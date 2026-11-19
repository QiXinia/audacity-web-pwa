import { describe, expect, it } from 'vitest';
import type { IProject, ITrack, ViewMode } from '@/types/project';
import {
  getTrackHalfWave,
  getTrackViewMode,
  getTrackVisualizationMode,
  setTrackHalfWave,
  setTrackViewMode,
} from './trackVisualization';

function makeTrack(id: string): ITrack {
  return {
    id, name: `Track ${id}`, type: 'audio', gain: 0, pan: 0,
    muted: false, solo: false, armed: false, color: '#66A3FF', effects: [],
    clips: [{
      id: `clip-${id}`, audioBufferId: `buffer-${id}`, startTime: 0, offset: 0,
      duration: 1, originalDuration: 1, gain: 0, fadeIn: 0, fadeOut: 0,
    }],
  };
}

function makeProject(): IProject {
  return {
    id: 'visualization-project', name: 'Track visualization', tracks: [makeTrack('a'), makeTrack('b')],
    cursorPosition: 0, selection: null, sampleRate: 44100,
    timeSignature: { numerator: 4, denominator: 4 }, tempo: 120,
    viewState: { horizontalZoom: 100, verticalZoom: 1, scrollX: 0, viewMode: 'waveform' },
    updatedAt: 100, createdAt: 50,
  };
}

describe('Audacity per-track visualization', () => {
  it('inherits Workspace defaults for legacy tracks and rejects malformed persisted overrides', () => {
    const legacy = makeTrack('legacy');
    expect(getTrackViewMode(legacy, 'both')).toBe('both');
    expect(getTrackHalfWave(legacy, true)).toBe(true);

    const malformed = {
      ...legacy,
      viewMode: 'not-a-view' as ViewMode,
      halfWave: 'not-a-boolean' as unknown as boolean,
    };
    expect(getTrackViewMode(malformed, 'waveformDb')).toBe('waveformDb');
    expect(getTrackHalfWave(malformed, false)).toBe(false);
  });

  it('maps all waveform ruler formats to the official Waveform radio item', () => {
    expect(getTrackVisualizationMode('waveform')).toBe('waveform');
    expect(getTrackVisualizationMode('waveformDb')).toBe('waveform');
    expect(getTrackVisualizationMode('waveformDbLinear')).toBe('waveform');
    expect(getTrackVisualizationMode('spectrum')).toBe('spectrum');
    expect(getTrackVisualizationMode('both')).toBe('both');
  });

  it('changes only the target track view without rewriting clips, audio identities, or other tracks', () => {
    const input = makeProject();
    let updated = input;
    for (const mode of ['spectrum', 'both', 'waveform', 'waveformDb', 'waveformDbLinear'] as const) {
      updated = setTrackViewMode(updated, 'b', mode);
      expect(updated.tracks[1]!.viewMode).toBe(mode);
      expect(updated.tracks[0]).toBe(input.tracks[0]);
      expect(updated.tracks[1]!.clips).toBe(input.tracks[1]!.clips);
      expect(updated.tracks[1]!.clips[0]!.audioBufferId).toBe('buffer-b');
    }
    expect(input.tracks[1]!.viewMode).toBeUndefined();
  });

  it('returns the original project for an unknown track, invalid mode, or repeated selection', () => {
    const input = makeProject();
    expect(setTrackViewMode(input, 'missing', 'spectrum')).toBe(input);
    expect(setTrackViewMode(input, 'a', 'invalid' as ViewMode)).toBe(input);
    const spectrum = setTrackViewMode(input, 'a', 'spectrum');
    expect(setTrackViewMode(spectrum, 'a', 'spectrum')).toBe(spectrum);
  });

  it('toggles Half-wave independently, including an explicit false override and no-op boundaries', () => {
    const input = makeProject();
    const enabled = setTrackHalfWave(input, 'b', true);
    expect(enabled.tracks[1]!.halfWave).toBe(true);
    expect(enabled.tracks[0]).toBe(input.tracks[0]);
    expect(enabled.tracks[1]!.clips).toBe(input.tracks[1]!.clips);

    const disabled = setTrackHalfWave(enabled, 'b', false);
    expect(disabled.tracks[1]!.halfWave).toBe(false);
    expect(getTrackHalfWave(disabled.tracks[1]!, true)).toBe(false);
    expect(setTrackHalfWave(disabled, 'b', false)).toBe(disabled);
    expect(setTrackHalfWave(input, 'missing', true)).toBe(input);
  });
});
