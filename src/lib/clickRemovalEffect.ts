import type { GeneratorSelection } from '@/lib/generatorEditing';
import type { IClip, ITrack } from '@/types/project';

/**
 * Audacity 4.0.2 ClickRemovalEffect.
 *
 * A click is a narrow region whose mean-square amplitude is sufficiently
 * above its surrounding 2048-sample window. Every 4096-sample step processes
 * an 8192-sample, zero-padded window. Detected spikes are linearly replaced.
 * Float32 rounding is explicit so browser output can be compared with C++.
 */

export const CLICK_REMOVAL_WINDOW_SIZE = 8192;
export const CLICK_REMOVAL_MIN_SELECTION_SAMPLES = 4096;
export const CLICK_REMOVAL_INEFFECTIVE_ERROR =
  'Algorithm not effective on this audio. Nothing changed.';

export interface ClickRemovalSettings {
  threshold: number;
  width: number;
}

export const DEFAULT_CLICK_REMOVAL_SETTINGS: Readonly<ClickRemovalSettings> = Object.freeze({
  threshold: 200,
  width: 20,
});

export interface ClickRemovalClipInput {
  clipId: string;
  sampleData: Float32Array[];
  sourceOffset: number;
}

export interface ClickRemovalTrackInput {
  trackId: string;
  clips: ClickRemovalClipInput[];
}

export interface ClickRemovalProcessResult {
  sampleData: Float32Array[];
  changed: boolean;
  changedSamples: number;
}

export interface ClickRemovalClipResult {
  clipId: string;
  sampleData: Float32Array[];
}

export interface ClickRemovalTrackResult extends ClickRemovalProcessResult {
  selectionChannels: Float32Array[];
  clips: ClickRemovalClipResult[];
}

function fround(value: number): number {
  return Math.fround(value);
}

export function validateClickRemovalSettings(settings: ClickRemovalSettings): void {
  if (!Number.isInteger(settings.threshold) || settings.threshold < 0 || settings.threshold > 900) {
    throw new RangeError('Threshold 必须是 0–900 的整数');
  }
  if (!Number.isInteger(settings.width) || settings.width < 0 || settings.width > 40) {
    throw new RangeError('Max spike width 必须是 0–40 的整数');
  }
}

export function isClickRemovalBypassed(settings: ClickRemovalSettings): boolean {
  return settings.threshold === 0 || settings.width === 0;
}

function processWindow(
  input: Float32Array,
  settings: ClickRemovalSettings,
): { samples: Float32Array; changed: boolean; changedSamples: number } {
  if (input.length !== CLICK_REMOVAL_WINDOW_SIZE) {
    throw new RangeError(`Click Removal 内部窗口必须为 ${CLICK_REMOVAL_WINDOW_SIZE} 个采样`);
  }
  const buffer = new Float32Array(input);
  const b2 = new Float32Array(buffer.length);
  const msSequence = new Float32Array(buffer.length);
  for (let index = 0; index < buffer.length; index += 1) {
    b2[index] = fround(buffer[index] * buffer[index]);
    msSequence[index] = b2[index];
  }

  // Official sep starts at 2049 and is truncated to 2048 after this cascade.
  let sep = 2049;
  const s2 = Math.floor(sep / 2);
  let power = 1;
  for (; power < sep; power *= 2) {
    for (let index = 0; index < buffer.length - power; index += 1) {
      msSequence[index] = fround(msSequence[index] + msSequence[index + power]);
    }
  }
  sep = power;
  for (let index = 0; index < buffer.length - sep; index += 1) {
    msSequence[index] = fround(msSequence[index] / sep);
  }

  let changed = false;
  let changedSamples = 0;
  let left = 0;
  for (let wrc = Math.floor(settings.width / 4); wrc >= 1; wrc = Math.floor(wrc / 2)) {
    const ww = Math.floor(settings.width / wrc);
    for (let index = 0; index < buffer.length - sep; index += 1) {
      let msw = 0;
      for (let offset = 0; offset < ww; offset += 1) {
        msw = fround(msw + b2[index + s2 + offset]);
      }
      msw = fround(msw / ww);
      const threshold = fround(fround(settings.threshold * msSequence[index]) / 10);
      if (msw >= threshold) {
        if (left === 0) left = index + s2;
      } else if (left !== 0 && (index - left + s2) <= ww * 2) {
        const right = index + ww + s2;
        const leftValue = buffer[left];
        const rightValue = buffer[right];
        for (let position = left; position < right; position += 1) {
          const numerator = fround(
            fround(rightValue * (position - left))
            + fround(leftValue * (right - position)),
          );
          const value = fround(numerator / (right - left));
          buffer[position] = value;
          b2[position] = fround(value * value);
          changed = true;
          changedSamples += 1;
        }
        left = 0;
      } else if (left !== 0) {
        left = 0;
      }
    }
  }
  return { samples: buffer, changed, changedSamples };
}

/** Process whole channel selections without mutating any source channel. */
export function processClickRemovalChannels(
  channels: readonly Float32Array[],
  settings: ClickRemovalSettings,
): ClickRemovalProcessResult {
  validateClickRemovalSettings(settings);
  const length = channels[0]?.length ?? 0;
  if (channels.length === 0 || channels.some((channel) => channel.length !== length)) {
    throw new RangeError('Click Removal 输入声道必须非空且等长');
  }
  const sampleData = channels.map((channel) => new Float32Array(channel));
  if (isClickRemovalBypassed(settings)) return { sampleData, changed: false, changedSamples: 0 };
  if (length <= CLICK_REMOVAL_MIN_SELECTION_SAMPLES) {
    throw new RangeError('Selection must be larger than 4096 samples.');
  }
  for (const channel of channels) {
    for (let index = 0; index < channel.length; index += 1) {
      if (!Number.isFinite(channel[index])) {
        throw new RangeError(`Click Removal 输入在第 ${index} 个采样包含非有限值`);
      }
    }
  }

  let changed = false;
  let changedSamples = 0;
  for (let channelIndex = 0; channelIndex < channels.length; channelIndex += 1) {
    const source = channels[channelIndex];
    const output = sampleData[channelIndex];
    for (let offset = 0; offset + CLICK_REMOVAL_MIN_SELECTION_SAMPLES < length;) {
      const copyLength = Math.min(CLICK_REMOVAL_WINDOW_SIZE, length - offset);
      const window = new Float32Array(CLICK_REMOVAL_WINDOW_SIZE);
      window.set(source.subarray(offset, offset + copyLength));
      const processed = processWindow(window, settings);
      output.set(processed.samples.subarray(0, copyLength), offset);
      changed ||= processed.changed;
      changedSamples += processed.changedSamples;
      offset += CLICK_REMOVAL_MIN_SELECTION_SAMPLES;
    }
  }
  return { sampleData, changed, changedSamples };
}

/**
 * Assemble one complete track selection in timeline order, retaining silence
 * in gaps, then map the processed samples back to every selected source clip.
 * This function performs no I/O and is shared by preview and atomic apply.
 */
export function processClickRemovalTrack(
  track: ITrack,
  target: ClickRemovalTrackInput,
  selection: GeneratorSelection,
  settings: ClickRemovalSettings,
  sampleRate: number,
): ClickRemovalTrackResult {
  validateClickRemovalSettings(settings);
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new RangeError('Click Removal 采样率必须是大于零的有限数值');
  }
  if (
    !Number.isFinite(selection.start) || !Number.isFinite(selection.end)
    || selection.start < 0 || selection.end <= selection.start
  ) {
    throw new RangeError('Click Removal 需要有效的正时长选区');
  }
  if (track.id !== target.trackId || track.clips.length === 0) {
    throw new Error('Click Removal 目标轨道不可用');
  }

  const inputs = new Map<string, ClickRemovalClipInput>();
  for (const input of target.clips) {
    if (inputs.has(input.clipId) || !track.clips.some(({ id }) => id === input.clipId)) {
      throw new Error('Click Removal 目标片段不可用');
    }
    inputs.set(input.clipId, input);
  }
  if (inputs.size !== track.clips.length || track.clips.some(({ id }) => !inputs.has(id))) {
    throw new Error('Click Removal 需要完整轨道音频以保持选区连续');
  }

  const ordered = [...track.clips].sort((left, right) => left.startTime - right.startTime);
  const channelCount = inputs.get(ordered[0].id)?.sampleData.length ?? 0;
  if (channelCount === 0) throw new Error('Click Removal 音频没有可用声道');
  for (const clip of ordered) {
    const input = inputs.get(clip.id)!;
    if (!Number.isFinite(input.sourceOffset) || input.sourceOffset < 0) {
      throw new Error('Click Removal 片段源偏移无效');
    }
    if (
      input.sampleData.length !== channelCount
      || input.sampleData.some((channel) => channel.length !== input.sampleData[0]?.length)
    ) {
      throw new Error('Click Removal 轨道的片段声道布局不一致');
    }
  }

  const trackStart = Math.min(...ordered.map(({ startTime }) => startTime));
  const trackEnd = Math.max(...ordered.map((clip) => clip.startTime + clip.duration));
  const selectedStart = Math.round(Math.max(trackStart, selection.start) * sampleRate);
  const selectedEnd = Math.round(Math.min(trackEnd, selection.end) * sampleRate);
  const selectedLength = selectedEnd - selectedStart;
  if (selectedLength <= 0) throw new Error('Click Removal 选区与轨道没有有效重叠');
  if (!isClickRemovalBypassed(settings) && selectedLength <= CLICK_REMOVAL_MIN_SELECTION_SAMPLES) {
    throw new RangeError('Selection must be larger than 4096 samples.');
  }

  const selectedChannels = Array.from(
    { length: channelCount },
    () => new Float32Array(selectedLength),
  );
  const affected: Array<{
    clip: IClip;
    input: ClickRemovalClipInput;
    clipStart: number;
    sourceStart: number;
    overlapStart: number;
    overlapEnd: number;
  }> = [];

  for (const clip of ordered) {
    const input = inputs.get(clip.id)!;
    const clipStart = Math.round(clip.startTime * sampleRate);
    const clipEnd = Math.round((clip.startTime + clip.duration) * sampleRate);
    const sourceStart = Math.round(input.sourceOffset * sampleRate);
    const overlapStart = Math.max(selectedStart, clipStart);
    const overlapEnd = Math.min(selectedEnd, clipEnd);
    if (overlapEnd <= overlapStart) continue;

    for (let position = overlapStart; position < overlapEnd; position += 1) {
      const sourceIndex = sourceStart + position - clipStart;
      if (sourceIndex < 0 || sourceIndex >= input.sampleData[0].length) continue;
      for (let channel = 0; channel < channelCount; channel += 1) {
        selectedChannels[channel][position - selectedStart] = input.sampleData[channel][sourceIndex];
      }
    }
    affected.push({ clip, input, clipStart, sourceStart, overlapStart, overlapEnd });
  }
  if (affected.length === 0) throw new Error('Click Removal 选区内没有可处理的片段');

  const processed = processClickRemovalChannels(selectedChannels, settings);
  const clips = affected.map(({ clip, input, clipStart, sourceStart, overlapStart, overlapEnd }) => {
    const sampleData = input.sampleData.map((channel) => new Float32Array(channel));
    for (let position = overlapStart; position < overlapEnd; position += 1) {
      const sourceIndex = sourceStart + position - clipStart;
      if (sourceIndex < 0 || sourceIndex >= sampleData[0].length) continue;
      for (let channel = 0; channel < channelCount; channel += 1) {
        sampleData[channel][sourceIndex] = processed.sampleData[channel][position - selectedStart];
      }
    }
    return { clipId: clip.id, sampleData };
  });

  return {
    ...processed,
    selectionChannels: processed.sampleData,
    clips,
  };
}
