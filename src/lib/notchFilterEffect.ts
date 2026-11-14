export interface NotchFilterSettings {
  frequencyHz: number;
  q: number;
}

export const DEFAULT_NOTCH_FILTER_SETTINGS: Readonly<NotchFilterSettings> = Object.freeze({
  frequencyHz: 60,
  q: 1,
});

export const MAX_NOTCH_FILTER_TOTAL_SAMPLES = 20_000_000;

export interface NotchFilterCoefficients {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

export interface NotchFilterState extends NotchFilterCoefficients {
  readonly settings: NotchFilterSettings;
  readonly sampleRate: number;
  previousInput: number;
  previousPreviousInput: number;
  previousOutput: number;
  previousPreviousOutput: number;
}

function assertFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) throw new RangeError(`Notch Filter ${label}必须是有限数值`);
}

export function validateNotchFilterSettings(
  settings: NotchFilterSettings,
  sampleRate?: number,
): void {
  assertFinite(settings.frequencyHz, '频率');
  assertFinite(settings.q, 'Q');
  if (settings.frequencyHz < 0.1) {
    throw new RangeError('Notch Filter 频率必须至少为 0.1 Hz');
  }
  if (settings.q < 0.1 || settings.q > 1000) {
    throw new RangeError('Notch Filter Q 必须在 0.1–1000 之间');
  }
  if (sampleRate !== undefined) {
    if (!Number.isFinite(sampleRate) || sampleRate <= 0.2) {
      throw new RangeError('Notch Filter 采样率必须是大于 0.2 的有限数值');
    }
    if (settings.frequencyHz >= sampleRate / 2) {
      throw new RangeError(`Notch Filter 频率必须小于当前 Nyquist 频率（${sampleRate / 2} Hz）`);
    }
  }
}

export function createNotchFilterState(
  settings: NotchFilterSettings,
  sampleRate: number,
): NotchFilterState {
  validateNotchFilterSettings(settings, sampleRate);
  const omega = 2 * Math.PI * settings.frequencyHz / sampleRate;
  const sine = Math.sin(omega);
  const cosine = Math.cos(omega);
  const alpha = sine / (2 * settings.q);
  const a0 = 1 + alpha;
  const coefficients: NotchFilterCoefficients = {
    b0: 1 / a0,
    b1: -2 * cosine / a0,
    b2: 1 / a0,
    a1: -2 * cosine / a0,
    a2: (1 - alpha) / a0,
  };
  if (!Object.values(coefficients).every(Number.isFinite)) {
    throw new RangeError('Notch Filter 无法生成有限滤波系数');
  }
  return {
    ...coefficients,
    settings: { ...settings },
    sampleRate,
    previousInput: 0,
    previousPreviousInput: 0,
    previousOutput: 0,
    previousPreviousOutput: 0,
  };
}

function sameSettings(left: NotchFilterSettings, right: NotchFilterSettings): boolean {
  return left.frequencyHz === right.frequencyHz && left.q === right.q;
}

export function processNotchFilter(
  input: Float32Array,
  settings: NotchFilterSettings,
  sampleRate: number,
  state = createNotchFilterState(settings, sampleRate),
): Float32Array {
  validateNotchFilterSettings(settings, sampleRate);
  if (input.length > MAX_NOTCH_FILTER_TOTAL_SAMPLES) {
    throw new RangeError(`Notch Filter 单次处理不能超过 ${MAX_NOTCH_FILTER_TOTAL_SAMPLES} 个采样`);
  }
  if (state.sampleRate !== sampleRate || !sameSettings(state.settings, settings)) {
    throw new RangeError('Notch Filter 状态与当前参数不匹配');
  }
  const output = new Float32Array(input.length);
  for (let index = 0; index < input.length; index += 1) {
    const value = input[index];
    if (!Number.isFinite(value)) {
      throw new RangeError(`Notch Filter 输入在第 ${index} 个采样包含非有限数值`);
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
      throw new RangeError(`Notch Filter 在第 ${index} 个采样产生非有限输出`);
    }
  }
  return output;
}

export function processNotchFilterChannels(
  channels: readonly Float32Array[],
  settings: NotchFilterSettings,
  sampleRate: number,
  states?: NotchFilterState[],
): Float32Array[] {
  if (channels.length === 0) throw new RangeError('Notch Filter 至少需要一个音频声道');
  const length = channels[0].length;
  if (channels.some((channel) => channel.length !== length)) {
    throw new RangeError('Notch Filter 输入声道必须等长');
  }
  if (states && states.length !== channels.length) {
    throw new RangeError('每个输入声道必须有一个 Notch Filter 状态');
  }
  return channels.map((channel, index) => processNotchFilter(
    channel,
    settings,
    sampleRate,
    states?.[index] ?? createNotchFilterState(settings, sampleRate),
  ));
}

export function notchFilterMagnitudeAtFrequency(
  settings: NotchFilterSettings,
  sampleRate: number,
  frequencyHz: number,
): number {
  const state = createNotchFilterState(settings, sampleRate);
  if (!Number.isFinite(frequencyHz) || frequencyHz < 0) {
    throw new RangeError('Notch Filter 响应频率必须是非负有限数值');
  }
  const omega = 2 * Math.PI * Math.min(frequencyHz, sampleRate / 2) / sampleRate;
  const cosine = Math.cos(omega);
  const sine = Math.sin(omega);
  const cosine2 = Math.cos(2 * omega);
  const sine2 = Math.sin(2 * omega);
  const numeratorReal = state.b0 + state.b1 * cosine + state.b2 * cosine2;
  const numeratorImaginary = -state.b1 * sine - state.b2 * sine2;
  const denominatorReal = 1 + state.a1 * cosine + state.a2 * cosine2;
  const denominatorImaginary = -state.a1 * sine - state.a2 * sine2;
  const numerator = Math.hypot(numeratorReal, numeratorImaginary);
  const denominator = Math.hypot(denominatorReal, denominatorImaginary);
  return numerator / denominator;
}
