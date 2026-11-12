import { describe, expect, it } from 'vitest';
import type { IClip, ITrack } from '@/types/project';
import {
  createLoudnessPlan,
  DEFAULT_LOUDNESS_SETTINGS,
  loudnessExtentToLufs,
  measureEbuR128,
  processLoudnessChannels,
  processLoudnessTrack,
  validateLoudnessSettings,
  type LoudnessSettings,
  type LoudnessTrackInput,
} from './loudnessEffect';

function settings(patch: Partial<LoudnessSettings> = {}): LoudnessSettings {
  return { ...DEFAULT_LOUDNESS_SETTINGS, ...patch };
}

function noise(length: number, seed = 0x12345678, amplitude = 0.1): Float32Array {
  let state = seed >>> 0;
  const result = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    result[index] = Math.fround((state / 0x100000000 - 0.5) * amplitude);
  }
  return result;
}

function clip(id: string, startTime: number, duration: number): IClip {
  return {
    id, audioBufferId: `buffer-${id}`, startTime, duration, originalDuration: duration,
    stretchRatio: 1, offset: 0, gain: 0, fadeIn: 0, fadeOut: 0, name: id,
  };
}

function track(clips: IClip[]): ITrack {
  return {
    id: 'track-loudness', name: 'Loudness', type: 'audio', gain: 0, pan: 0,
    muted: false, solo: false, armed: false, color: '', clips, effects: [],
  };
}

describe('Audacity Loudness parameters and RMS', () => {
  it('uses the official defaults and validates both target ranges', () => {
    expect(DEFAULT_LOUDNESS_SETTINGS).toEqual({
      algorithm: 'loudness', lufsLevel: -23, rmsLevel: -20,
      stereoIndependent: false, dualMono: true,
    });
    expect(() => validateLoudnessSettings(settings({ lufsLevel: -145 }))).not.toThrow();
    expect(() => validateLoudnessSettings(settings({ lufsLevel: 0 }))).not.toThrow();
    expect(() => validateLoudnessSettings(settings({ lufsLevel: -145.1 }))).toThrow('-145–0');
    expect(() => validateLoudnessSettings(settings({ algorithm: 'rms', rmsLevel: 0.1 }))).toThrow('-145–0');
    expect(() => validateLoudnessSettings(settings({ lufsLevel: NaN }))).toThrow();
    expect(() => validateLoudnessSettings(settings({ dualMono: 1 as unknown as boolean }))).toThrow('布尔值');
  });

  it('combines linked stereo RMS in the quadratic domain with one gain', () => {
    const source = [Float32Array.from([0.1, -0.1]), Float32Array.from([0.3, -0.3])];
    const output = processLoudnessChannels(source, 8000, settings({
      algorithm: 'rms', rmsLevel: -20, stereoIndependent: false, dualMono: false,
    }));
    const rms = output.map((channel) => Math.sqrt(channel.reduce((sum, sample) => sum + sample * sample, 0) / channel.length));
    expect(20 * Math.log10(Math.sqrt((rms[0] ** 2 + rms[1] ** 2) / 2))).toBeCloseTo(-20, 6);
    expect(output[0][0] / source[0][0]).toBeCloseTo(output[1][0] / source[1][0], 6);
    expect(source).toEqual([Float32Array.from([0.1, -0.1]), Float32Array.from([0.3, -0.3])]);
  });

  it('normalizes RMS channels independently only when requested', () => {
    const output = processLoudnessChannels([
      Float32Array.from([0.1, -0.1, 0.1, -0.1]),
      Float32Array.from([0.3, -0.3, 0.3, -0.3]),
    ], 8000, settings({ algorithm: 'rms', rmsLevel: -20, stereoIndependent: true }));
    for (const channel of output) {
      const rms = Math.sqrt(channel.reduce((sum, sample) => sum + sample * sample, 0) / channel.length);
      expect(20 * Math.log10(rms)).toBeCloseTo(-20, 5);
    }
  });
});

describe('Audacity EBU R128 loudness normalization', () => {
  const left = noise(16_000, 0x12345678, 0.16);
  const right = noise(16_000, 0x87654321, 0.08);

  it('keeps linked stereo balance and reaches the requested integrated LUFS', () => {
    const output = processLoudnessChannels([left, right], 8000, settings({
      lufsLevel: -23, stereoIndependent: false, dualMono: true,
    }));
    expect(loudnessExtentToLufs(measureEbuR128(output, 8000))).toBeCloseTo(-23, 1);
    expect(output[0][100] / left[100]).toBeCloseTo(output[1][100] / right[100], 5);
    expect(left).toEqual(noise(16_000, 0x12345678, 0.16));
  });

  it('uses the official -3 LU rule for independently processed stereo channels', () => {
    const output = processLoudnessChannels([left, right], 8000, settings({
      lufsLevel: -23, stereoIndependent: true, dualMono: false,
    }));
    expect(loudnessExtentToLufs(measureEbuR128([output[0]], 8000))).toBeCloseTo(-26, 1);
    expect(loudnessExtentToLufs(measureEbuR128([output[1]], 8000))).toBeCloseTo(-26, 1);
  });

  it('distinguishes mono as mono from mono as dual-mono', () => {
    const asMono = processLoudnessChannels([left], 8000, settings({
      lufsLevel: -26, stereoIndependent: false, dualMono: false,
    }));
    const dualMono = processLoudnessChannels([left], 8000, settings({
      lufsLevel: -26, stereoIndependent: false, dualMono: true,
    }));
    expect(loudnessExtentToLufs(measureEbuR128(asMono, 8000))).toBeCloseTo(-26, 1);
    expect(loudnessExtentToLufs(measureEbuR128(dualMono, 8000))).toBeCloseTo(-29, 1);
    expect(dualMono[0][100] / asMono[0][100]).toBeCloseTo(Math.SQRT1_2, 6);
  });

  it('uses the incomplete final block only when no full non-silent block exists', () => {
    const short = noise(2_800, 0x10203040, 0.2); // 350 ms at 8 kHz
    const output = processLoudnessChannels([short], 8000, settings({
      lufsLevel: -24, stereoIndependent: false, dualMono: false,
    }));
    expect(loudnessExtentToLufs(measureEbuR128(output, 8000))).toBeCloseTo(-24, 1);
  });

  it('fails closed for silence, invalid layouts and non-finite samples', () => {
    expect(() => createLoudnessPlan([new Float32Array(8000)], 8000, settings())).toThrow('静音');
    expect(() => createLoudnessPlan([new Float32Array(0)], 8000, settings())).toThrow('非空');
    expect(() => createLoudnessPlan([new Float32Array(2), new Float32Array(2), new Float32Array(2)], 8000, settings())).toThrow('单声道或立体声');
    expect(() => processLoudnessChannels([Float32Array.from([Infinity, 0])], 8000, settings())).toThrow('非有限');
    expect(() => processLoudnessChannels([left], 8000, settings(), {
      sampleRate: 8000, extents: [1], gains: [1, 1],
    })).toThrow('声道数');
  });
});

describe('Loudness continuous track mapping', () => {
  it('analyses timeline gaps as silence and writes only selected clip samples', () => {
    const sampleRate = 8000;
    const sourceTrack = track([clip('first', 0, 1), clip('second', 2, 1)]);
    const first = noise(sampleRate, 1, 0.12);
    const second = noise(sampleRate, 2, 0.08);
    const target: LoudnessTrackInput = {
      trackId: sourceTrack.id,
      clips: [
        { clipId: 'first', sourceOffset: 0, sampleData: [first] },
        { clipId: 'second', sourceOffset: 0, sampleData: [second] },
      ],
    };
    const result = processLoudnessTrack(sourceTrack, target, { start: 0, end: 3 }, settings({
      algorithm: 'rms', rmsLevel: -20, dualMono: false,
    }), sampleRate);
    const continuous = new Float32Array(sampleRate * 3);
    continuous.set(first, 0);
    continuous.set(second, sampleRate * 2);
    const expectedPlan = createLoudnessPlan([continuous], sampleRate, settings({
      algorithm: 'rms', rmsLevel: -20, dualMono: false,
    }));
    expect(result.plan).toEqual(expectedPlan);
    expect(result.selectionChannels[0]).toEqual(processLoudnessChannels(
      [continuous], sampleRate, settings({ algorithm: 'rms', rmsLevel: -20, dualMono: false }), expectedPlan,
    )[0]);
    expect(result.clips[0].sampleData[0]).toEqual(result.selectionChannels[0].slice(0, sampleRate));
    expect(result.clips[1].sampleData[0]).toEqual(result.selectionChannels[0].slice(sampleRate * 2));
    expect(first).toEqual(noise(sampleRate, 1, 0.12));
    expect(second).toEqual(noise(sampleRate, 2, 0.08));
  });

  it('rejects incomplete track ownership before processing', () => {
    const sourceTrack = track([clip('only', 0, 1)]);
    expect(() => processLoudnessTrack(sourceTrack, {
      trackId: sourceTrack.id, clips: [],
    }, { start: 0, end: 1 }, settings(), 8000)).toThrow('完整轨道');
  });
});
