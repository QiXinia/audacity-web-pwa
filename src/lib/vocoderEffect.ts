export const VOCODER_OUTPUT_CHOICES = ['bothChannels', 'rightOnly'] as const;

export type VocoderOutputChoice = typeof VOCODER_OUTPUT_CHOICES[number];

export interface VocoderSettings {
  distance: number;
  outputChoice: VocoderOutputChoice;
  bandCount: number;
  carrierWavePercent: number;
  whiteNoisePercent: number;
  radarNeedlesPercent: number;
  radarNeedlesFrequencyHz: number;
}

export const DEFAULT_VOCODER_SETTINGS: Readonly<VocoderSettings> = Object.freeze({
  distance: 20,
  outputChoice: 'bothChannels',
  bandCount: 40,
  carrierWavePercent: 100,
  whiteNoisePercent: 0,
  radarNeedlesPercent: 0,
  radarNeedlesFrequencyHz: 30,
});

export const MAX_VOCODER_TOTAL_SAMPLES = 20_000_000;

interface BandpassState {
  x1: number;
  x2: number;
  y1: number;
  y2: number;
}

function createBandpassState(): BandpassState {
  return { x1: 0, x2: 0, y1: 0, y2: 0 };
}

function bandpassCoefficients(sampleRate: number, frequency: number, q: number) {
  const omega = (2 * Math.PI * frequency) / sampleRate;
  const sin = Math.sin(omega);
  const cos = Math.cos(omega);
  const alpha = sin / (2 * q);
  const scale = 1 / (1 + alpha);
  return {
    b0: alpha * scale,
    b1: 0,
    b2: -alpha * scale,
    a1: -2 * cos * scale,
    a2: (1 - alpha) * scale,
  };
}

function applyBandpass(state: BandpassState, input: number, coefficients: ReturnType<typeof bandpassCoefficients>): number {
  const output = coefficients.b0 * input
    + coefficients.b1 * state.x1
    + coefficients.b2 * state.x2
    - coefficients.a1 * state.y1
    - coefficients.a2 * state.y2;
  state.x2 = state.x1;
  state.x1 = input;
  state.y2 = state.y1;
  state.y1 = output;
  return output;
}

function nextFrequencyHz(frequency: number, semitones: number): number {
  return frequency * Math.pow(2, semitones / 12);
}

function validateFinitePercent(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new RangeError(`${label}必须是 0–100 之间的有限数值`);
  }
}

export function validateVocoderSettings(settings: VocoderSettings): void {
  if (!Number.isFinite(settings.distance) || settings.distance < 1 || settings.distance > 120) {
    throw new RangeError('Distance 必须在 1–120 之间');
  }
  if (!VOCODER_OUTPUT_CHOICES.includes(settings.outputChoice)) {
    throw new RangeError('Vocoder 输出选择无效');
  }
  if (!Number.isSafeInteger(settings.bandCount) || settings.bandCount < 10 || settings.bandCount > 240) {
    throw new RangeError('Vocoder 频带数量必须是 10–240 之间的整数');
  }
  validateFinitePercent(settings.carrierWavePercent, '载波振幅');
  validateFinitePercent(settings.whiteNoisePercent, '白噪声振幅');
  validateFinitePercent(settings.radarNeedlesPercent, '雷达脉冲振幅');
  if (!Number.isFinite(settings.radarNeedlesFrequencyHz)
    || settings.radarNeedlesFrequencyHz < 1
    || settings.radarNeedlesFrequencyHz > 100) {
    throw new RangeError('雷达脉冲频率必须在 1–100 Hz 之间');
  }
}

function validateInputs(channels: readonly Float32Array[], sampleRate: number): number {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new RangeError('采样率必须是大于零的有限数值');
  }
  if (channels.length !== 1 && channels.length !== 2) {
    throw new RangeError('Vocoder 仅支持单声道或双声道轨道');
  }
  const length = channels[0]?.length ?? 0;
  if (length <= 0) throw new RangeError('Vocoder 输入不能为空');
  if (channels.some((channel) => channel.length !== length)) {
    throw new RangeError('Vocoder 输入声道必须等长');
  }
  if (length > MAX_VOCODER_TOTAL_SAMPLES) {
    throw new RangeError('Vocoder 处理采样数超过 20,000,000 上限');
  }
  return length;
}

function makeMonoCarrier(length: number, sampleRate: number, settings: VocoderSettings, frequencies: readonly number[]): Float32Array {
  const trackVolume = Math.sqrt(settings.carrierWavePercent / 100);
  const noiseVolume = Math.pow(settings.whiteNoisePercent / 100, 2);
  const radarVolume = Math.sqrt(settings.radarNeedlesPercent / 100);
  if (trackVolume + noiseVolume + radarVolume === 0) {
    throw new RangeError('Vocoder 没有调制载波');
  }
  const carrier = new Float32Array(length);
  let seed = 0x9e3779b9;
  const radarPeriodSamples = Math.max(1, Math.round(sampleRate / settings.radarNeedlesFrequencyHz));

  for (let index = 0; index < length; index += 1) {
    let value = 0;
    if (trackVolume > 0) {
      let oscillatorSum = 0;
      for (const frequency of frequencies) {
        oscillatorSum += Math.sin(2 * Math.PI * frequency * index / sampleRate);
      }
      value += trackVolume * (0.5 * oscillatorSum / frequencies.length);
    }
    if (noiseVolume > 0) {
      seed = (seed + 0x6d2b79f5) | 0;
      const random = ((seed >>> 0) / 4294967296) * 2 - 1;
      value += noiseVolume * random;
    }
    if (radarVolume > 0 && index % radarPeriodSamples === 0) {
      value += radarVolume;
    }
    carrier[index] = value;
  }
  return carrier;
}

function envelopeOnePole(input: number, previous: number, coefficient: number): number {
  return previous + coefficient * (input - previous);
}

function normalizePeak(channels: Float32Array[]): void {
  let peak = 0;
  const limit = Math.min(10_000_000, channels[0]?.length ?? 0);
  for (const channel of channels) {
    for (let index = 0; index < limit; index += 1) {
      peak = Math.max(peak, Math.abs(channel[index]));
    }
  }
  if (peak === 0 || !Number.isFinite(peak)) throw new RangeError('Vocoder 输出峰值无效，无法归一化');
  const gain = 1 / peak;
  for (const channel of channels) {
    for (let index = 0; index < channel.length; index += 1) channel[index] *= gain;
  }
}

export function processVocoderChannels(
  channels: readonly Float32Array[],
  settings: VocoderSettings,
  sampleRate: number,
): Float32Array[] {
  validateVocoderSettings(settings);
  const length = validateInputs(channels, sampleRate);
  const modulator = channels[0];
  const octaves = Math.log((sampleRate / 2.205) / 20) / Math.log(2);
  const interval = (octaves * 12) / settings.bandCount;
  const q = Math.sqrt(2) / (octaves / settings.bandCount);
  const frequencies: number[] = [];
  let frequency = nextFrequencyHz(20, interval / 2);
  for (let index = 0; index < settings.bandCount; index += 1) {
    frequencies.push(frequency);
    frequency = nextFrequencyHz(frequency, interval);
  }
  const carrierInput = channels.length === 2
    ? Float32Array.from(channels[1])
    : makeMonoCarrier(length, sampleRate, settings, frequencies);
  const result = new Float32Array(length);
  const envelopeMemory = Array.from({ length: 8 }, () => 0);

  for (let bandIndex = 0; bandIndex < settings.bandCount; bandIndex += 1) {
    const bandFrequency = frequencies[bandIndex];
    const modulatorFilter = createBandpassState();
    const carrierFilter = createBandpassState();
    const coefficients = bandpassCoefficients(sampleRate, bandFrequency, q);
    const envelopeCutoff = Math.max(1, bandFrequency / settings.distance);
    const envelopeCoefficient = 1 - Math.exp(-2 * Math.PI * envelopeCutoff / sampleRate);

    for (let index = 0; index < length; index += 1) {
      const modulatedBand = applyBandpass(modulatorFilter, modulator[index], coefficients);
      let envelope = Math.abs(modulatedBand);
      for (let pole = 0; pole < envelopeMemory.length; pole += 1) {
        envelope = envelopeOnePole(envelope, envelopeMemory[pole], envelopeCoefficient);
        envelopeMemory[pole] = envelope;
      }
      const carrierBand = applyBandpass(carrierFilter, carrierInput[index], coefficients);
      result[index] += envelope * carrierBand;
    }
  }

  normalizePeak([result]);
  return channels.length === 2 && settings.outputChoice === 'bothChannels'
    ? [Float32Array.from(channels[0]), result]
    : [result];
}
