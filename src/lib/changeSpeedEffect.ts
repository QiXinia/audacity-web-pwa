// Audacity Change Speed and Pitch: constant-rate resampling changes both.
// Source: Audacity master 1016711487c33fe857f547d9da59f854bfa1d08b,
// au3/libraries/au3-builtin-effects/ChangeSpeedBase.{h,cpp} and
// au3/src/effects/ChangeSpeed.cpp.

export interface ChangeSpeedSettings {
  percentChange: number;
}

export type VinylSpeed = '33.333333333333336' | '45' | '78';

export const MIN_CHANGE_SPEED_PERCENT = -99;
export const MAX_CHANGE_SPEED_PERCENT = 4900;
export const CHANGE_SPEED_SLIDER_MAX = 100;
export const CHANGE_SPEED_SLIDER_WARP = 1.30105;
export const MAX_CHANGE_SPEED_TOTAL_OUTPUT_SAMPLES = 20_000_000;
export const DEFAULT_CHANGE_SPEED_SETTINGS: Readonly<ChangeSpeedSettings> = Object.freeze({
  percentChange: 0,
});

export const VINYL_RPM: Readonly<Record<VinylSpeed, number>> = Object.freeze({
  '33.333333333333336': 33 + 1 / 3,
  '45': 45,
  '78': 78,
});

export function isChangeSpeedPercentValid(value: number): boolean {
  return Number.isFinite(value)
    && value >= MIN_CHANGE_SPEED_PERCENT
    && value <= MAX_CHANGE_SPEED_PERCENT;
}

export function validateChangeSpeedSettings(settings: ChangeSpeedSettings): void {
  if (!isChangeSpeedPercentValid(settings.percentChange)) {
    throw new RangeError(
      `速度变化必须在 ${MIN_CHANGE_SPEED_PERCENT}% 至 ${MAX_CHANGE_SPEED_PERCENT}% 之间`,
    );
  }
}

export function changeSpeedRatio(settings: ChangeSpeedSettings): number {
  validateChangeSpeedSettings(settings);
  return 1 + settings.percentChange / 100;
}

export function isChangeSpeedBypassed(settings: ChangeSpeedSettings): boolean {
  validateChangeSpeedSettings(settings);
  return settings.percentChange === 0;
}

export function durationAfterChangeSpeed(duration: number, settings: ChangeSpeedSettings): number {
  if (!Number.isFinite(duration) || duration < 0) {
    throw new RangeError('选区时长必须是有限的非负数');
  }
  return duration / changeSpeedRatio(settings);
}

export function percentChangeFromMultiplier(multiplier: number): number {
  if (!Number.isFinite(multiplier) || multiplier <= 0) {
    throw new RangeError('速度倍率必须大于零');
  }
  return (multiplier - 1) * 100;
}

export function percentChangeFromSpeedDuration(fromDuration: number, toDuration: number): number {
  if (
    !Number.isFinite(fromDuration)
    || fromDuration <= 0
    || !Number.isFinite(toDuration)
    || toDuration <= 0
  ) {
    throw new RangeError('原始时长和目标时长必须大于零');
  }
  return (fromDuration / toDuration - 1) * 100;
}

export function percentChangeFromVinyl(from: VinylSpeed, to: VinylSpeed): number {
  return (VINYL_RPM[to] / VINYL_RPM[from] - 1) * 100;
}

/** Match Audacity's standard-RPM recognizer to within 0.01 percent. */
export function vinylTransitionFromPercent(
  percentChange: number,
): readonly [VinylSpeed, VinylSpeed] | null {
  if (!Number.isFinite(percentChange)) return null;
  const ratio = Math.trunc(percentChange * 100 + 0.5);
  switch (ratio) {
    case 3500: return ['33.333333333333336', '45'];
    case 13400: return ['33.333333333333336', '78'];
    case -2593: return ['45', '33.333333333333336'];
    case 7333: return ['45', '78'];
    case -5727: return ['78', '33.333333333333336'];
    case -4231: return ['78', '45'];
    default: return null;
  }
}

export function percentChangeFromSpeedSlider(value: number): number {
  if (!Number.isFinite(value)) throw new RangeError('速度滑块值必须是有限数值');
  const clamped = Math.max(MIN_CHANGE_SPEED_PERCENT, Math.min(CHANGE_SPEED_SLIDER_MAX, value));
  return clamped > 0 ? clamped ** CHANGE_SPEED_SLIDER_WARP : clamped;
}

export function sliderFromSpeedPercent(percentChange: number): number {
  if (!isChangeSpeedPercentValid(percentChange)) throw new RangeError('速度变化超出参数范围');
  if (percentChange > 400) return CHANGE_SPEED_SLIDER_MAX;
  return percentChange > 0 ? percentChange ** (1 / CHANGE_SPEED_SLIDER_WARP) : percentChange;
}

function validateChannels(channels: readonly Float32Array[]): number {
  if (channels.length === 0) throw new RangeError('至少需要一个音频声道');
  const inputLength = channels[0].length;
  if (inputLength < 1 || channels.some((channel) => channel.length !== inputLength)) {
    throw new RangeError('Change Speed 输入声道必须等长且非空');
  }
  for (const channel of channels) {
    for (let index = 0; index < channel.length; index += 1) {
      if (!Number.isFinite(channel[index])) {
        throw new RangeError(`Change Speed 输入在第 ${index} 个采样包含非有限数值`);
      }
    }
  }
  return inputLength;
}

/**
 * Deterministic band-limited fallback for Audacity's constant-rate Resample.
 * All channels share source positions and weights; clamped edge extension and
 * normalization preserve DC without mutating the input. Speed > 1 shortens the
 * selection and raises pitch; speed < 1 lengthens it and lowers pitch.
 */
export function processChangeSpeedChannels(
  channels: readonly Float32Array[],
  settings: ChangeSpeedSettings,
  sampleRate: number,
): Float32Array[] {
  const ratio = changeSpeedRatio(settings);
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new RangeError('采样率必须大于零');
  }
  const inputLength = validateChannels(channels);
  const outputLength = Math.max(1, Math.round(inputLength / ratio));
  const totalOutput = outputLength * channels.length;
  if (
    !Number.isSafeInteger(outputLength)
    || !Number.isSafeInteger(totalOutput)
    || totalOutput > MAX_CHANGE_SPEED_TOTAL_OUTPUT_SAMPLES
  ) {
    throw new RangeError('Change Speed 输出超过浏览器内存上限，请缩短选区或减少声道');
  }
  if (ratio === 1) return channels.map((channel) => channel.slice());

  const sourceStep = inputLength / outputLength;
  const cutoff = Math.min(1, 1 / sourceStep);
  const radius = Math.min(Math.ceil(8 / cutoff), inputLength + 8);
  const output = channels.map(() => new Float32Array(outputLength));
  const sums = new Float64Array(channels.length);

  for (let outputIndex = 0; outputIndex < outputLength; outputIndex += 1) {
    const position = outputIndex * sourceStep;
    const first = Math.ceil(position - radius);
    const last = Math.floor(position + radius);
    let normalization = 0;
    sums.fill(0);
    for (let sourceIndex = first; sourceIndex <= last; sourceIndex += 1) {
      const offset = position - sourceIndex;
      const windowPosition = offset / radius;
      const blackman = 0.42
        + 0.5 * Math.cos(Math.PI * windowPosition)
        + 0.08 * Math.cos(2 * Math.PI * windowPosition);
      const x = offset * cutoff;
      const sinc = Math.abs(x) < 1e-12 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
      const weight = blackman * sinc;
      if (weight === 0) continue;
      normalization += weight;
      const clampedIndex = Math.max(0, Math.min(inputLength - 1, sourceIndex));
      for (let channelIndex = 0; channelIndex < channels.length; channelIndex += 1) {
        sums[channelIndex] += channels[channelIndex][clampedIndex] * weight;
      }
    }
    if (!Number.isFinite(normalization) || Math.abs(normalization) < 1e-12) {
      throw new Error(`Change Speed 在第 ${outputIndex} 个采样无法确定重采样权重`);
    }
    for (let channelIndex = 0; channelIndex < channels.length; channelIndex += 1) {
      const value = sums[channelIndex] / normalization;
      if (!Number.isFinite(value)) {
        throw new RangeError(`Change Speed 在第 ${outputIndex} 个采样产生非有限输出`);
      }
      output[channelIndex][outputIndex] = value;
    }
  }
  return output;
}
