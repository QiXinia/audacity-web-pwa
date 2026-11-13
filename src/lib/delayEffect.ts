import { processChangePitchChannels } from '@/lib/changePitchEffect';
import { processChangeSpeedChannels } from '@/lib/changeSpeedEffect';

export type DelayType = 'regular' | 'bouncingBall' | 'reverseBouncingBall';
export type DelayPitchMode = 'pitchTempo' | 'lowQualityPitchShift';

export interface DelaySettings {
  delayType: DelayType;
  delayLevelDb: number;
  delaySeconds: number;
  pitchMode: DelayPitchMode;
  pitchChangeSemitones: number;
  echoCount: number;
  allowDurationChange: boolean;
}

export const DEFAULT_DELAY_SETTINGS: Readonly<DelaySettings> = Object.freeze({
  delayType: 'regular',
  delayLevelDb: -6,
  delaySeconds: 0.3,
  pitchMode: 'pitchTempo',
  pitchChangeSemitones: 0,
  echoCount: 5,
  allowDurationChange: true,
});

export const MIN_DELAY_LEVEL_DB = -30;
export const MAX_DELAY_LEVEL_DB = 1;
export const MIN_DELAY_SECONDS = 0;
export const MAX_DELAY_SECONDS = 5;
export const MIN_PITCH_CHANGE_SEMITONES = -2;
export const MAX_PITCH_CHANGE_SEMITONES = 2;
export const MIN_ECHO_COUNT = 1;
export const MAX_ECHO_COUNT = 30;
export const MAX_DELAY_TOTAL_OUTPUT_SAMPLES = 20_000_000;

export function validateDelaySettings(settings: DelaySettings): void {
  const types: DelayType[] = ['regular', 'bouncingBall', 'reverseBouncingBall'];
  if (!types.includes(settings.delayType)) throw new RangeError('未知 Delay 类型');
  if (!['pitchTempo', 'lowQualityPitchShift'].includes(settings.pitchMode)) {
    throw new RangeError('未知 Delay 音高变化模式');
  }
  if (!Number.isFinite(settings.delayLevelDb)
    || settings.delayLevelDb < MIN_DELAY_LEVEL_DB
    || settings.delayLevelDb > MAX_DELAY_LEVEL_DB) {
    throw new RangeError(`Delay 电平必须在 ${MIN_DELAY_LEVEL_DB} 至 ${MAX_DELAY_LEVEL_DB} dB 之间`);
  }
  if (!Number.isFinite(settings.delaySeconds)
    || settings.delaySeconds < MIN_DELAY_SECONDS
    || settings.delaySeconds > MAX_DELAY_SECONDS) {
    throw new RangeError(`Delay 时间必须在 ${MIN_DELAY_SECONDS} 至 ${MAX_DELAY_SECONDS} 秒之间`);
  }
  if (!Number.isFinite(settings.pitchChangeSemitones)
    || settings.pitchChangeSemitones < MIN_PITCH_CHANGE_SEMITONES
    || settings.pitchChangeSemitones > MAX_PITCH_CHANGE_SEMITONES) {
    throw new RangeError('每个回声的音高变化必须在 -2 至 2 半音之间');
  }
  if (!Number.isInteger(settings.echoCount)
    || settings.echoCount < MIN_ECHO_COUNT
    || settings.echoCount > MAX_ECHO_COUNT) {
    throw new RangeError(`回声数量必须在 ${MIN_ECHO_COUNT} 至 ${MAX_ECHO_COUNT} 之间`);
  }
}

function validateChannels(channels: readonly Float32Array[]): number {
  if (channels.length === 0) throw new RangeError('Delay 至少需要一个声道');
  const length = channels[0].length;
  if (length < 1 || channels.some((channel) => channel.length !== length)) {
    throw new RangeError('Delay 声道必须非空且等长');
  }
  if (channels.some((channel) => channel.some((value) => !Number.isFinite(value)))) {
    throw new RangeError('Delay 输入包含非有限采样');
  }
  return length;
}

function echoOffset(settings: DelaySettings, echoIndex: number, sampleRate: number): number {
  const stepSeconds = settings.delayType === 'regular'
    ? settings.delaySeconds
    : settings.delaySeconds / settings.echoCount;
  let seconds = 0;
  for (let count = 1; count <= echoIndex; count += 1) {
    if (settings.delayType === 'bouncingBall') {
      seconds += stepSeconds * (1 + settings.echoCount - count);
    } else if (settings.delayType === 'reverseBouncingBall') {
      seconds += stepSeconds * count;
    } else {
      seconds += stepSeconds;
    }
  }
  return Math.round(seconds * sampleRate);
}

function modifyEcho(
  channels: readonly Float32Array[],
  echoIndex: number,
  settings: DelaySettings,
  sampleRate: number,
): Float32Array[] {
  const cumulativeSemitones = echoIndex * settings.pitchChangeSemitones;
  const frequencyRatio = 2 ** (cumulativeSemitones / 12);
  const percentChange = (frequencyRatio - 1) * 100;
  const transformed = settings.pitchMode === 'pitchTempo'
    ? processChangeSpeedChannels(channels, { percentChange }, sampleRate)
    : processChangePitchChannels(channels, { percentChange }, sampleRate);
  const gain = 10 ** ((echoIndex * settings.delayLevelDb) / 20);
  return transformed.map((channel) => {
    const output = new Float32Array(channel.length);
    for (let index = 0; index < channel.length; index += 1) {
      const value = channel[index] * gain;
      output[index] = Number.isFinite(value) ? value : 0;
    }
    return output;
  });
}

export function processDelayChannels(
  channels: readonly Float32Array[],
  settings: DelaySettings,
  sampleRate: number,
): Float32Array[] {
  validateDelaySettings(settings);
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) throw new RangeError('采样率必须大于零');
  const inputLength = validateChannels(channels);
  const echoes: { offset: number; channels: Float32Array[] }[] = [];
  let unconstrainedLength = inputLength;

  for (let echoIndex = 1; echoIndex <= settings.echoCount; echoIndex += 1) {
    const offset = echoOffset(settings, echoIndex, sampleRate);
    const transformed = modifyEcho(channels, echoIndex, settings, sampleRate);
    echoes.push({ offset, channels: transformed });
    unconstrainedLength = Math.max(unconstrainedLength, offset + transformed[0].length);
  }

  const outputLength = settings.allowDurationChange ? unconstrainedLength : inputLength;
  if (!Number.isSafeInteger(outputLength)
    || outputLength * channels.length > MAX_DELAY_TOTAL_OUTPUT_SAMPLES) {
    throw new RangeError('Delay 输出超过浏览器内存上限');
  }
  const output = Array.from({ length: channels.length }, () => new Float32Array(outputLength));
  for (let index = 0; index < inputLength; index += 1) {
    for (let channel = 0; channel < channels.length; channel += 1) {
      output[channel][index] = channels[channel][index];
    }
  }
  for (const echo of echoes) {
    for (let channel = 0; channel < channels.length; channel += 1) {
      const source = echo.channels[channel];
      const available = Math.min(source.length, outputLength - echo.offset);
      for (let index = 0; index < available; index += 1) {
        const targetIndex = echo.offset + index;
        const value = output[channel][targetIndex] + source[index];
        output[channel][targetIndex] = Math.fround(value);
      }
    }
  }
  return output;
}
