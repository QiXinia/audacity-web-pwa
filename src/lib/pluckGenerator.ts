/**
 * Audacity 3.7.3 lib-src/libnyquist/nyquist/tran/pluck.c and
 * share/nyquist-plug-ins/pluck.ny algorithm contract.
 *
 * The official primitive uses a ±1 LCG excitation, mean removal, a four-tap
 * delay line, pitch-dependent decay, and final peak normalization to 0.8.
 * An explicit seed makes the same DSP reproducible without global RNG state.
 */

export const PLUCK_DEFAULT_MIDI = 60;
export const PLUCK_MIN_MIDI = 1;
export const PLUCK_MAX_MIDI = 120;
export const PLUCK_MAX_DURATION = 60;
export const PLUCK_PEAK = 0.8;

const MAX_DELAY_LENGTH = 20000;
let defaultRandomState = 1;

export type PluckFade = 'abrupt' | 'gradual';

export interface PluckRequest {
  midi: number;
  fade: PluckFade;
  duration: number;
  sampleRate: number;
  seed?: number;
}

export function midiToHz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

export function isPluckMidiSupported(midi: number, sampleRate: number): boolean {
  if (
    !Number.isInteger(midi)
    || midi < PLUCK_MIN_MIDI
    || midi > PLUCK_MAX_MIDI
    || !Number.isFinite(sampleRate)
    || sampleRate <= 0
  ) return false;
  const hz = midiToHz(midi);
  return hz > sampleRate / MAX_DELAY_LENGTH && hz < sampleRate / 3;
}

function validateRequest(request: PluckRequest): { hz: number; sampleCount: number; finalAmp: number } {
  const { midi, fade, duration, sampleRate } = request;
  if (!isPluckMidiSupported(midi, sampleRate)) {
    throw new RangeError(`Pluck MIDI pitch must be an integer from ${PLUCK_MIN_MIDI}–${PLUCK_MAX_MIDI} and supported by the sample rate`);
  }
  if (!Number.isFinite(duration) || duration <= 0 || duration > PLUCK_MAX_DURATION) {
    throw new RangeError(`Pluck duration must be greater than zero and at most ${PLUCK_MAX_DURATION} seconds`);
  }
  const sampleCount = Math.round(duration * sampleRate);
  if (sampleCount < 1) throw new RangeError('Pluck duration must contain at least one sample');
  if (fade !== 'abrupt' && fade !== 'gradual') throw new RangeError('Unknown Pluck fade type');
  return {
    hz: midiToHz(midi),
    sampleCount,
    finalAmp: fade === 'gradual' ? 0.001 : 0.000001,
  };
}

export function generatePluck(request: PluckRequest): Float32Array {
  const { sampleRate, seed } = request;
  if (seed !== undefined && !Number.isFinite(seed)) throw new RangeError('Pluck seed must be finite');
  const { hz, sampleCount, finalAmp } = validateRequest(request);

  // pluck_parameters(): all parameter equations intentionally remain double precision.
  const t = Math.PI * (hz / sampleRate);
  const y = Math.abs(Math.cos(t));
  const lf = -Math.log(finalAmp);
  const naturalDecay = -lf / (hz * Math.log(y));
  const stretchedDuration = hz * request.duration;
  let stretch: number;
  let loss: number;
  if (request.duration < naturalDecay) {
    loss = Math.exp(-lf / stretchedDuration) / y;
    stretch = 0.5;
  } else {
    loss = 1;
    stretch = 0.5 + Math.sqrt(0.25 - (
      1 - Math.exp(2 * lf * (hz - sampleRate) / (stretchedDuration * sampleRate))
    ) / (2 - 2 * Math.cos(2 * t)));
  }

  const length = Math.trunc((sampleRate / hz) - stretch - 0.001);
  if (length <= 1) throw new RangeError('Pluck delay line is too short for this pitch and sample rate');
  const tuning = (sampleRate / hz) - length - stretch;
  const cons = (1 - tuning) / (1 + tuning);
  const x2 = -cons * (stretch - 1);
  const x3 = cons * stretch - stretch + 1;

  // krand(): unsigned 32-bit LCG, mapped to the official ±1 excitation.
  let randomState = seed === undefined ? defaultRandomState : seed >>> 0;
  const initial = new Float32Array(length);
  let initialSum = 0;
  for (let index = 0; index < length; index += 1) {
    randomState = (Math.imul(randomState, 1103515245) + 12345) >>> 0;
    const value = (((randomState >>> 16) & 0x7fff & 2) - 1);
    initial[index] = value;
    initialSum = Math.fround(initialSum + value);
  }
  if (seed === undefined) defaultRandomState = randomState;
  const average = Math.fround(initialSum / length);
  const shift = new Float32Array(length + 4);
  for (let index = 0; index < length; index += 1) {
    shift[index] = Math.fround(initial[index] - average);
  }

  let i1 = length + 1;
  let i2 = length;
  let i3 = length - 1;
  let i4 = length - 2;
  const end = length + 2;
  const samples = new Float32Array(sampleCount);
  let maxPeak = 0;

  for (let index = 0; index < sampleCount; index += 1) {
    const sum = Math.fround(
      shift[i1] * x2
      + shift[i2] * x3
      + shift[i3] * stretch
      - shift[i4] * cons,
    );
    i1 += 1;
    i2 += 1;
    i3 += 1;
    i4 += 1;
    if (i1 === end) i1 = 0;
    if (i2 === end) i2 = 0;
    if (i3 === end) i3 = 0;
    if (i4 === end) i4 = 0;
    shift[i4] = Math.fround(sum * loss);
    samples[index] = sum;
    maxPeak = Math.max(maxPeak, Math.abs(sum));
  }

  // pluck.ny: preserve a random zero-amplitude result instead of dividing by zero.
  if (maxPeak > 0) {
    const scale = PLUCK_PEAK / maxPeak;
    for (let index = 0; index < samples.length; index += 1) samples[index] *= scale;
  }
  return samples;
}
