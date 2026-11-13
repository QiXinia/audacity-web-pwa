import { describe, expect, it } from 'vitest';
import {
  generateChirp,
  type ChirpInterpolation,
  type ChirpSettings,
} from '@/lib/chirpGenerator';
import { generateTone, type ToneWaveform } from '@/lib/toneGenerator';

const valid: ChirpSettings = {
  waveform: 'sine',
  interpolation: 'linear',
  startFrequency: 100,
  endFrequency: 200,
  startAmplitude: 0.2,
  endAmplitude: 0.4,
  duration: 0.01,
  sampleRate: 1000,
};

function independentSineSweep(interpolation: ChirpInterpolation): number[] {
  const length = 10;
  const output: number[] = [];
  let positionInCycles = 0;
  for (let i = 0; i < length; i += 1) {
    const progress = i / length;
    const frequency = interpolation === 'linear'
      ? 100 + (200 - 100) * progress
      : 10 ** (Math.log10(100) + (Math.log10(200) - Math.log10(100)) * progress);
    const amplitude = 0.2 + (0.4 - 0.2) * progress;
    output.push(amplitude * Math.sin(2 * Math.PI * positionInCycles / 1000));
    positionInCycles += frequency;
  }
  return output;
}

describe('Audacity-compatible Chirp generation', () => {
  it.each(['linear', 'logarithmic'] as const)('matches an independent %s sine sweep', (interpolation) => {
    const result = generateChirp({ ...valid, interpolation });
    const expected = independentSineSweep(interpolation);

    expect(result).toHaveLength(10);
    expected.forEach((sample, index) => expect(result[index]).toBeCloseTo(sample, 6));
    expect(result).toEqual(generateChirp({ ...valid, interpolation }));
  });

  it.each<ToneWaveform>(['sine', 'square', 'sawtooth', 'squareNoAlias', 'triangle'])(
    'reduces %s exactly to Tone when frequency and amplitude are constant',
    (waveform) => {
      const chirp = generateChirp({
        ...valid,
        waveform,
        startFrequency: 100,
        endFrequency: 100,
        startAmplitude: 0.5,
        endAmplitude: 0.5,
      });
      const tone = generateTone({
        waveform,
        frequency: 100,
        amplitude: 0.5,
        duration: valid.duration,
        sampleRate: valid.sampleRate,
        channelCount: 1,
      });
      expect(chirp).toEqual(tone);
    },
  );

  it('uses the official N-sample interpolation rather than forcing the end parameters onto sample N - 1', () => {
    const result = generateChirp({
      ...valid,
      waveform: 'square',
      startFrequency: 1,
      endFrequency: 1,
      startAmplitude: 0,
      endAmplitude: 1,
      duration: 1,
      sampleRate: 4,
    });
    expect(Array.from(result)).toEqual([0, 0.25, -0.5, -0.75]);
  });

  it('supports zero-amplitude sweeps without changing the requested sample count', () => {
    const result = generateChirp({
      ...valid,
      startAmplitude: 0,
      endAmplitude: 0,
    });
    expect(result).toHaveLength(10);
    expect(Array.from(result).every((sample) => sample === 0)).toBe(true);
  });

  it('rejects invalid frequencies, amplitudes, interpolation, duration and sample rate', () => {
    expect(() => generateChirp({ ...valid, startFrequency: 0 })).toThrow(/Start frequency/);
    expect(() => generateChirp({ ...valid, endFrequency: 501 })).toThrow(/End frequency.*Nyquist/);
    expect(() => generateChirp({ ...valid, startAmplitude: -0.01 })).toThrow(/Start amplitude/);
    expect(() => generateChirp({ ...valid, endAmplitude: 1.01 })).toThrow(/End amplitude/);
    expect(() => generateChirp({ ...valid, interpolation: 'cubic' as ChirpInterpolation })).toThrow(/interpolation/);
    expect(() => generateChirp({ ...valid, duration: 0 })).toThrow(/Duration/);
    expect(() => generateChirp({ ...valid, duration: 0.0001 })).toThrow(/at least one sample/);
    expect(() => generateChirp({ ...valid, sampleRate: 0 })).toThrow(/Sample rate/);
  });
});
