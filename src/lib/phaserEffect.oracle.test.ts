/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createPhaserState,
  processPhaser,
  type PhaserSettings,
} from './phaserEffect';

interface OracleCase {
  sampleRate: number;
  splitAt: number;
  settings: PhaserSettings;
  input: Float32Array[];
  output: Float32Array[];
}

function readOracle(): OracleCase[] {
  const buffer = readFileSync(resolve(process.cwd(), 'src/lib/phaserOracle.fixture.bin'));
  const bytes = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
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
  expect(new TextDecoder().decode(bytes.subarray(0, 4))).toBe('PHS1'); offset = 4;
  const cases = Array.from({ length: u32() }, () => {
    const sampleRate = u32(), channels = u32(), samples = u32(), splitAt = u32();
    const stages = i32(), dryWet = i32(), depth = i32(), feedbackPercent = i32();
    const frequencyHz = f64(), phaseDegrees = f64(), outputGainDb = f64();
    const input = Array.from({ length: channels }, () => floats(samples));
    const output = Array.from({ length: channels }, () => floats(samples));
    return {
      sampleRate,
      splitAt,
      settings: { stages, dryWet, frequencyHz, phaseDegrees, depth, feedbackPercent, outputGainDb },
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

describe('Phaser independent Audacity 4.0.2 C++ oracle', () => {
  for (const [index, item] of readOracle().entries()) {
    it(`matches frozen case ${index + 1}: ${item.settings.stages} requested stages, split at ${item.splitAt}`, () => {
      item.input.forEach((channel, channelIndex) => {
        const state = createPhaserState(item.settings, item.sampleRate);
        const first = processPhaser(channel.slice(0, item.splitAt), item.settings, item.sampleRate, state);
        const second = processPhaser(channel.slice(item.splitAt), item.settings, item.sampleRate, state);
        const actual = new Float32Array(channel.length);
        actual.set(first, 0);
        actual.set(second, item.splitAt);
        expectPcm(actual, item.output[channelIndex]);
      });
    });
  }
});
