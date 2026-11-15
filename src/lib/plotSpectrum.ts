import { getClipSampleRange } from '@/lib/generatorEditing';

// Audacity 4.0.2 SpectrumAnalyst.cpp, FreqWindow.cpp, FFT.cpp and RealFFTf.cpp.
// The analysis path is deliberately independent from the track spectrogram:
// half-window overlap, coherent window-sum gain, power averaging and dB export.

export const PLOT_SPECTRUM_SIZES = [128, 256, 512, 1024, 2048, 4096, 8192, 16384, 32768, 65536, 131072] as const;
export const MAX_PLOT_SPECTRUM_SAMPLES = 20_000_000;

export const PLOT_SPECTRUM_ALGORITHMS = [
  { id: 'spectrum', label: 'Spectrum' },
  { id: 'autocorrelation', label: 'Standard Autocorrelation' },
  { id: 'cuberoot-autocorrelation', label: 'Cuberoot Autocorrelation' },
  { id: 'enhanced-autocorrelation', label: 'Enhanced Autocorrelation' },
  { id: 'cepstrum', label: 'Cepstrum' },
] as const;

export const PLOT_SPECTRUM_WINDOWS = [
  { id: 'rectangular', label: 'Rectangular' },
  { id: 'bartlett', label: 'Bartlett' },
  { id: 'hamming', label: 'Hamming' },
  { id: 'hann', label: 'Hann' },
  { id: 'blackman', label: 'Blackman' },
  { id: 'blackman-harris', label: 'Blackman-Harris' },
  { id: 'welch', label: 'Welch' },
  { id: 'gaussian25', label: 'Gaussian (a=2.5)' },
  { id: 'gaussian35', label: 'Gaussian (a=3.5)' },
  { id: 'gaussian45', label: 'Gaussian (a=4.5)' },
] as const;

export type PlotSpectrumAlgorithm = typeof PLOT_SPECTRUM_ALGORITHMS[number]['id'];
export type PlotSpectrumWindow = typeof PLOT_SPECTRUM_WINDOWS[number]['id'];

export interface PlotSpectrumOptions {
  algorithm: PlotSpectrumAlgorithm;
  size: number;
  window: PlotSpectrumWindow;
  sampleRate: number;
}

export interface PlotSpectrumResult extends PlotSpectrumOptions {
  values: Float64Array;
  windowCount: number;
  yMin: number;
  yMax: number;
}

export interface PlotSpectrumSegment {
  trackId: string;
  clips: readonly {
    clipId: string;
    startTime: number;
    duration: number;
    sourceOffset: number;
    channels: readonly Float32Array[];
  }[];
}

export interface PlotSpectrumAudio {
  samples: Float32Array;
  sourceSamples: number;
  truncated: boolean;
  trackCount: number;
}

function assertSampleRate(sampleRate: number): void {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new RangeError('频谱分析采样率必须是正的有限数值');
  }
}

export function createAnalysisWindow(window: PlotSpectrumWindow, size: number): Float64Array {
  if (!Number.isSafeInteger(size) || size < 2) throw new RangeError('分析窗长必须是大于 1 的整数');
  const result = new Float64Array(size);
  const extraSample = ['hamming', 'hann', 'blackman', 'blackman-harris'].includes(window);
  const denominator = extraSample ? size - 1 : size;
  const tau = 2 * Math.PI / denominator;
  for (let index = 0; index < size; index += 1) {
    const x = index / denominator;
    switch (window) {
      case 'rectangular': result[index] = 1; break;
      case 'bartlett': result[index] = 1 - Math.abs((index - size / 2) / (size / 2)); break;
      case 'hamming': result[index] = 0.54 - 0.46 * Math.cos(index * tau); break;
      case 'hann': result[index] = 0.5 - 0.5 * Math.cos(index * tau); break;
      case 'blackman': result[index] = 0.42 - 0.5 * Math.cos(index * tau) + 0.08 * Math.cos(2 * index * tau); break;
      case 'blackman-harris':
        result[index] = 0.35875 - 0.48829 * Math.cos(index * tau)
          + 0.14128 * Math.cos(2 * index * tau) - 0.01168 * Math.cos(3 * index * tau);
        break;
      case 'welch': result[index] = 4 * x * (1 - x); break;
      case 'gaussian25':
      case 'gaussian35':
      case 'gaussian45': {
        const alpha = window === 'gaussian25' ? 2.5 : window === 'gaussian35' ? 3.5 : 4.5;
        result[index] = Math.exp(-2 * alpha * alpha * (0.25 + x * x - x));
        break;
      }
      default: throw new RangeError('未知分析窗函数');
    }
  }
  return result;
}

function transform(real: Float64Array, imaginary: Float64Array, inverse = false): void {
  const size = real.length;
  if (size !== imaginary.length || size < 2 || (size & (size - 1)) !== 0) {
    throw new RangeError('FFT 长度必须是 2 的幂');
  }
  for (let index = 1, reversed = 0; index < size; index += 1) {
    let bit = size >> 1;
    while (reversed & bit) { reversed ^= bit; bit >>= 1; }
    reversed ^= bit;
    if (index < reversed) {
      [real[index], real[reversed]] = [real[reversed], real[index]];
      [imaginary[index], imaginary[reversed]] = [imaginary[reversed], imaginary[index]];
    }
  }
  for (let length = 2; length <= size; length <<= 1) {
    const half = length >> 1;
    const angle = (inverse ? 2 : -2) * Math.PI / length;
    const stepReal = Math.cos(angle);
    const stepImaginary = Math.sin(angle);
    for (let start = 0; start < size; start += length) {
      let twiddleReal = 1;
      let twiddleImaginary = 0;
      for (let offset = 0; offset < half; offset += 1) {
        const even = start + offset;
        const odd = even + half;
        const oddReal = real[odd] * twiddleReal - imaginary[odd] * twiddleImaginary;
        const oddImaginary = real[odd] * twiddleImaginary + imaginary[odd] * twiddleReal;
        real[odd] = real[even] - oddReal;
        imaginary[odd] = imaginary[even] - oddImaginary;
        real[even] += oddReal;
        imaginary[even] += oddImaginary;
        const nextReal = twiddleReal * stepReal - twiddleImaginary * stepImaginary;
        twiddleImaginary = twiddleReal * stepImaginary + twiddleImaginary * stepReal;
        twiddleReal = nextReal;
      }
    }
  }
  if (inverse) {
    for (let index = 0; index < size; index += 1) {
      real[index] /= size;
      imaginary[index] /= size;
    }
  }
}

function extrema(values: Float64Array, ignore = 0): { yMin: number; yMax: number } {
  let yMin = Number.POSITIVE_INFINITY;
  let yMax = Number.NEGATIVE_INFINITY;
  for (let index = ignore; index < values.length - ignore; index += 1) {
    yMin = Math.min(yMin, values[index]);
    yMax = Math.max(yMax, values[index]);
  }
  if (!Number.isFinite(yMin) || !Number.isFinite(yMax)) {
    // Match the all-out-of-range Spectrum display while remaining finite for silence.
    yMin = -90;
    yMax = -80;
  }
  return { yMin, yMax };
}

export function analyzePlotSpectrum(data: Float32Array, options: PlotSpectrumOptions): PlotSpectrumResult {
  const { algorithm, size, window, sampleRate } = options;
  assertSampleRate(sampleRate);
  if (!(PLOT_SPECTRUM_SIZES as readonly number[]).includes(size)) {
    throw new RangeError('频谱分析窗长必须是 Audacity 支持的 2 的幂');
  }
  if (!PLOT_SPECTRUM_ALGORITHMS.some((item) => item.id === algorithm)) throw new RangeError('未知频谱分析算法');
  if (data.length < size) throw new RangeError(`所选音频不足 ${size} 个采样，请缩短 FFT Size 或扩大选区`);
  for (let index = 0; index < data.length; index += 1) {
    if (!Number.isFinite(data[index])) throw new RangeError(`选区采样 ${index} 不是有限数值，无法分析`);
  }

  const half = size / 2;
  const processed = new Float64Array(half);
  const windowValues = createAnalysisWindow(window, size);
  let windowSum = 0;
  for (const value of windowValues) windowSum += value;
  const spectrumScale = windowSum > 0 ? 4 / (windowSum * windowSum) : 1;
  const real = new Float64Array(size);
  const imaginary = new Float64Array(size);
  const secondaryReal = new Float64Array(size);
  const secondaryImaginary = new Float64Array(size);
  let windowCount = 0;

  for (let start = 0; start + size <= data.length; start += half) {
    for (let index = 0; index < size; index += 1) {
      real[index] = data[start + index] * windowValues[index];
      imaginary[index] = 0;
    }
    if (algorithm === 'spectrum') {
      transform(real, imaginary);
      for (let index = 0; index < half; index += 1) {
        processed[index] += real[index] * real[index] + imaginary[index] * imaginary[index];
      }
    } else {
      transform(real, imaginary);
      for (let index = 0; index < size; index += 1) {
        const power = real[index] * real[index] + imaginary[index] * imaginary[index];
        if (algorithm === 'cepstrum') {
          const minimumPower = 1e-20 * size * size;
          secondaryReal[index] = Math.log(Math.max(minimumPower, power));
        } else if (algorithm === 'autocorrelation') {
          secondaryReal[index] = Math.sqrt(power);
        } else {
          secondaryReal[index] = Math.cbrt(power);
        }
        secondaryImaginary[index] = 0;
      }
      transform(secondaryReal, secondaryImaginary, algorithm === 'cepstrum');
      for (let index = 0; index < half; index += 1) processed[index] += secondaryReal[index];
    }
    windowCount += 1;
  }

  if (algorithm === 'spectrum') {
    const scale = spectrumScale / windowCount;
    for (let index = 0; index < half; index += 1) processed[index] = 10 * Math.log10(processed[index] * scale);
  } else {
    for (let index = 0; index < half; index += 1) processed[index] /= windowCount;
    if (algorithm === 'enhanced-autocorrelation') {
      const clipped = new Float64Array(half);
      for (let index = 0; index < half; index += 1) clipped[index] = Math.max(0, processed[index]);
      for (let index = 0; index < half; index += 1) {
        const doubled = index % 2 === 0
          ? clipped[index / 2]
          : (clipped[(index - 1) / 2] + clipped[Math.min(half - 1, (index + 1) / 2)]) / 2;
        processed[index] = Math.max(0, processed[index] - doubled);
      }
    }
  }
  const { yMin, yMax } = extrema(processed, algorithm === 'cepstrum' ? 4 : 0);
  return { ...options, values: processed, windowCount, yMin, yMax };
}

function cubicInterpolate(y0: number, y1: number, y2: number, y3: number, x: number): number {
  const a = -y0 / 6 + y1 / 2 - y2 / 2 + y3 / 6;
  const b = y0 - 5 * y1 / 2 + 2 * y2 - y3 / 2;
  const c = -11 * y0 / 6 + 3 * y1 - 3 * y2 / 2 + y3 / 3;
  return a * x * x * x + b * x * x + c * x + y0;
}

function cubicMaximum(y0: number, y1: number, y2: number, y3: number): { offset: number; value: number } {
  const a = -y0 / 6 + y1 / 2 - y2 / 2 + y3 / 6;
  const b = y0 - 5 * y1 / 2 + 2 * y2 - y3 / 2;
  const c = -11 * y0 / 6 + 3 * y1 - 3 * y2 / 2 + y3 / 3;
  const derivativeA = 3 * a;
  const derivativeB = 2 * b;
  const discriminant = derivativeB * derivativeB - 4 * derivativeA * c;
  if (Math.abs(derivativeA) < 1e-12 || discriminant < 0) {
    const candidates = [y0, y1, y2, y3];
    const maximum = Math.max(...candidates);
    return { offset: candidates.indexOf(maximum), value: maximum };
  }
  const root = Math.sqrt(discriminant);
  const roots = [(-derivativeB + root) / (2 * derivativeA), (-derivativeB - root) / (2 * derivativeA)];
  const candidates = roots.filter((value) => value >= 0 && value <= 3).map((offset) => ({
    offset,
    value: cubicInterpolate(y0, y1, y2, y3, offset),
    secondDerivative: 2 * derivativeA * offset + derivativeB,
  })).filter((candidate) => candidate.secondDerivative < 0);
  if (candidates.length === 0) return { offset: 1, value: y1 };
  return candidates.sort((left, right) => right.value - left.value)[0];
}

export function samplePlotSpectrum(result: PlotSpectrumResult, first: number, second: number): number {
  const { algorithm, sampleRate, size, values } = result;
  let bin0 = algorithm === 'spectrum' ? first * size / sampleRate : first * sampleRate;
  let bin1 = algorithm === 'spectrum' ? second * size / sampleRate : second * sampleRate;
  const width = bin1 - bin0;
  if (width <= 0) return Number.NaN;
  if (width < 1) {
    const middle = (bin0 + bin1) / 2;
    let index = Math.floor(middle) - 1;
    index = Math.max(1, Math.min(values.length - 4, index));
    return cubicInterpolate(values[index], values[index + 1], values[index + 2], values[index + 3], middle - index);
  }
  bin0 = Math.max(0, bin0);
  bin1 = Math.min(values.length - 1, bin1);
  let sum = 0;
  if (Math.floor(bin1) > Math.floor(bin0)) {
    sum += values[Math.floor(bin0)] * (Math.floor(bin0) + 1 - bin0);
  }
  for (let index = Math.floor(bin0) + 1; index < Math.floor(bin1); index += 1) sum += values[index];
  sum += values[Math.floor(bin1)] * (bin1 - Math.floor(bin1));
  return sum / width;
}

export interface PlotSpectrumPeak { position: number; value: number }

export function findNearestPlotSpectrumPeak(result: PlotSpectrumResult, position: number): PlotSpectrumPeak | null {
  const { values, algorithm, sampleRate, size } = result;
  let best: PlotSpectrumPeak | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  let rising = values.length > 1 && values[1] > values[0];
  for (let bin = 3; bin < values.length - 1; bin += 1) {
    const nowRising = values[bin] > values[bin - 1];
    if (!nowRising && rising) {
      const left = bin - 2;
      const peak = cubicMaximum(values[left], values[left + 1], values[left + 2], values[left + 3]);
      const maximumBin = left + peak.offset;
      const peakPosition = algorithm === 'spectrum' ? maximumBin * sampleRate / size : maximumBin / sampleRate;
      const distance = Math.abs(peakPosition - position);
      if (distance < bestDistance) {
        best = { position: peakPosition, value: peak.value };
        bestDistance = distance;
        if (peakPosition > position) break;
      }
    }
    rising = nowRising;
  }
  return best;
}

export function serializePlotSpectrum(result: PlotSpectrumResult): string {
  const lines: string[] = [];
  if (result.algorithm === 'spectrum') {
    lines.push('Frequency (Hz)\tLevel (dB)');
    for (let index = 1; index < result.values.length; index += 1) {
      lines.push(`${(index * result.sampleRate / result.size).toFixed(6)}\t${result.values[index].toFixed(6)}`);
    }
  } else {
    lines.push('Lag (seconds)\tFrequency (Hz)\tLevel');
    for (let index = 1; index < result.values.length; index += 1) {
      lines.push(`${(index / result.sampleRate).toFixed(6)}\t${(result.sampleRate / index).toFixed(6)}\t${result.values[index].toFixed(6)}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

export function mixPlotSpectrumSegments(
  segments: readonly PlotSpectrumSegment[],
  selection: { start: number; end: number },
  sampleRate: number,
  maximumSamples = MAX_PLOT_SPECTRUM_SAMPLES,
): PlotSpectrumAudio {
  assertSampleRate(sampleRate);
  if (!Number.isFinite(selection.start) || !Number.isFinite(selection.end)
    || selection.start < 0 || selection.end <= selection.start) {
    throw new RangeError('频谱分析需要有效的正长度时间选区');
  }
  if (!Number.isSafeInteger(maximumSamples) || maximumSamples < 1) throw new RangeError('分析采样上限无效');
  const sourceSamples = Math.round((selection.end - selection.start) * sampleRate);
  const samples = new Float32Array(Math.min(sourceSamples, maximumSamples));
  let trackCount = 0;
  for (const segment of segments) {
    if (segment.clips.length === 0) continue;
    trackCount += 1;
    for (const clip of [...segment.clips].sort((left, right) => left.startTime - right.startTime)) {
      if (clip.channels.length === 0 || clip.channels.some((channel) => channel.length !== clip.channels[0].length)) {
        throw new RangeError(`片段 ${clip.clipId} 没有等长声道，无法分析`);
      }
      const range = getClipSampleRange(clip, selection, clip.sourceOffset, sampleRate, clip.channels[0].length);
      if (!range) continue;
      const overlapStart = Math.max(clip.startTime, selection.start);
      const destinationStart = Math.round((overlapStart - selection.start) * sampleRate);
      const length = Math.min(range.endSample - range.startSample, samples.length - destinationStart);
      if (length <= 0) continue;
      for (const channel of clip.channels) {
        for (let index = 0; index < length; index += 1) {
          samples[destinationStart + index] += channel[range.startSample + index];
        }
      }
    }
  }
  if (trackCount === 0) throw new RangeError('所选轨道在时间选区内没有可分析的音频');
  return { samples, sourceSamples, truncated: samples.length < sourceSamples, trackCount };
}

export function frequencyToPitchName(frequency: number): string {
  if (!(frequency > 0) || !Number.isFinite(frequency)) return '—';
  const midi = Math.round(69 + 12 * Math.log2(frequency / 440));
  const names = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
  return `${names[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}
