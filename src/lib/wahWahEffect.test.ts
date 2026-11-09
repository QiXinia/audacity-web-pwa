import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WAH_WAH_SETTINGS,
  processWahWah,
  processWahWahChannels,
  validateWahWahSettings,
  type WahWahSettings,
} from './wahWahEffect';

const baselineSettings: WahWahSettings = {
  frequencyHz: 1,
  phaseDegrees: 0,
  depthPercent: 50,
  resonance: 2,
  frequencyOffsetPercent: 20,
  outputGainDb: 0,
};

function baselineInput(): Float32Array {
  const input = new Float32Array(90);
  input[0] = 1;
  input[30] = 0.5;
  return input;
}

describe('Wah Wah settings', () => {
  it('keeps the six Audacity defaults', () => {
    expect(DEFAULT_WAH_WAH_SETTINGS).toEqual({
      frequencyHz: 1.5,
      phaseDegrees: 0,
      depthPercent: 70,
      resonance: 2.5,
      frequencyOffsetPercent: 30,
      outputGainDb: -6,
    });
    expect(Object.isFrozen(DEFAULT_WAH_WAH_SETTINGS)).toBe(true);
    expect(() => validateWahWahSettings({ ...DEFAULT_WAH_WAH_SETTINGS })).not.toThrow();
  });

  it.each([
    ['frequencyHz', 0],
    ['frequencyHz', 4.1],
    ['phaseDegrees', -1],
    ['phaseDegrees', 361],
    ['depthPercent', -1],
    ['depthPercent', 101],
    ['resonance', 0],
    ['resonance', 10.1],
    ['frequencyOffsetPercent', -1],
    ['frequencyOffsetPercent', 101],
    ['outputGainDb', -31],
    ['outputGainDb', 31],
    ['frequencyHz', Number.NaN],
  ])('rejects invalid %s=%s', (key, value) => {
    expect(() => validateWahWahSettings({ ...DEFAULT_WAH_WAH_SETTINGS, [key]: value }))
      .toThrow(RangeError);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])('rejects sample rate %s', (sampleRate) => {
    expect(() => processWahWah(new Float32Array(30), DEFAULT_WAH_WAH_SETTINGS, sampleRate))
      .toThrow('采样率');
  });
});

describe('Audacity 4.0.2 Wah Wah DSP', () => {
  it('matches independently calculated upstream samples across 30-sample coefficient updates', () => {
    const output = processWahWah(baselineInput(), baselineSettings, 1000);
    const expected = new Map([
      [0, 0.018843594938516617],
      [1, 0.07147908210754395],
      [2, 0.1306571513414383],
      [29, 0.03735046088695526],
      [30, 0.0411677248775959],
      [31, 0.05956290289759636],
      [32, 0.08031318336725235],
      [58, 0.01909087598323822],
      [59, 0.01742194965481758],
      [60, 0.014844982884824276],
      [61, 0.011634384281933308],
      [89, 0.0000605923960392829],
    ]);
    for (const [index, value] of expected) expect(output[index]).toBeCloseTo(value, 10);
  });

  it('is deterministic and does not mutate the input', () => {
    const input = baselineInput();
    const snapshot = new Float32Array(input);
    const first = processWahWah(input, baselineSettings, 1000);
    const second = processWahWah(input, baselineSettings, 1000);
    expect(input).toEqual(snapshot);
    expect(first).toEqual(second);
    expect(first).not.toBe(input);
  });

  it('keeps silence silent and supports empty input', () => {
    expect(processWahWah(new Float32Array(90), baselineSettings, 1000).every((x) => x === 0)).toBe(true);
    expect(processWahWah(new Float32Array(0), baselineSettings, 1000)).toHaveLength(0);
  });

  it('applies output gain after updating the un-gained recursive history', () => {
    const input = baselineInput();
    const linear = processWahWah(input, { ...baselineSettings, outputGainDb: 0 }, 1000);
    const attenuated = processWahWah(input, { ...baselineSettings, outputGainDb: -6 }, 1000);
    const gain = 10 ** (-6 / 20);
    for (let index = 0; index < input.length; index += 1) {
      expect(attenuated[index]).toBeCloseTo(linear[index] * gain, 6);
    }
  });

  it('uses independent channel states without inventing a stereo phase offset', () => {
    const left = baselineInput();
    const right = new Float32Array(left);
    const [actualLeft, actualRight] = processWahWahChannels([left, right], baselineSettings, 1000);
    expect(actualLeft).toEqual(processWahWah(left, baselineSettings, 1000));
    expect(actualRight).toEqual(actualLeft);
  });

  it('rejects missing or unequal channels', () => {
    expect(() => processWahWahChannels([], baselineSettings, 1000)).toThrow('至少需要一个');
    expect(() => processWahWahChannels(
      [new Float32Array(30), new Float32Array(31)],
      baselineSettings,
      1000,
    )).toThrow('等长');
  });
});
