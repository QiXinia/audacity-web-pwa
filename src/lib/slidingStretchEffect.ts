// Audacity Sliding stretch: continuous tempo and/or pitch changes.
// Official references (Audacity 20f2d58974013473d1eb040d6f91c160a2138319):
// src/effects/builtin_collection/slidingstretch/* and
// au3/libraries/au3-builtin-effects/SBSMSBase.{h,cpp}.
//
// The official effect uses SBSMS with SlideLinearOutputRate for both slides.
// This browser fallback keeps the same six parameters, unit conversions,
// linear-output-rate time map and output duration. Variable settings are rendered
// as deterministic grains using band-limited resampling plus shared-position
// WSOLA. It is not a claim of sample- or bit-identical SBSMS output.

import { timeStretchChannelsJs } from '@/engine/timeStretch';
import { processChangePitchChannels } from '@/lib/changePitchEffect';

export interface SlidingStretchSettings {
  initialTempoPercent: number;
  finalTempoPercent: number;
  initialPitchSemitones: number;
  finalPitchSemitones: number;
  initialPitchPercent: number;
  finalPitchPercent: number;
}

export const MIN_SLIDING_STRETCH_TEMPO_PERCENT = -90;
export const MAX_SLIDING_STRETCH_TEMPO_PERCENT = 500;
export const MIN_SLIDING_STRETCH_PITCH_SEMITONES = -12;
export const MAX_SLIDING_STRETCH_PITCH_SEMITONES = 12;
export const MIN_SLIDING_STRETCH_PITCH_PERCENT = -50;
export const MAX_SLIDING_STRETCH_PITCH_PERCENT = 100;
export const MAX_SLIDING_STRETCH_TOTAL_OUTPUT_SAMPLES = 20_000_000;
export const SLIDING_STRETCH_VARIABLE_GRAIN_SIZE = 2048;

export const DEFAULT_SLIDING_STRETCH_SETTINGS: Readonly<SlidingStretchSettings> = Object.freeze({
  initialTempoPercent: 0,
  finalTempoPercent: 0,
  initialPitchSemitones: 0,
  finalPitchSemitones: 0,
  initialPitchPercent: 0,
  finalPitchPercent: 0,
});

function validateRange(value: number, minimum: number, maximum: number, label: string): void {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new RangeError(`${label}必须在 ${minimum} 至 ${maximum} 之间`);
  }
}

export function validateSlidingStretchSettings(settings: SlidingStretchSettings): void {
  validateRange(
    settings.initialTempoPercent,
    MIN_SLIDING_STRETCH_TEMPO_PERCENT,
    MAX_SLIDING_STRETCH_TEMPO_PERCENT,
    '初始 Tempo 变化百分比',
  );
  validateRange(
    settings.finalTempoPercent,
    MIN_SLIDING_STRETCH_TEMPO_PERCENT,
    MAX_SLIDING_STRETCH_TEMPO_PERCENT,
    '最终 Tempo 变化百分比',
  );
  validateRange(
    settings.initialPitchSemitones,
    MIN_SLIDING_STRETCH_PITCH_SEMITONES,
    MAX_SLIDING_STRETCH_PITCH_SEMITONES,
    '初始音高半音数',
  );
  validateRange(
    settings.finalPitchSemitones,
    MIN_SLIDING_STRETCH_PITCH_SEMITONES,
    MAX_SLIDING_STRETCH_PITCH_SEMITONES,
    '最终音高半音数',
  );
  validateRange(
    settings.initialPitchPercent,
    MIN_SLIDING_STRETCH_PITCH_PERCENT,
    MAX_SLIDING_STRETCH_PITCH_PERCENT,
    '初始音高变化百分比',
  );
  validateRange(
    settings.finalPitchPercent,
    MIN_SLIDING_STRETCH_PITCH_PERCENT,
    MAX_SLIDING_STRETCH_PITCH_PERCENT,
    '最终音高变化百分比',
  );
}

export function slidingStretchSemitonesToPercent(semitones: number): number {
  validateRange(
    semitones,
    MIN_SLIDING_STRETCH_PITCH_SEMITONES,
    MAX_SLIDING_STRETCH_PITCH_SEMITONES,
    '音高半音数',
  );
  return 100 * (2 ** (semitones / 12) - 1);
}

export function slidingStretchPercentToSemitones(percent: number): number {
  validateRange(
    percent,
    MIN_SLIDING_STRETCH_PITCH_PERCENT,
    MAX_SLIDING_STRETCH_PITCH_PERCENT,
    '音高变化百分比',
  );
  return 12 * Math.log2(1 + percent / 100);
}

export function isSlidingStretchBypassed(settings: SlidingStretchSettings): boolean {
  validateSlidingStretchSettings(settings);
  return settings.initialTempoPercent === 0
    && settings.finalTempoPercent === 0
    && settings.initialPitchPercent === 0
    && settings.finalPitchPercent === 0;
}

function tempoRatios(settings: SlidingStretchSettings): readonly [number, number] {
  validateSlidingStretchSettings(settings);
  return [
    1 + settings.initialTempoPercent / 100,
    1 + settings.finalTempoPercent / 100,
  ];
}

function pitchRatios(settings: SlidingStretchSettings): readonly [number, number] {
  return [
    1 + settings.initialPitchPercent / 100,
    1 + settings.finalPitchPercent / 100,
  ];
}

/** SBSMS SlideLinearOutputRate total stretch: 2 / (rateStart + rateEnd). */
export function slidingStretchTotalStretch(settings: SlidingStretchSettings): number {
  const [rateStart, rateEnd] = tempoRatios(settings);
  return 2 / (rateStart + rateEnd);
}

export function durationAfterSlidingStretch(
  duration: number,
  settings: SlidingStretchSettings,
): number {
  if (!Number.isFinite(duration) || duration < 0) {
    throw new RangeError('Sliding Stretch 选区时长必须是有限的非负数');
  }
  return duration * slidingStretchTotalStretch(settings);
}

export function slidingStretchOutputLength(
  inputLength: number,
  settings: SlidingStretchSettings,
): number {
  if (!Number.isSafeInteger(inputLength) || inputLength < 1) {
    throw new RangeError('Sliding Stretch 输入长度必须是正的安全整数');
  }
  const outputLength = Math.max(
    1,
    Math.round(inputLength * slidingStretchTotalStretch(settings)),
  );
  if (!Number.isSafeInteger(outputLength)) {
    throw new RangeError('Sliding Stretch 输出长度超出数值范围');
  }
  return outputLength;
}

function unitInterval(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`${label}必须位于 0 至 1`);
  }
  return value;
}

/** Map normalized output time to normalized source time for linear output rate. */
export function slidingStretchOutputTimeToInput(
  outputPosition: number,
  settings: SlidingStretchSettings,
): number {
  const position = unitInterval(outputPosition, '输出时间位置');
  const [rateStart, rateEnd] = tempoRatios(settings);
  const averageRate = (rateStart + rateEnd) / 2;
  const mapped = (
    rateStart * position + 0.5 * (rateEnd - rateStart) * position * position
  ) / averageRate;
  return Math.max(0, Math.min(1, mapped));
}

/** Invert the linear-output-rate map for clip gaps and other timeline markers. */
export function slidingStretchInputTimeToOutput(
  inputPosition: number,
  settings: SlidingStretchSettings,
): number {
  const position = unitInterval(inputPosition, '输入时间位置');
  const [rateStart, rateEnd] = tempoRatios(settings);
  if (rateStart === rateEnd) return position;
  const averageRate = (rateStart + rateEnd) / 2;
  const quadratic = 0.5 * (rateEnd - rateStart) / averageRate;
  const linear = rateStart / averageRate;
  const discriminant = Math.max(0, linear * linear + 4 * quadratic * position);
  // This equivalent form avoids cancellation when the rate slide is nearly flat.
  const mapped = 2 * position / (linear + Math.sqrt(discriminant));
  return Math.max(0, Math.min(1, mapped));
}

export function slidingStretchOutputRateAt(
  outputPosition: number,
  settings: SlidingStretchSettings,
): number {
  const position = unitInterval(outputPosition, '输出时间位置');
  const [rateStart, rateEnd] = tempoRatios(settings);
  return rateStart + (rateEnd - rateStart) * position;
}

export function slidingStretchPitchRatioAt(
  outputPosition: number,
  settings: SlidingStretchSettings,
): number {
  const position = unitInterval(outputPosition, '输出时间位置');
  const [pitchStart, pitchEnd] = pitchRatios(settings);
  return pitchStart + (pitchEnd - pitchStart) * position;
}

/**
 * Restrict the global slide to one clip's source interval. Linear output-rate and
 * pitch slides stay linear after this change of coordinates, so separate clips
 * do not incorrectly restart at the global initial parameters.
 */
export function slidingStretchSubrangeSettings(
  settings: SlidingStretchSettings,
  sourceStart: number,
  sourceEnd: number,
): SlidingStretchSettings {
  const start = unitInterval(sourceStart, '片段源区间开始');
  const end = unitInterval(sourceEnd, '片段源区间结束');
  if (end <= start) throw new RangeError('片段源区间必须是正时长区间');
  const outputStart = slidingStretchInputTimeToOutput(start, settings);
  const outputEnd = slidingStretchInputTimeToOutput(end, settings);
  const initialTempoPercent = 100 * (slidingStretchOutputRateAt(outputStart, settings) - 1);
  const finalTempoPercent = 100 * (slidingStretchOutputRateAt(outputEnd, settings) - 1);
  const initialPitchPercent = 100 * (slidingStretchPitchRatioAt(outputStart, settings) - 1);
  const finalPitchPercent = 100 * (slidingStretchPitchRatioAt(outputEnd, settings) - 1);
  return {
    initialTempoPercent,
    finalTempoPercent,
    initialPitchSemitones: slidingStretchPercentToSemitones(initialPitchPercent),
    finalPitchSemitones: slidingStretchPercentToSemitones(finalPitchPercent),
    initialPitchPercent,
    finalPitchPercent,
  };
}

function validateChannels(channels: readonly Float32Array[]): number {
  if (channels.length === 0) throw new RangeError('至少需要一个音频声道');
  const inputLength = channels[0].length;
  if (inputLength < 1 || channels.some((channel) => channel.length !== inputLength)) {
    throw new RangeError('Sliding Stretch 输入声道必须等长且非空');
  }
  for (const channel of channels) {
    for (let index = 0; index < channel.length; index += 1) {
      if (!Number.isFinite(channel[index])) {
        throw new RangeError(`Sliding Stretch 输入在第 ${index} 个采样包含非有限数值`);
      }
    }
  }
  return inputLength;
}

function linearFitChannel(channel: Float32Array, outputLength: number): Float32Array {
  if (channel.length === outputLength) return channel;
  const output = new Float32Array(outputLength);
  if (channel.length === 0) return output;
  for (let index = 0; index < outputLength; index += 1) {
    const position = index * channel.length / outputLength;
    const left = Math.min(channel.length - 1, Math.floor(position));
    const right = Math.min(channel.length - 1, left + 1);
    const fraction = position - left;
    output[index] = channel[left] * (1 - fraction) + channel[right] * fraction;
  }
  return output;
}

function fitChannels(channels: Float32Array[], outputLength: number): Float32Array[] {
  return channels.map((channel) => linearFitChannel(channel, outputLength));
}

function readSourceGrain(
  channels: readonly Float32Array[],
  sourceStart: number,
  sourceEnd: number,
  outputLength: number,
): Float32Array[] {
  const inputLength = channels[0].length;
  const sourceStep = (sourceEnd - sourceStart) / outputLength;
  return channels.map((channel) => {
    const output = new Float32Array(outputLength);
    for (let index = 0; index < outputLength; index += 1) {
      const position = Math.max(0, Math.min(inputLength - 1, sourceStart + index * sourceStep));
      const left = Math.floor(position);
      const right = Math.min(inputLength - 1, left + 1);
      const fraction = position - left;
      output[index] = channel[left] * (1 - fraction) + channel[right] * fraction;
    }
    return output;
  });
}

function assertFiniteOutput(channels: readonly Float32Array[]): void {
  for (const channel of channels) {
    for (let index = 0; index < channel.length; index += 1) {
      if (!Number.isFinite(channel[index])) {
        throw new RangeError(`Sliding Stretch 在第 ${index} 个采样产生非有限输出`);
      }
    }
  }
}

function renderConstant(
  channels: readonly Float32Array[],
  settings: SlidingStretchSettings,
  sampleRate: number,
  outputLength: number,
): Float32Array[] {
  const [rateStart] = tempoRatios(settings);
  let rendered: Float32Array[] = channels.map((channel) => channel.slice());
  if (settings.initialPitchPercent !== 0) {
    rendered = processChangePitchChannels(
      rendered,
      { percentChange: settings.initialPitchPercent },
      sampleRate,
    );
  }
  if (rateStart !== 1) {
    rendered = timeStretchChannelsJs(rendered, rateStart, sampleRate);
  }
  return fitChannels(rendered, outputLength);
}

function renderVariableGrains(
  channels: readonly Float32Array[],
  settings: SlidingStretchSettings,
  sampleRate: number,
  outputLength: number,
): Float32Array[] {
  const inputLength = channels[0].length;
  const output = channels.map(() => new Float32Array(outputLength));
  for (let outputStart = 0; outputStart < outputLength;) {
    const outputEnd = Math.min(
      outputLength,
      outputStart + SLIDING_STRETCH_VARIABLE_GRAIN_SIZE,
    );
    const grainLength = outputEnd - outputStart;
    const normalizedStart = outputStart / outputLength;
    const normalizedEnd = outputEnd / outputLength;
    const sourceStart = slidingStretchOutputTimeToInput(normalizedStart, settings) * inputLength;
    const sourceEnd = slidingStretchOutputTimeToInput(normalizedEnd, settings) * inputLength;
    const sourceLength = Math.max(1, Math.round(sourceEnd - sourceStart));
    let grain: Float32Array[] = readSourceGrain(channels, sourceStart, sourceEnd, sourceLength);
    const pitchRatio = slidingStretchPitchRatioAt(
      (normalizedStart + normalizedEnd) / 2,
      settings,
    );
    const pitchPercent = 100 * (pitchRatio - 1);
    if (Math.abs(pitchPercent) > 1e-12) {
      grain = processChangePitchChannels(grain, { percentChange: pitchPercent }, sampleRate);
    }
    const localRate = sourceLength / grainLength;
    if (Math.abs(localRate - 1) > 1e-6) {
      grain = timeStretchChannelsJs(grain, localRate, sampleRate);
    }
    grain = fitChannels(grain, grainLength);
    grain.forEach((channel, channelIndex) => {
      output[channelIndex].set(channel, outputStart);
    });
    outputStart = outputEnd;
  }
  return output;
}

/**
 * Render a selected range without mutating the source channels. Constant settings
 * use one shared WSOLA pass; variable settings use the official linear-output-rate
 * source map and a deterministic grain fallback for independent tempo/pitch slides.
 */
export function processSlidingStretchChannels(
  channels: readonly Float32Array[],
  settings: SlidingStretchSettings,
  sampleRate: number,
): Float32Array[] {
  validateSlidingStretchSettings(settings);
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new RangeError('采样率必须大于零');
  }
  const inputLength = validateChannels(channels);
  const outputLength = slidingStretchOutputLength(inputLength, settings);
  const totalOutput = outputLength * channels.length;
  if (
    !Number.isSafeInteger(totalOutput)
    || totalOutput > MAX_SLIDING_STRETCH_TOTAL_OUTPUT_SAMPLES
  ) {
    throw new RangeError('Sliding Stretch 输出超过浏览器内存上限，请缩短选区或减少声道');
  }
  if (isSlidingStretchBypassed(settings)) return channels.map((channel) => channel.slice());

  const constantTempo = settings.initialTempoPercent === settings.finalTempoPercent;
  const constantPitch = settings.initialPitchPercent === settings.finalPitchPercent;
  const output = constantTempo && constantPitch
    ? renderConstant(channels, settings, sampleRate, outputLength)
    : renderVariableGrains(channels, settings, sampleRate, outputLength);
  if (output.length !== channels.length || output.some((channel) => channel.length !== outputLength)) {
    throw new Error('Sliding Stretch 输出声道或长度不符合线性输出速率映射');
  }
  assertFiniteOutput(output);
  return output;
}
