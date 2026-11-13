import {
  DEFAULT_LEGACY_COMPRESSOR_SETTINGS,
  processLegacyCompressorChannels,
  validateLegacyCompressorSettings,
  type LegacyCompressorSettings,
} from './legacyCompressorEffect';

function settings(patch: Partial<LegacyCompressorSettings> = {}): LegacyCompressorSettings {
  return { ...DEFAULT_LEGACY_COMPRESSOR_SETTINGS, ...patch };
}

describe('Legacy Compressor DSP', () => {
  it('uses the official default settings', () => {
    expect(DEFAULT_LEGACY_COMPRESSOR_SETTINGS).toEqual({
      thresholdDb: -12,
      noiseFloorDb: -40,
      ratio: 2,
      attackTime: 0.2,
      releaseTime: 1,
      normalize: true,
      usePeak: false,
    });
  });

  it('normalizes peak output to full scale when make-up normalization is enabled', () => {
    const input = Float32Array.from([0.2, -0.4, 0.1, 0.05]);
    const [output] = processLegacyCompressorChannels([input], settings(), 100);
    expect(Math.max(...Array.from(output).map((v) => Math.abs(v)))).toBeCloseTo(1, 5);
    expect(input).toEqual(Float32Array.from([0.2, -0.4, 0.1, 0.05]));
  });

  it('applies peak-based upward compression without normalization', () => {
    const input = Float32Array.from([0.2, 0.8, -0.8, 0.2]);
    const [output] = processLegacyCompressorChannels(
      [input],
      settings({ usePeak: true, normalize: false, thresholdDb: -12, ratio: 2 }),
      100,
    );
    expect(output).toHaveLength(input.length);
    expect(Math.abs(output[0])).toBeGreaterThan(Math.abs(input[0]));
    expect(output.every((value) => Number.isFinite(value))).toBe(true);
  });

  it('supports equal-length stereo channels independently', () => {
    const left = Float32Array.from([0.1, 0.4]);
    const right = Float32Array.from([0.4, 0.1]);
    const outputs = processLegacyCompressorChannels([left, right], settings(), 100);
    expect(outputs).toHaveLength(2);
    expect(outputs[0]).not.toEqual(outputs[1]);
  });

  it('rejects invalid settings and mismatched channels', () => {
    expect(() => validateLegacyCompressorSettings(settings({ thresholdDb: 0 }))).toThrow('阈值');
    expect(() => validateLegacyCompressorSettings(settings({ ratio: 1 }))).toThrow('压缩比');
    expect(() => processLegacyCompressorChannels(
      [Float32Array.from([1]), Float32Array.from([1, 2])],
      settings(),
      100,
    )).toThrow('等长');
  });
});
