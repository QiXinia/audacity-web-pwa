import { vi } from 'vitest';
import type { IClip } from '@/types/project';
import { formatClipPitchCents, formatClipPropertyTime, getClipTimeMapping } from './clipProperties';

vi.mock('@/wasm/processor', () => ({
  isWasmAvailable: vi.fn(() => false),
  wasmProcessor: { spectrogram: vi.fn((_data: Float32Array, windowSize: number) => new Float32Array(windowSize / 2 + 1)) },
}));

function clip(overrides: Partial<IClip> = {}): IClip {
  return {
    id: 'clip-a', audioBufferId: 'buffer-a', startTime: 1.25, offset: 0.5,
    duration: 2, originalDuration: 8, gain: -3, fadeIn: 0.1, fadeOut: 0.2,
    name: 'Voice', ...overrides,
  };
}

describe('Clip properties time mapping', () => {
  it('keeps legacy unstretched clips on the same source and timeline duration', () => {
    expect(getClipTimeMapping(clip())).toEqual({
      timelineStart: 1.25,
      timelineEnd: 3.25,
      timelineDuration: 2,
      sourceStart: 0.5,
      sourceEnd: 2.5,
      sourceDuration: 2,
      stretchRatio: 1,
      speedPercentage: 100,
    });
  });

  it('maps a trimmed, time-stretched play region into source seconds', () => {
    expect(getClipTimeMapping(clip({ stretchRatio: 1.5 }))).toMatchObject({
      timelineStart: 1.25,
      timelineEnd: 3.25,
      timelineDuration: 2,
      sourceStart: 0.5,
      sourceEnd: 3.5,
      sourceDuration: 3,
      stretchRatio: 1.5,
      speedPercentage: 150,
    });
  });

  it('uses the same safe ratio as playback for invalid legacy data', () => {
    expect(getClipTimeMapping(clip({ stretchRatio: Number.NaN }))).toMatchObject({
      sourceDuration: 2,
      sourceEnd: 2.5,
      stretchRatio: 1,
      speedPercentage: 100,
    });
    expect(formatClipPropertyTime(Number.NaN)).toBe('—');
    expect(formatClipPropertyTime(-0.01)).toBe('—');
    expect(formatClipPropertyTime(3.5)).toBe('3.500000 s');
  });

  it('formats signed pitch without losing cents', () => {
    expect(formatClipPitchCents(clip({ pitchCents: 125 }))).toBe('+1 semitones +25 cents (+125 cents total)');
    expect(formatClipPitchCents(clip({ pitchCents: -125 }))).toBe('-1 semitones -25 cents (-125 cents total)');
    expect(formatClipPitchCents(clip({ pitchCents: 25 }))).toBe('+25 cents (+25 cents total)');
    expect(formatClipPitchCents(clip({ pitchCents: 0 }))).toBe('0 cents');
  });
});
