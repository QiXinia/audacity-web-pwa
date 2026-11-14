// Audacity 4.0.0 SpectralEditMulti.ny, SpectralEditShelves.ny,
// SpectralEditParametricEQ.ny and nyquist-runtime/dspprims.lsp.
// Source revision: 20f2d58974013473d1eb040d6f91c160a2138319.
// The frequency-selection semantics follow SpectralSelectionBar.cpp:
// centre=sqrt(low*high), width=ln(high/low), and EQ width=width/2.

export type SpectralEditKind = 'delete-center' | 'amplify-center' | 'amplify-selection';

export interface SpectralEditSettings {
  kind: SpectralEditKind;
  lowHz: number | null;
  highHz: number | null;
  gainDb: number;
}

export const DEFAULT_SPECTRAL_EDIT_SETTINGS: Readonly<SpectralEditSettings> = Object.freeze({
  kind: 'delete-center',
  lowHz: 100,
  highHz: 1000,
  gainDb: 0,
});

export const MAX_SPECTRAL_EDIT_TOTAL_SAMPLES = 20_000_000;
const PI = 3.14159265358979;

interface BiquadCoefficients {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

interface WetPlan {
  filters: BiquadCoefficients[];
  scale: number;
}

export interface SpectralSelectionDescription {
  centerHz: number | null;
  bandwidth: number | null;
}

function assertSampleRate(sampleRate: number): void {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new RangeError('Spectral tools 采样率必须是正的有限数值');
  }
}

function assertBound(value: number | null, label: string): void {
  if (value === null) return;
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`Spectral tools ${label}必须是正有限数值或未设置`);
  }
}

export function describeSpectralSelection(
  settings: Pick<SpectralEditSettings, 'lowHz' | 'highHz'>,
): SpectralSelectionDescription {
  if (settings.lowHz === null || settings.highHz === null || settings.highHz <= settings.lowHz) {
    return { centerHz: null, bandwidth: null };
  }
  return {
    centerHz: Math.sqrt(settings.lowHz * settings.highHz),
    bandwidth: Math.log(settings.highHz / settings.lowHz),
  };
}

export function isSpectralEditBypassed(settings: SpectralEditSettings): boolean {
  return settings.kind !== 'delete-center' && settings.gainDb === 0;
}

export function validateSpectralEditSettings(
  settings: SpectralEditSettings,
  sampleRate?: number,
): void {
  if (!['delete-center', 'amplify-center', 'amplify-selection'].includes(settings.kind)) {
    throw new RangeError('Spectral tools 效果类型无效');
  }
  assertBound(settings.lowHz, '低频边界');
  assertBound(settings.highHz, '高频边界');
  if (settings.lowHz === null && settings.highHz === null) {
    throw new RangeError('请至少选择一个频率边界');
  }
  if (settings.kind === 'amplify-center' && (settings.lowHz === null || settings.highHz === null)) {
    throw new RangeError('增益中心频率需要完整的低频和高频边界');
  }
  if (settings.lowHz !== null && settings.highHz !== null && settings.highHz <= settings.lowHz) {
    throw new RangeError('频率带宽必须大于零，且高频边界必须大于低频边界');
  }
  if (!Number.isFinite(settings.gainDb) || settings.gainDb < -24 || settings.gainDb > 24) {
    throw new RangeError('Spectral tools 增益必须在 -24–24 dB 之间');
  }
  if (sampleRate !== undefined) {
    assertSampleRate(sampleRate);
    if (settings.kind === 'amplify-center' && settings.highHz! > sampleRate / 2) {
      throw new RangeError(`高频边界不能超过当前 Nyquist 频率（${sampleRate / 2} Hz）`);
    }
  }
}

function normalize(
  b0: number,
  b1: number,
  b2: number,
  a0: number,
  a1: number,
  a2: number,
): BiquadCoefficients {
  const result = { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
  if (!Object.values(result).every(Number.isFinite) || a0 <= 0) {
    throw new RangeError('Spectral tools 无法生成稳定、有限的滤波系数');
  }
  return result;
}

function twoPoleCoefficients(
  type: 'lowpass' | 'highpass' | 'notch',
  frequencyHz: number,
  q: number,
  sampleRate: number,
): BiquadCoefficients {
  if (!(frequencyHz > 0) || frequencyHz > sampleRate / 2 || !(q > 0)) {
    throw new RangeError('Spectral tools 双二阶滤波频率或 Q 超出有效范围');
  }
  const omega = 2 * PI * frequencyHz / sampleRate;
  const cosine = Math.cos(omega);
  const sine = Math.sin(omega);
  const alpha = sine * Math.sinh(0.5 / q);
  const a0 = 1 + alpha;
  const a1 = -2 * cosine;
  const a2 = 1 - alpha;
  if (type === 'lowpass') {
    const b1 = 1 - cosine;
    return normalize(b1 / 2, b1, b1 / 2, a0, a1, a2);
  }
  if (type === 'highpass') {
    const b1 = -1 - cosine;
    return normalize(-b1 / 2, b1, -b1 / 2, a0, a1, a2);
  }
  return normalize(1, -2 * cosine, 1, a0, a1, a2);
}

function shelfCoefficients(
  type: 'low' | 'high',
  frequencyHz: number,
  gainDb: number,
  sampleRate: number,
): BiquadCoefficients {
  if (!(frequencyHz > 0) || frequencyHz >= sampleRate / 2) {
    throw new RangeError('Spectral tools 搁架频率必须低于 Nyquist');
  }
  const omega = 2 * PI * frequencyHz / sampleRate;
  const sine = Math.sin(omega);
  const cosine = Math.cos(omega);
  const amplitude = 10 ** (gainDb / 40);
  const beta = Math.sqrt(1 + amplitude ** 2 - (amplitude - 1) ** 2);
  const apc = cosine * (amplitude + 1);
  const amc = cosine * (amplitude - 1);
  const bs = beta * sine;
  if (type === 'low') {
    return normalize(
      amplitude * (amplitude + 1 - amc + bs),
      2 * amplitude * (amplitude - 1 - apc),
      amplitude * (amplitude + 1 - amc - bs),
      amplitude + 1 + amc + bs,
      -2 * (amplitude - 1 + apc),
      amplitude + 1 + amc - bs,
    );
  }
  return normalize(
    amplitude * (amplitude + 1 + amc + bs),
    -2 * amplitude * (amplitude - 1 + apc),
    amplitude * (amplitude + 1 + amc - bs),
    amplitude + 1 - amc + bs,
    2 * (amplitude - 1 - apc),
    amplitude + 1 - amc - bs,
  );
}

function parametricEqCoefficients(
  centerHz: number,
  gainDb: number,
  width: number,
  sampleRate: number,
): BiquadCoefficients {
  if (!(centerHz > 0) || centerHz >= sampleRate / 2 || !(width > 0)) {
    throw new RangeError('Spectral tools Parametric EQ 中心频率或倍频程宽度无效');
  }
  const omega = 2 * PI * centerHz / sampleRate;
  const sine = Math.sin(omega);
  const cosine = Math.cos(omega);
  const j = Math.sqrt(10 ** (gainDb / 20));
  const g = sine * Math.sinh(0.5 * Math.log(2) * width * (omega / sine));
  // dspprims.lsp eq-band-ccc calls biquad (not biquad-m).
  return normalize(
    1 + g * j,
    -2 * cosine,
    1 - g * j,
    1 + g / j,
    -2 * cosine,
    1 - g / j,
  );
}

function createWetPlan(settings: SpectralEditSettings, sampleRate: number): WetPlan | null {
  validateSpectralEditSettings(settings, sampleRate);
  if (isSpectralEditBypassed(settings)) return null;
  const { lowHz, highHz } = settings;
  if (settings.kind === 'delete-center') {
    if (lowHz !== null && highHz !== null) {
      const { centerHz, bandwidth } = describeSpectralSelection(settings);
      if (lowHz < 10 && bandwidth !== null && bandwidth > 10) {
        throw new RangeError('Notch 参数无法应用；请提高低频边界或减小频率宽度');
      }
      if (centerHz !== null && centerHz >= sampleRate / 2) return null;
      return { filters: [twoPoleCoefficients('notch', centerHz!, centerHz! / (highHz - lowHz), sampleRate)], scale: 1 };
    }
    if (lowHz !== null) {
      if (lowHz >= sampleRate / 2) return null;
      return { filters: [twoPoleCoefficients('lowpass', lowHz, 0.7071, sampleRate)], scale: 1 };
    }
    if (highHz! >= sampleRate / 2) return { filters: [], scale: 0 };
    return { filters: [twoPoleCoefficients('highpass', highHz!, 0.7071, sampleRate)], scale: 1 };
  }
  if (settings.kind === 'amplify-center') {
    const { centerHz, bandwidth } = describeSpectralSelection(settings);
    if (highHz! > sampleRate / 2) {
      throw new RangeError(`高频边界不能超过当前 Nyquist 频率（${sampleRate / 2} Hz）`);
    }
    if (centerHz !== null && centerHz >= sampleRate / 2) return null;
    return { filters: [parametricEqCoefficients(centerHz!, settings.gainDb, bandwidth! / 2, sampleRate)], scale: 1 };
  }
  // SpectralEditShelves.ny: validate each bound independently above Nyquist.
  let low = lowHz;
  let high = highHz;
  if (low !== null && low >= sampleRate / 2) return null;
  if (low !== null && low <= 0) low = null;
  if (high !== null && (high >= sampleRate / 2 || high <= 0)) high = null;
  if (low === null && high === null) return null;
  if (low === null) return { filters: [shelfCoefficients('low', high!, settings.gainDb, sampleRate)], scale: 1 };
  if (high === null) return { filters: [shelfCoefficients('high', low, settings.gainDb, sampleRate)], scale: 1 };
  return {
    filters: [
      shelfCoefficients('low', low, -settings.gainDb, sampleRate),
      shelfCoefficients('high', high, -settings.gainDb, sampleRate),
    ],
    scale: 10 ** (settings.gainDb / 20),
  };
}

function processBiquad(input: Float32Array, coefficients: BiquadCoefficients): Float32Array {
  const output = new Float32Array(input.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let index = 0; index < input.length; index += 1) {
    const value = input[index];
    const result = coefficients.b0 * value
      + coefficients.b1 * x1
      + coefficients.b2 * x2
      - coefficients.a1 * y1
      - coefficients.a2 * y2;
    x2 = x1;
    x1 = value;
    y2 = y1;
    y1 = result;
    output[index] = result;
  }
  return output;
}

function processWet(input: Float32Array, plan: WetPlan): Float32Array {
  let output = input;
  for (const filter of plan.filters) output = processBiquad(output, filter);
  if (plan.scale !== 1) {
    const scaled = new Float32Array(output.length);
    for (let index = 0; index < output.length; index += 1) scaled[index] = output[index] * plan.scale;
    output = scaled;
  }
  return output;
}

function envelopeAt(index: number, length: number, sampleRate: number): number {
  const transition = Math.trunc(0.01 * sampleRate);
  const t1 = Math.min(transition, length / 2);
  const t2 = Math.max(length - transition, length / 2);
  if (index < t1) return t1 === 0 ? 1 : index / t1;
  if (index <= t2) return 1;
  return Math.max(0, (length - index) / (length - t2));
}

export function spectralEditEnvelope(length: number, sampleRate: number): Float32Array {
  if (!Number.isInteger(length) || length <= 0) throw new RangeError('Spectral tools 包络长度必须是正整数');
  assertSampleRate(sampleRate);
  const envelope = new Float32Array(length);
  for (let index = 0; index < length; index += 1) envelope[index] = envelopeAt(index, length, sampleRate);
  return envelope;
}

export function processSpectralEditChannels(
  channels: readonly Float32Array[],
  settings: SpectralEditSettings,
  sampleRate: number,
): Float32Array[] {
  validateSpectralEditSettings(settings, sampleRate);
  if (channels.length === 0) throw new RangeError('Spectral tools 至少需要一个音频声道');
  const length = channels[0]?.length ?? 0;
  if (length === 0) throw new RangeError('Spectral tools 输入声道必须非空');
  if (channels.some((channel) => !(channel instanceof Float32Array) || channel.length !== length)) {
    throw new RangeError('Spectral tools 输入声道必须等长');
  }
  if (length * channels.length > MAX_SPECTRAL_EDIT_TOTAL_SAMPLES) {
    throw new RangeError(`Spectral tools 总处理量不能超过 ${MAX_SPECTRAL_EDIT_TOTAL_SAMPLES} 个采样`);
  }
  for (const channel of channels) {
    for (let index = 0; index < channel.length; index += 1) {
      if (!Number.isFinite(channel[index])) throw new RangeError(`Spectral tools 输入在第 ${index} 个采样包含非有限数值`);
    }
  }
  const plan = createWetPlan(settings, sampleRate);
  if (!plan) return channels.map((channel) => channel.slice());
  const envelope = spectralEditEnvelope(length, sampleRate);
  return channels.map((channel) => {
    const wet = processWet(channel, plan);
    const output = new Float32Array(length);
    for (let index = 0; index < length; index += 1) {
      const mix = envelope[index];
      output[index] = mix * wet[index] + (1 - mix) * channel[index];
      if (!Number.isFinite(output[index])) throw new RangeError(`Spectral tools 在第 ${index} 个采样产生非有限输出`);
    }
    return output;
  });
}

function magnitude(filter: BiquadCoefficients, omega: number): number {
  const cosine = Math.cos(omega);
  const sine = Math.sin(omega);
  const cosine2 = Math.cos(2 * omega);
  const sine2 = Math.sin(2 * omega);
  const numerator = Math.hypot(
    filter.b0 + filter.b1 * cosine + filter.b2 * cosine2,
    -filter.b1 * sine - filter.b2 * sine2,
  );
  const denominator = Math.hypot(
    1 + filter.a1 * cosine + filter.a2 * cosine2,
    -filter.a1 * sine - filter.a2 * sine2,
  );
  return numerator / denominator;
}

export function spectralEditMagnitudeAtFrequency(
  settings: SpectralEditSettings,
  sampleRate: number,
  frequencyHz: number,
): number {
  if (!Number.isFinite(frequencyHz) || frequencyHz < 0 || frequencyHz > sampleRate / 2) {
    throw new RangeError('Spectral tools 响应频率必须在 0 到 Nyquist 之间');
  }
  const plan = createWetPlan(settings, sampleRate);
  if (!plan) return 1;
  const omega = 2 * PI * frequencyHz / sampleRate;
  return plan.filters.reduce((response, filter) => response * magnitude(filter, omega), plan.scale);
}
