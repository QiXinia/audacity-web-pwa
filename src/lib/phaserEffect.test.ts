import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PHASER_SETTINGS,
  PHASER_MAX_STAGES,
  createPhaserState,
  normalizePhaserSettings,
  processPhaser,
  processPhaserChannels,
  validatePhaserSettings,
  type PhaserSettings,
} from './phaserEffect';

const settings: PhaserSettings = {
  stages: 4,
  dryWet: 180,
  frequencyHz: 1.25,
  phaseDegrees: 45,
  depth: 210,
  feedbackPercent: 70,
  outputGainDb: -3,
};

function input(length = 137): Float32Array {
  return Float32Array.from({ length }, (_, index) => (
    index % 29 === 0 ? 0.75 : Math.sin(index * 0.17) * 0.2
  ));
}

describe('Phaser settings', () => {
  it('keeps all seven Audacity 4.0.2 defaults and normalizes odd stages downward', () => {
    expect(DEFAULT_PHASER_SETTINGS).toEqual({
      stages: 2,
      dryWet: 128,
      frequencyHz: 0.4,
      phaseDegrees: 0,
      depth: 100,
      feedbackPercent: 0,
      outputGainDb: -6,
    });
    expect(Object.isFrozen(DEFAULT_PHASER_SETTINGS)).toBe(true);
    expect(normalizePhaserSettings({ ...DEFAULT_PHASER_SETTINGS, stages: 23 }).stages).toBe(22);
    expect(normalizePhaserSettings({ ...DEFAULT_PHASER_SETTINGS, stages: 24 }).stages).toBe(24);
  });

  it.each([
    ['stages', 1], ['stages', 25], ['stages', 2.5],
    ['dryWet', -1], ['dryWet', 256], ['dryWet', 1.5],
    ['frequencyHz', 0], ['frequencyHz', 4.1],
    ['phaseDegrees', -1], ['phaseDegrees', 361],
    ['depth', -1], ['depth', 256], ['depth', 1.5],
    ['feedbackPercent', -101], ['feedbackPercent', 101], ['feedbackPercent', 1.5],
    ['outputGainDb', -31], ['outputGainDb', 31],
    ['frequencyHz', Number.NaN],
  ])('rejects invalid %s=%s', (key, value) => {
    expect(() => validatePhaserSettings({ ...DEFAULT_PHASER_SETTINGS, [key]: value }))
      .toThrow(RangeError);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])('rejects sample rate %s', (sampleRate) => {
    expect(() => processPhaser(input(), settings, sampleRate)).toThrow('采样率');
    expect(() => createPhaserState(settings, sampleRate)).toThrow('采样率');
  });
});

describe('Audacity 4.0.2 Phaser DSP', () => {
  it('is deterministic, does not mutate input, and preserves dry-only samples exactly', () => {
    const source = input();
    const snapshot = new Float32Array(source);
    const first = processPhaser(source, settings, 44100);
    const second = processPhaser(source, settings, 44100);
    expect(source).toEqual(snapshot);
    expect(first).toEqual(second);
    expect(first).not.toBe(source);
    expect(first.some((value, index) => value !== source[index])).toBe(true);

    const dry = processPhaser(source, {
      ...settings,
      dryWet: 0,
      outputGainDb: 0,
    }, 44100);
    expect(dry).toEqual(source);
  });

  it('keeps silence silent through all 24 stages and maximum feedback', () => {
    const output = processPhaser(new Float32Array(2000), {
      ...settings,
      stages: PHASER_MAX_STAGES,
      feedbackPercent: 100,
      outputGainDb: 30,
    }, 44100);
    expect(output.every((value) => value === 0)).toBe(true);
    expect(processPhaser(new Float32Array(0), settings, 44100)).toHaveLength(0);
  });

  it('preserves LFO, all-pass and feedback state across arbitrary clip boundaries', () => {
    const source = input(211);
    const expected = processPhaser(source, settings, 1000);
    const state = createPhaserState(settings, 1000);
    const first = processPhaser(source.slice(0, 17), settings, 1000, state);
    const second = processPhaser(source.slice(17, 83), settings, 1000, state);
    const third = processPhaser(source.slice(83), settings, 1000, state);
    const actual = new Float32Array(source.length);
    actual.set(first, 0);
    actual.set(second, 17);
    actual.set(third, 83);
    expect(actual).toEqual(expected);
    expect(state.skipCount).toBe(source.length);
  });

  it('uses independent channel feedback and filter histories', () => {
    const left = input();
    const right = new Float32Array(left.length);
    const [actualLeft, actualRight] = processPhaserChannels([left, right], settings, 1000);
    expect(actualLeft).toEqual(processPhaser(left, settings, 1000));
    expect(actualRight.every((value) => value === 0)).toBe(true);

    const identical = processPhaserChannels([left, new Float32Array(left)], settings, 1000);
    expect(identical[1]).toEqual(identical[0]);
  });

  it('rejects missing, unequal or mismatched channel states', () => {
    expect(() => processPhaserChannels([], settings, 1000)).toThrow('至少需要一个');
    expect(() => processPhaserChannels([
      new Float32Array(10), new Float32Array(11),
    ], settings, 1000)).toThrow('等长');
    expect(() => processPhaserChannels([
      new Float32Array(10), new Float32Array(10),
    ], settings, 1000, [createPhaserState(settings, 1000)])).toThrow('每个输入声道');
  });
});
