import { getClipSampleRange, type GeneratorSelection } from '@/lib/generatorEditing';

// Audacity 4.0.2 share/nyquist-plug-ins/label-sounds.ny defaults and controls.
export type LabelSoundsMeasurement = 'peak' | 'average' | 'rms';
export type LabelSoundsType = 'before' | 'after' | 'around' | 'between';

export interface LabelSoundsSettings {
  thresholdDb: number;
  measurement: LabelSoundsMeasurement;
  silenceDuration: number;
  labelInterval: number;
  labelType: LabelSoundsType;
  leadingSilence: number;
  trailingSilence: number;
  labelText: string;
}

export const DEFAULT_LABEL_SOUNDS_SETTINGS: Readonly<LabelSoundsSettings> = Object.freeze({
  thresholdDb: -30,
  measurement: 'peak',
  silenceDuration: 1,
  labelInterval: 1,
  labelType: 'around',
  leadingSilence: 0,
  trailingSilence: 0,
  labelText: 'Sound ##1',
});

export const MAX_LABEL_SOUNDS_TRACK_SAMPLES = 20_000_000;
export const MAX_LABEL_SOUNDS_LABELS = 10_000;

export interface LabelSoundsClip {
  clipId: string;
  startTime: number;
  duration: number;
  sourceOffset: number;
  channels: readonly Float32Array[];
}

export interface LabelSoundsTrack {
  trackId: string;
  clips: readonly LabelSoundsClip[];
}

export interface LabelSoundRegion {
  start: number;
  end: number;
}

export interface DetectedSoundLabel extends LabelSoundRegion {
  trackId: string;
  text: string;
}

export function validateLabelSoundsSettings(settings: LabelSoundsSettings): void {
  if (!Number.isFinite(settings.thresholdDb) || settings.thresholdDb < -100 || settings.thresholdDb > 0) {
    throw new RangeError('Threshold level (dB) 必须在 -100 到 0 之间');
  }
  if (!['peak', 'average', 'rms'].includes(settings.measurement)) {
    throw new RangeError('Threshold measurement 无效');
  }
  if (!Number.isFinite(settings.silenceDuration) || settings.silenceDuration < 0.01 || settings.silenceDuration > 3600) {
    throw new RangeError('Minimum silence duration 必须在 0.01 到 3600 秒之间');
  }
  if (!Number.isFinite(settings.labelInterval) || settings.labelInterval < 0.01 || settings.labelInterval > 7200) {
    throw new RangeError('Minimum label interval 必须在 0.01 到 7200 秒之间');
  }
  if (!['before', 'after', 'around', 'between'].includes(settings.labelType)) {
    throw new RangeError('Label type 无效');
  }
  if (!Number.isFinite(settings.leadingSilence) || settings.leadingSilence < 0) {
    throw new RangeError('Maximum leading silence 必须是非负有限秒数');
  }
  if (!Number.isFinite(settings.trailingSilence) || settings.trailingSilence < 0) {
    throw new RangeError('Maximum trailing silence 必须是非负有限秒数');
  }
  if (typeof settings.labelText !== 'string') throw new RangeError('Label text 必须是字符串');
}

function validateAnalysisInput(selection: GeneratorSelection, sampleRate: number): void {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new RangeError('Label sounds 采样率必须是正的有限数值');
  }
  if (!Number.isFinite(selection.start) || selection.start < 0) {
    throw new RangeError('Label sounds 选区起点必须是非负有限时间');
  }
  if (!Number.isFinite(selection.end) || selection.end <= selection.start) {
    throw new RangeError('Label sounds 需要有效的正长度时间选区');
  }
}

/** Reduce channels to approximately 100 Hz using the official measurement modes. */
function reduceChannels(
  channels: readonly Float32Array[],
  sampleRate: number,
  measurement: LabelSoundsMeasurement,
): { levels: Float64Array; sampleRate: number } {
  if (channels.length === 0) throw new RangeError('轨道没有音频声道');
  const length = channels[0].length;
  if (channels.some((channel) => channel.length !== length)) {
    throw new RangeError('片段的声道长度不一致，无法分析');
  }
  const ratio = Math.max(1, Math.round(sampleRate / 100));
  const reducedSampleRate = sampleRate / ratio;
  const levels = new Float64Array(Math.ceil(length / ratio));
  for (let frame = 0; frame < levels.length; frame += 1) {
    const start = frame * ratio;
    const end = Math.min(length, start + ratio);
    const count = end - start;
    let value = 0;
    if (measurement === 'peak') {
      for (const channel of channels) {
        for (let index = start; index < end; index += 1) value = Math.max(value, Math.abs(channel[index]));
      }
    } else if (measurement === 'average') {
      for (const channel of channels) {
        for (let index = start; index < end; index += 1) value += Math.abs(channel[index]);
      }
      value /= channels.length * count;
    } else {
      for (const channel of channels) {
        for (let index = start; index < end; index += 1) value += channel[index] ** 2;
      }
      value = Math.sqrt(value / (channels.length * count));
    }
    levels[frame] = value;
  }
  return { levels, sampleRate: reducedSampleRate };
}

/** Port of the official find-sounds counter state machine. */
export function detectLabelSoundRegions(
  levels: ArrayLike<number>,
  selectionStart: number,
  sampleRate: number,
  settings: LabelSoundsSettings,
): LabelSoundRegion[] {
  validateLabelSoundsSettings(settings);
  if (!Number.isFinite(selectionStart) || selectionStart < 0 || !Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new RangeError('Label sounds 检测时间轴无效');
  }
  const threshold = 10 ** (settings.thresholdDb / 20);
  const silenceSamples = settings.silenceDuration * sampleRate;
  const soundSamples = settings.labelInterval * sampleRate;
  const sounds: LabelSoundRegion[] = [];
  let sampleCount = 0;
  let silenceCount = 0;
  let soundCount = 0;
  let soundStart = 0;

  for (let index = 0; index < levels.length; index += 1) {
    if (levels[index] < threshold) {
      if (silenceCount >= silenceSamples && soundCount >= soundSamples) {
        sounds.push({
          start: selectionStart + soundStart / sampleRate,
          end: selectionStart + (sampleCount - silenceCount) / sampleRate,
        });
        if (sounds.length === MAX_LABEL_SOUNDS_LABELS) return sounds;
        soundCount = 0;
      }
      if (soundCount > 0) soundCount += 1;
      silenceCount += 1;
    } else {
      if (soundCount === 0) soundStart = sampleCount;
      silenceCount = 0;
      soundCount += 1;
    }
    sampleCount += 1;
  }
  if (soundCount > 0) {
    sounds.push({
      start: selectionStart + soundStart / sampleRate,
      end: selectionStart + (sampleCount - silenceCount) / sampleRate,
    });
  }
  return sounds;
}

function createLabelTextFormatter(template: string): () => string {
  const hashes = /#+/.exec(template);
  if (!hashes) return () => template;
  const hashStart = hashes.index;
  const hashEnd = hashStart + hashes[0].length;
  let cursor = hashEnd;
  let negative = false;
  if (template[cursor] === '-') {
    negative = true;
    cursor += 1;
  }
  const digitStart = cursor;
  while (cursor < template.length && /[0-9]/.test(template[cursor])) cursor += 1;
  if (cursor === digitStart) return () => template;

  const prefix = template.slice(0, hashStart);
  const suffix = template.slice(cursor);
  let value = BigInt(template.slice(digitStart, cursor));
  if (negative) value = -value;
  return () => {
    const absolute = (value < 0n ? -value : value).toString().padStart(hashes[0].length, '0');
    const text = `${prefix}${value < 0n ? '-' : ''}${absolute}${suffix}`;
    value += 1n;
    return text;
  };
}

/** Port return-labels, including overlap clamps and midpoint degenerate silences. */
export function labelsFromSoundRegions(
  trackId: string,
  sounds: readonly LabelSoundRegion[],
  selectionStart: number,
  settings: LabelSoundsSettings,
): DetectedSoundLabel[] {
  validateLabelSoundsSettings(settings);
  if (sounds.length === 0) return [];
  if (settings.labelType === 'between' && sounds.length === 1) {
    throw new RangeError('Labelling regions between sounds requires at least two sounds; only one sound detected.');
  }
  const nextText = createLabelTextFormatter(settings.labelText);
  const labels: DetectedSoundLabel[] = [];
  let earliestStart = selectionStart;

  if (settings.labelType === 'between') {
    for (let index = 0; index < sounds.length - 1; index += 1) {
      const silenceStart = sounds[index].end;
      const silenceEnd = sounds[index + 1].start;
      let start = Math.min(silenceEnd, silenceStart + settings.leadingSilence);
      let end = Math.max(silenceStart, silenceEnd - settings.trailingSilence);
      if (end < start) start = end = (start + end) / 2;
      labels.push({ trackId, start, end, text: nextText() });
    }
    return labels;
  }

  for (let index = 0; index < sounds.length; index += 1) {
    const sound = sounds[index];
    const start = Math.max(earliestStart, sound.start - settings.leadingSilence);
    let end = sound.end + settings.trailingSilence;
    if (index + 1 < sounds.length) end = Math.min(end, sounds[index + 1].start);
    if (settings.labelType === 'before') {
      labels.push({ trackId, start, end: start, text: nextText() });
    } else if (settings.labelType === 'after') {
      labels.push({ trackId, start: end, end, text: nextText() });
    } else {
      labels.push({ trackId, start, end, text: nextText() });
    }
    earliestStart = sound.end;
  }
  return labels;
}

export function analyzeLabelSoundsTracks(
  tracks: readonly LabelSoundsTrack[],
  selection: GeneratorSelection,
  sampleRate: number,
  settings: LabelSoundsSettings,
): DetectedSoundLabel[] {
  validateLabelSoundsSettings(settings);
  validateAnalysisInput(selection, sampleRate);
  const selectionSamples = Math.round((selection.end - selection.start) * sampleRate);
  if (!Number.isSafeInteger(selectionSamples) || selectionSamples < 1) {
    throw new RangeError('Label sounds 选区采样数无效');
  }

  const labels: DetectedSoundLabel[] = [];
  let analyzedTracks = 0;
  for (const track of tracks) {
    if (track.clips.length === 0) continue;
    const channelCount = track.clips[0].channels.length;
    if (channelCount === 0) throw new RangeError(`轨道 ${track.trackId} 没有音频声道`);
    if (selectionSamples * channelCount > MAX_LABEL_SOUNDS_TRACK_SAMPLES) {
      throw new RangeError(`Label sounds 单轨分析不能超过 ${MAX_LABEL_SOUNDS_TRACK_SAMPLES} 个采样`);
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
    const reduced = reduceChannels(timeline, sampleRate, settings.measurement);
    const sounds = detectLabelSoundRegions(reduced.levels, selection.start, reduced.sampleRate, settings);
    labels.push(...labelsFromSoundRegions(track.trackId, sounds, selection.start, settings));
  }
  if (analyzedTracks === 0) throw new RangeError('所选轨道在时间选区内没有可分析的音频');
  return labels;
}
