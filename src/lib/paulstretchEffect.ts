// Audacity Paulstretch: extreme time stretch and spectral smearing.
// Source: Audacity src/effects/builtin_collection/paulstretch/
// paulstretcheffect.{h,cpp}. This deterministic Web fallback preserves the
// official Hann-window magnitude spectrum, randomized phases, overlap blend,
// endpoint blending, buffer-size rounding and amount adjustment. It uses a
// seeded PRNG and an exact-length offline scheduler, not platform rand() or a
// claim of bit-identical Audacity output.

export interface PaulstretchSettings {
  stretchFactor: number;
  timeResolution: number;
}

export const MIN_PAULSTRETCH_FACTOR = 1;
export const MAX_PAULSTRETCH_FACTOR = 1e20;
export const MIN_PAULSTRETCH_TIME_RESOLUTION = 0.00099;
export const MAX_PAULSTRETCH_TIME_RESOLUTION = 1e20;
export const MAX_PAULSTRETCH_TOTAL_OUTPUT_SAMPLES = 20_000_000;
export const MAX_PAULSTRETCH_FFT_HALF_SIZE = 65_536;
export const DEFAULT_PAULSTRETCH_SETTINGS: Readonly<PaulstretchSettings> = Object.freeze({
  stretchFactor: 10,
  timeResolution: 0.25,
});

export function validatePaulstretchSettings(settings: PaulstretchSettings): void {
  if (
    !Number.isFinite(settings.stretchFactor)
    || settings.stretchFactor < MIN_PAULSTRETCH_FACTOR
    || settings.stretchFactor > MAX_PAULSTRETCH_FACTOR
  ) {
    throw new RangeError('Paulstretch 拉伸倍数必须是 1 至 1e20 之间的有限数值');
  }
  if (
    !Number.isFinite(settings.timeResolution)
    || settings.timeResolution < MIN_PAULSTRETCH_TIME_RESOLUTION
    || settings.timeResolution > MAX_PAULSTRETCH_TIME_RESOLUTION
  ) {
    throw new RangeError('Paulstretch 时间分辨率必须是 0.00099 至 1e20 秒之间的有限数值');
  }
}

/** Audacity rounds rate * resolution / 2 to the nearest power of two, minimum 128. */
export function paulstretchBufferSize(sampleRate: number, timeResolution: number): number {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new RangeError('采样率必须大于零');
  }
  if (
    !Number.isFinite(timeResolution)
    || timeResolution < MIN_PAULSTRETCH_TIME_RESOLUTION
    || timeResolution > MAX_PAULSTRETCH_TIME_RESOLUTION
  ) {
    throw new RangeError('Paulstretch 时间分辨率超出允许范围');
  }
  const scaled = sampleRate * timeResolution / 2;
  const size = 2 ** Math.floor(Math.log2(scaled) + 0.5);
  if (!Number.isFinite(size) || !Number.isSafeInteger(size) || size > MAX_PAULSTRETCH_FFT_HALF_SIZE) {
    throw new RangeError('Paulstretch 时间分辨率超过浏览器内存上限，请减小该参数');
  }
  return Math.max(128, size);
}

export function paulstretchMinimumInputLength(bufferSize: number): number {
  if (!Number.isSafeInteger(bufferSize) || bufferSize < 128) {
    throw new RangeError('Paulstretch 缓冲区大小无效');
  }
  return bufferSize * 2 + 1;
}

export function paulstretchOutputLength(
  inputLength: number,
  settings: PaulstretchSettings,
  sampleRate: number,
): number {
  validatePaulstretchSettings(settings);
  if (!Number.isSafeInteger(inputLength) || inputLength < 1) {
    throw new RangeError('Paulstretch 输入采样数必须是正整数');
  }
  const bufferSize = paulstretchBufferSize(sampleRate, settings.timeResolution);
  const minimum = paulstretchMinimumInputLength(bufferSize);
  if (inputLength < minimum) {
    throw new RangeError(
      `选区太短：当前时间分辨率至少需要 ${minimum} 个采样（${(minimum / sampleRate).toFixed(3)} 秒）`,
    );
  }
  const outputLength = Math.round(inputLength * settings.stretchFactor);
  if (!Number.isSafeInteger(outputLength) || outputLength < 1) {
    throw new RangeError('Paulstretch 输出采样数无效，请减小拉伸倍数');
  }
  return outputLength;
}

function validateChannels(
  channels: readonly Float32Array[],
  settings: PaulstretchSettings,
  sampleRate: number,
): { inputLength: number; bufferSize: number; outputLength: number } {
  if (channels.length === 0) throw new RangeError('至少需要一个音频声道');
  const inputLength = channels[0].length;
  if (channels.some((channel) => channel.length !== inputLength)) {
    throw new RangeError('Paulstretch 输入声道必须等长');
  }
  for (const channel of channels) {
    for (let index = 0; index < channel.length; index += 1) {
      if (!Number.isFinite(channel[index])) {
        throw new RangeError(`Paulstretch 输入在第 ${index} 个采样包含非有限数值`);
      }
    }
  }
  const bufferSize = paulstretchBufferSize(sampleRate, settings.timeResolution);
  const outputLength = paulstretchOutputLength(inputLength, settings, sampleRate);
  const total = outputLength * channels.length;
  if (!Number.isSafeInteger(total) || total > MAX_PAULSTRETCH_TOTAL_OUTPUT_SAMPLES) {
    throw new RangeError('Paulstretch 输出超过 2000 万总采样上限，请缩短选区或减小拉伸倍数');
  }
  return { inputLength, bufferSize, outputLength };
}

/** In-place iterative radix-2 complex FFT; inverse mode includes 1/N scaling. */
function fft(real: Float32Array, imaginary: Float32Array, inverse: boolean): void {
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
    for (let start = 0; start < length; start += block) {
      let twiddleReal = 1;
      let twiddleImaginary = 0;
      const half = block / 2;
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
    for (let index = 0; index < length; index += 1) {
      real[index] /= length;
      imaginary[index] /= length;
    }
  }
}

function createRandomPhaseGenerator(seed = 0x6d2b79f5): () => number {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return (state & 0x7fff) * Math.PI / 16_384;
  };
}

function processChannel(
  input: Float32Array,
  bufferSize: number,
  adjustedAmount: number,
  outputLength: number,
  randomPhase: () => number,
): Float32Array {
  const poolSize = bufferSize * 2;
  const maximumPosition = input.length - poolSize;
  const window = new Float32Array(poolSize);
  for (let index = 0; index < poolSize; index += 1) {
    window[index] = 0.5 - 0.5 * Math.cos(2 * Math.PI * index / (poolSize - 1));
  }
  const real = new Float32Array(poolSize);
  const imaginary = new Float32Array(poolSize);
  const oldOutput = new Float32Array(poolSize);
  const block = new Float32Array(bufferSize);
  const output = new Float32Array(outputLength);
  const blendRate = Math.PI / bufferSize;
  const amplitude = 2; // out_bufsize / poolsize * 4, with out_bufsize == bufferSize.
  const blendConstant = 0.853553390593;

  for (let outputPosition = 0; outputPosition < outputLength; outputPosition += bufferSize) {
    const position = outputPosition === 0
      ? 0
      : Math.max(0, Math.min(maximumPosition, Math.round(outputPosition / adjustedAmount)));
    for (let index = 0; index < poolSize; index += 1) {
      const source = position + index;
      real[index] = (source < input.length ? input[source] : 0) * window[index];
      imaginary[index] = 0;
    }
    fft(real, imaginary, false);
    for (let bin = 1; bin < bufferSize; bin += 1) {
      const magnitude = Math.hypot(real[bin], imaginary[bin]);
      const phase = randomPhase();
      const cosine = magnitude * Math.cos(phase);
      const sine = magnitude * Math.sin(phase);
      real[bin] = cosine;
      imaginary[bin] = sine;
      real[poolSize - bin] = cosine;
      imaginary[poolSize - bin] = -sine;
    }
    real[0] = 0;
    imaginary[0] = 0;
    real[bufferSize] = 0;
    imaginary[bufferSize] = 0;
    fft(real, imaginary, true);

    for (let index = 0; index < bufferSize; index += 1) {
      const mix = 0.5 + 0.5 * Math.cos(index * blendRate);
      const value = real[index + bufferSize] * (1 - mix) + oldOutput[index] * mix;
      block[index] = value
        * (blendConstant - (1 - blendConstant) * Math.cos(index * 2 * blendRate))
        * amplitude;
    }
    oldOutput.set(real);
    const valid = Math.min(bufferSize, outputLength - outputPosition);
    output.set(block.subarray(0, valid), outputPosition);
  }

  // Blend the actual trimmed endpoints, not a potentially discarded block tail.
  const fadeLength = Math.min(
    100,
    bufferSize - 1,
    Math.floor(outputLength / 2),
    Math.floor(input.length / 2),
  );
  for (let index = 0; index < fadeLength; index += 1) {
    const fraction = index / fadeLength;
    output[index] = output[index] * fraction + input[index] * (1 - fraction);
    const outputIndex = outputLength - 1 - index;
    const inputIndex = input.length - 1 - index;
    output[outputIndex] = output[outputIndex] * fraction + input[inputIndex] * (1 - fraction);
  }
  return output;
}

/**
 * Stretch every channel with shared settings and a deterministic random stream.
 * Output frame counts are exact and channel lengths always match.
 */
export function processPaulstretchChannels(
  channels: readonly Float32Array[],
  settings: PaulstretchSettings,
  sampleRate: number,
): Float32Array[] {
  const { inputLength, bufferSize, outputLength } = validateChannels(
    channels,
    settings,
    sampleRate,
  );
  const adjustedAmount = 1 + (settings.stretchFactor - 1)
    * inputLength / (inputLength - bufferSize * 2);
  const randomPhase = createRandomPhaseGenerator();
  const output = channels.map((channel) => processChannel(
    channel,
    bufferSize,
    adjustedAmount,
    outputLength,
    randomPhase,
  ));
  for (const channel of output) {
    for (let index = 0; index < channel.length; index += 1) {
      if (!Number.isFinite(channel[index])) {
        throw new RangeError(`Paulstretch 在第 ${index} 个采样产生非有限输出`);
      }
    }
  }
  return output;
}
