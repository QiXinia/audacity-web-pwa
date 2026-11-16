import { getClipSampleRange, type GeneratorSelection } from '@/lib/generatorEditing';

export interface ContrastClip {
  clipId: string;
  startTime: number;
  duration: number;
  sourceOffset: number;
  channels: readonly Float32Array[];
}

export interface ContrastMeasurement {
  start: number;
  end: number;
  rms: number;
  rmsDb: number;
  sampleCounts: number[];
}

export type ContrastResultKind =
  | 'foreground-too-high'
  | 'background-too-high'
  | 'background-higher'
  | 'pass'
  | 'fail';

export interface ContrastResult {
  kind: ContrastResultKind;
  differenceDb: number;
}

/**
 * Match Audacity ContrastBase::GetDB: each channel contributes its own RMS,
 * then the channel mean-square values are averaged. Empty timeline gaps are
 * ignored, while actual zero samples inside clips remain part of the RMS.
 */
export function measureContrastSelection(
  clips: readonly ContrastClip[],
  selection: GeneratorSelection,
  sampleRate: number,
): ContrastMeasurement {
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
  if (channelCount === 0) throw new RangeError('轨道没有音频声道');
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
      const range = getClipSampleRange(
        clip,
        selection,
        clip.sourceOffset,
        sampleRate,
        channel.length,
      );
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
      ? '多声道测量要求每个声道在选区内都有音频'
      : '选区内没有可测量的音频采样');
  }

  const meanSquare = sums.reduce((total, sum, index) => (
    total + sum / sampleCounts[index]
  ), 0) / channelCount;
  const rms = Math.sqrt(meanSquare);
  return {
    start: selection.start,
    end: selection.end,
    rms,
    rmsDb: rms === 0 ? Number.NEGATIVE_INFINITY : 20 * Math.log10(rms),
    sampleCounts,
  };
}

const WCAG_CONTRAST_THRESHOLD_DB = 20;
// Treat sub-picobel arithmetic noise as equality, while keeping real values above
// the strict 20 dB boundary (for example 20.0001 dB) eligible to pass.
const WCAG_CONTRAST_FLOAT_TOLERANCE_DB = 1e-10;

export function passesWcagContrastThreshold(differenceDb: number): boolean {
  return differenceDb > WCAG_CONTRAST_THRESHOLD_DB + WCAG_CONTRAST_FLOAT_TOLERANCE_DB;
}

/** Audacity uses a strict > 20 dB threshold and checks invalid levels first. */
export function evaluateContrast(foregroundDb: number, backgroundDb: number): ContrastResult {
  const differenceDb = Math.abs(foregroundDb - backgroundDb);
  if (foregroundDb > 0) return { kind: 'foreground-too-high', differenceDb };
  if (backgroundDb > 0) return { kind: 'background-too-high', differenceDb };
  if (backgroundDb > foregroundDb) return { kind: 'background-higher', differenceDb };
  return { kind: passesWcagContrastThreshold(differenceDb) ? 'pass' : 'fail', differenceDb };
}

export function formatContrastDifference(differenceDb: number): string {
  if (Number.isNaN(differenceDb)) return 'indeterminate';
  if (!Number.isFinite(differenceDb)) return 'Infinite dB difference';
  return `${differenceDb.toFixed(2)} dB RMS`;
}

function formatExportTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds - hours * 3600) / 60);
  const remainder = seconds - hours * 3600 - minutes * 60;
  return `Time started = ${String(hours).padStart(2, ' ')} hour(s), ${String(minutes).padStart(2, ' ')} minute(s), ${remainder.toFixed(2)} seconds.`;
}

function formatExportEnd(seconds: number): string {
  return formatExportTime(seconds).replace('Time started', 'Time ended');
}

function formatExportRms(measurement: ContrastMeasurement | null): string {
  if (!measurement) return 'RMS =  dB.';
  if (!Number.isFinite(measurement.rmsDb)) return 'RMS = zero.';
  return `RMS = ${measurement.rmsDb.toFixed(2)} dB.`;
}

export function serializeContrastResults(options: {
  projectName: string;
  foreground: ContrastMeasurement | null;
  background: ContrastMeasurement | null;
  now?: Date;
}): string {
  const { projectName, foreground, background, now = new Date() } = options;
  const differenceDb = foreground && background
    ? foreground.rmsDb - background.rmsDb
    : Number.NaN;
  const difference = Number.isNaN(differenceDb)
    ? 'Difference is indeterminate.'
    : Number.isFinite(differenceDb)
      ? `Difference = ${differenceDb.toFixed(2)} RMS dB.`
      : 'Difference = infinite RMS dB.';
  // Audacity's text export uses the signed foreground-minus-background value.
  const pass = passesWcagContrastThreshold(differenceDb);
  const month = now.toLocaleString('en-US', { month: 'long' });
  const gathered = `${now.getDate()} ${month} ${now.getFullYear()} ${String(now.getHours()).padStart(2, '0')}h ${String(now.getMinutes()).padStart(2, '0')}m ${String(now.getSeconds()).padStart(2, '0')}s`;
  const lines = [
    '===================================',
    'WCAG 2.0 Success Criteria 1.4.7 Contrast Results',
    '',
    `Filename = ${projectName}.`,
    '',
    'Foreground',
    formatExportTime(foreground?.start ?? 0),
    formatExportEnd(foreground?.end ?? 0),
    formatExportRms(foreground),
    '',
    'Background',
    formatExportTime(background?.start ?? 0),
    formatExportEnd(background?.end ?? 0),
    formatExportRms(background),
    '',
    'Results',
    difference,
    `Success Criteria 1.4.7 of WCAG 2.0: ${pass ? 'Pass' : 'Fail'}`,
    '',
    'Data gathered',
    gathered,
    '===================================',
    '',
  ];
  return lines.join('\n');
}
