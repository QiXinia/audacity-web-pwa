import { describe, expect, it } from 'vitest';
import { processReverseSelection } from './reverseEffect';

describe('Audacity Reverse DSP', () => {
  it('reverses the exact odd-length selection without changing polarity', () => {
    const input = Float32Array.from([0, -0, 0.25, -0.5, 1, -1]);
    const output = processReverseSelection([input], 1, 5)[0];
    expect(Array.from(output)).toEqual([0, 1, -0.5, 0.25, -0, -1]);
    expect(Object.is(output[4], -0)).toBe(true);
    expect(Array.from(input)).toEqual([0, -0, 0.25, -0.5, 1, -1]);
  });

  it('reverses every channel independently and preserves samples outside the selection', () => {
    const left = Float32Array.from([1, 2, 3, 4, 5, 6]);
    const right = Float32Array.from([-1, -2, -3, -4, -5, -6]);
    const output = processReverseSelection([left, right], 1, 5);
    expect(Array.from(output[0])).toEqual([1, 5, 4, 3, 2, 6]);
    expect(Array.from(output[1])).toEqual([-1, -5, -4, -3, -2, -6]);
    expect(output[0]).not.toBe(left);
    expect(output[1]).not.toBe(right);
    expect(Array.from(left)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(Array.from(right)).toEqual([-1, -2, -3, -4, -5, -6]);
  });

  it('is an involution over the same sample range', () => {
    const input = [Float32Array.from({ length: 33 }, (_, index) => index - 16)];
    const once = processReverseSelection(input, 3, 30);
    const twice = processReverseSelection(once, 3, 30);
    expect(Array.from(twice[0])).toEqual(Array.from(input[0]));
  });

  it('rejects malformed channels and sample ranges', () => {
    expect(() => processReverseSelection([], 0, 1)).toThrow(/非空声道/);
    expect(() => processReverseSelection([new Float32Array(2), new Float32Array(3)], 0, 2)).toThrow(/等长/);
    expect(() => processReverseSelection([new Float32Array(2)], 0, 3)).toThrow(/采样区间/);
    expect(() => processReverseSelection([new Float32Array(2)], 1.5, 2)).toThrow(/采样区间/);
    expect(() => processReverseSelection([new Float32Array(2)], 1, 1)).toThrow(/采样区间/);
  });
});
