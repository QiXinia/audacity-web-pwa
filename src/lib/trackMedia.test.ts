import { describe, expect, it } from 'vitest';
import {
  convertTrackSampleFormatChannels,
  getTrackSampleFormatLabel,
  scaleClipForTrackRate,
} from '@/lib/trackMedia';
import type { IClip } from '@/types/project';

describe('Audacity track media conversion', () => {
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
