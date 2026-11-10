// Audacity Change Tempo: change duration without changing pitch.
// Source: Audacity master 1016711487c33fe857f547d9da59f854bfa1d08b,
// au3/libraries/au3-builtin-effects/ChangeTempoBase.{h,cpp} and
// au3/src/effects/ChangeTempo.cpp.

import { timeStretchChannelsJs } from '@/engine/timeStretch';

export interface ChangeTempoSettings {
  percentChange: number;
}

export const MIN_CHANGE_TEMPO_PERCENT = -95;
export const MAX_CHANGE_TEMPO_PERCENT = 3000;
export const CHANGE_TEMPO_SLIDER_MAX = 100;
export const CHANGE_TEMPO_SLIDER_WARP = 1.30105;
export const DEFAULT_CHANGE_TEMPO_SETTINGS: Readonly<ChangeTempoSettings> = Object.freeze({
  percentChange: 0,
});

export function isChangeTempoPercentValid(value: number): boolean {
  return Number.isFinite(value)
    && value >= MIN_CHANGE_TEMPO_PERCENT
    && value <= MAX_CHANGE_TEMPO_PERCENT;
}

export function validateChangeTempoSettings(settings: ChangeTempoSettings): void {
  if (!isChangeTempoPercentValid(settings.percentChange)) {
    throw new RangeError(
      `Tempo 变化必须在 ${MIN_CHANGE_TEMPO_PERCENT}% 至 ${MAX_CHANGE_TEMPO_PERCENT}% 之间`,
    );
  }
}

export function changeTempoRatio(settings: ChangeTempoSettings): number {
  validateChangeTempoSettings(settings);
  return 1 + settings.percentChange / 100;
}

export function isChangeTempoBypassed(settings: ChangeTempoSettings): boolean {
  validateChangeTempoSettings(settings);
  return settings.percentChange === 0;
}

export function durationAfterChangeTempo(duration: number, settings: ChangeTempoSettings): number {
  if (!Number.isFinite(duration) || duration < 0) {
    throw new RangeError('选区时长必须是有限的非负数');
  }
  return duration / changeTempoRatio(settings);
}

export function bpmAfterChangeTempo(bpm: number, settings: ChangeTempoSettings): number {
  if (!Number.isFinite(bpm) || bpm < 0) throw new RangeError('BPM 必须是有限的非负数');
  return bpm === 0 ? 0 : bpm * changeTempoRatio(settings);
}

export function percentChangeFromBpm(fromBpm: number, toBpm: number): number {
  if (!Number.isFinite(fromBpm) || fromBpm <= 0 || !Number.isFinite(toBpm) || toBpm <= 0) {
    throw new RangeError('原始 BPM 和目标 BPM 必须大于零');
  }
  return (toBpm / fromBpm - 1) * 100;
}

export function percentChangeFromDuration(fromDuration: number, toDuration: number): number {
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

/** Audacity warps only the positive half of its slider, reaching about 400%. */
export function percentChangeFromSlider(value: number): number {
  if (!Number.isFinite(value)) throw new RangeError('Tempo 滑块值必须是有限数值');
  const clamped = Math.max(MIN_CHANGE_TEMPO_PERCENT, Math.min(CHANGE_TEMPO_SLIDER_MAX, value));
  return clamped > 0 ? clamped ** CHANGE_TEMPO_SLIDER_WARP : clamped;
}

export function sliderFromPercentChange(percentChange: number): number {
  if (!isChangeTempoPercentValid(percentChange)) throw new RangeError('Tempo 变化超出滑块范围');
  return percentChange > 0
    ? percentChange ** (1 / CHANGE_TEMPO_SLIDER_WARP)
    : percentChange;
}

/**
 * Run the same WSOLA fallback used by clip playback. A speed ratio greater
 * than one shortens the selection; every channel shares analysis positions.
 */
export function processChangeTempoChannels(
  channels: readonly Float32Array[],
  settings: ChangeTempoSettings,
  sampleRate: number,
): Float32Array[] {
  const ratio = changeTempoRatio(settings);
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new RangeError('采样率必须大于零');
  }
  if (channels.length === 0) throw new RangeError('至少需要一个音频声道');
  const inputLength = channels[0].length;
  if (inputLength < 1 || channels.some((channel) => channel.length !== inputLength)) {
    throw new RangeError('Change Tempo 输入声道必须等长且非空');
  }
  for (const channel of channels) {
    for (let index = 0; index < channel.length; index += 1) {
      if (!Number.isFinite(channel[index])) {
        throw new RangeError(`Change Tempo 输入在第 ${index} 个采样包含非有限数值`);
      }
    }
  }

  const output = timeStretchChannelsJs(
    channels.map((channel) => new Float32Array(channel)),
    ratio,
    sampleRate,
  );
  const expectedLength = Math.max(1, Math.round(inputLength / ratio));
  if (
    output.length !== channels.length
    || output.some((channel) => channel.length !== expectedLength)
  ) {
    throw new Error('Change Tempo 输出声道长度不符合目标时长');
  }
  for (const channel of output) {
    for (let index = 0; index < channel.length; index += 1) {
      if (!Number.isFinite(channel[index])) {
        throw new RangeError(`Change Tempo 在第 ${index} 个采样产生非有限输出`);
      }
    }
  }
  return output;
}
