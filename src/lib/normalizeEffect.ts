// Audacity 4 Normalize: analyse the whole selected track first, then apply
// (sample + per-channel DC offset) * gain. Shared stereo gain is the default.
// Source: src/effects/builtin_collection/normalize/normalizeeffect.{h,cpp}

export interface NormalizeSettings {
  removeDc: boolean;
  normalizePeak: boolean;
  peakDb: number;
  stereoIndependent: boolean;
}

export interface NormalizeTrackPlan {
  /** One additive offset per channel, including the official negated mean. */
  offsets: readonly number[];
  /** One multiplier per channel; shared unless stereoIndependent is enabled. */
  gains: readonly number[];
}

export const MIN_NORMALIZE_PEAK_DB = -145;
export const MAX_NORMALIZE_PEAK_DB = 0;

export const DEFAULT_NORMALIZE_SETTINGS: Readonly<NormalizeSettings> = Object.freeze({
  removeDc: true,
  normalizePeak: true,
  peakDb: -1,
  stereoIndependent: false,
});

export function validateNormalizeSettings(settings: NormalizeSettings): void {
  if (typeof settings.removeDc !== 'boolean') throw new TypeError('去直流开关必须是布尔值');
  if (typeof settings.normalizePeak !== 'boolean') throw new TypeError('峰值标准化开关必须是布尔值');
  if (typeof settings.stereoIndependent !== 'boolean') {
    throw new TypeError('双声道独立开关必须是布尔值');
  }
  if (
    !Number.isFinite(settings.peakDb)
    || settings.peakDb < MIN_NORMALIZE_PEAK_DB
    || settings.peakDb > MAX_NORMALIZE_PEAK_DB
  ) {
    throw new RangeError(
      `峰值必须在 ${MIN_NORMALIZE_PEAK_DB}–${MAX_NORMALIZE_PEAK_DB} dB 之间`,
    );
  }
}

export function isNormalizeBypassed(settings: NormalizeSettings): boolean {
  return !settings.removeDc && !settings.normalizePeak;
}

function assertChannels(channels: readonly Float32Array[]): void {
  if (channels.length === 0) throw new RangeError('至少需要一个音频声道');
  const length = channels[0].length;
  if (channels.some((channel) => channel.length !== length)) {
    throw new RangeError('标准化输入声道必须等长');
  }
}

function assertFiniteSamples(channel: Float32Array): void {
  for (let index = 0; index < channel.length; index += 1) {
    if (!Number.isFinite(channel[index])) {
      throw new RangeError(`标准化输入在第 ${index} 个采样包含非有限数值`);
    }
  }
}

/**
 * Build one plan for an entire track selection. Each channel owns an array of
 * selected clip segments, so gaps and unselected samples do not affect DC/peak.
 */
export function createNormalizePlan(
  channelSegments: readonly (readonly Float32Array[])[],
  settings: NormalizeSettings,
): NormalizeTrackPlan {
  validateNormalizeSettings(settings);
  if (channelSegments.length === 0) throw new RangeError('至少需要一个音频声道');

  const offsets: number[] = [];
  const extents: number[] = [];
  let sharedExtent = 0;

  for (const segments of channelSegments) {
    let count = 0;
    let sum = 0;
    let minimum = Infinity;
    let maximum = -Infinity;
    for (const segment of segments) {
      assertFiniteSamples(segment);
      for (let index = 0; index < segment.length; index += 1) {
        const sample = segment[index];
        count += 1;
        sum += sample;
        if (sample < minimum) minimum = sample;
        if (sample > maximum) maximum = sample;
      }
    }

    // Audacity stores the analysed offset in a float before processing.
    const offset = settings.removeDc && count > 0 ? Math.fround(-sum / count) : 0;
    offsets.push(offset);

    let extent = 0;
    if (settings.normalizePeak && count > 0) {
      const adjustedMinimum = Math.fround(minimum + offset);
      const adjustedMaximum = Math.fround(maximum + offset);
      extent = Math.fround(Math.max(Math.abs(adjustedMinimum), Math.abs(adjustedMaximum)));
    }
    extents.push(extent);
    if (extent > sharedExtent) sharedExtent = extent;
  }

  const target = Math.fround(10 ** (settings.peakDb / 20));
  const gains = extents.map((extent) => {
    if (!settings.normalizePeak) return 1;
    const selectedExtent = settings.stereoIndependent ? extent : sharedExtent;
    // Silent selections deliberately remain unchanged, matching NormalizeEffect.
    return selectedExtent > 0 ? Math.fround(target / selectedExtent) : 1;
  });

  return { offsets, gains };
}

/** Apply a previously analysed plan without mutating the source channels. */
export function processNormalizeChannels(
  channels: readonly Float32Array[],
  settings: NormalizeSettings,
  plan?: NormalizeTrackPlan,
): Float32Array[] {
  validateNormalizeSettings(settings);
  assertChannels(channels);
  const effectivePlan = plan ?? createNormalizePlan(
    channels.map((channel) => [channel]),
    settings,
  );
  if (
    effectivePlan.offsets.length !== channels.length
    || effectivePlan.gains.length !== channels.length
  ) {
    throw new RangeError('标准化计划的声道数必须与输入一致');
  }

  return channels.map((channel, channelIndex) => {
    assertFiniteSamples(channel);
    const offset = effectivePlan.offsets[channelIndex];
    const gain = effectivePlan.gains[channelIndex];
    if (!Number.isFinite(offset) || !Number.isFinite(gain)) {
      throw new RangeError('标准化计划包含非有限参数');
    }
    const output = new Float32Array(channel.length);
    for (let index = 0; index < channel.length; index += 1) {
      output[index] = Math.fround(Math.fround(channel[index] + offset) * gain);
      if (!Number.isFinite(output[index])) {
        throw new RangeError(`标准化在第 ${index} 个采样产生非有限输出`);
      }
    }
    return output;
  });
}
