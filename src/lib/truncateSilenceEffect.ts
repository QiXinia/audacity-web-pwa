import type { GeneratorSelection } from '@/lib/generatorEditing';
import type { ITrack } from '@/types/project';

/** Audacity 4.0.2 TruncSilenceBase semantics. */
export const TRUNCATE_SILENCE_BLEND_FRAMES = 100;
export const TRUNCATE_SILENCE_MIN_SECONDS = 0.001;
export const MAX_TRUNCATE_SILENCE_TOTAL_SAMPLES = 20_000_000;

export type TruncateSilenceAction = 'truncate' | 'compress';

export interface TruncateSilenceSettings {
  thresholdDb: number;
  minimumDuration: number;
  action: TruncateSilenceAction;
  truncateDuration: number;
  compressPercent: number;
  independent: boolean;
}

export const DEFAULT_TRUNCATE_SILENCE_SETTINGS: Readonly<TruncateSilenceSettings> = Object.freeze({
  thresholdDb: -20,
  minimumDuration: 0.5,
  action: 'truncate',
  truncateDuration: 0.5,
  compressPercent: 50,
  independent: false,
});

export interface TruncateSilenceClipInput {
  clipId: string;
  sampleData: Float32Array[];
  /** Effective source offset after the clip's stretch mapping. */
  sourceOffset: number;
}

export interface TruncateSilenceTrackInput {
  trackId: string;
  clips: TruncateSilenceClipInput[];
}

export interface SilenceRegion {
  startSample: number;
  endSample: number;
}

export interface SilenceCut extends SilenceRegion {
  regionStartSample: number;
  regionEndSample: number;
}

export interface TruncateSilenceTrackResult {
  trackId: string;
  editStart: number;
  originalEditDuration: number;
  sampleData: Float32Array[];
  cutSamples: number;
  changed: boolean;
  silenceRegions: SilenceRegion[];
  cuts: SilenceCut[];
}

export interface TruncateSilenceProcessResult {
  tracks: TruncateSilenceTrackResult[];
  selectionEnd: number;
  silenceRegions: SilenceRegion[];
  cutSamples: number;
}

interface PreparedTrack {
  trackId: string;
  editStartSample: number;
  editEndSample: number;
  channels: Float32Array[];
  silenceRegions: SilenceRegion[];
}

function validateFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) throw new RangeError(`${label}必须是有限数值`);
}

export function validateTruncateSilenceSettings(settings: TruncateSilenceSettings): void {
  validateFinite(settings.thresholdDb, 'Threshold');
  if (settings.thresholdDb < -80 || settings.thresholdDb > -20) {
    throw new RangeError('Threshold 必须在 -80–-20 dB 之间');
  }
  validateFinite(settings.minimumDuration, 'Duration');
  if (settings.minimumDuration < 0.001 || settings.minimumDuration > 10000) {
    throw new RangeError('Duration 必须在 0.001–10000 秒之间');
  }
  if (settings.action !== 'truncate' && settings.action !== 'compress') {
    throw new RangeError('Truncate Silence 动作无效');
  }
  validateFinite(settings.truncateDuration, 'Truncate to');
  if (settings.truncateDuration < 0 || settings.truncateDuration > 10000) {
    throw new RangeError('Truncate to 必须在 0–10000 秒之间');
  }
  validateFinite(settings.compressPercent, 'Compress to');
  if (settings.compressPercent < 0 || settings.compressPercent > 99.9) {
    throw new RangeError('Compress to 必须在 0–99.9% 之间');
  }
  if (typeof settings.independent !== 'boolean') {
    throw new RangeError('轨道独立处理开关无效');
  }
}

function validateSampleRate(sampleRate: number): void {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new RangeError('Truncate Silence 采样率必须是大于零的有限数值');
  }
}

/** Strictly below threshold in every channel, matching std::all_of + fabs <. */
export function detectSilenceRegions(
  channels: readonly Float32Array[],
  settings: TruncateSilenceSettings,
  sampleRate: number,
  startSample = 0,
  endSample = channels[0]?.length ?? 0,
  timelineOffset = 0,
): SilenceRegion[] {
  validateTruncateSilenceSettings(settings);
  validateSampleRate(sampleRate);
  if (channels.length === 0) throw new RangeError('Truncate Silence 输入至少需要一个声道');
  const length = channels[0]?.length ?? 0;
  if (channels.some((channel) => channel.length !== length)) {
    throw new RangeError('Truncate Silence 输入声道必须等长');
  }
  if (
    !Number.isSafeInteger(startSample) || !Number.isSafeInteger(endSample)
    || !Number.isSafeInteger(timelineOffset)
    || startSample < 0 || endSample < startSample || endSample > length
  ) {
    throw new RangeError('Truncate Silence 检测范围无效');
  }
  const threshold = 10 ** (settings.thresholdDb / 20);
  const minimumFrames = Math.max(
    1,
    Math.round(Math.max(settings.minimumDuration, TRUNCATE_SILENCE_MIN_SECONDS) * sampleRate),
  );
  const regions: SilenceRegion[] = [];
  let silentStart = -1;
  for (let position = startSample; position < endSample; position += 1) {
    let silent = true;
    for (const channel of channels) {
      const value = channel[position];
      if (!Number.isFinite(value)) {
        throw new RangeError(`Truncate Silence 输入在第 ${position} 个采样包含非有限值`);
      }
      if (Math.abs(value) >= threshold) {
        silent = false;
        break;
      }
    }
    if (silent) {
      if (silentStart < 0) silentStart = position;
    } else if (silentStart >= 0) {
      if (position - silentStart >= minimumFrames) {
        regions.push({
          startSample: silentStart + timelineOffset,
          endSample: position + timelineOffset,
        });
      }
      silentStart = -1;
    }
  }
  if (silentStart >= 0 && endSample - silentStart >= minimumFrames) {
    regions.push({
      startSample: silentStart + timelineOffset,
      endSample: endSample + timelineOffset,
    });
  }
  return regions;
}

export function intersectSilenceRegions(
  left: readonly SilenceRegion[],
  right: readonly SilenceRegion[],
): SilenceRegion[] {
  const result: SilenceRegion[] = [];
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    const startSample = Math.max(left[leftIndex].startSample, right[rightIndex].startSample);
    const endSample = Math.min(left[leftIndex].endSample, right[rightIndex].endSample);
    if (endSample > startSample) result.push({ startSample, endSample });
    if (left[leftIndex].endSample < right[rightIndex].endSample) leftIndex += 1;
    else rightIndex += 1;
  }
  return result;
}

function snapToSample(seconds: number, sampleRate: number): number {
  const sample = Math.round(seconds * sampleRate);
  if (!Number.isSafeInteger(sample)) throw new RangeError('Truncate Silence 剪切位置超出安全范围');
  return sample;
}

/** Compute centered cuts before touching PCM; reverse application keeps positions stable. */
export function createSilenceCuts(
  regions: readonly SilenceRegion[],
  settings: TruncateSilenceSettings,
  sampleRate: number,
): SilenceCut[] {
  validateTruncateSilenceSettings(settings);
  validateSampleRate(sampleRate);
  const cuts: SilenceCut[] = [];
  for (const region of regions) {
    if (
      !Number.isSafeInteger(region.startSample) || !Number.isSafeInteger(region.endSample)
      || region.startSample < 0 || region.endSample <= region.startSample
    ) throw new RangeError('Truncate Silence 静音区域无效');
    const start = region.startSample / sampleRate;
    const end = region.endSample / sampleRate;
    const inLength = end - start;
    // Audacity permits one nanosecond after intersecting independently detected regions.
    if (inLength < settings.minimumDuration - 0.000000001) continue;
    const outLength = settings.action === 'truncate'
      ? Math.min(settings.truncateDuration, inLength)
      : settings.minimumDuration
        + (inLength - settings.minimumDuration) * settings.compressPercent / 100;
    const cutLength = Math.max(0, inLength - outLength);
    if (cutLength === 0) continue;
    const cutStart = snapToSample((start + end - cutLength) / 2, sampleRate);
    const cutEnd = snapToSample((start + end - cutLength) / 2 + cutLength, sampleRate);
    if (cutEnd <= cutStart) continue;
    cuts.push({
      startSample: cutStart,
      endSample: cutEnd,
      regionStartSample: region.startSample,
      regionEndSample: region.endSample,
    });
  }
  return cuts;
}

function sampleAt(channel: Float32Array, index: number): number {
  return index >= 0 && index < channel.length ? channel[index] : 0;
}

/** Apply one already snapped cut with Audacity's 100-frame cross-fade. */
function cutChannels(
  channels: readonly Float32Array[],
  cut: SilenceCut,
  editStartSample: number,
): { channels: Float32Array[]; cutSamples: number } {
  const currentLength = channels[0]?.length ?? 0;
  const start = Math.max(0, Math.min(currentLength, cut.startSample - editStartSample));
  const end = Math.max(0, Math.min(currentLength, cut.endSample - editStartSample));
  if (end <= start) return { channels: channels.map((channel) => new Float32Array(channel)), cutSamples: 0 };
  const blendFrames = Math.min(
    TRUNCATE_SILENCE_BLEND_FRAMES,
    cut.regionEndSample - cut.regionStartSample,
  );
  const blendOffset = Math.floor(blendFrames / 2);
  const beforeStart = start - blendOffset;
  const afterStart = end - blendOffset;
  const cutSamples = end - start;

  return {
    cutSamples,
    channels: channels.map((channel) => {
      const before = new Float32Array(blendFrames);
      const after = new Float32Array(blendFrames);
      for (let index = 0; index < blendFrames; index += 1) {
        before[index] = sampleAt(channel, beforeStart + index);
        after[index] = sampleAt(channel, afterStart + index);
      }
      const output = new Float32Array(currentLength - cutSamples);
      output.set(channel.subarray(0, start), 0);
      output.set(channel.subarray(end), start);
      for (let index = 0; index < blendFrames; index += 1) {
        const destination = beforeStart + index;
        if (destination < 0 || destination >= output.length) continue;
        const numerator = Math.fround(
          Math.fround((blendFrames - index) * before[index])
          + Math.fround(index * after[index]),
        );
        output[destination] = numerator / blendFrames;
      }
      return output;
    }),
  };
}

function applyCuts(
  prepared: PreparedTrack,
  cuts: readonly SilenceCut[],
): TruncateSilenceTrackResult {
  let channels: Float32Array[] = prepared.channels.map((channel) => new Float32Array(channel));
  let cutSamples = 0;
  for (const cut of [...cuts].reverse()) {
    const next = cutChannels(channels, cut, prepared.editStartSample);
    channels = next.channels;
    cutSamples += next.cutSamples;
  }
  return {
    trackId: prepared.trackId,
    editStart: prepared.editStartSample / 1,
    originalEditDuration: (prepared.editEndSample - prepared.editStartSample) / 1,
    sampleData: channels,
    cutSamples,
    changed: cutSamples > 0,
    silenceRegions: prepared.silenceRegions,
    cuts: [...cuts],
  };
}

function prepareTrack(
  track: ITrack,
  target: TruncateSilenceTrackInput,
  selection: GeneratorSelection,
  settings: TruncateSilenceSettings,
  sampleRate: number,
): PreparedTrack {
  if (track.id !== target.trackId || track.clips.length === 0) {
    throw new Error('Truncate Silence 目标轨道不可用');
  }
  const inputs = new Map<string, TruncateSilenceClipInput>();
  for (const input of target.clips) {
    if (inputs.has(input.clipId) || !track.clips.some(({ id }) => id === input.clipId)) {
      throw new Error('Truncate Silence 目标片段不可用');
    }
    inputs.set(input.clipId, input);
  }
  if (inputs.size !== track.clips.length || track.clips.some(({ id }) => !inputs.has(id))) {
    throw new Error('Truncate Silence 需要完整轨道音频以保持选区连续');
  }
  const ordered = [...track.clips].sort((left, right) => left.startTime - right.startTime);
  const channelCount = inputs.get(ordered[0].id)?.sampleData.length ?? 0;
  if (channelCount === 0) throw new Error('Truncate Silence 音频没有可用声道');
  for (const clip of ordered) {
    const input = inputs.get(clip.id)!;
    if (!Number.isFinite(input.sourceOffset) || input.sourceOffset < 0) {
      throw new Error('Truncate Silence 片段源偏移无效');
    }
    if (
      input.sampleData.length !== channelCount
      || input.sampleData.some((channel) => channel.length !== input.sampleData[0]?.length)
    ) throw new Error('Truncate Silence 轨道的片段声道布局不一致');
  }

  const trackStart = Math.min(...ordered.map(({ startTime }) => startTime));
  const trackEnd = Math.max(...ordered.map((clip) => clip.startTime + clip.duration));
  const selectedStart = Math.max(trackStart, selection.start);
  const selectedEnd = Math.min(trackEnd, selection.end);
  const selectedStartSample = snapToSample(selectedStart, sampleRate);
  const selectedEndSample = snapToSample(selectedEnd, sampleRate);
  if (selectedEndSample <= selectedStartSample) {
    throw new Error('Truncate Silence 选区与轨道没有有效重叠');
  }

  // Include the exact context Audacity can read for its 100-frame splice blends.
  const contextSeconds = (TRUNCATE_SILENCE_BLEND_FRAMES / 2) / sampleRate;
  const editStartSample = snapToSample(Math.max(trackStart, selectedStart - contextSeconds), sampleRate);
  const editEndSample = snapToSample(Math.min(trackEnd, selectedEnd + contextSeconds), sampleRate);
  const channels = Array.from(
    { length: channelCount },
    () => new Float32Array(editEndSample - editStartSample),
  );
  for (const clip of ordered) {
    const input = inputs.get(clip.id)!;
    const clipStart = snapToSample(clip.startTime, sampleRate);
    const clipEnd = snapToSample(clip.startTime + clip.duration, sampleRate);
    const sourceStart = snapToSample(input.sourceOffset, sampleRate);
    const copyStart = Math.max(editStartSample, clipStart);
    const copyEnd = Math.min(editEndSample, clipEnd);
    for (let position = copyStart; position < copyEnd; position += 1) {
      const sourceIndex = sourceStart + position - clipStart;
      if (sourceIndex < 0 || sourceIndex >= input.sampleData[0].length) continue;
      for (let channel = 0; channel < channelCount; channel += 1) {
        channels[channel][position - editStartSample] = input.sampleData[channel][sourceIndex];
      }
    }
  }
  for (const channel of channels) {
    for (let index = 0; index < channel.length; index += 1) {
      if (!Number.isFinite(channel[index])) {
        throw new RangeError(`Truncate Silence 输入在第 ${editStartSample + index} 个采样包含非有限值`);
      }
    }
  }
  const silenceRegions = detectSilenceRegions(
    channels,
    settings,
    sampleRate,
    selectedStartSample - editStartSample,
    selectedEndSample - editStartSample,
    editStartSample,
  );
  return { trackId: track.id, editStartSample, editEndSample, channels, silenceRegions };
}

/**
 * Shared preview/apply pipeline. Linked tracks cut only common silence;
 * independent tracks receive separate plans and the longest resulting selection wins.
 */
export function processTruncateSilenceTracks(
  projectTracks: readonly ITrack[],
  targets: readonly TruncateSilenceTrackInput[],
  selection: GeneratorSelection,
  settings: TruncateSilenceSettings,
  sampleRate: number,
): TruncateSilenceProcessResult {
  validateTruncateSilenceSettings(settings);
  validateSampleRate(sampleRate);
  if (
    !Number.isFinite(selection.start) || !Number.isFinite(selection.end)
    || selection.start < 0 || selection.end <= selection.start
  ) throw new RangeError('Truncate Silence 需要有效的正时长选区');
  if (targets.length === 0) throw new Error('没有可应用 Truncate Silence 的音频选区');
  if (new Set(targets.map(({ trackId }) => trackId)).size !== targets.length) {
    throw new Error('Truncate Silence 目标包含重复轨道');
  }
  const inputSamples = targets.reduce((total, target) => total + target.clips.reduce(
    (clipTotal, clip) => clipTotal + clip.sampleData.reduce(
      (channelTotal, channel) => channelTotal + channel.length,
      0,
    ),
    0,
  ), 0);
  if (inputSamples > MAX_TRUNCATE_SILENCE_TOTAL_SAMPLES) {
    throw new RangeError(`Truncate Silence 单次最多读取 ${MAX_TRUNCATE_SILENCE_TOTAL_SAMPLES} 个声道采样`);
  }

  const prepared = targets.map((target) => {
    const track = projectTracks.find(({ id }) => id === target.trackId);
    if (!track) throw new Error(`Track not found: ${target.trackId}`);
    return prepareTrack(track, target, selection, settings, sampleRate);
  });
  let sharedRegions: SilenceRegion[] = [{
    startSample: snapToSample(selection.start, sampleRate),
    endSample: snapToSample(selection.end, sampleRate),
  }];
  if (!settings.independent) {
    for (const track of prepared) {
      sharedRegions = intersectSilenceRegions(sharedRegions, track.silenceRegions);
    }
  }

  const results = prepared.map((track) => {
    const regions = settings.independent ? track.silenceRegions : sharedRegions;
    const cuts = createSilenceCuts(regions, settings, sampleRate);
    return applyCuts(track, cuts);
  });
  const cutSamples = settings.independent
    ? Math.max(...results.map(({ cutSamples: trackCut }) => trackCut))
    : createSilenceCuts(sharedRegions, settings, sampleRate)
      .reduce((total, cut) => total + cut.endSample - cut.startSample, 0);
  const selectionEnd = settings.independent
    ? Math.max(...results.map((track) => selection.end - track.cutSamples / sampleRate))
    : selection.end - cutSamples / sampleRate;
  return {
    tracks: results.map((track) => ({
      ...track,
      editStart: track.editStart / sampleRate,
      originalEditDuration: track.originalEditDuration / sampleRate,
    })),
    selectionEnd: Math.max(selection.start, selectionEnd),
    silenceRegions: settings.independent ? results.flatMap(({ silenceRegions: regions }) => regions) : sharedRegions,
    cutSamples,
  };
}
