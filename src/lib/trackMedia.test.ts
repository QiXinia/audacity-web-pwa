import { describe, expect, it, vi } from 'vitest';
import {
  convertTrackSampleFormatChannels,
  getTrackSampleFormatLabel,
  scaleClipForTrackRate,
  shouldUseHighQualityDither,
} from '@/lib/trackMedia';
import type { DitherType, IClip } from '@/types/project';
import { createGlibcRandom } from '@/lib/glibcRandom';

describe('Audacity track media conversion', () => {
  it('uses high-quality dither only when the effective sample format becomes narrower', () => {
    expect(shouldUseHighQualityDither('float32', 'int24')).toBe(true);
    expect(shouldUseHighQualityDither('float32', 'int16')).toBe(true);
    expect(shouldUseHighQualityDither('int24', 'int16')).toBe(true);
    expect(shouldUseHighQualityDither('int16', 'int24')).toBe(false);
    expect(shouldUseHighQualityDither('int24', 'float32')).toBe(false);
    expect(shouldUseHighQualityDither('int16', 'float32')).toBe(false);
    expect(shouldUseHighQualityDither('int16', 'int16')).toBe(false);
  });

  it('uses signed full-scale PCM quantizers, clipping and ties-to-even rounding', () => {
    const input = Float32Array.from([
      -2, -1, -0.5 / 32768, 0.5 / 32768, 1.5 / 32768, 2.5 / 32768, 0.5, 1, 2,
    ]);
    const [int16] = convertTrackSampleFormatChannels([input], 'int16');
    expect(Array.from(int16!)).toEqual([
      -1, -1, 0, 0, 2 / 32768, 2 / 32768, 0.5, 32767 / 32768, 32767 / 32768,
    ]);
    const [int24] = convertTrackSampleFormatChannels([
      Float32Array.from([-1, -0.5 / 8388608, 0.5 / 8388608, 1.5 / 8388608, 2]),
    ], 'int24');
    expect(Array.from(int24!)).toEqual([
      -1, 0, 0, 2 / 8388608, 8388607 / 8388608,
    ]);
  });

  it('returns independent float PCM and rejects invalid channels before conversion', () => {
    const source = Float32Array.from([0.1, Number.NaN]);
    expect(() => convertTrackSampleFormatChannels([source], 'float32')).toThrow(/有限/);
    const valid = Float32Array.from([0.1, -0.2]);
    const [copy] = convertTrackSampleFormatChannels([valid], 'float32');
    expect(copy).not.toBe(valid);
    expect(copy).toEqual(valid);
    copy![0] = 0.9;
    expect(valid[0]).toBeCloseTo(0.1);
    expect(getTrackSampleFormatLabel(undefined)).toBe('32-bit Float');
  });

  it.each(['none', 'rectangle', 'triangle', 'shaped'] as const)(
    'matches official Dither.cpp %s integer PCM with the same glibc sequence',
    (ditherType) => {
      const input = Float32Array.from([
        -1, -0.50005, -0.1, -0.0000152587890625,
        0, 0.0000152587890625, 0.0000457763671875,
        0.1, 0.25, 0.50005, 0.99999, 1,
      ]);
      const expected16: Record<DitherType, number[]> = {
        none: [-32768, -16386, -3277, 0, 0, 0, 2, 3277, 8192, 16386, 32767, 32767],
        rectangle: [-32768, -16386, -3277, -1, 0, 1, 2, 3277, 8192, 16386, 32767, 32767],
        triangle: [-32768, -16386, -3276, 0, 0, 0, 2, 3277, 8192, 16386, 32767, 32767],
        shaped: [-32768, -16385, -3278, 1, -2, 3, -1, 3280, 8189, 16387, 32767, 32767],
      };
      const expected24: Record<DitherType, number[]> = {
        none: [-8388608, -4194724, -838861, -128, 0, 128, 384, 838861, 2097152, 4194724, 8388524, 8388607],
        rectangle: [-8388608, -4194724, -838861, -128, 0, 128, 384, 838861, 2097152, 4194724, 8388524, 8388607],
        triangle: [-8388608, -4194724, -838860, -128, 0, 127, 384, 838861, 2097152, 4194724, 8388524, 8388607],
        shaped: [-8388608, -4194723, -838862, -126, -3, 131, 382, 838863, 2097150, 4194724, 8388524, 8388607],
      };
      const [int16] = convertTrackSampleFormatChannels([input], 'int16', {
        ditherType, random: createGlibcRandom(),
      });
      const [int24] = convertTrackSampleFormatChannels([input], 'int24', {
        ditherType, random: createGlibcRandom(),
      });
      expect(Array.from(int16!, (sample) => Math.round(sample * 32768))).toEqual(expected16[ditherType]);
      expect(Array.from(int24!, (sample) => Math.round(sample * 8388608))).toEqual(expected24[ditherType]);
    },
  );

  it('rejects an unknown dither and leaves float conversion free of random consumption', () => {
    const input = Float32Array.from([0.1, -0.2]);
    expect(() => convertTrackSampleFormatChannels([input], 'int16', {
      ditherType: 'invalid' as DitherType,
    })).toThrow(/dither/);
    const random = vi.fn(() => 0);
    expect(convertTrackSampleFormatChannels([input], 'float32', { ditherType: 'shaped', random })[0])
      .toEqual(input);
    expect(random).not.toHaveBeenCalled();
  });

  it('scales WaveClip-compatible timeline metadata without resampling', () => {
    const clip: IClip = {
      id: 'clip', audioBufferId: 'pcm', startTime: 4, offset: 0.5,
      duration: 2, originalDuration: 6, stretchRatio: 1.5,
      pitchCents: 120, gain: -2, fadeIn: 0.2, fadeOut: 0.4, name: 'source',
    };
    const scaled = scaleClipForTrackRate(clip, 1000, 2000);
    expect(scaled).toMatchObject({
      id: 'clip', audioBufferId: 'pcm', startTime: 2, offset: 0.25,
      duration: 1, originalDuration: 3, stretchRatio: 1.5,
      pitchCents: 120, gain: -2, fadeIn: 0.1, fadeOut: 0.2,
    });
    expect(scaleClipForTrackRate(clip, 1000, 1000)).toEqual(clip);
    expect(() => scaleClipForTrackRate(clip, 0, 2000)).toThrow(/采样率/);
  });
});
