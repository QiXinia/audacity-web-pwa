/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NOISE_REDUCTION_SETTINGS,
  NOISE_REDUCTION_SPECTRUM_SIZE,
  learnNoiseProfile,
  processNoiseReductionChannels,
} from './noiseReductionEffect';

function oracleInput(): Float32Array {
  let state = 0x12345678;
  const result = new Float32Array(4096);
  for (let index = 0; index < result.length; index += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    result[index] = Math.fround((state / 0x100000000 - 0.5) * 0.08);
  }
  return result;
}

function oracle(): { means: Float32Array; reduced: Float32Array; residue: Float32Array } {
  const bytes = readFileSync(resolve(process.cwd(), 'src/lib/noiseReductionOracle.fixture.bin'));
  const values = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
  return {
    means: new Float32Array(values.subarray(0, NOISE_REDUCTION_SPECTRUM_SIZE)),
    reduced: new Float32Array(values.subarray(NOISE_REDUCTION_SPECTRUM_SIZE, NOISE_REDUCTION_SPECTRUM_SIZE + 4096)),
    residue: new Float32Array(values.subarray(NOISE_REDUCTION_SPECTRUM_SIZE + 4096)),
  };
}

function maxDifference(actual: Float32Array, expected: Float32Array): number {
  let maximum = 0;
  for (let index = 0; index < actual.length; index += 1) {
    maximum = Math.max(maximum, Math.abs(actual[index] - expected[index]));
  }
  return maximum;
}

describe('Noise Reduction independent C++ oracle', () => {
  it('matches the Audacity-contract C++ complex-FFT oracle for profile, reduce and residue', () => {
    const input = oracleInput();
    const expected = oracle();
    const profile = learnNoiseProfile([input.subarray(0, 2048)], 1000);
    const reduced = processNoiseReductionChannels([input], profile, DEFAULT_NOISE_REDUCTION_SETTINGS)[0];
    const residue = processNoiseReductionChannels(
      [input], profile, { ...DEFAULT_NOISE_REDUCTION_SETTINGS, mode: 'residue' },
    )[0];
    expect(profile.totalWindows).toBe(1);
    expect(maxDifference(profile.means, expected.means)).toBeLessThan(2e-5);
    expect(maxDifference(reduced, expected.reduced)).toBeLessThan(2e-5);
    expect(maxDifference(residue, expected.residue)).toBeLessThan(2e-5);
  });
});
