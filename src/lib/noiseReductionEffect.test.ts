import { describe, expect, it } from 'vitest';
import type { IClip, ITrack } from '@/types/project';
import {
  DEFAULT_NOISE_REDUCTION_SETTINGS,
  NOISE_REDUCTION_SPECTRUM_SIZE,
  learnNoiseProfile,
  learnNoiseProfileFromTracks,
  processNoiseReductionChannels,
  processNoiseReductionTrack,
  validateNoiseReductionSettings,
} from './noiseReductionEffect';

const SAMPLE_RATE = 1000;

function deterministicNoise(length: number): Float32Array {
  let state = 0x12345678;
  const result = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    result[index] = Math.fround((state / 0x100000000 - 0.5) * 0.08);
  }
  return result;
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

function makeTrack(clips: IClip[], id = 'track-1'): ITrack {
  return {
    id,
    name: id,
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

function maxAbsoluteDifference(left: Float32Array, right: Float32Array): number {
  let maximum = 0;
  for (let index = 0; index < left.length; index += 1) {
    maximum = Math.max(maximum, Math.abs(left[index] - right[index]));
  }
  return maximum;
}

function rms(channel: Float32Array, start: number, end: number): number {
  let sum = 0;
  for (let index = start; index < end; index += 1) sum += channel[index] ** 2;
  return Math.sqrt(sum / (end - start));
}

describe('Noise Reduction official two-pass DSP', () => {
  it('exposes Audacity defaults and enforces the official parameter ranges', () => {
    expect(DEFAULT_NOISE_REDUCTION_SETTINGS).toEqual({
      noiseGain: 6,
      sensitivity: 6,
      frequencySmoothingBands: 6,
      mode: 'reduce',
    });
    expect(() => validateNoiseReductionSettings(DEFAULT_NOISE_REDUCTION_SETTINGS)).not.toThrow();
    expect(() => validateNoiseReductionSettings({ ...DEFAULT_NOISE_REDUCTION_SETTINGS, noiseGain: 6.5 })).toThrow(RangeError);
    expect(() => validateNoiseReductionSettings({ ...DEFAULT_NOISE_REDUCTION_SETTINGS, noiseGain: 49 })).toThrow(RangeError);
    expect(() => validateNoiseReductionSettings({ ...DEFAULT_NOISE_REDUCTION_SETTINGS, sensitivity: 0 })).toThrow(RangeError);
    expect(() => validateNoiseReductionSettings({ ...DEFAULT_NOISE_REDUCTION_SETTINGS, sensitivity: 25 })).toThrow(RangeError);
    expect(() => validateNoiseReductionSettings({ ...DEFAULT_NOISE_REDUCTION_SETTINGS, frequencySmoothingBands: 13 })).toThrow(RangeError);
    expect(() => validateNoiseReductionSettings({ ...DEFAULT_NOISE_REDUCTION_SETTINGS, mode: 'isolate' as never })).toThrow(RangeError);
  });

  it('learns 1025-bin power statistics and weights channels by complete window count', () => {
    const first = new Float32Array(2048).fill(0.02);
    const second = new Float32Array(4096).fill(-0.01);
    const firstProfile = learnNoiseProfile([first], SAMPLE_RATE);
    const secondProfile = learnNoiseProfile([second], SAMPLE_RATE);
    const firstTrack = makeTrack([makeClip('first', 0, 2.048)], 'first-track');
    const secondTrack = makeTrack([makeClip('second', 0, 4.096)], 'second-track');
    const combined = learnNoiseProfileFromTracks(
      [firstTrack, secondTrack],
      [
        { trackId: firstTrack.id, clips: [{ clipId: 'first', sampleData: [first], sourceOffset: 0 }] },
        { trackId: secondTrack.id, clips: [{ clipId: 'second', sampleData: [second], sourceOffset: 0 }] },
      ],
      { start: 0, end: 4.096 },
      SAMPLE_RATE,
    );
    expect(firstProfile.totalWindows).toBe(1);
    expect(secondProfile.totalWindows).toBe(5);
    expect(combined.totalWindows).toBe(6);
    expect(combined.means).toHaveLength(NOISE_REDUCTION_SPECTRUM_SIZE);
    for (let band = 0; band < combined.means.length; band += 1) {
      const expected = (firstProfile.means[band] + 5 * secondProfile.means[band]) / 6;
      expect(Math.abs(combined.means[band] - expected)).toBeLessThan(2e-8);
    }
  });

  it('fails closed for a profile shorter than one official window and non-finite samples', () => {
    expect(() => learnNoiseProfile([new Float32Array(2047)], SAMPLE_RATE))
      .toThrow('Selected noise profile is too short.');
    const invalid = new Float32Array(2048);
    invalid[99] = Number.NaN;
    expect(() => learnNoiseProfile([invalid], SAMPLE_RATE)).toThrow('非有限值');
  });

  it('reconstructs the source at 0 dB and produces zero residue, proving FFT/OLA scaling', () => {
    const input = deterministicNoise(5000);
    const profile = learnNoiseProfile([input.subarray(0, 2048)], SAMPLE_RATE);
    const reduced = processNoiseReductionChannels(
      [input],
      profile,
      { ...DEFAULT_NOISE_REDUCTION_SETTINGS, noiseGain: 0 },
    )[0];
    const residue = processNoiseReductionChannels(
      [input],
      profile,
      { ...DEFAULT_NOISE_REDUCTION_SETTINGS, noiseGain: 0, mode: 'residue' },
    )[0];
    expect(maxAbsoluteDifference(reduced, input)).toBeLessThan(2e-6);
    expect(Math.max(...residue.map(Math.abs))).toBeLessThan(2e-6);
  });

  it('reduces profile-matched stationary noise, is deterministic and preserves source channels', () => {
    const noise = deterministicNoise(8192);
    const original = new Float32Array(noise);
    const profile = learnNoiseProfile([noise.subarray(0, 4096)], SAMPLE_RATE);
    const first = processNoiseReductionChannels([noise, noise], profile, DEFAULT_NOISE_REDUCTION_SETTINGS);
    const second = processNoiseReductionChannels([noise], profile, DEFAULT_NOISE_REDUCTION_SETTINGS);
    expect(first[0]).toEqual(first[1]);
    expect(first[0]).toEqual(second[0]);
    expect(first[0]).not.toBe(noise);
    expect(noise).toEqual(original);
    expect(rms(first[0], 2048, 7168)).toBeLessThan(rms(noise, 2048, 7168) * 0.65);
  });

  it('uses residue = gain - 1 rather than inversion or a generic filter', () => {
    const noise = deterministicNoise(6144);
    const profile = learnNoiseProfile([noise.subarray(0, 2048)], SAMPLE_RATE);
    const reduced = processNoiseReductionChannels([noise], profile, DEFAULT_NOISE_REDUCTION_SETTINGS)[0];
    const residue = processNoiseReductionChannels(
      [noise],
      profile,
      { ...DEFAULT_NOISE_REDUCTION_SETTINGS, mode: 'residue' },
    )[0];
    const expected = new Float32Array(noise.length);
    for (let index = 0; index < noise.length; index += 1) expected[index] = reduced[index] - noise[index];
    expect(maxAbsoluteDifference(residue, expected)).toBeLessThan(2e-5);
  });

  it('joins clips across timeline gaps for both profiling and processing without mutating clips', () => {
    const track = makeTrack([makeClip('a', 0, 2.048), makeClip('b', 3, 2.048)]);
    const left = deterministicNoise(2048);
    const right = deterministicNoise(2048).map((value) => Math.fround(value * 0.5));
    const target = {
      trackId: track.id,
      clips: [
        { clipId: 'a', sampleData: [left], sourceOffset: 0 },
        { clipId: 'b', sampleData: [right], sourceOffset: 0 },
      ],
    };
    const profile = learnNoiseProfileFromTracks([track], [target], { start: 0, end: 5.048 }, SAMPLE_RATE);
    const result = processNoiseReductionTrack(
      track,
      target,
      { start: 0, end: 5.048 },
      profile,
      { ...DEFAULT_NOISE_REDUCTION_SETTINGS, noiseGain: 0 },
      SAMPLE_RATE,
    );
    expect(result.selectionChannels[0]).toHaveLength(5048);
    expect(Math.abs(result.selectionChannels[0][2500])).toBeLessThan(2e-6);
    expect(maxAbsoluteDifference(result.clips[0].sampleData[0], left)).toBeLessThan(2e-6);
    expect(maxAbsoluteDifference(result.clips[1].sampleData[0], right)).toBeLessThan(2e-6);
    expect(result.clips.map(({ clipId }) => clipId)).toEqual(['a', 'b']);
  });

  it('rejects incomplete ownership and profile/sample-rate mismatch before processing', () => {
    const track = makeTrack([makeClip('a', 0, 2.048)]);
    const input = deterministicNoise(2048);
    const target = { trackId: track.id, clips: [{ clipId: 'a', sampleData: [input], sourceOffset: 0 }] };
    const profile = learnNoiseProfile([input], SAMPLE_RATE);
    expect(() => processNoiseReductionTrack(
      track,
      { trackId: track.id, clips: [] },
      { start: 0, end: 2.048 },
      profile,
      DEFAULT_NOISE_REDUCTION_SETTINGS,
      SAMPLE_RATE,
    )).toThrow('完整轨道音频');
    expect(() => processNoiseReductionTrack(
      track,
      target,
      { start: 0, end: 2.048 },
      { ...profile, sampleRate: SAMPLE_RATE + 1 },
      DEFAULT_NOISE_REDUCTION_SETTINGS,
      SAMPLE_RATE,
    )).toThrow('sample rate of the noise profile must match');
  });
});
