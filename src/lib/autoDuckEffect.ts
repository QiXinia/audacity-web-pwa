// Audacity 4.0.2 AutoDuckBase: control-track RMS regions and exponential fades.
import { getClipSampleRange, type GeneratorSelection } from '@/lib/generatorEditing';

export const AUTO_DUCK_RMS_WINDOW_SIZE = 100;
export const MAX_AUTO_DUCK_TOTAL_SAMPLES = 20_000_000;

export interface AutoDuckSettings {
  duckAmountDb: number;
  maximumPause: number;
  outerFadeDownLen: number;
  outerFadeUpLen: number;
  innerFadeDownLen: number;
  innerFadeUpLen: number;
  thresholdDb: number;
}

export const DEFAULT_AUTO_DUCK_SETTINGS: Readonly<AutoDuckSettings> = Object.freeze({
  duckAmountDb: -12,
  maximumPause: 1,
  outerFadeDownLen: 0.5,
  outerFadeUpLen: 0.5,
  innerFadeDownLen: 0,
  innerFadeUpLen: 0,
  thresholdDb: -30,
});

export interface AutoDuckRegion {
  startSample: number;
  endSample: number;
}

export interface AutoDuckTimelineClip {
  startTime: number;
  duration: number;
  sourceOffset: number;
  sampleData: Float32Array[];
}

export interface AutoDuckTimelinePlacement {
  startSample: number;
  endSample: number;
  timelineSample: number;
}

function validateSampleRate(sampleRate: number): void {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new RangeError('Auto Duck 采样率必须是正有限数值');
  }
}

function secondsToSamples(seconds: number, sampleRate: number): number {
  const samples = Math.round(seconds * sampleRate);
  if (!Number.isSafeInteger(samples) || samples < 0) {
    throw new RangeError('Auto Duck 时间参数超出采样范围');
  }
  return samples;
}

function validateChannels(channels: readonly Float32Array[]): void {
  if (channels.length === 0) throw new RangeError('Auto Duck 至少需要一个音频声道');
  const length = channels[0].length;
  for (const channel of channels) {
    if (channel.length !== length) throw new RangeError('Auto Duck 输入声道必须等长');
    for (let index = 0; index < channel.length; index += 1) {
      if (!Number.isFinite(channel[index])) {
        throw new RangeError(`Auto Duck 输入在第 ${index} 个采样包含非有限数值`);
      }
    }
  }
}

export function validateAutoDuckSettings(settings: AutoDuckSettings): void {
  const fields: Array<[keyof AutoDuckSettings, number, number, string]> = [
    ['duckAmountDb', -24, 0, '压降量'],
    ['maximumPause', 0, Number.MAX_VALUE, '最大暂停'],
    ['outerFadeDownLen', 0, 3, '外部淡出时长'],
    ['outerFadeUpLen', 0, 3, '外部淡入时长'],
    ['innerFadeDownLen', 0, 3, '内部淡出时长'],
    ['innerFadeUpLen', 0, 3, '内部淡入时长'],
    ['thresholdDb', -100, 0, '阈值'],
  ];
  for (const [key, min, max, label] of fields) {
    const value = settings[key];
    if (!Number.isFinite(value) || value < min || value > max) {
      throw new RangeError(`Auto Duck ${label}必须是 ${min} 至 ${max} 之间的有限数值`);
    }
  }
}

export function getAutoDuckTimelinePlacement(
  clip: Pick<AutoDuckTimelineClip, 'startTime' | 'duration'>,
  selection: GeneratorSelection,
  sourceOffset: number,
  sampleRate: number,
  channelLength: number,
): AutoDuckTimelinePlacement | null {
  const range = getClipSampleRange(clip, selection, sourceOffset, sampleRate, channelLength);
  if (!range) return null;
  const selectionStartSample = Math.round(selection.start * sampleRate);
  const overlapStart = Math.max(clip.startTime, selection.start);
  const timelineSample = Math.round(overlapStart * sampleRate) - selectionStartSample;
  return { ...range, timelineSample };
}

/** Render the selected track timeline. Empty track gaps are silent, as in Audacity. */
export function renderAutoDuckSelectionChannels(
  clips: readonly AutoDuckTimelineClip[],
  selection: GeneratorSelection,
  sampleRate: number,
): Float32Array[] {
  validateSampleRate(sampleRate);
  if (
    !Number.isFinite(selection.start)
    || !Number.isFinite(selection.end)
    || selection.start < 0
    || selection.end <= selection.start
  ) throw new RangeError('Auto Duck 选区必须是有限的正时长区间');
  if (clips.length === 0) throw new RangeError('Auto Duck 控制轨在选区内没有音频');

  const startSample = Math.round(selection.start * sampleRate);
  const endSample = Math.round(selection.end * sampleRate);
  const timelineLength = endSample - startSample;
  if (timelineLength <= 0 || !Number.isSafeInteger(timelineLength)) {
    throw new RangeError('Auto Duck 选区采样数无效');
  }
  const channelCount = clips[0].sampleData.length;
  if (channelCount === 0) throw new RangeError('Auto Duck 轨道没有音频声道');
  if (timelineLength * channelCount > MAX_AUTO_DUCK_TOTAL_SAMPLES) {
    throw new RangeError('Auto Duck 选区超过 2000 万采样上限，请缩短选区');
  }
  const rendered = Array.from({ length: channelCount }, () => new Float32Array(timelineLength));

  for (const clip of [...clips].sort((left, right) => left.startTime - right.startTime)) {
    if (clip.sampleData.length !== channelCount) {
      throw new RangeError('Auto Duck 轨道的选区声道数不一致');
    }
    const channelLength = clip.sampleData[0]?.length ?? 0;
    for (const channel of clip.sampleData) {
      if (channel.length !== channelLength) throw new RangeError('Auto Duck 输入声道必须等长');
    }
    const placement = getAutoDuckTimelinePlacement(
      clip,
      selection,
      clip.sourceOffset,
      sampleRate,
      channelLength,
    );
    if (!placement) continue;
    const length = placement.endSample - placement.startSample;
    if (
      placement.timelineSample < 0
      || placement.timelineSample + length > timelineLength
    ) throw new RangeError('Auto Duck 片段采样映射超出选区');
    rendered.forEach((channel, channelIndex) => {
      channel.set(
        clip.sampleData[channelIndex].subarray(placement.startSample, placement.endSample),
        placement.timelineSample,
      );
    });
  }
  return rendered;
}

/** Find duck regions using Audacity's first-control-channel 100-sample RMS window. */
export function createAutoDuckPlan(
  control: Float32Array,
  settings: AutoDuckSettings,
  sampleRate: number,
): AutoDuckRegion[] {
  validateAutoDuckSettings(settings);
  validateSampleRate(sampleRate);
  if (control.length === 0) return [];

  const outerFadeDownSamples = secondsToSamples(settings.outerFadeDownLen, sampleRate);
  const outerFadeUpSamples = secondsToSamples(settings.outerFadeUpLen, sampleRate);
  const start = outerFadeDownSamples;
  const end = control.length - outerFadeUpSamples;
  if (end <= start) return [];

  const maximumPause = Math.max(
    settings.maximumPause,
    settings.outerFadeDownLen + settings.outerFadeUpLen,
  );
  const minimumPauseSamples = secondsToSamples(maximumPause, sampleRate);
  const linearThreshold = 10 ** (settings.thresholdDb / 20);
  const threshold = linearThreshold * linearThreshold * AUTO_DUCK_RMS_WINDOW_SIZE;
  const rmsWindow = new Float64Array(AUTO_DUCK_RMS_WINDOW_SIZE);
  const regions: AutoDuckRegion[] = [];
  let rmsPosition = 0;
  let rmsSum = 0;
  let pauseSamples = 0;
  let duckRegionStart = 0;
  let inDuckRegion = false;

  for (let index = start; index < end; index += 1) {
    const sample = control[index];
    if (!Number.isFinite(sample)) {
      throw new RangeError(`Auto Duck 控制轨在第 ${index} 个采样包含非有限数值`);
    }
    rmsSum -= rmsWindow[rmsPosition];
    rmsWindow[rmsPosition] = sample * sample;
    rmsSum += rmsWindow[rmsPosition];
    rmsPosition = (rmsPosition + 1) % AUTO_DUCK_RMS_WINDOW_SIZE;
    const thresholdExceeded = rmsSum > threshold;
    if (thresholdExceeded) {
      pauseSamples = 0;
      if (!inDuckRegion) {
        inDuckRegion = true;
        duckRegionStart = index;
      }
    } else if (inDuckRegion) {
      pauseSamples += 1;
      if (pauseSamples >= minimumPauseSamples) {
        const duckRegionEnd = index - pauseSamples;
        regions.push({
          startSample: Math.max(0, duckRegionStart - outerFadeDownSamples),
          endSample: Math.min(control.length, duckRegionEnd + outerFadeUpSamples),
        });
        inDuckRegion = false;
      }
    }
  }

  if (inDuckRegion) {
    const duckRegionEnd = end - pauseSamples;
    regions.push({
      startSample: Math.max(0, duckRegionStart - outerFadeDownSamples),
      endSample: Math.min(control.length, duckRegionEnd + outerFadeUpSamples),
    });
  }
  return regions.filter((region) => region.endSample > region.startSample);
}

/** Apply a shared control plan to every target channel without changing timeline geometry. */
export function applyAutoDuckPlanToChannels(
  channels: readonly Float32Array[],
  regions: readonly AutoDuckRegion[],
  settings: AutoDuckSettings,
  sampleRate: number,
  sampleOffset = 0,
): Float32Array[] {
  validateAutoDuckSettings(settings);
  validateSampleRate(sampleRate);
  validateChannels(channels);
  if (!Number.isSafeInteger(sampleOffset) || sampleOffset < 0) {
    throw new RangeError('Auto Duck 采样偏移必须是非负安全整数');
  }
  const fadeDownSamples = Math.max(1, secondsToSamples(
    settings.outerFadeDownLen + settings.innerFadeDownLen,
    sampleRate,
  ));
  const fadeUpSamples = Math.max(1, secondsToSamples(
    settings.outerFadeUpLen + settings.innerFadeUpLen,
    sampleRate,
  ));
  const fadeDownStep = settings.duckAmountDb / fadeDownSamples;
  const fadeUpStep = settings.duckAmountDb / fadeUpSamples;
  const output = channels.map((channel) => new Float32Array(channel));
  let previousEnd = 0;

  for (const region of regions) {
    if (
      !Number.isSafeInteger(region.startSample)
      || !Number.isSafeInteger(region.endSample)
      || region.startSample < 0
      || region.endSample <= region.startSample
      || region.startSample < previousEnd
    ) throw new RangeError('Auto Duck 压降区域必须有序且互不重叠');
    previousEnd = region.endSample;
    const absoluteStart = Math.max(region.startSample, sampleOffset);
    const absoluteEnd = Math.min(region.endSample, sampleOffset + output[0].length);
    for (let absoluteSample = absoluteStart; absoluteSample < absoluteEnd; absoluteSample += 1) {
      const gainDown = fadeDownStep * (absoluteSample - region.startSample);
      const gainUp = fadeUpStep * (region.endSample - absoluteSample);
      const gain = Math.max(settings.duckAmountDb, Math.max(gainDown, gainUp));
      const multiplier = 10 ** (gain / 20);
      const localSample = absoluteSample - sampleOffset;
      output.forEach((channel, channelIndex) => {
        const source = channels[channelIndex][localSample];
        if (!Number.isFinite(source)) {
          throw new RangeError(`Auto Duck 输入在第 ${localSample} 个采样包含非有限数值`);
        }
        const value = source * multiplier;
        if (!Number.isFinite(value)) {
          throw new RangeError(`Auto Duck 在第 ${localSample} 个采样产生非有限输出`);
        }
        channel[localSample] = value;
      });
    }
  }
  return output;
}

export function processAutoDuckChannels(
  channels: readonly Float32Array[],
  control: Float32Array,
  settings: AutoDuckSettings,
  sampleRate: number,
): Float32Array[] {
  validateChannels(channels);
  if (control.length !== channels[0].length) {
    throw new RangeError('Auto Duck 控制轨与目标轨选区必须等长');
  }
  const plan = createAutoDuckPlan(control, settings, sampleRate);
  return applyAutoDuckPlanToChannels(channels, plan, settings, sampleRate);
}
