import type { ToneWaveform } from './toneGenerator';

export type ChirpInterpolation = 'linear' | 'logarithmic';

export interface ChirpSettings {
  waveform: ToneWaveform;
  interpolation: ChirpInterpolation;
  startFrequency: number;
  endFrequency: number;
  startAmplitude: number;
  endAmplitude: number;
  duration: number;
  sampleRate: number;
}

export type ChirpRequest = Pick<
  ChirpSettings,
  | 'waveform'
  | 'interpolation'
  | 'startFrequency'
  | 'endFrequency'
  | 'startAmplitude'
  | 'endAmplitude'
  | 'duration'
>;

function fraction(value: number): number {
  return value - Math.floor(value);
}

/**
 * Generate one mono channel using Audacity ToneGenBase's Chirp equations.
 * Frequency and amplitude interpolate once per total output sample count, so
 * the final sample intentionally uses the (N - 1) / N interpolation position.
 *
 * Source: audacity/audacity au3/libraries/au3-builtin-effects/ToneGenBase.cpp
 */
export function generateChirp({
  waveform,
  interpolation,
  startFrequency,
  endFrequency,
  startAmplitude,
  endAmplitude,
  duration,
  sampleRate,
}: ChirpSettings): Float32Array {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new RangeError('Sample rate must be greater than zero');
  }
  if (!Number.isFinite(startFrequency) || startFrequency < 1 || startFrequency > sampleRate / 2) {
    throw new RangeError('Start frequency must be between 1 Hz and the Nyquist frequency');
  }
  if (!Number.isFinite(endFrequency) || endFrequency < 1 || endFrequency > sampleRate / 2) {
    throw new RangeError('End frequency must be between 1 Hz and the Nyquist frequency');
  }
  if (!Number.isFinite(startAmplitude) || startAmplitude < 0 || startAmplitude > 1) {
    throw new RangeError('Start amplitude must be between 0 and 1');
  }
  if (!Number.isFinite(endAmplitude) || endAmplitude < 0 || endAmplitude > 1) {
    throw new RangeError('End amplitude must be between 0 and 1');
  }
  if (interpolation !== 'linear' && interpolation !== 'logarithmic') {
    throw new RangeError(`Unsupported interpolation: ${String(interpolation)}`);
  }
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new RangeError('Duration must be greater than zero');
  }

  const length = Math.round(duration * sampleRate);
  if (!Number.isSafeInteger(length) || length < 1) {
    throw new RangeError('Duration must produce at least one sample');
  }

  const output = new Float32Array(length);
  const twoPi = 2 * Math.PI;
  const fourDivPi = 4 / Math.PI;
  const amplitudeQuantum = (endAmplitude - startAmplitude) / length;
  const startLogFrequency = Math.log10(startFrequency);
  const endLogFrequency = Math.log10(endFrequency);
  const frequencyQuantum = interpolation === 'logarithmic'
    ? (endLogFrequency - startLogFrequency) / length
    : (endFrequency - startFrequency) / length;
  let blendedAmplitude = startAmplitude;
  let blendedFrequency = startFrequency;
  let blendedLogFrequency = startLogFrequency;
  let positionInCycles = 0;

  for (let i = 0; i < length; i += 1) {
    const phase = positionInCycles / sampleRate;
    let sample = 0;

    switch (waveform) {
      case 'sine':
        sample = Math.sin(twoPi * phase);
        break;
      case 'square':
        sample = fraction(phase) < 0.5 ? 1 : -1;
        break;
      case 'sawtooth':
        sample = 2 * fraction(phase + 0.5) - 1;
        break;
      case 'triangle': {
        const cycle = fraction(phase);
        if (cycle < 0.25) sample = cycle * 4;
        else if (cycle > 0.75) sample = (cycle - 1) * 4;
        else sample = (0.5 - cycle) * 4;
        break;
      }
      case 'squareNoAlias': {
        const noAliasScale = (1 + Math.cos((twoPi * blendedFrequency) / sampleRate)) / fourDivPi;
        sample = fourDivPi * Math.sin(twoPi * phase);
        for (
          let harmonic = 3;
          harmonic < 200 && harmonic * blendedFrequency < sampleRate / 2;
          harmonic += 2
        ) {
          const window = 1 + Math.cos((twoPi * harmonic * blendedFrequency) / sampleRate);
          sample += window * Math.sin(twoPi * phase * harmonic) / (noAliasScale * harmonic);
        }
        break;
      }
      default:
        throw new RangeError(`Unsupported waveform: ${String(waveform)}`);
    }

    output[i] = blendedAmplitude * sample;
    positionInCycles += blendedFrequency;
    blendedAmplitude += amplitudeQuantum;
    if (interpolation === 'logarithmic') {
      blendedLogFrequency += frequencyQuantum;
      blendedFrequency = 10 ** blendedLogFrequency;
    } else {
      blendedFrequency += frequencyQuantum;
    }
  }

  return output;
}
