// Audacity spectral selection is a frequency range independent of the time range.
// The current spectrogram overview displays the first 20% of Nyquist linearly.
import { clamp } from '@/lib/audioUtils';

export interface FrequencySelection {
  lowHz: number;
  highHz: number;
}

export const SPECTRUM_DISPLAY_NYQUIST_FRACTION = 0.2;

export function getSpectrumDisplayMaxHz(sampleRate: number): number {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) return 0;
  return (sampleRate / 2) * SPECTRUM_DISPLAY_NYQUIST_FRACTION;
}

export function normalizeFrequencySelection(
  value: unknown,
  sampleRate: number,
): FrequencySelection | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<FrequencySelection>;
  if (!Number.isFinite(candidate.lowHz) || !Number.isFinite(candidate.highHz)) return null;
  const maxHz = getSpectrumDisplayMaxHz(sampleRate);
  if (maxHz <= 0) return null;
  const lowHz = clamp(Math.min(candidate.lowHz!, candidate.highHz!), 0, maxHz);
  const highHz = clamp(Math.max(candidate.lowHz!, candidate.highHz!), 0, maxHz);
  return highHz > lowHz ? { lowHz, highHz } : null;
}

export function getFrequencySelectionCenterHz(
  selection: FrequencySelection,
): number | null {
  if (!(selection.lowHz > 0) || !(selection.highHz > selection.lowHz)) return null;
  return Math.sqrt(selection.lowHz * selection.highHz);
}

export function getFrequencySelectionLogBandwidth(
  selection: FrequencySelection,
): number | null {
  if (!(selection.lowHz > 0) || !(selection.highHz > selection.lowHz)) return null;
  return Math.log(selection.highHz / selection.lowHz);
}

export function createFrequencySelectionFromBounds(
  lowHz: number,
  highHz: number,
  sampleRate: number,
): FrequencySelection | null {
  const maxHz = getSpectrumDisplayMaxHz(sampleRate);
  if (!Number.isFinite(lowHz) || !Number.isFinite(highHz) || maxHz <= 0) return null;
  if (lowHz < 0 || highHz <= lowHz || highHz > maxHz) return null;
  return { lowHz, highHz };
}

export function createFrequencySelectionFromCenterBandwidth(
  centerHz: number,
  logBandwidth: number,
  sampleRate: number,
): FrequencySelection | null {
  if (!Number.isFinite(centerHz) || !Number.isFinite(logBandwidth)) return null;
  if (centerHz <= 0 || logBandwidth <= 0) return null;
  const ratio = Math.exp(logBandwidth / 2);
  if (!Number.isFinite(ratio) || ratio <= 1) return null;
  return createFrequencySelectionFromBounds(centerHz / ratio, centerHz * ratio, sampleRate);
}

export function parseFrequencySelection(
  data: string | null | undefined,
  sampleRate: number,
): FrequencySelection | null {
  if (!data) return null;
  try {
    return normalizeFrequencySelection(JSON.parse(data), sampleRate);
  } catch {
    return null;
  }
}

export function spectrumYToFrequency(
  y: number,
  height: number,
  sampleRate: number,
): number {
  const maxHz = getSpectrumDisplayMaxHz(sampleRate);
  if (maxHz <= 0 || !Number.isFinite(height) || height <= 0 || !Number.isFinite(y)) return 0;
  const ratio = 1 - clamp(y, 0, height) / height;
  return clamp(ratio * maxHz, 0, maxHz);
}

export function frequencyToSpectrumY(
  frequencyHz: number,
  height: number,
  sampleRate: number,
): number {
  const maxHz = getSpectrumDisplayMaxHz(sampleRate);
  if (maxHz <= 0 || !Number.isFinite(height) || height <= 0 || !Number.isFinite(frequencyHz)) return 0;
  return clamp(height - (clamp(frequencyHz, 0, maxHz) / maxHz) * height, 0, height);
}
