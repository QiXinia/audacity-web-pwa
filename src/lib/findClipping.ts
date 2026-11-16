import { getClipSampleRange, type GeneratorSelection } from '@/lib/generatorEditing';

// Audacity 4.0.2 FindClippingBase.cpp: defaults and per-channel run semantics.
export interface FindClippingSettings {
  startThreshold: number;
  stopThreshold: number;
}

export const DEFAULT_FIND_CLIPPING_SETTINGS: Readonly<FindClippingSettings> = Object.freeze({
  startThreshold: 3,
  stopThreshold: 3,
});

export const MAX_FIND_CLIPPING_TRACK_SAMPLES = 20_000_000;

export interface DetectedClipping {
  trackId: string;
  channelIndex: number;
  start: number;
  end: number;
  text: string;
}

export interface FindClippingClip {
  clipId: string;
  startTime: number;
  duration: number;
  sourceOffset: number;
  channels: readonly Float32Array[];
}

export interface FindClippingTrack {
  trackId: string;
  clips: readonly FindClippingClip[];
}

export function validateFindClippingSettings(settings: FindClippingSettings): void {
  if (!Number.isSafeInteger(settings.startThreshold) || settings.startThreshold < 1) {
    throw new RangeError('Start threshold 必须是至少为 1 的整数');
  }
  if (!Number.isSafeInteger(settings.stopThreshold) || settings.stopThreshold < 1) {
    throw new RangeError('Stop threshold 必须是至少为 1 的整数');
  }
}

function validateAnalysisInput(selectionStart: number, sampleRate: number): void {
  if (!Number.isFinite(selectionStart) || selectionStart < 0) {
    throw new RangeError('Find Clipping 选区起点必须是非负有限时间');
  }
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new RangeError('Find Clipping 采样率必须是正的有限数值');
  }
}

/**
 * Port of FindClippingBase::ProcessOne. In particular, a run is emitted only
 * after Stop consecutive unclipped samples; upstream does not flush a run at
 * the selection end. The end sample and "x of y" text intentionally retain
 * the upstream `s - mStop` and `samps - mStop` calculations.
 */
export function detectFindClippingRuns(
  samples: Float32Array,
  selectionStart: number,
  sampleRate: number,
  settings: FindClippingSettings,
): Omit<DetectedClipping, 'trackId' | 'channelIndex'>[] {
  validateFindClippingSettings(settings);
  validateAnalysisInput(selectionStart, sampleRate);
  if (samples.length < settings.startThreshold) return [];

  const labels: Omit<DetectedClipping, 'trackId' | 'channelIndex'>[] = [];
  let startRun = 0;
  let stopRun = 0;
  let runSamples = 0;
  let startTime = -1;

  for (let index = 0; index < samples.length; index += 1) {
    if (Math.abs(samples[index]) >= 1) {
      if (startRun === 0) {
        startTime = selectionStart + index / sampleRate;
        runSamples = 0;
      } else {
        stopRun = 0;
      }
      startRun += 1;
      runSamples += 1;
    } else if (startRun >= settings.startThreshold) {
      stopRun += 1;
      runSamples += 1;
      if (stopRun >= settings.stopThreshold) {
        labels.push({
          start: startTime,
          end: selectionStart + (index - settings.stopThreshold) / sampleRate,
          text: `${startRun} of ${runSamples - settings.stopThreshold}`,
        });
        startRun = 0;
        stopRun = 0;
        runSamples = 0;
      }
    } else {
      startRun = 0;
    }
  }
  return labels;
}

/**
 * Render selected clips into zero-filled per-track timelines, then run the
 * official detector independently for every channel. Timeline gaps therefore
 * behave like Audacity WaveTrack silence rather than being skipped.
 */
export function analyzeFindClippingTracks(
  tracks: readonly FindClippingTrack[],
  selection: GeneratorSelection,
  sampleRate: number,
  settings: FindClippingSettings,
): DetectedClipping[] {
  validateFindClippingSettings(settings);
  validateAnalysisInput(selection.start, sampleRate);
  if (!Number.isFinite(selection.end) || selection.end <= selection.start) {
    throw new RangeError('Find Clipping 需要有效的正长度时间选区');
  }
  const selectionSamples = Math.round((selection.end - selection.start) * sampleRate);
  if (!Number.isSafeInteger(selectionSamples) || selectionSamples < 1) {
    throw new RangeError('Find Clipping 选区采样数无效');
  }

  const labels: DetectedClipping[] = [];
  let analyzedTracks = 0;
  for (const track of tracks) {
    if (track.clips.length === 0) continue;
    const channelCount = track.clips[0].channels.length;
    if (channelCount === 0) throw new RangeError(`轨道 ${track.trackId} 没有音频声道`);
    if (selectionSamples * channelCount > MAX_FIND_CLIPPING_TRACK_SAMPLES) {
      throw new RangeError(`Find Clipping 单轨分析不能超过 ${MAX_FIND_CLIPPING_TRACK_SAMPLES} 个采样`);
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
    for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
      for (const label of detectFindClippingRuns(timeline[channelIndex], selection.start, sampleRate, settings)) {
        labels.push({ ...label, trackId: track.trackId, channelIndex });
      }
    }
  }
  if (analyzedTracks === 0) throw new RangeError('所选轨道在时间选区内没有可分析的音频');
  return labels;
}
