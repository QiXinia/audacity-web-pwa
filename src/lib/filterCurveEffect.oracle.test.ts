/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createFilterCurveEqPlan,
  processFilterCurveEqChannels,
  type FilterCurveEqSettings,
} from './filterCurveEffect';

interface OracleCase {
  sampleRate: number;
  channels: Float32Array[];
  expected: Float32Array[];
  impulse: Float32Array;
  settings: FilterCurveEqSettings;
}

function readCases(): OracleCase[] {
  const bytes = readFileSync(resolve(process.cwd(), 'src/lib/filterCurveOracle.fixture.bin'));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  const u32 = () => { const value = view.getUint32(offset, true); offset += 4; return value; };
  const f64 = () => { const value = view.getFloat64(offset, true); offset += 8; return value; };
  const floats = (length: number) => {
    const result = new Float32Array(length);
    for (let index = 0; index < length; index += 1) {
      result[index] = view.getFloat32(offset, true);
      offset += 4;
    }
    return result;
  };
  expect(String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3))).toBe('FCQ1');
  offset = 4;
  const count = u32();
  const cases: OracleCase[] = [];
  for (let caseIndex = 0; caseIndex < count; caseIndex += 1) {
    const sampleRate = u32();
    const channelCount = u32();
    const sampleCount = u32();
    const linearFrequencyScale = u32() !== 0;
    const filterLength = u32();
    const pointCount = u32();
    const points = Array.from({ length: pointCount }, () => ({ frequency: f64(), gainDb: f64() }));
    const impulse = floats(filterLength);
    const channels = Array.from({ length: channelCount }, () => floats(sampleCount));
    const expected = Array.from({ length: channelCount }, () => floats(sampleCount));
    cases.push({ sampleRate, channels, expected, impulse, settings: { points, filterLength, linearFrequencyScale } });
  }
  expect(offset).toBe(bytes.byteLength);
  return cases;
}

function expectReference(actual: Float32Array, expected: Float32Array, label: string): void {
  expect(actual.length, `${label} length`).toBe(expected.length);
  let maximumError = 0;
  let errorIndex = -1;
  let scale = 0;
  for (let index = 0; index < actual.length; index += 1) {
    const error = Math.abs(actual[index] - expected[index]);
    if (error > maximumError) { maximumError = error; errorIndex = index; }
    scale = Math.max(scale, Math.abs(expected[index]));
  }
  // The oracle uses double direct DFT/convolution; the product intentionally uses
  // Audacity's float FFT. Permit only accumulated float round-off, not DSP drift.
  const tolerance = 0.00003 * Math.max(1, scale);
  if (!(maximumError <= tolerance)) {
    throw new Error(`${label}[${errorIndex}] error ${maximumError} exceeds ${tolerance}`);
  }
}

describe('Independent direct-DFT C++ Filter Curve EQ oracle', () => {
  const cases = readCases();
  it('freezes default/custom FIR, log/linear, stereo and overlap-add cases', () => {
    expect(cases).toHaveLength(6);
  });

  it.each(cases.map((item, index) => [index, item] as const))(
    'matches C++ impulse and every PCM sample for case %i',
    (_index, item) => {
      const plan = createFilterCurveEqPlan(item.settings, item.sampleRate);
      if (plan) expectReference(plan.impulse, item.impulse, 'impulse');
      const output = processFilterCurveEqChannels(item.channels, item.settings, item.sampleRate, plan);
      output.forEach((channel, index) => expectReference(channel, item.expected[index], `channel ${index}`));
      expect(item.channels[0]).not.toBe(output[0]);
    },
  );
});
