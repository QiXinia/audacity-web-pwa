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
  input?: string;
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
  const planar = fixture(`${caseData.input ?? caseData.name}-${suffix}.f32`);
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
    // A silent native result must be matched by silence, not NaN metrics.
    nrmse: expectedEnergy > 0 ? Math.sqrt(errorEnergy / expectedEnergy) : Math.sqrt(errorEnergy),
    correlation: expectedEnergy > 0 && actualEnergy > 0
      ? cross / Math.sqrt(actualEnergy * expectedEnergy)
      : (expectedEnergy === 0 && actualEnergy === 0 ? 1 : 0),
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
      expect(comparison.nrmse).toBeLessThan(0.0001);
      expect(comparison.correlation).toBeGreaterThan(0.99999);
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

describe('Audacity StaffPad boundary contracts', () => {
  it.each([
    {
      name: 'single-sample mono at 1000% speed and +1200 cents',
      frames: 1,
      channels: 1,
      timeRatio: 0.1,
      pitchRatio: 2,
    },
    {
      name: 'short stereo at 1% speed and -1200 cents',
      frames: 63,
      channels: 2,
      timeRatio: 100,
      pitchRatio: 0.5,
    },
    {
      name: 'short mono at -1200 cents without time stretching',
      frames: 31,
      channels: 1,
      timeRatio: 1,
      pitchRatio: 0.5,
    },
  ])('$name produces only finite samples', ({ frames, channels: channelCount, timeRatio, pitchRatio }) => {
    const source = Array.from({ length: channelCount }, (_, channel) => (
      Float32Array.from({ length: frames }, (_, index) => (
        0.2 * Math.sin(index * 0.37 + channel) + 0.1 * Math.cos(index * 0.11)
      ))
    ));
    const output = processStaffPadTimeAndPitchChannels(source, {
      sampleRate: 8000,
      timeRatio,
      pitchRatio,
      preserveFormants: true,
      fftSize: 512,
    });
    // ClipSegment constructs sampleCount from visibleSamples * stretchRatio + .5;
    // sampleCount(double) truncates, so a non-empty source can produce zero frames.
    const expectedFrames = Math.round(frames * timeRatio);
    expect(output).toHaveLength(channelCount);
    for (const channel of output) {
      expect(channel).toHaveLength(expectedFrames);
      expect(channel.every((sample) => Number.isFinite(sample))).toBe(true);
    }
  });

  it('preserves the native zero-frame and half-frame output boundaries', () => {
    const source = Float32Array.of(0.25);
    for (const [timeRatio, expectedFrames] of [[0.1, 0], [0.5, 1]] as const) {
      const output = processStaffPadTimeAndPitchChannels([source], {
        sampleRate: 8000,
        timeRatio,
        pitchRatio: 2,
        preserveFormants: true,
        fftSize: 512,
      });
      expect(output).toHaveLength(1);
      expect(output[0], `timeRatio=${timeRatio}`).toHaveLength(expectedFrames);
    }
  });

  it('does not use the near-neutral shortcut when it changes the requested output length', () => {
    const source = new Float32Array(500_001);
    source[source.length - 1] = 0.25;
    const output = processStaffPadTimeAndPitchChannels([source], {
      sampleRate: 1000,
      // IEEE-754 evaluates this offset as slightly less than 1e-6. The old
      // near-neutral shortcut returned 500001 frames instead of the requested
      // Math.round(500001 * timeRatio) = 500002 frames.
      timeRatio: 1.000001,
      pitchRatio: 1,
      preserveFormants: true,
      fftSize: 64,
    });
    expect(output).toHaveLength(1);
    expect(output[0]).toHaveLength(500_002);
    expect(output[0].every((sample) => Number.isFinite(sample))).toBe(true);
  }, 180_000);

  it('matches native silence when the exact analysis hop is below one sample', () => {
    const source = Array.from({ length: 2 }, (_, channel) => (
      Float32Array.from({ length: 17 }, (_, index) => (
        0.3 * Math.sin(index * 0.41 + channel * 0.7) + 0.1 * Math.cos(index * 0.13)
      ))
    ));
    const output = processStaffPadTimeAndPitchChannels(source, {
      sampleRate: 8000,
      timeRatio: 100,
      pitchRatio: 2,
      preserveFormants: true,
      fftSize: 512,
    });
    expect(output).toHaveLength(2);
    for (const channel of output) {
      expect(channel).toHaveLength(1700);
      expect(channel.every((sample) => Number.isFinite(sample))).toBe(true);
      // Native StaffPad reaches IllState for exactHopA=512/(4*100*2)=0.64.
      // StaffPadTimeAndPitch::GetSamples consequently leaves the output zeroed.
      expect(channel.every((sample) => sample === 0)).toBe(true);
    }
  }, 30_000);

  it('zero-fills instead of leaking NaN when the integer analysis hop collapses', () => {
    const source = Array.from({ length: 2 }, (_, channel) => (
      Float32Array.from({ length: 257 }, (_, index) => (
        0.23 * Math.sin(index * 0.371 + channel * 0.73)
        + 0.17 * Math.cos(index * 0.117 + channel * 0.21)
        + 0.09 * Math.sin(index * 0.019 + channel * 0.47)
        + ((index + channel) % 11 === 0 ? 0.06 : -0.012)
      ))
    ));
    const output = processStaffPadTimeAndPitchChannels(source, {
      sampleRate: 8000,
      timeRatio: 64.01,
      pitchRatio: 2,
      preserveFormants: true,
      fftSize: 512,
    });
    expect(output).toHaveLength(2);
    for (const channel of output) {
      expect(channel).toHaveLength(16451);
      // Native exactHopA=0.9998047 truncates hopA to zero and currently leaks
      // NaN. Do not reproduce invalid PCM: use the same zero-fill failure
      // contract that Audacity applies when StaffPad reaches IllState.
      expect(channel.every((sample) => sample === 0)).toBe(true);
    }
  }, 30_000);

  it('condenses one minute to one sample without hanging, like the official regression', () => {
    const originalDuration = 60;
    const sampleRate = 44100;
    const inputFrames = originalDuration * sampleRate;
    const output = processStaffPadTimeAndPitchChannels([new Float32Array(inputFrames)], {
      sampleRate,
      timeRatio: (1 / sampleRate) / originalDuration,
      pitchRatio: 1,
      preserveFormants: true,
      fftSize: 2048,
    });
    expect(output).toHaveLength(1);
    expect(output[0]).toHaveLength(1);
    expect(Number.isFinite(output[0][0])).toBe(true);
  }, 180_000);

  it('processes one million non-silent input frames without ring-buffer or source-position loss', () => {
    const sampleRate = 1000;
    const inputFrames = 1_000_000;
    const source = new Float32Array(inputFrames);
    for (let index = 0; index < source.length; index += 1) {
      source[index] = 0.2 * Math.sin(index * 0.037) + 0.1 * Math.cos(index * 0.011);
    }
    const untouched = source.slice();
    const startedAt = performance.now();
    const output = processStaffPadTimeAndPitchChannels([source], {
      sampleRate,
      timeRatio: 0.1,
      pitchRatio: 1,
      preserveFormants: true,
      fftSize: 64,
    });
    const nonSilentSamples = output[0].reduce((count, sample) => count + (sample !== 0 ? 1 : 0), 0);
    console.log('StaffPad million-frame stress', {
      inputFrames,
      outputFrames: output[0].length,
      nonSilentSamples,
      durationMs: Math.round(performance.now() - startedAt),
    });
    expect(source).toEqual(untouched);
    expect(output).toHaveLength(1);
    expect(output[0]).toHaveLength(100_000);
    expect(output[0].every((sample) => Number.isFinite(sample))).toBe(true);
    expect(nonSilentSamples).toBeGreaterThan(90_000);
  }, 180_000);

  it('processes one million stereo frames at 1000% speed without channel bleed or ring loss', () => {
    const sampleRate = 1000;
    const inputFrames = 1_000_000;
    const left = new Float32Array(inputFrames);
    const right = new Float32Array(inputFrames);
    for (let index = 0; index < left.length; index += 1) {
      left[index] = 0.2 * Math.sin(index * 0.037) + 0.1 * Math.cos(index * 0.011);
    }
    const untouchedLeft = left.slice();
    const untouchedRight = right.slice();
    const startedAt = performance.now();
    const output = processStaffPadTimeAndPitchChannels([left, right], {
      sampleRate,
      timeRatio: 0.1,
      pitchRatio: 1,
      preserveFormants: true,
      fftSize: 64,
    });
    const nonSilentLeft = output[0].reduce((count, sample) => count + (sample !== 0 ? 1 : 0), 0);
    console.log('StaffPad million-frame stereo stress', {
      inputFrames,
      outputFrames: output[0].length,
      nonSilentLeft,
      durationMs: Math.round(performance.now() - startedAt),
    });
    expect(left).toEqual(untouchedLeft);
    expect(right).toEqual(untouchedRight);
    expect(output).toHaveLength(2);
    expect(output[0]).toHaveLength(100_000);
    expect(output[1]).toHaveLength(100_000);
    expect(output[0].every((sample) => Number.isFinite(sample))).toBe(true);
    expect(output[1].every((sample) => Number.isFinite(sample))).toBe(true);
    expect(nonSilentLeft).toBeGreaterThan(90_000);
    expect(output[1].every((sample) => sample === 0)).toBe(true);
  }, 180_000);
});
