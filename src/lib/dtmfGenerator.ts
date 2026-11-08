export const DTMF_DEFAULT_SEQUENCE = 'audacity';
export const DTMF_DEFAULT_DUTY_CYCLE = 55;
export const DTMF_DEFAULT_AMPLITUDE = 0.8;

export const DTMF_SYMBOLS = '0123456789*#ABCDabcdefghijklmnopqrstuvwxyz';
const DTMF_SYMBOL_SET = new Set(DTMF_SYMBOLS);
const FADE_IN_OUT_DIVISOR = 250;

export interface DtmfSettings {
  sequence: string;
  amplitude: number;
  dutyCycle: number;
  duration: number;
  sampleRate: number;
}

export type DtmfRequest = Pick<DtmfSettings, 'sequence' | 'amplitude' | 'dutyCycle' | 'duration'>;

export interface DtmfTiming {
  toneDuration: number;
  silenceDuration: number;
}

export function isValidDtmfSequence(sequence: string): boolean {
  return sequence.length > 0 && Array.from(sequence).every((symbol) => DTMF_SYMBOL_SET.has(symbol));
}

export function calculateDtmfTiming({
  sequence,
  duration,
  dutyCycle,
}: Pick<DtmfSettings, 'sequence' | 'duration' | 'dutyCycle'>): DtmfTiming {
  if (!isValidDtmfSequence(sequence)) {
    throw new RangeError('DTMF sequence must contain only 0-9, *, #, A-D, or a-z');
  }
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new RangeError('Duration must be greater than zero');
  }
  if (!Number.isFinite(dutyCycle) || dutyCycle < 0 || dutyCycle > 100) {
    throw new RangeError('Duty cycle must be between 0 and 100');
  }
  if (sequence.length === 1) return { toneDuration: duration, silenceDuration: 0 };

  // Audacity DtmfSettings::Recalculate: N tones have only N-1 silence slots.
  const slot = duration / (sequence.length + dutyCycle / 100 - 1);
  return {
    toneDuration: slot * (dutyCycle / 100),
    silenceDuration: slot * (1 - dutyCycle / 100),
  };
}

function frequencies(symbol: string): readonly [number, number] {
  let low = 0;
  let high = 0;

  if ('123Aabcdef'.includes(symbol)) low = 697;
  else if ('456Bghijklmno'.includes(symbol)) low = 770;
  else if ('789Cpqrstuvwxyz'.includes(symbol)) low = 852;
  else if ('*0#D'.includes(symbol)) low = 941;

  if ('147*ghipqrs'.includes(symbol)) high = 1209;
  else if ('2580abcjkltuv'.includes(symbol)) high = 1336;
  else if ('369#defmnowxyz'.includes(symbol)) high = 1477;
  else if ('ABCD'.includes(symbol)) high = 1633;

  if (!low || !high) throw new RangeError(`Unsupported DTMF symbol: ${symbol}`);
  return [low, high];
}

/** One complete Audacity MakeDtmfTone block, including both click-suppression fades. */
function makeDtmfTone(
  symbol: string,
  length: number,
  sampleRate: number,
  amplitude: number,
): Float32Array {
  const [low, high] = frequencies(symbol);
  const lowStep = 2 * Math.PI * low / sampleRate;
  const highStep = 2 * Math.PI * high / sampleRate;
  const output = new Float32Array(length);

  for (let index = 0; index < length; index += 1) {
    output[index] = amplitude * 0.5 * (Math.sin(lowStep * index) + Math.sin(highStep * index));
  }

  // Keep Audacity's floating-point loop bound and size_t offset conversion.
  const fadeLength = Math.min(length, sampleRate / FADE_IN_OUT_DIVISOR);
  for (let index = 0; index < fadeLength; index += 1) {
    output[index] *= index / fadeLength;
  }
  const fadeOutOffset = Math.trunc(length - fadeLength);
  for (let index = 0; index < fadeLength; index += 1) {
    output[index + fadeOutOffset] *= 1 - index / fadeLength;
  }
  return output;
}

/**
 * Generate one mono DTMF channel using Audacity 4's DtmfGenerator algorithm.
 * Source: audacity/audacity src/effects/builtin_collection/dtmfgen/dtmfgenerator.cpp.
 */
export function generateDtmf({
  sequence,
  amplitude,
  dutyCycle,
  duration,
  sampleRate,
}: DtmfSettings): Float32Array {
  if (!isValidDtmfSequence(sequence)) {
    throw new RangeError('DTMF sequence must contain only 0-9, *, #, A-D, or a-z');
  }
  if (!Number.isFinite(amplitude) || amplitude < 0 || amplitude > 1) {
    throw new RangeError('Amplitude must be between 0 and 1');
  }
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new RangeError('Sample rate must be greater than zero');
  }
  const length = Math.round(duration * sampleRate);
  if (!Number.isSafeInteger(length) || length < 1) {
    throw new RangeError('Duration must produce at least one sample');
  }

  const timing = calculateDtmfTiming({ sequence, duration, dutyCycle });
  const toneCount = sequence.length;
  let samplesPerTone = sequence.length === 1 ? length : Math.floor(timing.toneDuration * sampleRate);
  let samplesPerSilence = sequence.length === 1 ? 0 : Math.floor(timing.silenceDuration * sampleRate);
  let difference = length - toneCount * samplesPerTone - (toneCount - 1) * samplesPerSilence;

  // Audacity first distributes whole quotients, then one sample per block.
  while (difference > 2 * toneCount - 1) {
    if (toneCount === 1) break;
    samplesPerTone += Math.floor(difference / toneCount);
    samplesPerSilence += Math.floor(difference / (toneCount - 1));
    difference = length - toneCount * samplesPerTone - (toneCount - 1) * samplesPerSilence;
  }
  if (difference < 0) {
    throw new RangeError('DTMF timing produced more samples than the requested duration');
  }

  const output = new Float32Array(length);
  let outputOffset = 0;
  for (let block = 0; block < 2 * toneCount - 1; block += 1) {
    const isTone = block % 2 === 0;
    const extraSample = difference > 0 ? 1 : 0;
    difference -= 1;
    const blockLength = (isTone ? samplesPerTone : samplesPerSilence) + extraSample;
    if (blockLength === 0) continue;
    if (isTone) {
      output.set(
        makeDtmfTone(sequence[block / 2]!, blockLength, sampleRate, amplitude),
        outputOffset,
      );
    }
    outputOffset += blockLength;
  }
  if (outputOffset !== length) {
    throw new Error(`DTMF sample accounting mismatch: ${outputOffset} != ${length}`);
  }
  return output;
}
