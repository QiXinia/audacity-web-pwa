import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  fastLog2,
  forwardRealSpectrum,
  inverseRealSpectrum,
  mapToPositiveHalfIndex,
  processFormantSpectrum,
  processStaffPadTimeAndPitchChannels,
} from './staffPadTimeAndPitch';

interface OracleCase {
  name: string;
  channels: number;
  sampleRate: number;
  inputFrames: number;
  timeRatio: number;
  pitchRatio: number;
  preserveFormants: boolean;
  fftSize: number;
  nativeFrames: number;
}

const fixtureDirectory = resolve(process.cwd(), 'src/test/fixtures/staffpad');
const manifest = JSON.parse(readFileSync(
  resolve(fixtureDirectory, 'oracle.json'),
  'utf8',
)) as { cases: OracleCase[] };

function fixture(name: string): Float32Array {
  const bytes = readFileSync(resolve(fixtureDirectory, name));
  const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return new Float32Array(copy);
}

function channels(caseData: OracleCase, suffix: string): Float32Array[] {
  const planar = fixture(`${caseData.name}-${suffix}.f32`);
  return Array.from({ length: caseData.channels }, (_, channel) => (
    planar.slice(channel * caseData.inputFrames, (channel + 1) * caseData.inputFrames)
  ));
}

function nativeChannels(caseData: OracleCase): Float32Array[] {
  const planar = fixture(`${caseData.name}-native.f32`);
  return Array.from({ length: caseData.channels }, (_, channel) => (
    planar.slice(channel * caseData.nativeFrames, (channel + 1) * caseData.nativeFrames)
  ));
}

function metrics(actual: Float32Array, expected: Float32Array): {
  nrmse: number;
  correlation: number;
  maximumError: number;
} {
  let errorEnergy = 0;
  let expectedEnergy = 0;
  let actualEnergy = 0;
  let cross = 0;
  let maximumError = 0;
  for (let index = 0; index < expected.length; index += 1) {
    const difference = actual[index] - expected[index];
    errorEnergy += difference * difference;
    expectedEnergy += expected[index] * expected[index];
    actualEnergy += actual[index] * actual[index];
    cross += actual[index] * expected[index];
    maximumError = Math.max(maximumError, Math.abs(difference));
  }
  return {
    nrmse: Math.sqrt(errorEnergy / expectedEnergy),
    correlation: cross / Math.sqrt(actualEnergy * expectedEnergy),
    maximumError,
  };
}

describe('Audacity StaffPad primitives', () => {
  it('round-trips real spectra without scaling and maps mirrored indices officially', () => {
    const input = new Float32Array(64).map((_, index) => (
      0.4 * Math.sin(index * 0.31) + 0.2 * Math.cos(index * 0.07)
    ));
    const restored = inverseRealSpectrum(forwardRealSpectrum(input));
    for (let index = 0; index < input.length; index += 1) {
      expect(restored[index] / input.length).toBeCloseTo(input[index], 5);
    }
    expect([0, 1, 2, 3, 4, -1, -2, -3].map((index) => mapToPositiveHalfIndex(index, 4)))
      .toEqual([0, 1, 2, 1, 0, 1, 2, 1]);
  });

  it('reproduces the officially approximate FastLog2, including its nonzero value at one', () => {
    // MathApprox.h explicitly documents that this approximation is not zero at 1.
    expect(fastLog2(1)).toBeCloseTo(0.005453586578369141, 10);
    expect(fastLog2(2)).toBeCloseTo(1.0054535865783691, 10);
    expect(fastLog2(0)).toBeCloseTo(-126.99454498291016, 10);
    expect(fastLog2(1024)).toBeCloseTo(10, 1);
  });

  it('applies a real cepstral formant correction with the 20 dB weight cap', () => {
    const input = new Float32Array(128).map((_, index) => (
      0.5 * Math.sin(2 * Math.PI * 7 * index / 128)
      + 0.2 * Math.sin(2 * Math.PI * 19 * index / 128)
    ));
    const spectrum = forwardRealSpectrum(input);
    const originalReal = spectrum.real.slice();
    const originalImaginary = spectrum.imaginary.slice();
    const power = spectrum.real.map((real, index) => (
      real * real + spectrum.imaginary[index] * spectrum.imaginary[index]
    ));
    processFormantSpectrum(power, spectrum, 1 / 2 ** (3 / 12), 8000, 128);
    expect(spectrum.real).not.toEqual(originalReal);
    for (let index = 0; index < power.length; index += 1) {
      const before = Math.hypot(originalReal[index], originalImaginary[index]);
      const after = Math.hypot(spectrum.real[index], spectrum.imaginary[index]);
      expect(Number.isFinite(after)).toBe(true);
      if (before > 1e-7) expect(after / before).toBeLessThanOrEqual(100.0001);
    }
  });
});

describe('Audacity 4.0.2 native StaffPad oracle', () => {
  it.each(manifest.cases)('$name follows the official PCM within float/FFT tolerance', (caseData) => {
    const source = channels(caseData, 'input');
    const untouched = source.map((channel) => channel.slice());
    const actual = processStaffPadTimeAndPitchChannels(source, caseData);
    const expected = nativeChannels(caseData);
    expect(actual).toHaveLength(caseData.channels);
    expect(actual[0]).toHaveLength(caseData.nativeFrames);
    expect(source).toEqual(untouched);
    const comparisons = actual.map((channel, index) => metrics(channel, expected[index]));
    console.log(caseData.name, comparisons);
    for (const comparison of comparisons) {
      expect(Number.isFinite(comparison.nrmse)).toBe(true);
      expect(comparison.nrmse).toBeLessThan(0.011);
      expect(comparison.correlation).toBeGreaterThan(0.9999);
    }
  });

  it('enables FormantShifter only for voice pitch changes', () => {
    const caseData = manifest.cases[0];
    const source = channels(caseData, 'input');
    const preserved = processStaffPadTimeAndPitchChannels(source, caseData);
    const unpreserved = processStaffPadTimeAndPitchChannels(source, {
      ...caseData,
      preserveFormants: false,
    });
    expect(preserved[0]).not.toEqual(unpreserved[0]);

    const neutralOptions = { ...caseData, pitchRatio: 1, timeRatio: 1 };
    const neutralPreserved = processStaffPadTimeAndPitchChannels(source, neutralOptions);
    const neutralUnpreserved = processStaffPadTimeAndPitchChannels(source, {
      ...neutralOptions,
      preserveFormants: false,
    });
    expect(neutralPreserved).toEqual(neutralUnpreserved);
    expect(neutralPreserved).toEqual(source);
  });

  it('rejects invalid channels, ratios and FFT sizes before processing', () => {
    const caseData = manifest.cases[0];
    const source = channels(caseData, 'input');
    expect(() => processStaffPadTimeAndPitchChannels([], caseData)).toThrow('单声道或立体声');
    expect(() => processStaffPadTimeAndPitchChannels(source, { ...caseData, timeRatio: 0 })).toThrow('时间缩放');
    expect(() => processStaffPadTimeAndPitchChannels(source, { ...caseData, pitchRatio: -1 })).toThrow('音高缩放');
    expect(() => processStaffPadTimeAndPitchChannels(source, { ...caseData, fftSize: 100 })).toThrow('2 的幂');
    expect(() => processStaffPadTimeAndPitchChannels(
      [source[0], source[0].slice(1)], caseData,
    )).toThrow('长度一致');
  });
});
