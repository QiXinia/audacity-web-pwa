import { describe, expect, it } from 'vitest';
import { mixStereoToMono } from './stereoToMonoEffect';

describe('Stereo To Mono DSP', () => {
  it('averages left and right channels with the official divide-by-two mix', () => {
    const left = new Float32Array([0.2, -0.4, 1]);
    const right = new Float32Array([0.6, 0.2, -1]);
    const [mono] = mixStereoToMono([left, right]);
    expect(mono).toHaveLength(3);
    expect(mono[0]).toBeCloseTo(0.4);
    expect(mono[1]).toBeCloseTo(-0.1);
    expect(mono[2]).toBe(0);
  });

  it('does not mutate the input channels', () => {
    const left = new Float32Array([0.5]);
    const right = new Float32Array([-0.3]);
    mixStereoToMono([left, right]);
    expect(left).toHaveLength(1);
    expect(right).toHaveLength(1);
    expect(left[0]).toBeCloseTo(0.5);
    expect(right[0]).toBeCloseTo(-0.3);
  });

  it('rejects non-stereo input and mismatched channel lengths', () => {
    expect(() => mixStereoToMono([new Float32Array(2)])).toThrow('两个输入声道');
    expect(() => mixStereoToMono([new Float32Array(2), new Float32Array(1)])).toThrow('长度必须一致');
  });
});
