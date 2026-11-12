import { describe, expect, it } from 'vitest';
import type { IClip, ITrack } from '@/types/project';
import {
  DEFAULT_GRAPHIC_EQ_SETTINGS,
  GRAPHIC_EQ_BAND_COUNT,
  GRAPHIC_EQ_FILTER_LENGTH,
  GRAPHIC_EQ_FREQUENCIES,
  createGraphicEqPlan,
  evaluateGraphicEqDb,
  graphicEqBandsInUse,
  isGraphicEqBypassed,
  processGraphicEqChannels,
  processGraphicEqTrack,
  validateGraphicEqSettings,
  type GraphicEqSettings,
  type GraphicEqTrackInput,
} from './graphicEqEffect';

const flatGains = () => Array(GRAPHIC_EQ_BAND_COUNT).fill(0) as number[];
const activeGains = () => flatGains().map((_, index) => index === 17 ? 12 : 0);
const active = (): GraphicEqSettings => ({ gainsDb: activeGains() });

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

describe('Graphic EQ bands and B-spline envelope', () => {
  it('uses the official 31 third-octave bands, fixed 8191 taps and ±25 dB range', () => {
    expect(GRAPHIC_EQ_FREQUENCIES).toHaveLength(31);
    expect(GRAPHIC_EQ_FREQUENCIES[17]).toBe(1000);
    expect(GRAPHIC_EQ_FILTER_LENGTH).toBe(8191);
    expect(DEFAULT_GRAPHIC_EQ_SETTINGS.gainsDb).toEqual(flatGains());
    expect(isGraphicEqBypassed(DEFAULT_GRAPHIC_EQ_SETTINGS as GraphicEqSettings)).toBe(true);
    expect(isGraphicEqBypassed(active())).toBe(false);
    expect(graphicEqBandsInUse(8000)).toBe(24);
    expect(graphicEqBandsInUse(44100)).toBe(31);
  });

  it('matches the official B-spline at a slider, midpoint and clamped endpoints', () => {
    expect(evaluateGraphicEqDb(activeGains(), 1000, 44100)).toBeCloseTo(9, 12);
    expect(evaluateGraphicEqDb(activeGains(), Math.sqrt(1000 * 1250), 44100)).toBeCloseTo(6, 12);
    expect(evaluateGraphicEqDb(activeGains(), 2000, 44100)).toBe(0);
    const low = flatGains(); low[0] = 12;
    expect(evaluateGraphicEqDb(low, 20, 44100)).toBeCloseTo(9, 12);
    expect(evaluateGraphicEqDb(low, 0, 44100)).toBeCloseTo(9, 12);
    const high = flatGains(); high[23] = 12;
    expect(evaluateGraphicEqDb(high, 4000, 8000)).toBeCloseTo(9, 12);
    expect(evaluateGraphicEqDb(high, 5000, 8000)).toBeCloseTo(9, 12);
  });

  it('rejects wrong band counts, out-of-range values, invalid rates and stale plans', () => {
    expect(() => validateGraphicEqSettings({ gainsDb: [0] })).toThrow(/31/);
    for (const gain of [-25.1, 25.1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const gains = flatGains(); gains[3] = gain;
      expect(() => validateGraphicEqSettings({ gainsDb: gains })).toThrow(/−25 至 25/);
    }
    expect(() => createGraphicEqPlan(active(), 49)).toThrow(/至少 50 Hz/);
    const plan = createGraphicEqPlan(active(), 8000)!;
    expect(plan.impulse).toHaveLength(8191);
    expect(() => processGraphicEqChannels([noise(32)], active(), 44100, plan)).toThrow(/计划.*不一致/);
  });
});

describe('Graphic EQ PCM and track mapping', () => {
  it('returns exact copies for a flat setting without running the filter', () => {
    const input = noise(100);
    const output = processGraphicEqChannels([input], DEFAULT_GRAPHIC_EQ_SETTINGS as GraphicEqSettings, 8000);
    expect(output[0]).toEqual(input);
    expect(output[0]).not.toBe(input);
  });

  it('processes stereo with one FIR, preserves inputs and rejects non-finite PCM', () => {
    const left = noise(300), right = noise(300, 0x87654321);
    const snapshots = [new Float32Array(left), new Float32Array(right)];
    const plan = createGraphicEqPlan(active(), 8000);
    const output = processGraphicEqChannels([left, right], active(), 8000, plan);
    expect(output).toHaveLength(2);
    expect(output.every((channel) => channel.length === 300 && channel.every(Number.isFinite))).toBe(true);
    expect([left, right]).toEqual(snapshots);
    expect(output[0]).not.toEqual(left);
    const invalid = noise(32); invalid[4] = Number.NaN;
    expect(() => processGraphicEqChannels([invalid], active(), 8000, plan)).toThrow(/Graphic EQ.*非有限值/);
  });

  it('assembles gaps as silence and maps processed PCM back to source offsets', () => {
    const sampleRate = 1000;
    const track: ITrack = {
      id: 'track', name: 'Track', type: 'audio', gain: 0, pan: 0, muted: false, solo: false,
      armed: false, color: '', effects: [], clips: [clip('a', 0, 1, 0.1), clip('b', 1.5, 1, 0.2)],
    };
    const target: GraphicEqTrackInput = {
      trackId: 'track', clips: [
        { clipId: 'a', sampleData: [noise(1100)], sourceOffset: 0.1 },
        { clipId: 'b', sampleData: [noise(1200, 0x10203040)], sourceOffset: 0.2 },
      ],
    };
    const selection = { start: 0.25, end: 2.25 };
    const assembled = new Float32Array(2000);
    assembled.set(target.clips[0].sampleData[0].subarray(350, 1100), 0);
    assembled.set(target.clips[1].sampleData[0].subarray(200, 950), 1250);
    const expected = processGraphicEqChannels([assembled], active(), sampleRate)[0];
    const result = processGraphicEqTrack(track, target, selection, active(), sampleRate);
    expect(result.selectionChannels[0]).toEqual(expected);
    expect(result.clips[0].sampleData[0].subarray(350, 1100)).toEqual(expected.subarray(0, 750));
    expect(result.clips[0].sampleData[0].subarray(0, 350)).toEqual(target.clips[0].sampleData[0].subarray(0, 350));
    expect(result.clips[1].sampleData[0].subarray(200, 950)).toEqual(expected.subarray(1250));
    expect(result.clips[1].sampleData[0].subarray(950)).toEqual(target.clips[1].sampleData[0].subarray(950));
  });

  it('requires complete unique targets and a positive selection overlap', () => {
    const track: ITrack = {
      id: 'track', name: 'Track', type: 'audio', gain: 0, pan: 0, muted: false, solo: false,
      armed: false, color: '', effects: [], clips: [clip('a', 0, 1, 0)],
    };
    const target = { trackId: 'track', clips: [{ clipId: 'a', sampleData: [noise(1000)], sourceOffset: 0 }] };
    expect(() => processGraphicEqTrack(track, target, { start: 2, end: 3 }, active(), 1000)).toThrow(/没有有效重叠/);
    expect(() => processGraphicEqTrack(track, { trackId: 'track', clips: [] }, { start: 0, end: 1 }, active(), 1000)).toThrow(/完整轨道/);
    expect(() => processGraphicEqTrack(track, {
      trackId: 'track', clips: [target.clips[0], target.clips[0]],
    }, { start: 0, end: 1 }, active(), 1000)).toThrow(/不可用或重复/);
  });
});
