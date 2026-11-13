/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createClassicFilterState,
  processClassicFilter,
  type ClassicFilterSettings,
  type ClassicFilterSubtype,
  type ClassicFilterType,
} from './classicFilterEffect';

interface OracleCase {
  sampleRate: number;
  splitAt: number;
  settings: ClassicFilterSettings;
  coefficients: { b0: number; b1: number; b2: number; a1: number; a2: number }[];
  input: Float32Array[];
  output: Float32Array[];
}

const types: ClassicFilterType[] = ['butterworth', 'chebyshev1', 'chebyshev2'];
const subtypes: ClassicFilterSubtype[] = ['lowpass', 'highpass'];

function readOracle(): OracleCase[] {
  const buffer = readFileSync(resolve(process.cwd(), 'src/lib/classicFilterOracle.fixture.bin'));
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  let offset = 0;
  const u32 = () => { const value = view.getUint32(offset, true); offset += 4; return value; };
  const i32 = () => { const value = view.getInt32(offset, true); offset += 4; return value; };
  const f64 = () => { const value = view.getFloat64(offset, true); offset += 8; return value; };
  const floats = (count: number) => {
    const result = new Float32Array(count);
    for (let index = 0; index < count; index += 1) {
      result[index] = view.getFloat32(offset, true); offset += 4;
    }
    return result;
  };
  expect(new TextDecoder().decode(new Uint8Array(buffer.buffer, buffer.byteOffset, 4))).toBe('CLF1');
  offset = 4;
  const cases = Array.from({ length: u32() }, () => {
    const sampleRate = u32(), channels = u32(), samples = u32(), splitAt = u32();
    const filterType = types[i32()], subtype = subtypes[i32()], order = i32();
    const cutoffHz = f64(), passbandRippleDb = f64(), stopbandAttenuationDb = f64();
    const coefficients = Array.from({ length: u32() }, () => ({
      b0: f64(), b1: f64(), b2: f64(), a1: f64(), a2: f64(),
    }));
    const input: Float32Array[] = [], output: Float32Array[] = [];
    for (let channel = 0; channel < channels; channel += 1) {
      input.push(floats(samples));
      output.push(floats(samples));
    }
    return {
      sampleRate,
      splitAt,
      settings: { filterType, subtype, order, cutoffHz, passbandRippleDb, stopbandAttenuationDb },
      coefficients,
      input,
      output,
    };
  });
  expect(offset).toBe(buffer.byteLength);
  return cases;
}

function expectPcm(actual: Float32Array, expected: Float32Array): void {
  expect(actual.length).toBe(expected.length);
  const scale = Math.max(1, ...Array.from(expected, Math.abs));
  for (let index = 0; index < actual.length; index += 1) {
    expect(Number.isFinite(actual[index]), `non-finite sample ${index}`).toBe(true);
    expect(Math.abs(actual[index] - expected[index]), `PCM mismatch at ${index}`)
      .toBeLessThanOrEqual(0.000002 * scale);
  }
}

describe('Classic Filters independent Audacity 4.0.2 C++ oracle', () => {
  const cases = readOracle();
  it('freezes all 24 type/subtype/order combinations', () => {
    expect(cases).toHaveLength(24);
    expect(new Set(cases.map((item) => JSON.stringify(item.settings))).size).toBe(24);
  });

  for (const [index, item] of cases.entries()) {
    it(`matches case ${index + 1}: ${item.settings.filterType} ${item.settings.subtype} order ${item.settings.order}`, () => {
      expect(item.input).toHaveLength(item.output.length);
      item.input.forEach((channel, channelIndex) => {
        const state = createClassicFilterState(item.settings, item.sampleRate);
        expect(state.sections).toHaveLength(item.coefficients.length);
        state.sections.forEach((section, sectionIndex) => {
          const expected = item.coefficients[sectionIndex];
          for (const key of ['b0', 'b1', 'b2', 'a1', 'a2'] as const) {
            expect(Math.abs(section[key] - expected[key]), `${key} mismatch in section ${sectionIndex}`)
              .toBeLessThanOrEqual(0.000000001 * Math.max(1, Math.abs(expected[key])));
          }
        });
        const first = processClassicFilter(channel.slice(0, item.splitAt), item.settings, item.sampleRate, state);
        const second = processClassicFilter(channel.slice(item.splitAt), item.settings, item.sampleRate, state);
        const actual = new Float32Array(channel.length);
        actual.set(first, 0);
        actual.set(second, item.splitAt);
        expectPcm(actual, item.output[channelIndex]);
      });
    });
  }
});
