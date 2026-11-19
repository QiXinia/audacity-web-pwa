import { describe, expect, it } from 'vitest';
import {
  applySpectrogramPowerCorrections,
  createSpectrogramBinRanges,
  getSpectrogramColorValuesFromDbMaxima,
  getSpectrogramFrameColorValues,
  getSpectrogramFrameDbMaxima,
} from '@/lib/spectrogramDisplay';
import { getOfficialSpectrogramDefaults, SPECTROGRAM_SCALES } from '@/lib/spectrogramSettings';

describe('spectrogram sparse power corrections', () => {
  it('matches full-column colors for every scale, including high-frequency boost', () => {
    const sampleRate = 48000;
    const fftLength = 64;
    const height = 37;
    const initial = Float32Array.from({ length: fftLength / 2 }, (_, bin) => bin / 1000);
    const corrected = initial.slice();
    const corrections = new Map<number, number>();
    for (const bin of [0, 1, 5, 17, 31]) {
      const power = (10 + bin) ** 2;
      corrections.set(bin, power);
      corrected[bin] = Math.sqrt(power);
    }

    for (const scale of SPECTROGRAM_SCALES) {
      const settings = {
        ...getOfficialSpectrogramDefaults(sampleRate),
        scale,
        minFreq: 20,
        maxFreq: 20000,
        highBoostDbPerDec: 6,
        algorithm: 'reassignment' as const,
        windowSize: fftLength,
        zeroPaddingFactor: 1,
      };
      const ranges = createSpectrogramBinRanges(fftLength, height, sampleRate, settings);
      const initialMaxima = getSpectrogramFrameDbMaxima(
        initial, fftLength, height, sampleRate, settings, ranges,
      );
      expect(getSpectrogramColorValuesFromDbMaxima(initialMaxima, settings)).toEqual(
        getSpectrogramFrameColorValues(initial, fftLength, height, sampleRate, settings),
      );
      const correctedMaxima = applySpectrogramPowerCorrections(
        initialMaxima, corrections, fftLength, height, sampleRate, settings, ranges,
      );
      expect(getSpectrogramColorValuesFromDbMaxima(correctedMaxima, settings)).toEqual(
        getSpectrogramFrameColorValues(corrected, fftLength, height, sampleRate, settings),
      );
    }
  });
});
