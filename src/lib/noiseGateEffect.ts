// Audacity Nyquist Noise Gate: lookahead gating with hold and an optional crossover.
export const MAX_NOISE_GATE_TOTAL_SAMPLES = 20_000_000;

export interface NoiseGateSettings {
  stereoLink: boolean;
  thresholdDb: number;
  gateFreqKhz: number;
  levelReductionDb: number;
  attackMs: number;
  holdMs: number;
  decayMs: number;
}

export const DEFAULT_NOISE_GATE_SETTINGS: Readonly<NoiseGateSettings> = Object.freeze({
  stereoLink: true,
  thresholdDb: -40,
  gateFreqKhz: 0,
  levelReductionDb: -24,
  attackMs: 10,
  holdMs: 50,
  decayMs: 100,
});

function dbToLinear(value: number): number {
  if (value <= -96) return 0;
  return 10 ** (value / 20);
}

function onePoleLowPass(signal: Float32Array, cutoffHz: number, sampleRate: number): Float32Array {
  const output = new Float32Array(signal.length);
  const rc = 1 / (2 * Math.PI * cutoffHz);
  const dt = 1 / sampleRate;
  const alpha = dt / (rc + dt);
  let previous = 0;
  for (let i = 0; i < signal.length; i += 1) {
    previous += alpha * (signal[i] - previous);
    output[i] = previous;
  }
  return output;
}

function lowPass8(signal: Float32Array, cutoffHz: number, sampleRate: number): Float32Array {
  let output = signal;
  for (let stage = 0; stage < 8; stage += 1) {
    output = onePoleLowPass(output, cutoffHz, sampleRate);
  }
  return output instanceof Float32Array ? output : Float32Array.from(output);
}

export function validateNoiseGateSettings(settings: NoiseGateSettings): void {
  if (typeof settings.stereoLink !== 'boolean') {
    throw new RangeError('Noise Gate 立体声联动必须是布尔值');
  }
  const ranges: Array<[keyof NoiseGateSettings, number, number, string]> = [
    ['thresholdDb', -96, -6, '阈值'],
    ['gateFreqKhz', 0, 10, '门控频率'],
    ['levelReductionDb', -100, 0, '电平衰减'],
    ['attackMs', 1, 1000, '攻击时间'],
    ['holdMs', 0, 2000, '保持时间'],
    ['decayMs', 10, 4000, '衰减时间'],
  ];
  for (const [key, min, max, label] of ranges) {
    const value = settings[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
      throw new RangeError(`Noise Gate ${label}必须是 ${min} 至 ${max} 之间的有限数值`);
    }
  }
}

function validateInputs(channels: readonly Float32Array[], sampleRate: number): number {
  if (typeof sampleRate !== 'number' || !Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new RangeError('Noise Gate 采样率必须是正有限数值');
  }
  if (channels.length === 0) throw new RangeError('Noise Gate 至少需要一个声道');
  const length = channels[0].length;
  if (length < 100) throw new RangeError('Noise Gate 选区至少需要 100 个采样');
  for (const channel of channels) {
    if (channel.length !== length) throw new RangeError('Noise Gate 输入声道必须等长');
    for (let i = 0; i < length; i += 1) {
      if (!Number.isFinite(channel[i])) throw new RangeError(`Noise Gate 输入在第 ${i} 个采样包含非有限数值`);
    }
  }
  if (length * channels.length > MAX_NOISE_GATE_TOTAL_SAMPLES) {
    throw new RangeError('Noise Gate 选区超过 2000 万采样上限');
  }
  return length;
}

function createDetection(channels: readonly Float32Array[], stereoLink: boolean): Float32Array {
  const length = channels[0].length;
  const detection = new Float32Array(length);
  if (stereoLink && channels.length > 1) {
    for (let i = 0; i < length; i += 1) {
      detection[i] = Math.max(...channels.map((channel) => Math.abs(channel[i])));
    }
  } else {
    detection.set(channels[0].map((value) => Math.abs(value)));
  }
  return detection;
}

export function createNoiseGateEnvelope(
  channels: readonly Float32Array[],
  settings: NoiseGateSettings,
  sampleRate: number,
): Float32Array {
  validateNoiseGateSettings(settings);
  const length = validateInputs(channels, sampleRate);
  const threshold = dbToLinear(settings.thresholdDb);
  const floor = dbToLinear(settings.levelReductionDb);
  const detection = createDetection(channels, settings.stereoLink);
  const attackSamples = Math.max(1, Math.round((settings.attackMs / 1000) * sampleRate));
  const holdSamples = Math.round((settings.holdMs / 1000) * sampleRate);
  const decaySamples = Math.max(1, Math.round((settings.decayMs / 1000) * sampleRate));
  const envelope = new Float32Array(length).fill(floor);
  const silence = floor === 0;
  const attackBase = Math.exp(-1 / attackSamples);
  const decayBase = Math.exp(-1 / decaySamples);

  let openStart = -1;
  let holdRemaining = 0;
  for (let i = 0; i <= length; i += 1) {
    const above = i < length && detection[i] >= threshold;
    if (above) {
      if (openStart < 0) openStart = i;
      holdRemaining = holdSamples;
    } else if (openStart >= 0) {
      holdRemaining -= 1;
      if (holdRemaining < 0 || i === length) {
        const regionEnd = i;
        const rampStart = Math.max(0, openStart - attackSamples);
        for (let j = rampStart; j < openStart && j < length; j += 1) {
          const phase = (j - rampStart) / Math.max(1, openStart - rampStart);
          envelope[j] = silence ? floor + phase : floor + (1 - floor) * (1 - attackBase ** ((1 - phase) * attackSamples));
        }
        envelope.fill(1, openStart, Math.min(length, regionEnd));
        for (let j = regionEnd; j < Math.min(length, regionEnd + decaySamples); j += 1) {
          const phase = (j - regionEnd) / decaySamples;
          envelope[j] = silence ? 1 - phase : floor + (1 - floor) * decayBase ** ((j - regionEnd) + 1);
        }
        openStart = -1;
        holdRemaining = 0;
      }
    }
  }
  return envelope;
}

export function processNoiseGateChannels(
  channels: readonly Float32Array[],
  settings: NoiseGateSettings,
  sampleRate: number,
): Float32Array[] {
  validateNoiseGateSettings(settings);
  const length = validateInputs(channels, sampleRate);
  const output = channels.map(() => new Float32Array(length));
  const cutoff = settings.gateFreqKhz * 1000;

  channels.forEach((channel, channelIndex) => {
    const linkedEnvelope = settings.stereoLink && channels.length > 1
      ? createNoiseGateEnvelope(channels, settings, sampleRate)
      : createNoiseGateEnvelope([channel], settings, sampleRate);
    if (cutoff > 20) {
      const low = lowPass8(channel, cutoff * 0.91, sampleRate);
      const highFiltered = lowPass8(channel, cutoff, sampleRate);
      const highPass = Float32Array.from(channel, (value, i) => value - highFiltered[i]);
      for (let i = 0; i < length; i += 1) {
        output[channelIndex][i] = low[i] + highPass[i] * linkedEnvelope[i];
      }
    } else {
      for (let i = 0; i < length; i += 1) output[channelIndex][i] = channel[i] * linkedEnvelope[i];
    }
  });

  output.forEach((channel) => {
    for (let i = 0; i < length; i += 1) {
      if (!Number.isFinite(channel[i])) throw new RangeError(`Noise Gate 在第 ${i} 个采样产生非有限输出`);
    }
  });
  return output;
}
