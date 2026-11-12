/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  GRAPHIC_EQ_BAND_COUNT,
  GRAPHIC_EQ_FILTER_LENGTH,
  createGraphicEqPlan,
  processGraphicEqChannels,
  type GraphicEqSettings,
} from './graphicEqEffect';

interface OracleCase {
  sampleRate: number;
  channels: number;
  samples: number;
  gainsDb: number[];
  impulse: Float32Array;
  input: Float32Array[];
  output: Float32Array[];
}

function readOracle(): OracleCase[] {
  const buffer = readFileSync(resolve(process.cwd(), 'src/lib/graphicEqOracle.fixture.bin'));
  const bytes = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  let offset = 0;
  const u32 = () => { const value = view.getUint32(offset, true); offset += 4; return value; };
  const f64 = () => { const value = view.getFloat64(offset, true); offset += 8; return value; };
  const floats = (count: number) => {
    const result = new Float32Array(count);
    for (let index = 0; index < count; index += 1) {
      result[index] = view.getFloat32(offset, true); offset += 4;
    }
    return result;
  };
  expect(new TextDecoder().decode(bytes.subarray(0, 4))).toBe('GEQ1'); offset = 4;
  const cases = Array.from({ length: u32() }, () => {
    const sampleRate = u32(), channels = u32(), samples = u32();
    const gainsDb = Array.from({ length: GRAPHIC_EQ_BAND_COUNT }, f64);
    const impulse = floats(GRAPHIC_EQ_FILTER_LENGTH);
    const input = Array.from({ length: channels }, () => floats(samples));
    const output = Array.from({ length: channels }, () => floats(samples));
    return { sampleRate, channels, samples, gainsDb, impulse, input, output };
  });
  expect(offset).toBe(buffer.byteLength);
  return cases;
}

function expectPcm(actual: Float32Array, expected: Float32Array): void {
  expect(actual.length).toBe(expected.length);
  const scale = Math.max(1, ...Array.from(expected, Math.abs));
  for (let index = 0; index < actual.length; index += 1) {
    expect(Number.isFinite(actual[index]), `non-finite sample ${index}`).toBe(true);
    expect(Math.abs(actual[index] - expected[index]), `PCM mismatch at ${index}`).toBeLessThanOrEqual(0.00003 * scale);
  }
}

describe('Graphic EQ independent direct-DFT/direct-convolution oracle', () => {
  for (const [index, item] of readOracle().entries()) {
    it(`matches frozen C++ case ${index + 1}: ${item.sampleRate} Hz, ${item.channels}ch/${item.samples} samples`, () => {
      const settings: GraphicEqSettings = { gainsDb: item.gainsDb };
      const plan = createGraphicEqPlan(settings, item.sampleRate)!;
      expectPcm(plan.impulse, item.impulse);
      const actual = processGraphicEqChannels(item.input, settings, item.sampleRate, plan);
      actual.forEach((channel, channelIndex) => expectPcm(channel, item.output[channelIndex]));
    });
  }
});
