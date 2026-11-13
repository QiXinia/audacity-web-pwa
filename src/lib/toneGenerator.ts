export type ToneWaveform = 'sine' | 'square' | 'sawtooth' | 'squareNoAlias' | 'triangle';
export type ToneChannelCount = 1 | 2;

export interface ToneSettings {
  waveform: ToneWaveform;
  frequency: number;
  amplitude: number;
  duration: number;
  sampleRate: number;
  channelCount: ToneChannelCount;
}

export type ToneRequest = Pick<
  ToneSettings,
  'waveform' | 'frequency' | 'amplitude' | 'duration' | 'channelCount'
>;

function fraction(value: number): number {
  return value - Math.floor(value);
}

/**
 * Generate one or two deterministic channels using Audacity's ToneGenBase
 * waveform equations. Frequency and amplitude are constant for Tone.
 */
export function generateToneChannels({
  waveform,
  frequency,
  amplitude,
  duration,
  sampleRate,
  channelCount,
}: ToneSettings): Float32Array[] {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new RangeError('Sample rate must be greater than zero');
  }
  if (channelCount !== 1 && channelCount !== 2) {
    throw new RangeError('Tone channel count must be 1 or 2');
  }
  if (!Number.isFinite(frequency) || frequency < 1 || frequency > sampleRate / 2) {
    throw new RangeError('Frequency must be between 1 Hz and the Nyquist frequency');
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

  const output = new Float32Array(length);
  const twoPi = 2 * Math.PI;
  const fourDivPi = 4 / Math.PI;
  const noAliasScale = (1 + Math.cos((twoPi * frequency) / sampleRate)) / fourDivPi;
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
        sample = fourDivPi * Math.sin(twoPi * phase);
        for (let harmonic = 3; harmonic < 200 && harmonic * frequency < sampleRate / 2; harmonic += 2) {
          const window = 1 + Math.cos((twoPi * harmonic * frequency) / sampleRate);
          sample += window * Math.sin(twoPi * phase * harmonic) / (noAliasScale * harmonic);
        }
        break;
      }
      default:
        throw new RangeError(`Unsupported waveform: ${String(waveform)}`);
    }

    output[i] = amplitude * sample;
    positionInCycles += frequency;
  }

  return Array.from({ length: channelCount }, () => output.slice());
}

export function generateTone(settings: ToneSettings): Float32Array {
  return generateToneChannels(settings)[0]!;
}
