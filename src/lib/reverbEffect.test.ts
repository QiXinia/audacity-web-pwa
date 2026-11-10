import { describe, expect, it } from 'vitest';
import {
  createReverbState,
  DEFAULT_REVERB_SETTINGS,
  processReverbChannels,
  processReverbSelection,
  validateReverbSettings,
  type ReverbSettings,
} from './reverbEffect';

const impulseSettings: ReverbSettings = {
  ...DEFAULT_REVERB_SETTINGS,
  roomSize: 30,
  preDelayMs: 10,
  reverberance: 75,
  wetOnly: true,
};

describe('reverbEffect', () => {
  it('uses the Audacity 4 defaults and validates every official range', () => {
    expect(DEFAULT_REVERB_SETTINGS).toEqual({
      roomSize: 75,
      preDelayMs: 10,
      reverberance: 50,
      hfDamping: 50,
      toneLow: 100,
      toneHigh: 100,
      wetGainDb: -1,
      dryGainDb: -1,
      stereoWidth: 100,
      wetOnly: false,
    });
    expect(() => validateReverbSettings({ ...DEFAULT_REVERB_SETTINGS, roomSize: 101 })).toThrow('房间大小');
    expect(() => validateReverbSettings({ ...DEFAULT_REVERB_SETTINGS, preDelayMs: -1 })).toThrow('预延迟');
    expect(() => validateReverbSettings({ ...DEFAULT_REVERB_SETTINGS, reverberance: Number.NaN })).toThrow('混响强度');
    expect(() => validateReverbSettings({ ...DEFAULT_REVERB_SETTINGS, hfDamping: 101 })).toThrow('高频阻尼');
    expect(() => validateReverbSettings({ ...DEFAULT_REVERB_SETTINGS, toneLow: -1 })).toThrow('低音色调');
    expect(() => validateReverbSettings({ ...DEFAULT_REVERB_SETTINGS, toneHigh: 101 })).toThrow('高音色调');
    expect(() => validateReverbSettings({ ...DEFAULT_REVERB_SETTINGS, wetGainDb: 11 })).toThrow('湿声增益');
    expect(() => validateReverbSettings({ ...DEFAULT_REVERB_SETTINGS, dryGainDb: -21 })).toThrow('干声增益');
    expect(() => validateReverbSettings({ ...DEFAULT_REVERB_SETTINGS, stereoWidth: -1 })).toThrow('立体声宽度');
  });

  it('applies dry gain immediately and generates a delayed, finite reverb tail', () => {
    const input = new Float32Array(1200);
    input[0] = 1;
    const withDry = processReverbChannels([input], DEFAULT_REVERB_SETTINGS, 1000)[0];
    expect(withDry[0]).toBeCloseTo(10 ** (-1 / 20), 6);
    expect(withDry.slice(1, 10).every((sample) => sample === 0)).toBe(true);

    const wet = processReverbChannels([input], impulseSettings, 1000)[0];
    expect(wet.slice(0, 10).every((sample) => sample === 0)).toBe(true);
    expect(wet.some((sample) => sample !== 0)).toBe(true);
    expect(wet.every(Number.isFinite)).toBe(true);
    expect(input[0]).toBe(1);
    expect(input.slice(1).every((sample) => sample === 0)).toBe(true);
  });

  it('honours wet-only and zero-width mono wet processing', () => {
    const settings: ReverbSettings = {
      ...impulseSettings,
      preDelayMs: 0,
      stereoWidth: 0,
    };
    const left = new Float32Array(500);
    const right = new Float32Array(500);
    left[0] = 0.75;
    right[0] = 0.75;
    const output = processReverbChannels([left, right], settings, 1000);
    expect(output[0]).toEqual(output[1]);
    expect(output[0].some((sample) => sample !== 0)).toBe(true);
  });

  it('uses independent stereo filter delays when stereo width is enabled', () => {
    const left = new Float32Array(500);
    const right = new Float32Array(500);
    left[0] = 0.75;
    right[0] = 0.75;
    const output = processReverbChannels([left, right], impulseSettings, 1000);
    expect(output[0]).not.toEqual(output[1]);
    expect(output.every((channel) => channel.every(Number.isFinite))).toBe(true);
  });

  it('preserves pre-delay and filter history across selected clips', () => {
    const source = Float32Array.from({ length: 256 }, (_, index) => Math.sin(index * 0.17) * 0.5);
    const settings: ReverbSettings = { ...DEFAULT_REVERB_SETTINGS, preDelayMs: 5, roomSize: 40 };
    const whole = processReverbChannels([source], settings, 1000)[0];
    const state = createReverbState(settings, 1000, 1);
    const first = processReverbChannels([source.slice(0, 113)], settings, 1000, state)[0];
    const second = processReverbChannels([source.slice(113)], settings, 1000, state)[0];
    const joined = new Float32Array(source.length);
    joined.set(first, 0);
    joined.set(second, first.length);
    expect(joined).toEqual(whole);
    expect(second).not.toEqual(processReverbChannels([source.slice(113)], settings, 1000)[0]);
  });

  it('copies only the requested samples and rejects invalid state or non-finite PCM', () => {
    const input = Float32Array.from([0.1, 0.2, 0.3, 0.4]);
    const state = createReverbState(DEFAULT_REVERB_SETTINGS, 1000, 1);
    const output = processReverbSelection([input], 1, 3, state)[0];
    expect(output[0]).toBe(input[0]);
    expect(output[3]).toBe(input[3]);
    expect(() => processReverbSelection([input], 0, 5, state)).toThrow('选区');
    expect(() => createReverbState(DEFAULT_REVERB_SETTINGS, 1000, 3)).toThrow('单声道或立体声');
    expect(() => processReverbChannels([Float32Array.of(0, Number.NaN)], DEFAULT_REVERB_SETTINGS, 1000)).toThrow('非有限值');
    expect(() => processReverbChannels([], DEFAULT_REVERB_SETTINGS, 1000)).toThrow('至少需要一个音频声道');
  });
});
