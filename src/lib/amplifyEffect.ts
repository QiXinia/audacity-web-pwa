// Audacity Amplify: analyse one peak across the complete selection, then apply
// the same ratio to every selected channel without implicit output clipping.
// Source: Audacity master 1016711487c33fe857f547d9da59f854bfa1d08b,
// src/effects/builtin_collection/amplify/amplifyeffect.{h,cpp}

export interface AmplifySettings {
  ratio: number;
  allowClipping: boolean;
}

export const MIN_AMPLIFY_RATIO = 0.003162;
export const MAX_AMPLIFY_RATIO = 316.227766;
export const MIN_AMPLIFICATION_DB = 20 * Math.log10(MIN_AMPLIFY_RATIO);
export const MAX_AMPLIFICATION_DB = 20 * Math.log10(MAX_AMPLIFY_RATIO);

export const DEFAULT_AMPLIFY_SETTINGS: Readonly<AmplifySettings> = Object.freeze({
  ratio: 1,
  allowClipping: false,
});

export function clampAmplifyRatio(value: number): number {
  if (Number.isNaN(value)) throw new RangeError('放大倍率必须是数值');
  return Math.min(MAX_AMPLIFY_RATIO, Math.max(MIN_AMPLIFY_RATIO, value));
}

export function defaultAmplifyRatio(inputPeak: number): number {
  if (!Number.isFinite(inputPeak) || inputPeak < 0) {
    throw new RangeError('输入峰值必须是有限的非负数');
  }
  return inputPeak > 0 ? clampAmplifyRatio(1 / inputPeak) : 1;
}

export function ratioFromAmplificationDb(value: number): number {
  if (!Number.isFinite(value)) throw new RangeError('放大增益必须是有限数值');
  return clampAmplifyRatio(10 ** (value / 20));
}

export function ratioFromNewPeakDb(value: number, inputPeak: number): number {
  if (!Number.isFinite(value)) throw new RangeError('新峰值必须是有限数值');
  if (!Number.isFinite(inputPeak) || inputPeak <= 0) {
    throw new RangeError('只有非静音选区才能设置新峰值');
  }
  return clampAmplifyRatio(10 ** (value / 20) / inputPeak);
}

export function amplificationDbFromRatio(ratio: number): number {
  if (!Number.isFinite(ratio) || ratio <= 0) throw new RangeError('放大倍率必须是正数');
  return 20 * Math.log10(ratio);
}

export function newPeakDbFromRatio(ratio: number, inputPeak: number): number {
  if (!Number.isFinite(ratio) || ratio <= 0) throw new RangeError('放大倍率必须是正数');
  if (!Number.isFinite(inputPeak) || inputPeak <= 0) return 0;
  return 20 * Math.log10(ratio * inputPeak);
}

export function validateAmplifySettings(settings: AmplifySettings): void {
  if (typeof settings.allowClipping !== 'boolean') {
    throw new TypeError('允许削波开关必须是布尔值');
  }
  if (
    !Number.isFinite(settings.ratio)
    || settings.ratio < MIN_AMPLIFY_RATIO
    || settings.ratio > MAX_AMPLIFY_RATIO
  ) {
    throw new RangeError(
      `放大倍率必须在 ${MIN_AMPLIFY_RATIO}–${MAX_AMPLIFY_RATIO} 之间`,
    );
  }
}

export function isAmplifyAllowed(settings: AmplifySettings, inputPeak: number): boolean {
  validateAmplifySettings(settings);
  if (!Number.isFinite(inputPeak) || inputPeak < 0) {
    throw new RangeError('输入峰值必须是有限的非负数');
  }
  if (settings.allowClipping) return true;
  if (inputPeak <= 0) return false;
  // Match AmplifyEffect::isApplyAllowed, which compares against defaultRatio.
  return settings.ratio <= defaultAmplifyRatio(inputPeak);
}

/** Measure min/max extent over every selected clip and every selected channel. */
export function measureAmplifyPeak(segments: readonly Float32Array[]): number {
  let peak = 0;
  for (const segment of segments) {
    for (let index = 0; index < segment.length; index += 1) {
      const sample = segment[index];
      if (!Number.isFinite(sample)) {
        throw new RangeError(`放大输入在第 ${index} 个采样包含非有限数值`);
      }
      peak = Math.max(peak, Math.abs(sample));
    }
  }
  return Math.fround(peak);
}

function assertChannels(channels: readonly Float32Array[]): void {
  if (channels.length === 0) throw new RangeError('至少需要一个音频声道');
  const length = channels[0].length;
  if (channels.some((channel) => channel.length !== length)) {
    throw new RangeError('放大输入声道必须等长');
  }
}

/** Copy and multiply samples exactly once; never clamp to make clipping look safe. */
export function processAmplifyChannels(
  channels: readonly Float32Array[],
  settings: AmplifySettings,
): Float32Array[] {
  validateAmplifySettings(settings);
  assertChannels(channels);
  return channels.map((channel) => {
    const output = new Float32Array(channel.length);
    for (let index = 0; index < channel.length; index += 1) {
      const sample = channel[index];
      if (!Number.isFinite(sample)) {
        throw new RangeError(`放大输入在第 ${index} 个采样包含非有限数值`);
      }
      output[index] = Math.fround(sample * settings.ratio);
      if (!Number.isFinite(output[index])) {
        throw new RangeError(`放大在第 ${index} 个采样产生非有限输出`);
      }
    }
    return output;
  });
}
