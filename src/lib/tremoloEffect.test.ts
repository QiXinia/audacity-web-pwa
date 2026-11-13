import { describe, expect, it } from 'vitest';
import {
  createTremoloState,
  DEFAULT_TREMOLO_SETTINGS,
  processTremolo,
  processTremoloChannels,
  TREMOLO_WAVEFORMS,
  validateTremoloSettings,
  type TremoloSettings,
} from './tremoloEffect';

const ones = (length: number) => new Float32Array(length).fill(1);
const settings = (overrides: Partial<TremoloSettings> = {}): TremoloSettings => ({
  ...DEFAULT_TREMOLO_SETTINGS,
  ...overrides,
});

function selected(values: Float32Array, indexes: number[]): number[] {
  return indexes.map((index) => values[index]);
}

describe('Audacity 4.0.2 Tremolo settings', () => {
  it('matches the official Nyquist defaults and waveform order', () => {
    expect(DEFAULT_TREMOLO_SETTINGS).toEqual({
      waveform: 'sine', phaseDegrees: 0, wetPercent: 40, frequencyHz: 4,
    });
    expect(TREMOLO_WAVEFORMS).toEqual([
      'sine', 'triangle', 'sawtooth', 'inverseSawtooth', 'square',
    ]);
    expect(Object.isFrozen(DEFAULT_TREMOLO_SETTINGS)).toBe(true);
  });

  it.each([
    [{ waveform: 'invalid' }, '波形类型'],
    [{ phaseDegrees: -181 }, '起始相位'],
    [{ phaseDegrees: 180.5 }, '起始相位'],
    [{ wetPercent: 0 }, 'Wet 百分比'],
    [{ wetPercent: 40.5 }, 'Wet 百分比'],
    [{ frequencyHz: 0 }, 'LFO 频率'],
    [{ frequencyHz: 1001 }, 'LFO 频率'],
    [{ frequencyHz: Number.NaN }, 'LFO 频率'],
  ] as const)('rejects unsupported settings %#', (override, message) => {
    expect(() => validateTremoloSettings(settings(override as Partial<TremoloSettings>))).toThrow(message);
  });

  it('accepts every official endpoint', () => {
    for (const waveform of TREMOLO_WAVEFORMS) {
      expect(() => validateTremoloSettings(settings({ waveform, phaseDegrees: -180, wetPercent: 1, frequencyHz: 0.001 }))).not.toThrow();
      expect(() => validateTremoloSettings(settings({ waveform, phaseDegrees: 180, wetPercent: 100, frequencyHz: 1000 }))).not.toThrow();
    }
  });
});

describe('Audacity 4.0.2 Tremolo DSP', () => {
  it('uses gain = 1-WET/200 + WET/200*osc with the 90-degree sine shift', () => {
    const actual = processTremolo(ones(8), settings({ frequencyHz: 1 }), 8);
    const expected = [0.6, 0.8 - 0.2 / Math.sqrt(2), 0.8, 0.8 + 0.2 / Math.sqrt(2), 1,
      0.8 + 0.2 / Math.sqrt(2), 0.8, 0.8 - 0.2 / Math.sqrt(2)];
    expected.forEach((value, index) => expect(actual[index]).toBeCloseTo(value, 6));
  });

  it('reaches zero gain only at a 100 percent wet sine trough', () => {
    expect(processTremolo(ones(1), settings({ frequencyHz: 1, wetPercent: 100 }), 8)[0]).toBe(0);
    expect(processTremolo(ones(1), settings({ frequencyHz: 1, wetPercent: 1 }), 8)[0]).toBeCloseTo(0.99, 6);
    expect(processTremolo(ones(1), settings({ frequencyHz: 1, phaseDegrees: 180 }), 8)[0]).toBe(1);
  });

  it.each([
    ['triangle', [0, 0.25, 1, 0.01, 0.99]],
    ['sawtooth', [0, 0.12562814, 0.50251256, 1, 0.50753769]],
    ['inverseSawtooth', [0, 0.87939698, 0.50251256, 0.00502513, 0.49748744]],
    ['square', [0, 1, 1, 0, 0]],
  ] as const)('reproduces the %s Nyquist table breakpoints', (waveform, expected) => {
    const actual = processTremolo(ones(1000), settings({ waveform, frequencyHz: 1, wetPercent: 100 }), 1000);
    const observed = selected(actual, [0, 125, 500, 995, 505]);
    const ordered = [observed[0], observed[1], observed[2], observed[3], observed[4]];
    ordered.forEach((value, index) => expect(value).toBeCloseTo(expected[index], 6));
  });

  it('keeps stereo channels sample-locked and preserves input immutability', () => {
    const left = Float32Array.from({ length: 64 }, (_, index) => index / 64);
    const right = new Float32Array(left);
    const leftBefore = new Float32Array(left);
    const [actualLeft, actualRight] = processTremoloChannels([left, right], settings({ frequencyHz: 17 }), 1000);
    expect(left).toEqual(leftBefore);
    expect(right).toEqual(leftBefore);
    expect(actualRight).toEqual(actualLeft);
  });

  it('continues one oscillator across arbitrary clip boundaries', () => {
    const source = Float32Array.from({ length: 97 }, (_, index) => Math.sin(index / 9));
    const whole = processTremoloChannels([source, source], settings({ frequencyHz: 13, waveform: 'triangle' }), 1000);
    const state = createTremoloState();
    const first = processTremoloChannels([source.slice(0, 17), source.slice(0, 17)], settings({ frequencyHz: 13, waveform: 'triangle' }), 1000, state);
    const second = processTremoloChannels([source.slice(17), source.slice(17)], settings({ frequencyHz: 13, waveform: 'triangle' }), 1000, state);
    expect(state.sampleOffset).toBe(97);
    for (let channel = 0; channel < 2; channel += 1) {
      expect(Array.from(first[channel]).concat(Array.from(second[channel]))).toEqual(Array.from(whole[channel]));
    }
  });

  it('supports empty audio but rejects invalid sample rates, ragged channels and non-finite PCM', () => {
    expect(processTremolo(new Float32Array(0), settings(), 44100)).toHaveLength(0);
    expect(() => processTremolo(ones(2), settings(), 0)).toThrow('采样率');
    expect(() => processTremoloChannels([ones(2), ones(1)], settings(), 44100)).toThrow('等长');
    expect(() => processTremoloChannels([], settings(), 44100)).toThrow('至少需要');
    expect(() => processTremolo(Float32Array.from([1, Number.NaN]), settings(), 44100)).toThrow('非有限');
    expect(() => processTremolo(ones(2), settings(), 44100, { sampleOffset: -1 })).toThrow('采样偏移');
  });
});
