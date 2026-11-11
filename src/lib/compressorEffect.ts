export interface CompressorSettings {
  thresholdDb: number;
  makeupGainDb: number;
  kneeWidthDb: number;
  compressionRatio: number;
  lookaheadMs: number;
  attackMs: number;
  releaseMs: number;
}

export const DEFAULT_COMPRESSOR_SETTINGS: Readonly<CompressorSettings> = Object.freeze({
  thresholdDb: -12,
  makeupGainDb: 9,
  kneeWidthDb: 6,
  compressionRatio: 4,
  lookaheadMs: 3,
  attackMs: 3,
  releaseMs: 100,
});

const MAX_BLOCK_SIZE = 512;
const LOG2_TO_DB = Math.fround(20 / Math.fround(3.321928094887362));
const floatBuffer = new ArrayBuffer(4);
const floatView = new Float32Array(floatBuffer);
const intView = new Int32Array(floatBuffer);

function assertRange(value: number, minimum: number, maximum: number, label: string): void {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new RangeError(`${label}必须在 ${minimum}–${maximum} 之间`);
  }
}

export function validateCompressorSettings(settings: CompressorSettings): void {
  assertRange(settings.thresholdDb, -60, 0, '阈值');
  assertRange(settings.makeupGainDb, -30, 30, '补偿增益');
  assertRange(settings.kneeWidthDb, 0, 30, '拐点宽度');
  assertRange(settings.compressionRatio, 1, 100, '压缩比');
  assertRange(settings.lookaheadMs, 0, 100, 'Lookahead');
  assertRange(settings.attackMs, 0, 200, 'Attack');
  assertRange(settings.releaseMs, 0, 1000, 'Release');
}

export function isCompressorBypassed(settings: CompressorSettings): boolean {
  return settings.compressionRatio === 1 && settings.makeupGainDb === 0 && settings.lookaheadMs === 0;
}

function applyCharacteristic(overshootDb: number, kneeDb: number, slope: number): number {
  const kneeHalf = kneeDb / 2;
  if (overshootDb <= -kneeHalf) return 0;
  if (overshootDb <= kneeHalf) {
    return Math.fround(0.5 * slope * (overshootDb + kneeHalf) * (overshootDb + kneeHalf) / kneeDb);
  }
  return Math.fround(slope * overshootDb);
}

/** Audacity GainReductionComputer::getCharacteristicSample, including make-up gain. */
export function evaluateCompressorTransferFunction(settings: CompressorSettings, inputDb: number): number {
  validateCompressorSettings(settings);
  if (!Number.isFinite(inputDb)) throw new RangeError('曲线输入电平必须是有限数值');
  const slope = Math.fround(1 / settings.compressionRatio - 1);
  const overshoot = Math.fround(inputDb - settings.thresholdDb);
  return Math.fround(applyCharacteristic(overshoot, settings.kneeWidthDb, slope) + inputDb + settings.makeupGainDb);
}

export function getMaxCompressorCompressionDb(settings: CompressorSettings): number {
  return Math.fround(settings.makeupGainDb - evaluateCompressorTransferFunction(settings, 0));
}

/** Bit-level port of Audacity's FastLog2 float approximation. */
function fastLog2(value: number): number {
  floatView[0] = value;
  let bits = intView[0];
  let log2 = ((bits >> 23) & 255) - 128;
  bits = (bits & ~(255 << 23)) + (127 << 23);
  intView[0] = bits;
  const normalized = floatView[0];
  const quadratic = Math.fround(Math.fround(Math.fround(-0.3358287811) * normalized + 2) * normalized - 0.65871759316667);
  log2 = Math.fround(log2 + quadratic);
  return log2;
}

interface LookAheadState {
  readonly buffer: Float32Array;
  readonly delayInSamples: number;
  writePosition: number;
  lastPushedSamples: number;
}

export interface CompressorState {
  readonly settings: CompressorSettings;
  readonly sampleRate: number;
  readonly channelCount: number;
  readonly blockSize: number;
  readonly delayInSamples: number;
  readonly envelope: Float32Array;
  readonly delayedInput: Float32Array[];
  readonly lookahead: LookAheadState | null;
  gainState: number;
  readonly alphaAttack: number;
  readonly alphaRelease: number;
}

function timeToGain(sampleRate: number, timeMs: number): number {
  return Math.exp(-1 / (sampleRate * timeMs / 1000));
}

export function createCompressorState(
  settings: CompressorSettings,
  sampleRate: number,
  channelCount: number,
): CompressorState {
  validateCompressorSettings(settings);
  if (!Number.isSafeInteger(sampleRate) || sampleRate <= 0) {
    throw new RangeError('采样率必须是大于零的安全整数');
  }
  if (channelCount !== 1 && channelCount !== 2) {
    throw new RangeError('Compressor 仅支持单声道或立体声轨道');
  }
  const delayInSamples = Math.floor(settings.lookaheadMs * sampleRate / 1000);
  const bufferLength = MAX_BLOCK_SIZE + delayInSamples;
  if (!Number.isSafeInteger(delayInSamples) || !Number.isSafeInteger(bufferLength) || bufferLength < MAX_BLOCK_SIZE) {
    throw new RangeError('Compressor look-ahead 缓冲长度无效');
  }
  return {
    settings: { ...settings },
    sampleRate,
    channelCount,
    blockSize: MAX_BLOCK_SIZE,
    delayInSamples,
    envelope: new Float32Array(MAX_BLOCK_SIZE),
    delayedInput: Array.from({ length: channelCount }, () => new Float32Array(bufferLength)),
    lookahead: delayInSamples > 0 ? {
      buffer: new Float32Array(bufferLength),
      delayInSamples,
      writePosition: 0,
      lastPushedSamples: 0,
    } : null,
    gainState: 0,
    alphaAttack: Math.fround(1 - timeToGain(sampleRate, settings.attackMs)),
    alphaRelease: Math.fround(1 - timeToGain(sampleRate, settings.releaseMs)),
  };
}

function computeGainReduction(state: CompressorState, blockLength: number): void {
  const { settings } = state;
  const slope = Math.fround(1 / settings.compressionRatio - 1);
  for (let index = 0; index < blockLength; index += 1) {
    const levelDb = Math.fround(LOG2_TO_DB * fastLog2(state.envelope[index]));
    const gainReduction = applyCharacteristic(levelDb - settings.thresholdDb, settings.kneeWidthDb, slope);
    const difference = Math.fround(gainReduction - state.gainState);
    const alpha = difference < 0 ? state.alphaAttack : state.alphaRelease;
    state.gainState = Math.fround(state.gainState + alpha * difference);
    state.envelope[index] = state.gainState;
  }
}

function processPositions(startIndex: number, count: number): [number, number] {
  if (count <= 0) return [0, 0];
  const first = Math.min(startIndex + 1, count);
  return [first, count - first];
}

function pushLookaheadSamples(lookahead: LookAheadState, source: Float32Array, count: number): void {
  const length = lookahead.buffer.length;
  const start = lookahead.writePosition;
  const first = Math.min(length - start, count);
  lookahead.buffer.set(source.subarray(0, first), start);
  if (count - first > 0) lookahead.buffer.set(source.subarray(first, count), 0);
  lookahead.writePosition = (lookahead.writePosition + count) % length;
  lookahead.lastPushedSamples = count;
}

function smoothLookaheadGain(lookahead: LookAheadState): void {
  const { buffer, delayInSamples } = lookahead;
  let nextGainReduction = 0;
  let step = 0;
  let index = lookahead.writePosition - 1;
  if (index < 0) index += buffer.length;

  const fade = (count: number, stopAtProcessedMinimum: boolean): boolean => {
    const [first, second] = processPositions(index, count);
    for (let run = 0; run < 2; run += 1) {
      const size = run === 0 ? first : second;
      if (size === 0 || (run === 1 && stopAtProcessedMinimum)) continue;
      if (run === 1) index = buffer.length - 1;
      for (let cursor = 0; cursor < size; cursor += 1) {
        const sample = buffer[index];
        if (sample > nextGainReduction) {
          buffer[index] = nextGainReduction;
          nextGainReduction += step;
        } else {
          if (stopAtProcessedMinimum) return true;
          step = -sample / delayInSamples;
          nextGainReduction = sample + step;
        }
        index -= 1;
      }
    }
    return false;
  };

  fade(lookahead.lastPushedSamples, false);
  if (index < 0) index = buffer.length - 1;
  fade(delayInSamples, true);
}

function readLookaheadSamples(lookahead: LookAheadState, destination: Float32Array, count: number): void {
  const length = lookahead.buffer.length;
  let start = lookahead.writePosition - lookahead.lastPushedSamples - lookahead.delayInSamples;
  if (start < 0) start += length;
  start %= length;
  const first = Math.min(length - start, count);
  destination.set(lookahead.buffer.subarray(start, start + first), 0);
  if (count - first > 0) destination.set(lookahead.buffer.subarray(0, count - first), first);
}

/**
 * Streaming port of Audacity 4.0.2 CompressorProcessor. It deliberately returns
 * the processor's delayed stream; use processCompressorChannels for the offline
 * EffectStage latency-compensated result.
 */
export function processCompressorStream(
  channels: readonly Float32Array[],
  state: CompressorState,
): Float32Array[] {
  const length = channels[0]?.length ?? 0;
  if (
    channels.length !== state.channelCount
    || length < 1
    || channels.some((channel) => channel.length !== length)
  ) {
    throw new RangeError('Compressor 输入声道必须与状态一致且等长');
  }
  const output = channels.map((channel) => new Float32Array(channel.length));

  for (let offset = 0; offset < length; offset += state.blockSize) {
    const blockLength = Math.min(length - offset, state.blockSize);
    for (let index = 0; index < blockLength; index += 1) {
      let maximum = 0;
      for (let channel = 0; channel < channels.length; channel += 1) {
        const input = channels[channel][offset + index];
        if (!Number.isFinite(input)) {
          throw new RangeError(`Compressor 输入在第 ${offset + index} 个采样包含非有限值`);
        }
        maximum = Math.max(maximum, Math.abs(input));
      }
      state.envelope[index] = maximum;
    }

    computeGainReduction(state, blockLength);
    if (state.lookahead) {
      pushLookaheadSamples(state.lookahead, state.envelope, blockLength);
      smoothLookaheadGain(state.lookahead);
      readLookaheadSamples(state.lookahead, state.envelope, blockLength);
    }

    for (let channel = 0; channel < channels.length; channel += 1) {
      const delayed = state.delayedInput[channel];
      delayed.set(channels[channel].subarray(offset, offset + blockLength), state.delayInSamples);
      for (let index = 0; index < blockLength; index += 1) {
        const gain = 10 ** (0.05 * (state.envelope[index] + state.settings.makeupGainDb));
        const stored = Math.fround(delayed[index] * gain);
        if (!Number.isFinite(stored)) {
          throw new RangeError(`Compressor 在第 ${offset + index} 个采样产生非有限输出`);
        }
        output[channel][offset + index] = stored;
      }
      delayed.copyWithin(0, blockLength, blockLength + state.delayInSamples);
    }
  }
  return output;
}

/**
 * Offline Audacity EffectStage semantics: process the selection, discard the
 * initial look-ahead latency, then feed the same number of zero samples to
 * recover the delayed tail. Output therefore has the input's exact time base.
 */
export function processCompressorChannels(
  channels: readonly Float32Array[],
  settings: CompressorSettings,
  sampleRate: number,
): Float32Array[] {
  const state = createCompressorState(settings, sampleRate, channels.length);
  const delayed = processCompressorStream(channels, state);
  const delay = state.delayInSamples;
  if (delay === 0) return delayed;
  const length = channels[0]?.length ?? 0;
  const tail = processCompressorStream(
    channels.map(() => new Float32Array(delay)),
    state,
  );
  return channels.map((_, channel) => {
    const aligned = new Float32Array(length);
    for (let index = 0; index < length; index += 1) {
      const rawIndex = index + delay;
      aligned[index] = rawIndex < length
        ? delayed[channel][rawIndex]
        : tail[channel][rawIndex - length];
    }
    return aligned;
  });
}
