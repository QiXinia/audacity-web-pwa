import type { GeneratorSelection } from '@/lib/generatorEditing';

// Audacity 4.0.2 share/nyquist-plug-ins/equalabel.ny controls and defaults.
export type RegularIntervalMode = 'both' | 'number' | 'interval';
export type RegularIntervalNumbering = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export type RegularIntervalVerbosity = 'details' | 'warnings' | 'none';

export interface RegularIntervalLabelsSettings {
  mode: RegularIntervalMode;
  totalNumber: number;
  interval: number;
  regionLength: number;
  adjustToFit: boolean;
  labelText: string;
  numbering: RegularIntervalNumbering;
  firstNumber: number;
  verbosity: RegularIntervalVerbosity;
}

export const DEFAULT_REGULAR_INTERVAL_LABELS_SETTINGS: Readonly<RegularIntervalLabelsSettings> = Object.freeze({
  mode: 'both',
  totalNumber: 10,
  interval: 10,
  regionLength: 0,
  adjustToFit: false,
  labelText: 'Label',
  numbering: 2,
  firstNumber: 1,
  verbosity: 'details',
});

export const MAX_REGULAR_INTERVAL_LABELS = 10_000;

export interface RegularIntervalLabel {
  start: number;
  end: number;
  text: string;
}

export interface RegularIntervalLabelsResult {
  labels: RegularIntervalLabel[];
  interval: number;
  completion: { type: 'error' | 'warning' | 'success'; message: string } | null;
}

export function validateRegularIntervalLabelsSettings(settings: RegularIntervalLabelsSettings): void {
  if (!['both', 'number', 'interval'].includes(settings.mode)) {
    throw new RangeError('Create labels based on 无效');
  }
  if (!Number.isSafeInteger(settings.totalNumber) || settings.totalNumber < 1 || settings.totalNumber > 1000) {
    throw new RangeError('Number of labels 必须是 1 到 1000 之间的整数');
  }
  if (!Number.isFinite(settings.interval) || settings.interval < 0.001 || settings.interval > 3600) {
    throw new RangeError('Label interval 必须在 0.001 到 3600 秒之间');
  }
  if (!Number.isFinite(settings.regionLength) || settings.regionLength < 0 || settings.regionLength > 3600) {
    throw new RangeError('Length of label region 必须在 0 到 3600 秒之间');
  }
  if (typeof settings.adjustToFit !== 'boolean') throw new RangeError('Adjust label interval to fit length 无效');
  if (typeof settings.labelText !== 'string') throw new RangeError('Label text 必须是字符串');
  if (!Number.isInteger(settings.numbering) || settings.numbering < 0 || settings.numbering > 6) {
    throw new RangeError('Minimum number of digits in label 无效');
  }
  if (!Number.isSafeInteger(settings.firstNumber) || settings.firstNumber < 0) {
    throw new RangeError('Begin numbering from 必须是非负安全整数');
  }
  if (!['details', 'warnings', 'none'].includes(settings.verbosity)) {
    throw new RangeError('Message on completion 无效');
  }
  if (settings.mode === 'number' && settings.regionLength > 0 && settings.totalNumber === 1) {
    throw new RangeError('Number of Labels 模式下，区域标签至少需要 2 个标签以计算间隔');
  }
}

function formatLabelText(settings: RegularIntervalLabelsSettings, value: number): string {
  if (!Number.isSafeInteger(value)) throw new RangeError('标签编号超出 JavaScript 安全整数范围');
  if (settings.numbering === 0) return settings.labelText;
  const digits = ((settings.numbering - 1) % 3) + 1;
  const numberText = String(value).padStart(digits, '0');
  return settings.numbering <= 3
    ? `${numberText}${settings.labelText}`
    : `${settings.labelText}${numberText}`;
}

function intervalCount(safeDuration: number, settings: RegularIntervalLabelsSettings): number {
  if (!settings.adjustToFit) {
    const count = Math.trunc(safeDuration / settings.interval);
    return count * settings.interval < safeDuration ? count + 1 : count;
  }
  const minimum = Math.trunc(safeDuration / settings.interval);
  const maximum = minimum + 1;
  if (
    minimum > 0
    && Math.abs(settings.interval - safeDuration / minimum)
      < Math.abs(settings.interval - safeDuration / maximum)
  ) return minimum;
  return maximum;
}

function completionMessage(
  count: number,
  interval: number,
  settings: RegularIntervalLabelsSettings,
): RegularIntervalLabelsResult['completion'] {
  if (settings.verbosity === 'none') return null;
  if (count === 0) {
    return { type: 'error', message: 'Error: There is insufficient space to create labels.' };
  }
  const overlap = settings.regionLength > interval;
  if (settings.verbosity === 'warnings') {
    return overlap ? { type: 'warning', message: 'Warning: Overlapping region labels.' } : null;
  }
  const labelType = settings.regionLength > 0 ? 'region labels' : 'point labels';
  const warning = overlap ? 'Warning: Overlapping region labels.\n' : '';
  const region = settings.regionLength > 0 ? `\nRegion length = ${settings.regionLength} seconds.` : '';
  return {
    type: overlap ? 'warning' : 'success',
    message: `${warning}${count} ${labelType} at intervals of ${interval} seconds.${region}`,
  };
}

/** Generate one Audacity-style label set relative to the current time selection. */
export function createRegularIntervalLabels(
  selection: GeneratorSelection,
  settings: RegularIntervalLabelsSettings,
): RegularIntervalLabelsResult {
  validateRegularIntervalLabelsSettings(settings);
  if (!Number.isFinite(selection.start) || selection.start < 0) {
    throw new RangeError('Regular interval labels 选区起点必须是非负有限时间');
  }
  if (!Number.isFinite(selection.end) || selection.end <= selection.start) {
    throw new RangeError('Regular interval labels 需要有效的正长度时间选区');
  }

  const duration = selection.end - selection.start;
  const safeDuration = Math.max(0, duration - settings.regionLength);
  let total = settings.totalNumber;
  let actualInterval = settings.interval;

  if (settings.mode === 'number') {
    actualInterval = settings.regionLength === 0
      ? safeDuration / total
      : safeDuration / (total - 1);
  } else if (settings.mode === 'interval') {
    total = intervalCount(safeDuration, settings);
    if (settings.adjustToFit && total > 0) actualInterval = safeDuration / total;
  }

  if (!Number.isFinite(actualInterval) || actualInterval < 0) {
    throw new RangeError('无法根据当前选区和参数计算有限的标签间隔');
  }
  const appendEndpoint = settings.regionLength > 0 && settings.mode === 'interval' && settings.adjustToFit;
  const outputCount = total > 0 ? total + (appendEndpoint ? 1 : 0) : 0;
  if (outputCount > MAX_REGULAR_INTERVAL_LABELS) {
    throw new RangeError(`Regular interval labels 一次最多创建 ${MAX_REGULAR_INTERVAL_LABELS} 个标签`);
  }
  if (outputCount > 0) {
    const lastNumber = settings.firstNumber + outputCount - 1;
    if (!Number.isSafeInteger(lastNumber)) throw new RangeError('标签编号超出 JavaScript 安全整数范围');
  }

  const labels: RegularIntervalLabel[] = [];
  for (let count = 0; count < total; count += 1) {
    const relativeStart = count * actualInterval;
    labels.push({
      start: selection.start + relativeStart,
      end: selection.start + relativeStart + settings.regionLength,
      text: formatLabelText(settings, settings.firstNumber + count),
    });
  }
  if (appendEndpoint && total > 0) {
    labels.push({
      start: selection.start + safeDuration,
      end: selection.start + safeDuration + settings.regionLength,
      text: formatLabelText(settings, settings.firstNumber + total),
    });
  }

  return {
    labels,
    interval: actualInterval,
    completion: completionMessage(labels.length, actualInterval, settings),
  };
}
