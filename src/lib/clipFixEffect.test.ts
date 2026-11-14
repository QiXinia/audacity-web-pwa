import { describe, expect, it } from 'vitest';
import {
  defaultClipFixSettings,
  processClipFixChannel,
  processClipFixChannels,
} from './clipFixEffect';

const gain = 10 ** (-9 / 20);

describe('Audacity Clip Fix', () => {
  it('rebuilds a positive clipped run and preserves surrounding samples', () => {
    const input = Float32Array.from([0, 0.2, 0.5, 0.95, 0.95, 0.95, 0.5, 0.2, 0]);
    const output = processClipFixChannel(input, defaultClipFixSettings);
    expect(output.slice(0, 3)).toEqual(input.slice(0, 3).map((v) => v * gain));
    expect(output.slice(6)).toEqual(input.slice(6).map((v) => v * gain));
    expect(output[3]).toBeGreaterThan(output[2]);
    expect(output[4]).toBeGreaterThan(output[3]);
    expect(output[5]).toBeLessThan(output[4]);
    expect(Math.max(...Array.from(output))).toBeLessThan(1);
  });

  it('rebuilds negative clipped runs independently', () => {
    const input = Float32Array.from([0, -0.2, -0.5, -0.95, -0.95, -0.5, -0.2, 0]);
    const output = processClipFixChannel(input, defaultClipFixSettings);
    expect(output[3]).toBeLessThan(output[2]);
    expect(output[4]).toBeLessThanOrEqual(output[3]);
    expect(output[4]).toBeGreaterThan(-1);
  });

  it('returns silent input unchanged', () => {
    const input = new Float32Array(5);
    const output = processClipFixChannel(input, {
      thresholdPercent: 100,
      reduceGainDb: -9,
    });
    expect(Array.from(output)).toEqual([0, 0, 0, 0, 0]);
  });

  it('does not mutate the input and supports stereo channels', () => {
    const left = Float32Array.from([0, 0.3, 0.95, 0.95, 0.3, 0]);
    const right = Float32Array.from([0, 0.1, 0.3, 0.95, 0.95, 0.1]);
    const snapshot = Array.from(left);
    const [outLeft, outRight] = processClipFixChannels([left, right], defaultClipFixSettings);
    expect(Array.from(left)).toEqual(snapshot);
    expect(outLeft).not.toBe(left);
    expect(outRight).not.toBe(right);
    expect(Array.from(outLeft)).not.toEqual(Array.from(outRight));
  });

  it('rejects edge clips and invalid settings', () => {
    expect(() => processClipFixChannel(Float32Array.from([0.95, 0.95, 0.2]), defaultClipFixSettings))
      .toThrow('Clip Fix 需要削波区域两侧均有未削波采样作为上下文');
    expect(() => processClipFixChannel(Float32Array.from([0.2, 0.95, 0.95]), defaultClipFixSettings))
      .toThrow('Clip Fix 需要削波区域两侧均有未削波采样作为上下文');
    expect(() => processClipFixChannel(Float32Array.from([0.2, 0.9]), {
      thresholdPercent: -1, reduceGainDb: -9,
    })).toThrow('削波阈值');
    expect(() => processClipFixChannel(Float32Array.from([0.2, 0.9]), {
      thresholdPercent: 95, reduceGainDb: -31,
    })).toThrow('预留峰值增益');
  });
});
