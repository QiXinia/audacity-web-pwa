import { getClipSampleRange, type GeneratorSelection } from '@/lib/generatorEditing';
import type { LabelSoundsTrack } from '@/lib/labelSounds';

// Audacity 4.0.2 share/nyquist-plug-ins/beat.ny controls and detector structure.
export interface BeatFinderSettings {
  thresholdPercentage: number;
}

export const DEFAULT_BEAT_FINDER_SETTINGS: Readonly<BeatFinderSettings> = Object.freeze({
  thresholdPercentage: 65,
});

export const MAX_BEAT_FINDER_TRACK_SAMPLES = 20_000_000;
export const MAX_BEAT_FINDER_LABELS = 10_000;
export type BeatFinderTrack = LabelSoundsTrack;

export interface DetectedBeatLabel {
  trackId: string;
  start: number;
  end: number;
  text: 'B';
}

export function validateBeatFinderSettings(settings: BeatFinderSettings): void {
  if (!Number.isInteger(settings.thresholdPercentage)
    || settings.thresholdPercentage < 5 || settings.thresholdPercentage > 100) {
    throw new RangeError('Threshold Percentage 必须是 5 到 100 之间的整数');
  }
}

function validateAnalysisInput(selection: GeneratorSelection, sampleRate: number): void {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new RangeError('Beat finder 采样率必须是正的有限数值');
  }
  if (!Number.isFinite(selection.start) || selection.start < 0) {
    throw new RangeError('Beat finder 选区起点必须是非负有限时间');
  }
  if (!Number.isFinite(selection.end) || selection.end <= selection.start) {
    throw new RangeError('Beat finder 需要有效的正长度时间选区');
  }
}

/** Official threshold state machine: strict upward crossing, re-arm only below threshold. */
export function detectBeatTimes(
  envelope: ArrayLike<number>,
  selectionStart: number,
  thresholdPercentage: number,
  controlRate = 1000,
): number[] {
  validateBeatFinderSettings({ thresholdPercentage });
  if (!Number.isFinite(selectionStart) || selectionStart < 0
    || !Number.isFinite(controlRate) || controlRate <= 0) {
    throw new RangeError('Beat finder 检测时间轴无效');
  }
  let peak = 0;
  for (let index = 0; index < envelope.length; index += 1) {
    if (!Number.isFinite(envelope[index])) throw new RangeError('Beat finder 包络包含非有限采样');
    peak = Math.max(peak, envelope[index]);
  }
  if (peak <= 0) return [];
  const threshold = peak * thresholdPercentage / 100;
  const times: number[] = [];
  let armed = true;
  for (let index = 0; index < envelope.length; index += 1) {
    const value = envelope[index];
    if (armed && value > threshold) {
      times.push(selectionStart + index / controlRate);
      if (times.length === MAX_BEAT_FINDER_LABELS) return times;
    }
    armed = value < threshold;
  }
  return times;
}

function lowPassOnePole(input: Float64Array, sampleRate: number, cutoffHz: number): Float64Array {
  const output = new Float64Array(input.length);
  const cutoff = Math.min(cutoffHz, sampleRate * 0.45);
  const alpha = 1 - Math.exp(-2 * Math.PI * cutoff / sampleRate);
  let previous = 0;
  for (let index = 0; index < input.length; index += 1) {
    previous += alpha * (input[index] - previous);
    output[index] = previous;
  }
  return output;
}

/**
 * Browser adaptation of snd-follow: a 512-sample lookahead peak envelope,
 * exponential 10 ms attack / 100 ms release and the official 0.001 floor.
 */
function createBeatControlEnvelope(bass: Float64Array, sampleRate: number): Float64Array {
  const length = bass.length;
  const lookahead = Math.min(512, length);
  const peaks = new Float64Array(length);
  const deque = new Int32Array(length);
  let head = 0;
  let tail = 0;
  for (let index = length - 1; index >= 0; index -= 1) {
    const value = Math.abs(bass[index]);
    while (tail > head && Math.abs(bass[deque[tail - 1]]) <= value) tail -= 1;
    deque[tail++] = index;
    const last = index + lookahead - 1;
    while (head < tail && deque[head] > last) head += 1;
    peaks[index] = Math.abs(bass[deque[head]]);
  }

  const attack = 1 - Math.exp(-1 / (0.01 * sampleRate));
  const release = 1 - Math.exp(-1 / (0.1 * sampleRate));
  const followed = new Float64Array(length);
  let envelope = 0.001;
  for (let index = 0; index < length; index += 1) {
    const target = Math.max(0.001, peaks[index]);
    envelope += (target > envelope ? attack : release) * (target - envelope);
    followed[index] = Math.max(0.001, envelope);
  }
  return lowPassOnePole(followed, sampleRate, 10);
}

function resampleControlRate(input: Float64Array, sampleRate: number): Float64Array {
  const length = Math.ceil(input.length * 1000 / sampleRate);
  const output = new Float64Array(length);
  for (let index = 0; index < length; index += 1) {
    const position = index * sampleRate / 1000;
    const left = Math.min(input.length - 1, Math.floor(position));
    const right = Math.min(input.length - 1, left + 1);
    const fraction = position - Math.floor(position);
    output[index] = input[left] + (input[right] - input[left]) * fraction;
  }
  return output;
}

/** Analyze a selection-local mono/stereo timeline and return selection-relative beat times. */
export function analyzeBeatFinderChannels(
  channels: readonly Float32Array[],
  selection: GeneratorSelection,
  sampleRate: number,
  settings: BeatFinderSettings,
): number[] {
  validateBeatFinderSettings(settings);
  validateAnalysisInput(selection, sampleRate);
  if (channels.length < 1 || channels.length > 2) {
    throw new RangeError('Beat finder 仅支持单声道或立体声轨道');
  }
  const length = Math.round((selection.end - selection.start) * sampleRate);
  if (!Number.isSafeInteger(length) || length < 1) throw new RangeError('Beat finder 选区采样数无效');
  if (channels.some((channel) => !(channel instanceof Float32Array) || channel.length !== length)) {
    throw new RangeError('Beat finder 声道必须为等长 Float32Array');
  }

  // Official mix-to-mono sums left and right rather than averaging them.
  const mono = new Float64Array(length);
  let rawPeak = 0;
  for (let index = 0; index < length; index += 1) {
    let mixed = 0;
    for (const channel of channels) {
      const value = channel[index];
      if (!Number.isFinite(value)) throw new RangeError('Beat finder 输入包含非有限采样');
      mixed += value;
    }
    mono[index] = mixed;
    rawPeak = Math.max(rawPeak, Math.abs(mixed));
  }
  // Avoid manufacturing a beat from the official follower's non-zero floor on digital silence.
  if (rawPeak === 0) return [];

  const bass = lowPassOnePole(mono, sampleRate, 50);
  const followed = createBeatControlEnvelope(bass, sampleRate);
  const control = resampleControlRate(followed, sampleRate);
  return detectBeatTimes(control, selection.start, settings.thresholdPercentage, 1000)
    .filter((time) => time < selection.end);
}

export function analyzeBeatFinderTracks(
  tracks: readonly BeatFinderTrack[],
  selection: GeneratorSelection,
  sampleRate: number,
  settings: BeatFinderSettings,
): DetectedBeatLabel[] {
  validateBeatFinderSettings(settings);
  validateAnalysisInput(selection, sampleRate);
  const selectionSamples = Math.round((selection.end - selection.start) * sampleRate);
  if (!Number.isSafeInteger(selectionSamples) || selectionSamples < 1) {
    throw new RangeError('Beat finder 选区采样数无效');
  }

  const labels: DetectedBeatLabel[] = [];
  let analyzedTracks = 0;
  for (const track of tracks) {
    if (track.clips.length === 0) continue;
    const channelCount = track.clips[0].channels.length;
    if (channelCount < 1 || channelCount > 2) {
      throw new RangeError(`轨道 ${track.trackId} 必须是单声道或立体声`);
    }
    if (selectionSamples * channelCount > MAX_BEAT_FINDER_TRACK_SAMPLES) {
      throw new RangeError(`Beat finder 单轨分析不能超过 ${MAX_BEAT_FINDER_TRACK_SAMPLES} 个采样`);
    }
    const timeline = Array.from({ length: channelCount }, () => new Float32Array(selectionSamples));
    for (const clip of [...track.clips].sort((left, right) => (
      left.startTime - right.startTime || left.clipId.localeCompare(right.clipId)
    ))) {
      if (clip.channels.length !== channelCount
        || clip.channels.some((channel) => channel.length !== clip.channels[0].length)) {
        throw new RangeError(`片段 ${clip.clipId} 的声道布局不一致，无法分析`);
      }
      const range = getClipSampleRange(clip, selection, clip.sourceOffset, sampleRate, clip.channels[0].length);
      if (!range) continue;
      const overlapStart = Math.max(clip.startTime, selection.start);
      const destinationStart = Math.round((overlapStart - selection.start) * sampleRate);
      const length = Math.min(range.endSample - range.startSample, selectionSamples - destinationStart);
      if (length <= 0) continue;
      for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
        for (let index = 0; index < length; index += 1) {
          timeline[channelIndex][destinationStart + index] += clip.channels[channelIndex][range.startSample + index];
        }
      }
    }

    analyzedTracks += 1;
    const times = analyzeBeatFinderChannels(timeline, selection, sampleRate, settings);
    for (const time of times) {
      labels.push({ trackId: track.trackId, start: time, end: time, text: 'B' });
      if (labels.length === MAX_BEAT_FINDER_LABELS) return labels;
    }
  }
  if (analyzedTracks === 0) throw new RangeError('所选轨道在时间选区内没有可分析的音频');
  return labels;
}
