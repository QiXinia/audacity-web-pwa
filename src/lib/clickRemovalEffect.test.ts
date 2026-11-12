import { describe, expect, it } from 'vitest';
import type { IClip, ITrack } from '@/types/project';
import {
  CLICK_REMOVAL_INEFFECTIVE_ERROR,
  DEFAULT_CLICK_REMOVAL_SETTINGS,
  processClickRemovalChannels,
  processClickRemovalTrack,
  validateClickRemovalSettings,
} from './clickRemovalEffect';

const SAMPLE_RATE = 1000;

function officialOracleInput(): Float32Array {
  const input = new Float32Array(8192);
  for (let index = 0; index < input.length; index += 1) {
    input[index] = Math.fround((((index * 37) % 2001) - 1000) / 50000);
  }
  for (let index = 1500; index < 1503; index += 1) {
    input[index] = Math.fround(input[index] + Math.fround(index % 2 ? -0.9 : 0.9));
  }
  for (let index = 5000; index < 5005; index += 1) {
    input[index] = Math.fround(input[index] + Math.fround(index % 2 ? 0.8 : -0.8));
  }
  input[7000] = Math.fround(input[7000] + Math.fround(0.5));
  return input;
}

function makeClip(id: string, startTime: number, duration: number): IClip {
  return {
    id,
    audioBufferId: `buffer-${id}`,
    name: id,
    startTime,
    duration,
    originalDuration: duration,
    stretchRatio: 1,
    offset: 0,
    gain: 0,
    fadeIn: 0,
    fadeOut: 0,
  };
}

function makeTrack(clips: IClip[]): ITrack {
  return {
    id: 'track-1',
    name: 'Track 1',
    type: 'audio',
    clips,
    gain: 0,
    pan: 0,
    muted: false,
    solo: false,
    armed: false,
    color: '',
    effects: [],
  };
}

describe('Click Removal official DSP', () => {
  it('matches the standalone Audacity 4.0.2 C++ oracle sample-for-sample', () => {
    const input = officialOracleInput();
    const original = new Float32Array(input);
    const result = processClickRemovalChannels([input], DEFAULT_CLICK_REMOVAL_SETTINGS);

    expect(result.changed).toBe(true);
    expect(result.changedSamples).toBe(22);
    expect(input).toEqual(original);
    const changedIndices = [...result.sampleData[0].keys()]
      .filter((index) => result.sampleData[0][index] !== input[index]);
    expect(changedIndices).toEqual([1498, 1500, 1501, 1502, 1503, 4998, 5000, 5001, 5002, 5003, 5004, 5005]);
    const expected = new Float32Array(input);
    expected[1498] = Math.fround(0.007979999296);
    expected[1500] = Math.fround(0.009460000321);
    expected[1501] = Math.fround(0.01019999944);
    expected[1502] = Math.fround(0.01094000041);
    expected[1503] = Math.fround(0.01167999953);
    expected[4998] = Math.fround(-0.003320000134);
    expected[5000] = Math.fround(-0.001840000157);
    expected[5001] = Math.fround(-0.00110000011);
    expected[5002] = Math.fround(-0.0003600000928);
    expected[5003] = Math.fround(0.0003799997794);
    expected[5004] = Math.fround(0.001119999797);
    expected[5005] = Math.fround(0.001859999844);
    expect(result.sampleData[0]).toEqual(expected);
  });

  it('enforces the official >4096-sample rule only when the effect is not bypassed', () => {
    expect(() => processClickRemovalChannels(
      [new Float32Array(4096)],
      DEFAULT_CLICK_REMOVAL_SETTINGS,
    )).toThrow('Selection must be larger than 4096 samples.');
    const accepted = processClickRemovalChannels(
      [new Float32Array(4097)],
      DEFAULT_CLICK_REMOVAL_SETTINGS,
    );
    expect(accepted.changed).toBe(false);
    expect(accepted.sampleData[0]).toEqual(new Float32Array(4097));
    const skipped = processClickRemovalChannels([new Float32Array(1)], { threshold: 0, width: 20 });
    expect(skipped.changed).toBe(false);
    expect(skipped.sampleData[0]).toEqual(new Float32Array(1));
  });

  it('returns an unchanged copy when no click is detected', () => {
    const input = new Float32Array(8192).fill(0.01);
    const result = processClickRemovalChannels([input], DEFAULT_CLICK_REMOVAL_SETTINGS);
    expect(CLICK_REMOVAL_INEFFECTIVE_ERROR).toBe('Algorithm not effective on this audio. Nothing changed.');
    expect(result.changed).toBe(false);
    expect(result.changedSamples).toBe(0);
    expect(result.sampleData[0]).toEqual(input);
    expect(result.sampleData[0]).not.toBe(input);
  });

  it('validates parameter bounds and non-finite input', () => {
    expect(() => validateClickRemovalSettings({ threshold: -1, width: 20 })).toThrow(RangeError);
    expect(() => validateClickRemovalSettings({ threshold: 901, width: 20 })).toThrow(RangeError);
    expect(() => validateClickRemovalSettings({ threshold: 200, width: 41 })).toThrow(RangeError);
    expect(() => validateClickRemovalSettings({ threshold: 200.5, width: 20 })).toThrow(RangeError);
    expect(() => validateClickRemovalSettings(DEFAULT_CLICK_REMOVAL_SETTINGS)).not.toThrow();
    const invalid = new Float32Array(4097);
    invalid[200] = Number.NaN;
    expect(() => processClickRemovalChannels([invalid], DEFAULT_CLICK_REMOVAL_SETTINGS))
      .toThrow('非有限值');
  });

  it('keeps timeline gaps and joins clips before enforcing the per-track minimum', () => {
    const track = makeTrack([makeClip('a', 0, 3), makeClip('b', 4, 3)]);
    const left = new Float32Array(3000);
    const right = new Float32Array(3000);
    left[1500] = 0.9;
    right[1000] = -0.9;
    const result = processClickRemovalTrack(
      track,
      {
        trackId: track.id,
        clips: [
          { clipId: 'a', sampleData: [left], sourceOffset: 0 },
          { clipId: 'b', sampleData: [right], sourceOffset: 0 },
        ],
      },
      { start: 0, end: 7 },
      DEFAULT_CLICK_REMOVAL_SETTINGS,
      SAMPLE_RATE,
    );
    expect(result.selectionChannels[0]).toHaveLength(7000);
    expect(result.selectionChannels[0][3500]).toBe(0);
    expect(result.clips.map(({ clipId }) => clipId)).toEqual(['a', 'b']);
    expect(left[1500]).toBe(Math.fround(0.9));
    expect(right[1000]).toBe(Math.fround(-0.9));
  });

  it('fails closed on incomplete track ownership or a short joined selection', () => {
    const track = makeTrack([makeClip('a', 0, 3), makeClip('b', 3, 3)]);
    expect(() => processClickRemovalTrack(
      track,
      { trackId: track.id, clips: [{ clipId: 'a', sampleData: [new Float32Array(3000)], sourceOffset: 0 }] },
      { start: 0, end: 6 },
      DEFAULT_CLICK_REMOVAL_SETTINGS,
      SAMPLE_RATE,
    )).toThrow('完整轨道音频');

    expect(() => processClickRemovalTrack(
      track,
      {
        trackId: track.id,
        clips: [
          { clipId: 'a', sampleData: [new Float32Array(3000)], sourceOffset: 0 },
          { clipId: 'b', sampleData: [new Float32Array(3000)], sourceOffset: 0 },
        ],
      },
      { start: 0, end: 4.096 },
      DEFAULT_CLICK_REMOVAL_SETTINGS,
      SAMPLE_RATE,
    )).toThrow('Selection must be larger than 4096 samples.');
  });
});
