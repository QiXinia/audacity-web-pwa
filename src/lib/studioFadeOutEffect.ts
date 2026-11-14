// Audacity 4.0.0 StudioFadeOut.ny: raised-cosine fade plus swept low-pass.

export const STUDIO_FADE_MIN_SAMPLES = 3;
export const STUDIO_FADE_MAX_SAMPLES = 20_000_000;
export const STUDIO_FADE_FILTER_THRESHOLD_SECONDS = 0.2;
export const STUDIO_FADE_CROSSFADE_SECONDS = 0.5;
export const STUDIO_FADE_FINAL_CUTOFF_HZ = 100;

function validateInputs(channels: readonly Float32Array[], sampleRate: number): number {
  if (!Number.isFinite(sampleRate) || sampleRate <= STUDIO_FADE_MIN_SAMPLES - 1) {
    throw new RangeError('Studio Fade Out 采样率必须是大于 2 的有限数值');
  }
  if (channels.length === 0) throw new RangeError('Studio Fade Out 至少需要一个声道');
  const length = channels[0]?.length ?? 0;
  if (!Number.isSafeInteger(length) || length < STUDIO_FADE_MIN_SAMPLES) {
    throw new RangeError('Studio Fade Out 选区必须超过 2 个采样');
  }
  if (length > STUDIO_FADE_MAX_SAMPLES) {
    throw new RangeError('Studio Fade Out 处理量超过浏览器内存上限');
  }
  for (const channel of channels) {
    if (!(channel instanceof Float32Array) || channel.length !== length) {
      throw new RangeError('Studio Fade Out 声道必须非空且等长');
    }
    for (let sample = 0; sample < length; sample += 1) {
      if (!Number.isFinite(channel[sample])) {
        throw new RangeError('Studio Fade Out 输入包含非有限采样');
      }
    }
  }
  return length;
}

export function raisedCosineGain(length: number, sample: number): number {
  if (length <= 1) return 1;
  return 0.5 * (1 + Math.cos(Math.PI * sample / (length - 1)));
}

function lowPassOnePole(channel: Float32Array, sampleRate: number, durationSeconds: number): Float32Array {
  const output = new Float32Array(channel.length);
  const nyquist = sampleRate / 2;
  const finalCutoff = Math.min(STUDIO_FADE_FINAL_CUTOFF_HZ, nyquist * 0.999);
  let previousOutput = 0;
  for (let sample = 0; sample < channel.length; sample += 1) {
    const progress = sample / Math.max(1, channel.length - 1);
    const cutoff = nyquist + (finalCutoff - nyquist) * progress;
    const alpha = 1 - Math.exp((-2 * Math.PI * cutoff) / sampleRate);
    previousOutput += alpha * (channel[sample] - previousOutput);
    output[sample] = previousOutput;
  }
  return output;
}

export function processStudioFadeOutChannels(
  channels: readonly Float32Array[],
  sampleRate: number,
): Float32Array[] {
  const length = validateInputs(channels, sampleRate);
  const durationSeconds = length / sampleRate;
  const useFilter = durationSeconds >= STUDIO_FADE_FILTER_THRESHOLD_SECONDS;
  const crossfadeSeconds = useFilter
    ? Math.min(durationSeconds / 2, STUDIO_FADE_CROSSFADE_SECONDS)
    : 0;

  return channels.map((channel) => {
    const filtered = useFilter ? lowPassOnePole(channel, sampleRate, durationSeconds) : null;
    const output = new Float32Array(length);
    for (let sample = 0; sample < length; sample += 1) {
      const fadeGain = raisedCosineGain(length, sample);
      let value = channel[sample];
      if (filtered && crossfadeSeconds > 0) {
        const time = sample / sampleRate;
        const unfilteredGain = time < crossfadeSeconds
          ? raisedCosineGain(
              Math.max(STUDIO_FADE_MIN_SAMPLES, Math.round(crossfadeSeconds * sampleRate)),
              sample,
            )
          : 0;
        value = unfilteredGain * channel[sample] + (1 - unfilteredGain) * filtered[sample];
      }
      output[sample] = value * fadeGain;
      if (!Number.isFinite(output[sample])) throw new RangeError('Studio Fade Out 生成了非有限采样');
    }
    return output;
  });
}
