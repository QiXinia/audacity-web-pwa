/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createLoudnessPlan,
  processLoudnessChannels,
  type LoudnessSettings,
} from './loudnessEffect';

interface OracleCase {
  sampleRate: number;
  channels: Float32Array[];
  expected: Float32Array[];
  gains: number[];
  settings: LoudnessSettings;
}

function readCases(): OracleCase[] {
  const bytes = readFileSync(resolve(process.cwd(), 'src/lib/loudnessOracle.fixture.bin'));
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
  expect(String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3))).toBe('LDU1');
  offset = 4;
  const count = u32();
  const cases: OracleCase[] = [];
  for (let caseIndex = 0; caseIndex < count; caseIndex += 1) {
    const sampleRate = u32();
    const channelCount = u32();
    const sampleCount = u32();
    const algorithm = u32() === 0 ? 'loudness' as const : 'rms' as const;
    const stereoIndependent = u32() !== 0;
    const dualMono = u32() !== 0;
    const target = f64();
    const gains = Array.from(floats(channelCount));
    const channels = Array.from({ length: channelCount }, () => floats(sampleCount));
    const expected = Array.from({ length: channelCount }, () => floats(sampleCount));
    cases.push({
      sampleRate, channels, expected, gains,
      settings: {
        algorithm, stereoIndependent, dualMono,
        lufsLevel: algorithm === 'loudness' ? target : -23,
        rmsLevel: algorithm === 'rms' ? target : -20,
      },
    });
  }
  expect(offset).toBe(bytes.byteLength);
  return cases;
}

describe('Independent C++ Audacity Loudness oracle', () => {
  const cases = readCases();
  it('freezes eight LUFS/RMS, mono/stereo, rate and gating cases', () => {
    expect(cases).toHaveLength(8);
  });

  it.each(cases.map((item, index) => [index, item] as const))(
    'matches C++ gains and every PCM sample for case %i',
    (_index, item) => {
      const plan = createLoudnessPlan(item.channels, item.sampleRate, item.settings);
      expect(plan.gains).toEqual(item.gains);
      const output = processLoudnessChannels(item.channels, item.sampleRate, item.settings, plan);
      expect(output).toEqual(item.expected);
    },
  );
});
