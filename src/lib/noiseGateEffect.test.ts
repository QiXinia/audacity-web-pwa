import {
  DEFAULT_NOISE_GATE_SETTINGS,
  createNoiseGateEnvelope,
  processNoiseGateChannels,
  validateNoiseGateSettings,
  type NoiseGateSettings,
} from './noiseGateEffect';

function settings(patch: Partial<NoiseGateSettings> = {}): NoiseGateSettings {
  return { ...DEFAULT_NOISE_GATE_SETTINGS, ...patch };
}

function pulse(length = 200, start = 80, end = 120, amplitude = 0.9): Float32Array {
  const signal = new Float32Array(length);
  signal.fill(amplitude, start, end);
  return signal;
}

describe('Noise Gate DSP', () => {
  it('uses the official default settings', () => {
    expect(DEFAULT_NOISE_GATE_SETTINGS).toEqual({
      stereoLink: true,
      thresholdDb: -40,
      gateFreqKhz: 0,
      levelReductionDb: -24,
      attackMs: 10,
      holdMs: 50,
      decayMs: 100,
    });
  });

  it('opens with lookahead and closes after hold and decay', () => {
    const envelope = createNoiseGateEnvelope([pulse()], settings({ thresholdDb: -40 }), 1000);
    expect(envelope.slice(0, 60).every((v) => Math.abs(v - 0.0630957344480193) < 1e-6)).toBe(true);
    expect(envelope[79]).toBeGreaterThan(0.0631);
    expect(envelope.slice(80, 170).every((v) => v === 1)).toBe(true);
    expect(envelope[170]).toBeGreaterThan(0.0631);
    expect(envelope[199]).toBeGreaterThan(0.0631);
  });

  it('attenuates quiet material without changing the input', () => {
    const input = pulse(200, 80, 120, 0.001);
    const [output] = processNoiseGateChannels([input], settings({ thresholdDb: -20, levelReductionDb: -30 }), 1000);
    expect(output.every((v) => Math.abs(v) < 0.0001)).toBe(true);
    expect(input).toEqual(pulse(200, 80, 120, 0.001));
  });

  it('can silence the floor and supports linked stereo detection', () => {
    const left = new Float32Array(200);
    const right = pulse();
    const outputs = processNoiseGateChannels(
      [left, right],
      settings({ levelReductionDb: -100, thresholdDb: -40 }),
      1000,
    );
    expect(outputs).toHaveLength(2);
    expect(outputs[0].slice(80, 120).every((v) => v === 0)).toBe(true);
    expect(outputs[1].slice(80, 120).every((v) => Math.abs(v - 0.9) < 1e-6)).toBe(true);
  });

  it('processes channels independently when stereo linking is disabled', () => {
    const outputs = processNoiseGateChannels(
      [new Float32Array(200), pulse()],
      settings({ stereoLink: false, thresholdDb: -40 }),
      1000,
    );
    expect(outputs[0].every((v) => v === 0)).toBe(true);
    expect(outputs[1].slice(80, 120).every((v) => Math.abs(v - 0.9) < 1e-6)).toBe(true);
  });

  it('preserves low-frequency content while gating the high-frequency band', () => {
    const [output] = processNoiseGateChannels(
      [pulse()],
      settings({ gateFreqKhz: 1, thresholdDb: -40 }),
      10000,
    );
    expect(output.some((v) => v !== 0)).toBe(true);
    expect(output.every(Number.isFinite)).toBe(true);
  });

  it('rejects invalid settings, short selections, and mismatched channels', () => {
    expect(() => validateNoiseGateSettings(settings({ thresholdDb: 0 }))).toThrow('阈值');
    expect(() => processNoiseGateChannels([pulse(99)], settings(), 1000)).toThrow('100 个采样');
    expect(() => processNoiseGateChannels([pulse(100), pulse(101)], settings(), 1000)).toThrow('等长');
  });
});
