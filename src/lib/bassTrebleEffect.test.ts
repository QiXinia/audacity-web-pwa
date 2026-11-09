import { describe, expect, it } from 'vitest';
import {
  applyLinkedToneChange,
  createBassTrebleState,
  DEFAULT_BASS_TREBLE_SETTINGS,
  isBassTrebleBypassed,
  processBassTreble,
  processBassTrebleChannels,
  validateBassTrebleSettings,
  type BassTrebleSettings,
} from './bassTrebleEffect';

const GOLDEN_SETTINGS: BassTrebleSettings = {
  bassDb: 6,
  trebleDb: -3,
  gainDb: 1.5,
  linkSliders: false,
};
const GOLDEN_INPUT = Float32Array.from([0, 1, -0.5, 0.25, 0.75, -1, 0.125, -0.25, 0.5, -0.75, 1, -0.125]);
// Independently calculated from Audacity-4.0.2 BassTrebleBase.cpp with Python.
// The C++ float stores after bass, treble and output gain were rounded explicitly.
const GOLDEN_OUTPUT = Float32Array.from([
  0,
  1.2726562023162842,
  -0.48291927576065063,
  0.36818039417266846,
  1.0350265502929688,
  -1.0900685787200928,
  0.15779295563697815,
  -0.29793787002563477,
  0.6164429783821106,
  -0.8926292061805725,
  1.2099117040634155,
  -0.05614062771201134,
]);

describe('Audacity 4.0.2 Bass and Treble DSP', () => {
  it('matches the independent official-formula numerical baseline exactly', () => {
    expect(processBassTreble(GOLDEN_INPUT, GOLDEN_SETTINGS, 8000)).toEqual(GOLDEN_OUTPUT);
  });

  it('preserves filter history across clip-sized calls', () => {
    const state = createBassTrebleState(GOLDEN_SETTINGS, 8000);
    const first = processBassTreble(GOLDEN_INPUT.slice(0, 5), GOLDEN_SETTINGS, 8000, state);
    const second = processBassTreble(GOLDEN_INPUT.slice(5), GOLDEN_SETTINGS, 8000, state);
    const joined = new Float32Array(GOLDEN_OUTPUT.length);
    joined.set(first);
    joined.set(second, first.length);
    expect(joined).toEqual(GOLDEN_OUTPUT);
  });

  it('uses independent state per channel', () => {
    const inverted = new Float32Array(GOLDEN_INPUT.map((value) => -value));
    const output = processBassTrebleChannels([GOLDEN_INPUT, inverted], GOLDEN_SETTINGS, 8000);
    expect(output[0]).toEqual(GOLDEN_OUTPUT);
    const expectedInverted = new Float32Array(GOLDEN_OUTPUT.map((value) => value === 0 ? 0 : -value));
    expect(output[1]).toEqual(expectedInverted);
  });

  it('matches a single multi-channel call when states are reused across clips', () => {
    const states = GOLDEN_INPUT.length >= 0
      ? [createBassTrebleState(GOLDEN_SETTINGS, 8000), createBassTrebleState(GOLDEN_SETTINGS, 8000)]
      : [];
    const first = processBassTrebleChannels([
      GOLDEN_INPUT.slice(0, 4), GOLDEN_INPUT.slice(0, 4),
    ], GOLDEN_SETTINGS, 8000, states);
    const second = processBassTrebleChannels([
      GOLDEN_INPUT.slice(4), GOLDEN_INPUT.slice(4),
    ], GOLDEN_SETTINGS, 8000, states);
    expect(first[0]).toEqual(GOLDEN_OUTPUT.slice(0, 4));
    expect(second[0]).toEqual(GOLDEN_OUTPUT.slice(4));
    expect(second[1]).toEqual(second[0]);
  });

  it('handles empty input and silence without non-finite samples', () => {
    expect(processBassTreble(new Float32Array(), GOLDEN_SETTINGS, 8000)).toEqual(new Float32Array());
    expect(processBassTreble(new Float32Array(32), GOLDEN_SETTINGS, 8000)).toEqual(new Float32Array(32));
  });

  it('applies output gain after the shelf filters', () => {
    const input = Float32Array.from([1, -0.5, 0.25]);
    const base = { ...DEFAULT_BASS_TREBLE_SETTINGS };
    const plain = processBassTreble(input, base, 8000);
    const gained = processBassTreble(input, { ...base, gainDb: 6 }, 8000);
    gained.forEach((value, index) => expect(value).toBeCloseTo(plain[index] * 10 ** (6 / 20), 5));
  });

  it.each([
    [{ ...DEFAULT_BASS_TREBLE_SETTINGS, bassDb: 31 }, '低音'],
    [{ ...DEFAULT_BASS_TREBLE_SETTINGS, trebleDb: -31 }, '高音'],
    [{ ...DEFAULT_BASS_TREBLE_SETTINGS, gainDb: Number.NaN }, '输出音量'],
  ])('rejects invalid settings %#', (settings, label) => {
    expect(() => validateBassTrebleSettings(settings)).toThrow(String(label));
  });

  it('rejects invalid sample rates and malformed channel collections', () => {
    expect(() => processBassTreble(new Float32Array(1), GOLDEN_SETTINGS, 0)).toThrow('采样率');
    expect(() => processBassTrebleChannels([], GOLDEN_SETTINGS, 8000)).toThrow('至少需要一个');
    expect(() => processBassTrebleChannels([
      new Float32Array(1), new Float32Array(2),
    ], GOLDEN_SETTINGS, 8000)).toThrow('必须等长');
    expect(() => processBassTrebleChannels([
      new Float32Array(1), new Float32Array(1),
    ], GOLDEN_SETTINGS, 8000, [createBassTrebleState(GOLDEN_SETTINGS, 8000)])).toThrow('滤波状态');
  });

  it('rejects non-finite Float32 output instead of leaking Infinity', () => {
    expect(() => processBassTreble(
      Float32Array.from([Number.MAX_VALUE]),
      { ...DEFAULT_BASS_TREBLE_SETTINGS, gainDb: 30 },
      8000,
    )).toThrow('非有限输出');
  });

  it('recognizes the upstream all-zero skip condition without treating Link as DSP', () => {
    expect(isBassTrebleBypassed({ ...DEFAULT_BASS_TREBLE_SETTINGS, linkSliders: true })).toBe(true);
    expect(isBassTrebleBypassed({ ...DEFAULT_BASS_TREBLE_SETTINGS, bassDb: 0.1 })).toBe(false);
    expect(isBassTrebleBypassed({ ...DEFAULT_BASS_TREBLE_SETTINGS, gainDb: -0.1 })).toBe(false);
  });
});

describe('Bass and Treble linked tone controls', () => {
  it('compensates positive tone boosts by half their delta', () => {
    const result = applyLinkedToneChange({
      bassDb: 2, trebleDb: 0, gainDb: 1, linkSliders: true,
    }, 'bass', 8);
    expect(result).toEqual({ bassDb: 8, trebleDb: 0, gainDb: -2, linkSliders: true });
  });

  it('compensates tone cuts by one quarter of their delta', () => {
    const result = applyLinkedToneChange({
      bassDb: 0, trebleDb: -4, gainDb: 2, linkSliders: true,
    }, 'treble', -12);
    expect(result).toEqual({ bassDb: 0, trebleDb: -12, gainDb: 4, linkSliders: true });
  });

  it('clamps linked gain and leaves unlinked gain unchanged', () => {
    expect(applyLinkedToneChange({
      bassDb: 0, trebleDb: 0, gainDb: -29, linkSliders: true,
    }, 'bass', 30).gainDb).toBe(-30);
    expect(applyLinkedToneChange({
      bassDb: 0, trebleDb: 0, gainDb: 7, linkSliders: false,
    }, 'bass', 10)).toEqual({ bassDb: 10, trebleDb: 0, gainDb: 7, linkSliders: false });
  });

  it('validates linked tone input', () => {
    expect(() => applyLinkedToneChange({ ...DEFAULT_BASS_TREBLE_SETTINGS }, 'bass', 31)).toThrow('低音');
    expect(() => applyLinkedToneChange({ ...DEFAULT_BASS_TREBLE_SETTINGS }, 'treble', Number.NaN)).toThrow('高音');
  });
});
