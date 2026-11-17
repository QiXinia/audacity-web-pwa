// Audacity 4.0.2 share/nyquist-plug-ins/legacy-limiter.ny.
// The Nyquist control-rate peak envelopes are expanded to sample-rate loops.

export type LegacyLimiterType = 'softLimit' | 'hardLimit' | 'softClip' | 'hardClip';

export interface LegacyLimiterSettings {
  type: LegacyLimiterType;
  inputGainLeftDb: number;
  inputGainRightDb: number;
  limitToDb: number;
  holdMs: number;
  applyMakeupGain: boolean;
}

export const DEFAULT_LEGACY_LIMITER_SETTINGS: Readonly<LegacyLimiterSettings> = Object.freeze({
  type: 'softLimit',
  inputGainLeftDb: 0,
  inputGainRightDb: 0,
  limitToDb: -3,
  holdMs: 10,
  applyMakeupGain: false,
});

export const MAX_LEGACY_LIMITER_TOTAL_SAMPLES = 20_000_000;

const SOFT_CLIP_KNEE = 1 - 1 / Math.PI;
const SOFT_CLIP_LEVEL = (0.5 + SOFT_CLIP_KNEE) * (2 / Math.PI);

function dbToLinear(valueDb: number): number {
  return 10 ** (valueDb / 20);
}

function assertRange(value: number, minimum: number, maximum: number, label: string): void {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new RangeError(`Legacy limiter ${label}必须在 ${minimum}–${maximum} 之间`);
  }
}

export function validateLegacyLimiterSettings(settings: LegacyLimiterSettings): void {
  if (!['softLimit', 'hardLimit', 'softClip', 'hardClip'].includes(settings.type)) {
    throw new RangeError('Legacy limiter Type 无效');
  }
  assertRange(settings.inputGainLeftDb, 0, 10, 'mono/Left Input Gain');
  assertRange(settings.inputGainRightDb, 0, 10, 'Right channel Input Gain');
  assertRange(settings.limitToDb, -10, 0, 'Limit to');
  assertRange(settings.holdMs, 1, 50, 'Hold');
  if (typeof settings.applyMakeupGain !== 'boolean') {
    throw new TypeError('Legacy limiter Apply Make-up Gain 必须为布尔值');
  }
}

function peak(input: Float32Array, start: number, end: number): number {
  let result = 0;
  const boundedEnd = Math.min(input.length, end);
  for (let index = Math.max(0, start); index < boundedEnd; index += 1) {
    result = Math.max(result, Math.abs(input[index]));
  }
  return result;
}

/** OP-PEAK over four-step windows with one-step hops. */
function makePeakBlocks(input: Float32Array, step: number): Float64Array {
  const count = Math.ceil(input.length / step);
  const blocks = new Float64Array(count);
  for (let block = 0; block < count; block += 1) {
    const start = block * step;
    blocks[block] = peak(input, start, start + 4 * step);
  }
  return blocks;
}

function hardLimitChannel(
  input: Float32Array,
  threshold: number,
  sampleRate: number,
  holdMs: number,
): Float32Array {
  const step = Math.max(1, Math.round((holdMs / 3000) * sampleRate));
  const blocks = makePeakBlocks(input, step);
  const initial = peak(input, 0, 3 * step);
  const output = new Float32Array(input.length);
  for (let index = 0; index < input.length; index += 1) {
    const block = Math.floor(index / step) - 3;
    const lookAheadPeak = block < 0 ? initial : blocks[block];
    const envelope = Math.max(1, lookAheadPeak / threshold);
    output[index] = input[index] / envelope;
  }
  return output;
}

function softLimitChannel(
  input: Float32Array,
  threshold: number,
  sampleRate: number,
  holdMs: number,
): Float32Array {
  const hardLimited = hardLimitChannel(input, 1, sampleRate, holdMs);
  const step = Math.max(1, Math.trunc((holdMs / 3000) * sampleRate));
  const blocks = makePeakBlocks(hardLimited, step);
  const initial = peak(hardLimited, 0, 2 * step);
  const pauseLevel = Math.min(0.9, Math.max(0, threshold * (2 - initial)));
  const output = new Float32Array(input.length);
  for (let index = 0; index < input.length; index += 1) {
    let envelope = pauseLevel;
    if (index >= 3 * step) {
      const block = Math.floor((index - 3 * step) / step);
      envelope = Math.min(1, Math.max(0, threshold * (2 - blocks[block])));
    }
    output[index] = hardLimited[index] * envelope;
  }
  return output;
}

/** Official soft-clip table evaluated analytically; inputs outside [-1, 1] saturate. */
function softClipShape(value: number): number {
  const clamped = Math.max(-1, Math.min(1, value));
  const magnitude = Math.abs(clamped);
  if (magnitude <= 1 / Math.PI) return clamped;
  const phase = ((magnitude - 1 / Math.PI) / SOFT_CLIP_KNEE) * (Math.PI / 2);
  const curved = (2 / Math.PI) * (0.5 + SOFT_CLIP_KNEE * Math.sin(phase));
  return Math.sign(clamped) * curved;
}

function softClipChannel(input: Float32Array, threshold: number, makeup: boolean): Float32Array {
  const output = new Float32Array(input.length);
  const outputScale = makeup ? 0.999 / SOFT_CLIP_LEVEL : threshold / SOFT_CLIP_LEVEL;
  for (let index = 0; index < input.length; index += 1) {
    const normalized = (SOFT_CLIP_LEVEL / threshold) * input[index];
    output[index] = outputScale * softClipShape(normalized);
  }
  return output;
}

export function processLegacyLimiterChannels(
  channels: readonly Float32Array[],
  settings: LegacyLimiterSettings,
  sampleRate: number,
): Float32Array[] {
  validateLegacyLimiterSettings(settings);
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new RangeError('Legacy limiter 采样率必须是正的有限数值');
  }
  if (!Array.isArray(channels) || channels.length < 1 || channels.length > 2) {
    throw new RangeError('Legacy limiter 仅支持单声道或立体声音轨');
  }
  const length = channels[0]?.length ?? 0;
  if (length === 0) throw new RangeError('Legacy limiter 输入声道必须非空');
  if (!channels.every((channel) => channel instanceof Float32Array && channel.length === length)) {
    throw new RangeError('Legacy limiter 输入声道必须等长');
  }
  if (!Number.isSafeInteger(length * channels.length) || length * channels.length > MAX_LEGACY_LIMITER_TOTAL_SAMPLES) {
    throw new RangeError(`Legacy limiter 总处理量不能超过 ${MAX_LEGACY_LIMITER_TOTAL_SAMPLES} 个采样`);
  }

  const threshold = dbToLinear(settings.limitToDb);
  const gains = [dbToLinear(settings.inputGainLeftDb), dbToLinear(settings.inputGainRightDb)];
  const gained = channels.map((channel, channelIndex) => {
    const next = new Float32Array(length);
    const gain = gains[channelIndex];
    for (let index = 0; index < length; index += 1) {
      if (!Number.isFinite(channel[index])) {
        throw new RangeError(`Legacy limiter 输入在第 ${index} 个采样包含非有限数值`);
      }
      next[index] = channel[index] * gain;
    }
    return next;
  });

  let processed: Float32Array[];
  if (settings.type === 'softClip') {
    processed = gained.map((channel) => softClipChannel(channel, threshold, settings.applyMakeupGain));
  } else {
    processed = gained.map((channel) => {
      if (settings.type === 'hardClip') {
        return channel.map((sample) => Math.max(-threshold, Math.min(threshold, sample)));
      }
      if (settings.type === 'hardLimit') return hardLimitChannel(channel, threshold, sampleRate, settings.holdMs);
      return softLimitChannel(channel, threshold, sampleRate, settings.holdMs);
    });
    if (settings.applyMakeupGain) {
      const makeup = 0.999 / threshold;
      processed = processed.map((channel) => channel.map((sample) => sample * makeup));
    }
  }

  for (const channel of processed) {
    for (let index = 0; index < channel.length; index += 1) {
      if (!Number.isFinite(channel[index])) {
        throw new RangeError(`Legacy limiter 在第 ${index} 个采样产生非有限输出`);
      }
    }
  }
  return processed;
}
