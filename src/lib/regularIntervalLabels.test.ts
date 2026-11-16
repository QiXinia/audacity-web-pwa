import { describe, expect, it } from 'vitest';
import {
  createRegularIntervalLabels,
  DEFAULT_REGULAR_INTERVAL_LABELS_SETTINGS,
  MAX_REGULAR_INTERVAL_LABELS,
  validateRegularIntervalLabelsSettings,
  type RegularIntervalLabelsSettings,
} from './regularIntervalLabels';

function settings(overrides: Partial<RegularIntervalLabelsSettings> = {}): RegularIntervalLabelsSettings {
  return { ...DEFAULT_REGULAR_INTERVAL_LABELS_SETTINGS, ...overrides };
}

describe('Audacity Regular interval labels layout modes', () => {
  it('uses the explicit count and interval together in Number and Interval mode', () => {
    const result = createRegularIntervalLabels({ start: 5, end: 7 }, settings({
      mode: 'both', totalNumber: 3, interval: 0.5, labelText: 'Cue ', numbering: 2, firstNumber: 9,
    }));
    expect(result.interval).toBe(0.5);
    expect(result.labels).toEqual([
      { start: 5, end: 5, text: '09Cue ' },
      { start: 5.5, end: 5.5, text: '10Cue ' },
      { start: 6, end: 6, text: '11Cue ' },
    ]);
  });

  it('fits point labels across the selection in Number of Labels mode', () => {
    const result = createRegularIntervalLabels({ start: 2, end: 3 }, settings({
      mode: 'number', totalNumber: 4, regionLength: 0, numbering: 0, labelText: 'Mark',
    }));
    expect(result.labels.map((label) => label.start)).toEqual([2, 2.25, 2.5, 2.75]);
    expect(result.labels.every((label) => label.start === label.end && label.text === 'Mark')).toBe(true);
  });

  it('subtracts region length before distributing region labels', () => {
    const result = createRegularIntervalLabels({ start: 0, end: 1 }, settings({
      mode: 'number', totalNumber: 3, regionLength: 0.1,
    }));
    expect(result.interval).toBeCloseTo(0.45, 12);
    expect(result.labels[0]).toMatchObject({ start: 0, end: 0.1 });
    expect(result.labels[1].start).toBeCloseTo(0.45, 12);
    expect(result.labels[2].start).toBeCloseTo(0.9, 12);
    expect(result.labels[2].end).toBeCloseTo(1, 12);
  });

  it('ceil-divides only when an unadjusted interval does not exactly fit', () => {
    const partial = createRegularIntervalLabels({ start: 0, end: 1 }, settings({
      mode: 'interval', interval: 0.3, adjustToFit: false,
    }));
    expect(partial.labels.map((label) => label.start)).toEqual([0, 0.3, 0.6, 0.8999999999999999]);
    const exact = createRegularIntervalLabels({ start: 0, end: 0.5 }, settings({
      mode: 'interval', interval: 0.25, adjustToFit: false,
    }));
    expect(exact.labels.map((label) => label.start)).toEqual([0, 0.25]);
  });

  it('chooses the nearest adjusted interval and appends the official region endpoint', () => {
    const result = createRegularIntervalLabels({ start: 0, end: 0.1 }, settings({
      mode: 'interval', interval: 0.03, regionLength: 0.02, adjustToFit: true,
      totalNumber: 999, labelText: 'R', numbering: 4,
    }));
    expect(result.interval).toBeCloseTo(0.08 / 3, 12);
    expect(result.labels).toHaveLength(4);
    expect(result.labels.map((label) => label.text)).toEqual(['R1', 'R2', 'R3', 'R4']);
    expect(result.labels[1].start).toBeCloseTo(0.08 / 3, 12);
    expect(result.labels[3]).toMatchObject({ start: 0.08, end: 0.1, text: 'R4' });
  });

  it('returns the official insufficient-space error without labels', () => {
    const result = createRegularIntervalLabels({ start: 0, end: 0.02 }, settings({
      mode: 'interval', interval: 0.01, regionLength: 0.02, adjustToFit: false,
    }));
    expect(result.labels).toEqual([]);
    expect(result.completion).toEqual({
      type: 'error', message: 'Error: There is insufficient space to create labels.',
    });
  });
});

describe('Regular interval labels numbering, messages and limits', () => {
  it('supports text-only, before and after numbering with zero padding', () => {
    const common = { mode: 'both', totalNumber: 2, interval: 1, firstNumber: 8, labelText: 'Cue' } as const;
    expect(createRegularIntervalLabels({ start: 0, end: 1 }, settings({ ...common, numbering: 0 }))
      .labels.map((label) => label.text)).toEqual(['Cue', 'Cue']);
    expect(createRegularIntervalLabels({ start: 0, end: 1 }, settings({ ...common, numbering: 3 }))
      .labels.map((label) => label.text)).toEqual(['008Cue', '009Cue']);
    expect(createRegularIntervalLabels({ start: 0, end: 1 }, settings({ ...common, numbering: 6 }))
      .labels.map((label) => label.text)).toEqual(['Cue008', 'Cue009']);
  });

  it('reports overlap according to Details, Warnings only and None', () => {
    const overlap = settings({ mode: 'both', totalNumber: 2, interval: 0.25, regionLength: 0.5 });
    const details = createRegularIntervalLabels({ start: 0, end: 1 }, overlap).completion;
    expect(details?.type).toBe('warning');
    expect(details?.message).toContain('Warning: Overlapping region labels.');
    expect(details?.message).toContain('2 region labels at intervals of 0.25 seconds.');
    expect(details?.message).toContain('Region length = 0.5 seconds.');
    expect(createRegularIntervalLabels({ start: 0, end: 1 }, settings({ ...overlap, verbosity: 'warnings' }))
      .completion?.message).toBe('Warning: Overlapping region labels.');
    expect(createRegularIntervalLabels({ start: 0, end: 1 }, settings({ ...overlap, verbosity: 'none' }))
      .completion).toBeNull();
  });

  it('rejects invalid controls and the official one-region division-by-zero case', () => {
    expect(() => validateRegularIntervalLabelsSettings(settings({ totalNumber: 0 }))).toThrow('Number of labels');
    expect(() => validateRegularIntervalLabelsSettings(settings({ interval: 0.0009 }))).toThrow('Label interval');
    expect(() => validateRegularIntervalLabelsSettings(settings({ regionLength: -1 }))).toThrow('Length of label region');
    expect(() => validateRegularIntervalLabelsSettings(settings({ firstNumber: -1 }))).toThrow('Begin numbering from');
    expect(() => validateRegularIntervalLabelsSettings(settings({ mode: 'number', totalNumber: 1, regionLength: 0.1 })))
      .toThrow('至少需要 2 个标签');
  });

  it('caps unadjusted interval output before allocating a huge label list', () => {
    expect(() => createRegularIntervalLabels({ start: 0, end: MAX_REGULAR_INTERVAL_LABELS + 1 }, settings({
      mode: 'interval', interval: 0.001, regionLength: 0, adjustToFit: false,
    }))).toThrow(`一次最多创建 ${MAX_REGULAR_INTERVAL_LABELS} 个标签`);
  });
});
