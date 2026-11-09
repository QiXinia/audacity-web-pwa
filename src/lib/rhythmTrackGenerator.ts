import { midiToHz } from '@/lib/pluckGenerator';

/**
 * Audacity master share/nyquist-plug-ins/rhythmtrack.ny timing and control contract.
 * Click synthesis follows the same oscillator/filter/envelope structure, but the
 * Nyquist biquad and jcrev primitives are browser-side adaptations, not golden audio.
 */

export const RHYTHM_DEFAULT_TEMPO = 120;
export const RHYTHM_DEFAULT_BEATS_PER_BAR = 4;
export const RHYTHM_DEFAULT_BARS = 16;
export const RHYTHM_DEFAULT_STRONG_MIDI = 84;
export const RHYTHM_DEFAULT_WEAK_MIDI = 80;
export const RHYTHM_MIN_MIDI = 18;
export const RHYTHM_MAX_MIDI = 116;
export const RHYTHM_MAX_RENDER_SAMPLES = 50_000_000;

export const RHYTHM_CLICK_TYPES = [
  'metronome',
  'pingShort',
  'pingLong',
  'cowbell',
  'resonantNoise',
  'noiseClick',
  'dripShort',
  'dripLong',
] as const;

export type RhythmClickType = typeof RHYTHM_CLICK_TYPES[number];

export interface RhythmTrackRequest {
  tempo: number;
  beatsPerBar: number;
  swing: number;
  bars: number;
  duration: number;
  offset: number;
  clickType: RhythmClickType;
  strongMidi: number;
  weakMidi: number;
  sampleRate: number;
  /** Deterministic tests only; production may supply a crypto-random seed. */
  seed?: number;
}

export interface RhythmBeat {
  time: number;
  accent: boolean;
}

export interface RhythmTrackPlan {
  beatLength: number;
  measureDuration: number;
  barCount: number;
  clickTrackDuration: number;
  duration: number;
  offsetSamples: number;
  clickTrackSampleCount: number;
  sampleCount: number;
  beats: RhythmBeat[];
}

export interface RhythmTrackResult extends RhythmTrackPlan {
  samples: Float32Array;
}

function assertFiniteRange(value: number, min: number, max: number, label: string): void {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new RangeError(`${label} must be between ${min} and ${max}`);
  }
}

function assertMidi(value: number, label: string): void {
  if (!Number.isInteger(value) || value < RHYTHM_MIN_MIDI || value > RHYTHM_MAX_MIDI) {
    throw new RangeError(`${label} must be an integer from ${RHYTHM_MIN_MIDI}–${RHYTHM_MAX_MIDI}`);
  }
}

export function getRhythmTrackPlan(request: RhythmTrackRequest): RhythmTrackPlan {
  const {
    tempo, beatsPerBar, swing, bars, duration, offset, clickType,
    strongMidi, weakMidi, sampleRate,
  } = request;
  assertFiniteRange(tempo, 30, 300, 'Tempo');
  if (!Number.isInteger(beatsPerBar) || beatsPerBar < 1 || beatsPerBar > 20) {
    throw new RangeError('Beats per bar must be an integer from 1–20');
  }
  assertFiniteRange(swing, -1, 1, 'Swing');
  if (!Number.isInteger(bars) || bars < 0 || bars > 1000) {
    throw new RangeError('Number of bars must be an integer from 0–1000');
  }
  if (!Number.isFinite(duration) || duration < 0) {
    throw new RangeError('Rhythm track duration must be zero or greater');
  }
  if (!Number.isFinite(offset) || offset < 0) {
    throw new RangeError('Start time offset must be zero or greater');
  }
  if (!RHYTHM_CLICK_TYPES.includes(clickType)) {
    throw new RangeError(`Unsupported Rhythm Track beat sound: ${String(clickType)}`);
  }
  assertMidi(strongMidi, 'Strong beat MIDI pitch');
  assertMidi(weakMidi, 'Weak beat MIDI pitch');
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new RangeError('Sample rate must be greater than zero');
  }
  if (request.seed !== undefined && !Number.isFinite(request.seed)) {
    throw new RangeError('Rhythm Track seed must be finite');
  }

  const beatLength = 60 / tempo;
  const measureDuration = beatsPerBar * beatLength;
  const barCount = bars === 0 ? Math.ceil(duration / measureDuration) : bars;
  if (barCount < 1) {
    throw new RangeError('Set either Number of bars or Rhythm track duration to greater than zero');
  }

  // get-measure() rounds each absolute bar end, which is equivalent to rounding
  // the final click-track end for the total allocation.
  const clickTrackSampleCount = Math.round(barCount * measureDuration * sampleRate);
  const offsetSamples = Math.round(offset * sampleRate);
  const sampleCount = clickTrackSampleCount + offsetSamples;
  if (!Number.isSafeInteger(sampleCount) || sampleCount < 1) {
    throw new RangeError('Rhythm Track must produce at least one sample');
  }
  if (sampleCount > RHYTHM_MAX_RENDER_SAMPLES) {
    throw new RangeError('Rhythm Track exceeds the browser render memory limit');
  }

  const beats: RhythmBeat[] = [];
  for (let bar = 0; bar < barCount; bar += 1) {
    const barStart = bar * measureDuration;
    beats.push({ time: barStart, accent: true });
    for (let count = 0; count < beatsPerBar - 1; count += 1) {
      const swingAdjustment = (swing / 3) * ((count + 1) % 2);
      beats.push({
        time: barStart + beatLength * (count + 1 + swingAdjustment),
        accent: false,
      });
    }
  }

  return {
    beatLength,
    measureDuration,
    barCount,
    clickTrackDuration: clickTrackSampleCount / sampleRate,
    duration: sampleCount / sampleRate,
    offsetSamples,
    clickTrackSampleCount,
    sampleCount,
    beats,
  };
}

interface RandomSource {
  next: () => number;
  state: () => number;
}

let defaultRandomState = 0x6d2b79f5;

function createRandomSource(seed: number): RandomSource {
  let state = (seed >>> 0) || 0x6d2b79f5;
  return {
    next: () => {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      state >>>= 0;
      return state / 0x80000000 - 1;
    },
    state: () => state,
  };
}

function normalize(samples: Float32Array, limit = samples.length): Float32Array {
  let peak = 0;
  const count = Math.min(samples.length, limit);
  for (let index = 0; index < count; index += 1) {
    peak = Math.max(peak, Math.abs(samples[index]));
  }
  if (peak > 0) {
    const scale = 1 / peak;
    for (let index = 0; index < samples.length; index += 1) samples[index] *= scale;
  }
  return samples;
}

function linearEnvelope(samples: Float32Array, amplitude: number, attack = 0.005): Float32Array {
  const denominator = Math.max(1, samples.length - 1);
  for (let index = 0; index < samples.length; index += 1) {
    const position = index / denominator;
    const edge = Math.min(1, position / attack, (1 - position) / attack);
    samples[index] *= amplitude * Math.max(0, edge);
  }
  return samples;
}

function exponentialEnvelope(
  samples: Float32Array,
  start: number,
  end: number,
  duration: number,
  sampleRate: number,
): void {
  for (let index = 0; index < samples.length; index += 1) {
    const time = index / sampleRate;
    if (time >= duration) {
      samples[index] = 0;
      continue;
    }
    const position = duration > 0 ? time / duration : 1;
    const gain = start > 0 && end > 0
      ? start * (end / start) ** position
      : start + (end - start) * position;
    samples[index] *= gain;
  }
}

function biquad(
  input: Float32Array,
  sampleRate: number,
  kind: 'lowpass' | 'highpass',
  frequency: number,
  q: number,
): Float32Array {
  const output = new Float32Array(input.length);
  const nyquistGuard = sampleRate * 0.49;
  const hz = Math.min(Math.max(frequency, 1), nyquistGuard);
  if (!(hz > 0) || !(sampleRate > 0)) return output;
  const omega = 2 * Math.PI * hz / sampleRate;
  const cosine = Math.cos(omega);
  const sine = Math.sin(omega);
  const alpha = sine / (2 * q);
  const a0 = 1 + alpha;
  let b0: number;
  let b1: number;
  let b2: number;
  if (kind === 'lowpass') {
    b0 = (1 - cosine) / 2;
    b1 = 1 - cosine;
    b2 = b0;
  } else {
    b0 = (1 + cosine) / 2;
    b1 = -(1 + cosine);
    b2 = b0;
  }
  const a1 = -2 * cosine;
  const a2 = 1 - alpha;
  b0 /= a0;
  b1 /= a0;
  b2 /= a0;
  const normalizedA1 = a1 / a0;
  const normalizedA2 = a2 / a0;
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let index = 0; index < input.length; index += 1) {
    const x0 = input[index];
    const y0 = b0 * x0 + b1 * x1 + b2 * x2 - normalizedA1 * y1 - normalizedA2 * y2;
    output[index] = y0;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
  }
  return output;
}

function ping(midi: number, amplitude: number, duration: number, sampleRate: number): Float32Array {
  const length = Math.max(1, Math.round(duration * sampleRate));
  const samples = new Float32Array(length);
  const hz = midiToHz(midi);
  for (let index = 0; index < length; index += 1) {
    samples[index] = Math.sin(2 * Math.PI * hz * index / sampleRate);
  }
  return linearEnvelope(samples, amplitude);
}

function filteredNoise(
  midi: number,
  amplitude: number,
  duration: number,
  q: number,
  sampleRate: number,
  random: RandomSource,
): Float32Array {
  const length = Math.max(1, Math.round(duration * sampleRate));
  const samples = new Float32Array(length);
  for (let index = 0; index < length; index += 1) samples[index] = random.next();
  const filtered = biquad(samples, sampleRate, 'lowpass', midiToHz(midi), q);
  normalize(filtered);
  return linearEnvelope(filtered, amplitude);
}

function drip(
  midi: number,
  amplitude: number,
  duration: number,
  sampleRate: number,
): Float32Array {
  const length = Math.max(1, Math.round(duration * sampleRate));
  const samples = new Float32Array(length);
  const pitch = midiToHz(midi);
  const maxHz = sampleRate / 2.1;
  const partials = [2.40483, 5.52008, 8.653, 11.8];
  const weights = [0.5, 0.25, 0.125, 0.0625];
  for (let index = 0; index < length; index += 1) {
    const time = index / sampleRate;
    let value = 0;
    for (let partial = 0; partial < partials.length; partial += 1) {
      const hz = Math.min(maxHz, partials[partial] * pitch);
      value += weights[partial] * Math.sin(2 * Math.PI * hz * time);
    }
    samples[index] = value * Math.exp(-time / 0.015);
  }
  const filtered = biquad(samples, sampleRate, 'lowpass', 440, Math.SQRT1_2);
  normalize(filtered);
  return linearEnvelope(filtered, amplitude);
}

function triangle(phase: number): number {
  return (2 / Math.PI) * Math.asin(Math.sin(2 * Math.PI * phase));
}

function cowbell(midi: number, sampleRate: number): Float32Array {
  const length = Math.max(1, Math.round(0.8 * sampleRate));
  const samples = new Float32Array(length);
  const hz = midiToHz(midi);
  const first = new Float32Array(length);
  const second = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    const phase = index / sampleRate;
    first[index] = triangle(hz * phase) * triangle(3.46 * hz * phase);
    second[index] = triangle(7.3 * hz * phase) * triangle(1.52 * hz * phase);
    samples[index] = first[index] + second[index];
  }
  exponentialEnvelope(first, 0.3, 0.0005, 0.8, sampleRate);
  exponentialEnvelope(second, 0.7, 0.01, 0.2, sampleRate);
  for (let index = 0; index < length; index += 1) {
    samples[index] = 0.8 * (first[index] + second[index]);
  }
  return samples;
}

function resampleLinear(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return input;
  const length = Math.max(1, Math.floor(input.length * toRate / fromRate));
  const output = new Float32Array(length);
  const ratio = fromRate / toRate;
  for (let index = 0; index < length; index += 1) {
    const position = index * ratio;
    const left = Math.min(input.length - 1, Math.floor(position));
    const right = Math.min(input.length - 1, left + 1);
    const fraction = position - left;
    output[index] = input[left] + (input[right] - input[left]) * fraction;
  }
  return output;
}

function metronomeTick(midi: number, amplitude: number, sampleRate: number): Float32Array {
  const sourceRate = 44100;
  const noiseLength = 300;
  const sourceLength = Math.round(0.2 * sourceRate) + noiseLength;
  const source = new Float32Array(sourceLength);
  let randomState = 1;
  for (let index = 0; index < noiseLength; index += 1) {
    randomState = (479 * randomState) % 997;
    source[index] = randomState / 500 - 1;
  }
  const firstBreakpoint = noiseLength / sourceRate;
  for (let index = 0; index < sourceLength; index += 1) {
    const time = index / sourceRate;
    const envelope = time <= firstBreakpoint
      ? 10 * (2 / 10) ** (time / firstBreakpoint)
      : Math.max(0, 2 * (1 - time) / (1 - firstBreakpoint));
    source[index] *= envelope;
  }

  const hz = midiToHz(midi);
  let filtered = biquad(source, sourceRate, 'lowpass', 2 * hz, 6);
  for (let stage = 0; stage < 4; stage += 1) {
    filtered = biquad(filtered, sourceRate, 'highpass', hz, Math.SQRT1_2);
  }
  normalize(filtered, 300);
  for (let index = 0; index < filtered.length; index += 1) filtered[index] *= amplitude;

  // jcrev(0.01, 0.1): compact early-reflection adaptation before the 50 ms gate.
  const delay = Math.max(1, Math.round(0.01 * sourceRate));
  const reverberated = filtered.slice();
  for (let index = delay; index < reverberated.length; index += 1) {
    reverberated[index] += 0.1 * filtered[index - delay];
  }
  const gated = reverberated.slice(0, Math.max(1, Math.round(0.05 * sourceRate)));
  for (let index = 0; index < gated.length; index += 1) {
    const time = index / sourceRate;
    const envelope = time <= 0.02 ? 1.11 : Math.max(0, 1.11 * (0.05 - time) / 0.03);
    gated[index] *= envelope;
  }
  return resampleLinear(gated, sourceRate, sampleRate);
}

function renderClick(
  type: RhythmClickType,
  midi: number,
  amplitude: number,
  sampleRate: number,
  random: RandomSource,
): Float32Array {
  switch (type) {
    case 'metronome': return metronomeTick(midi, amplitude, sampleRate);
    case 'pingShort': return ping(midi, amplitude, 0.01, sampleRate);
    case 'pingLong': return ping(midi, amplitude, 0.08, sampleRate);
    case 'cowbell': return cowbell(midi, sampleRate);
    case 'resonantNoise': return filteredNoise(midi, amplitude, 0.05, 20, sampleRate, random);
    case 'noiseClick': return filteredNoise(midi, amplitude, 0.005, 2, sampleRate, random);
    case 'dripShort': return drip(midi, amplitude, 0.007, sampleRate);
    case 'dripLong': return drip(midi, amplitude, 0.1, sampleRate);
    default: throw new RangeError(`Unsupported Rhythm Track beat sound: ${String(type)}`);
  }
}

function mix(output: Float32Array, click: Float32Array, start: number): void {
  const first = Math.max(0, start);
  const count = Math.min(click.length, output.length - first);
  for (let index = 0; index < count; index += 1) output[first + index] += click[index];
}

export function generateRhythmTrack(request: RhythmTrackRequest): RhythmTrackResult {
  const plan = getRhythmTrackPlan(request);
  const random = createRandomSource(request.seed ?? defaultRandomState);
  const strong = renderClick(
    request.clickType,
    request.strongMidi,
    0.75,
    request.sampleRate,
    random,
  );
  const weak = renderClick(
    request.clickType,
    request.weakMidi,
    0.5,
    request.sampleRate,
    random,
  );
  if (request.seed === undefined) defaultRandomState = random.state();

  const samples = new Float32Array(plan.sampleCount);
  for (const beat of plan.beats) {
    const start = plan.offsetSamples + Math.round(beat.time * request.sampleRate);
    mix(samples, beat.accent ? strong : weak, start);
  }
  return { ...plan, samples };
}
