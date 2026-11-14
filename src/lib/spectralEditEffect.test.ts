import { describe, expect, it } from 'vitest';
import {
  describeSpectralSelection,
  isSpectralEditBypassed,
  processSpectralEditChannels,
  spectralEditEnvelope,
  spectralEditMagnitudeAtFrequency,
  validateSpectralEditSettings,
  type SpectralEditSettings,
} from './spectralEditEffect';

const SAMPLE_RATE = 1000;
const IMPULSE = Float32Array.from([1, ...Array<number>(19).fill(0)]);

function settings(kind: SpectralEditSettings['kind'], overrides: Partial<SpectralEditSettings> = {}): SpectralEditSettings {
  return { kind, lowHz: 100, highHz: 400, gainDb: kind === 'delete-center' ? 0 : 6, ...overrides };
}

function expectSamples(actual: Float32Array, expected: readonly number[]): void {
  expect(actual.length).toBe(20);
  expected.forEach((value, index) => expect(actual[index]).toBeCloseTo(value, 7));
}

// Independently recomputed from dspprims.lsp and the three Nyquist plug-ins
// with Python's double-precision math, then rounded only for this fixture.
const ORACLES = {
  'delete-center': [1, -0.0152197825247, 0.08794785179, 0.0513350847628, 0.00222742715805, -0.00949738566352, -0.00436110017547, -0.000138519066103, 0.000656193093588, 0.000277798252061, 0.00000673926087525, -0.000031868606251],
  'amplify-center': [1, 0.00902068846926, -0.0492235034087, -0.0548858649887, 0.026142759201, 0.0754059965119, 0.0207275280165, -0.0555983259605, -0.0500289026244, 0.0173859589729, 0.0500154671562, 0.0116752280234],
  'amplify-selection': [1, 0, -0.10837933481052622, 0, -0.007763085693984685, 0, 0.037687419031165625, 0, 0.016852496912838518, 0, -0.0017058827578283846, 0],
} as const;

describe('Audacity 4 Spectral tools DSP', () => {
  it('uses Audacity geometric centre and natural-log bandwidth semantics', () => {
    expect(describeSpectralSelection({ lowHz: 100, highHz: 400 })).toEqual({
      centerHz: 200,
      bandwidth: Math.log(4),
    });
    expect(describeSpectralSelection({ lowHz: null, highHz: 400 })).toEqual({ centerHz: null, bandwidth: null });
  });

  it.each(Object.keys(ORACLES) as SpectralEditSettings['kind'][])('%s matches the independent impulse oracle', (kind) => {
    const [actual] = processSpectralEditChannels([IMPULSE], settings(kind), SAMPLE_RATE);
    expectSamples(actual, ORACLES[kind]);
  });

  it('has unity notch response at the centre and exact linear EQ gain', () => {
    expect(spectralEditMagnitudeAtFrequency(settings('delete-center'), SAMPLE_RATE, 200)).toBeCloseTo(0, 10);
    expect(spectralEditMagnitudeAtFrequency(settings('amplify-center'), SAMPLE_RATE, 200)).toBeCloseTo(10 ** (6 / 20), 8);
    // Independent dspprims.lsp evaluation: the two inverse shelves do not
    // promise exactly the requested gain at the geometric centre.
    expect(spectralEditMagnitudeAtFrequency(settings('amplify-selection'), SAMPLE_RATE, 200)).toBeCloseTo(1.9347851410821886, 8);
    expect(spectralEditMagnitudeAtFrequency(settings('amplify-selection'), SAMPLE_RATE, 0)).toBeCloseTo(1, 8);
    expect(spectralEditMagnitudeAtFrequency(settings('amplify-selection'), SAMPLE_RATE, 500)).toBeCloseTo(1, 8);
  });

  it('uses the official 10 ms edge envelope and preserves a one-sample selection', () => {
    const envelope = spectralEditEnvelope(1000, SAMPLE_RATE);
    expect(envelope[0]).toBe(0);
    expect(envelope[9]).toBeCloseTo(0.9, 7);
    expect(envelope[10]).toBe(1);
    expect(envelope[990]).toBe(1);
    expect(envelope[999]).toBeCloseTo(0.1, 7);
    const [single] = processSpectralEditChannels([Float32Array.of(0.75)], settings('delete-center'), SAMPLE_RATE);
    expect(single[0]).toBe(0.75);
  });

  it('handles one-sided delete selections and the official high-pass Nyquist fade', () => {
    const input = Float32Array.from(Array(20).fill(1));
    const [lowOnly] = processSpectralEditChannels([input], settings('delete-center', { highHz: null }), SAMPLE_RATE);
    const [highOnly] = processSpectralEditChannels([input], settings('delete-center', { lowHz: null }), SAMPLE_RATE);
    expect(lowOnly).not.toEqual(input);
    expect(highOnly).not.toEqual(input);
    const [above] = processSpectralEditChannels([input], settings('delete-center', { lowHz: null, highHz: 500 }), SAMPLE_RATE);
    const envelope = spectralEditEnvelope(20, SAMPLE_RATE);
    above.forEach((value, index) => expect(value).toBeCloseTo(1 - envelope[index], 7));
    const [lowAbove] = processSpectralEditChannels([input], settings('delete-center', { highHz: null, lowHz: 500 }), SAMPLE_RATE);
    expect(lowAbove).toEqual(input);
  });

  it('supports one-sided shelves and drops invalid shelves above Nyquist without inventing output', () => {
    const input = Float32Array.from(Array(20).fill(0.2));
    const [lowShelf] = processSpectralEditChannels([input], settings('amplify-selection', { lowHz: null }), SAMPLE_RATE);
    const [highShelf] = processSpectralEditChannels([input], settings('amplify-selection', { highHz: null }), SAMPLE_RATE);
    expect(lowShelf).not.toEqual(input);
    expect(highShelf).not.toEqual(input);
    const [lowAbove] = processSpectralEditChannels([input], settings('amplify-selection', { lowHz: 500, highHz: null }), SAMPLE_RATE);
    expect(lowAbove).toEqual(input);
    expect(() => processSpectralEditChannels([input], settings('amplify-selection', { highHz: 500 }), SAMPLE_RATE)).not.toThrow();
  });

  it('returns exact copies for zero gain and does not mutate inputs', () => {
    const input = Float32Array.from([0.1, -0.2, 0.3, -0.4]);
    const original = input.slice();
    const zero = settings('amplify-center', { gainDb: 0 });
    expect(isSpectralEditBypassed(zero)).toBe(true);
    const [actual] = processSpectralEditChannels([input], zero, SAMPLE_RATE);
    expect(actual).toEqual(input);
    expect(actual).not.toBe(input);
    expect(input).toEqual(original);
  });

  it('keeps stereo channels independent', () => {
    const left = Float32Array.from([1, ...Array<number>(19).fill(0)]);
    const right = Float32Array.from(Array(20).fill(0));
    const [actualLeft, actualRight] = processSpectralEditChannels([left, right], settings('delete-center'), SAMPLE_RATE);
    expectSamples(actualLeft, ORACLES['delete-center']);
    expect(actualRight).toEqual(right);
  });

  it('rejects malformed frequency selections and parameters before processing', () => {
    expect(() => validateSpectralEditSettings(settings('delete-center', { lowHz: null, highHz: null }))).toThrow('至少');
    expect(() => validateSpectralEditSettings(settings('delete-center', { highHz: 100 }))).toThrow('带宽');
    expect(() => validateSpectralEditSettings(settings('delete-center', { highHz: 50 }))).toThrow('带宽');
    expect(() => validateSpectralEditSettings(settings('amplify-center', { lowHz: null }))).toThrow('完整');
    expect(() => validateSpectralEditSettings(settings('amplify-center', { gainDb: 25 }))).toThrow('-24–24');
    expect(() => validateSpectralEditSettings(settings('delete-center', { lowHz: Number.NaN }))).toThrow('低频');
    expect(() => processSpectralEditChannels([], settings('delete-center'), SAMPLE_RATE)).toThrow('至少');
    expect(() => processSpectralEditChannels([new Float32Array()], settings('delete-center'), SAMPLE_RATE)).toThrow('非空');
    expect(() => processSpectralEditChannels([Float32Array.of(1), Float32Array.of(1, 2)], settings('delete-center'), SAMPLE_RATE)).toThrow('等长');
    expect(() => processSpectralEditChannels([Float32Array.of(Number.NaN)], settings('delete-center'), SAMPLE_RATE)).toThrow('非有限');
  });

  it('preserves official Parametric EQ and extreme-notch error boundaries', () => {
    expect(() => processSpectralEditChannels([IMPULSE], settings('amplify-center', { highHz: 501 }), SAMPLE_RATE)).toThrow('Nyquist');
    expect(() => processSpectralEditChannels([IMPULSE], settings('delete-center', { lowHz: 1, highHz: 30_000 }), SAMPLE_RATE)).toThrow('Notch');
  });
});
