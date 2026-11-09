import { describe, expect, it } from 'vitest';
import {
  createNormalizePlan,
  DEFAULT_NORMALIZE_SETTINGS,
  isNormalizeBypassed,
  processNormalizeChannels,
  validateNormalizeSettings,
  type NormalizeSettings,
} from './normalizeEffect';

function settings(patch: Partial<NormalizeSettings> = {}): NormalizeSettings {
  return { ...DEFAULT_NORMALIZE_SETTINGS, ...patch };
}

describe('Audacity Normalize DSP', () => {
  it('uses the official defaults and -145…0 dB parameter contract', () => {
    expect(DEFAULT_NORMALIZE_SETTINGS).toEqual({
      removeDc: true,
      normalizePeak: true,
      peakDb: -1,
      stereoIndependent: false,
    });
    expect(() => validateNormalizeSettings(settings({ peakDb: -145 }))).not.toThrow();
    expect(() => validateNormalizeSettings(settings({ peakDb: 0 }))).not.toThrow();
    expect(() => validateNormalizeSettings(settings({ peakDb: 0.01 }))).toThrow('-145–0');
    expect(() => validateNormalizeSettings(settings({ peakDb: -145.01 }))).toThrow('-145–0');
    expect(() => validateNormalizeSettings(settings({ peakDb: NaN }))).toThrow();
    expect(isNormalizeBypassed(settings({ removeDc: false, normalizePeak: false }))).toBe(true);
    expect(isNormalizeBypassed(settings({ removeDc: true, normalizePeak: false }))).toBe(false);
  });

  it('preserves stereo balance with one shared peak gain', () => {
    const source = [Float32Array.from([0.25, -0.125]), Float32Array.from([0.5, -0.25])];
    const snapshot = source.map((channel) => channel.slice());
    const output = processNormalizeChannels(source, settings({
      removeDc: false,
      peakDb: -6,
      stereoIndependent: false,
    }));
    const target = 10 ** (-6 / 20);
    const gain = target / 0.5;
    expect(output[0][0]).toBeCloseTo(0.25 * gain, 6);
    expect(output[0][1]).toBeCloseTo(-0.125 * gain, 6);
    expect(output[1][0]).toBeCloseTo(target, 6);
    expect(output[1][1]).toBeCloseTo(-target / 2, 6);
    expect(source).toEqual(snapshot);
  });

  it('normalizes stereo channels independently only when requested', () => {
    const output = processNormalizeChannels([
      Float32Array.from([0.25, -0.125]),
      Float32Array.from([0.5, -0.25]),
    ], settings({ removeDc: false, peakDb: -12, stereoIndependent: true }));
    const target = 10 ** (-12 / 20);
    expect(output[0][0]).toBeCloseTo(target, 6);
    expect(output[1][0]).toBeCloseTo(target, 6);
    expect(output[0][1]).toBeCloseTo(-target / 2, 6);
    expect(output[1][1]).toBeCloseTo(-target / 2, 6);
  });

  it('removes DC without applying peak gain when peak normalization is off', () => {
    const output = processNormalizeChannels([
      Float32Array.from([0.5, 1.5, -1]),
    ], settings({ removeDc: true, normalizePeak: false }));
    expect(output[0][0]).toBeCloseTo(1 / 6, 6);
    expect(output[0][1]).toBeCloseTo(7 / 6, 6);
    expect(output[0][2]).toBeCloseTo(-4 / 3, 6);
    expect(output[0].reduce((sum, sample) => sum + sample, 0)).toBeCloseTo(0, 6);
  });

  it('measures peak after DC removal, in the official analysis order', () => {
    const output = processNormalizeChannels([
      Float32Array.from([0.25, 0.75]),
    ], settings({ removeDc: true, normalizePeak: true, peakDb: 0 }));
    expect(output[0][0]).toBeCloseTo(-1, 6);
    expect(output[0][1]).toBeCloseTo(1, 6);
  });

  it('uses one cross-clip analysis plan rather than normalizing each clip separately', () => {
    const first = [Float32Array.from([0.1, 0.2]), Float32Array.from([-0.1])];
    const second = [Float32Array.from([0.4, -0.2]), Float32Array.from([0.2])];
    // Equal-length channel inputs are required per processed clip, so use separate
    // plans for this explicit boundary check and one shared plan for the real case.
    const channelSegments = [
      [Float32Array.from([0.1, 0.2]), Float32Array.from([0.4, -0.2])],
      [Float32Array.from([-0.1]), Float32Array.from([0.2])],
    ];
    const options = settings({ removeDc: false, peakDb: 0, stereoIndependent: false });
    const plan = createNormalizePlan(channelSegments, options);
    expect(plan.gains).toEqual([2.5, 2.5]);
    expect(processNormalizeChannels([
      Float32Array.from([0.1, 0.2]),
      Float32Array.from([-0.1, 0]),
    ], options, plan)[0]).toEqual(Float32Array.from([0.25, 0.5]));
    expect(processNormalizeChannels([
      Float32Array.from([0.4, -0.2]),
      Float32Array.from([0.2, 0]),
    ], options, plan)[0]).toEqual(Float32Array.from([1, -0.5]));
    expect(first[0]).toEqual(Float32Array.from([0.1, 0.2]));
    expect(second[0]).toEqual(Float32Array.from([0.4, -0.2]));
  });

  it('keeps silent and empty selections unchanged and validates hard boundaries', () => {
    const silent = processNormalizeChannels([
      Float32Array.from([0, 0]), new Float32Array(2),
    ], settings());
    expect(silent).toEqual([new Float32Array(2), new Float32Array(2)]);
    expect(processNormalizeChannels([new Float32Array()], settings())).toEqual([
      new Float32Array(),
    ]);
    expect(() => processNormalizeChannels([], settings())).toThrow('至少需要一个音频声道');
    expect(() => processNormalizeChannels([
      new Float32Array(2), new Float32Array(3),
    ], settings())).toThrow('必须等长');
    expect(() => processNormalizeChannels([
      Float32Array.from([Infinity, 0]),
    ], settings())).toThrow('非有限');
    expect(() => processNormalizeChannels([
      new Float32Array(1), new Float32Array(1),
    ], settings(), { offsets: [0], gains: [1] })).toThrow('声道数');
  });
});
