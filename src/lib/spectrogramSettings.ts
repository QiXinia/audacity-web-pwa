import type {
  IProject,
  ISpectrogramSettings,
  ITrack,
  SpectrogramColorScheme,
  SpectrogramScale,
} from '@/types/project';
import { clamp } from '@/lib/audioUtils';
import { ROSEUS_COLOR_MAP } from '@/lib/spectrogramRoseus';

export const SPECTROGRAM_SCALES: readonly SpectrogramScale[] = [
  'linear', 'logarithmic', 'mel', 'bark', 'erb', 'period',
];
export const SPECTROGRAM_COLOR_SCHEMES: readonly SpectrogramColorScheme[] = [
  'roseus', 'classic', 'grayscale', 'inverse-grayscale',
];

/** Audacity 4.0.2 GlobalSpectrogramConfiguration::init defaults. */
export function getDefaultSpectrogramSettings(sampleRate: number): ISpectrogramSettings {
  const nyquist = Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate / 2 : 0;
  return {
    scale: 'mel',
    minFreq: 0,
    maxFreq: Math.min(20000, nyquist),
    gainDb: 20,
    rangeDb: 80,
    highBoostDbPerDec: 0,
    colorScheme: 'roseus',
  };
}

function finiteInteger(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : fallback;
}

export function normalizeSpectrogramSettings(
  value: Partial<ISpectrogramSettings> | null | undefined,
  sampleRate: number,
): ISpectrogramSettings {
  const defaults = getDefaultSpectrogramSettings(sampleRate);
  const nyquist = defaults.maxFreq > 0 || sampleRate > 20000 ? sampleRate / 2 : 0;
  if (!Number.isFinite(nyquist) || nyquist <= 0) return { ...defaults, maxFreq: 0 };
  const scale = SPECTROGRAM_SCALES.includes(value?.scale as SpectrogramScale)
    ? value!.scale as SpectrogramScale
    : defaults.scale;
  const colorScheme = SPECTROGRAM_COLOR_SCHEMES.includes(value?.colorScheme as SpectrogramColorScheme)
    ? value!.colorScheme as SpectrogramColorScheme
    : defaults.colorScheme;
  let minFreq = clamp(finiteInteger(value?.minFreq, defaults.minFreq), 0, Math.max(0, Math.floor(nyquist) - 1));
  let maxFreq = clamp(finiteInteger(value?.maxFreq, defaults.maxFreq), 1, Math.floor(nyquist));
  if ((scale === 'logarithmic' || scale === 'period') && nyquist > 1) minFreq = Math.max(1, minFreq);
  if (minFreq >= maxFreq) {
    if (minFreq < maxFreq + 1 && minFreq < nyquist) maxFreq = minFreq + 1;
    else minFreq = Math.max(scale === 'logarithmic' || scale === 'period' ? 1 : 0, maxFreq - 1);
  }
  if (minFreq >= maxFreq) return { ...defaults, maxFreq: Math.floor(nyquist) };
  return {
    scale,
    minFreq,
    maxFreq,
    gainDb: finiteInteger(value?.gainDb, defaults.gainDb),
    rangeDb: Math.max(1, finiteInteger(value?.rangeDb, defaults.rangeDb)),
    highBoostDbPerDec: clamp(finiteInteger(value?.highBoostDbPerDec, defaults.highBoostDbPerDec), 0, 60),
    colorScheme,
  };
}

export function isTrackSpectrogramUsingGlobalSettings(track: ITrack): boolean {
  return track.spectrogramUseGlobalSettings !== false;
}

export function getTrackSpectrogramSettings(track: ITrack | null | undefined, sampleRate: number): ISpectrogramSettings {
  return track && !isTrackSpectrogramUsingGlobalSettings(track) && track.spectrogramSettings
    ? normalizeSpectrogramSettings(track.spectrogramSettings, sampleRate)
    : getDefaultSpectrogramSettings(sampleRate);
}

export function updateTrackSpectrogramSettings(
  project: IProject,
  trackId: string,
  settings: ISpectrogramSettings,
  useGlobalSettings: boolean,
): IProject {
  const current = project.tracks.find((track) => track.id === trackId);
  if (!current) return project;
  const nextSettings = useGlobalSettings ? undefined : normalizeSpectrogramSettings(settings, project.sampleRate);
  if (isTrackSpectrogramUsingGlobalSettings(current) === useGlobalSettings
    && JSON.stringify(current.spectrogramSettings) === JSON.stringify(nextSettings)) return project;
  return {
    ...project,
    tracks: project.tracks.map((track) => track.id === trackId ? {
      ...track,
      spectrogramUseGlobalSettings: useGlobalSettings,
      spectrogramSettings: nextSettings,
    } : track),
  };
}

// NumberScale in Audacity 4.0.2 src/shared/axis/numberscale.h.
export function hzToMel(hz: number): number { return 1127 * Math.log(1 + hz / 700); }
export function melToHz(mel: number): number { return 700 * Math.exp(mel / 1127) - 700; }
export function hzToBark(hz: number): number {
  const z1 = 26.81 * hz / (1960 + hz) - 0.53;
  return z1 < 2 ? z1 + 0.15 * (2 - z1) : z1 > 20.1 ? z1 + 0.22 * (z1 - 20.1) : z1;
}
export function barkToHz(bark: number): number {
  const z1 = bark < 2 ? 2 + (bark - 2) / 0.85 : bark > 20.1 ? 20.1 + (bark - 20.1) / 1.22 : bark;
  return 1960 * (z1 + 0.53) / (26.28 - z1);
}
export function hzToErb(hz: number): number {
  return 11.17268 * Math.log(1 + (46.06538 * hz) / (hz + 14678.49));
}
export function erbToHz(erb: number): number {
  return 676170.4 / (47.06538 - Math.exp(0.08950404 * erb)) - 14678.49;
}

function forward(scale: SpectrogramScale, hz: number): number {
  switch (scale) {
    case 'logarithmic': return Math.log(Math.max(1, hz));
    case 'mel': return hzToMel(hz);
    case 'bark': return hzToBark(hz);
    case 'erb': return hzToErb(hz);
    case 'period': return -1 / Math.max(1, hz);
    default: return hz;
  }
}

function inverse(scale: SpectrogramScale, value: number): number {
  switch (scale) {
    case 'logarithmic': return Math.exp(value);
    case 'mel': return melToHz(value);
    case 'bark': return barkToHz(value);
    case 'erb': return erbToHz(value);
    case 'period': return -1 / value;
    default: return value;
  }
}

/** Position 0 is the lower frequency edge; position 1 is the upper edge. */
export function spectrogramPositionToFrequency(
  position: number,
  sampleRate: number,
  value?: Partial<ISpectrogramSettings>,
): number {
  const settings = normalizeSpectrogramSettings(value, sampleRate);
  if (!(settings.maxFreq > settings.minFreq) || !Number.isFinite(position)) return settings.minFreq;
  const first = forward(settings.scale, settings.minFreq);
  const second = forward(settings.scale, settings.maxFreq);
  const result = inverse(settings.scale, first + clamp(position, 0, 1) * (second - first));
  return clamp(result, settings.minFreq, settings.maxFreq);
}

export function spectrogramFrequencyToPosition(
  frequencyHz: number,
  sampleRate: number,
  value?: Partial<ISpectrogramSettings>,
): number {
  const settings = normalizeSpectrogramSettings(value, sampleRate);
  if (!(settings.maxFreq > settings.minFreq) || !Number.isFinite(frequencyHz)) return 0;
  const first = forward(settings.scale, settings.minFreq);
  const second = forward(settings.scale, settings.maxFreq);
  if (second === first) return 0;
  const frequency = clamp(frequencyHz, settings.minFreq, settings.maxFreq);
  return clamp((forward(settings.scale, frequency) - first) / (second - first), 0, 1);
}

export function spectrogramYToFrequency(
  y: number,
  height: number,
  sampleRate: number,
  value?: Partial<ISpectrogramSettings>,
): number {
  const settings = normalizeSpectrogramSettings(value, sampleRate);
  if (!Number.isFinite(height) || height <= 0 || !Number.isFinite(y)) return settings.minFreq;
  return spectrogramPositionToFrequency(1 - clamp(y, 0, height) / height, sampleRate, settings);
}

export function spectrogramFrequencyToY(
  frequencyHz: number,
  height: number,
  sampleRate: number,
  value?: Partial<ISpectrogramSettings>,
): number {
  if (!Number.isFinite(height) || height <= 0 || !Number.isFinite(frequencyHz)) return 0;
  return height * (1 - spectrogramFrequencyToPosition(frequencyHz, sampleRate, value));
}

/** Official findValue normalization; spectrumDb already includes frequency high boost. */
export function getSpectrogramColorValue(
  spectrumDb: number,
  settings: Pick<ISpectrogramSettings, 'gainDb' | 'rangeDb'>,
): number {
  if (!Number.isFinite(spectrumDb)) return 0;
  return clamp((spectrumDb + settings.rangeDb + settings.gainDb) / Math.max(1, settings.rangeDb), 0, 1);
}

/** SpectrumCache.cpp: 1000 Hz is 0 dB and bin zero uses the first bin's factor. */
export function getSpectrogramHighBoostDb(
  bin: number,
  fftLength: number,
  sampleRate: number,
  highBoostDbPerDec: number,
): number {
  if (highBoostDbPerDec <= 0 || !(fftLength > 0) || !(sampleRate > 0)) return 0;
  const frequencyHz = Math.max(1, bin) * sampleRate / fftLength;
  return highBoostDbPerDec * Math.log10(frequencyHz / 1000);
}

const CLASSIC_COLORS: ReadonlyArray<readonly [number, number, number]> = [
  [191, 191, 191], [76, 153, 255], [229, 25, 229], [255, 0, 0], [255, 255, 255],
];

export function getSpectrogramRgb(
  value: number,
  scheme: SpectrogramColorScheme,
): readonly [number, number, number] {
  const index = Math.floor(clamp(value, 0, 1) * 255);
  if (scheme === 'roseus') return ROSEUS_COLOR_MAP[index]!;
  if (scheme === 'grayscale') {
    const channel = Math.trunc(255 * (0.84 - 0.84 * index / 256));
    return [channel, channel, channel];
  }
  if (scheme === 'inverse-grayscale') {
    const channel = Math.trunc(255 * index / 256);
    return [channel, channel, channel];
  }
  const position = index / 256 * 4;
  const left = Math.min(4, Math.floor(position));
  const right = Math.min(4, left + 1);
  const weight = position - left;
  return CLASSIC_COLORS[left]!.map((channel, channelIndex) => Math.trunc(
    channel * (1 - weight) + CLASSIC_COLORS[right]![channelIndex]! * weight,
  )) as unknown as readonly [number, number, number];
}
