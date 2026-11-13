import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DELAY_SETTINGS,
  processDelayChannels,
  validateDelaySettings,
  type DelaySettings,
} from './delayEffect';

const sampleRate = 100;

function settings(overrides: Partial<DelaySettings> = {}): DelaySettings {
  return { ...DEFAULT_DELAY_SETTINGS, ...overrides };
}

describe('Audacity Delay', () => {
  it('places regular echoes at fixed offsets with cumulative dB gain', () => {
    const input = [Float32Array.of(1, 0, 0, 0, 0)];
    const output = processDelayChannels(
      input,
      settings({ delaySeconds: 0.1, echoCount: 2, delayLevelDb: -6 }),
      sampleRate,
    );
    expect(output[0].length).toBe(25);
    expect(output[0][0]).toBeCloseTo(1, 6);
    expect(output[0][10]).toBeCloseTo(10 ** -0.3, 6);
    expect(output[0][20]).toBeCloseTo(10 ** -0.6, 6);
  });

  it('supports decreasing bouncing ball spacing', () => {
    const output = processDelayChannels(
      [Float32Array.of(1, 0, 0, 0, 0)],
      settings({ delayType: 'bouncingBall', delaySeconds: 0.6, echoCount: 3 }),
      sampleRate,
    )[0];
    expect(output[60]).toBeCloseTo(10 ** -0.3, 6);
    expect(output[100]).toBeCloseTo(10 ** -0.6, 6);
    expect(output[120]).toBeCloseTo(10 ** -0.9, 6);
  });

  it('supports increasing reverse bouncing ball spacing', () => {
    const output = processDelayChannels(
      [Float32Array.of(1, 0, 0, 0, 0)],
      settings({ delayType: 'reverseBouncingBall', delaySeconds: 0.6, echoCount: 3 }),
      sampleRate,
    )[0];
    expect(output[20]).toBeCloseTo(10 ** -0.3, 6);
    expect(output[60]).toBeCloseTo(10 ** -0.6, 6);
    expect(output[120]).toBeCloseTo(10 ** -0.9, 6);
  });

  it('keeps original duration when duration change is disallowed', () => {
    const output = processDelayChannels(
      [Float32Array.of(1, 0, 0, 0, 0)],
      settings({ delaySeconds: 0.2, echoCount: 2, allowDurationChange: false }),
      sampleRate,
    )[0];
    expect(output.length).toBe(5);
    expect(output[0]).toBe(1);
  });

  it('processes every channel independently', () => {
    const output = processDelayChannels(
      [Float32Array.of(1, 0, 0, 0, 0), Float32Array.of(0.5, 0, 0, 0, 0)],
      settings({ delaySeconds: 0.1, echoCount: 1 }),
      sampleRate,
    );
    expect(output[0][10]).toBeCloseTo(10 ** -0.3, 6);
    expect(output[1][10]).toBeCloseTo(0.5 * 10 ** -0.3, 6);
  });

  it('rejects invalid settings and non-finite audio', () => {
    expect(() => validateDelaySettings(settings({ echoCount: 0 }))).toThrow();
    expect(() => validateDelaySettings(settings({ delayLevelDb: -31 }))).toThrow();
    expect(() => processDelayChannels(
      [Float32Array.of(Number.NaN, 0, 0)],
      settings(),
      sampleRate,
    )).toThrow();
  });
});
