// SPDX-License-Identifier: GPL-3.0-only
// Derived from Audacity 4.0.2 (GPL-2.0-or-later):
// au3/libraries/au3-time-and-pitch/StaffPad/TimeAndPitch.cpp and FormantShifter.cpp.
// The browser port preserves the official processing order and state machine.

const TWO_PI = 6.283185307179586;
const MAX_BLOCK_SIZE = 1024;
const FLOAT_MIN_NORMAL = 1.1754943508222875e-38;

export interface ComplexSpectrum {
  real: Float32Array;
  imaginary: Float32Array;
}

export interface StaffPadTimeAndPitchOptions {
  sampleRate: number;
  /** Output duration / input duration, as Audacity ClipInterface::GetStretchRatio. */
  timeRatio: number;
  pitchRatio: number;
  preserveFormants: boolean;
  fftSize: number;
  cutoffQuefrency?: number;
}

function nextPowerOfTwo(value: number): number {
  let result = 1;
  while (result < value) result *= 2;
  return result;
}

/** Unscaled radix-2 complex FFT, matching PFFFT's forward/backward convention. */
function fftInPlace(real: Float64Array, imaginary: Float64Array, inverse: boolean): void {
  const length = real.length;
  for (let source = 1, target = 0; source < length; source += 1) {
    let bit = length >> 1;
    while (target & bit) {
      target ^= bit;
      bit >>= 1;
    }
    target ^= bit;
    if (source < target) {
      [real[source], real[target]] = [real[target], real[source]];
      [imaginary[source], imaginary[target]] = [imaginary[target], imaginary[source]];
    }
  }
  for (let block = 2; block <= length; block *= 2) {
    const angle = (inverse ? 2 : -2) * Math.PI / block;
    const stepReal = Math.cos(angle);
    const stepImaginary = Math.sin(angle);
    const half = block / 2;
    for (let start = 0; start < length; start += block) {
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
}

export function forwardRealSpectrum(input: Float32Array): ComplexSpectrum {
  const size = input.length;
  const real = new Float64Array(size);
  const imaginary = new Float64Array(size);
  real.set(input);
  fftInPlace(real, imaginary, false);
  const bins = size / 2 + 1;
  return {
    real: Float32Array.from(real.subarray(0, bins)),
    imaginary: Float32Array.from(imaginary.subarray(0, bins)),
  };
}

/** Inverse real FFT without 1/N scaling; callers apply the same scale as StaffPad. */
export function inverseRealSpectrum(spectrum: ComplexSpectrum): Float32Array {
  const bins = spectrum.real.length;
  const size = (bins - 1) * 2;
  const real = new Float64Array(size);
  const imaginary = new Float64Array(size);
  real.set(spectrum.real);
  imaginary.set(spectrum.imaginary);
  for (let index = bins; index < size; index += 1) {
    const mirror = size - index;
    real[index] = spectrum.real[mirror];
    imaginary[index] = -spectrum.imaginary[mirror];
  }
  fftInPlace(real, imaginary, true);
  return Float32Array.from(real);
}

const fastLogStorage = new ArrayBuffer(4);
const fastLogFloat = new Float32Array(fastLogStorage);
const fastLogBits = new Int32Array(fastLogStorage);

/** Audacity au3-utility/MathApprox.h FastLog2, including its finite zero input behavior. */
export function fastLog2(value: number): number {
  fastLogFloat[0] = value;
  let bits = fastLogBits[0];
  const exponent = ((bits >> 23) & 255) - 128;
  bits = (bits & ~(255 << 23)) + (127 << 23);
  fastLogBits[0] = bits;
  const normalized = fastLogFloat[0];
  const polynomial = Math.fround(
    Math.fround(Math.fround(-0.3358287811 * normalized) + 2) * normalized,
  );
  return Math.fround(exponent + Math.fround(polynomial - 0.65871759316667));
}

export function mapToPositiveHalfIndex(index: number, fullSize: number): number {
  let mapped = index >= 0 ? index % fullSize : fullSize - (-index % fullSize);
  if (mapped > fullSize / 2) mapped = fullSize - mapped;
  return mapped;
}

function resampleFrequencyDomain(
  values: Float32Array,
  fftSize: number,
  factor: number,
): number {
  const size = fftSize / 2 + 1;
  const end = Math.min(size, Math.trunc(size * factor));
  const resampled = new Float32Array(end);
  for (let index = 0; index < end; index += 1) {
    const position = index / factor;
    const integerPosition = Math.trunc(position);
    const fraction = position - integerPosition;
    const left = mapToPositiveHalfIndex(integerPosition, fftSize);
    const right = mapToPositiveHalfIndex(integerPosition + 1, fftSize);
    resampled[index] = (1 - fraction) * values[left] + fraction * values[right];
  }
  values.set(resampled);
  values.fill(0, end);
  return end;
}

/**
 * Audacity FormantShifter::Process. `powerSpectrum` is |spectrum|^2 and the
 * spectrum is modified in place. The 0.002 s default is StaffPadTimeAndPitch's.
 */
export function processFormantSpectrum(
  powerSpectrum: Float32Array,
  spectrum: ComplexSpectrum,
  factor: number,
  sampleRate: number,
  fftSize: number,
  cutoffQuefrency = 0.002,
): void {
  if (!(factor > 0) || !Number.isFinite(factor)) throw new RangeError('共振峰缩放因子必须为正数');
  if (cutoffQuefrency === 0) return;
  const bins = fftSize / 2 + 1;
  if (
    powerSpectrum.length !== bins
    || spectrum.real.length !== bins
    || spectrum.imaginary.length !== bins
  ) throw new RangeError('共振峰频谱尺寸不一致');

  const normalizer = fastLog2(fftSize);
  const envelope = {
    real: new Float32Array(bins),
    imaginary: new Float32Array(bins),
  };
  for (let index = 0; index < bins; index += 1) {
    envelope.real[index] = 0.5 * fastLog2(powerSpectrum[index]) - normalizer;
  }

  const cepstrum = inverseRealSpectrum(envelope);
  const binCutoff = Math.trunc(sampleRate * cutoffQuefrency * factor);
  if (binCutoff < fftSize / 2) {
    cepstrum.fill(0, binCutoff + 1, fftSize - binCutoff);
  }

  const transformedEnvelope = forwardRealSpectrum(cepstrum);
  const envelopeReal = new Float32Array(bins);
  const weights = new Float32Array(bins);
  for (let index = 0; index < bins; index += 1) {
    const value = Math.fround(2 ** (transformedEnvelope.real[index] / fftSize));
    envelopeReal[index] = value;
    weights[index] = Number.isFinite(value) && Math.abs(value) >= FLOAT_MIN_NORMAL
      ? 1 / value
      : 0;
  }

  const lastNonZeroedBin = resampleFrequencyDomain(envelopeReal, fftSize, factor);
  for (let index = 0; index < bins; index += 1) {
    weights[index] = Math.min(envelopeReal[index] * weights[index], 100);
  }
  weights.fill(1, lastNonZeroedBin);

  for (let index = 0; index < bins; index += 1) {
    spectrum.real[index] *= weights[index];
    spectrum.imaginary[index] *= weights[index];
  }
}

class CircularSampleBuffer {
  readonly data: Float32Array;
  private readonly mask: number;
  private position0 = 0;

  constructor(requestedSize: number) {
    const size = nextPowerOfTwo(requestedSize);
    this.data = new Float32Array(size);
    this.mask = size - 1;
  }

  reset(): void {
    this.data.fill(0);
    this.position0 = 0;
  }

  read(offset: number): number {
    return this.data[(this.position0 + offset) & this.mask];
  }

  writeOffset0(value: number): void {
    this.data[this.position0] = value;
  }

  writeBlock(offset: number, source: Float32Array, count: number): void {
    for (let index = 0; index < count; index += 1) {
      this.data[(this.position0 + offset + index) & this.mask] = source[index];
    }
  }

  readBlock(offset: number, count: number): Float32Array {
    const result = new Float32Array(count);
    for (let index = 0; index < count; index += 1) {
      result[index] = this.read(offset + index);
    }
    return result;
  }

  advance(count: number): void {
    this.position0 = (this.position0 + count) & this.mask;
  }
}

class Mt19937 {
  private readonly state = new Uint32Array(624);
  private index = 624;

  constructor(seed: number) {
    this.state[0] = seed >>> 0;
    for (let index = 1; index < 624; index += 1) {
      const previous = this.state[index - 1];
      this.state[index] = (Math.imul(1812433253, previous ^ (previous >>> 30)) + index) >>> 0;
    }
  }

  nextUint32(): number {
    if (this.index >= 624) this.twist();
    let value = this.state[this.index++];
    value ^= value >>> 11;
    value ^= (value << 7) & 0x9d2c5680;
    value ^= (value << 15) & 0xefc60000;
    value ^= value >>> 18;
    return value >>> 0;
  }

  nextFloat(): number {
    return Math.fround(this.nextUint32() / 4294967296);
  }

  private twist(): void {
    for (let index = 0; index < 624; index += 1) {
      const value = (this.state[index] & 0x80000000)
        | (this.state[(index + 1) % 624] & 0x7fffffff);
      let next = this.state[(index + 397) % 624] ^ (value >>> 1);
      if (value & 1) next ^= 0x9908b0df;
      this.state[index] = next >>> 0;
    }
    this.index = 0;
  }
}

function lagrange6(samples: Float32Array, t: number): number {
  const ym1Y1 = samples[1] + samples[3];
  const twentyFourthYm2Y2 = (samples[0] + samples[4]) / 24;
  const c0 = samples[2];
  const c1 = 0.05 * samples[0] - 0.5 * samples[1] - samples[2] / 3
    + samples[3] - 0.25 * samples[4] + samples[5] / 30;
  const c2 = (2 / 3) * ym1Y1 - 1.25 * samples[2] - twentyFourthYm2Y2;
  const c3 = (5 / 12) * samples[2] - (7 / 12) * samples[3] + (7 / 24) * samples[4]
    - (samples[0] + samples[1] + samples[5]) / 24;
  const c4 = 0.25 * samples[2] - ym1Y1 / 6 + twentyFourthYm2Y2;
  const c5 = (samples[5] - samples[0]) / 120 + (samples[1] - samples[4]) / 24
    + (samples[3] - samples[2]) / 12;
  const t2 = t * t;
  return (c0 + c1 * t) + (c2 + c3 * t) * t2 + (c4 + c5 * t) * t2 * t2;
}

function rint(value: number): number {
  const floor = Math.floor(value);
  const fraction = value - floor;
  if (fraction > 0.5) return floor + 1;
  if (fraction < 0.5) return floor;
  return floor % 2 === 0 ? floor : floor + 1;
}

function unwrapPhase(value: number): number {
  return value - rint(value * 0.15915494309) * 6.283185307;
}

function fftShift(values: Float32Array): void {
  const half = values.length / 2;
  for (let index = 0; index < half; index += 1) {
    const temporary = values[index];
    values[index] = values[index + half];
    values[index + half] = temporary;
  }
}

class StaffPadProcessor {
  private readonly channels: number;
  private readonly bins: number;
  private readonly fftSize: number;
  private readonly pitchRatio: number;
  private readonly timeRatio: number;
  private readonly preserveFormants: boolean;
  private readonly cutoffQuefrency: number;
  private readonly sampleRate: number;
  private readonly source: readonly Float32Array[];
  private sourcePosition = 0;
  private readonly readBuffer: Float32Array[];
  private readonly resampleInput: CircularSampleBuffer[];
  private readonly analysisInput: CircularSampleBuffer[];
  private fftTimeseries: Float32Array[];
  private spectrum: ComplexSpectrum[];
  private readonly norm: Float32Array;
  private readonly lastNorm: Float32Array;
  private readonly phase: Float32Array[];
  private readonly lastPhase: Float32Array[];
  private readonly phaseAccum: Float32Array[];
  private readonly cosWindow: Float32Array;
  private readonly sqWindow: Float32Array;
  private readonly randomPhases: Float32Array;
  private readonly random = new Mt19937(0);
  private output: Float32Array[];
  private normalization: Float32Array;
  private outputWritePosition = 0;
  private outputReadPosition = 0;
  private exactHopA = 512;
  private exactHopS = 0;
  private nextExactHopS = 512;
  private hopAErr = 0;
  private hopSErr = 0;
  private analysisHopCounter = 0;
  private resampleReadPos = 0;
  private overlapA = 4;
  private readonly combinedTimeStretch: number;
  private readonly expectedPhaseChangePerBinPerSample: number;

  constructor(
    source: readonly Float32Array[],
    options: StaffPadTimeAndPitchOptions,
    outputCapacityHint: number,
  ) {
    this.source = source;
    this.channels = source.length;
    this.fftSize = options.fftSize;
    this.bins = options.fftSize / 2 + 1;
    this.sampleRate = options.sampleRate;
    this.timeRatio = options.timeRatio;
    this.pitchRatio = options.pitchRatio;
    this.preserveFormants = options.preserveFormants;
    this.cutoffQuefrency = options.cutoffQuefrency ?? 0.002;
    this.combinedTimeStretch = options.timeRatio * options.pitchRatio;
    this.expectedPhaseChangePerBinPerSample = TWO_PI / options.fftSize;
    this.readBuffer = source.map(() => new Float32Array(MAX_BLOCK_SIZE));
    this.resampleInput = source.map(() => new CircularSampleBuffer(MAX_BLOCK_SIZE + 6));
    this.analysisInput = source.map(() => new CircularSampleBuffer(options.fftSize));
    this.fftTimeseries = source.map(() => new Float32Array(options.fftSize));
    this.spectrum = source.map(() => ({
      real: new Float32Array(this.bins),
      imaginary: new Float32Array(this.bins),
    }));
    this.norm = new Float32Array(this.bins);
    this.lastNorm = new Float32Array(this.bins);
    this.phase = source.map(() => new Float32Array(this.bins));
    this.lastPhase = source.map(() => new Float32Array(this.bins));
    this.phaseAccum = source.map(() => new Float32Array(this.bins));
    this.cosWindow = new Float32Array(options.fftSize);
    this.sqWindow = new Float32Array(options.fftSize);
    for (let index = 0; index < options.fftSize; index += 1) {
      const value = -0.5 * Math.cos(TWO_PI * index / options.fftSize) + 0.5;
      this.cosWindow[index] = value;
      this.sqWindow[index] = value * value;
    }
    this.randomPhases = new Float32Array(this.bins);
    for (let index = 0; index < this.bins; index += 1) {
      this.randomPhases[index] = -Math.PI + this.random.nextFloat() * TWO_PI;
    }
    this.setTimeStretchAndPitchFactor();
    const capacity = nextPowerOfTwo(Math.max(
      options.fftSize * 4,
      outputCapacityHint + options.fftSize * 4 + MAX_BLOCK_SIZE,
    ));
    this.output = source.map(() => new Float32Array(capacity));
    this.normalization = new Float32Array(capacity);
  }

  getSamplesToNextHop(): number {
    return Math.max(0, Math.ceil(this.exactHopA) - this.analysisHopCounter + 1);
  }

  getAvailableOutputSamples(): number {
    return this.outputWritePosition - this.outputReadPosition;
  }

  illState(): boolean {
    return this.getSamplesToNextHop() <= 0 && this.getAvailableOutputSamples() <= 0;
  }

  feedNextHop(): void {
    let required = this.getSamplesToNextHop();
    while (required > 0) {
      const count = Math.min(required, MAX_BLOCK_SIZE);
      this.feedAudio(count);
      required -= count;
    }
  }

  retrieveAudio(count: number, target: Float32Array[] | null, targetOffset = 0): void {
    for (let channel = 0; channel < this.channels; channel += 1) {
      for (let index = 0; index < count; index += 1) {
        const normalization = this.normalization[this.outputReadPosition + index];
        const value = this.output[channel][this.outputReadPosition + index]
          * (normalization / (normalization * normalization + 1 / 16));
        if (target) target[channel][targetOffset + index] = value;
      }
    }
    this.outputReadPosition += count;
    this.exactHopS = this.nextExactHopS;
  }

  private setTimeStretchAndPitchFactor(): void {
    this.overlapA = 4;
    let overlapS = 4;
    if (this.combinedTimeStretch > 1) this.overlapA *= this.combinedTimeStretch;
    else overlapS /= this.combinedTimeStretch;
    this.exactHopA = this.fftSize / this.overlapA;
    this.nextExactHopS = this.fftSize / overlapS;
    if (this.exactHopS === 0) this.exactHopS = this.nextExactHopS;
  }

  private pull(count: number): void {
    const remaining = Math.max(0, this.source[0].length - this.sourcePosition);
    const copied = Math.min(remaining, count);
    for (let channel = 0; channel < this.channels; channel += 1) {
      this.readBuffer[channel].fill(0, 0, count);
      this.readBuffer[channel].set(
        this.source[channel].subarray(this.sourcePosition, this.sourcePosition + copied),
      );
    }
    this.sourcePosition += copied;
  }

  private feedAudio(count: number): void {
    this.pull(count);
    for (let channel = 0; channel < this.channels; channel += 1) {
      this.resampleInput[channel].writeBlock(0, this.readBuffer[channel], count);
      this.resampleInput[channel].advance(count);
    }
    this.resampleReadPos -= count;
    if (this.exactHopS === 0) this.exactHopS = this.nextExactHopS;
    const hopS = Math.trunc(this.exactHopS + this.hopSErr);
    const hopA = Math.trunc(this.exactHopA + this.hopAErr);
    let step = 0;
    let readPos = this.resampleReadPos;
    while (readPos < 0) {
      const integerPosition = Math.floor(readPos);
      const fraction = readPos - integerPosition;
      for (let channel = 0; channel < this.channels; channel += 1) {
        const samples = this.resampleInput[channel].readBlock(integerPosition - 6, 6);
        const value = fraction === 0 ? samples[2] : lagrange6(samples, fraction);
        this.analysisInput[channel].writeOffset0(value);
        this.analysisInput[channel].advance(1);
      }
      this.analysisHopCounter += 1;
      step += 1;
      if (this.analysisHopCounter >= hopA) {
        this.analysisHopCounter -= hopA;
        this.hopSErr += this.exactHopS - hopS;
        this.hopAErr += this.exactHopA - hopA;
        for (let channel = 0; channel < this.channels; channel += 1) {
          this.fftTimeseries[channel] = this.analysisInput[channel].readBlock(-this.fftSize, this.fftSize);
        }
        this.processHop(hopA, hopS);
      }
      readPos = this.resampleReadPos + step * this.pitchRatio;
    }
    this.resampleReadPos = readPos;
  }

  private ensureOutputCapacity(required: number): void {
    if (required <= this.normalization.length) return;
    const capacity = nextPowerOfTwo(required);
    this.output = this.output.map((channel) => {
      const next = new Float32Array(capacity);
      next.set(channel);
      return next;
    });
    const normalization = new Float32Array(capacity);
    normalization.set(this.normalization);
    this.normalization = normalization;
  }

  private processHop(hopA: number, hopS: number): void {
    if (this.exactHopA !== this.exactHopS) {
      if (this.channels === 2) this.lrToMs();
      for (let channel = 0; channel < this.channels; channel += 1) {
        for (let index = 0; index < this.fftSize; index += 1) {
          this.fftTimeseries[channel][index] *= this.cosWindow[index];
        }
        fftShift(this.fftTimeseries[channel]);
        this.spectrum[channel] = forwardRealSpectrum(this.fftTimeseries[channel]);
      }
      for (let index = 0; index < this.bins; index += 1) {
        const real = this.spectrum[0].real[index];
        const imaginary = this.spectrum[0].imaginary[index];
        this.norm[index] = real * real + imaginary * imaginary;
        for (let channel = 0; channel < this.channels; channel += 1) {
          this.phase[channel][index] = Math.atan2(
            this.spectrum[channel].imaginary[index],
            this.spectrum[channel].real[index],
          );
        }
      }
      if (this.preserveFormants && this.pitchRatio !== 1) {
        processFormantSpectrum(
          this.norm,
          this.spectrum[0],
          1 / this.pitchRatio,
          this.sampleRate,
          this.fftSize,
          this.cutoffQuefrency,
        );
      }
      if (this.pitchRatio < 1) this.applyImagingReduction();
      this.timeStretchPhase(hopA, hopS);
      for (let channel = 0; channel < this.channels; channel += 1) {
        for (let index = 0; index < this.bins; index += 1) {
          this.phaseAccum[channel][index] = unwrapPhase(this.phaseAccum[channel][index]);
          const theta = this.phaseAccum[channel][index] - this.phase[channel][index];
          const cosine = Math.cos(theta);
          const sine = Math.sin(theta);
          const real = this.spectrum[channel].real[index];
          const imaginary = this.spectrum[channel].imaginary[index];
          this.spectrum[channel].real[index] = real * cosine - imaginary * sine;
          this.spectrum[channel].imaginary[index] = real * sine + imaginary * cosine;
        }
        this.fftTimeseries[channel] = inverseRealSpectrum(this.spectrum[channel]);
        for (let index = 0; index < this.fftSize; index += 1) {
          this.fftTimeseries[channel][index] /= this.fftSize;
        }
      }
      if (this.channels === 2) this.msToLr();
      for (let channel = 0; channel < this.channels; channel += 1) {
        fftShift(this.fftTimeseries[channel]);
        for (let index = 0; index < this.fftSize; index += 1) {
          this.fftTimeseries[channel][index] *= this.cosWindow[index];
        }
      }
    } else {
      for (let channel = 0; channel < this.channels; channel += 1) {
        for (let index = 0; index < this.fftSize; index += 1) {
          this.fftTimeseries[channel][index] *= this.sqWindow[index];
        }
      }
    }

    const gain = Math.fround(this.combinedTimeStretch * ((8 / 3) / this.overlapA));
    this.ensureOutputCapacity(this.outputWritePosition + this.fftSize + hopS);
    for (let index = 0; index < this.fftSize; index += 1) {
      const target = this.outputWritePosition + index;
      this.normalization[target] += this.sqWindow[index] * gain;
      for (let channel = 0; channel < this.channels; channel += 1) {
        this.output[channel][target] += this.fftTimeseries[channel][index] * gain;
      }
    }
    this.outputWritePosition += hopS;
  }

  private lrToMs(): void {
    for (let index = 0; index < this.fftSize; index += 1) {
      const left = this.fftTimeseries[0][index];
      const right = this.fftTimeseries[1][index];
      this.fftTimeseries[0][index] = 0.5 * (left + right);
      this.fftTimeseries[1][index] = 0.5 * (left - right);
    }
  }

  private msToLr(): void {
    for (let index = 0; index < this.fftSize; index += 1) {
      const mid = this.fftTimeseries[0][index];
      const side = this.fftTimeseries[1][index];
      this.fftTimeseries[0][index] = mid + side;
      this.fftTimeseries[1][index] = mid - side;
    }
  }

  private applyImagingReduction(): void {
    const alignment = 16;
    const imagingBeginBin = Math.ceil(
      (this.fftSize / 2 * this.pitchRatio + 1) / alignment,
    ) * alignment;
    if (imagingBeginBin >= this.bins) return;
    const count = this.bins - imagingBeginBin;
    for (let index = 0; index < count; index += 1) {
      const theta = this.randomPhases[index];
      const cosine = Math.cos(theta);
      const sine = Math.sin(theta);
      const target = imagingBeginBin + index;
      const real = this.spectrum[0].real[target];
      const imaginary = this.spectrum[0].imaginary[target];
      this.spectrum[0].real[target] = real * cosine - imaginary * sine;
      this.spectrum[0].imaginary[target] = real * sine + imaginary * cosine;
    }
    const middle = this.random.nextUint32() % count;
    const rotated = new Float32Array(count);
    for (let index = 0; index < count; index += 1) {
      rotated[index] = this.randomPhases[(index + middle) % count];
    }
    this.randomPhases.set(rotated);
  }

  private timeStretchPhase(hopA: number, hopS: number): void {
    const alpha = hopS / hopA;
    const peakIndex: number[] = [];
    const troughIndex: number[] = [];
    let lowest = this.norm[0];
    let trough = 0;
    if (this.lastNorm[0] >= this.norm[1]) {
      peakIndex.push(0);
      troughIndex.push(0);
    }
    for (let index = 1; index < this.bins - 1; index += 1) {
      if (this.lastNorm[index] >= this.norm[index - 1] && this.lastNorm[index] >= this.norm[index + 1]) {
        peakIndex.push(index);
        troughIndex.push(trough);
        trough = index;
        lowest = this.norm[index];
      } else if (this.norm[index] < lowest) {
        lowest = this.norm[index];
        trough = index;
      }
    }
    if (this.lastNorm[this.bins - 1] > this.norm[this.bins - 2]) {
      peakIndex.push(this.bins - 1);
      troughIndex.push(trough);
    }
    if (peakIndex.length === 0) {
      let maximum = 0;
      let maximumIndex = 0;
      for (let index = 0; index < this.bins; index += 1) {
        if (this.lastNorm[index] > maximum) {
          maximum = this.lastNorm[index];
          maximumIndex = index;
        }
      }
      peakIndex.push(maximumIndex);
    }

    const expectedChangeA = hopA * this.expectedPhaseChangePerBinPerSample;
    const expectedChangeS = hopS * this.expectedPhaseChangePerBinPerSample;
    for (let index = 0; index < peakIndex.length; index += 1) {
      const bin = peakIndex[index];
      for (let channel = 0; channel < this.channels; channel += 1) {
        this.phaseAccum[channel][bin] += alpha * unwrapPhase(
          this.phase[channel][bin] - this.lastPhase[channel][bin] - bin * expectedChangeA,
        ) + bin * expectedChangeS;
      }
    }
    for (let bin = peakIndex[0]; bin > 0; bin -= 1) {
      for (let channel = 0; channel < this.channels; channel += 1) {
        this.phaseAccum[channel][bin - 1] = this.phaseAccum[channel][bin]
          - alpha * unwrapPhase(this.phase[channel][bin] - this.phase[channel][bin - 1]);
      }
    }
    for (let index = 0; index < peakIndex.length - 1; index += 1) {
      const middle = troughIndex[index + 1];
      for (let bin = peakIndex[index]; bin < middle; bin += 1) {
        for (let channel = 0; channel < this.channels; channel += 1) {
          this.phaseAccum[channel][bin + 1] = this.phaseAccum[channel][bin]
            + alpha * unwrapPhase(this.phase[channel][bin + 1] - this.phase[channel][bin]);
        }
      }
      for (let bin = peakIndex[index + 1]; bin > middle + 1; bin -= 1) {
        for (let channel = 0; channel < this.channels; channel += 1) {
          this.phaseAccum[channel][bin - 1] = this.phaseAccum[channel][bin]
            - alpha * unwrapPhase(this.phase[channel][bin] - this.phase[channel][bin - 1]);
        }
      }
    }
    for (let bin = peakIndex[peakIndex.length - 1]; bin < this.bins - 1; bin += 1) {
      for (let channel = 0; channel < this.channels; channel += 1) {
        this.phaseAccum[channel][bin + 1] = this.phaseAccum[channel][bin]
          + alpha * unwrapPhase(this.phase[channel][bin + 1] - this.phase[channel][bin]);
      }
    }
    this.lastNorm.set(this.norm);
    for (let channel = 0; channel < this.channels; channel += 1) {
      this.lastPhase[channel].set(this.phase[channel]);
    }
  }
}

/**
 * Offline StaffPadTimeAndPitch with the official zero-padded source and initial
 * latency discard. The requested output length follows ClipSegment.cpp.
 */
export function processStaffPadTimeAndPitchChannels(
  channels: readonly Float32Array[],
  options: StaffPadTimeAndPitchOptions,
): Float32Array[] {
  if (channels.length < 1 || channels.length > 2) {
    throw new RangeError('StaffPad 仅支持单声道或立体声');
  }
  const inputFrames = channels[0].length;
  if (channels.some((channel) => channel.length !== inputFrames)) {
    throw new RangeError('音频声道必须长度一致');
  }
  if (!Number.isFinite(options.sampleRate) || options.sampleRate <= 0) {
    throw new RangeError('采样率必须是有限的正数');
  }
  if (!Number.isFinite(options.timeRatio) || options.timeRatio <= 0) {
    throw new RangeError('时间缩放必须是有限的正数');
  }
  if (!Number.isFinite(options.pitchRatio) || options.pitchRatio <= 0) {
    throw new RangeError('音高缩放必须是有限的正数');
  }
  if (
    !Number.isSafeInteger(options.fftSize)
    || options.fftSize < 64
    || (options.fftSize & (options.fftSize - 1)) !== 0
  ) throw new RangeError('StaffPad FFT 尺寸必须是至少 64 的 2 的幂');
  if (inputFrames === 0) return channels.map(() => new Float32Array());
  if (Math.abs(options.timeRatio - 1) < 1e-6 && options.pitchRatio === 1) {
    return channels.map((channel) => channel.slice());
  }

  const outputFrames = Math.max(1, Math.round(inputFrames * options.timeRatio));
  const output = channels.map(() => new Float32Array(outputFrames));
  const processor = new StaffPadProcessor(channels, options, outputFrames);

  const latency = options.fftSize - options.fftSize / 4 + 3;
  const combined = options.timeRatio * options.pitchRatio;
  const coefficient = combined < 1 ? 1 / 3 : 2 / 3;
  let remainingDiscard = Math.trunc(latency * (combined * coefficient + (1 - coefficient)));
  let guard = 0;
  while (remainingDiscard > 0) {
    if (processor.illState() || ++guard > 100000) {
      throw new Error('StaffPad 初始化无法产生有效输出');
    }
    processor.feedNextHop();
    const total = Math.min(processor.getAvailableOutputSamples(), remainingDiscard);
    let retrieved = 0;
    while (retrieved < total) {
      const count = Math.min(MAX_BLOCK_SIZE, total - retrieved);
      processor.retrieveAudio(count, null);
      retrieved += count;
    }
    remainingDiscard -= total;
  }

  let offset = 0;
  while (offset < outputFrames) {
    if (processor.illState() || ++guard > 1000000) {
      throw new Error('StaffPad 处理无法产生有效输出');
    }
    while (processor.getAvailableOutputSamples() <= 0) {
      if (processor.illState() || ++guard > 1000000) {
        throw new Error('StaffPad 处理无法继续读取音频');
      }
      processor.feedNextHop();
    }
    const count = Math.min(
      MAX_BLOCK_SIZE,
      processor.getAvailableOutputSamples(),
      outputFrames - offset,
    );
    processor.retrieveAudio(count, output, offset);
    offset += count;
  }
  return output;
}
