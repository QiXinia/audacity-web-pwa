export type CrossfadeType = 'gain' | 'power1' | 'power2' | 'custom';
export type CrossfadeDirectionMode = 'automatic' | 'out-in' | 'in-out';
export type CrossfadeFade = 'in' | 'out';

export interface CrossfadeSettings {
  type: CrossfadeType;
  customCurve: number;
  direction: CrossfadeDirectionMode;
}

export const DEFAULT_CROSSFADE_SETTINGS: CrossfadeSettings = {
  type: 'gain',
  customCurve: 0,
  direction: 'automatic',
};

export function validateCrossfadeSettings(settings: CrossfadeSettings): void {
  if (!['gain', 'power1', 'power2', 'custom'].includes(settings.type)) {
    throw new RangeError('Crossfade 类型不受支持');
  }
  if (
    !Number.isFinite(settings.customCurve)
    || settings.customCurve < 0
    || settings.customCurve > 1
  ) {
    throw new RangeError('Custom curve 必须位于 0 到 1 之间');
  }
  if (!['automatic', 'out-in', 'in-out'].includes(settings.direction)) {
    throw new RangeError('Crossfade 方向不受支持');
  }
}

export function resolveCrossfadeFade(
  trackIndex: number,
  direction: CrossfadeDirectionMode,
  startDistance: number,
  endDistance: number,
): CrossfadeFade {
  if (direction === 'out-in') return trackIndex % 2 === 0 ? 'out' : 'in';
  if (direction === 'in-out') return trackIndex % 2 === 0 ? 'in' : 'out';
  return startDistance < endDistance ? 'in' : 'out';
}

function gainAt(position: number, fade: CrossfadeFade, settings: CrossfadeSettings): number {
  const t = fade === 'in' ? position : 1 - position;
  let gain: number;
  if (settings.type === 'gain') {
    gain = t;
  } else if (settings.type === 'power1') {
    gain = Math.sin((Math.PI / 2) * t);
  } else if (settings.type === 'power2') {
    gain = Math.sqrt(t);
  } else {
    const exponent = 1 / (1 + 2 * settings.customCurve);
    gain = t ** exponent;
  }
  if (!Number.isFinite(gain) || gain < 0 || gain > 1) {
    throw new RangeError('Crossfade 增益计算结果无效');
  }
  return gain;
}

export function processCrossfadeChannels(
  channels: readonly Float32Array[],
  fade: CrossfadeFade,
  settings: CrossfadeSettings,
): Float32Array[] {
  validateCrossfadeSettings(settings);
  if (channels.length === 0) throw new RangeError('Crossfade 必须包含至少一个声道');
  const length = channels[0]?.length ?? 0;
  if (length === 0) throw new RangeError('Crossfade 选区不能为空');
  if (channels.some((channel) => channel.length !== length)) {
    throw new RangeError('Crossfade 声道长度必须一致');
  }

  return channels.map((channel) => {
    const output = new Float32Array(length);
    for (let index = 0; index < length; index += 1) {
      const position = length === 1 ? 0 : index / (length - 1);
      output[index] = channel[index] * gainAt(position, fade, settings);
    }
    return output;
  });
}
