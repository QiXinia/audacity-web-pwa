import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PASS_FILTER_SETTINGS,
  PASS_FILTER_KINDS,
  PASS_FILTER_ROLLOFFS,
  createPassFilterState,
  processPassFilter,
  processPassFilterChannels,
  validatePassFilterSettings,
  type PassFilterRolloff,
  type PassFilterSettings,
} from './passFilterEffect';

const PI = 3.14159265358979;
const Q: Readonly<Record<Exclude<PassFilterRolloff, 6>, readonly number[]>> = {
  12: [0.7071],
  24: [0.60492333, 1.33722126],
  36: [0.58338080, 0.75932572, 1.95302407],
  48: [0.57622191, 0.66045510, 0.94276399, 2.57900101],
};

/** Independent transcription of tone.c, atone.c, biquadfilt.c and dspprims.lsp. */
function officialReference(input: Float32Array, settings: PassFilterSettings, sampleRate: number): Float32Array {
  const b = 2 - Math.cos(settings.frequencyHz * 2 * PI / sampleRate);
  const c = b - Math.sqrt(b * b - 1);
  if (settings.rolloff === 6) {
    let previous = 0;
    const output = new Float32Array(input.length);
    for (let i = 0; i < input.length; i += 1) {
      if (settings.kind === 'lowpass') {
        previous = (1 - c) * input[i] + c * previous;
        output[i] = previous;
      } else {
        const y = c * (previous + input[i]);
        output[i] = y;
        previous = y - input[i];
      }
    }
    return output;
  }

  let source = input;
  const w = 2 * PI * (settings.frequencyHz / sampleRate);
  const cw = Math.cos(w);
  const sw = Math.sin(w);
  for (const q of Q[settings.rolloff]) {
    const alpha = sw * (0.5 * (Math.exp(0.5 / q) - Math.exp(-0.5 / q)));
    const a0r = 1 / (1 + alpha);
    const b1 = settings.kind === 'lowpass' ? 1 - cw : -1 - cw;
    const b0 = settings.kind === 'lowpass' ? 0.5 * b1 : -0.5 * b1;
    const nb0 = a0r * b0;
    const nb1 = a0r * b1;
    const nb2 = a0r * b0;
    const a1 = a0r * (2 * cw);
    const a2 = a0r * (alpha - 1);
    let z1 = 0;
    let z2 = 0;
    const output = new Float32Array(source.length);
    for (let i = 0; i < source.length; i += 1) {
      const z0 = source[i] + a1 * z1 + a2 * z2;
      output[i] = z0 * nb0 + z1 * nb1 + z2 * nb2;
      z2 = z1;
      z1 = z0;
    }
    source = output;
  }
  return new Float32Array(source);
}

function signal(length: number, phase = 0): Float32Array {
  return Float32Array.from({ length }, (_, index) => (
    0.4 * Math.sin(index * 0.071 + phase)
    + 0.3 * Math.cos(index * 0.019 + phase * 0.5)
    + (index % 7 === 0 ? 0.2 : -0.05)
  ));
}

describe('Audacity High-pass / Low-pass official parameter contract', () => {
  it('uses the official 1000 Hz and 6 dB defaults', () => {
    expect(DEFAULT_PASS_FILTER_SETTINGS).toEqual({ kind: 'lowpass', frequencyHz: 1000, rolloff: 6 });
    expect(PASS_FILTER_ROLLOFFS).toEqual([6, 12, 24, 36, 48]);
  });

  it('creates zero biquads for 6 dB and the official cascade sizes for all steeper options', () => {
    for (const kind of PASS_FILTER_KINDS) {
      for (const rolloff of PASS_FILTER_ROLLOFFS) {
        const state = createPassFilterState({ kind, frequencyHz: 1000, rolloff }, 48000);
        expect(state.sections).toHaveLength(rolloff === 6 ? 0 : rolloff / 12);
        expect(state.sections.every((section) => section.z1 === 0 && section.z2 === 0)).toBe(true);
      }
    }
  });

  it.each([
    { frequencyHz: 0 }, { frequencyHz: 0.099 }, { frequencyHz: Number.NaN },
    { frequencyHz: Number.POSITIVE_INFINITY }, { frequencyHz: 24000 },
    { frequencyHz: 25000 }, { rolloff: 7 }, { rolloff: 0 }, { kind: 'bandpass' },
  ])('rejects invalid or unsupported parameters: %o', (patch) => {
    expect(() => validatePassFilterSettings({
      ...DEFAULT_PASS_FILTER_SETTINGS,
      ...patch,
    } as PassFilterSettings, 48000)).toThrow(RangeError);
  });

  it('accepts 0.1 Hz and frequencies strictly below, but not equal to, Nyquist', () => {
    expect(() => validatePassFilterSettings({ kind: 'lowpass', frequencyHz: 0.1, rolloff: 6 }, 48000)).not.toThrow();
    expect(() => validatePassFilterSettings({ kind: 'highpass', frequencyHz: 23999.99, rolloff: 48 }, 48000)).not.toThrow();
    expect(() => validatePassFilterSettings({ kind: 'highpass', frequencyHz: 24000, rolloff: 48 }, 48000)).toThrow(/Nyquist/);
    expect(() => validatePassFilterSettings(DEFAULT_PASS_FILTER_SETTINGS, 0)).toThrow(/采样率/);
  });
});

describe('Audacity High-pass / Low-pass sample-exact Nyquist oracle', () => {
  it.each(PASS_FILTER_KINDS.flatMap((kind) => PASS_FILTER_ROLLOFFS.map((rolloff) => ({ kind, rolloff }))))(
    'matches the independent official reference for $kind at $rolloff dB/octave',
    ({ kind, rolloff }) => {
      const settings: PassFilterSettings = { kind, frequencyHz: 731.25, rolloff };
      const input = signal(733, 0.31);
      expect(processPassFilter(input, settings, 48000)).toEqual(officialReference(input, settings, 48000));
    },
  );

  it('matches the independent oracle at 0.1 Hz and near Nyquist for every option', () => {
    const input = signal(65, 0.13).map((value) => value * 0.01);
    for (const sampleRate of [8000, 48000]) {
      for (const frequencyHz of [0.1, sampleRate / 2 - 0.25]) {
        for (const kind of PASS_FILTER_KINDS) {
          for (const rolloff of PASS_FILTER_ROLLOFFS) {
            const settings: PassFilterSettings = { kind, frequencyHz, rolloff };
            expect(processPassFilter(input, settings, sampleRate)).toEqual(
              officialReference(input, settings, sampleRate),
            );
          }
        }
      }
    }
  });

  it('keeps the one-pole high-pass as the complement of the matching low-pass', () => {
    const input = signal(257);
    const high = processPassFilter(input, { kind: 'highpass', frequencyHz: 900, rolloff: 6 }, 48000);
    const low = processPassFilter(input, { kind: 'lowpass', frequencyHz: 900, rolloff: 6 }, 48000);
    for (let i = 0; i < input.length; i += 1) expect(high[i] + low[i]).toBeCloseTo(input[i], 6);
  });

  it('matches whole-signal processing when stereo state is continued across arbitrary chunks', () => {
    for (const kind of PASS_FILTER_KINDS) {
      for (const rolloff of PASS_FILTER_ROLLOFFS) {
        const settings: PassFilterSettings = { kind, frequencyHz: 1200, rolloff };
        const left = signal(517), right = signal(517, 0.9);
        const expected = [officialReference(left, settings, 48000), officialReference(right, settings, 48000)];
        const states = [createPassFilterState(settings, 48000), createPassFilterState(settings, 48000)];
        const actual = [new Float32Array(left.length), new Float32Array(right.length)];
        for (const [start, end] of [[0, 1], [1, 127], [127, 128], [128, 319], [319, 517]]) {
          const chunk = processPassFilterChannels([
            left.slice(start, end), right.slice(start, end),
          ], settings, 48000, states);
          actual[0].set(chunk[0], start);
          actual[1].set(chunk[1], start);
        }
        expect(actual[0]).toEqual(expected[0]);
        expect(actual[1]).toEqual(expected[1]);
        expect(actual[0]).not.toEqual(actual[1]);
      }
    }
  });

  it('settles to unity DC gain for low-pass and zero DC gain for high-pass', () => {
    const input = new Float32Array(8192).fill(1);
    for (const rolloff of PASS_FILTER_ROLLOFFS) {
      expect(processPassFilter(input, { kind: 'lowpass', frequencyHz: 1000, rolloff }, 48000)[8191]).toBeCloseTo(1, 4);
      expect(processPassFilter(input, { kind: 'highpass', frequencyHz: 1000, rolloff }, 48000)[8191]).toBeCloseTo(0, 4);
    }
  });

  it('preserves sinusoids in the pass band instead of collapsing them to digital silence', () => {
    const sampleRate = 48000;
    const highInput = Float32Array.from({ length: sampleRate }, (_, i) => 0.5 * Math.sin(2 * Math.PI * 2000 * i / sampleRate));
    const lowInput = Float32Array.from({ length: sampleRate }, (_, i) => 0.5 * Math.sin(2 * Math.PI * 1000 * i / sampleRate));
    const tailRms = (input: Float32Array) => Math.sqrt(
      input.slice(sampleRate / 2).reduce((sum, value) => sum + value * value, 0) / (sampleRate / 2),
    );
    for (const rolloff of PASS_FILTER_ROLLOFFS) {
      const high = processPassFilter(highInput, { kind: 'highpass', frequencyHz: 100, rolloff }, sampleRate);
      const low = processPassFilter(lowInput, { kind: 'lowpass', frequencyHz: 8000, rolloff }, sampleRate);
      expect(tailRms(high) / tailRms(highInput)).toBeGreaterThan(0.99);
      expect(tailRms(low) / tailRms(lowInput)).toBeGreaterThan(0.99);
    }
  });

  it('does not mutate input, supports an empty chunk, and rejects invalid channel/state shapes', () => {
    const settings: PassFilterSettings = { kind: 'highpass', frequencyHz: 1000, rolloff: 24 };
    const input = signal(16);
    const snapshot = new Float32Array(input);
    const state = createPassFilterState(settings, 48000);
    expect(processPassFilter(new Float32Array(), settings, 48000, state)).toHaveLength(0);
    const output = processPassFilter(input, settings, 48000, state);
    expect(input).toEqual(snapshot);
    expect(output).not.toBe(input);
    expect(output.some((value, index) => value !== input[index])).toBe(true);
    expect(() => processPassFilterChannels([], settings, 48000)).toThrow(/至少/);
    expect(() => processPassFilterChannels([signal(3), signal(4)], settings, 48000)).toThrow(/等长/);
    expect(() => processPassFilterChannels([signal(3), signal(3)], settings, 48000, [createPassFilterState(settings, 48000)])).toThrow(/每个输入声道/);
  });

  it('rejects parameter/state mismatch and non-finite samples without changing state', () => {
    const settings: PassFilterSettings = { kind: 'lowpass', frequencyHz: 1000, rolloff: 36 };
    const state = createPassFilterState(settings, 48000);
    expect(() => processPassFilter(signal(4), { ...settings, rolloff: 48 }, 48000, state)).toThrow(/状态与当前参数/);
    expect(() => processPassFilter(Float32Array.of(1, Number.NaN), settings, 48000, state)).toThrow(/非有限/);
    expect(state.sections.every((section) => section.z1 === 0 && section.z2 === 0)).toBe(true);
  });
});
