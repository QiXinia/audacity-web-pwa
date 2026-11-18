// Audacity spectral selection is a frequency range independent of the time range.
import { clamp } from '@/lib/audioUtils';
import {
  getDefaultSpectrogramSettings,
  normalizeSpectrogramSettings,
  spectrogramFrequencyToY,
  spectrogramPositionToFrequency,
  spectrogramYToFrequency,
} from '@/lib/spectrogramSettings';
import type { ISpectrogramSettings } from '@/types/project';

export interface FrequencySelection {
  lowHz: number;
  highHz: number;
}

export function getSpectrumDisplayMaxHz(
  sampleRate: number,
  settings?: Partial<ISpectrogramSettings>,
): number {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) return 0;
  return normalizeSpectrogramSettings(settings ?? getDefaultSpectrogramSettings(sampleRate), sampleRate).maxFreq;
}

export function normalizeFrequencySelection(
  value: unknown,
  sampleRate: number,
  settings?: Partial<ISpectrogramSettings>,
): FrequencySelection | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<FrequencySelection>;
  if (!Number.isFinite(candidate.lowHz) || !Number.isFinite(candidate.highHz)) return null;
  const resolved = normalizeSpectrogramSettings(settings, sampleRate);
  const maxHz = resolved.maxFreq;
  if (maxHz <= resolved.minFreq) return null;
  const lowHz = clamp(Math.min(candidate.lowHz!, candidate.highHz!), resolved.minFreq, maxHz);
  const highHz = clamp(Math.max(candidate.lowHz!, candidate.highHz!), resolved.minFreq, maxHz);
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
  settings?: Partial<ISpectrogramSettings>,
): FrequencySelection | null {
  const resolved = normalizeSpectrogramSettings(settings, sampleRate);
  const maxHz = resolved.maxFreq;
  if (!Number.isFinite(lowHz) || !Number.isFinite(highHz) || maxHz <= resolved.minFreq) return null;
  if (lowHz < resolved.minFreq || highHz <= lowHz || highHz > maxHz) return null;
  return { lowHz, highHz };
}

export function createFrequencySelectionFromCenterBandwidth(
  centerHz: number,
  logBandwidth: number,
  sampleRate: number,
  settings?: Partial<ISpectrogramSettings>,
): FrequencySelection | null {
  if (!Number.isFinite(centerHz) || !Number.isFinite(logBandwidth)) return null;
  if (centerHz <= 0 || logBandwidth <= 0) return null;
  const ratio = Math.exp(logBandwidth / 2);
  if (!Number.isFinite(ratio) || ratio <= 1) return null;
  return createFrequencySelectionFromBounds(centerHz / ratio, centerHz * ratio, sampleRate, settings);
}

export function parseFrequencySelection(
  data: string | null | undefined,
  sampleRate: number,
  settings?: Partial<ISpectrogramSettings>,
): FrequencySelection | null {
  if (!data) return null;
  try {
    return normalizeFrequencySelection(JSON.parse(data), sampleRate, settings);
  } catch {
    return null;
  }
}

export function spectrumYToFrequency(
  y: number,
  height: number,
  sampleRate: number,
  settings?: Partial<ISpectrogramSettings>,
): number {
  return spectrogramYToFrequency(y, height, sampleRate, settings);
}

export function frequencyToSpectrumY(
  frequencyHz: number,
  height: number,
  sampleRate: number,
  settings?: Partial<ISpectrogramSettings>,
): number {
  return spectrogramFrequencyToY(frequencyHz, height, sampleRate, settings);
}

export interface SpectrumRulerTick {
  frequencyHz: number;
  label: string;
  y: number;
}

function formatSpectrumRulerFrequency(frequencyHz: number): string {
  if (frequencyHz >= 1000) {
    const kHz = frequencyHz / 1000;
    return `${Number(kHz.toFixed(1))}k`;
  }
  return `${Number(frequencyHz.toFixed(frequencyHz < 10 ? 1 : 0))}`;
}

/** Ticks share the exact Audacity NumberScale mapping used by selections and pixels. */
export function getSpectrumRulerTicks(
  height: number,
  sampleRate: number,
  settings?: Partial<ISpectrogramSettings>,
): SpectrumRulerTick[] {
  const resolved = normalizeSpectrogramSettings(settings, sampleRate);
  if (!(resolved.maxFreq > resolved.minFreq) || !Number.isFinite(height) || height <= 0) return [];
  const fractions = height >= 60 ? [0, 0.25, 0.5, 0.75, 1] : [0, 0.5, 1];
  return fractions.map((fraction) => {
    const frequencyHz = spectrogramPositionToFrequency(fraction, sampleRate, resolved);
    return {
      frequencyHz,
      label: formatSpectrumRulerFrequency(frequencyHz),
      y: frequencyToSpectrumY(frequencyHz, height, sampleRate, resolved),
    };
  });
}
