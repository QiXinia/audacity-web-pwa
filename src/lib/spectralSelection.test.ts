import { describe, expect, it } from 'vitest';
import {
  createFrequencySelectionFromBounds,
  createFrequencySelectionFromCenterBandwidth,
  frequencyToSpectrumY,
  getFrequencySelectionCenterHz,
  getFrequencySelectionLogBandwidth,
  getSpectrumDisplayMaxHz,
  getSpectrumRulerTicks,
  normalizeFrequencySelection,
  parseFrequencySelection,
  spectrumYToFrequency,
} from '@/lib/spectralSelection';
import type { ISpectrogramSettings } from '@/types/project';

function linear(maxFreq = 100): ISpectrogramSettings {
  return {
    scale: 'linear', minFreq: 0, maxFreq, gainDb: 0, rangeDb: 100,
    highBoostDbPerDec: 0, colorScheme: 'classic',
  };
}

describe('spectral frequency selection', () => {
  it('maps an explicit linear spectrogram between its configured frequency bounds', () => {
    expect(getSpectrumDisplayMaxHz(44100, linear(4410))).toBe(4410);
    expect(spectrumYToFrequency(76, 76, 1000, linear())).toBe(0);
    expect(spectrumYToFrequency(0, 76, 1000, linear())).toBe(100);
    expect(spectrumYToFrequency(38, 76, 1000, linear())).toBe(50);
    expect(frequencyToSpectrumY(50, 76, 1000, linear())).toBe(38);
    expect(frequencyToSpectrumY(spectrumYToFrequency(14, 76, 1000, linear()), 76, 1000, linear())).toBeCloseTo(14);
  });

  it('normalizes reverse drags and clamps both boundaries to the displayed range', () => {
    expect(normalizeFrequencySelection({ lowHz: 120, highHz: 20 }, 1000, linear())).toEqual({
      lowHz: 20,
      highHz: 100,
    });
    expect(normalizeFrequencySelection({ lowHz: -5, highHz: 40 }, 1000, linear())).toEqual({
      lowHz: 0,
      highHz: 40,
    });
  });

  it('rejects empty, non-finite and zero-height selections', () => {
    expect(normalizeFrequencySelection(null, 1000, linear())).toBeNull();
    expect(normalizeFrequencySelection({ lowHz: Number.NaN, highHz: 20 }, 1000, linear())).toBeNull();
    expect(normalizeFrequencySelection({ lowHz: 20, highHz: 20 }, 1000, linear())).toBeNull();
    expect(normalizeFrequencySelection({ lowHz: 0, highHz: 20 }, 0, linear())).toBeNull();
  });

  it('round-trips persisted data and rejects malformed legacy records', () => {
    const serialized = JSON.stringify({ lowHz: 25, highHz: 75 });
    expect(parseFrequencySelection(serialized, 1000, linear())).toEqual({ lowHz: 25, highHz: 75 });
    expect(parseFrequencySelection('{"lowHz":90,"highHz":10}', 1000, linear())).toEqual({ lowHz: 10, highHz: 90 });
    expect(parseFrequencySelection('not-json', 1000, linear())).toBeNull();
    expect(parseFrequencySelection(null, 1000, linear())).toBeNull();
  });

  it('clamps pointer and frequency coordinates at the canvas edges', () => {
    expect(spectrumYToFrequency(-10, 76, 1000, linear())).toBe(100);
    expect(spectrumYToFrequency(100, 76, 1000, linear())).toBe(0);
    expect(frequencyToSpectrumY(-1, 76, 1000, linear())).toBe(76);
    expect(frequencyToSpectrumY(101, 76, 1000, linear())).toBe(0);
  });

  it('derives the Audacity geometric center and natural-log bandwidth', () => {
    const selection = { lowHz: 25, highHz: 400 };
    expect(getFrequencySelectionCenterHz(selection)).toBe(100);
    expect(getFrequencySelectionLogBandwidth(selection)).toBeCloseTo(Math.log(16));
    expect(getFrequencySelectionCenterHz({ lowHz: 0, highHz: 100 })).toBeNull();
    expect(getFrequencySelectionLogBandwidth({ lowHz: 0, highHz: 100 })).toBeNull();
  });

  it('round-trips center and logarithmic bandwidth at the display boundary', () => {
    const next = createFrequencySelectionFromCenterBandwidth(100, Math.log(4), 2000, linear(200));
    expect(next?.lowHz).toBeCloseTo(50);
    expect(next?.highHz).toBeCloseTo(200);
    expect(getFrequencySelectionCenterHz(next!)).toBeCloseTo(100);
    expect(getFrequencySelectionLogBandwidth(next!)).toBeCloseTo(Math.log(4));
  });

  it('rejects invalid bounds instead of silently clamping toolbar input', () => {
    expect(createFrequencySelectionFromBounds(0, 100, 1000, linear())).toEqual({ lowHz: 0, highHz: 100 });
    expect(createFrequencySelectionFromBounds(-1, 50, 1000, linear())).toBeNull();
    expect(createFrequencySelectionFromBounds(60, 40, 1000, linear())).toBeNull();
    expect(createFrequencySelectionFromBounds(20, 20, 1000, linear())).toBeNull();
    expect(createFrequencySelectionFromBounds(20, 200, 1000, linear())).toBeNull();
    expect(createFrequencySelectionFromBounds(20, Number.NaN, 1000, linear())).toBeNull();
    expect(createFrequencySelectionFromBounds(20, 50, 0, linear())).toBeNull();
  });

  it('builds collision-aware frequency ticks with the same coordinates as spectral selection', () => {
    expect(getSpectrumRulerTicks(76, 1000, linear())).toEqual([
      { frequencyHz: 0, label: '0', y: 76 },
      { frequencyHz: 25, label: '25', y: 57 },
      { frequencyHz: 50, label: '50', y: 38 },
      { frequencyHz: 75, label: '75', y: 19 },
      { frequencyHz: 100, label: '100', y: 0 },
    ]);
    expect(getSpectrumRulerTicks(38, 1000, linear()).map((tick) => tick.frequencyHz)).toEqual([0, 50, 100]);
  });

  it('formats kHz labels and rejects invalid spectrum ruler geometry', () => {
    expect(getSpectrumRulerTicks(76, 44100, linear(4410)).map((tick) => tick.label)).toEqual(['0', '1.1k', '2.2k', '3.3k', '4.4k']);
    expect(getSpectrumRulerTicks(0, 44100, linear(4410))).toEqual([]);
    expect(getSpectrumRulerTicks(76, 0, linear(4410))).toEqual([]);
    expect(getSpectrumRulerTicks(Number.NaN, 44100, linear(4410))).toEqual([]);
  });
});
