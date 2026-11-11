export const DISTORTION_TYPES = [
  'hard-clipping',
  'soft-clipping',
  'soft-overdrive',
  'medium-overdrive',
  'hard-overdrive',
  'cubic-curve',
  'even-harmonics',
  'sine-curve',
  'leveller',
  'rectifier',
  'hard-limiter',
] as const;

export type DistortionType = typeof DISTORTION_TYPES[number];

export const DISTORTION_TYPE_LABELS: Readonly<Record<DistortionType, string>> = Object.freeze({
  'hard-clipping': 'Hard Clipping',
  'soft-clipping': 'Soft Clipping',
  'soft-overdrive': 'Soft Overdrive',
  'medium-overdrive': 'Medium Overdrive',
  'hard-overdrive': 'Hard Overdrive',
  'cubic-curve': 'Cubic Curve (odd harmonics)',
  'even-harmonics': 'Even Harmonics',
  'sine-curve': 'Sine Curve',
  leveller: 'Leveller',
  rectifier: 'Rectifier Distortion',
  'hard-limiter': 'Hard Limiter 1413',
});

export interface DistortionSettings {
  type: DistortionType;
  dcBlock: boolean;
  thresholdDb: number;
  noiseFloorDb: number;
  param1: number;
  param2: number;
  repeats: number;
}

export const DEFAULT_DISTORTION_SETTINGS: Readonly<DistortionSettings> = Object.freeze({
  type: 'hard-clipping',
  dcBlock: false,
  thresholdDb: -6,
  noiseFloorDb: -70,
  param1: 50,
  param2: 50,
  repeats: 1,
});

export interface DistortionControlMeta {
  threshold: string | null;
  noiseFloor: string | null;
  param1: string | null;
  param2: string | null;
  repeats: string | null;
  dcBlock: boolean;
}

/** Labels and enabled controls follow Audacity 4.0.2 Distortion.cpp. */
export function getDistortionControlMeta(type: DistortionType): DistortionControlMeta {
  const output = { threshold: null, noiseFloor: null, param1: 'Distortion amount', param2: 'Output level', repeats: null, dcBlock: false } as DistortionControlMeta;
  switch (type) {
    case 'hard-clipping':
      return { ...output, threshold: 'Clipping level', param1: 'Drive', param2: 'Make-up Gain' };
    case 'soft-clipping':
      return { ...output, threshold: 'Clipping threshold', param1: 'Hardness', param2: 'Make-up Gain' };
    case 'cubic-curve':
      return { ...output, repeats: 'Repeat processing' };
    case 'even-harmonics':
      return { ...output, param2: 'Harmonic brightness', dcBlock: true };
    case 'leveller':
      return { ...output, noiseFloor: 'Noise Floor', param1: 'Levelling fine adjustment', param2: null, repeats: 'Degree of Levelling' };
    case 'rectifier':
      return { ...output, param2: null, dcBlock: true };
    case 'hard-limiter':
      return { ...output, threshold: 'dB Limit', param1: 'Wet level', param2: 'Residual level' };
    default:
      return output;
  }
}

const TABLE_SIZE = 2049;
const STEPS = 1024;

function assertRange(value: number, minimum: number, maximum: number, label: string): void {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new RangeError(`${label}必须在 ${minimum}–${maximum} 之间`);
  }
}

export function validateDistortionSettings(settings: DistortionSettings): void {
  if (!DISTORTION_TYPES.includes(settings.type)) throw new RangeError('失真类型无效');
  if (typeof settings.dcBlock !== 'boolean') throw new RangeError('DC blocking 开关无效');
  assertRange(settings.thresholdDb, -100, 0, '阈值');
  assertRange(settings.noiseFloorDb, -80, -20, '噪声底');
  assertRange(settings.param1, 0, 100, '参数 1');
  assertRange(settings.param2, 0, 100, '参数 2');
  if (!Number.isSafeInteger(settings.repeats) || settings.repeats < 0 || settings.repeats > 5) {
    throw new RangeError('重复处理次数必须是 0–5 的整数');
  }
}

function dbToLinear(db: number): number {
  return 10 ** (db / 20);
}

function copyHalfTable(table: Float64Array): void {
  let count = TABLE_SIZE - 1;
  for (let index = 0; index < STEPS; index += 1) {
    table[index] = -table[count];
    count -= 1;
  }
}

function logCurve(threshold: number, value: number, ratio: number): number {
  return threshold + ((Math.exp(ratio * (threshold - value)) - 1) / -ratio);
}

function cubic(x: number): number {
  return x - (x ** 3) / 3;
}

interface DistortionTable {
  table: Float64Array;
  makeupGain: number;
}

function makeDistortionTable(settings: DistortionSettings): DistortionTable {
  const table = new Float64Array(TABLE_SIZE);
  let makeupGain = 1;
  const positiveHalf = (fill: (index: number) => number) => {
    for (let index = STEPS; index < TABLE_SIZE; index += 1) table[index] = fill(index);
    copyHalfTable(table);
  };

  switch (settings.type) {
    case 'hard-clipping':
    case 'hard-limiter': {
      const threshold = dbToLinear(settings.thresholdDb);
      const lowThreshold = 1 - threshold;
      const highThreshold = 1 + threshold;
      for (let index = 0; index < TABLE_SIZE; index += 1) {
        table[index] = index < STEPS * lowThreshold
          ? -threshold
          : index > STEPS * highThreshold ? threshold : index / STEPS - 1;
      }
      makeupGain = 1 / threshold;
      break;
    }
    case 'soft-clipping': {
      const thresholdLinear = dbToLinear(settings.thresholdDb);
      const threshold = 1 + thresholdLinear;
      const amount = 2 ** (7 * settings.param1 / 100);
      const peak = logCurve(thresholdLinear, 1, amount);
      makeupGain = 1 / peak;
      positiveHalf((index) => index < STEPS * threshold
        ? index / Math.fround(STEPS) - 1
        : logCurve(thresholdLinear, index / STEPS - 1, amount));
      break;
    }
    case 'medium-overdrive': {
      const amount = Math.min(0.999, dbToLinear(-settings.param1));
      positiveHalf((index) => {
        const linear = index / Math.fround(STEPS);
        const scale = -1 / (1 - amount);
        const curve = Math.exp((linear - 1) * Math.log(amount));
        return scale * (curve - 1);
      });
      break;
    }
    case 'hard-overdrive': {
      const amount = settings.param1;
      positiveHalf((index) => {
        const linear = (index - STEPS) / STEPS;
        return amount === 0 ? linear : Math.log(1 + amount * linear) / Math.log(1 + amount);
      });
      break;
    }
    case 'soft-overdrive': {
      const iterations = Math.floor(settings.param1 / 20);
      const fractional = settings.param1 / 20 - iterations;
      positiveHalf((index) => {
        let value = (index - STEPS) / STEPS;
        for (let pass = 0; pass < iterations; pass += 1) value = Math.sin(value * Math.PI / 2);
        return value + (Math.sin(value * Math.PI / 2) - value) * fractional;
      });
      break;
    }
    case 'cubic-curve': {
      const amount = settings.param1 * Math.sqrt(3) / 100;
      const gain = amount === 0 ? 1 : 1 / cubic(Math.min(amount, 1));
      if (amount === 0) {
        for (let index = 0; index < TABLE_SIZE; index += 1) table[index] = index / STEPS - 1;
      } else {
        for (let index = 0; index < TABLE_SIZE; index += 1) {
          let value = gain * cubic(-amount + index * amount / STEPS);
          for (let pass = 0; pass < settings.repeats; pass += 1) value = gain * cubic(value * amount);
          table[index] = value;
        }
      }
      break;
    }
    case 'even-harmonics': {
      const amount = settings.param1 / -100;
      const brightness = Math.max(0.001, settings.param2) / 10;
      for (let index = 0; index < TABLE_SIZE; index += 1) {
        const value = index / STEPS - 1;
        table[index] = (1 + amount) * value
          - value * (amount / Math.tanh(brightness)) * Math.tanh(brightness * value);
      }
      break;
    }
    case 'sine-curve': {
      const iterations = Math.floor(settings.param1 / 20);
      const fractional = settings.param1 / 20 - iterations;
      positiveHalf((index) => {
        let value = (index - STEPS) / STEPS;
        for (let pass = 0; pass < iterations; pass += 1) value = (1 + Math.sin(value * Math.PI - Math.PI / 2)) / 2;
        const curved = (1 + Math.sin(value * Math.PI - Math.PI / 2)) / 2;
        return value + (curved - value) * fractional;
      });
      break;
    }
    case 'leveller': {
      const noiseFloor = dbToLinear(settings.noiseFloorDb);
      const gainFactors = [0.8, 1, 1.2, 1.2, 1, 0.8];
      const gainLimits = [0.0001, noiseFloor, 0.1, 0.3, 0.5, 1];
      const additions = [0];
      for (let index = 0; index < gainFactors.length - 1; index += 1) {
        additions[index + 1] = additions[index] + gainLimits[index] * (gainFactors[index] - gainFactors[index + 1]);
      }
      const adjust = (input: number) => {
        let index = gainFactors.length - 1;
        for (let cursor = index; cursor >= 0 && input < gainLimits[cursor]; cursor -= 1) index = cursor;
        return index;
      };
      positiveHalf((tableIndex) => {
        let value = (tableIndex - STEPS) / STEPS;
        for (let pass = 0; pass < settings.repeats; pass += 1) {
          const index = adjust(value);
          value = value * gainFactors[index] + additions[index];
        }
        const fractional = settings.param1 / 100;
        if (fractional > 0.001) {
          const index = adjust(value);
          value += fractional * (value * (gainFactors[index] - 1) + additions[index]);
        }
        return value;
      });
      break;
    }
    case 'rectifier': {
      const amount = settings.param1 / 50 - 1;
      for (let index = 0; index <= STEPS; index += 1) table[STEPS + index] = index / STEPS;
      for (let index = 1; index <= STEPS; index += 1) table[STEPS - index] = index / STEPS * amount;
      break;
    }
    default:
      throw new RangeError('失真类型无效');
  }
  return { table, makeupGain };
}

interface DCFilterState {
  samples: Float32Array;
  head: number;
  count: number;
  total: number;
}

export interface DistortionState {
  readonly settings: DistortionSettings;
  readonly sampleRate: number;
  readonly channelCount: number;
  readonly table: Float64Array;
  readonly makeupGain: number;
  readonly dcFilters: DCFilterState[];
}

export function createDistortionState(
  settings: DistortionSettings,
  sampleRate: number,
  channelCount: number,
): DistortionState {
  validateDistortionSettings(settings);
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) throw new RangeError('采样率必须是大于零的有限数值');
  if (channelCount !== 1 && channelCount !== 2) throw new RangeError('Distortion 仅支持单声道或立体声轨道');
  const queueLength = Math.floor(sampleRate / 20);
  if (settings.dcBlock && queueLength < 1) throw new RangeError('DC blocking 需要至少 20 Hz 的采样率');
  const { table, makeupGain } = makeDistortionTable(settings);
  return {
    settings: { ...settings },
    sampleRate,
    channelCount,
    table,
    makeupGain,
    dcFilters: settings.dcBlock
      ? Array.from({ length: channelCount }, () => ({ samples: new Float32Array(queueLength), head: 0, count: 0, total: 0 }))
      : [],
  };
}

function waveShaper(sample: number, state: DistortionState): number {
  let input = sample;
  if (state.settings.type === 'hard-clipping') input = Math.fround(input * (1 + state.settings.param1 / 100));
  const index = Math.max(0, Math.min(2 * STEPS - 1, Math.floor(input * STEPS) + STEPS));
  const offset = Math.max(0, Math.min(1, (1 + input) * STEPS - index));
  return Math.fround(state.table[index] + (state.table[index + 1] - state.table[index]) * offset);
}

function filterDC(sample: number, filter: DCFilterState): number {
  filter.total += sample;
  if (filter.count === filter.samples.length) {
    filter.total -= filter.samples[filter.head];
    filter.samples[filter.head] = sample;
    filter.head = (filter.head + 1) % filter.samples.length;
  } else {
    filter.samples[(filter.head + filter.count) % filter.samples.length] = sample;
    filter.count += 1;
  }
  return Math.fround(sample - filter.total / filter.count);
}

/**
 * Audacity 4.0.2 DistortionBase lookup-table processing. Tables are shared by
 * channels, while rolling-average DC filters persist independently per channel
 * and across selected clips on the same track.
 * Source: au3/libraries/au3-builtin-effects/DistortionBase.cpp
 */
export function processDistortionSelection(
  channels: readonly Float32Array[],
  startSample: number,
  endSample: number,
  state: DistortionState,
): Float32Array[] {
  const length = channels[0]?.length ?? 0;
  if (
    channels.length !== state.channelCount
    || length < 1
    || channels.some((channel) => channel.length !== length)
  ) {
    throw new RangeError('Distortion 输入声道必须与状态一致且等长');
  }
  if (
    !Number.isSafeInteger(startSample)
    || !Number.isSafeInteger(endSample)
    || startSample < 0
    || endSample > length
    || endSample <= startSample
  ) {
    throw new RangeError('Distortion 选区必须是声道范围内的非空整数采样区间');
  }

  const { settings } = state;
  const output = channels.map((channel) => new Float32Array(channel));
  const p1 = settings.param1 / 100;
  const p2 = settings.param2 / 100;
  for (let index = startSample; index < endSample; index += 1) {
    for (let channel = 0; channel < channels.length; channel += 1) {
      const input = channels[channel][index];
      if (!Number.isFinite(input)) throw new RangeError(`Distortion 输入在第 ${index} 个采样包含非有限值`);
      const shaped = waveShaper(input, state);
      let value: number;
      switch (settings.type) {
        case 'hard-clipping':
        case 'soft-clipping':
          value = shaped * (1 - p2 + state.makeupGain * p2);
          break;
        case 'soft-overdrive':
        case 'medium-overdrive':
        case 'hard-overdrive':
        case 'cubic-curve':
        case 'sine-curve':
          value = shaped * p2;
          break;
        case 'hard-limiter':
          value = shaped * (p1 - p2) + input * p2;
          break;
        default:
          value = shaped;
      }
      let stored = Math.fround(value);
      if (settings.dcBlock) stored = filterDC(stored, state.dcFilters[channel]);
      if (!Number.isFinite(stored)) throw new RangeError('Distortion 输出包含非有限值');
      output[channel][index] = stored;
    }
  }
  return output;
}

export function processDistortionChannels(
  channels: readonly Float32Array[],
  settings: DistortionSettings,
  sampleRate: number,
  state = createDistortionState(settings, sampleRate, channels.length),
): Float32Array[] {
  return processDistortionSelection(channels, 0, channels[0]?.length ?? 0, state);
}
