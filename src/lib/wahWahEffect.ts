export interface WahWahSettings {
  frequencyHz: number;
  phaseDegrees: number;
  depthPercent: number;
  resonance: number;
  frequencyOffsetPercent: number;
  outputGainDb: number;
}

export const DEFAULT_WAH_WAH_SETTINGS: Readonly<WahWahSettings> = Object.freeze({
  frequencyHz: 1.5,
  phaseDegrees: 0,
  depthPercent: 70,
  resonance: 2.5,
  frequencyOffsetPercent: 30,
  outputGainDb: -6,
});

const LFO_SKIP_SAMPLES = 30;

function assertRange(value: number, minimum: number, maximum: number, label: string): void {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new RangeError(`${label}必须在 ${minimum}–${maximum} 之间`);
  }
}

export function validateWahWahSettings(settings: WahWahSettings): void {
  assertRange(settings.frequencyHz, 0.1, 4, 'LFO 频率');
  assertRange(settings.phaseDegrees, 0, 360, 'LFO 起始相位');
  assertRange(settings.depthPercent, 0, 100, '深度');
  assertRange(settings.resonance, 0.1, 10, '谐振');
  assertRange(settings.frequencyOffsetPercent, 0, 100, 'Wah 频率偏移');
  assertRange(settings.outputGainDb, -30, 30, '输出增益');
}

/**
 * Audacity 4.0.2 WahWahBase::InstanceProcess, with one independent state per
 * channel. Coefficients are refreshed every 30 samples; output gain is applied
 * after updating the un-gained recursive history, exactly as upstream does.
 */
export function processWahWah(
  input: Float32Array,
  settings: WahWahSettings,
  sampleRate: number,
): Float32Array {
  validateWahWahSettings(settings);
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new RangeError('采样率必须是大于零的有限数值');
  }

  const output = new Float32Array(input.length);
  const lfoSkip = settings.frequencyHz * 2 * Math.PI / sampleRate;
  const depth = settings.depthPercent / 100;
  const frequencyOffset = settings.frequencyOffsetPercent / 100;
  const phase = settings.phaseDegrees * Math.PI / 180;
  const outputGain = 10 ** (settings.outputGainDb / 20);

  let skipCount = 0;
  let xn1 = 0;
  let xn2 = 0;
  let yn1 = 0;
  let yn2 = 0;
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let a0 = 0;
  let a1 = 0;
  let a2 = 0;

  for (let index = 0; index < input.length; index += 1) {
    const x = input[index];
    if (skipCount % LFO_SKIP_SAMPLES === 0) {
      skipCount += 1;
      let frequency = (1 + Math.cos(skipCount * lfoSkip + phase)) / 2;
      frequency = frequency * depth * (1 - frequencyOffset) + frequencyOffset;
      frequency = Math.exp((frequency - 1) * 6);
      const omega = Math.PI * frequency;
      const sn = Math.sin(omega);
      const cs = Math.cos(omega);
      const alpha = sn / (2 * settings.resonance);
      b0 = (1 - cs) / 2;
      b1 = 1 - cs;
      b2 = (1 - cs) / 2;
      a0 = 1 + alpha;
      a1 = -2 * cs;
      a2 = 1 - alpha;
    } else {
      skipCount += 1;
    }

    const y = (b0 * x + b1 * xn1 + b2 * xn2 - a1 * yn1 - a2 * yn2) / a0;
    xn2 = xn1;
    xn1 = x;
    yn2 = yn1;
    yn1 = y;
    const gained = y * outputGain;
    if (!Number.isFinite(gained)) {
      throw new RangeError(`Wah Wah 在第 ${index} 个采样产生非有限输出`);
    }
    output[index] = gained;
  }

  return output;
}

export function processWahWahChannels(
  channels: readonly Float32Array[],
  settings: WahWahSettings,
  sampleRate: number,
): Float32Array[] {
  if (channels.length === 0) throw new RangeError('至少需要一个音频声道');
  const length = channels[0].length;
  if (channels.some((channel) => channel.length !== length)) {
    throw new RangeError('Wah Wah 输入声道必须等长');
  }
  return channels.map((channel) => processWahWah(channel, settings, sampleRate));
}
