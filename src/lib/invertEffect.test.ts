import { describe, expect, it } from 'vitest';
import { processInvertSelection } from './invertEffect';

describe('Audacity Invert DSP', () => {
  it('matches the official out[i] = -in[i] contract without reversing time', () => {
    const input = Float32Array.from([0, -0, 0.25, -0.5, 1, -1]);
    const output = processInvertSelection([input], 0, input.length)[0];
    expect(Array.from(output)).toEqual([-0, 0, -0.25, 0.5, -1, 1]);
    expect(Object.is(output[0], -0)).toBe(true);
    expect(Object.is(output[1], 0)).toBe(true);
    expect(Array.from(input)).toEqual([0, -0, 0.25, -0.5, 1, -1]);
  });

  it('changes only the exact selected range in every channel', () => {
    const left = Float32Array.from([1, 2, 3, 4, 5]);
    const right = Float32Array.from([-1, -2, -3, -4, -5]);
    const output = processInvertSelection([left, right], 1, 4);
    expect(Array.from(output[0])).toEqual([1, -2, -3, -4, 5]);
    expect(Array.from(output[1])).toEqual([-1, 2, 3, 4, -5]);
    expect(output[0]).not.toBe(left);
    expect(output[1]).not.toBe(right);
    expect(Array.from(left)).toEqual([1, 2, 3, 4, 5]);
    expect(Array.from(right)).toEqual([-1, -2, -3, -4, -5]);
  });

  it('rejects malformed channels and sample ranges', () => {
    expect(() => processInvertSelection([], 0, 1)).toThrow(/非空声道/);
    expect(() => processInvertSelection([new Float32Array(2), new Float32Array(3)], 0, 2)).toThrow(/等长/);
    expect(() => processInvertSelection([new Float32Array(2)], 0, 3)).toThrow(/采样区间/);
    expect(() => processInvertSelection([new Float32Array(2)], 1.5, 2)).toThrow(/采样区间/);
    expect(() => processInvertSelection([new Float32Array(2)], 1, 1)).toThrow(/采样区间/);
  });
});
