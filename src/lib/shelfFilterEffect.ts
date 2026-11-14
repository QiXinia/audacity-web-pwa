import { resampleBuffer } from '@/lib/audioUtils';

// Audacity 4.0.0 ShelfFilter.ny and nyquist-runtime/dspprims.lsp.
// Both filters use the upstream slope=1 biquad and zero initial state.
export type ShelfFilterKind = 'low' | 'high';

export interface ShelfFilterSettings {
  type: ShelfFilterKind;
  frequencyHz: number;
  gainDb: number;
}

export const DEFAULT_SHELF_FILTER_SETTINGS: Readonly<ShelfFilterSettings> = Object.freeze({
  type: 'low',
  frequencyHz: 1000,
  gainDb: -6,
});

export const MAX_SHELF_FILTER_TOTAL_SAMPLES = 20_000_000;

interface ShelfFilterState {
  readonly settings: ShelfFilterSettings;
  readonly sampleRate: number;
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
  previousInput: number;
  previousPreviousInput: number;
  previousOutput: number;
  previousPreviousOutput: number;
}

export function validateShelfFilterSettings(
  settings: ShelfFilterSettings,
  sampleRate?: number,
): void {
  if (settings.type !== 'low' && settings.type !== 'high') {
    throw new RangeError('Shelf Filter 类型必须是 low 或 high');
  }
  if (!Number.isFinite(settings.frequencyHz) || !Number.isInteger(settings.frequencyHz)) {
    throw new RangeError('Shelf Filter 频率必须是整数');
  }
  if (settings.frequencyHz < 10 || settings.frequencyHz > 10_000) {
    throw new RangeError('Shelf Filter 频率必须在 10–10000 Hz 之间');
  }
  if (!Number.isFinite(settings.gainDb) || !Number.isInteger(settings.gainDb)) {
    throw new RangeError('Shelf Filter 增益必须是整数');
  }
  if (settings.gainDb < -72 || settings.gainDb > 72) {
    throw new RangeError('Shelf Filter 增益必须在 -72–72 dB 之间');
  }
  if (sampleRate !== undefined) {
    if (!Number.isFinite(sampleRate) || sampleRate <= 20) {
      throw new RangeError('Shelf Filter 采样率必须是大于 20 的有限数值');
    }
    if (settings.frequencyHz >= sampleRate / 2) {
      throw new RangeError(`Shelf Filter 频率必须低于当前 Nyquist 频率（${sampleRate / 2} Hz）`);
    }
  }
}

export function createShelfFilterState(
  settings: ShelfFilterSettings,
  sampleRate: number,
): ShelfFilterState {
  validateShelfFilterSettings(settings, sampleRate);
  const omega = 2 * Math.PI * settings.frequencyHz / sampleRate;
  const sine = Math.sin(omega);
  const cosine = Math.cos(omega);
  const amplitude = 10 ** (settings.gainDb / 40);
  const beta = Math.sqrt(amplitude * amplitude + 1 - (amplitude - 1) ** 2);
  const apc = cosine * (amplitude + 1);
  const amc = cosine * (amplitude - 1);
  const bs = beta * sine;

  let b0: number;
  let b1: number;
  let b2: number;
  let a0: number;
  let a1: number;
  let a2: number;
  if (settings.type === 'low') {
    b0 = amplitude * (amplitude + 1 - amc + bs);
    b1 = 2 * amplitude * (amplitude - 1 - apc);
    b2 = amplitude * (amplitude + 1 - amc - bs);
    a0 = amplitude + 1 + amc + bs;
    a1 = -2 * (amplitude - 1 + apc);
    a2 = amplitude + 1 + amc - bs;
  } else {
    b0 = amplitude * (amplitude + 1 + amc + bs);
    b1 = -2 * amplitude * (amplitude - 1 + apc);
    b2 = amplitude * (amplitude + 1 + amc - bs);
    a0 = amplitude + 1 - amc + bs;
    a1 = 2 * (amplitude - 1 - apc);
    a2 = amplitude + 1 - amc - bs;
  }
  const coefficients = [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
  if (!coefficients.every(Number.isFinite)) {
    throw new RangeError('Shelf Filter 无法生成有限滤波系数');
  }
  return {
    settings: { ...settings },
    sampleRate,
    b0: coefficients[0],
    b1: coefficients[1],
    b2: coefficients[2],
    a1: coefficients[3],
    a2: coefficients[4],
    previousInput: 0,
    previousPreviousInput: 0,
    previousOutput: 0,
    previousPreviousOutput: 0,
  };
}

function sameSettings(left: ShelfFilterSettings, right: ShelfFilterSettings): boolean {
  return left.type === right.type
    && left.frequencyHz === right.frequencyHz
    && left.gainDb === right.gainDb;
}

export function processShelfFilter(
  input: Float32Array,
  settings: ShelfFilterSettings,
  sampleRate: number,
  state = createShelfFilterState(settings, sampleRate),
): Float32Array {
  validateShelfFilterSettings(settings, sampleRate);
  if (!(input instanceof Float32Array) || input.length === 0) {
    throw new RangeError('Shelf Filter 输入声道必须非空');
  }
  if (input.length > MAX_SHELF_FILTER_TOTAL_SAMPLES) {
    throw new RangeError(`Shelf Filter 单声道处理不能超过 ${MAX_SHELF_FILTER_TOTAL_SAMPLES} 个采样`);
  }
  if (state.sampleRate !== sampleRate || !sameSettings(state.settings, settings)) {
    throw new RangeError('Shelf Filter 状态与当前参数不匹配');
  }
  const output = new Float32Array(input.length);
  for (let index = 0; index < input.length; index += 1) {
    const value = input[index];
    if (!Number.isFinite(value)) {
      throw new RangeError(`Shelf Filter 输入在第 ${index} 个采样包含非有限数值`);
    }
    const result = value * state.b0
      + state.previousInput * state.b1
      + state.previousPreviousInput * state.b2
      - state.previousOutput * state.a1
      - state.previousPreviousOutput * state.a2;
    state.previousPreviousInput = state.previousInput;
    state.previousInput = value;
    state.previousPreviousOutput = state.previousOutput;
    state.previousOutput = result;
    output[index] = result;
    if (!Number.isFinite(output[index])) {
      throw new RangeError(`Shelf Filter 在第 ${index} 个采样产生非有限输出`);
    }
  }
  return output;
}

export function processShelfFilterChannels(
  channels: readonly Float32Array[],
  settings: ShelfFilterSettings,
  sampleRate: number,
): Float32Array[] {
  validateShelfFilterSettings(settings, sampleRate);
  if (channels.length === 0) throw new RangeError('Shelf Filter 至少需要一个音频声道');
  const length = channels[0]?.length ?? 0;
  if (length === 0) throw new RangeError('Shelf Filter 输入声道必须非空');
  if (channels.some((channel) => !(channel instanceof Float32Array) || channel.length !== length)) {
    throw new RangeError('Shelf Filter 输入声道必须等长');
  }
  if (length * channels.length > MAX_SHELF_FILTER_TOTAL_SAMPLES) {
    throw new RangeError(`Shelf Filter 总处理量不能超过 ${MAX_SHELF_FILTER_TOTAL_SAMPLES} 个采样`);
  }
  for (const channel of channels) {
    for (let index = 0; index < channel.length; index += 1) {
      if (!Number.isFinite(channel[index])) {
        throw new RangeError(`Shelf Filter 输入在第 ${index} 个采样包含非有限数值`);
      }
    }
  }

  // Upstream force-srate(2 * rate) branch for frequencies close to Nyquist.
  if (settings.frequencyHz > sampleRate / 2.1) {
    const doubledRate = sampleRate * 2;
    return channels.map((channel) => {
      const upsampled = resampleBuffer(channel, sampleRate, doubledRate);
      const filtered = processShelfFilter(upsampled, settings, doubledRate);
      return resampleBuffer(filtered, doubledRate, sampleRate);
    });
  }
  if (settings.gainDb === 0) return channels.map((channel) => channel.slice());
  return channels.map((channel) => processShelfFilter(channel, settings, sampleRate));
}
