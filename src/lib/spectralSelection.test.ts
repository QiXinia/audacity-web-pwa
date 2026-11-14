import { describe, expect, it } from 'vitest';
import {
  createFrequencySelectionFromBounds,
  createFrequencySelectionFromCenterBandwidth,
  frequencyToSpectrumY,
  getFrequencySelectionCenterHz,
  getFrequencySelectionLogBandwidth,
  getSpectrumDisplayMaxHz,
  normalizeFrequencySelection,
  parseFrequencySelection,
  spectrumYToFrequency,
} from '@/lib/spectralSelection';

describe('spectral frequency selection', () => {
  it('maps the linear spectrogram overview between zero and 20% of Nyquist', () => {
    expect(getSpectrumDisplayMaxHz(44100)).toBe(4410);
    expect(spectrumYToFrequency(76, 76, 1000)).toBe(0);
    expect(spectrumYToFrequency(0, 76, 1000)).toBe(100);
    expect(spectrumYToFrequency(38, 76, 1000)).toBe(50);
    expect(frequencyToSpectrumY(50, 76, 1000)).toBe(38);
    expect(frequencyToSpectrumY(spectrumYToFrequency(14, 76, 1000), 76, 1000)).toBe(14);
  });

  it('normalizes reverse drags and clamps both boundaries to the displayed range', () => {
    expect(normalizeFrequencySelection({ lowHz: 120, highHz: 20 }, 1000)).toEqual({
      lowHz: 20,
      highHz: 100,
    });
    expect(normalizeFrequencySelection({ lowHz: -5, highHz: 40 }, 1000)).toEqual({
      lowHz: 0,
      highHz: 40,
    });
  });

  it('rejects empty, non-finite and zero-height selections', () => {
    expect(normalizeFrequencySelection(null, 1000)).toBeNull();
    expect(normalizeFrequencySelection({ lowHz: Number.NaN, highHz: 20 }, 1000)).toBeNull();
    expect(normalizeFrequencySelection({ lowHz: 20, highHz: 20 }, 1000)).toBeNull();
    expect(normalizeFrequencySelection({ lowHz: 0, highHz: 20 }, 0)).toBeNull();
  });

  it('round-trips persisted data and rejects malformed legacy records', () => {
    const serialized = JSON.stringify({ lowHz: 25, highHz: 75 });
    expect(parseFrequencySelection(serialized, 1000)).toEqual({ lowHz: 25, highHz: 75 });
    expect(parseFrequencySelection('{"lowHz":90,"highHz":10}', 1000)).toEqual({ lowHz: 10, highHz: 90 });
    expect(parseFrequencySelection('not-json', 1000)).toBeNull();
    expect(parseFrequencySelection(null, 1000)).toBeNull();
  });

  it('clamps pointer and frequency coordinates at the canvas edges', () => {
    expect(spectrumYToFrequency(-10, 76, 1000)).toBe(100);
    expect(spectrumYToFrequency(100, 76, 1000)).toBe(0);
    expect(frequencyToSpectrumY(-1, 76, 1000)).toBe(76);
    expect(frequencyToSpectrumY(101, 76, 1000)).toBe(0);
  });

  it('derives the Audacity geometric center and natural-log bandwidth', () => {
    const selection = { lowHz: 25, highHz: 400 };
    expect(getFrequencySelectionCenterHz(selection)).toBe(100);
    expect(getFrequencySelectionLogBandwidth(selection)).toBeCloseTo(Math.log(16));
    expect(getFrequencySelectionCenterHz({ lowHz: 0, highHz: 100 })).toBeNull();
    expect(getFrequencySelectionLogBandwidth({ lowHz: 0, highHz: 100 })).toBeNull();
  });

  it('round-trips center and logarithmic bandwidth at the display boundary', () => {
    const next = createFrequencySelectionFromCenterBandwidth(100, Math.log(4), 2000);
    expect(next?.lowHz).toBeCloseTo(50);
    expect(next?.highHz).toBeCloseTo(200);
    expect(getFrequencySelectionCenterHz(next!)).toBeCloseTo(100);
    expect(getFrequencySelectionLogBandwidth(next!)).toBeCloseTo(Math.log(4));
  });

  it('rejects invalid bounds instead of silently clamping toolbar input', () => {
    expect(createFrequencySelectionFromBounds(0, 100, 1000)).toEqual({ lowHz: 0, highHz: 100 });
    expect(createFrequencySelectionFromBounds(-1, 50, 1000)).toBeNull();
    expect(createFrequencySelectionFromBounds(60, 40, 1000)).toBeNull();
    expect(createFrequencySelectionFromBounds(20, 20, 1000)).toBeNull();
    expect(createFrequencySelectionFromBounds(20, 200, 1000)).toBeNull();
    expect(createFrequencySelectionFromBounds(20, Number.NaN, 1000)).toBeNull();
    expect(createFrequencySelectionFromBounds(20, 50, 0)).toBeNull();
  });

  it('rejects zero-width, non-finite and out-of-display-range center edits', () => {
    expect(createFrequencySelectionFromCenterBandwidth(0, 1, 1000)).toBeNull();
    expect(createFrequencySelectionFromCenterBandwidth(50, 0, 1000)).toBeNull();
    expect(createFrequencySelectionFromCenterBandwidth(50, -1, 1000)).toBeNull();
    expect(createFrequencySelectionFromCenterBandwidth(50, Number.NaN, 1000)).toBeNull();
    expect(createFrequencySelectionFromCenterBandwidth(100, Math.log(9), 1000)).toBeNull();
    expect(createFrequencySelectionFromCenterBandwidth(50, Number.MAX_VALUE, 1000)).toBeNull();
  });
});
