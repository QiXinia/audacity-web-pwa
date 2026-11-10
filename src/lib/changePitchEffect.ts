// Audacity Change Pitch: change pitch without changing selection duration.
// Source: Audacity master 77a50e4c94ba0dd712ef8ad5533214d53f90090c,
// au3/libraries/au3-builtin-effects/ChangePitchBase.{h,cpp} and
// au3/src/effects/ChangePitch.cpp. The deterministic Web fallback combines
// band-limited resampling with pitch-preserving WSOLA; it is not a claim of
// bit-identical SoundTouch output.

import { timeStretchChannelsJs } from '@/engine/timeStretch';
import { processChangeSpeedChannels } from '@/lib/changeSpeedEffect';

export interface ChangePitchSettings {
  percentChange: number;
}

export const MIN_CHANGE_PITCH_PERCENT = -99;
export const MAX_CHANGE_PITCH_PERCENT = 3000;
export const CHANGE_PITCH_SLIDER_MAX = 100;
export const CHANGE_PITCH_SLIDER_WARP = 1.30105;
export const MAX_CHANGE_PITCH_TOTAL_OUTPUT_SAMPLES = 20_000_000;
export const DEFAULT_CHANGE_PITCH_SETTINGS: Readonly<ChangePitchSettings> = Object.freeze({
  percentChange: 0,
});

export const PITCH_NAMES = Object.freeze([
  'C', 'C♯/D♭', 'D', 'D♯/E♭', 'E', 'F',
  'F♯/G♭', 'G', 'G♯/A♭', 'A', 'A♯/B♭', 'B',
] as const);

export function isChangePitchPercentValid(value: number): boolean {
  return Number.isFinite(value)
    && value >= MIN_CHANGE_PITCH_PERCENT
    && value <= MAX_CHANGE_PITCH_PERCENT;
}

export function validateChangePitchSettings(settings: ChangePitchSettings): void {
  if (!isChangePitchPercentValid(settings.percentChange)) {
    throw new RangeError(
      `音高变化必须在 ${MIN_CHANGE_PITCH_PERCENT}% 至 ${MAX_CHANGE_PITCH_PERCENT}% 之间`,
    );
  }
}

export function changePitchRatio(settings: ChangePitchSettings): number {
  validateChangePitchSettings(settings);
  return 1 + settings.percentChange / 100;
}

export function semitonesFromPercentChange(percentChange: number): number {
  const ratio = changePitchRatio({ percentChange });
  return 12 * Math.log2(ratio);
}

export function percentChangeFromSemitones(semitones: number): number {
  if (!Number.isFinite(semitones)) throw new RangeError('半音变化必须是有限数值');
  return 100 * (2 ** (semitones / 12) - 1);
}

export function percentChangeFromFrequencies(fromHz: number, toHz: number): number {
  if (!Number.isFinite(fromHz) || fromHz <= 0 || !Number.isFinite(toHz) || toHz <= 0) {
    throw new RangeError('原始频率和目标频率必须大于零');
  }
  return 100 * (toHz / fromHz - 1);
}

export function midiNoteFromPitch(pitch: number, octave: number): number {
  if (!Number.isInteger(pitch) || pitch < 0 || pitch > 11 || !Number.isInteger(octave)) {
    throw new RangeError('音高或八度无效');
  }
  return (octave + 1) * 12 + pitch;
}

export function pitchToFrequency(pitch: number, octave: number): number {
  return 440 * 2 ** ((midiNoteFromPitch(pitch, octave) - 69) / 12);
}

export function nearestPitchFromFrequency(frequency: number): { pitch: number; octave: number } {
  if (!Number.isFinite(frequency) || frequency <= 0) throw new RangeError('频率必须大于零');
  const midi = Math.max(0, Math.min(127, Math.round(69 + 12 * Math.log2(frequency / 440))));
  return { pitch: midi % 12, octave: Math.floor(midi / 12) - 1 };
}

export function targetPitchFromSemitones(
  fromPitch: number,
  semitones: number,
): number {
  if (!Number.isInteger(fromPitch) || fromPitch < 0 || fromPitch > 11 || !Number.isFinite(semitones)) {
    throw new RangeError('原始音高或半音变化无效');
  }
  const rounded = Math.round(semitones);
  return ((fromPitch + rounded) % 12 + 12) % 12;
}

export function isChangePitchBypassed(settings: ChangePitchSettings): boolean {
  validateChangePitchSettings(settings);
  return settings.percentChange === 0;
}

export function percentChangeFromPitchSlider(value: number): number {
  if (!Number.isFinite(value)) throw new RangeError('音高滑块值必须是有限数值');
  const clamped = Math.max(MIN_CHANGE_PITCH_PERCENT, Math.min(CHANGE_PITCH_SLIDER_MAX, value));
  return clamped > 0 ? clamped ** CHANGE_PITCH_SLIDER_WARP : clamped;
}

export function sliderFromPitchPercent(percentChange: number): number {
  if (!isChangePitchPercentValid(percentChange)) throw new RangeError('音高变化超出参数范围');
  if (percentChange > 400) return CHANGE_PITCH_SLIDER_MAX;
  return percentChange > 0 ? percentChange ** (1 / CHANGE_PITCH_SLIDER_WARP) : percentChange;
}

function validateChannels(channels: readonly Float32Array[]): number {
  if (channels.length === 0) throw new RangeError('至少需要一个音频声道');
  const inputLength = channels[0].length;
  if (inputLength < 1 || channels.some((channel) => channel.length !== inputLength)) {
    throw new RangeError('Change Pitch 输入声道必须等长且非空');
  }
  for (const channel of channels) {
    for (let index = 0; index < channel.length; index += 1) {
      if (!Number.isFinite(channel[index])) {
        throw new RangeError(`Change Pitch 输入在第 ${index} 个采样包含非有限数值`);
      }
    }
  }
  if (!Number.isSafeInteger(inputLength * channels.length)
    || inputLength * channels.length > MAX_CHANGE_PITCH_TOTAL_OUTPUT_SAMPLES) {
    throw new RangeError('Change Pitch 输出超过浏览器内存上限，请缩短选区或减少声道');
  }
  return inputLength;
}

function stretchToInputLength(
  resampled: Float32Array[],
  inputLength: number,
): Float32Array[] {
  const intermediateLength = resampled[0].length;
  // The generic tempo fallback linearly resamples below 128 frames, which would
  // cancel the pitch shift. Repeat very short intermediate grains to the real
  // WSOLA threshold instead, then restore the exact original number of frames.
  const stretchedInput = intermediateLength < 128
    ? resampled.map((channel) => Float32Array.from(
      { length: 128 },
      (_, index) => channel[index % intermediateLength],
    ))
    : resampled;
  const speed = stretchedInput[0].length / inputLength;
  return timeStretchChannelsJs(stretchedInput, speed, 48_000);
}

/**
 * Resampling changes pitch and duration; the following WSOLA stage restores the
 * original duration while preserving the new pitch. All channels share every
 * analysis position and the output length is exactly the input length.
 */
export function processChangePitchChannels(
  channels: readonly Float32Array[],
  settings: ChangePitchSettings,
  sampleRate: number,
): Float32Array[] {
  changePitchRatio(settings);
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new RangeError('采样率必须大于零');
  }
  const inputLength = validateChannels(channels);
  if (settings.percentChange === 0) return channels.map((channel) => channel.slice());

  const resampled = processChangeSpeedChannels(channels, settings, sampleRate);
  const output = stretchToInputLength(resampled, inputLength);
  if (output.length !== channels.length || output.some((channel) => channel.length !== inputLength)) {
    throw new Error('Change Pitch 输出声道长度不符合原选区时长');
  }
  for (const channel of output) {
    for (let index = 0; index < channel.length; index += 1) {
      if (!Number.isFinite(channel[index])) {
        throw new RangeError(`Change Pitch 在第 ${index} 个采样产生非有限输出`);
      }
    }
  }
  return output;
}
