import { describe, expect, it } from 'vitest';
import {
  createEchoState,
  ECHO_DEFAULT_DECAY,
  ECHO_DEFAULT_DELAY_SECONDS,
  getEchoClipSampleRange,
  getEchoPlan,
  MAX_ECHO_DELAY_SAMPLES,
  processEchoSelection,
} from './echoEffect';

describe('Audacity Echo DSP', () => {
  it('uses the official one-second delay and 0.5 decay defaults', () => {
    expect(ECHO_DEFAULT_DELAY_SECONDS).toBe(1);
    expect(ECHO_DEFAULT_DECAY).toBe(0.5);
    expect(getEchoPlan(1, 0.5, 10)).toMatchObject({ delaySamples: 10, decay: 0.5 });
  });

  it('truncates fractional delay samples like the official sampleCount cast', () => {
    expect(getEchoPlan(0.59, 0.5, 10).delaySamples).toBe(5);
  });

  it('matches an independent output-history recurrence for arbitrary samples', () => {
    const input = Float32Array.from([0.2, -0.4, 0.8, 0.1, -0.7, 0.5, 0.3, -0.2]);
    const delay = 3;
    const decay = 0.25;
    const expected = new Float32Array(input.length);
    for (let index = 0; index < input.length; index += 1) {
      expected[index] = input[index] + (index >= delay ? expected[index - delay] * decay : 0);
    }
    const actual = processEchoSelection([input], 0, input.length, createEchoState(getEchoPlan(0.3, decay, 10)));
    expect(Array.from(actual[0])).toEqual(Array.from(expected));
    expect(Array.from(input)).toEqual([0.2, -0.4, 0.8, 0.1, -0.7, 0.5, 0.3, -0.2].map((value) => Math.fround(value)));
  });

  it('produces decaying impulse echoes at exact delay intervals', () => {
    const output = processEchoSelection(
      [Float32Array.from([1, 0, 0, 0, 0, 0, 0])],
      0,
      7,
      createEchoState(getEchoPlan(0.2, 0.5, 10)),
    )[0];
    expect(Array.from(output)).toEqual([1, 0, 0.5, 0, 0.25, 0, 0.125]);
  });

  it('keeps the original samples when decay is zero', () => {
    const input = Float32Array.from([0.1, 0.2, 0.3, 0.4]);
    const output = processEchoSelection([input], 0, 4, createEchoState(getEchoPlan(0.2, 0, 10)));
    expect(output[0]).not.toBe(input);
    expect(Array.from(output[0])).toEqual(Array.from(input));
  });

  it('does not create an echo when delay exceeds the selected audio', () => {
    const input = Float32Array.from([1, 2, 3]);
    const output = processEchoSelection([input], 0, 3, createEchoState(getEchoPlan(1, 1, 10)));
    expect(Array.from(output[0])).toEqual([1, 2, 3]);
  });

  it('allows decay above one and repeats with increasing amplitude', () => {
    const output = processEchoSelection(
      [Float32Array.from([1, 2, 3, 4, 5, 6])],
      0,
      6,
      createEchoState(getEchoPlan(0.2, 1, 10)),
    )[0];
    expect(Array.from(output)).toEqual([1, 2, 4, 6, 9, 12]);
  });

  it('keeps stereo histories independent while advancing one shared position', () => {
    const output = processEchoSelection(
      [Float32Array.from([1, 0, 0, 0, 0]), new Float32Array(5).fill(2)],
      0,
      5,
      createEchoState(getEchoPlan(0.2, 0.5, 10)),
    );
    expect(Array.from(output[0])).toEqual([1, 0, 0.5, 0, 0.25]);
    expect(Array.from(output[1])).toEqual([2, 2, 3, 3, 3.5]);
  });

  it('changes only the selected sample range and starts with empty history', () => {
    const output = processEchoSelection(
      [new Float32Array(8).fill(1)],
      2,
      6,
      createEchoState(getEchoPlan(0.2, 0.5, 10)),
    )[0];
    expect(Array.from(output)).toEqual([1, 1, 1, 1, 1.5, 1.5, 1, 1]);
  });

  it('carries echo history across adjacent clips without resetting at the boundary', () => {
    const continuous = processEchoSelection(
      [new Float32Array(8).fill(1)],
      0,
      8,
      createEchoState(getEchoPlan(0.2, 0.5, 10)),
    )[0];
    const state = createEchoState(getEchoPlan(0.2, 0.5, 10));
    const first = processEchoSelection([new Float32Array(4).fill(1)], 0, 4, state)[0];
    const second = processEchoSelection([new Float32Array(4).fill(1)], 0, 4, state)[0];
    expect([...first, ...second]).toEqual(Array.from(continuous));
  });

  it('maps a stretched source window and selection into the correct sample range', () => {
    expect(getEchoClipSampleRange(
      { startTime: 1, duration: 2 },
      { start: 1.5, end: 2.5 },
      0.25,
      10,
      100,
    )).toEqual({ startSample: 7, endSample: 17 });
    expect(getEchoClipSampleRange(
      { startTime: 3, duration: 1 },
      { start: 0, end: 1 },
      0,
      10,
      100,
    )).toBeNull();
  });

  it('rejects invalid delay and decay values before allocating history', () => {
    expect(() => getEchoPlan(0, 0.5, 44100)).toThrow(/延迟时间/);
    expect(() => getEchoPlan(Number.NaN, 0.5, 44100)).toThrow(/延迟时间/);
    expect(() => getEchoPlan(0.001, 0.5, 10)).toThrow(/一个采样/);
    expect(() => getEchoPlan((MAX_ECHO_DELAY_SAMPLES + 1) / 10, 0.5, 10)).toThrow(/内存上限/);
    expect(() => getEchoPlan(1, -0.1, 44100)).toThrow(/衰减因子/);
    expect(() => getEchoPlan(1, Number.POSITIVE_INFINITY, 44100)).toThrow(/衰减因子/);
  });

  it('rejects malformed channels and sample ranges', () => {
    const state = createEchoState(getEchoPlan(0.1, 0.5, 10));
    expect(() => processEchoSelection([], 0, 1, state)).toThrow(/非空声道/);
    expect(() => processEchoSelection([new Float32Array(2), new Float32Array(3)], 0, 2, state)).toThrow(/等长/);
    expect(() => processEchoSelection([new Float32Array(2)], 0, 3, state)).toThrow(/采样区间/);
    expect(() => processEchoSelection([new Float32Array(2)], 1.5, 2, state)).toThrow(/采样区间/);
  });

  it('fails instead of persisting non-finite samples from extreme decay', () => {
    const state = createEchoState(getEchoPlan(1, 1e38, 1));
    expect(() => processEchoSelection(
      [Float32Array.from([3e38, 1])],
      0,
      2,
      state,
    )).toThrow(/非有限值/);
  });
});
