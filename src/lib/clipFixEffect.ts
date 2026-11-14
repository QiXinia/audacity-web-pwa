/**
 * Audacity Clip Fix.
 *
 * Clipped runs are located relative to the channel peak and rebuilt with a
 * cubic Hermite spline anchored by the samples immediately outside the run.
 * Boundary tangents are estimated from up to four adjacent samples, matching
 * the four-sample slope window in the official Nyquist plug-in. A negative
 * gain is applied to the whole selection to leave headroom for restored peaks.
 */

export const MAX_CLIP_FIX_SAMPLES = 20_000_000;
const SLOPE_LENGTH = 4;

export interface ClipFixSettings {
  thresholdPercent: number;
  reduceGainDb: number;
}

export const defaultClipFixSettings: ClipFixSettings = {
  thresholdPercent: 95,
  reduceGainDb: -9,
};

export function validateClipFixSettings(settings: ClipFixSettings): void {
  if (!Number.isFinite(settings.thresholdPercent)
    || settings.thresholdPercent < 0
    || settings.thresholdPercent > 100) {
    throw new RangeError('Clip Fix 削波阈值必须在 0 至 100 之间');
  }
  if (!Number.isFinite(settings.reduceGainDb)
    || settings.reduceGainDb < -30
    || settings.reduceGainDb > 0) {
    throw new RangeError('Clip Fix 预留峰值增益必须在 -30 至 0 dB 之间');
  }
}

function averageSlope(input: Float32Array, anchor: number, direction: -1 | 1): number {
  let total = 0;
  let count = 0;
  for (let step = 1; step <= SLOPE_LENGTH; step += 1) {
    const index = anchor + direction * (step - 1);
    const next = index + direction;
    if (next < 0 || next >= input.length || index < 0 || index >= input.length) break;
    total += direction === 1
      ? input[next] - input[index]
      : input[index] - input[next];
    count += 1;
  }
  return count === 0 ? 0 : total / count;
}

function cubicHermite(
  left: number,
  right: number,
  leftSlope: number,
  rightSlope: number,
  t: number,
): number {
  const t2 = t * t;
  const t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;
  return h00 * left + h10 * leftSlope + h01 * right + h11 * rightSlope;
}

export function processClipFixChannel(input: Float32Array, settings: ClipFixSettings): Float32Array {
  validateClipFixSettings(settings);
  const length = input.length;
  if (length > MAX_CLIP_FIX_SAMPLES) {
    throw new RangeError(`Clip Fix 每次最多处理 ${MAX_CLIP_FIX_SAMPLES} 个采样`);
  }

  let peak = 0;
  for (const value of input) peak = Math.max(peak, Math.abs(value));
  const gain = 10 ** (settings.reduceGainDb / 20);
  const output = new Float32Array(length);
  for (let index = 0; index < length; index += 1) output[index] = input[index] * gain;
  if (peak === 0) return output;

  const cutoff = peak * settings.thresholdPercent / 100;
  let index = 0;
  while (index < length) {
    if (Math.abs(input[index]) < cutoff) {
      index += 1;
      continue;
    }
    const start = index;
    while (index < length && Math.abs(input[index]) >= cutoff) index += 1;
    const end = index - 1;
    if (start === 0 || end === length - 1) {
      throw new RangeError('Clip Fix 需要削波区域两侧均有未削波采样作为上下文');
    }

    const leftAnchor = input[start - 1];
    const rightAnchor = input[end + 1];
    const leftSlope = averageSlope(input, start - 1, -1);
    const rightSlope = averageSlope(input, end + 1, 1);
    const span = end - start + 2;
    for (let bad = start; bad <= end; bad += 1) {
      const t = (bad - start + 1) / span;
      output[bad] = cubicHermite(
        leftAnchor,
        rightAnchor,
        leftSlope,
        rightSlope,
        t,
      ) * gain;
    }
  }
  return output;
}

export function processClipFixChannels(channels: Float32Array[], settings: ClipFixSettings): Float32Array[] {
  if (channels.length === 0) throw new Error('Clip Fix 没有可处理的声道');
  return channels.map((channel) => processClipFixChannel(channel, settings));
}
