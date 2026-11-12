import type { GeneratorSelection } from '@/lib/generatorEditing';
import type { IClip, ITrack } from '@/types/project';

/**
 * Audacity 4.0.2 NoiseReductionEffect (NoiseReductionEffect.cpp +
 * SpectrumTransformer.cpp + RealFFTf.cpp), using the official fixed advanced
 * settings: 2048 samples, four steps per window, Hann/Hann and second-greatest
 * discrimination. This is the complete two-pass offline effect, not a generic
 * low-pass or noise-gate approximation.
 */

export const NOISE_REDUCTION_WINDOW_SIZE = 2048;
export const NOISE_REDUCTION_STEPS_PER_WINDOW = 4;
export const NOISE_REDUCTION_STEP_SIZE = NOISE_REDUCTION_WINDOW_SIZE / NOISE_REDUCTION_STEPS_PER_WINDOW;
export const NOISE_REDUCTION_SPECTRUM_SIZE = 1 + NOISE_REDUCTION_WINDOW_SIZE / 2;
export const MAX_NOISE_REDUCTION_TOTAL_SAMPLES = 20_000_000;

export type NoiseReductionMode = 'reduce' | 'residue';

export interface NoiseReductionSettings {
  noiseGain: number;
  sensitivity: number;
  frequencySmoothingBands: number;
  mode: NoiseReductionMode;
}

export const DEFAULT_NOISE_REDUCTION_SETTINGS: Readonly<NoiseReductionSettings> = Object.freeze({
  noiseGain: 6,
  sensitivity: 6,
  frequencySmoothingBands: 6,
  mode: 'reduce',
});

export interface NoiseReductionProfile {
  sampleRate: number;
  windowSize: number;
  totalWindows: number;
  means: Float32Array;
}

export interface NoiseReductionClipInput {
  clipId: string;
  sampleData: Float32Array[];
  sourceOffset: number;
}

export interface NoiseReductionTrackInput {
  trackId: string;
  clips: NoiseReductionClipInput[];
}

export interface NoiseReductionClipResult {
  clipId: string;
  sampleData: Float32Array[];
}

export interface NoiseReductionTrackResult {
  trackId: string;
  selectionChannels: Float32Array[];
  clips: NoiseReductionClipResult[];
}

interface FftTables {
  points: number;
  bitReversed: Int32Array;
  sinTable: Float32Array;
}

interface SpectrumWindow {
  real: Float32Array;
  imaginary: Float32Array;
  spectrum: Float32Array;
  gains: Float32Array;
}

const fround = Math.fround;
const fftCache = new Map<number, FftTables>();

function getFft(length: number): FftTables {
  const cached = fftCache.get(length);
  if (cached) return cached;
  if (length < 4 || (length & (length - 1)) !== 0) {
    throw new RangeError('Noise Reduction FFT 长度必须是大于等于 4 的 2 的幂');
  }
  const points = length / 2;
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
    sinTable[bitReversed[index]] = -Math.sin(angle);
    sinTable[bitReversed[index] + 1] = -Math.cos(angle);
  }
  const tables = { points, bitReversed, sinTable };
  fftCache.set(length, tables);
  return tables;
}

/** Bit-reversed real FFT, directly following Audacity RealFFTf.cpp. */
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
        a += 1;
        b += 1;
        const difference = fround(buffer[a] - v2);
        buffer[b] = difference;
        buffer[a] = fround(difference + fround(2 * v2));
        a += 1;
        b += 1;
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
    left += 1;
    right -= 1;
  }
  const center = bitReversed[left] + 1;
  buffer[center] = -buffer[center];
  const nyquist = fround(buffer[0] - buffer[1]);
  buffer[0] = fround(buffer[0] + buffer[1]);
  buffer[1] = nyquist;
}

/** Inverse bit-reversed real FFT, directly following InverseRealFFTf.cpp. */
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
    a += 2;
    b -= 2;
    reversedIndex += 1;
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
        a += 1;
        b += 1;
        const second = fround(fround(buffer[a] + v2) * 0.5);
        buffer[b] = second;
        buffer[a] = fround(second - v2);
        a += 1;
        b += 1;
      }
      a = b;
      b += butterflies * 2;
    }
  }
}

function makeWindow(size: number, spectrumSize: number, gain: number): SpectrumWindow {
  return {
    real: new Float32Array(size / 2),
    imaginary: new Float32Array(size / 2),
    spectrum: new Float32Array(spectrumSize),
    gains: new Float32Array(spectrumSize).fill(gain),
  };
}

function hannWindow(length: number): Float32Array {
  const result = new Float32Array(length).fill(1);
  const multiplier = 2 * Math.PI / length;
  for (let index = 0; index < length; index += 1) {
    result[index] = fround(result[index] * (0.5 - 0.5 * Math.cos(index * multiplier)));
  }
  return result;
}

function dbToLinear(db: number): number {
  return fround(10 ** (db / 20));
}

function validateSampleRate(sampleRate: number): void {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new RangeError('Noise Reduction 采样率必须是大于零的有限数值');
  }
}

export function validateNoiseReductionSettings(settings: NoiseReductionSettings): void {
  if (!Number.isInteger(settings.noiseGain) || settings.noiseGain < 0 || settings.noiseGain > 48) {
    throw new RangeError('Noise reduction 必须是 0–48 dB 的整数');
  }
  if (!Number.isFinite(settings.sensitivity) || settings.sensitivity < 0.01 || settings.sensitivity > 24) {
    throw new RangeError('Sensitivity 必须在 0.01–24 之间');
  }
  if (
    !Number.isInteger(settings.frequencySmoothingBands)
    || settings.frequencySmoothingBands < 0
    || settings.frequencySmoothingBands > 12
  ) {
    throw new RangeError('Frequency smoothing 必须是 0–12 bands 的整数');
  }
  if (settings.mode !== 'reduce' && settings.mode !== 'residue') {
    throw new RangeError('Noise Reduction 输出模式无效');
  }
}

function validateChannels(channels: readonly Float32Array[]): number {
  const length = channels[0]?.length ?? 0;
  if (channels.length === 0 || channels.some((channel) => channel.length !== length)) {
    throw new RangeError('Noise Reduction 输入声道必须非空且等长');
  }
  for (const channel of channels) {
    for (let index = 0; index < channel.length; index += 1) {
      if (!Number.isFinite(channel[index])) {
        throw new RangeError(`Noise Reduction 输入在第 ${index} 个采样包含非有限值`);
      }
    }
  }
  return length;
}

class ProfileAccumulator {
  readonly sums = new Float32Array(NOISE_REDUCTION_SPECTRUM_SIZE);
  readonly means = new Float32Array(NOISE_REDUCTION_SPECTRUM_SIZE);
  totalWindows = 0;

  constructor(readonly sampleRate: number) {}

  addChannel(channel: Float32Array): void {
    let trackWindows = 0;
    transformChannel(channel, true, null, DEFAULT_NOISE_REDUCTION_SETTINGS, (spectrum) => {
      trackWindows += 1;
      for (let band = 0; band < spectrum.length; band += 1) {
        this.sums[band] = fround(this.sums[band] + spectrum[band]);
      }
    });
    if (trackWindows > 0) {
      const previous = this.totalWindows;
      const denominator = previous + trackWindows;
      for (let band = 0; band < this.means.length; band += 1) {
        this.means[band] = fround(
          fround(fround(this.means[band] * previous) + this.sums[band]) / denominator,
        );
        this.sums[band] = 0;
      }
      this.totalWindows = denominator;
    }
  }

  finish(): NoiseReductionProfile {
    if (this.totalWindows === 0) throw new RangeError('Selected noise profile is too short.');
    return {
      sampleRate: this.sampleRate,
      windowSize: NOISE_REDUCTION_WINDOW_SIZE,
      totalWindows: this.totalWindows,
      means: new Float32Array(this.means),
    };
  }
}

/** Gather official per-bin mean power statistics from every selected channel. */
export function learnNoiseProfile(
  channels: readonly Float32Array[],
  sampleRate: number,
): NoiseReductionProfile {
  validateSampleRate(sampleRate);
  validateChannels(channels);
  const accumulator = new ProfileAccumulator(sampleRate);
  for (const channel of channels) accumulator.addChannel(channel);
  return accumulator.finish();
}

function applyFrequencySmoothing(gains: Float32Array, bands: number): void {
  if (bands === 0) return;
  const scratch = new Float32Array(gains.length);
  for (let index = 0; index < gains.length; index += 1) gains[index] = Math.log(gains[index]);
  for (let index = 0; index < gains.length; index += 1) {
    const start = Math.max(0, index - bands);
    const end = Math.min(gains.length - 1, index + bands);
    let sum = 0;
    for (let other = start; other <= end; other += 1) sum = fround(sum + gains[other]);
    scratch[index] = fround(sum / (end - start + 1));
  }
  for (let index = 0; index < gains.length; index += 1) gains[index] = Math.exp(scratch[index]);
}

function secondGreatestIsNoise(
  queue: readonly SpectrumWindow[],
  count: number,
  band: number,
  threshold: number,
): boolean {
  let greatest = 0;
  let second = 0;
  for (let index = 0; index < count; index += 1) {
    const power = queue[index].spectrum[band];
    if (power >= greatest) {
      second = greatest;
      greatest = power;
    } else if (power >= second) {
      second = power;
    }
  }
  return second <= threshold;
}

/**
 * Shared SpectrumTransformer pipeline. Profiling invokes onSpectrum for each
 * complete unpadded window. Reduction returns the official padded/overlap-add
 * output, trimmed back to the input selection length.
 */
function transformChannel(
  input: Float32Array,
  profiling: boolean,
  profile: NoiseReductionProfile | null,
  settings: NoiseReductionSettings,
  onSpectrum?: (spectrum: Float32Array) => void,
): Float32Array {
  const size = NOISE_REDUCTION_WINDOW_SIZE;
  const step = NOISE_REDUCTION_STEP_SIZE;
  const spectrumSize = NOISE_REDUCTION_SPECTRUM_SIZE;
  const tables = getFft(size);
  const inWindow = hannWindow(size);
  const outWindow = hannWindow(size);
  let denominator = 0;
  for (let index = 0; index < size; index += step) {
    denominator += inWindow[index] * outWindow[index];
  }
  for (let index = 0; index < size; index += 1) inWindow[index] /= denominator;

  const noiseGain = profiling ? 0 : -settings.noiseGain;
  const sampleRate = profiling ? 0 : profile!.sampleRate;
  const attackBlocks = profiling ? 1 : 1 + Math.trunc(0.02 * sampleRate / step);
  const releaseBlocks = profiling ? 1 : 1 + Math.trunc(0.1 * sampleRate / step);
  const attenuation = dbToLinear(noiseGain);
  const oneBlockAttack = dbToLinear(noiseGain / attackBlocks);
  const oneBlockRelease = dbToLinear(noiseGain / releaseBlocks);
  const windowsToExamine = 1 + NOISE_REDUCTION_STEPS_PER_WINDOW;
  const center = Math.floor(windowsToExamine / 2);
  const queueLength = profiling ? 1 : Math.max(windowsToExamine, center + attackBlocks);
  const queue = Array.from({ length: queueLength }, () => makeWindow(size, spectrumSize, attenuation));
  const fftBuffer = new Float32Array(size);
  const inputBuffer = new Float32Array(size);
  const overlap = new Float32Array(size);
  const output = new Float32Array(input.length + size);
  let outputLength = 0;
  let inputPosition = profiling ? 0 : size - step;
  let outputStepCount = profiling ? 0 : -(queueLength - 1) - (NOISE_REDUCTION_STEPS_PER_WINDOW - 1);
  let inputSampleCount = 0;

  const currentQueueSize = () => {
    const current = outputStepCount + queue.length
      + (profiling ? 0 : NOISE_REDUCTION_STEPS_PER_WINDOW - 1);
    return Math.max(0, Math.min(queue.length, current));
  };
  const queueIsFull = () => profiling
    ? outputStepCount >= 0
    : outputStepCount >= -(NOISE_REDUCTION_STEPS_PER_WINDOW - 1);

  const fillFirstWindow = () => {
    for (let index = 0; index < size; index += 1) {
      fftBuffer[index] = fround(inputBuffer[index] * inWindow[index]);
    }
    realFft(fftBuffer, tables);
    const record = queue[0];
    for (let band = 1; band < spectrumSize - 1; band += 1) {
      const reversed = tables.bitReversed[band];
      record.real[band] = fftBuffer[reversed];
      record.imaginary[band] = fftBuffer[reversed + 1];
    }
    record.real[0] = fftBuffer[0];
    record.imaginary[0] = fftBuffer[1];
    record.spectrum[0] = fround(record.real[0] * record.real[0]);
    for (let band = 1; band < spectrumSize - 1; band += 1) {
      record.spectrum[band] = fround(
        fround(record.real[band] * record.real[band])
        + fround(record.imaginary[band] * record.imaginary[band]),
      );
    }
    record.spectrum[spectrumSize - 1] = fround(record.imaginary[0] * record.imaginary[0]);
  };

  const reduceNoise = () => {
    const historyLength = currentQueueSize();
    const count = Math.min(windowsToExamine, historyLength);
    queue[0].gains.fill(attenuation);
    if (count > center) {
      const gains = queue[center].gains;
      for (let band = 0; band < spectrumSize; band += 1) {
        const isNoise = secondGreatestIsNoise(
          queue,
          count,
          band,
          fround(settings.sensitivity * Math.log(10)) * profile!.means[band],
        );
        if (!isNoise) gains[band] = 1;
      }
    }
    for (let band = 0; band < spectrumSize; band += 1) {
      for (let index = center + 1; index < historyLength; index += 1) {
        const minimum = Math.max(attenuation, fround(queue[index - 1].gains[band] * oneBlockAttack));
        if (queue[index].gains[band] < minimum) queue[index].gains[band] = minimum;
        else break;
      }
    }
    const next = queue[center - 1].gains;
    const current = queue[center].gains;
    for (let band = 0; band < spectrumSize; band += 1) {
      next[band] = Math.max(next[band], Math.max(attenuation, fround(current[band] * oneBlockRelease)));
    }
    if (!queueIsFull()) return;
    const record = queue[historyLength - 1];
    applyFrequencySmoothing(record.gains, settings.frequencySmoothingBands);
    for (let band = 1; band < spectrumSize - 1; band += 1) {
      const gain = settings.mode === 'residue' ? fround(record.gains[band] - 1) : record.gains[band];
      record.real[band] = fround(record.real[band] * gain);
      record.imaginary[band] = fround(record.imaginary[band] * gain);
    }
    record.real[0] = fround(record.real[0] * (settings.mode === 'residue' ? record.gains[0] - 1 : record.gains[0]));
    record.imaginary[0] = fround(
      record.imaginary[0]
      * (settings.mode === 'residue' ? record.gains[spectrumSize - 1] - 1 : record.gains[spectrumSize - 1]),
    );
  };

  const outputStep = () => {
    if (profiling || !queueIsFull()) return;
    const record = queue[queue.length - 1];
    for (let band = 1; band < spectrumSize - 1; band += 1) {
      fftBuffer[band * 2] = record.real[band];
      fftBuffer[band * 2 + 1] = record.imaginary[band];
    }
    fftBuffer[0] = record.real[0];
    fftBuffer[1] = record.imaginary[0];
    inverseRealFft(fftBuffer, tables);
    for (let index = 0; index < size / 2; index += 1) {
      const reversed = tables.bitReversed[index];
      overlap[index * 2] = fround(
        overlap[index * 2] + fround(fftBuffer[reversed] * outWindow[index * 2]),
      );
      overlap[index * 2 + 1] = fround(
        overlap[index * 2 + 1] + fround(fftBuffer[reversed + 1] * outWindow[index * 2 + 1]),
      );
    }
    if (outputStepCount >= 0) {
      output.set(overlap.subarray(0, step), outputLength);
      outputLength += step;
    }
    overlap.copyWithin(0, step);
    overlap.fill(0, size - step);
  };

  const processSamples = (source: Float32Array | null, length: number) => {
    if (source) inputSampleCount += length;
    let remaining = length;
    let sourceOffset = 0;
    while (remaining > 0 && outputStepCount * step < inputSampleCount) {
      const available = Math.min(remaining, size - inputPosition);
      if (source) inputBuffer.set(source.subarray(sourceOffset, sourceOffset + available), inputPosition);
      else inputBuffer.fill(0, inputPosition, inputPosition + available);
      sourceOffset += available;
      remaining -= available;
      inputPosition += available;
      if (inputPosition !== size) continue;
      fillFirstWindow();
      if (profiling) onSpectrum?.(queue[0].spectrum);
      else reduceNoise();
      outputStep();
      outputStepCount += 1;
      if (queue.length > 1) {
        const oldest = queue.pop()!;
        oldest.real.fill(0);
        oldest.imaginary.fill(0);
        queue.unshift(oldest);
      }
      inputBuffer.copyWithin(0, step);
      inputPosition -= step;
    }
  };

  processSamples(input, input.length);
  if (!profiling) {
    while (outputStepCount * step < inputSampleCount) processSamples(null, step);
  }
  return output.slice(0, input.length);
}

/** Apply the learned profile independently to every channel, without mutation. */
export function processNoiseReductionChannels(
  channels: readonly Float32Array[],
  profile: NoiseReductionProfile,
  settings: NoiseReductionSettings,
): Float32Array[] {
  validateNoiseReductionSettings(settings);
  validateSampleRate(profile.sampleRate);
  if (
    profile.windowSize !== NOISE_REDUCTION_WINDOW_SIZE
    || profile.totalWindows <= 0
    || profile.means.length !== NOISE_REDUCTION_SPECTRUM_SIZE
  ) throw new RangeError('Noise Profile 与 Audacity 2048 点窗口不兼容');
  const length = validateChannels(channels);
  if (length === 0) throw new RangeError('Noise Reduction 需要非空音频选区');
  return channels.map((channel) => transformChannel(channel, false, profile, settings));
}

interface AffectedClip {
  clip: IClip;
  input: NoiseReductionClipInput;
  clipStart: number;
  sourceStart: number;
  overlapStart: number;
  overlapEnd: number;
}

interface AssembledTrack {
  selectedStart: number;
  selectedChannels: Float32Array[];
  affected: AffectedClip[];
}

function assembleTrack(
  track: ITrack,
  target: NoiseReductionTrackInput,
  selection: GeneratorSelection,
  sampleRate: number,
): AssembledTrack {
  validateSampleRate(sampleRate);
  if (
    !Number.isFinite(selection.start) || !Number.isFinite(selection.end)
    || selection.start < 0 || selection.end <= selection.start
  ) throw new RangeError('Noise Reduction 需要有效的正时长选区');
  if (track.id !== target.trackId || track.clips.length === 0) {
    throw new Error('Noise Reduction 目标轨道不可用');
  }
  const inputs = new Map<string, NoiseReductionClipInput>();
  for (const input of target.clips) {
    if (inputs.has(input.clipId) || !track.clips.some(({ id }) => id === input.clipId)) {
      throw new Error('Noise Reduction 目标片段不可用');
    }
    inputs.set(input.clipId, input);
  }
  if (inputs.size !== track.clips.length || track.clips.some(({ id }) => !inputs.has(id))) {
    throw new Error('Noise Reduction 需要完整轨道音频以保持选区连续');
  }
  const ordered = [...track.clips].sort((left, right) => left.startTime - right.startTime);
  const channelCount = inputs.get(ordered[0].id)?.sampleData.length ?? 0;
  if (channelCount === 0) throw new Error('Noise Reduction 音频没有可用声道');
  for (const clip of ordered) {
    const input = inputs.get(clip.id)!;
    if (!Number.isFinite(input.sourceOffset) || input.sourceOffset < 0) {
      throw new Error('Noise Reduction 片段源偏移无效');
    }
    if (
      input.sampleData.length !== channelCount
      || input.sampleData.some((channel) => channel.length !== input.sampleData[0]?.length)
    ) throw new Error('Noise Reduction 轨道的片段声道布局不一致');
  }

  const trackStart = Math.min(...ordered.map(({ startTime }) => startTime));
  const trackEnd = Math.max(...ordered.map((clip) => clip.startTime + clip.duration));
  const selectedStart = Math.round(Math.max(trackStart, selection.start) * sampleRate);
  const selectedEnd = Math.round(Math.min(trackEnd, selection.end) * sampleRate);
  const selectedLength = selectedEnd - selectedStart;
  if (selectedLength <= 0) throw new Error('Noise Reduction 选区与轨道没有有效重叠');
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
  if (affected.length === 0) throw new Error('Noise Reduction 选区内没有可处理的片段');
  validateChannels(selectedChannels);
  return { selectedStart, selectedChannels, affected };
}

/** Learn from all selected tracks/channels; no project audio is modified. */
export function learnNoiseProfileFromTracks(
  projectTracks: readonly ITrack[],
  targets: readonly NoiseReductionTrackInput[],
  selection: GeneratorSelection,
  sampleRate: number,
): NoiseReductionProfile {
  validateSampleRate(sampleRate);
  if (targets.length === 0) throw new Error('没有可用于 Noise Profile 的音频选区');
  if (new Set(targets.map(({ trackId }) => trackId)).size !== targets.length) {
    throw new Error('Noise Profile 目标包含重复轨道');
  }
  const accumulator = new ProfileAccumulator(sampleRate);
  for (const target of targets) {
    const track = projectTracks.find(({ id }) => id === target.trackId);
    if (!track) throw new Error(`Track not found: ${target.trackId}`);
    const assembled = assembleTrack(track, target, selection, sampleRate);
    for (const channel of assembled.selectedChannels) accumulator.addChannel(channel);
  }
  return accumulator.finish();
}

/** Shared preview/apply track mapping across clip boundaries and timeline gaps. */
export function processNoiseReductionTrack(
  track: ITrack,
  target: NoiseReductionTrackInput,
  selection: GeneratorSelection,
  profile: NoiseReductionProfile,
  settings: NoiseReductionSettings,
  sampleRate: number,
): NoiseReductionTrackResult {
  if (profile.sampleRate !== sampleRate) {
    throw new RangeError('The sample rate of the noise profile must match that of the sound to be processed.');
  }
  const { selectedStart, selectedChannels, affected } = assembleTrack(track, target, selection, sampleRate);
  const processed = processNoiseReductionChannels(selectedChannels, profile, settings);
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
  return { trackId: track.id, selectionChannels: processed, clips };
}
