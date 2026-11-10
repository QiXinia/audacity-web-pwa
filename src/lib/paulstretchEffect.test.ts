import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PAULSTRETCH_SETTINGS,
  MAX_PAULSTRETCH_TOTAL_OUTPUT_SAMPLES,
  paulstretchBufferSize,
  paulstretchMinimumInputLength,
  paulstretchOutputLength,
  processPaulstretchChannels,
  validatePaulstretchSettings,
} from './paulstretchEffect';

function source(length: number): Float32Array {
  return Float32Array.from({ length }, (_, index) => (
    Math.sin(index * 0.071) * 0.45 + Math.cos(index * 0.013) * 0.2
  ));
}

const settings = { stretchFactor: 3, timeResolution: 0.25 };

describe('Audacity Paulstretch deterministic Web fallback', () => {
  it('uses the official defaults and nearest-power-of-two buffer rule', () => {
    expect(DEFAULT_PAULSTRETCH_SETTINGS).toEqual({ stretchFactor: 10, timeResolution: 0.25 });
    expect(paulstretchBufferSize(48_000, 0.25)).toBe(8192);
    expect(paulstretchBufferSize(48_000, 0.00099)).toBe(128);
    expect(paulstretchBufferSize(1000, 0.25)).toBe(128);
    expect(paulstretchMinimumInputLength(128)).toBe(257);
  });

  it.each([
    { stretchFactor: 0, timeResolution: 0.25 },
    { stretchFactor: Number.NaN, timeResolution: 0.25 },
    { stretchFactor: 2, timeResolution: 0 },
    { stretchFactor: 2, timeResolution: Number.POSITIVE_INFINITY },
  ])('rejects invalid controls without processing: %o', (invalid) => {
    expect(() => validatePaulstretchSettings(invalid)).toThrow(RangeError);
  });

  it('rejects oversized FFT buffers before allocating them', () => {
    expect(() => paulstretchBufferSize(192_000, 100)).toThrow('内存上限');
  });

  it('requires the official two-buffer-plus-one minimum selection', () => {
    expect(() => processPaulstretchChannels([source(256)], settings, 1000)).toThrow('选区太短');
    expect(paulstretchOutputLength(257, settings, 1000)).toBe(771);
  });

  it('returns exact requested durations for fractional and integral stretch factors', () => {
    const input = source(777);
    for (const stretchFactor of [1, 1.5, 3, 10]) {
      const output = processPaulstretchChannels([input], { stretchFactor, timeResolution: 0.25 }, 1000);
      expect(output[0]).toHaveLength(Math.round(input.length * stretchFactor));
    }
  });

  it('is deterministic without mutating input or ignoring the time-smear at factor one', () => {
    const input = source(600);
    const original = input.slice();
    const options = { stretchFactor: 1, timeResolution: 0.25 };
    const first = processPaulstretchChannels([input], options, 1000)[0];
    const second = processPaulstretchChannels([input], options, 1000)[0];
    expect(first).toEqual(second);
    expect(input).toEqual(original);
    expect(first).not.toEqual(input);
    expect(first[0]).toBe(input[0]);
    expect(first.at(-1)).toBe(input.at(-1));
  });

  it('changes spectral smearing with time resolution and preserves finite stereo alignment', () => {
    const left = source(900);
    const right = source(900).map((value, index) => value * 0.5 + Math.sin(index * 0.17) * 0.1);
    const fine = processPaulstretchChannels([left, right], settings, 1000);
    const coarse = processPaulstretchChannels(
      [left, right],
      { ...settings, timeResolution: 0.5 },
      1000,
    );
    expect(fine).toHaveLength(2);
    expect(fine[0]).toHaveLength(2700);
    expect(fine[1]).toHaveLength(2700);
    expect(fine[0]).not.toEqual(coarse[0]);
    for (const channel of fine) {
      expect(channel.every(Number.isFinite)).toBe(true);
      expect(channel.some((value) => Math.abs(value) > 1e-5)).toBe(true);
    }
    expect(fine[0]).not.toEqual(fine[1]);
  });

  it('blends both actual trimmed endpoints to the source', () => {
    const input = source(513);
    const output = processPaulstretchChannels([input], { ...settings, stretchFactor: 1.5 }, 1000)[0];
    expect(output).toHaveLength(770);
    expect(output[0]).toBe(input[0]);
    expect(output.at(-1)).toBe(input.at(-1));
  });

  it('keeps silence silent and distinguishes homologous lengths', () => {
    const silent = new Float32Array(300);
    expect(processPaulstretchChannels([silent], settings, 1000)[0].every((value) => value === 0)).toBe(true);
    const shorter = processPaulstretchChannels([source(300)], settings, 1000)[0];
    const longer = processPaulstretchChannels([source(301)], settings, 1000)[0];
    expect(shorter).toHaveLength(900);
    expect(longer).toHaveLength(903);
  });

  it('rejects mismatched channels and non-finite PCM before processing', () => {
    expect(() => processPaulstretchChannels(
      [source(300), source(301)], settings, 1000,
    )).toThrow('等长');
    const invalid = source(300);
    invalid[42] = Number.NaN;
    expect(() => processPaulstretchChannels([invalid], settings, 1000)).toThrow('非有限');
  });

  it('fails closed before allocating over the shared 20M sample budget', () => {
    const inputLength = 300;
    const stretchFactor = MAX_PAULSTRETCH_TOTAL_OUTPUT_SAMPLES / inputLength + 1;
    expect(() => processPaulstretchChannels(
      [source(inputLength)], { stretchFactor, timeResolution: 0.25 }, 1000,
    )).toThrow('2000 万');
  });
});
