import { describe, expect, it } from 'vitest';
import type { IClip, ITrack } from '@/types/project';
import {
  DEFAULT_FILTER_CURVE_EQ_SETTINGS,
  FILTER_CURVE_EQ_MAX_FILTER_LENGTH,
  FILTER_CURVE_EQ_PRESETS,
  FILTER_CURVE_EQ_WINDOW_SIZE,
  createFilterCurveEqPlan,
  evaluateFilterCurveDb,
  isFilterCurveEqBypassed,
  processFilterCurveEqChannels,
  processFilterCurveEqTrack,
  validateFilterCurveEqSettings,
  type FilterCurveEqSettings,
  type FilterCurveEqTrackInput,
} from './filterCurveEffect';

const custom: FilterCurveEqSettings = {
  points: [{ frequency: 100, gainDb: 9 }, { frequency: 500, gainDb: 0 }],
  filterLength: 127,
  linearFrequencyScale: false,
};

function noise(length: number, seed = 0x12345678): Float32Array {
  const result = new Float32Array(length);
  let state = seed >>> 0;
  for (let index = 0; index < length; index += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    result[index] = Math.fround((state / 0x100000000 - 0.5) * 0.3);
  }
  return result;
}

function clip(id: string, startTime: number, duration: number, offset: number): IClip {
  return {
    id, audioBufferId: `buffer-${id}`, startTime, duration, offset,
    originalDuration: duration, stretchRatio: 1, gain: 0, fadeIn: 0, fadeOut: 0, name: id,
  };
}

describe('Filter Curve EQ parameters and envelope', () => {
  it('uses Audacity defaults and all ten factory presets', () => {
    expect(DEFAULT_FILTER_CURVE_EQ_SETTINGS).toEqual({
      points: [], filterLength: 8191, linearFrequencyScale: false,
    });
    expect(FILTER_CURVE_EQ_PRESETS).toHaveLength(10);
    expect(FILTER_CURVE_EQ_PRESETS.find(({ name }) => name === 'Bass Boost')?.points).toEqual(custom.points);
    expect(isFilterCurveEqBypassed(DEFAULT_FILTER_CURVE_EQ_SETTINGS as FilterCurveEqSettings)).toBe(true);
    expect(isFilterCurveEqBypassed(custom)).toBe(false);
  });

  it('interpolates dB in log and linear frequency space with clamped endpoints', () => {
    const points = [{ frequency: 10, gainDb: 0 }, { frequency: 100, gainDb: 10 }];
    expect(evaluateFilterCurveDb(points, 20, 8000, false)).toBeCloseTo(10 * Math.log10(2), 12);
    expect(evaluateFilterCurveDb(points, 1, 8000, false)).toBeCloseTo(10 * Math.log10(2), 12);
    expect(evaluateFilterCurveDb(points, 1000, 8000, false)).toBe(10);
    expect(evaluateFilterCurveDb([
      { frequency: 20, gainDb: 0 }, { frequency: 220, gainDb: 20 },
    ], 120, 8000, true)).toBe(10);
    expect(evaluateFilterCurveDb([], 100, 8000, false)).toBe(0);
  });

  it('rejects invalid lengths, duplicate points, bad rates and non-finite input', () => {
    for (const filterLength of [20, 22, 8193, 21.5]) {
      expect(() => validateFilterCurveEqSettings({ ...custom, filterLength })).toThrow(/奇数/);
    }
    expect(() => validateFilterCurveEqSettings({ ...custom, points: [
      { frequency: 100, gainDb: 0 }, { frequency: 100, gainDb: 2 },
    ] })).toThrow(/不能重复/);
    expect(() => createFilterCurveEqPlan(custom, 40)).toThrow(/采样率/);
    const input = noise(32); input[3] = Number.NaN;
    expect(() => processFilterCurveEqChannels([input], custom, 8000)).toThrow(/非有限值/);
    expect(() => processFilterCurveEqChannels([], custom, 8000)).toThrow(/非空且等长/);
  });

  it('builds the official 16384-point/default-8191-tap FIR and rejects a stale plan', () => {
    const plan = createFilterCurveEqPlan(custom, 8000)!;
    expect(plan.impulse).toHaveLength(127);
    expect(plan.filterReal).toHaveLength(FILTER_CURVE_EQ_WINDOW_SIZE);
    expect(plan.filterImaginary[FILTER_CURVE_EQ_WINDOW_SIZE / 2]).toBe(0);
    const defaultPlan = createFilterCurveEqPlan({
      ...custom, filterLength: FILTER_CURVE_EQ_MAX_FILTER_LENGTH,
    }, 8000)!;
    expect(defaultPlan.impulse).toHaveLength(8191);
    expect(() => processFilterCurveEqChannels([noise(32)], custom, 8000, defaultPlan)).toThrow(/计划.*不一致/);
  });
});

describe('Filter Curve EQ PCM and track mapping', () => {
  it('preserves source arrays and channel lengths while sharing one FIR across stereo', () => {
    const left = noise(300), right = noise(300, 0x87654321);
    const source = [left, right];
    const snapshots = source.map((channel) => new Float32Array(channel));
    const plan = createFilterCurveEqPlan(custom, 8000);
    const output = processFilterCurveEqChannels(source, custom, 8000, plan);
    expect(output).toHaveLength(2);
    expect(output.every((channel) => channel.length === 300)).toBe(true);
    expect(source[0]).toEqual(snapshots[0]);
    expect(source[1]).toEqual(snapshots[1]);
    expect(output[0]).not.toEqual(left);
    expect(output.every((channel) => channel.every(Number.isFinite))).toBe(true);
  });

  it('returns an exact copy for a flat curve without running the filter', () => {
    const input = noise(100);
    const output = processFilterCurveEqChannels([input], {
      ...custom, points: [{ frequency: 20, gainDb: 0 }, { frequency: 1000, gainDb: -0 }],
    }, 8000);
    expect(output[0]).toEqual(input);
    expect(output[0]).not.toBe(input);
  });

  it('keeps the original length across a two-block overlap-add seam', () => {
    const settings = { ...custom, filterLength: 21 };
    const input = noise(FILTER_CURVE_EQ_WINDOW_SIZE - 20 + 37);
    const plan = createFilterCurveEqPlan(settings, 8000)!;
    const output = processFilterCurveEqChannels([input], settings, 8000, plan)[0];
    expect(output).toHaveLength(input.length);
    const centre = 10;
    for (const index of [0, 10, 16363, 16364, 16365, input.length - 1]) {
      let expected = 0;
      for (let tap = 0; tap < 21; tap += 1) {
        const source = index + centre - tap;
        if (source >= 0 && source < input.length) expected += plan.impulse[tap] * input[source];
      }
      expect(output[index]).toBeCloseTo(expected, 4);
    }
  });

  it('assembles gaps as silence and maps processed PCM back to each source offset', () => {
    const sampleRate = 1000;
    const track: ITrack = {
      id: 'track', name: 'Track', type: 'audio', gain: 0, pan: 0, muted: false, solo: false,
      armed: false, color: '', effects: [], clips: [clip('a', 0, 1, 0.1), clip('b', 1.5, 1, 0.2)],
    };
    const target: FilterCurveEqTrackInput = {
      trackId: 'track', clips: [
        { clipId: 'a', sampleData: [noise(1100)], sourceOffset: 0.1 },
        { clipId: 'b', sampleData: [noise(1200, 0x10203040)], sourceOffset: 0.2 },
      ],
    };
    const selection = { start: 0.25, end: 2.25 };
    const assembled = new Float32Array(2000);
    assembled.set(target.clips[0].sampleData[0].subarray(350, 1100), 0);
    assembled.set(target.clips[1].sampleData[0].subarray(200, 950), 1250);
    expect(assembled.subarray(750, 1250).every((value) => value === 0)).toBe(true);
    const expected = processFilterCurveEqChannels([assembled], custom, sampleRate)[0];
    const result = processFilterCurveEqTrack(track, target, selection, custom, sampleRate);
    expect(result.selectionChannels[0]).toEqual(expected);
    expect(result.clips.map(({ clipId }) => clipId)).toEqual(['a', 'b']);
    expect(result.clips[0].sampleData[0].subarray(350, 1100)).toEqual(expected.subarray(0, 750));
    expect(result.clips[0].sampleData[0].subarray(0, 350)).toEqual(target.clips[0].sampleData[0].subarray(0, 350));
    expect(result.clips[1].sampleData[0].subarray(200, 950)).toEqual(expected.subarray(1250));
    expect(result.clips[1].sampleData[0].subarray(950)).toEqual(target.clips[1].sampleData[0].subarray(950));
    expect(target.clips[0].sampleData[0]).toEqual(noise(1100));
  });

  it('requires complete unique targets and a positive selection overlap', () => {
    const track: ITrack = {
      id: 'track', name: 'Track', type: 'audio', gain: 0, pan: 0, muted: false, solo: false,
      armed: false, color: '', effects: [], clips: [clip('a', 0, 1, 0)],
    };
    const target = { trackId: 'track', clips: [{ clipId: 'a', sampleData: [noise(1000)], sourceOffset: 0 }] };
    expect(() => processFilterCurveEqTrack(track, target, { start: 2, end: 3 }, custom, 1000)).toThrow(/没有有效重叠/);
    expect(() => processFilterCurveEqTrack(track, { trackId: 'track', clips: [] }, { start: 0, end: 1 }, custom, 1000)).toThrow(/完整轨道/);
    expect(() => processFilterCurveEqTrack(track, {
      trackId: 'track', clips: [target.clips[0], target.clips[0]],
    }, { start: 0, end: 1 }, custom, 1000)).toThrow(/不可用或重复/);
  });
});
