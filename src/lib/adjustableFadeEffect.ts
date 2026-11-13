export type AdjustableFadeType = 'up' | 'down' | 'sCurveUp' | 'sCurveDown';
export type AdjustableFadeUnits = 'percent' | 'db';
export type AdjustableFadePreset =
  | 'none'
  | 'linearIn'
  | 'linearOut'
  | 'exponentialIn'
  | 'exponentialOut'
  | 'logarithmicIn'
  | 'logarithmicOut'
  | 'roundedIn'
  | 'roundedOut'
  | 'cosineIn'
  | 'cosineOut'
  | 'sCurveIn'
  | 'sCurveOut';

export interface AdjustableFadeSettings {
  fadeType: AdjustableFadeType;
  midFadeAdjustPercent: number;
  units: AdjustableFadeUnits;
  startGain: number;
  endGain: number;
  preset: AdjustableFadePreset;
}

export const DEFAULT_ADJUSTABLE_FADE_SETTINGS: Readonly<AdjustableFadeSettings> = Object.freeze({
  fadeType: 'up',
  midFadeAdjustPercent: 0,
  units: 'percent',
  startGain: 0,
  endGain: 100,
  preset: 'none',
});

export const MAX_ADJUSTABLE_FADE_TOTAL_SAMPLES = 20_000_000;
const FADE_TYPES: readonly AdjustableFadeType[] = ['up', 'down', 'sCurveUp', 'sCurveDown'];
const PRESETS: readonly AdjustableFadePreset[] = [
  'none', 'linearIn', 'linearOut', 'exponentialIn', 'exponentialOut', 'logarithmicIn',
  'logarithmicOut', 'roundedIn', 'roundedOut', 'cosineIn', 'cosineOut', 'sCurveIn', 'sCurveOut',
];

export function validateAdjustableFadeSettings(settings: AdjustableFadeSettings): void {
  if (!FADE_TYPES.includes(settings.fadeType)) throw new RangeError('未知 Adjustable Fade 类型');
  if (!PRESETS.includes(settings.preset)) throw new RangeError('未知 Adjustable Fade 预设');
  if (settings.units !== 'percent' && settings.units !== 'db') {
    throw new RangeError('未知 Adjustable Fade 增益单位');
  }
  if (!Number.isFinite(settings.midFadeAdjustPercent)
    || settings.midFadeAdjustPercent < -100
    || settings.midFadeAdjustPercent > 100) {
    throw new RangeError('Mid-fade Adjust 必须在 -100% 至 100% 之间');
  }
  if (!Number.isFinite(settings.startGain) || !Number.isFinite(settings.endGain)) {
    throw new RangeError('Adjustable Fade 增益必须是有限数值');
  }
  if (settings.preset === 'none') {
    if (settings.units === 'percent') {
      if (settings.startGain < 0 || settings.endGain < 0) {
        throw new RangeError('百分比增益不能为负数');
      }
      if (settings.startGain > 1000 || settings.endGain > 1000) {
        throw new RangeError('百分比增益不能超过 1000%');
      }
    } else if (settings.startGain > 100 || settings.endGain > 100) {
      throw new RangeError('dB 增益不能超过 +100 dB');
    }
  }
}

function toLinearGain(value: number, units: AdjustableFadeUnits): number {
  return units === 'percent' ? value / 100 : 10 ** (value / 20);
}

function clampUnit(value: number): number {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function powerAtZeroSafe(base: number, exponent: number): number {
  if (base === 0) return 0;
  return base ** exponent;
}

function expScaleMid(value: number): number {
  const e = Math.E;
  return (Math.exp(1 - value) - e) / (1 - e);
}

function simpleNormalized(t: number, curve: number): number {
  const x = clampUnit(t);
  if (curve === 0) return x;
  if (curve > 0 && curve < 0.5) {
    const cosine = Math.sin((Math.PI * x) / 2);
    return (1 - curve * 2) * x + curve * 2 * cosine;
  }
  if (curve > 0) {
    return powerAtZeroSafe(Math.sin((Math.PI * x) / 2), 1.5 - curve);
  }
  return powerAtZeroSafe(x, 1 - curve * 2);
}

function raisedCosineNormalized(t: number, curve: number): number {
  const x = clampUnit(t);
  const scaledInput = curve > 0 ? curve * 2 : curve * 1.63;
  const mid = expScaleMid(scaledInput);
  const base = (1 - Math.cos(Math.PI * x)) / 2;
  const exponent = 1 - mid * x;
  return powerAtZeroSafe(base, exponent);
}

function presetNormalized(preset: AdjustableFadePreset, t: number): number {
  const x = clampUnit(t);
  switch (preset) {
    case 'linearIn':
    case 'linearOut':
      return x;
    case 'exponentialIn':
    case 'exponentialOut': {
      const floor = 10 ** (-60 / 20);
      return (floor ** (1 - x) - floor) / (1 - floor);
    }
    case 'logarithmicIn':
    case 'logarithmicOut': {
      const anchor = 10 ** (15.311 / 20);
      return (anchor ** (1 - x) - anchor) / (1 - anchor);
    }
    case 'roundedIn':
    case 'roundedOut':
      return Math.sqrt(x);
    case 'cosineIn':
    case 'cosineOut':
      return Math.sin((Math.PI * x) / 2);
    case 'sCurveIn':
    case 'sCurveOut':
      return (1 - Math.cos(Math.PI * x)) / 2;
    default:
      return x;
  }
}

function normalizedGain(settings: AdjustableFadeSettings, t: number): number {
  if (settings.preset !== 'none') return presetNormalized(settings.preset, t);
  const curve = settings.midFadeAdjustPercent / 100;
  if (settings.fadeType === 'up' || settings.fadeType === 'down') {
    return simpleNormalized(t, curve);
  }
  return raisedCosineNormalized(t, curve);
}

function endpointGains(settings: AdjustableFadeSettings): [number, number] {
  if (settings.preset !== 'none') {
    const outgoing = settings.preset.endsWith('Out');
    return outgoing ? [1, 0] : [0, 1];
  }
  const first = toLinearGain(settings.startGain, settings.units);
  const second = toLinearGain(settings.endGain, settings.units);
  return [first, second];
}

function validateChannels(channels: readonly Float32Array[]): number {
  if (channels.length === 0) throw new RangeError('Adjustable Fade 至少需要一个声道');
  const length = channels[0].length;
  if (length < 1 || channels.some((channel) => channel.length !== length)) {
    throw new RangeError('Adjustable Fade 声道必须非空且等长');
  }
  if (channels.some((channel) => channel.some((value) => !Number.isFinite(value)))) {
    throw new RangeError('Adjustable Fade 输入包含非有限采样');
  }
  return length;
}

export function processAdjustableFadeChannels(
  channels: readonly Float32Array[],
  settings: AdjustableFadeSettings,
): Float32Array[] {
  validateAdjustableFadeSettings(settings);
  const length = validateChannels(channels);
  if (length * channels.length > MAX_ADJUSTABLE_FADE_TOTAL_SAMPLES) {
    throw new RangeError('Adjustable Fade 处理量超过浏览器内存上限');
  }
  const [fromGain, toGain] = endpointGains(settings);
  const low = Math.min(fromGain, toGain);
  const span = Math.abs(toGain - fromGain);
  const outgoing = settings.preset !== 'none'
    ? settings.preset.endsWith('Out')
    : settings.fadeType === 'down' || settings.fadeType === 'sCurveDown';
  return channels.map((channel) => {
    const output = new Float32Array(length);
    for (let index = 0; index < length; index += 1) {
      const t = length === 1 ? 0 : index / (length - 1);
      const curve = normalizedGain(settings, t);
      const gain = low + span * (outgoing ? 1 - curve : curve);
      output[index] = Math.fround(channel[index] * gain);
    }
    return output;
  });
}
