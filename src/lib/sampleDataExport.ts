import { getClipSampleRange, type GeneratorSelection } from '@/lib/generatorEditing';

// Audacity 4.0.2 share/nyquist-plug-ins/sample-data-export.ny controls and output rules.
export interface SampleDataClip {
  clipId: string;
  startTime: number;
  duration: number;
  sourceOffset: number;
  channels: readonly Float32Array[];
}

export type SampleDataUnits = 'db' | 'linear';
export type SampleDataIndex = 'none' | 'count' | 'time';
export type SampleDataHeader = 'none' | 'minimal' | 'standard' | 'all';
export type SampleDataChannelLayout = 'same-line' | 'alternate' | 'left-first';
export type SampleDataMessages = 'yes' | 'errors' | 'none';
export type SampleDataFileFormat = 'txt' | 'csv' | 'html';

export interface SampleDataExportSettings {
  sampleLimit: number;
  units: SampleDataUnits;
  filename: string;
  index: SampleDataIndex;
  header: SampleDataHeader;
  optionalText: string;
  channelLayout: SampleDataChannelLayout;
  messages: SampleDataMessages;
}

export const DEFAULT_SAMPLE_DATA_EXPORT_SETTINGS: Readonly<SampleDataExportSettings> = {
  sampleLimit: 100,
  units: 'db',
  filename: 'sample-data.txt',
  index: 'none',
  header: 'none',
  optionalText: '',
  channelLayout: 'same-line',
  messages: 'yes',
};

export interface SampleDataPcm {
  channels: number[][];
}

export interface SampleDataExportFile {
  content: string;
  filename: string;
  format: SampleDataFileFormat;
  mimeType: string;
  sampleCount: number;
  channelCount: number;
}

const MAX_SAMPLE_LIMIT = 1_000_000;

function includesValue<T extends string>(values: readonly T[], value: string): value is T {
  return values.includes(value as T);
}

export function getSampleDataFileFormat(filename: string): SampleDataFileFormat {
  const extension = filename.trim().toLowerCase().match(/\.([^.]+)$/)?.[1];
  if (extension === 'csv') return 'csv';
  if (extension === 'html' || extension === 'htm') return 'html';
  return 'txt';
}

export function validateSampleDataExportSettings(settings: SampleDataExportSettings): void {
  if (
    !Number.isSafeInteger(settings.sampleLimit)
    || settings.sampleLimit < 1
    || settings.sampleLimit > MAX_SAMPLE_LIMIT
  ) throw new RangeError('Limit output to first 必须是 1–1000000 的整数');
  if (typeof settings.filename !== 'string' || settings.filename.trim().length === 0) {
    throw new RangeError('请输入导出文件名');
  }
  if (/[/\\\0\r\n]/.test(settings.filename)) {
    throw new RangeError('浏览器下载文件名不能包含路径或换行');
  }
  if (!includesValue(['db', 'linear'] as const, settings.units)) throw new RangeError('未知测量尺度');
  if (!includesValue(['none', 'count', 'time'] as const, settings.index)) throw new RangeError('未知索引格式');
  if (!includesValue(['none', 'minimal', 'standard', 'all'] as const, settings.header)) {
    throw new RangeError('未知标头级别');
  }
  if (!includesValue(['same-line', 'alternate', 'left-first'] as const, settings.channelLayout)) {
    throw new RangeError('未知声道布局');
  }
  if (!includesValue(['yes', 'errors', 'none'] as const, settings.messages)) {
    throw new RangeError('未知消息选项');
  }
  if (typeof settings.optionalText !== 'string') throw new RangeError('可选标头必须是文本');
}

/** Collect real PCM from overlapping clips; timeline gaps have no samples and are skipped. */
export function collectSampleDataPcm(
  clips: readonly SampleDataClip[],
  selection: GeneratorSelection,
  sampleRate: number,
  sampleLimit: number,
): SampleDataPcm {
  if (
    !Number.isFinite(selection.start)
    || !Number.isFinite(selection.end)
    || selection.start < 0
    || selection.end <= selection.start
    || !Number.isFinite(sampleRate)
    || sampleRate <= 0
  ) throw new RangeError('请选择有效的音频时间选区');
  if (!Number.isSafeInteger(sampleLimit) || sampleLimit < 1 || sampleLimit > MAX_SAMPLE_LIMIT) {
    throw new RangeError('采样导出数量必须是 1–1000000 的整数');
  }

  const overlapping = clips
    .filter((clip) => clip.startTime < selection.end && clip.startTime + clip.duration > selection.start)
    .sort((left, right) => left.startTime - right.startTime || left.clipId.localeCompare(right.clipId));
  if (overlapping.length === 0) throw new RangeError('选区内没有可导出的音频');

  const channelCount = overlapping[0].channels.length;
  if (channelCount !== 1 && channelCount !== 2) {
    throw new RangeError('Sample Data Export 仅支持单声道或立体声音轨');
  }
  const channels = Array.from({ length: channelCount }, () => [] as number[]);
  let remaining = sampleLimit;

  for (const clip of overlapping) {
    if (clip.channels.length !== channelCount) throw new RangeError('选区内的声道布局不一致，无法导出');
    const channelLength = clip.channels[0].length;
    if (clip.channels.some((channel) => channel.length !== channelLength)) {
      throw new RangeError('选区内的声道长度不一致，无法导出');
    }
    const range = getClipSampleRange(clip, selection, clip.sourceOffset, sampleRate, channelLength);
    if (!range) continue;
    const count = Math.min(range.endSample - range.startSample, remaining);
    for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
      const channel = clip.channels[channelIndex];
      for (let offset = 0; offset < count; offset += 1) {
        const sample = channel[range.startSample + offset];
        if (!Number.isFinite(sample)) throw new RangeError('音频包含非有限采样值，无法导出');
        channels[channelIndex].push(sample);
      }
    }
    remaining -= count;
    if (remaining === 0) break;
  }

  if (channels[0].length === 0) throw new RangeError('选区内没有可导出的音频采样');
  if (channels.some((channel) => channel.length !== channels[0].length)) {
    throw new RangeError('立体声声道的有效采样数不一致，无法导出');
  }
  return { channels };
}

function formatFloat(value: number): string {
  if (!Number.isFinite(value)) throw new RangeError('无法格式化非有限采样值');
  return value.toFixed(5);
}

export function linearToSampleDataDb(value: number): string {
  if (!Number.isFinite(value)) throw new RangeError('无法转换非有限采样值');
  const absolute = Math.abs(value);
  return absolute === 0 ? '[-inf]' : formatFloat(20 * Math.log10(absolute));
}

export function formatSampleDataValue(value: number, units: SampleDataUnits): string {
  return units === 'db' ? linearToSampleDataDb(value) : formatFloat(value);
}

interface SampleDataStats {
  peak: number;
  peakDb: string;
  rmsDb: string;
  dcOffset: string;
}

function measureStats(channels: readonly (readonly number[])[], sampleRate: number): SampleDataStats {
  const count = channels[0]?.length ?? 0;
  if (count === 0 || !Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new RangeError('没有可统计的音频采样');
  }
  let peak = 0;
  let squareSum = 0;
  const dc: number[] = [];
  for (const channel of channels) {
    if (channel.length !== count) throw new RangeError('声道采样数不一致');
    let sum = 0;
    for (const sample of channel) {
      if (!Number.isFinite(sample)) throw new RangeError('音频包含非有限采样值');
      peak = Math.max(peak, Math.abs(sample));
      sum += sample;
      squareSum += sample * sample;
    }
    dc.push(sum / count);
  }
  const rms = Math.sqrt(squareSum / (count * channels.length));
  const dcOffset = dc.length === 1
    ? `${formatFloat(dc[0])} linear, ${linearToSampleDataDb(dc[0])} dB.`
    : `Left: ${formatFloat(dc[0])} lin, ${linearToSampleDataDb(dc[0])} dB | Right: ${formatFloat(dc[1])} lin, ${linearToSampleDataDb(dc[1])} dB.`;
  return {
    peak,
    peakDb: linearToSampleDataDb(peak),
    rmsDb: linearToSampleDataDb(rms),
    dcOffset,
  };
}

function channelLayoutDescription(
  channelCount: number,
  format: SampleDataFileFormat,
  layout: SampleDataChannelLayout,
): string {
  if (channelCount === 1 || format === 'html') return '';
  if (format === 'csv' && layout === 'same-line') return 'One column per channel.\n';
  if (format === 'csv' && layout === 'left-first') return 'One row per channel.\n';
  if (layout === 'same-line') return 'Left channel then Right channel on same line.\n';
  if (layout === 'alternate') return 'Left and right channels on alternate lines.\n';
  return 'Left channel first then right channel.\n';
}

function makeTextHeader(options: {
  settings: SampleDataExportSettings;
  format: SampleDataFileFormat;
  sampleRate: number;
  sampleCount: number;
  channelCount: number;
  stats: SampleDataStats;
}): string {
  const { settings, format, sampleRate, sampleCount, channelCount, stats } = options;
  const filename = settings.filename.trim();
  const units = settings.units === 'db' ? 'dB' : 'linear';
  const channels = channelCount === 2 ? '2 channels (stereo)' : '1 channel (mono)';
  const order = channelLayoutDescription(channelCount, format, settings.channelLayout);
  const duration = formatFloat(sampleCount / sampleRate);
  const optional = settings.optionalText;

  if (settings.header === 'none') return optional ? `${optional}\n${order}` : '';
  if (settings.header === 'minimal') {
    return `Sample Rate: ${sampleRate} Hz. Sample values on ${units} scale.\n${order}${optional ? `${optional}\n\n\n` : '\n'}`;
  }
  if (settings.header === 'standard') {
    return `${filename}   ${channels}\n${order}Sample Rate: ${sampleRate} Hz. Sample values on ${units} scale.\nLength processed: ${sampleCount} samples ${duration} seconds.${optional ? `\n${optional}\n\n` : '\n\n'}`;
  }
  return `${filename}\nSample Rate: ${sampleRate} Hz. Sample values on ${units} scale. ${channels}.\n${order}Length processed: ${sampleCount} samples, ${duration} seconds.\nPeak amplitude: ${formatFloat(stats.peak)} (linear) ${stats.peakDb} dB.  Unweighted RMS: ${stats.rmsDb} dB.\nDC offset: ${stats.dcOffset}${optional ? `\n${optional}\n\n\n` : '\n\n\n'}`;
}

function formatTextSample(
  sample: number,
  sampleIndex: number,
  settings: SampleDataExportSettings,
  sampleRate: number,
  sameLine: boolean,
): string {
  const value = formatSampleDataValue(sample, settings.units);
  const ending = sameLine ? '\t' : '\n';
  if (settings.index === 'count') return `${sampleIndex + 1}\t${value}${ending}`;
  if (settings.index === 'time') return `${formatFloat(sampleIndex / sampleRate)}\t${value}${ending}`;
  return `${value}${ending}`;
}

function serializeDelimited(options: {
  pcm: SampleDataPcm;
  settings: SampleDataExportSettings;
  format: 'txt' | 'csv';
  sampleRate: number;
  stats: SampleDataStats;
}): string {
  const { pcm, settings, format, sampleRate, stats } = options;
  const { channels } = pcm;
  const sampleCount = channels[0].length;
  let output = makeTextHeader({ settings, format, sampleRate, sampleCount, channelCount: channels.length, stats });
  const csv = format === 'csv';

  if (csv && channels.length === 1 && settings.channelLayout === 'left-first') {
    return output + channels[0]
      .map((sample) => `${formatSampleDataValue(sample, settings.units)},`)
      .join('');
  }

  if (channels.length === 2 && settings.channelLayout === 'left-first') {
    if (settings.header !== 'none') output += 'Left Channel.\n\n';
    for (let channelIndex = 0; channelIndex < 2; channelIndex += 1) {
      if (channelIndex === 1) output += settings.header === 'none' ? '\n' : '\n\nRight Channel.\n\n';
      if (csv) {
        output += channels[channelIndex]
          .map((sample) => `${formatSampleDataValue(sample, settings.units)},`)
          .join('');
      } else {
        channels[channelIndex].forEach((sample, sampleIndex) => {
          output += formatTextSample(sample, sampleIndex, settings, sampleRate, false);
        });
      }
    }
    return output;
  }

  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
    for (let channelIndex = 0; channelIndex < channels.length; channelIndex += 1) {
      const sameLine = channels.length === 2 && settings.channelLayout === 'same-line' && channelIndex === 0;
      const sample = channels[channelIndex][sampleIndex];
      if (csv) {
        output += `${formatSampleDataValue(sample, settings.units)}${sameLine ? ',' : '\n'}`;
      } else {
        output += formatTextSample(sample, sampleIndex, settings, sampleRate, sameLine);
      }
    }
  }
  return output;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]!);
}

function serializeHtml(options: {
  pcm: SampleDataPcm;
  settings: SampleDataExportSettings;
  sampleRate: number;
  stats: SampleDataStats;
}): string {
  const { pcm, settings, sampleRate, stats } = options;
  const { channels } = pcm;
  const sampleCount = channels[0].length;
  const channelCount = channels.length;
  const title = settings.filename.trim().replace(/\.html?$/i, '');
  const channelsLabel = channelCount === 2 ? '2 channels (stereo)' : '1 channel (mono)';
  const headings = channelCount === 2
    ? '<th>Sample #</th><th>Seconds</th><th>Left (linear)</th><th>Right (linear)</th><th>Left (dB)</th><th>Right (dB)</th>'
    : '<th>Sample #</th><th>Seconds</th><th>Value (linear)</th><th>Value (dB)</th>';
  const rows: string[] = [];
  for (let index = 0; index < sampleCount; index += 1) {
    const cells = [
      String(index + 1),
      formatFloat(index / sampleRate),
      ...channels.map((channel) => formatFloat(channel[index])),
      ...channels.map((channel) => linearToSampleDataDb(channel[index])),
    ];
    rows.push(`<tr>${cells.map((cell) => `<td>${cell}</td>`).join('')}</tr>`);
  }
  return `<!DOCTYPE html>
<html>
<head>
<meta name="generator" content="Sample Data Export by Steve Daulton, released under GPL v2.0+">
<meta charset="UTF-8">
<title>Sample Data Export</title>
<style>body{margin:1em 5%;background-color:#dda;font-family:Arial,Helvetica,sans-serif}table,th,td{background-color:#fff;border:1px solid #000;text-align:center}table{border-collapse:collapse}td{text-align:right;padding-right:.5em}th{padding:0 .5em;background-color:#ddf}h1{font-size:1.6em;color:#633}</style>
</head>
<body>
<h1>Sample Data Export - ${escapeHtml(title)}</h1>
<h2>${escapeHtml(settings.optionalText)}</h2>
<h4>${channelsLabel}. &nbsp;&nbsp;${sampleCount} samples. &nbsp;&nbsp; ${formatFloat(sampleCount / sampleRate)} seconds.<br></h4>
<h3>Audio data analysis:</h3>
<ul>
<li><b>Sample Rate:</b> &nbsp;&nbsp;${sampleRate} Hz.</li>
<li><b>Peak Amplitude:</b> &nbsp;&nbsp;${formatFloat(stats.peak)} (linear) &nbsp;&nbsp;${stats.peakDb} dB.</li>
<li><b>RMS</b> (unweighted): &nbsp;&nbsp;${stats.rmsDb} dB.</li>
<li><b>DC Offset:</b> &nbsp;&nbsp;${escapeHtml(stats.dcOffset)}</li>
</ul>
<table title="sample data"><tr>${headings}</tr>
${rows.join('\n')}
</table>
<p id="footer">Produced with <span>Sample Data Export</span> for <a href="https://www.audacityteam.org/">Audacity</a> by Steve Daulton (<a href="https://audionyq.com">audionyq.com</a>)</p>
</body>
</html>`;
}

export function serializeSampleDataExport(options: {
  clips: readonly SampleDataClip[];
  selection: GeneratorSelection;
  sampleRate: number;
  settings: SampleDataExportSettings;
}): SampleDataExportFile {
  const { clips, selection, sampleRate, settings } = options;
  validateSampleDataExportSettings(settings);
  const pcm = collectSampleDataPcm(clips, selection, sampleRate, settings.sampleLimit);
  const sampleCount = pcm.channels[0].length;
  const channelCount = pcm.channels.length;
  const stats = measureStats(pcm.channels, sampleRate);
  const format = getSampleDataFileFormat(settings.filename);
  const content = format === 'html'
    ? serializeHtml({ pcm, settings, sampleRate, stats })
    : serializeDelimited({ pcm, settings, format, sampleRate, stats });
  return {
    content,
    filename: settings.filename.trim(),
    format,
    mimeType: format === 'html' ? 'text/html;charset=utf-8' : format === 'csv' ? 'text/csv;charset=utf-8' : 'text/plain;charset=utf-8',
    sampleCount,
    channelCount,
  };
}
