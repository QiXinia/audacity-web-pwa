export type NoiseType = 'white' | 'pink' | 'brownian';

export interface NoiseSettings {
  type: NoiseType;
  amplitude: number;
  duration: number;
  sampleRate: number;
  /** Supply a seed for deterministic renders and regression tests. */
  seed?: number;
}

export type NoiseRequest = Pick<NoiseSettings, 'type' | 'amplitude' | 'duration'>;

const DEFAULT_SEED = 0x6d2b79f5;

/**
 * Deterministic xorshift32 source mapped to [-1, 1). Audacity uses rand();
 * the explicit seed makes the same DSP equations reproducible in this port.
 */
function createWhiteSource(seed: number): () => number {
  let state = (seed >>> 0) || DEFAULT_SEED;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x80000000 - 1;
  };
}

/**
 * Audacity NoiseGenerator's white, Paul Kellet pink and Brownian equations.
 * Source: audacity/audacity src/effects/builtin_collection/noisegen/noisegenerator.cpp
 */
export function generateNoise({
  type,
  amplitude,
  duration,
  sampleRate,
  seed = DEFAULT_SEED,
}: NoiseSettings): Float32Array {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new RangeError('Sample rate must be greater than zero');
  }
  if (!Number.isFinite(amplitude) || amplitude < 0 || amplitude > 1) {
    throw new RangeError('Amplitude must be between 0 and 1');
  }
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new RangeError('Duration must be greater than zero');
  }

  const length = Math.round(duration * sampleRate);
  if (!Number.isSafeInteger(length) || length < 1) {
    throw new RangeError('Duration must produce at least one sample');
  }

  const nextWhite = createWhiteSource(seed);
  const output = new Float32Array(length);

  if (type === 'white') {
    for (let i = 0; i < length; i += 1) {
      output[i] = amplitude * nextWhite();
    }
    return output;
  }

  if (type === 'pink') {
    const pinkAmplitude = amplitude * 0.129;
    let buf0 = 0;
    let buf1 = 0;
    let buf2 = 0;
    let buf3 = 0;
    let buf4 = 0;
    let buf5 = 0;
    let buf6 = 0;
    for (let i = 0; i < length; i += 1) {
      const white = nextWhite();
      buf0 = 0.99886 * buf0 + 0.0555179 * white;
      buf1 = 0.99332 * buf1 + 0.0750759 * white;
      buf2 = 0.969 * buf2 + 0.153852 * white;
      buf3 = 0.8665 * buf3 + 0.3104856 * white;
      buf4 = 0.55 * buf4 + 0.5329522 * white;
      buf5 = -0.7616 * buf5 - 0.016898 * white;
      output[i] = pinkAmplitude * (
        buf0 + buf1 + buf2 + buf3 + buf4 + buf5 + buf6 + white * 0.5362
      );
      buf6 = white * 0.115926;
    }
    return output;
  }

  if (type === 'brownian') {
    const leakage = Math.min((sampleRate - 144) / sampleRate, 0.9999);
    const scaling = Math.max(9 / Math.sqrt(sampleRate), 0.01);
    let y = 0;
    for (let i = 0; i < length; i += 1) {
      const white = nextWhite();
      const z = leakage * y + white * scaling;
      y = Math.abs(z) > 1 ? leakage * y - white * scaling : z;
      output[i] = amplitude * y;
    }
    return output;
  }

  throw new RangeError(`Unsupported noise type: ${String(type)}`);
}
