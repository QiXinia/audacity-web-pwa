export interface LegacyCompressorSettings {
  thresholdDb: number;
  noiseFloorDb: number;
  ratio: number;
  attackTime: number;
  releaseTime: number;
  normalize: boolean;
  usePeak: boolean;
}

export const DEFAULT_LEGACY_COMPRESSOR_SETTINGS: Readonly<LegacyCompressorSettings> = Object.freeze({
  thresholdDb: -12,
  noiseFloorDb: -40,
  ratio: 2,
  attackTime: 0.2,
  releaseTime: 1,
  normalize: true,
  usePeak: false,
});

const CIRCLE_SIZE = 100;

function dbToLinear(valueDb: number): number {
  return Math.pow(10, valueDb / 20);
}

function assertRange(value: number, minimum: number, maximum: number, label: string): void {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new RangeError(`${label}必须在 ${minimum}–${maximum} 之间`);
  }
}

export function validateLegacyCompressorSettings(settings: LegacyCompressorSettings): void {
  assertRange(settings.thresholdDb, -60, -1, '阈值');
  assertRange(settings.noiseFloorDb, -80, -20, '噪声地板');
  assertRange(settings.ratio, 1.1, 10, '压缩比');
  assertRange(settings.attackTime, 0.1, 5, '攻击时间');
  assertRange(settings.releaseTime, 1, 30, '释放时间');
  if (typeof settings.normalize !== 'boolean' || typeof settings.usePeak !== 'boolean') {
    throw new TypeError('Legacy Compressor 开关必须为布尔值');
  }
}

export function isLegacyCompressorBypassed(settings: LegacyCompressorSettings): boolean {
  return settings.ratio === 1.1 && settings.normalize === false;
}

interface EnvelopeState {
  circle: number[];
  circlePos: number;
  rmsSum: number;
  noiseCounter: number;
  lastLevel: number;
}

function averageCircle(state: EnvelopeState, value: number): number {
  state.rmsSum -= state.circle[state.circlePos];
  state.circle[state.circlePos] = value * value;
  state.rmsSum += state.circle[state.circlePos];
  const level = Math.sqrt(state.rmsSum / CIRCLE_SIZE);
  state.circlePos = (state.circlePos + 1) % CIRCLE_SIZE;
  return level;
}

function buildEnvelope(channel: Float32Array, settings: LegacyCompressorSettings, sampleRate: number): Float32Array {
  const threshold = dbToLinear(settings.thresholdDb);
  const noiseFloor = dbToLinear(settings.noiseFloorDb);
  const attackInverseFactor = Math.exp(Math.log(threshold) / (sampleRate * settings.attackTime + 0.5));
  const decayFactor = Math.exp(Math.log(threshold) / (sampleRate * settings.releaseTime + 0.5));
  const envelope = new Float32Array(channel.length);
  const circle = Array.from({ length: CIRCLE_SIZE }, () => 0);
  const state: EnvelopeState = {
    circle,
    circlePos: 0,
    rmsSum: 0,
    noiseCounter: 100,
    lastLevel: threshold,
  };

  for (let i = 0; i < channel.length; i += 1) {
    const level = settings.usePeak ? Math.abs(channel[i]) : averageCircle(state, channel[i]);
    if (level < noiseFloor) state.noiseCounter += 1;
    else state.noiseCounter = 0;

    if (state.noiseCounter < 100) {
      state.lastLevel *= decayFactor;
      if (state.lastLevel < threshold) state.lastLevel = threshold;
      if (level > state.lastLevel) state.lastLevel = level;
    }
    envelope[i] = state.lastLevel;
  }

  let last = state.lastLevel;
  for (let i = channel.length - 1; i >= 0; i -= 1) {
    last *= attackInverseFactor;
    if (last < threshold) last = threshold;
    if (envelope[i] < last) envelope[i] = last;
    else last = envelope[i];
  }
  return envelope;
}

export function processLegacyCompressorChannel(
  input: Float32Array,
  settings: LegacyCompressorSettings,
  sampleRate: number,
): Float32Array {
  validateLegacyCompressorSettings(settings);
  if (!Number.isSafeInteger(sampleRate) || sampleRate <= 0) throw new RangeError('采样率必须是大于零的安全整数');
  if (!(input instanceof Float32Array)) throw new TypeError('输入必须是 Float32Array');
  if (input.length === 0) return new Float32Array(0);

  const threshold = dbToLinear(settings.thresholdDb);
  const compression = settings.ratio > 1 ? 1 - 1 / settings.ratio : 0;
  const envelope = buildEnvelope(input, settings, sampleRate);
  const output = new Float32Array(input.length);
  let max = 0;

  for (let i = 0; i < input.length; i += 1) {
    const env = envelope[i];
    const factor = settings.usePeak ? Math.pow(1 / env, compression) : Math.pow(threshold / env, compression);
    const value = input[i] * factor;
    output[i] = value;
    if (Math.abs(value) > max) max = Math.abs(value);
  }

  if (settings.normalize && max !== 0) {
    for (let i = 0; i < output.length; i += 1) output[i] /= max;
  }
  return output;
}

export function processLegacyCompressorChannels(
  channels: readonly Float32Array[],
  settings: LegacyCompressorSettings,
  sampleRate: number,
): Float32Array[] {
  validateLegacyCompressorSettings(settings);
  if (!Array.isArray(channels) || channels.length === 0) throw new RangeError('Legacy Compressor 需要至少一个声道');
  const length = channels[0].length;
  if (!channels.every((channel) => channel instanceof Float32Array && channel.length === length)) {
    throw new RangeError('Legacy Compressor 输入声道必须等长');
  }
  return channels.map((channel) => processLegacyCompressorChannel(channel, settings, sampleRate));
}
