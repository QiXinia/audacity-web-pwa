import type { ISpectrogramSettings } from '@/types/project';
import { spectrumYToFrequency } from '@/lib/spectralSelection';
import {
  getSpectrogramColorValue,
  getSpectrogramHighBoostDb,
} from '@/lib/spectrogramSettings';

/** Convert one full-resolution spectrum column to the visible color values. */
export function getSpectrogramFrameColorValues(
  frameData: ArrayLike<number>,
  fftLength: number,
  height: number,
  sampleRate: number,
  settings: ISpectrogramSettings,
): Float32Array {
  const result = new Float32Array(height);
  const specLen = fftLength / 2;
  const hzPerBin = sampleRate / fftLength;
  const maxBin = Math.min(specLen - 1, Math.floor(settings.maxFreq / hzPerBin));

  // Audacity findValue: Frequencies/Reassignment use dB; Pitch uses autocorrelation directly.
  for (let pixelY = 0; pixelY < height; pixelY++) {
    const highHz = spectrumYToFrequency(pixelY, height, sampleRate, settings);
    const lowHz = spectrumYToFrequency(pixelY + 1, height, sampleRate, settings);
    if (settings.algorithm === 'pitch') {
      const bin0 = lowHz / hzPerBin;
      const bin1 = highHz / hzPerBin;
      let index = Math.trunc(Math.max(0, Math.min(specLen - 1,
        (specLen - 1) - (2 * specLen) / Math.max(1, bin0))));
      const limitIndex = Math.trunc(Math.max(0, Math.min(specLen - 1,
        (specLen - 1) - (2 * specLen) / Math.max(1, bin1))));
      let maximum = Number.isFinite(frameData[index]) ? frameData[index]! : 0;
      while (++index < limitIndex) {
        const sample = frameData[index];
        if (Number.isFinite(sample)) maximum = Math.max(maximum, sample!);
      }
      result[pixelY] = Math.max(0, Math.min(1, maximum));
      continue;
    }

    const firstBin = Math.max(0, Math.min(maxBin, Math.floor(lowHz / hzPerBin + 0.5)));
    const limitBin = Math.min(maxBin + 1, Math.max(firstBin + 1, Math.floor(highHz / hzPerBin + 0.5)));
    let maximumDb = -Infinity;
    for (let bin = firstBin; bin < limitBin; bin++) {
      const magnitude = frameData[bin];
      if (!Number.isFinite(magnitude)) continue;
      const db = 20 * Math.log10(Math.max(magnitude, 1e-10))
        + getSpectrogramHighBoostDb(bin, fftLength, sampleRate, settings.highBoostDbPerDec);
      maximumDb = Math.max(maximumDb, db);
    }
    result[pixelY] = getSpectrogramColorValue(maximumDb, settings);
  }
  return result;
}
