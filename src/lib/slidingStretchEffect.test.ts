import { describe, expect, it } from 'vitest';
import { timeStretchChannelsJs } from '@/engine/timeStretch';
import {
  DEFAULT_SLIDING_STRETCH_SETTINGS,
  durationAfterSlidingStretch,
  isSlidingStretchBypassed,
  MAX_SLIDING_STRETCH_TOTAL_OUTPUT_SAMPLES,
  processSlidingStretchChannels,
  slidingStretchInputTimeToOutput,
  slidingStretchOutputLength,
  slidingStretchOutputRateAt,
  slidingStretchOutputTimeToInput,
  slidingStretchPercentToSemitones,
  slidingStretchPitchRatioAt,
  slidingStretchSemitonesToPercent,
  slidingStretchSubrangeSettings,
  slidingStretchTotalStretch,
  validateSlidingStretchSettings,
  type SlidingStretchSettings,
} from './slidingStretchEffect';

function settings(patch: Partial<SlidingStretchSettings>): SlidingStretchSettings {
  return { ...DEFAULT_SLIDING_STRETCH_SETTINGS, ...patch };
}

describe('Sliding Stretch official parameter model', () => {
  it('keeps the six official defaults and converts pitch by twelve-tone equal temperament', () => {
    expect(DEFAULT_SLIDING_STRETCH_SETTINGS).toEqual({
      initialTempoPercent: 0,
      finalTempoPercent: 0,
      initialPitchSemitones: 0,
      finalPitchSemitones: 0,
      initialPitchPercent: 0,
      finalPitchPercent: 0,
    });
    expect(slidingStretchSemitonesToPercent(12)).toBeCloseTo(100, 12);
    expect(slidingStretchSemitonesToPercent(-12)).toBeCloseTo(-50, 12);
    expect(slidingStretchSemitonesToPercent(6)).toBeCloseTo(41.42135623730951, 12);
    expect(slidingStretchPercentToSemitones(100)).toBeCloseTo(12, 12);
    expect(slidingStretchPercentToSemitones(-50)).toBeCloseTo(-12, 12);
  });

  it('enforces the official tempo, semitone and pitch-percent ranges', () => {
    expect(() => validateSlidingStretchSettings(settings({ initialTempoPercent: -90 }))).not.toThrow();
    expect(() => validateSlidingStretchSettings(settings({ finalTempoPercent: 500 }))).not.toThrow();
    expect(() => validateSlidingStretchSettings(settings({ initialTempoPercent: -90.001 }))).toThrow(RangeError);
    expect(() => validateSlidingStretchSettings(settings({ finalTempoPercent: 500.001 }))).toThrow(RangeError);
    expect(() => validateSlidingStretchSettings(settings({ initialPitchSemitones: 12.1 }))).toThrow(RangeError);
    expect(() => validateSlidingStretchSettings(settings({ finalPitchSemitones: -12.1 }))).toThrow(RangeError);
    expect(() => validateSlidingStretchSettings(settings({ initialPitchPercent: -50.1 }))).toThrow(RangeError);
    expect(() => validateSlidingStretchSettings(settings({ finalPitchPercent: 100.1 }))).toThrow(RangeError);
    expect(() => validateSlidingStretchSettings(settings({ finalTempoPercent: Number.NaN }))).toThrow(RangeError);
  });

  it('treats only an actually neutral render as a no-op', () => {
    expect(isSlidingStretchBypassed(settings({}))).toBe(true);
    expect(isSlidingStretchBypassed(settings({ finalTempoPercent: 1 }))).toBe(false);
    expect(isSlidingStretchBypassed(settings({ initialPitchPercent: 1 }))).toBe(false);
  });
});

describe('Sliding Stretch linear-output-rate time map', () => {
  it('uses total stretch 2/(rateStart+rateEnd), including reversed and extreme slides', () => {
    expect(slidingStretchTotalStretch(settings({ initialTempoPercent: 0, finalTempoPercent: 100 }))).toBeCloseTo(2 / 3, 12);
    expect(slidingStretchTotalStretch(settings({ initialTempoPercent: 100, finalTempoPercent: 0 }))).toBeCloseTo(2 / 3, 12);
    expect(slidingStretchTotalStretch(settings({ initialTempoPercent: 100, finalTempoPercent: 100 }))).toBe(0.5);
    expect(slidingStretchTotalStretch(settings({ initialTempoPercent: -50, finalTempoPercent: -50 }))).toBe(2);
    expect(slidingStretchTotalStretch(settings({ initialTempoPercent: -90, finalTempoPercent: 500 }))).toBeCloseTo(2 / 6.1, 12);
    expect(durationAfterSlidingStretch(3, settings({ initialTempoPercent: 0, finalTempoPercent: 100 }))).toBeCloseTo(2, 12);
    expect(slidingStretchOutputLength(10, settings({ initialTempoPercent: 100, finalTempoPercent: 100 }))).toBe(5);
  });

  it('maps output to source by the integrated linear rate and inverts timeline markers', () => {
    const slide = settings({ initialTempoPercent: 0, finalTempoPercent: 100 });
    expect(slidingStretchOutputRateAt(0, slide)).toBe(1);
    expect(slidingStretchOutputRateAt(1, slide)).toBe(2);
    expect(slidingStretchOutputTimeToInput(0, slide)).toBe(0);
    expect(slidingStretchOutputTimeToInput(1, slide)).toBe(1);
    // Integral of rate=1+u is u+u²/2; divide by average rate 1.5.
    expect(slidingStretchOutputTimeToInput(0.5, slide)).toBeCloseTo((0.5 + 0.125) / 1.5, 12);
    for (const sourcePosition of [0, 0.05, 0.2, 0.5, 0.8, 1]) {
      const outputPosition = slidingStretchInputTimeToOutput(sourcePosition, slide);
      expect(slidingStretchOutputTimeToInput(outputPosition, slide)).toBeCloseTo(sourcePosition, 12);
    }
    expect(slidingStretchInputTimeToOutput(0.25, settings({ initialTempoPercent: 100, finalTempoPercent: 100 }))).toBe(0.25);
  });

  it('slides pitch linearly in normalized output time independently of tempo', () => {
    const slide = settings({ initialPitchPercent: -50, finalPitchPercent: 100 });
    expect(slidingStretchPitchRatioAt(0, slide)).toBe(0.5);
    expect(slidingStretchPitchRatioAt(0.5, slide)).toBe(1.25);
    expect(slidingStretchPitchRatioAt(1, slide)).toBe(2);
  });

  it('restricts global slides to clip subranges without restarting tempo or pitch', () => {
    const slide = settings({
      initialTempoPercent: 0,
      finalTempoPercent: 100,
      initialPitchPercent: -50,
      finalPitchPercent: 100,
    });
    const first = slidingStretchSubrangeSettings(slide, 0, 0.4);
    const second = slidingStretchSubrangeSettings(slide, 0.4, 1);
    expect(first.initialTempoPercent).toBe(0);
    expect(second.finalTempoPercent).toBe(100);
    expect(second.initialTempoPercent).toBeCloseTo(first.finalTempoPercent, 12);
    expect(second.initialPitchPercent).toBeCloseTo(first.finalPitchPercent, 12);
    const firstDuration = durationAfterSlidingStretch(0.4, first);
    const secondDuration = durationAfterSlidingStretch(0.6, second);
    expect(firstDuration + secondDuration).toBeCloseTo(durationAfterSlidingStretch(1, slide), 12);
    expect(() => slidingStretchSubrangeSettings(slide, 0.5, 0.5)).toThrow('正时长');
  });

  it('rejects invalid durations and normalized positions', () => {
    expect(() => durationAfterSlidingStretch(-1, settings({}))).toThrow(RangeError);
    expect(() => slidingStretchOutputLength(0, settings({}))).toThrow(RangeError);
    expect(() => slidingStretchOutputTimeToInput(-0.01, settings({}))).toThrow(RangeError);
    expect(() => slidingStretchInputTimeToOutput(1.01, settings({}))).toThrow(RangeError);
  });
});

describe('Sliding Stretch deterministic Web fallback', () => {
  it('copies neutral PCM without mutating or aliasing the input', () => {
    const input = [Float32Array.from([0, 0.25, -0.5])];
    const output = processSlidingStretchChannels(input, settings({}), 1000);
    expect(output[0]).toEqual(input[0]);
    expect(output[0]).not.toBe(input[0]);
  });

  it('reduces constant tempo to the existing shared-position WSOLA path', () => {
    const input = [Float32Array.from({ length: 10 }, (_, index) => index / 10)];
    const slide = settings({ initialTempoPercent: 100, finalTempoPercent: 100 });
    const output = processSlidingStretchChannels(input, slide, 1000);
    expect(output[0]).toEqual(timeStretchChannelsJs(input, 2, 1000)[0]);
    expect(output[0]).toEqual(Float32Array.from([0, 0.2, 0.4, 0.6, 0.8]));
  });

  it('renders a variable stereo tempo slide deterministically with exact output length', () => {
    const input = [
      Float32Array.from({ length: 5000 }, (_, index) => Math.sin(index * 0.013) * 0.5),
      Float32Array.from({ length: 5000 }, (_, index) => Math.cos(index * 0.017) * 0.25),
    ];
    const slide = settings({ initialTempoPercent: -50, finalTempoPercent: 100 });
    const expectedLength = Math.round(5000 * 2 / 2.5);
    const first = processSlidingStretchChannels(input, slide, 1000);
    const second = processSlidingStretchChannels(input, slide, 1000);
    expect(first).toHaveLength(2);
    expect(first[0]).toHaveLength(expectedLength);
    expect(first[1]).toHaveLength(expectedLength);
    expect(first[0]).toEqual(second[0]);
    expect(first[1]).toEqual(second[1]);
    expect(first[0].some((value) => value !== 0)).toBe(true);
    expect(first[0].every(Number.isFinite)).toBe(true);
    expect(input[0]).toHaveLength(5000);
  });

  it('keeps selection duration for a pitch-only slide and produces non-neutral PCM', () => {
    const input = [Float32Array.from({ length: 5000 }, (_, index) => Math.sin(index * 0.03))];
    const slide = settings({
      initialPitchSemitones: -12,
      finalPitchSemitones: 12,
      initialPitchPercent: -50,
      finalPitchPercent: 100,
    });
    const output = processSlidingStretchChannels(input, slide, 1000);
    expect(output[0]).toHaveLength(input[0].length);
    expect(output[0]).not.toEqual(input[0]);
    expect(output[0].every(Number.isFinite)).toBe(true);
  });

  it('handles one-sample and short extreme combined slides without empty output', () => {
    const slide = settings({
      initialTempoPercent: -90,
      finalTempoPercent: 500,
      initialPitchSemitones: -12,
      finalPitchSemitones: 12,
      initialPitchPercent: -50,
      finalPitchPercent: 100,
    });
    for (const length of [1, 2, 17, 127]) {
      const input = [Float32Array.from({ length }, (_, index) => index / Math.max(1, length))];
      const output = processSlidingStretchChannels(input, slide, 1000);
      expect(output[0]).toHaveLength(slidingStretchOutputLength(length, slide));
      expect(output[0].length).toBeGreaterThan(0);
      expect(output[0].every(Number.isFinite)).toBe(true);
    }
  });

  it('rejects malformed channels and non-finite samples', () => {
    expect(() => processSlidingStretchChannels([], settings({}), 1000)).toThrow('至少需要一个音频声道');
    expect(() => processSlidingStretchChannels(
      [new Float32Array(2), new Float32Array(3)], settings({}), 1000,
    )).toThrow('等长');
    expect(() => processSlidingStretchChannels(
      [Float32Array.from([0, Number.NaN])], settings({}), 1000,
    )).toThrow('非有限');
    expect(() => processSlidingStretchChannels(
      [new Float32Array(2)], settings({}), 0,
    )).toThrow('采样率');
  });

  it('bounds output allocation before processing an extreme slow-down', () => {
    const inputLength = Math.floor(MAX_SLIDING_STRETCH_TOTAL_OUTPUT_SAMPLES / 10) + 1;
    const input = [new Float32Array(inputLength)];
    expect(() => processSlidingStretchChannels(
      input,
      settings({ initialTempoPercent: -90, finalTempoPercent: -90 }),
      1000,
    )).toThrow('内存上限');
  });
});
