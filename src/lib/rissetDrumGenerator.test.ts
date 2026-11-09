import { describe, expect, it } from 'vitest';
import {
  RISSET_DEFAULT_AMPLITUDE,
  RISSET_DEFAULT_BANDWIDTH,
  RISSET_DEFAULT_CENTER_FREQUENCY,
  RISSET_DEFAULT_DECAY,
  RISSET_DEFAULT_FREQUENCY,
  RISSET_DEFAULT_NOISE_PERCENT,
  generateRissetDrum,
  getRissetDrumPlan,
  type RissetDrumRequest,
} from '@/lib/rissetDrumGenerator';

function request(overrides: Partial<RissetDrumRequest> = {}): RissetDrumRequest {
  return {
    frequency: RISSET_DEFAULT_FREQUENCY,
    decay: RISSET_DEFAULT_DECAY,
    centerFrequency: RISSET_DEFAULT_CENTER_FREQUENCY,
    bandwidth: RISSET_DEFAULT_BANDWIDTH,
    noisePercent: RISSET_DEFAULT_NOISE_PERCENT,
    amplitude: RISSET_DEFAULT_AMPLITUDE,
    sampleRate: 8000,
    seed: 123,
    ...overrides,
  };
}

function expectFinite(samples: Float32Array): void {
  for (const sample of samples) expect(Number.isFinite(sample)).toBe(true);
}

function peak(samples: Float32Array, start = 0, end = samples.length): number {
  let result = 0;
  for (let index = start; index < Math.min(end, samples.length); index += 1) {
    result = Math.max(result, Math.abs(samples[index]));
  }
  return result;
}

describe('Audacity Risset Drum control and timing contract', () => {
  it('exposes the six current official defaults and decay allocation', () => {
    expect(RISSET_DEFAULT_FREQUENCY).toBe(100);
    expect(RISSET_DEFAULT_DECAY).toBe(2);
    expect(RISSET_DEFAULT_CENTER_FREQUENCY).toBe(500);
    expect(RISSET_DEFAULT_BANDWIDTH).toBe(400);
    expect(RISSET_DEFAULT_NOISE_PERCENT).toBe(25);
    expect(RISSET_DEFAULT_AMPLITUDE).toBe(0.8);
    const plan = getRissetDrumPlan(request({ sampleRate: 44100 }));
    expect(plan.sampleCount).toBe(88200);
    expect(plan.duration).toBe(2);
    expect(plan.enharmonicDecay).toBe(1);
  });

  it('rounds the requested decay to the nearest project sample', () => {
    const plan = getRissetDrumPlan(request({ decay: 0.1, sampleRate: 15 }));
    expect(plan.sampleCount).toBe(2);
    expect(plan.duration).toBeCloseTo(2 / 15, 12);
  });

  it('normalizes the default sound to the official 0.8 peak', () => {
    const result = generateRissetDrum(request());
    expect(result.samples).toHaveLength(16000);
    expectFinite(result.samples);
    expect(result.peak).toBeCloseTo(0.8, 6);
  });

  it('preserves a silent zero-amplitude result without dividing by zero', () => {
    const result = generateRissetDrum(request({ amplitude: 0 }));
    expect(result.peak).toBe(0);
    expect(result.samples.every((sample) => sample === 0)).toBe(true);
  });
});

describe('Risset Drum structured DSP', () => {
  it('matches an independent tonal-only harmonic and envelope calculation', () => {
    const settings = request({ noisePercent: 0, decay: 0.1, sampleRate: 8000 });
    const result = generateRissetDrum(settings);
    const raw = new Float64Array(result.samples.length);
    let rawPeak = 0;
    for (let index = 0; index < raw.length; index += 1) {
      const time = index / settings.sampleRate;
      const table = Math.sin(2 * Math.PI * 100 * time)
        + 1.5 * Math.sin(2 * Math.PI * 160 * time)
        + 2 * Math.sin(2 * Math.PI * 220 * time)
        + 1.5 * Math.sin(2 * Math.PI * 230 * time);
      const shortEnvelope = time < 0.05 ? 2 ** (-time / (0.05 / 8)) : 0;
      const longEnvelope = 2 ** (-time / (0.1 / 8));
      raw[index] = shortEnvelope * 0.17 * table
        + longEnvelope * Math.sin(2 * Math.PI * 100 * time);
      rawPeak = Math.max(rawPeak, Math.abs(raw[index]));
    }
    for (let index = 0; index < raw.length; index += 1) {
      expect(result.samples[index]).toBeCloseTo(raw[index] * 0.8 / rawPeak, 6);
    }
  });

  it('uses the second half only for the fundamental tone', () => {
    const tonal = generateRissetDrum(request({ noisePercent: 0 }));
    expect(peak(tonal.samples, 8000)).toBeGreaterThan(0);
    const noiseOnly = generateRissetDrum(request({ noisePercent: 100 }));
    expect(peak(noiseOnly.samples, 0, 8000)).toBeGreaterThan(0);
    expect(peak(noiseOnly.samples, 8000)).toBe(0);
  });

  it('turns the noise percentage into bounded tonal and noise-only extremes', () => {
    const tonal = generateRissetDrum(request({ noisePercent: 0, seed: 1 })).samples;
    const tonalOtherSeed = generateRissetDrum(request({ noisePercent: 0, seed: 999 })).samples;
    expect(tonalOtherSeed).toEqual(tonal);
    const noiseOnly = generateRissetDrum(request({ noisePercent: 100, seed: 1 })).samples;
    expect(noiseOnly).not.toEqual(tonal);
  });

  it('uses an explicit seed for reproducible noise regression tests', () => {
    const first = generateRissetDrum(request({ seed: 7 })).samples;
    const second = generateRissetDrum(request({ seed: 7 })).samples;
    const different = generateRissetDrum(request({ seed: 8 })).samples;
    expect(second).toEqual(first);
    expect(different).not.toEqual(first);
  });

  it('changes the waveform when frequency, centre frequency or bandwidth changes', () => {
    const baseline = generateRissetDrum(request()).samples;
    expect(generateRissetDrum(request({ frequency: 120 })).samples).not.toEqual(baseline);
    expect(generateRissetDrum(request({ centerFrequency: 700 })).samples).not.toEqual(baseline);
    expect(generateRissetDrum(request({ bandwidth: 200 })).samples).not.toEqual(baseline);
  });

  it('keeps the highest official control values finite', () => {
    const result = generateRissetDrum(request({
      frequency: 2000,
      centerFrequency: 5000,
      bandwidth: 1000,
      noisePercent: 100,
      amplitude: 1,
    }));
    expectFinite(result.samples);
    expect(result.peak).toBeCloseTo(1, 6);
  });
});

describe('Risset Drum fail-closed validation', () => {
  it.each([
    ['frequency', 49], ['frequency', 2001], ['frequency', Number.NaN],
    ['decay', 0.09], ['decay', 61], ['decay', Number.NaN],
    ['centerFrequency', 99], ['centerFrequency', 5001],
    ['bandwidth', 9], ['bandwidth', 1001],
    ['noisePercent', -1], ['noisePercent', 101],
    ['amplitude', -0.1], ['amplitude', 1.1],
    ['sampleRate', 0], ['sampleRate', Number.NaN], ['seed', Number.NaN],
  ])('rejects invalid %s=%s', (key, value) => {
    expect(() => getRissetDrumPlan(request({ [key]: value }))).toThrow(RangeError);
  });

  it('rejects a duration containing no complete sample', () => {
    expect(() => getRissetDrumPlan(request({ decay: 0.1, sampleRate: 1 }))).toThrow(
      'at least one sample',
    );
  });

  it('rejects impractical browser allocations before allocating a buffer', () => {
    expect(() => generateRissetDrum(request({ decay: 60, sampleRate: 1_000_000 }))).toThrow(
      'browser render memory limit',
    );
  });
});
