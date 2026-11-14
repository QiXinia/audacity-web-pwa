import { describe, expect, it } from 'vitest';
import {
  processSpectralEditChannels,
  SPECTRAL_DELETE_DIRECT_CONVOLUTION_LIMIT,
  validateSpectralEditSettings,
  type SpectralEditSettings,
} from './spectralEditEffect';

const SAMPLE_RATE = 1000;
const LENGTH = 64;
const IMPULSE_POSITION = 32;

function impulse(length = LENGTH): Float32Array {
  const input = new Float32Array(length);
  input[length === LENGTH ? IMPULSE_POSITION : length / 2] = 1;
  return input;
}

function settings(lowHz: number | null, highHz: number | null): SpectralEditSettings {
  return { kind: 'delete-selection', lowHz, highHz, gainDb: 0 };
}

// Independently recomputed in Python directly from spectral-delete.ny at
// revision 20f2d589: Blackman-windowed sinc, upstream dotimes boundaries,
// centred convolution, and the 10 ms selection envelope.
const HIGHPASS_497_ORACLE = [
  0, -0.0005529469105936463, 0.0011116884776236685, -0.0016759737493201542,
  0.002245547379959373, -0.0028201497861064777, 0.0033995173064398634,
  -0.003983382365036988, 0.0045714736379992415, -0.005163516223291685,
  0.005759231813666239, -0.005780308065945882, 0.005800460677245467,
  -0.005819681675115672, 0.005837963446853646, -0.00585529874380357,
  0.005871680685454549, -0.005887102763334612, 0.005901558844696439,
  -0.005915043175992801, 0.005927550386140119, -0.005939075489565432,
  0.005949613889037855, -0.005959161378280021, 0.005967714144359367,
  -0.005975268769855645, 0.005981822234805252, -0.0059873719184204265,
  0.005991915600579983, -0.005995451463094448, 0.005997978090741253,
  -0.005999494472070598, 0.00600000000297618,
] as const;

const BAND_DELETE_ORACLE: Readonly<Record<number, number>> = {
  1: 0.00005000806271175168,
  2: 0.001111688477623667,
  3: -0.003609822746763325,
  10: 0.019512981674905186,
  20: 0.03115143319576279,
  28: 0.052765622670229155,
  29: 0.09491386021015565,
  30: 0.15736271122816567,
  31: 0.18109817290454636,
  32: 0.20599999988907017,
  33: 0.18109817290454636,
  34: 0.15736271122816567,
  35: 0.09491386021015565,
  36: 0.052765622670229155,
  50: -0.010974896537920793,
  62: 0.001111688477623667,
  63: 0.00005000806271175168,
};

describe('Audacity 4 FIR Delete selection', () => {
  it('matches the independent high-pass impulse oracle and keeps stereo channels independent', () => {
    const [actual, silent] = processSpectralEditChannels(
      [impulse(), new Float32Array(LENGTH)], settings(null, 497), SAMPLE_RATE,
    );
    expect(actual.length).toBe(LENGTH);
    for (let index = 0; index < LENGTH; index += 1) {
      const expected = HIGHPASS_497_ORACLE[Math.min(index, LENGTH - index)];
      expect(actual[index]).toBeCloseTo(expected, 6);
    }
    expect(silent).toEqual(new Float32Array(LENGTH));
  });

  it('matches the complementary low-pass oracle at the inclusive upper boundary', () => {
    const [actual] = processSpectralEditChannels([impulse()], settings(497, null), SAMPLE_RATE);
    for (let index = 0; index < LENGTH; index += 1) {
      const highpass = HIGHPASS_497_ORACLE[Math.min(index, LENGTH - index)];
      const expected = (index === IMPULSE_POSITION ? 1 : 0) - highpass;
      expect(actual[index]).toBeCloseTo(expected, 6);
    }
  });

  it('matches the independent combined low-pass plus high-pass band-delete oracle', () => {
    const [actual] = processSpectralEditChannels([impulse()], settings(100, 497), SAMPLE_RATE);
    for (const [index, value] of Object.entries(BAND_DELETE_ORACLE)) {
      expect(actual[Number(index)]).toBeCloseTo(value, 6);
    }
  });

  it('exercises block FFT convolution against independent centre and narrow-band oracles', () => {
    const longInput = impulse(1500);
    expect(longInput.length * 805).toBeGreaterThan(SPECTRAL_DELETE_DIRECT_CONVOLUTION_LIMIT);
    const [longActual] = processSpectralEditChannels([longInput], settings(null, 497), SAMPLE_RATE);
    expect(longActual[750]).toBeCloseTo(0.00600000000297618, 6);
    expect(longActual[749]).toBeCloseTo(-0.005999494472070598, 6);
    expect(longActual[751]).toBeCloseTo(-0.005999494472070598, 6);

    const [narrow] = processSpectralEditChannels([impulse()], settings(100, 100.5), SAMPLE_RATE);
    expect(narrow[30]).toBeCloseTo(-0.0012271198193734845, 6);
    expect(narrow[31]).toBeCloseTo(-0.0032404139303022494, 6);
    expect(narrow[32]).toBeCloseTo(0.9959900124701144, 6);
    expect(narrow[33]).toBeCloseTo(-0.0032404139303022494, 6);
    expect(narrow[34]).toBeCloseTo(-0.0012271198193734845, 6);
  });

  it('discards out-of-range filters without inventing audio changes', () => {
    const input = Float32Array.from({ length: LENGTH }, (_, index) => Math.sin(index) * 0.2);
    const [lowDiscarded] = processSpectralEditChannels([input], settings(1, null), SAMPLE_RATE);
    const [highDiscarded] = processSpectralEditChannels([input], settings(null, 499), SAMPLE_RATE);
    expect(lowDiscarded).toEqual(input);
    expect(lowDiscarded).not.toBe(input);
    expect(highDiscarded).toEqual(input);
  });

  it('fails closed for unsupported sample rates and malformed selections', () => {
    expect(() => validateSpectralEditSettings(settings(100, 400), 99)).toThrow('100 Hz');
    expect(() => validateSpectralEditSettings(settings(null, null), SAMPLE_RATE)).toThrow('至少');
    expect(() => validateSpectralEditSettings(settings(100, 100), SAMPLE_RATE)).toThrow('带宽');
    expect(() => processSpectralEditChannels([], settings(100, 400), SAMPLE_RATE)).toThrow('至少');
    expect(() => processSpectralEditChannels([Float32Array.of(Number.NaN)], settings(100, 400), SAMPLE_RATE)).toThrow('非有限');
  });
});
