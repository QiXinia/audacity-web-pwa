import { describe, expect, it } from 'vitest';
import { generateSilence, silenceClipSelection } from '@/lib/silenceGenerator';
import type { IClip } from '@/types/project';

function makeClip(overrides: Partial<IClip> = {}): IClip {
  return {
    id: 'clip',
    audioBufferId: 'shared-source',
    startTime: 10,
    offset: 2,
    duration: 2,
    originalDuration: 8,
    stretchRatio: 1,
    gain: 0,
    fadeIn: 0,
    fadeOut: 0,
    ...overrides,
  };
}

describe('Audacity silence generation', () => {
  it('creates the requested number of zero-amplitude samples', () => {
    const result = generateSilence({ duration: 0.01, sampleRate: 1000 });
    expect(result).toHaveLength(10);
    expect(Array.from(result)).toEqual(new Array(10).fill(0));
  });

  it('rejects invalid durations, sample rates and sub-sample renders', () => {
    expect(() => generateSilence({ duration: 1, sampleRate: 0 })).toThrow(/Sample rate/);
    expect(() => generateSilence({ duration: 0, sampleRate: 44100 })).toThrow(/Duration/);
    expect(() => generateSilence({ duration: 0.1 / 44100, sampleRate: 44100 })).toThrow(/at least one sample/);
  });

  it('replaces only the selected source range and never mutates the shared input', () => {
    const source = Float32Array.from({ length: 80 }, (_, index) => index + 1);
    const original = new Float32Array(source);
    const clip = makeClip();
    const beforeClip = { ...clip };
    const result = silenceClipSelection([source], clip, { start: 10.5, end: 11.25 }, 10);

    expect(result).not.toBeNull();
    expect(result?.[0]).not.toBe(source);
    expect(source).toEqual(original);
    expect(clip).toEqual(beforeClip);
    // offset 2 s + local 0.5–1.25 s => source samples 25–32.5, rounded outwards.
    expect(Array.from(result![0].slice(0, 25))).toEqual(Array.from(original.slice(0, 25)));
    expect(Array.from(result![0].slice(25, 33))).toEqual(new Array(8).fill(0));
    expect(Array.from(result![0].slice(33))).toEqual(Array.from(original.slice(33)));
  });

  it('maps timeline selections through trim offsets and the current stretch ratio', () => {
    const source = Float32Array.from({ length: 80 }, (_, index) => index + 1);
    const result = silenceClipSelection(
      [source],
      makeClip({ stretchRatio: 2 }),
      { start: 10.5, end: 11.25 },
      10,
    );

    // 2 source seconds per timeline second: source 3–4.5 s => indices 30–45.
    expect(Array.from(result![0].slice(30, 45))).toEqual(new Array(15).fill(0));
    expect(result![0][29]).toBe(30);
    expect(result![0][45]).toBe(46);
  });

  it('does not invent a replacement for a non-overlapping or invalid selection', () => {
    const source = new Float32Array(80).fill(1);
    expect(silenceClipSelection([source], makeClip(), { start: 0, end: 2 }, 10)).toBeNull();
    expect(silenceClipSelection([source], makeClip(), { start: 11, end: 11 }, 10)).toBeNull();
    expect(() => silenceClipSelection([], makeClip(), { start: 10, end: 11 }, 10)).toThrow(/no audio channels/);
  });
});
