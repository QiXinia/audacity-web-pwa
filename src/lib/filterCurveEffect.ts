import type { GeneratorSelection } from '@/lib/generatorEditing';
import type { IClip, ITrack } from '@/types/project';

/**
 * Audacity 4.0.2 Filter Curve EQ.
 *
 * EqualizationFilter.cpp uses a 16384-point real FFT, a Blackman-tapered FIR
 * derived from the dB envelope, and overlap-add convolution. EqualizationBase
 * centres that FIR and restores the original selection length. This module
 * preserves those semantics instead of substituting a biquad or generic EQ.
 */

export const FILTER_CURVE_EQ_WINDOW_SIZE = 16_384;
export const FILTER_CURVE_EQ_MIN_FILTER_LENGTH = 21;
export const FILTER_CURVE_EQ_MAX_FILTER_LENGTH = 8191;
export const FILTER_CURVE_EQ_MAX_POINTS = 200;
export const FILTER_CURVE_EQ_LO_FREQ = 20;
export const MAX_FILTER_CURVE_EQ_TOTAL_SAMPLES = 20_000_000;

export interface FilterCurvePoint {
  frequency: number;
  gainDb: number;
}

export interface FilterCurveEqSettings {
  points: FilterCurvePoint[];
  filterLength: number;
  linearFrequencyScale: boolean;
}

export interface FilterCurveEqPreset {
  name: string;
  points: FilterCurvePoint[];
}

export const DEFAULT_FILTER_CURVE_EQ_SETTINGS: Readonly<FilterCurveEqSettings> = Object.freeze({
  points: [],
  filterLength: FILTER_CURVE_EQ_MAX_FILTER_LENGTH,
  linearFrequencyScale: false,
});

// FactoryPresets in Audacity's EqualizationBase.cpp. Names are stable preset IDs.
export const FILTER_CURVE_EQ_PRESETS: readonly FilterCurveEqPreset[] = Object.freeze([
  { name: '100Hz Rumble', points: [
    { frequency: 20, gainDb: -80 }, { frequency: 49.237316986327, gainDb: -33.107692718506 },
    { frequency: 54.196034330446, gainDb: -29.553844451904 }, { frequency: 88.033573501041, gainDb: -6.923076629639 },
    { frequency: 95.871851182279, gainDb: -4.523078918457 }, { frequency: 108.957037410504, gainDb: -1.938461303711 },
    { frequency: 123.828171198057, gainDb: -0.73846244812 }, { frequency: 149.228077614658, gainDb: -0.092308044434 },
  ] },
  { name: 'AM Radio', points: [
    { frequency: 20, gainDb: -63.67 }, { frequency: 31, gainDb: -33.219 }, { frequency: 50, gainDb: -3.01 },
    { frequency: 63, gainDb: -0.106 }, { frequency: 100, gainDb: 0 }, { frequency: 2500, gainDb: 0 },
    { frequency: 4000, gainDb: -0.614 }, { frequency: 5000, gainDb: -8.059 }, { frequency: 8000, gainDb: -39.981 },
    { frequency: 20000, gainDb: -103.651 }, { frequency: 48000, gainDb: -164.485 },
  ] },
  { name: 'Bass Boost', points: [{ frequency: 100, gainDb: 9 }, { frequency: 500, gainDb: 0 }] },
  { name: 'Bass Cut', points: [{ frequency: 150, gainDb: -50 }, { frequency: 300, gainDb: 0 }] },
  { name: 'Low rolloff for speech', points: [
    { frequency: 50, gainDb: -120 }, { frequency: 60, gainDb: -50 }, { frequency: 65, gainDb: -24 },
    { frequency: 70, gainDb: -12 }, { frequency: 80, gainDb: -4 }, { frequency: 90, gainDb: -1 },
    { frequency: 100, gainDb: 0 },
  ] },
  { name: 'RIAA', points: [
    { frequency: 20, gainDb: 19.274 }, { frequency: 25, gainDb: 18.954 }, { frequency: 31, gainDb: 18.516 },
    { frequency: 40, gainDb: 17.792 }, { frequency: 50, gainDb: 16.946 }, { frequency: 63, gainDb: 15.852 },
    { frequency: 80, gainDb: 14.506 }, { frequency: 100, gainDb: 13.088 }, { frequency: 125, gainDb: 11.563 },
    { frequency: 160, gainDb: 9.809 }, { frequency: 200, gainDb: 8.219 }, { frequency: 250, gainDb: 6.677 },
    { frequency: 315, gainDb: 5.179 }, { frequency: 400, gainDb: 3.784 }, { frequency: 500, gainDb: 2.648 },
    { frequency: 630, gainDb: 1.642 }, { frequency: 800, gainDb: 0.751 }, { frequency: 1000, gainDb: 0 },
    { frequency: 1250, gainDb: -0.744 }, { frequency: 1600, gainDb: -1.643 }, { frequency: 2000, gainDb: -2.589 },
    { frequency: 2500, gainDb: -3.7 }, { frequency: 3150, gainDb: -5.038 }, { frequency: 4000, gainDb: -6.605 },
    { frequency: 5000, gainDb: -8.21 }, { frequency: 6300, gainDb: -9.98 }, { frequency: 8000, gainDb: -11.894 },
    { frequency: 10000, gainDb: -13.734 }, { frequency: 12500, gainDb: -15.609 }, { frequency: 16000, gainDb: -17.708 },
    { frequency: 20000, gainDb: -19.62 }, { frequency: 25000, gainDb: -21.542 }, { frequency: 48000, gainDb: -27.187 },
  ] },
  { name: 'Telephone', points: [
    { frequency: 20, gainDb: -94.087 }, { frequency: 200, gainDb: -14.254 }, { frequency: 250, gainDb: -7.243 },
    { frequency: 315, gainDb: -2.245 }, { frequency: 400, gainDb: -0.414 }, { frequency: 500, gainDb: 0 },
    { frequency: 2500, gainDb: 0 }, { frequency: 3150, gainDb: -0.874 }, { frequency: 4000, gainDb: -3.992 },
    { frequency: 5000, gainDb: -9.993 }, { frequency: 48000, gainDb: -88.117 },
  ] },
  { name: 'Treble Boost', points: [{ frequency: 4000, gainDb: 0 }, { frequency: 5000, gainDb: 9 }] },
  { name: 'Treble Cut', points: [{ frequency: 6000, gainDb: 0 }, { frequency: 10000, gainDb: -110 }] },
  { name: 'Walkie-talkie', points: [
    { frequency: 100, gainDb: -120 }, { frequency: 101, gainDb: 0 },
    { frequency: 2000, gainDb: 0 }, { frequency: 2001, gainDb: -120 },
  ] },
]);

export interface FilterCurveEqPlan {
  sampleRate: number;
  filterLength: number;
  signature: string;
  impulse: Float32Array;
  filterReal: Float32Array;
  filterImaginary: Float32Array;
}

export interface FilterCurveEqClipInput {
  clipId: string;
  sampleData: Float32Array[];
  sourceOffset: number;
}

export interface FilterCurveEqTrackInput {
  trackId: string;
  clips: FilterCurveEqClipInput[];
}

export interface FilterCurveEqClipResult {
  clipId: string;
  sampleData: Float32Array[];
}

export interface FilterCurveEqTrackResult {
  trackId: string;
  selectionChannels: Float32Array[];
  clips: FilterCurveEqClipResult[];
  plan?: FilterCurveEqPlan;
}

interface FftTables {
  points: number;
  bitReversed: Int32Array;
  sinTable: Float32Array;
}

const fround = Math.fround;
let fftTables: FftTables | undefined;

function getFftTables(): FftTables {
  if (fftTables) return fftTables;
  const points = FILTER_CURVE_EQ_WINDOW_SIZE / 2;
  const bitReversed = new Int32Array(points);
  const sinTable = new Float32Array(points * 2);
  for (let index = 0; index < points; index += 1) {
    let reversed = 0;
    for (let mask = points / 2; mask > 0; mask >>= 1) {
      reversed = (reversed >> 1) + ((index & mask) ? points : 0);
    }
    bitReversed[index] = reversed;
  }
  for (let index = 0; index < points; index += 1) {
    const angle = 2 * Math.PI * index / (2 * points);
    sinTable[bitReversed[index]] = fround(-Math.sin(angle));
    sinTable[bitReversed[index] + 1] = fround(-Math.cos(angle));
  }
  fftTables = { points, bitReversed, sinTable };
  return fftTables;
}

// Audacity RealFFTf.cpp, including its float state and bit-reversed layout.
function realFft(buffer: Float32Array, tables: FftTables): void {
  const { points, bitReversed, sinTable } = tables;
  const end = points * 2;
  for (let butterflies = points / 2; butterflies > 0; butterflies >>= 1) {
    let a = 0;
    let b = butterflies * 2;
    let sineIndex = 0;
    while (a < end) {
      const sine = sinTable[sineIndex];
      const cosine = sinTable[sineIndex + 1];
      const groupEnd = b;
      while (a < groupEnd) {
        const a0 = buffer[a];
        const b0 = buffer[b];
        const v1 = fround(fround(b0 * cosine) + fround(buffer[b + 1] * sine));
        const v2 = fround(fround(b0 * sine) - fround(buffer[b + 1] * cosine));
        const sum = fround(a0 + v1);
        buffer[b] = sum;
        buffer[a] = fround(sum - fround(2 * v1));
        a += 1; b += 1;
        const difference = fround(buffer[a] - v2);
        buffer[b] = difference;
        buffer[a] = fround(difference + fround(2 * v2));
        a += 1; b += 1;
      }
      a = b;
      b += butterflies * 2;
      sineIndex += 2;
    }
  }
  let left = 1;
  let right = points - 1;
  while (left < right) {
    const sine = sinTable[bitReversed[left]];
    const cosine = sinTable[bitReversed[left] + 1];
    const a = bitReversed[left];
    const b = bitReversed[right];
    const hrMinus = fround(buffer[a] - buffer[b]);
    const hrPlus = fround(hrMinus + fround(buffer[b] * 2));
    const hiMinus = fround(buffer[a + 1] - buffer[b + 1]);
    const hiPlus = fround(hiMinus + fround(buffer[b + 1] * 2));
    const v1 = fround(fround(sine * hrMinus) - fround(cosine * hiPlus));
    const v2 = fround(fround(cosine * hrMinus) + fround(sine * hiPlus));
    buffer[a] = fround(fround(hrPlus + v1) * 0.5);
    buffer[b] = fround(buffer[a] - v1);
    buffer[a + 1] = fround(fround(hiMinus + v2) * 0.5);
    buffer[b + 1] = fround(buffer[a + 1] - hiMinus);
    left += 1; right -= 1;
  }
  const center = bitReversed[left] + 1;
  buffer[center] = -buffer[center];
  const nyquist = fround(buffer[0] - buffer[1]);
  buffer[0] = fround(buffer[0] + buffer[1]);
  buffer[1] = nyquist;
}

function inverseRealFft(buffer: Float32Array, tables: FftTables): void {
  const { points, bitReversed, sinTable } = tables;
  let a = 2;
  let b = points * 2 - 2;
  let reversedIndex = 1;
  while (a < b) {
    const sine = sinTable[bitReversed[reversedIndex]];
    const cosine = sinTable[bitReversed[reversedIndex] + 1];
    const hrMinus = fround(buffer[a] - buffer[b]);
    const hrPlus = fround(hrMinus + fround(buffer[b] * 2));
    const hiMinus = fround(buffer[a + 1] - buffer[b + 1]);
    const hiPlus = fround(hiMinus + fround(buffer[b + 1] * 2));
    const v1 = fround(fround(sine * hrMinus) + fround(cosine * hiPlus));
    const v2 = fround(fround(cosine * hrMinus) - fround(sine * hiPlus));
    buffer[a] = fround(fround(hrPlus + v1) * 0.5);
    buffer[b] = fround(buffer[a] - v1);
    buffer[a + 1] = fround(fround(hiMinus - v2) * 0.5);
    buffer[b + 1] = fround(buffer[a + 1] - hiMinus);
    a += 2; b -= 2; reversedIndex += 1;
  }
  buffer[a + 1] = -buffer[a + 1];
  const dc = fround(0.5 * fround(buffer[0] + buffer[1]));
  const nyquist = fround(0.5 * fround(buffer[0] - buffer[1]));
  buffer[0] = dc;
  buffer[1] = nyquist;

  const end = points * 2;
  for (let butterflies = points / 2; butterflies > 0; butterflies >>= 1) {
    a = 0;
    b = butterflies * 2;
    let sineIndex = 0;
    while (a < end) {
      const sine = sinTable[sineIndex];
      const cosine = sinTable[sineIndex + 1];
      sineIndex += 2;
      const groupEnd = b;
      while (a < groupEnd) {
        const v1 = fround(fround(buffer[b] * cosine) - fround(buffer[b + 1] * sine));
        const v2 = fround(fround(buffer[b] * sine) + fround(buffer[b + 1] * cosine));
        const sum = fround(fround(buffer[a] + v1) * 0.5);
        buffer[b] = sum;
        buffer[a] = fround(sum - v1);
        a += 1; b += 1;
        const second = fround(fround(buffer[a] + v2) * 0.5);
        buffer[b] = second;
        buffer[a] = fround(second - v2);
        a += 1; b += 1;
      }
      a = b;
      b += butterflies * 2;
    }
  }
}

function reorderToTime(buffer: Float32Array, output: Float32Array): void {
  const { points, bitReversed } = getFftTables();
  for (let index = 0; index < points; index += 1) {
    output[index * 2] = buffer[bitReversed[index]];
    output[index * 2 + 1] = buffer[bitReversed[index] + 1];
  }
}

function inverseRealSpectrum(real: Float32Array): Float32Array {
  const tables = getFftTables();
  const buffer = new Float32Array(FILTER_CURVE_EQ_WINDOW_SIZE);
  for (let index = 0; index < FILTER_CURVE_EQ_WINDOW_SIZE / 2; index += 1) {
    buffer[index * 2] = real[index];
  }
  buffer[1] = real[FILTER_CURVE_EQ_WINDOW_SIZE / 2];
  inverseRealFft(buffer, tables);
  const output = new Float32Array(FILTER_CURVE_EQ_WINDOW_SIZE);
  reorderToTime(buffer, output);
  return output;
}

function forwardRealSpectrum(input: Float32Array): { real: Float32Array; imaginary: Float32Array } {
  const tables = getFftTables();
  const buffer = new Float32Array(input);
  realFft(buffer, tables);
  const real = new Float32Array(FILTER_CURVE_EQ_WINDOW_SIZE);
  const imaginary = new Float32Array(FILTER_CURVE_EQ_WINDOW_SIZE);
  for (let index = 1; index < FILTER_CURVE_EQ_WINDOW_SIZE / 2; index += 1) {
    real[index] = buffer[tables.bitReversed[index]];
    imaginary[index] = buffer[tables.bitReversed[index] + 1];
  }
  real[0] = buffer[0];
  real[FILTER_CURVE_EQ_WINDOW_SIZE / 2] = buffer[1];
  for (let index = FILTER_CURVE_EQ_WINDOW_SIZE / 2 + 1; index < FILTER_CURVE_EQ_WINDOW_SIZE; index += 1) {
    real[index] = real[FILTER_CURVE_EQ_WINDOW_SIZE - index];
    imaginary[index] = -imaginary[FILTER_CURVE_EQ_WINDOW_SIZE - index];
  }
  return { real, imaginary };
}

function sortedPoints(settings: FilterCurveEqSettings): FilterCurvePoint[] {
  return settings.points.map((point) => ({ ...point })).sort((a, b) => a.frequency - b.frequency);
}

function signatureFor(settings: FilterCurveEqSettings): string {
  return JSON.stringify({
    linearFrequencyScale: settings.linearFrequencyScale,
    filterLength: settings.filterLength,
    points: sortedPoints(settings),
  });
}

export function validateFilterCurveEqSettings(settings: FilterCurveEqSettings): void {
  if (!Array.isArray(settings.points) || settings.points.length > FILTER_CURVE_EQ_MAX_POINTS) {
    throw new RangeError(`Filter Curve EQ 最多支持 ${FILTER_CURVE_EQ_MAX_POINTS} 个控制点`);
  }
  if (
    !Number.isInteger(settings.filterLength)
    || settings.filterLength < FILTER_CURVE_EQ_MIN_FILTER_LENGTH
    || settings.filterLength > FILTER_CURVE_EQ_MAX_FILTER_LENGTH
    || settings.filterLength % 2 === 0
  ) throw new RangeError('Filter Length 必须是 21–8191 之间的奇数');
  if (typeof settings.linearFrequencyScale !== 'boolean') {
    throw new TypeError('Linear frequency scale 必须是布尔值');
  }
  const ordered = sortedPoints(settings);
  ordered.forEach((point, index) => {
    if (!Number.isFinite(point.frequency) || point.frequency <= 0 || point.frequency > 1_000_000) {
      throw new RangeError('控制点频率必须是 0–1000000 Hz 之间的有限数值');
    }
    if (!Number.isFinite(point.gainDb) || point.gainDb < -120 || point.gainDb > 60) {
      throw new RangeError('控制点增益必须在 −120 至 60 dB 之间');
    }
    if (index > 0 && point.frequency === ordered[index - 1].frequency) {
      throw new RangeError('控制点频率不能重复');
    }
  });
}

function validateSampleRate(sampleRate: number): void {
  if (!Number.isFinite(sampleRate) || sampleRate <= FILTER_CURVE_EQ_LO_FREQ * 2) {
    throw new RangeError('Filter Curve EQ 采样率必须是大于 40 Hz 的有限数值');
  }
}

export function isFilterCurveEqBypassed(settings: FilterCurveEqSettings): boolean {
  return settings.points.length === 0 || settings.points.every((point) => point.gainDb === 0);
}

/** Piecewise-linear dB envelope in either log-frequency or linear-frequency space. */
export function evaluateFilterCurveDb(
  points: readonly FilterCurvePoint[],
  frequency: number,
  sampleRate: number,
  linearFrequencyScale: boolean,
): number {
  validateSampleRate(sampleRate);
  if (points.length === 0) return 0;
  const ordered = [...points].sort((a, b) => a.frequency - b.frequency);
  const hiFreq = sampleRate / 2;
  const clamped = linearFrequencyScale
    ? Math.max(0, Math.min(hiFreq, frequency))
    : Math.max(FILTER_CURVE_EQ_LO_FREQ, Math.min(hiFreq, frequency));
  const x = linearFrequencyScale ? clamped : Math.log10(clamped);
  const coordinates = ordered.map((point) => ({
    x: linearFrequencyScale ? point.frequency : Math.log10(point.frequency),
    y: point.gainDb,
  }));
  if (x <= coordinates[0].x) return coordinates[0].y;
  if (x >= coordinates[coordinates.length - 1].x) return coordinates[coordinates.length - 1].y;
  for (let index = 1; index < coordinates.length; index += 1) {
    const next = coordinates[index];
    if (x > next.x) continue;
    const previous = coordinates[index - 1];
    const dt = next.x - previous.x;
    const to = x - previous.x;
    return (previous.y * (dt - to) + next.y * to) / dt;
  }
  return coordinates[coordinates.length - 1].y;
}

/** Shared Audacity equalization FIR builder; valueAt returns dB at each FFT bin. */
export function createEqualizationPlanFromResponse(
  sampleRate: number,
  filterLength: number,
  signature: string,
  dcFrequency: number,
  valueAt: (frequency: number) => number,
): FilterCurveEqPlan {
  if (
    !Number.isInteger(filterLength)
    || filterLength < FILTER_CURVE_EQ_MIN_FILTER_LENGTH
    || filterLength > FILTER_CURVE_EQ_MAX_FILTER_LENGTH
    || filterLength % 2 === 0
  ) throw new RangeError('Filter Length 必须是 21–8191 之间的奇数');
  validateSampleRate(sampleRate);
  const size = FILTER_CURVE_EQ_WINDOW_SIZE;
  const half = size / 2;
  const hiFreq = sampleRate / 2;
  const response = new Float32Array(size);
  const val0 = valueAt(dcFrequency);
  const val1 = valueAt(hiFreq);
  const delta = hiFreq / half;
  response[0] = fround(10 ** (val0 / 20));
  for (let index = 1; index <= half; index += 1) {
    const frequency = delta * index;
    const value = index === half ? val1 : valueAt(frequency);
    response[index] = fround(10 ** (value / 20));
    if (index < half) response[size - index] = response[index];
  }

  const time = inverseRealSpectrum(response);
  const M = filterLength;
  const centre = (M - 1) / 2;
  let index = 0;
  for (; index <= centre; index += 1) {
    const multiplier = 0.42
      - 0.5 * Math.cos(2 * Math.PI * (index + centre) / (M - 1))
      + 0.08 * Math.cos(4 * Math.PI * (index + centre) / (M - 1));
    time[index] = fround(time[index] * multiplier);
    if (index !== 0) time[size - index] = fround(time[size - index] * multiplier);
  }
  for (; index <= half; index += 1) {
    time[index] = 0;
    time[size - index] = 0;
  }
  const impulse = new Float32Array(M);
  for (let tap = 0; tap < centre; tap += 1) {
    impulse[centre + tap] = time[tap];
    impulse[tap] = time[size - centre + tap];
  }
  impulse[M - 1] = time[centre];
  time.fill(0, M);
  for (let tap = 0; tap < M; tap += 1) time[tap] = impulse[tap];
  const { real, imaginary } = forwardRealSpectrum(time);
  return { sampleRate, filterLength: M, signature, impulse, filterReal: real, filterImaginary: imaginary };
}

export function createFilterCurveEqPlan(
  settings: FilterCurveEqSettings,
  sampleRate: number,
): FilterCurveEqPlan | undefined {
  validateFilterCurveEqSettings(settings);
  validateSampleRate(sampleRate);
  if (isFilterCurveEqBypassed(settings)) return undefined;
  const points = sortedPoints(settings);
  return createEqualizationPlanFromResponse(
    sampleRate,
    settings.filterLength,
    signatureFor(settings),
    settings.linearFrequencyScale ? 0 : FILTER_CURVE_EQ_LO_FREQ,
    (frequency) => evaluateFilterCurveDb(points, frequency, sampleRate, settings.linearFrequencyScale),
  );
}

function filterWindow(buffer: Float32Array, plan: FilterCurveEqPlan): void {
  const tables = getFftTables();
  const size = FILTER_CURVE_EQ_WINDOW_SIZE;
  realFft(buffer, tables);
  const transformed = new Float32Array(size);
  transformed[0] = fround(buffer[0] * plan.filterReal[0]);
  for (let index = 1; index < size / 2; index += 1) {
    const re = buffer[tables.bitReversed[index]];
    const im = buffer[tables.bitReversed[index] + 1];
    transformed[index * 2] = fround(
      fround(re * plan.filterReal[index]) - fround(im * plan.filterImaginary[index]),
    );
    transformed[index * 2 + 1] = fround(
      fround(re * plan.filterImaginary[index]) + fround(im * plan.filterReal[index]),
    );
  }
  transformed[1] = fround(buffer[1] * plan.filterReal[size / 2]);
  inverseRealFft(transformed, tables);
  reorderToTime(transformed, buffer);
}

function validateChannels(channels: readonly Float32Array[], errorLabel = 'Filter Curve EQ'): number {
  const length = channels[0]?.length ?? 0;
  if (channels.length === 0 || length === 0 || channels.some((channel) => channel.length !== length)) {
    throw new RangeError(`${errorLabel} 输入声道必须非空且等长`);
  }
  for (const channel of channels) {
    for (let index = 0; index < channel.length; index += 1) {
      if (!Number.isFinite(channel[index])) {
        throw new RangeError(`${errorLabel} 输入在第 ${index} 个采样包含非有限值`);
      }
    }
  }
  return length;
}

/** Shared overlap-add processor for Audacity Filter Curve EQ and Graphic EQ. */
export function processEqualizationChannelsWithPlan(
  channels: readonly Float32Array[],
  plan: FilterCurveEqPlan,
  errorLabel = 'Filter Curve EQ',
): Float32Array[] {
  const length = validateChannels(channels, errorLabel);
  const size = FILTER_CURVE_EQ_WINDOW_SIZE;
  const M = plan.filterLength;
  const L = size - (M - 1);
  const centre = (M - 1) / 2;
  return channels.map((channel) => {
    const extended = new Float32Array(length + M - 1);
    const window = new Float32Array(size);
    for (let blockStart = 0; blockStart < length; blockStart += L) {
      window.fill(0);
      const count = Math.min(L, length - blockStart);
      window.set(channel.subarray(blockStart, blockStart + count));
      filterWindow(window, plan);
      const end = Math.min(size, extended.length - blockStart);
      for (let index = 0; index < end; index += 1) {
        extended[blockStart + index] = fround(extended[blockStart + index] + window[index]);
      }
    }
    const output = extended.slice(centre, centre + length);
    for (let index = 0; index < output.length; index += 1) {
      if (!Number.isFinite(output[index])) {
        throw new RangeError(`${errorLabel} 在第 ${index} 个采样产生非有限输出`);
      }
    }
    return output;
  });
}

export function processFilterCurveEqChannels(
  channels: readonly Float32Array[],
  settings: FilterCurveEqSettings,
  sampleRate: number,
  suppliedPlan?: FilterCurveEqPlan,
): Float32Array[] {
  validateFilterCurveEqSettings(settings);
  validateSampleRate(sampleRate);
  validateChannels(channels);
  if (isFilterCurveEqBypassed(settings)) return channels.map((channel) => new Float32Array(channel));
  const plan = suppliedPlan ?? createFilterCurveEqPlan(settings, sampleRate);
  if (!plan || plan.sampleRate !== sampleRate || plan.signature !== signatureFor(settings)) {
    throw new RangeError('Filter Curve EQ 滤波计划与当前参数或采样率不一致');
  }
  return processEqualizationChannelsWithPlan(channels, plan);
}

interface AffectedClip {
  clip: IClip;
  input: FilterCurveEqClipInput;
  clipStart: number;
  sourceStart: number;
  overlapStart: number;
  overlapEnd: number;
}

function assembleTrack(
  track: ITrack,
  target: FilterCurveEqTrackInput,
  selection: GeneratorSelection,
  sampleRate: number,
  errorLabel = 'Filter Curve EQ',
): { selectedStart: number; selectedChannels: Float32Array[]; affected: AffectedClip[] } {
  validateSampleRate(sampleRate);
  if (
    !Number.isFinite(selection.start) || !Number.isFinite(selection.end)
    || selection.start < 0 || selection.end <= selection.start
  ) throw new RangeError(`${errorLabel} 需要有效的正时长选区`);
  if (track.id !== target.trackId || track.clips.length === 0) {
    throw new Error(`${errorLabel} 目标轨道不可用`);
  }
  const inputs = new Map<string, FilterCurveEqClipInput>();
  for (const input of target.clips) {
    if (inputs.has(input.clipId) || !track.clips.some(({ id }) => id === input.clipId)) {
      throw new Error(`${errorLabel} 目标片段不可用或重复`);
    }
    inputs.set(input.clipId, input);
  }
  if (inputs.size !== track.clips.length || track.clips.some(({ id }) => !inputs.has(id))) {
    throw new Error(`${errorLabel} 需要完整轨道音频以保持选区连续`);
  }
  const ordered = [...track.clips].sort((left, right) => left.startTime - right.startTime);
  const channelCount = inputs.get(ordered[0].id)?.sampleData.length ?? 0;
  if (channelCount < 1) throw new Error(`${errorLabel} 轨道没有音频声道`);
  for (const clip of ordered) {
    const input = inputs.get(clip.id)!;
    if (!Number.isFinite(input.sourceOffset) || input.sourceOffset < 0) {
      throw new Error(`${errorLabel} 片段源偏移无效`);
    }
    if (
      input.sampleData.length !== channelCount
      || input.sampleData.some((channel) => channel.length !== input.sampleData[0]?.length)
    ) throw new Error(`${errorLabel} 轨道的片段声道布局不一致`);
  }
  const trackStart = Math.min(...ordered.map(({ startTime }) => startTime));
  const trackEnd = Math.max(...ordered.map((clip) => clip.startTime + clip.duration));
  const selectedStart = Math.round(Math.max(trackStart, selection.start) * sampleRate);
  const selectedEnd = Math.round(Math.min(trackEnd, selection.end) * sampleRate);
  const selectedLength = selectedEnd - selectedStart;
  if (selectedLength <= 0) throw new Error(`${errorLabel} 选区与轨道没有有效重叠`);
  const selectedChannels = Array.from({ length: channelCount }, () => new Float32Array(selectedLength));
  const affected: AffectedClip[] = [];
  for (const clip of ordered) {
    const input = inputs.get(clip.id)!;
    const clipStart = Math.round(clip.startTime * sampleRate);
    const clipEnd = Math.round((clip.startTime + clip.duration) * sampleRate);
    const sourceStart = Math.round(input.sourceOffset * sampleRate);
    const overlapStart = Math.max(selectedStart, clipStart);
    const overlapEnd = Math.min(selectedEnd, clipEnd);
    if (overlapEnd <= overlapStart) continue;
    for (let position = overlapStart; position < overlapEnd; position += 1) {
      const sourceIndex = sourceStart + position - clipStart;
      if (sourceIndex < 0 || sourceIndex >= input.sampleData[0].length) continue;
      for (let channel = 0; channel < channelCount; channel += 1) {
        selectedChannels[channel][position - selectedStart] = input.sampleData[channel][sourceIndex];
      }
    }
    affected.push({ clip, input, clipStart, sourceStart, overlapStart, overlapEnd });
  }
  if (affected.length === 0) throw new Error(`${errorLabel} 选区内没有可处理的片段`);
  validateChannels(selectedChannels, errorLabel);
  return { selectedStart, selectedChannels, affected };
}

/** Shared preview/apply mapping across clips, source offsets and timeline gaps. */
export function processEqualizationTrackWithPlan(
  track: ITrack,
  target: FilterCurveEqTrackInput,
  selection: GeneratorSelection,
  sampleRate: number,
  plan: FilterCurveEqPlan | undefined,
  errorLabel = 'Filter Curve EQ',
): FilterCurveEqTrackResult {
  const { selectedStart, selectedChannels, affected } = assembleTrack(
    track, target, selection, sampleRate, errorLabel,
  );
  const processed = plan
    ? processEqualizationChannelsWithPlan(selectedChannels, plan, errorLabel)
    : selectedChannels.map((channel) => new Float32Array(channel));
  const clips = affected.map(({ clip, input, clipStart, sourceStart, overlapStart, overlapEnd }) => {
    const sampleData = input.sampleData.map((channel) => new Float32Array(channel));
    for (let position = overlapStart; position < overlapEnd; position += 1) {
      const sourceIndex = sourceStart + position - clipStart;
      if (sourceIndex < 0 || sourceIndex >= sampleData[0].length) continue;
      for (let channel = 0; channel < sampleData.length; channel += 1) {
        sampleData[channel][sourceIndex] = processed[channel][position - selectedStart];
      }
    }
    return { clipId: clip.id, sampleData };
  });
  return { trackId: track.id, selectionChannels: processed, clips, plan };
}

export function processFilterCurveEqTrack(
  track: ITrack,
  target: FilterCurveEqTrackInput,
  selection: GeneratorSelection,
  settings: FilterCurveEqSettings,
  sampleRate: number,
  suppliedPlan?: FilterCurveEqPlan,
): FilterCurveEqTrackResult {
  validateFilterCurveEqSettings(settings);
  validateSampleRate(sampleRate);
  const bypassed = isFilterCurveEqBypassed(settings);
  const plan = bypassed ? undefined : suppliedPlan ?? createFilterCurveEqPlan(settings, sampleRate);
  if (!bypassed && (!plan || plan.sampleRate !== sampleRate || plan.signature !== signatureFor(settings))) {
    throw new RangeError('Filter Curve EQ 滤波计划与当前参数或采样率不一致');
  }
  return processEqualizationTrackWithPlan(track, target, selection, sampleRate, plan);
}
