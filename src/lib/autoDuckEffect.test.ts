import { describe, expect, it } from 'vitest';
import {
  AUTO_DUCK_RMS_WINDOW_SIZE,
  DEFAULT_AUTO_DUCK_SETTINGS,
  applyAutoDuckPlanToChannels,
  createAutoDuckPlan,
  processAutoDuckChannels,
  renderAutoDuckSelectionChannels,
  validateAutoDuckSettings,
  type AutoDuckSettings,
} from './autoDuckEffect';

const settings = (overrides: Partial<AutoDuckSettings> = {}): AutoDuckSettings => ({
  ...DEFAULT_AUTO_DUCK_SETTINGS,
  ...overrides,
});

const db = (value: number) => 10 ** (value / 20);

describe('Audacity 4.0.2 Auto Duck settings', () => {
  it('matches every official default and the RMS window', () => {
    expect(DEFAULT_AUTO_DUCK_SETTINGS).toEqual({
      duckAmountDb: -12,
      maximumPause: 1,
      outerFadeDownLen: 0.5,
      outerFadeUpLen: 0.5,
      innerFadeDownLen: 0,
      innerFadeUpLen: 0,
      thresholdDb: -30,
    });
    expect(AUTO_DUCK_RMS_WINDOW_SIZE).toBe(100);
  });

  it.each([
    [{ duckAmountDb: -24.1 }, '压降量'],
    [{ maximumPause: -0.1 }, '最大暂停'],
    [{ outerFadeDownLen: 3.1 }, '外部淡出'],
    [{ outerFadeUpLen: Number.NaN }, '外部淡入'],
    [{ innerFadeDownLen: -1 }, '内部淡出'],
    [{ innerFadeUpLen: 4 }, '内部淡入'],
    [{ thresholdDb: -101 }, '阈值'],
  ])('rejects invalid parameter %o', (override, message) => {
    expect(() => validateAutoDuckSettings(settings(override as Partial<AutoDuckSettings>))).toThrow(message);
  });
});

describe('Auto Duck control-track region detection', () => {
  it('matches the official strict RMS threshold and outer fade offsets', () => {
    const control = new Float32Array(150);
    control.fill(1, 8, 12);
    const plan = createAutoDuckPlan(control, settings({
      thresholdDb: -20,
      maximumPause: 0.3,
      outerFadeDownLen: 0.2,
      outerFadeUpLen: 0.2,
    }), 10);
    // At index 8 rmsSum == threshold, so the strict > comparison starts at 9.
    // Maximum pause is raised to outerDown + outerUp = four samples.
    // The 100-sample window retains the short burst until indices 110–111.
    expect(plan).toEqual([{ startSample: 7, endSample: 111 }]);
  });

  it('merges pauses shorter than maximum pause and splits longer pauses', () => {
    const control = new Float32Array(400);
    control.fill(1, 10, 22);
    control.fill(1, 123, 135);
    control.fill(1, 300, 312);
    const merged = createAutoDuckPlan(control, settings({
      thresholdDb: -20,
      maximumPause: 0.5,
      outerFadeDownLen: 0,
      outerFadeUpLen: 0,
    }), 10);
    expect(merged).toHaveLength(2);
    const split = createAutoDuckPlan(control, settings({
      thresholdDb: -20,
      maximumPause: 0.2,
      outerFadeDownLen: 0,
      outerFadeUpLen: 0,
    }), 10);
    expect(split).toHaveLength(3);
  });

  it('uses only the rendered first control channel and silent track gaps', () => {
    const rendered = renderAutoDuckSelectionChannels([
      {
        startTime: 0,
        duration: 0.5,
        sourceOffset: 0,
        sampleData: [new Float32Array(5), new Float32Array(5).fill(1)],
      },
      {
        startTime: 1,
        duration: 0.5,
        sourceOffset: 0,
        sampleData: [new Float32Array(5), new Float32Array(5)],
      },
    ], { start: 0, end: 1.5 }, 10);
    expect(rendered).toHaveLength(2);
    expect(Array.from(rendered[0])).toEqual(new Array(15).fill(0));
    expect(Array.from(rendered[1])).toEqual([
      1, 1, 1, 1, 1,
      0, 0, 0, 0, 0,
      0, 0, 0, 0, 0,
    ]);
    expect(createAutoDuckPlan(rendered[0], settings(), 10)).toEqual([]);
  });

  it('returns no regions when outer fades consume the whole selection', () => {
    expect(createAutoDuckPlan(new Float32Array(10).fill(1), settings({
      outerFadeDownLen: 0.5,
      outerFadeUpLen: 0.5,
    }), 10)).toEqual([]);
    expect(createAutoDuckPlan(new Float32Array(0), settings(), 44100)).toEqual([]);
  });
});

describe('Auto Duck exponential gain application', () => {
  it('matches the official max(gainDown, gainUp) curve on every target channel', () => {
    const left = new Float32Array(30).fill(1);
    const right = new Float32Array(30).fill(0.5);
    const actual = applyAutoDuckPlanToChannels(
      [left, right],
      [{ startSample: 7, endSample: 13 }],
      settings({
        duckAmountDb: -12,
        outerFadeDownLen: 0.2,
        outerFadeUpLen: 0.2,
        innerFadeDownLen: 0.1,
        innerFadeUpLen: 0.1,
      }),
      10,
    );
    const expected = [1, db(-4), db(-8), db(-12), db(-8), db(-4)];
    expected.forEach((value, index) => {
      expect(actual[0][index + 7]).toBeCloseTo(value, 6);
      expect(actual[1][index + 7]).toBeCloseTo(0.5 * value, 6);
    });
    expect(actual[0][6]).toBe(1);
    expect(actual[0][13]).toBe(1);
    expect(left[9]).toBe(1);
    expect(right[9]).toBe(0.5);
  });

  it('keeps region coordinates aligned when processing split target clips', () => {
    const whole = processAutoDuckChannels(
      [new Float32Array(30).fill(1)],
      Float32Array.from({ length: 30 }, (_, index) => (index >= 8 && index < 12 ? 1 : 0)),
      settings({ thresholdDb: -20, maximumPause: 0.3, outerFadeDownLen: 0.2, outerFadeUpLen: 0.2 }),
      10,
    )[0];
    const plan = createAutoDuckPlan(
      Float32Array.from({ length: 30 }, (_, index) => (index >= 8 && index < 12 ? 1 : 0)),
      settings({ thresholdDb: -20, maximumPause: 0.3, outerFadeDownLen: 0.2, outerFadeUpLen: 0.2 }),
      10,
    );
    const first = applyAutoDuckPlanToChannels(
      [new Float32Array(15).fill(1)], plan,
      settings({ thresholdDb: -20, maximumPause: 0.3, outerFadeDownLen: 0.2, outerFadeUpLen: 0.2 }), 10,
    )[0];
    const second = applyAutoDuckPlanToChannels(
      [new Float32Array(15).fill(1)], plan,
      settings({ thresholdDb: -20, maximumPause: 0.3, outerFadeDownLen: 0.2, outerFadeUpLen: 0.2 }), 10, 15,
    )[0];
    expect(Array.from(first).concat(Array.from(second))).toEqual(Array.from(whole));
  });

  it('shares one gain envelope across stereo and leaves silence unchanged', () => {
    const control = new Float32Array(200).fill(1);
    const actual = processAutoDuckChannels([
      new Float32Array(200), new Float32Array(200),
    ], control, settings(), 100);
    expect(actual[0].every((value) => value === 0)).toBe(true);
    expect(actual[1]).toEqual(actual[0]);
  });

  it('rejects malformed channels, plans, and non-finite PCM', () => {
    expect(() => processAutoDuckChannels([], new Float32Array(1), settings(), 10)).toThrow('至少需要');
    expect(() => processAutoDuckChannels(
      [new Float32Array(2), new Float32Array(1)], new Float32Array(2), settings(), 10,
    )).toThrow('等长');
    expect(() => processAutoDuckChannels(
      [new Float32Array(2)], new Float32Array(3), settings(), 10,
    )).toThrow('必须等长');
    expect(() => processAutoDuckChannels(
      [new Float32Array(2)], new Float32Array(2), settings(), 0,
    )).toThrow('采样率');
    expect(() => createAutoDuckPlan(
      Float32Array.from([0, Number.NaN, 0]), settings({ outerFadeDownLen: 0, outerFadeUpLen: 0 }), 10,
    )).toThrow('非有限');
    expect(() => applyAutoDuckPlanToChannels(
      [new Float32Array(3)],
      [{ startSample: 2, endSample: 1 }],
      settings(),
      10,
    )).toThrow('有序');
  });
});
