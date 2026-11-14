import { describe, expect, it } from 'vitest';
import {
  frequencyToSpectrumY,
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
});
