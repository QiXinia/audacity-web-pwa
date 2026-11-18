import { describe, expect, it } from 'vitest';
import {
  computeAudacitySpectrogram,
  getSpectrogramFftLength,
  getSpectrogramWindowSamples,
  type SpectrogramAlgorithmOptions,
} from '@/lib/spectrogramAlgorithm';
import { SPECTROGRAM_WINDOW_TYPES } from '@/lib/spectrogramSettings';
import { wasmProcessor } from '@/wasm/processor';

function options(patch: Partial<SpectrogramAlgorithmOptions> = {}): SpectrogramAlgorithmOptions {
  return {
    algorithm: 'frequencies',
    windowType: 'hann',
    windowSize: 64,
    zeroPaddingFactor: 2,
    ...patch,
  };
}

function sine(length: number, cyclesPerSample = 1 / 8): Float32Array {
  return Float32Array.from({ length }, (_, index) => Math.sin(2 * Math.PI * cyclesPerSample * index));
}

function peakBin(data: Float32Array, frame: number, bins: number): number {
  let peak = 0;
  for (let bin = 1; bin < bins; bin++) {
    if (data[frame * bins + bin]! > data[frame * bins + peak]!) peak = bin;
  }
  return peak;
}

describe('Audacity spectrogram algorithms', () => {
  it('computes a normalized Hann frequency peak at the zero-padded FFT bin', () => {
    const result = computeAudacitySpectrogram(sine(512), options(), 64);
    expect(result.fftLength).toBe(128);
    expect(result.numBins).toBe(64);
    expect(result.numFrames).toBe(8);
    expect(peakBin(result.data, 4, result.numBins)).toBe(16);
    expect(Math.max(...result.data)).toBeGreaterThan(0);
    expect(Array.from(result.data).every(Number.isFinite)).toBe(true);
  });

  it('doubles frequency resolution with zero padding and omits the Nyquist bin', () => {
    const unpadded = computeAudacitySpectrogram(sine(256), options({ zeroPaddingFactor: 1 }), 64);
    const padded = computeAudacitySpectrogram(sine(256), options({ zeroPaddingFactor: 2 }), 64);
    expect(unpadded.fftLength).toBe(64);
    expect(unpadded.numBins).toBe(32);
    expect(padded.fftLength).toBe(128);
    expect(padded.numBins).toBe(64);
    expect(padded.numFrames).toBe(unpadded.numFrames);
    expect(peakBin(padded.data, 2, padded.numBins)).toBe(2 * peakBin(unpadded.data, 2, unpadded.numBins));
  });

  it('implements all ten Audacity window types with distinct real spectra', () => {
    const signatures = new Set<string>();
    for (const windowType of SPECTROGRAM_WINDOW_TYPES) {
      const result = computeAudacitySpectrogram(sine(256), options({ windowType, zeroPaddingFactor: 1 }), 64);
      expect(result.data.length).toBe(4 * 32);
      expect(Array.from(result.data).every(Number.isFinite)).toBe(true);
      expect(Math.max(...result.data)).toBeGreaterThan(0);
      signatures.add(Array.from(result.data.slice(32, 48), (value) => value.toFixed(5)).join(','));
    }
    expect(signatures.size).toBe(SPECTROGRAM_WINDOW_TYPES.length);
  });

  it('matches Audacity Hann and Hamming extra-sample window semantics', () => {
    const hann = getSpectrogramWindowSamples('hann', 65, true).values;
    expect(hann).toHaveLength(65);
    expect(hann[0]).toBe(0);
    expect(hann[32]).toBeCloseTo(1);
    expect(hann[64]).toBe(0);
    const hamming = getSpectrogramWindowSamples('hamming', 65, true).values;
    expect(hamming[0]).toBeCloseTo(0.08);
    expect(hamming[64]).toBeCloseTo(0.08);
  });

  it('runs three-window Reassignment instead of reusing the ordinary Hann spectrum', () => {
    const input = sine(256);
    const frequencies = computeAudacitySpectrogram(input, options(), 64);
    const reassigned = computeAudacitySpectrogram(input, options({ algorithm: 'reassignment' }), 64);
    expect(reassigned.data).toHaveLength(frequencies.data.length);
    expect(Array.from(reassigned.data).every(Number.isFinite)).toBe(true);
    expect(Math.max(...reassigned.data)).toBeGreaterThan(0);
    expect(Array.from(reassigned.data)).not.toEqual(Array.from(frequencies.data));
  });

  it('uses autocorrelation for Pitch and forces zero padding factor 1', () => {
    const pitch = options({ algorithm: 'pitch', zeroPaddingFactor: 16 });
    const result = computeAudacitySpectrogram(sine(256), pitch, 64);
    const factorOne = computeAudacitySpectrogram(sine(256), { ...pitch, zeroPaddingFactor: 1 }, 64);
    expect(getSpectrogramFftLength(pitch)).toBe(64);
    expect(result.fftLength).toBe(64);
    expect(result.numBins).toBe(32);
    expect(Array.from(result.data).every(Number.isFinite)).toBe(true);
    expect(Math.max(...result.data)).toBeGreaterThan(0);
    expect(result.data).toEqual(factorOne.data);
  });

  it('routes explicit settings through wasmProcessor without silently using legacy Hann-only WASM', () => {
    const input = sine(128);
    const expected = computeAudacitySpectrogram(input, options({ windowType: 'rectangular' }), 64);
    const actual = wasmProcessor.spectrogram(input, 64, 64, options({ windowType: 'rectangular' }));
    expect(actual).toEqual(expected.data);
  });

  it('supports the official window and zero-padding boundaries on bounded one-frame inputs', () => {
    const smallest = computeAudacitySpectrogram(sine(8), options({ windowSize: 8, zeroPaddingFactor: 16 }), 8);
    expect(smallest.fftLength).toBe(128);
    expect(smallest.numFrames).toBe(1);
    expect(smallest.data).toHaveLength(64);
    const largest = computeAudacitySpectrogram(sine(8), options({ windowSize: 32768, zeroPaddingFactor: 16 }), 8);
    expect(largest.fftLength).toBe(524288);
    expect(largest.numFrames).toBe(1);
    expect(largest.data).toHaveLength(262144);
    expect(Array.from(largest.data).every(Number.isFinite)).toBe(true);
  });

  it('returns an empty, bounded result for empty input', () => {
    const result = computeAudacitySpectrogram(new Float32Array(), options(), 64);
    expect(result.numFrames).toBe(0);
    expect(result.data).toHaveLength(0);
    expect(result.fftLength).toBe(128);
  });
});
