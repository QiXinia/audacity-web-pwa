import { getClipSampleRange, type GeneratorSelection } from '@/lib/generatorEditing';

// Audacity 4.0.2 share/nyquist-plug-ins/rms.ny result rules.
export interface MeasureRmsClip {
  clipId: string;
  startTime: number;
  duration: number;
  sourceOffset: number;
  channels: readonly Float32Array[];
}

export interface RmsChannelMeasurement {
  rms: number;
  rmsDb: number;
  sampleCount: number;
}

export interface RmsSelectionMeasurement {
  start: number;
  end: number;
  channels: RmsChannelMeasurement[];
  stereo: RmsChannelMeasurement | null;
}

export function linearToRmsDb(rms: number): number {
  if (!Number.isFinite(rms) || rms < 0) throw new RangeError('RMS 必须是非负有限数值');
  return rms === 0 ? Number.NEGATIVE_INFINITY : 20 * Math.log10(rms);
}

export function formatRmsDb(rmsDb: number): string {
  if (Number.isNaN(rmsDb) || rmsDb === Number.POSITIVE_INFINITY) {
    throw new RangeError('无法格式化无效的 RMS 分贝值');
  }
  return rmsDb === Number.NEGATIVE_INFINITY ? '-Inf dB' : `${rmsDb.toFixed(4)} dB`;
}

function measureChannel(rms: number, sampleCount: number): RmsChannelMeasurement {
  return { rms, rmsDb: linearToRmsDb(rms), sampleCount };
}

/**
 * Measure each effective channel independently, then reproduce rms.ny's
 * sqrt((leftMeanSquare + rightMeanSquare) / 2) stereo combination.
 * Timeline gaps carry no PCM and are ignored; real zero samples inside clips count.
 */
export function measureRmsSelection(
  clips: readonly MeasureRmsClip[],
  selection: GeneratorSelection,
  sampleRate: number,
): RmsSelectionMeasurement {
  if (
    !Number.isFinite(selection.start)
    || !Number.isFinite(selection.end)
    || selection.start < 0
    || selection.end <= selection.start
    || !Number.isFinite(sampleRate)
    || sampleRate <= 0
  ) throw new RangeError('请选择有效的音频时间选区');

  const overlapping = clips
    .filter((clip) => clip.startTime < selection.end && clip.startTime + clip.duration > selection.start)
    .sort((left, right) => left.startTime - right.startTime || left.clipId.localeCompare(right.clipId));
  if (overlapping.length === 0) throw new RangeError('选区内没有可测量的音频');

  const channelCount = overlapping[0].channels.length;
  if (channelCount !== 1 && channelCount !== 2) {
    throw new RangeError('Measure RMS 仅支持单声道或立体声音轨');
  }
  const sums = Array.from({ length: channelCount }, () => 0);
  const sampleCounts = Array.from({ length: channelCount }, () => 0);

  for (const clip of overlapping) {
    if (clip.channels.length !== channelCount) {
      throw new RangeError('选区内的声道布局不一致，无法测量');
    }
    for (const channel of clip.channels) {
      if (channel.length !== clip.channels[0].length) {
        throw new RangeError('选区内的声道长度不一致，无法测量');
      }
    }

    for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
      const channel = clip.channels[channelIndex];
      const range = getClipSampleRange(clip, selection, clip.sourceOffset, sampleRate, channel.length);
      if (!range) continue;
      for (let index = range.startSample; index < range.endSample; index += 1) {
        const sample = channel[index];
        if (!Number.isFinite(sample)) throw new RangeError('音频包含非有限采样值，无法测量');
        sums[channelIndex] += sample * sample;
        sampleCounts[channelIndex] += 1;
      }
    }
  }

  if (sampleCounts.some((count) => count === 0)) {
    throw new RangeError(channelCount > 1
      ? '立体声测量要求每个声道在选区内都有音频'
      : '选区内没有可测量的音频采样');
  }
  if (channelCount === 2 && sampleCounts[0] !== sampleCounts[1]) {
    throw new RangeError('立体声声道的有效采样数不一致，无法测量');
  }

  const channels = sums.map((sum, index) => measureChannel(
    Math.sqrt(sum / sampleCounts[index]),
    sampleCounts[index],
  ));
  const stereo = channelCount === 2
    ? measureChannel(Math.sqrt((channels[0].rms ** 2 + channels[1].rms ** 2) / 2), sampleCounts[0])
    : null;
  return { start: selection.start, end: selection.end, channels, stereo };
}
