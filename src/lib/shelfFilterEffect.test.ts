import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SHELF_FILTER_SETTINGS,
  createShelfFilterState,
  processShelfFilter,
  processShelfFilterChannels,
  validateShelfFilterSettings,
  type ShelfFilterSettings,
} from '@/lib/shelfFilterEffect';

const LOW_IMPULSE_ORACLE = [
  1.03256248324759,
  0.0656600910991093,
  0.0662806697895813,
  0.066065828685846,
  0.0651385280385644,
  0.0636120037096572,
];
const HIGH_IMPULSE_ORACLE = [
  1.93234050949966,
  -0.122876490233496,
  -0.116224193339912,
  -0.108357655523891,
  -0.0996876121895891,
  -0.0905611971597431,
];

function impulse(settings: ShelfFilterSettings): Float32Array {
  return processShelfFilter(Float32Array.from([1, 0, 0, 0, 0, 0]), settings, 48_000);
}

describe('Shelf Filter DSP', () => {
  it('matches independently calculated upstream low-shelf impulse samples', () => {
    const output = impulse({ type: 'low', frequencyHz: 1000, gainDb: 6 });
    LOW_IMPULSE_ORACLE.forEach((expected, index) => expect(output[index]).toBeCloseTo(expected, 6));
  });

  it('matches independently calculated upstream high-shelf impulse samples', () => {
    const output = impulse({ type: 'high', frequencyHz: 1000, gainDb: 6 });
    HIGH_IMPULSE_ORACLE.forEach((expected, index) => expect(output[index]).toBeCloseTo(expected, 6));
  });

  it('returns exact copies for a normal-rate zero-gain no-op without mutating input', () => {
    const input = Float32Array.from([0.25, -0.5, 0.75]);
    const original = input.slice();
    const [output] = processShelfFilterChannels([input], { type: 'low', frequencyHz: 1000, gainDb: 0 }, 48_000);
    expect(output).toEqual(original);
    expect(output).not.toBe(input);
    expect(input).toEqual(original);
  });

  it('uses independent channel state and preserves stereo samples deterministically', () => {
    const left = Float32Array.from([1, 0, 0, 0]);
    const right = Float32Array.from([0, 0, 0, 0]);
    const settings: ShelfFilterSettings = { type: 'high', frequencyHz: 2000, gainDb: -12 };
    const first = processShelfFilterChannels([left, right], settings, 48_000);
    const second = processShelfFilterChannels([left, right], settings, 48_000);
    expect(first[1]).toEqual(new Float32Array(4));
    expect(first[0]).not.toEqual(first[1]);
    expect(first).toEqual(second);
  });

  it('keeps the upstream doubled-rate near-Nyquist branch finite and length preserving', () => {
    const input = Float32Array.from({ length: 64 }, (_, index) => Math.sin(index * 0.2));
    const [output] = processShelfFilterChannels(
      [input],
      { type: 'low', frequencyHz: 490, gainDb: 6 },
      1000,
    );
    expect(output.length).toBe(input.length);
    expect(Array.from(output).every(Number.isFinite)).toBe(true);
    expect(output).not.toEqual(input);
  });

  it('supports continuity when a caller reuses the same filter state', () => {
    const settings: ShelfFilterSettings = { type: 'low', frequencyHz: 1000, gainDb: 6 };
    const state = createShelfFilterState(settings, 48_000);
    const joined = processShelfFilter(Float32Array.from([1, 0, 0, 0]), settings, 48_000);
    const first = processShelfFilter(Float32Array.from([1, 0]), settings, 48_000, state);
    const second = processShelfFilter(Float32Array.from([0, 0]), settings, 48_000, state);
    expect(Array.from(first)).toEqual(Array.from(joined.slice(0, 2)));
    expect(Array.from(second)).toEqual(Array.from(joined.slice(2)));
  });

  it('fail-closes invalid parameters, state mismatches and malformed audio', () => {
    expect(() => validateShelfFilterSettings(DEFAULT_SHELF_FILTER_SETTINGS, 1000)).toThrow('Nyquist');
    expect(() => impulse({ type: 'low', frequencyHz: 10.5, gainDb: 0 })).toThrow('整数');
    expect(() => impulse({ type: 'low', frequencyHz: 9, gainDb: 0 })).toThrow('10–10000');
    expect(() => impulse({ type: 'low', frequencyHz: 1000, gainDb: 73 })).toThrow('-72–72');
    expect(() => impulse({ type: 'invalid' as ShelfFilterSettings['type'], frequencyHz: 1000, gainDb: 0 })).toThrow('类型');
    expect(() => processShelfFilterChannels([], DEFAULT_SHELF_FILTER_SETTINGS, 48_000)).toThrow('声道');
    expect(() => processShelfFilterChannels([
      Float32Array.from([1, 2]), Float32Array.from([1]),
    ], DEFAULT_SHELF_FILTER_SETTINGS, 48_000)).toThrow('等长');
    expect(() => processShelfFilter(
      Float32Array.from([Number.NaN]), DEFAULT_SHELF_FILTER_SETTINGS, 48_000,
    )).toThrow('非有限');
    const settings: ShelfFilterSettings = { type: 'low', frequencyHz: 1000, gainDb: 6 };
    const wrongState = createShelfFilterState({ ...settings, gainDb: 3 }, 48_000);
    expect(() => processShelfFilter(Float32Array.from([1]), settings, 48_000, wrongState)).toThrow('不匹配');
  });
});
