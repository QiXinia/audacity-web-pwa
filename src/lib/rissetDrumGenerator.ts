/**
 * Audacity master share/nyquist-plug-ins/rissetdrum.ny control and DSP contract.
 *
 * The enharmonic oscillator, centre-frequency noise modulation, percussion
 * envelopes and final peak normalization follow the plug-in structure. The
 * wavetable oscillator, white-noise source and lowpass6 primitive are direct
 * browser-side adaptations, not a claim of sample-exact Nyquist equivalence.
 * The percentage control is converted to a 0..1 mix as described by the UI.
 */

export const RISSET_DEFAULT_FREQUENCY = 100;
export const RISSET_DEFAULT_DECAY = 2;
export const RISSET_DEFAULT_CENTER_FREQUENCY = 500;
export const RISSET_DEFAULT_BANDWIDTH = 400;
export const RISSET_DEFAULT_NOISE_PERCENT = 25;
export const RISSET_DEFAULT_AMPLITUDE = 0.8;
export const RISSET_MAX_RENDER_SAMPLES = 50_000_000;

export interface RissetDrumRequest {
  frequency: number;
  decay: number;
  centerFrequency: number;
  bandwidth: number;
  noisePercent: number;
  amplitude: number;
  sampleRate: number;
  /** Deterministic tests only; production may supply a crypto-random seed. */
  seed?: number;
}

export interface RissetDrumPlan {
  sampleCount: number;
  duration: number;
  enharmonicDecay: number;
}

export interface RissetDrumResult extends RissetDrumPlan {
  samples: Float32Array;
  peak: number;
}

function assertFiniteRange(value: number, min: number, max: number, label: string): void {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new RangeError(`${label} must be between ${min} and ${max}`);
  }
}

export function getRissetDrumPlan(request: RissetDrumRequest): RissetDrumPlan {
  assertFiniteRange(request.frequency, 50, 2000, 'Frequency');
  assertFiniteRange(request.decay, 0.1, 60, 'Decay');
  assertFiniteRange(request.centerFrequency, 100, 5000, 'Noise center frequency');
  assertFiniteRange(request.bandwidth, 10, 1000, 'Noise bandwidth');
  assertFiniteRange(request.noisePercent, 0, 100, 'Noise mix');
  assertFiniteRange(request.amplitude, 0, 1, 'Amplitude');
  if (!Number.isFinite(request.sampleRate) || request.sampleRate <= 0) {
    throw new RangeError('Sample rate must be greater than zero');
  }
  if (request.seed !== undefined && !Number.isFinite(request.seed)) {
    throw new RangeError('Risset Drum seed must be finite');
  }

  const sampleCount = Math.round(request.decay * request.sampleRate);
  if (!Number.isSafeInteger(sampleCount) || sampleCount < 1) {
    throw new RangeError('Risset Drum must produce at least one sample');
  }
  if (sampleCount > RISSET_MAX_RENDER_SAMPLES) {
    throw new RangeError('Risset Drum exceeds the browser render memory limit');
  }
  return {
    sampleCount,
    duration: sampleCount / request.sampleRate,
    enharmonicDecay: request.decay * 0.5,
  };
}

let defaultRandomState = 0x51f15eed;

function createRandomSource(seed: number): { next: () => number; state: () => number } {
  let state = (seed >>> 0) || 0x51f15eed;
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

function percussionEnvelope(time: number, duration: number): number {
  if (time >= duration) return 0;
  // percussion-env(): half-life = 2^(log2(duration)-3) = duration/8.
  return 2 ** (-time / (duration / 8));
}

export function generateRissetDrum(request: RissetDrumRequest): RissetDrumResult {
  const plan = getRissetDrumPlan(request);
  const random = createRandomSource(request.seed ?? defaultRandomState);
  const samples = new Float32Array(plan.sampleCount);
  const noiseMix = request.noisePercent / 100;
  const toneGain = 1 - noiseMix;
  const lowNote = request.frequency * 0.1;
  const harmonics = [10, 16, 22, 23] as const;
  const weights = [1, 1.5, 2, 1.5] as const;
  const filterAlpha = 1 - Math.exp(-2 * Math.PI * request.bandwidth / request.sampleRate);
  let filteredNoise = 0;
  let unnormalizedPeak = 0;

  for (let index = 0; index < samples.length; index += 1) {
    const time = index / request.sampleRate;
    let enharmonic = 0;
    let noiseBand = 0;
    if (time < plan.enharmonicDecay) {
      let table = 0;
      for (let partial = 0; partial < harmonics.length; partial += 1) {
        const hz = lowNote * harmonics[partial];
        table += weights[partial] * Math.sin(2 * Math.PI * hz * time);
      }
      enharmonic = toneGain * 0.17 * table;
      filteredNoise += filterAlpha * (random.next() - filteredNoise);
      noiseBand = noiseMix
        * Math.sin(2 * Math.PI * request.centerFrequency * time)
        * filteredNoise;
    }
    const fundamental = toneGain
      * percussionEnvelope(time, request.decay)
      * Math.sin(2 * Math.PI * request.frequency * time);
    const value = percussionEnvelope(time, plan.enharmonicDecay)
      * (noiseBand + enharmonic) + fundamental;
    samples[index] = value;
    unnormalizedPeak = Math.max(unnormalizedPeak, Math.abs(value));
  }

  if (request.seed === undefined) defaultRandomState = random.state();
  if (unnormalizedPeak > 0 && request.amplitude > 0) {
    const scale = request.amplitude / unnormalizedPeak;
    for (let index = 0; index < samples.length; index += 1) samples[index] *= scale;
  } else if (request.amplitude === 0) {
    samples.fill(0);
  }

  let peak = 0;
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
  return { ...plan, samples, peak };
}
