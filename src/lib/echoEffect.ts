import type { IClip } from '@/types/project';

export const ECHO_DEFAULT_DELAY_SECONDS = 1;
export const ECHO_DEFAULT_DECAY = 0.5;
export const ECHO_MIN_DELAY_SECONDS = 0.001;
// Browser memory guard; Audacity likewise rejects allocations exceeding capacity.
export const MAX_ECHO_DELAY_SAMPLES = 5_000_000;
export const MAX_ECHO_TOTAL_HISTORY_SAMPLES = 10_000_000;

export interface EchoPlan {
  delaySeconds: number;
  decay: number;
  sampleRate: number;
  delaySamples: number;
}

export interface EchoState {
  readonly plan: EchoPlan;
  readonly history: Float32Array[];
  position: number;
}

export interface EchoSelection {
  start: number;
  end: number;
}

export function getEchoPlan(
  delaySeconds: number,
  decay: number,
  sampleRate: number,
): EchoPlan {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new RangeError('采样率必须大于零');
  }
  if (!Number.isFinite(delaySeconds) || delaySeconds < ECHO_MIN_DELAY_SECONDS) {
    throw new RangeError(`延迟时间须不小于 ${ECHO_MIN_DELAY_SECONDS} 秒`);
  }
  if (!Number.isFinite(decay) || decay < 0) {
    throw new RangeError('衰减因子须为不小于零的有限数值');
  }
  const delaySamples = Math.floor(delaySeconds * sampleRate);
  if (delaySamples < 1) {
    throw new RangeError('延迟时间小于当前工程的一个采样');
  }
  if (delaySamples > MAX_ECHO_DELAY_SAMPLES) {
    throw new RangeError(`延迟历史超过 ${MAX_ECHO_DELAY_SAMPLES} 个采样的浏览器内存上限`);
  }
  return { delaySeconds, decay, sampleRate, delaySamples };
}

export function createEchoState(plan: EchoPlan): EchoState {
  return { plan, history: [], position: 0 };
}

/**
 * Audacity EchoBase recurrence, with independent per-channel history:
 * output = input + history[position] * decay; history[position] = output.
 * Only [startSample, endSample) is changed. The state can be carried into the
 * next selected clip on the same track, so clip boundaries do not reset echo.
 */
export function processEchoSelection(
  channels: readonly Float32Array[],
  startSample: number,
  endSample: number,
  state: EchoState,
): Float32Array[] {
  const length = channels[0]?.length ?? 0;
  if (
    channels.length === 0
    || length < 1
    || channels.some((channel) => channel.length !== length)
  ) {
    throw new RangeError('回声处理需要等长的非空声道');
  }
  if (
    !Number.isSafeInteger(startSample)
    || !Number.isSafeInteger(endSample)
    || startSample < 0
    || endSample > length
    || endSample <= startSample
  ) {
    throw new RangeError('回声选区必须是声道范围内的非空整数采样区间');
  }

  const { plan } = state;
  while (state.history.length < channels.length) {
    state.history.push(new Float32Array(plan.delaySamples));
  }
  const output = channels.map((channel) => new Float32Array(channel));

  for (let index = startSample; index < endSample; index += 1) {
    const position = state.position;
    for (let channelIndex = 0; channelIndex < channels.length; channelIndex += 1) {
      const value = channels[channelIndex][index]
        + state.history[channelIndex][position] * plan.decay;
      const stored = Math.fround(value);
      if (!Number.isFinite(stored)) {
        throw new RangeError('回声采样产生非有限值，请降低衰减因子或缩短选区');
      }
      output[channelIndex][index] = stored;
      state.history[channelIndex][position] = stored;
    }
    state.position = (position + 1) % plan.delaySamples;
  }

  return output;
}

export function getEchoClipSampleRange(
  clip: Pick<IClip, 'startTime' | 'duration'>,
  selection: EchoSelection,
  sourceOffset: number,
  sampleRate: number,
  channelLength: number,
): { startSample: number; endSample: number } | null {
  if (!Number.isFinite(sourceOffset) || sourceOffset < 0) {
    throw new RangeError('片段源偏移必须是非负有限时间');
  }
  const overlapStart = Math.max(clip.startTime, selection.start);
  const overlapEnd = Math.min(clip.startTime + clip.duration, selection.end);
  if (overlapEnd <= overlapStart) return null;
  const offsetInClip = overlapStart - clip.startTime + sourceOffset;
  const startSample = Math.max(0, Math.floor(offsetInClip * sampleRate));
  const endSample = Math.min(
    channelLength,
    Math.floor((offsetInClip + overlapEnd - overlapStart) * sampleRate),
  );
  return endSample > startSample ? { startSample, endSample } : null;
}
