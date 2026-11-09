import { describe, expect, it } from 'vitest';
import {
  PLUCK_DEFAULT_MIDI,
  PLUCK_MAX_DURATION,
  generatePluck,
  isPluckMidiSupported,
  midiToHz,
  type PluckRequest,
} from './pluckGenerator';

const reference: PluckRequest = {
  midi: 60,
  fade: 'abrupt',
  duration: 0.01,
  sampleRate: 1000,
  seed: 1,
};

describe('Audacity Pluck DSP', () => {
  it('uses the official MIDI defaults and equal-tempered frequency conversion', () => {
    expect(PLUCK_DEFAULT_MIDI).toBe(60);
    expect(midiToHz(69)).toBe(440);
    expect(midiToHz(60)).toBeCloseTo(261.6255653005986, 12);
  });

  it('matches an independent Python transcription for abrupt fade with uint32 and float32 rounding', () => {
    expect(Array.from(generatePluck(reference))).toEqual([
      -0.800000011920929,
      0.13861387968063354,
      0.5350175499916077,
      0.6608687043190002,
      0.2576620578765869,
      -0.002168686594814062,
      0.004817045293748379,
      0.00621089106425643,
      0.0038987144362181425,
      0.0009450544021092355,
    ]);
  });

  it('matches the independent reference for gradual fade', () => {
    expect(Array.from(generatePluck({ ...reference, fade: 'gradual' }))).toEqual([
      -0.800000011920929,
      0.17851552367210388,
      0.5259608626365662,
      0.6147192120552063,
      0.17283260822296143,
      -0.022925101220607758,
      0.06877221912145615,
      0.07721780240535736,
      0.041139692068099976,
      0.0068755680695176125,
    ]);
  });

  it('covers the long-duration stretch branch with an independently calculated prefix', () => {
    const samples = generatePluck({ ...reference, duration: 1, seed: 4 });
    expect(samples).toHaveLength(1000);
    expect(Array.from(samples.slice(0, 10))).toEqual([
      0.7870287299156189,
      -0.06199774146080017,
      -0.07608488202095032,
      -0.6375126242637634,
      0.800000011920929,
      -0.13074570894241333,
      -0.1310555338859558,
      -0.5170672535896301,
      0.7956438064575195,
      -0.2023622989654541,
    ]);
  });

  it('preserves a zero-amplitude random excitation instead of producing NaN', () => {
    const samples = generatePluck({ ...reference, duration: 1, seed: 1 });
    expect(samples).toHaveLength(1000);
    expect(Array.from(samples)).toEqual(new Array(1000).fill(0));
  });

  it('is reproducible per seed and normalizes nonzero output to 0.8 peak', () => {
    const first = generatePluck({ ...reference, duration: 0.05, seed: 4 });
    expect(generatePluck({ ...reference, duration: 0.05, seed: 4 })).toEqual(first);
    expect(generatePluck({ ...reference, duration: 0.05, seed: 1 })).not.toEqual(first);
    expect(Math.max(...Array.from(first, Math.abs))).toBeCloseTo(0.8, 6);
  });

  it('rounds duration to the nearest sample and accepts the official 60-second maximum', () => {
    expect(generatePluck({ ...reference, duration: 0.0125, seed: 4 })).toHaveLength(13);
    const longest = generatePluck({ ...reference, duration: PLUCK_MAX_DURATION, seed: 4 });
    expect(longest).toHaveLength(60000);
    expect(Array.from(longest).every(Number.isFinite)).toBe(true);
  });

  it('enforces the official pitch range and sample-rate frequency boundaries', () => {
    expect(isPluckMidiSupported(1, 1000)).toBe(true);
    expect(isPluckMidiSupported(1, 1_000_000)).toBe(false);
    expect(isPluckMidiSupported(60, 1000)).toBe(true);
    expect(isPluckMidiSupported(69, 1000)).toBe(false);
    expect(isPluckMidiSupported(120, 1000)).toBe(false);
    expect(isPluckMidiSupported(120, 44100)).toBe(true);
    expect(isPluckMidiSupported(0, 1000)).toBe(false);
    expect(isPluckMidiSupported(60.5, 1000)).toBe(false);
  });

  it.each<[string, Partial<PluckRequest>]>([
    ['zero MIDI', { midi: 0 }],
    ['fractional MIDI', { midi: 60.5 }],
    ['MIDI above 120', { midi: 121 }],
    ['zero duration', { duration: 0 }],
    ['duration above 60 seconds', { duration: 60.01 }],
    ['NaN duration', { duration: Number.NaN }],
    ['sub-sample duration', { duration: 0.0004 }],
    ['zero sample rate', { sampleRate: 0 }],
    ['unknown fade', { fade: 'other' as PluckRequest['fade'] }],
  ])('rejects %s', (_label, patch) => {
    expect(() => generatePluck({ ...reference, ...patch })).toThrow(RangeError);
  });
});
