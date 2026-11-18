import type {
  ISpectrogramSettings,
  SpectrogramWindowType,
} from '@/types/project';

export type SpectrogramAlgorithmOptions = Pick<
  ISpectrogramSettings,
  'algorithm' | 'windowType' | 'windowSize' | 'zeroPaddingFactor'
>;

export interface SpectrogramComputation {
  data: Float32Array;
  fftLength: number;
  numBins: number;
  numFrames: number;
}

interface ComplexSpectrum {
  real: Float64Array;
  imag: Float64Array;
}

interface WindowSamples {
  values: Float64Array;
  derivative: Float64Array;
}

function fftComplex(input: Float64Array): ComplexSpectrum {
  const size = input.length;
  const real = new Float64Array(input);
  const imag = new Float64Array(size);
  let j = 0;
  for (let i = 1; i < size; i++) {
    let bit = size >> 1;
    while (j >= bit) {
      j -= bit;
      bit >>= 1;
    }
    j += bit;
    if (i < j) {
      [real[i], real[j]] = [real[j], real[i]];
      [imag[i], imag[j]] = [imag[j], imag[i]];
    }
  }
  for (let len = 2; len <= size; len <<= 1) {
    const half = len >> 1;
    const angle = 2 * Math.PI / len;
    const baseReal = Math.cos(angle);
    const baseImag = -Math.sin(angle);
    for (let start = 0; start < size; start += len) {
      let weightReal = 1;
      let weightImag = 0;
      for (let k = 0; k < half; k++) {
        const even = start + k;
        const odd = even + half;
        const oddReal = real[odd]! * weightReal - imag[odd]! * weightImag;
        const oddImag = real[odd]! * weightImag + imag[odd]! * weightReal;
        real[odd] = real[even]! - oddReal;
        imag[odd] = imag[even]! - oddImag;
        real[even] += oddReal;
        imag[even] += oddImag;
        const nextReal = weightReal * baseReal - weightImag * baseImag;
        weightImag = weightReal * baseImag + weightImag * baseReal;
        weightReal = nextReal;
      }
    }
  }
  return { real, imag };
}

function isPowerOfTwo(value: number): boolean {
  return Number.isInteger(value) && value > 0 && (value & (value - 1)) === 0;
}

function windowValue(type: SpectrogramWindowType, index: number, count: number): number {
  const x = index / count;
  const angle = 2 * Math.PI * x;
  switch (type) {
    case 'rectangular': return 1;
    case 'bartlett': return 1 - Math.abs((index - count / 2) / (count / 2));
    case 'hamming': return 0.54 - 0.46 * Math.cos(angle);
    case 'hann': return 0.5 - 0.5 * Math.cos(angle);
    case 'blackman': return 0.42 - 0.5 * Math.cos(angle) + 0.08 * Math.cos(2 * angle);
    case 'blackman-harris':
      return 0.35875 - 0.48829 * Math.cos(angle) + 0.14128 * Math.cos(2 * angle)
        - 0.01168 * Math.cos(3 * angle);
    case 'welch': return 4 * x * (1 - x);
    case 'gaussian25': return Math.exp(-2 * 2.5 * 2.5 * (0.25 + x * x - x));
    case 'gaussian35': return Math.exp(-2 * 3.5 * 3.5 * (0.25 + x * x - x));
    case 'gaussian45': return Math.exp(-2 * 4.5 * 4.5 * (0.25 + x * x - x));
  }
}

function extraWindowValue(type: SpectrogramWindowType): number {
  switch (type) {
    case 'rectangular': return 1;
    case 'hamming': return 0.08;
    case 'gaussian25': return Math.exp(-2 * 2.5 * 2.5 * 0.25);
    case 'gaussian35': return Math.exp(-2 * 3.5 * 3.5 * 0.25);
    case 'gaussian45': return Math.exp(-2 * 4.5 * 4.5 * 0.25);
    default: return 0;
  }
}

function derivativeValue(type: SpectrogramWindowType, index: number, count: number): number {
  const x = index / count;
  const multiplier = 2 * Math.PI / count;
  switch (type) {
    case 'rectangular': return 0;
    case 'bartlett': return index < count / 2 ? 2 / count : -2 / count;
    case 'hamming': return 0.46 * multiplier * Math.sin(index * multiplier);
    case 'hann': return 0.5 * multiplier * Math.sin(index * multiplier);
    case 'blackman':
      return 0.5 * multiplier * Math.sin(index * multiplier)
        - 0.08 * 2 * multiplier * Math.sin(2 * index * multiplier);
    case 'blackman-harris':
      return 0.48829 * multiplier * Math.sin(index * multiplier)
        - 0.14128 * 2 * multiplier * Math.sin(2 * index * multiplier)
        + 0.01168 * 3 * multiplier * Math.sin(3 * index * multiplier);
    case 'welch': return 4 * (1 - 2 * x) / count;
    case 'gaussian25':
    case 'gaussian35':
    case 'gaussian45': {
      const alpha = type === 'gaussian25' ? 2.5 : type === 'gaussian35' ? 3.5 : 4.5;
      const a = -2 * alpha * alpha;
      return a * (2 * x - 1) / count * windowValue(type, index, count);
    }
  }
}

/** Audacity NewWindowFunc/DerivativeOfWindowFunc, including extraSample semantics. */
export function getSpectrogramWindowSamples(
  type: SpectrogramWindowType,
  numSamplesIn: number,
  extraSample: boolean,
): WindowSamples {
  const length = Math.max(1, Math.floor(numSamplesIn));
  const count = extraSample ? Math.max(1, length - 1) : length;
  const values = new Float64Array(length);
  const derivative = new Float64Array(length);
  for (let index = 0; index < length; index++) {
    if (index < count) {
      values[index] = windowValue(type, index, count);
      derivative[index] = derivativeValue(type, index, count);
    } else {
      values[index] = extraWindowValue(type);
      derivative[index] = 0;
    }
  }
  if (type === 'rectangular' && length > 1) derivative[length - 1] = -values[length - 1]!;
  if (type === 'bartlett' && count > 1) {
    const value = 2 / count;
    derivative[0] = value / 2;
    if (count % 2 === 0) derivative[count / 2] = 0;
    if (extraSample) derivative[count] = -value / 2;
    else derivative[count - 1]! *= 0.5;
  }
  return { values, derivative };
}

export function getSpectrogramFftLength(settings: SpectrogramAlgorithmOptions): number {
  return settings.windowSize * (settings.algorithm === 'pitch' ? 1 : settings.zeroPaddingFactor);
}

function fillCenteredFrame(
  input: Float32Array,
  center: number,
  windowSize: number,
  fftLength: number,
  padding: number,
): Float64Array {
  const frame = new Float64Array(fftLength);
  const start = center - Math.floor(windowSize / 2);
  for (let index = 0; index < windowSize; index++) {
    const source = start + index;
    if (source >= 0 && source < input.length) frame[padding + index] = input[source]!;
  }
  return frame;
}

function multiply(left: Float64Array, right: Float64Array): Float64Array {
  const result = new Float64Array(left.length);
  for (let index = 0; index < left.length; index++) result[index] = left[index]! * right[index]!;
  return result;
}

function computePitchFrame(frame: Float64Array, type: SpectrogramWindowType): Float64Array {
  const windowSize = frame.length;
  const half = windowSize / 2;
  const extra = type === 'hamming' || type === 'hann' || type === 'blackman' || type === 'blackman-harris';
  const window = getSpectrogramWindowSamples(type, windowSize, extra).values;
  const first = fftComplex(multiply(frame, window));
  const cepstrumInput = new Float64Array(windowSize);
  for (let index = 0; index < windowSize; index++) {
    const power = first.real[index]! ** 2 + first.imag[index]! ** 2;
    cepstrumInput[index] = Math.cbrt(power);
  }
  const second = fftComplex(cepstrumInput);
  const processed = second.real.slice(0, half);
  const original = processed.slice();
  for (let index = 0; index < half; index++) {
    if (processed[index]! < 0) processed[index] = 0;
    const doubled = index % 2 === 0
      ? original[Math.floor(index / 2)]!
      : (original[Math.floor(index / 2)]! + original[Math.min(half - 1, Math.floor(index / 2) + 1)]!) / 2;
    processed[index] = Math.max(0, processed[index]! - doubled);
  }
  const result = new Float64Array(half);
  for (let index = 0; index < half; index++) {
    result[half - 1 - index] = processed[index]! / (windowSize / 4);
  }
  return result;
}

/**
 * Audacity 4.0.2 SpectrumCache path. Frequencies and Reassignment return
 * magnitudes; Pitch returns the official clipped autocorrelation values.
 */
export function computeAudacitySpectrogram(
  input: Float32Array,
  settings: SpectrogramAlgorithmOptions,
  hopSize: number,
): SpectrogramComputation {
  const fftLength = getSpectrogramFftLength(settings);
  const numBins = fftLength / 2;
  if (input.length === 0 || !isPowerOfTwo(settings.windowSize) || !isPowerOfTwo(fftLength)
    || !Number.isInteger(hopSize) || hopSize <= 0 || !Number.isInteger(numBins) || numBins <= 0) {
    return { data: new Float32Array(), fftLength, numBins: Math.max(0, numBins), numFrames: 0 };
  }
  const numFrames = Math.max(1, Math.ceil(input.length / hopSize));
  const data = new Float32Array(numFrames * numBins);
  if (settings.algorithm === 'pitch') {
    for (let frame = 0; frame < numFrames; frame++) {
      const result = computePitchFrame(
        fillCenteredFrame(input, frame * hopSize, settings.windowSize, settings.windowSize, 0),
        settings.windowType,
      );
      data.set(result, frame * numBins);
    }
    return { data, fftLength, numBins, numFrames };
  }

  const factor = settings.zeroPaddingFactor;
  const padding = settings.windowSize * (factor - 1) / 2;
  const extra = padding > 0;
  const samples = getSpectrogramWindowSamples(
    settings.windowType,
    settings.windowSize + (extra ? 1 : 0),
    extra,
  );
  let sum = 0;
  for (const value of samples.values) sum += value;
  const scale = sum > 0 ? 2 / sum : 1;
  const window = new Float64Array(fftLength);
  const timeWindow = new Float64Array(fftLength);
  const derivativeWindow = new Float64Array(fftLength);
  for (let index = 0; index < samples.values.length; index++) {
    window[padding + index] = samples.values[index]! * scale;
    derivativeWindow[padding + index] = samples.derivative[index]! * scale;
    timeWindow[padding + index] = samples.values[index]! * scale * (index - settings.windowSize / 2);
  }

  for (let frame = 0; frame < numFrames; frame++) {
    const centered = fillCenteredFrame(input, frame * hopSize, settings.windowSize, fftLength, padding);
    const spectrum = fftComplex(multiply(centered, window));
    if (settings.algorithm === 'frequencies') {
      for (let bin = 0; bin < numBins; bin++) {
        data[frame * numBins + bin] = Math.hypot(spectrum.real[bin]!, spectrum.imag[bin]!);
      }
      continue;
    }

    const derivative = fftComplex(multiply(centered, derivativeWindow));
    const timed = fftComplex(multiply(centered, timeWindow));
    for (let bin = 0; bin < numBins; bin++) {
      const denominatorReal = spectrum.real[bin]!;
      const denominatorImag = spectrum.imag[bin]!;
      const power = denominatorReal ** 2 + denominatorImag ** 2;
      if (power < 1e-16) continue;
      const quotientImag = (-derivative.real[bin]! * denominatorImag
        + derivative.imag[bin]! * denominatorReal) / power;
      const frequencyCorrection = -(fftLength / (2 * Math.PI)) * quotientImag;
      const correctedBin = Math.floor(bin + frequencyCorrection + 0.5);
      if (correctedBin < 0 || correctedBin >= numBins) continue;
      const timeCorrection = (timed.real[bin]! * denominatorReal
        + timed.imag[bin]! * denominatorImag) / power;
      const correctedFrame = Math.floor(frame + 0.5 + timeCorrection / hopSize);
      if (correctedFrame < 0 || correctedFrame >= numFrames) continue;
      data[correctedFrame * numBins + correctedBin] += power;
    }
  }
  if (settings.algorithm === 'reassignment') {
    for (let index = 0; index < data.length; index++) data[index] = Math.sqrt(data[index]!);
  }
  return { data, fftLength, numBins, numFrames };
}
