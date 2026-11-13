export const TREMOLO_WAVEFORMS = [
  'sine',
  'triangle',
  'sawtooth',
  'inverseSawtooth',
  'square',
] as const;

export type TremoloWaveform = typeof TREMOLO_WAVEFORMS[number];

export interface TremoloSettings {
  waveform: TremoloWaveform;
  phaseDegrees: number;
  wetPercent: number;
  frequencyHz: number;
}

export const DEFAULT_TREMOLO_SETTINGS: Readonly<TremoloSettings> = Object.freeze({
  waveform: 'sine',
  phaseDegrees: 0,
  wetPercent: 40,
  frequencyHz: 4,
});

/** One oscillator per track, shared by every channel and selected clip. */
export interface TremoloState {
  sampleOffset: number;
}

export function createTremoloState(): TremoloState {
  return { sampleOffset: 0 };
}

export function validateTremoloSettings(settings: TremoloSettings): void {
  if (!TREMOLO_WAVEFORMS.includes(settings.waveform)) {
    throw new RangeError('Tremolo 波形类型无效');
  }
  if (!Number.isSafeInteger(settings.phaseDegrees) || settings.phaseDegrees < -180 || settings.phaseDegrees > 180) {
    throw new RangeError('起始相位必须是 -180–180 之间的整数角度');
  }
  if (!Number.isSafeInteger(settings.wetPercent) || settings.wetPercent < 1 || settings.wetPercent > 100) {
    throw new RangeError('Wet 百分比必须是 1–100 之间的整数');
  }
  if (!Number.isFinite(settings.frequencyHz) || settings.frequencyHz < 0.001 || settings.frequencyHz > 1000) {
    throw new RangeError('LFO 频率必须在 0.001–1000 Hz 之间');
  }
}

function positiveFraction(value: number): number {
  const fraction = value % 1;
  return fraction < 0 ? fraction + 1 : fraction;
}

/** Evaluate the Nyquist tables used by Audacity 4.0.2 tremolo.ny. */
function sampleWaveform(waveform: TremoloWaveform, phaseCycles: number): number {
  const phase = positiveFraction(phaseCycles);
  if (waveform === 'sine') return Math.sin(2 * Math.PI * phase);
  if (waveform === 'triangle') return phase < 0.5 ? -1 + 4 * phase : 3 - 4 * phase;
  if (waveform === 'sawtooth') {
    return phase < 0.995
      ? -1 + (2 * phase) / 0.995
      : 1 - (2 * (phase - 0.995)) / 0.005;
  }
  if (waveform === 'inverseSawtooth') {
    return phase < 0.005
      ? -1 + (2 * phase) / 0.005
      : 1 - (2 * (phase - 0.005)) / 0.995;
  }
  if (phase < 0.005) return -1 + (2 * phase) / 0.005;
  if (phase < 0.5) return 1;
  if (phase < 0.505) return 1 - (2 * (phase - 0.5)) / 0.005;
  return -1;
}

/**
 * Audacity 4.0.2 share/nyquist-plug-ins/tremolo.ny:
 *   level = WET / 200
 *   gain = 1 - level + level * osc(LFO, waveform, phase)
 *   output = input * gain
 *
 * The sine table is rotated 90 degrees relative to the other Nyquist tables.
 * A single oscillator envelope is shared by all channels of a track, matching
 * multiplication of a stereo *track* by the mono mod-wave in the plug-in.
 */
export function processTremoloChannels(
  channels: readonly Float32Array[],
  settings: TremoloSettings,
  sampleRate: number,
  state = createTremoloState(),
): Float32Array[] {
  validateTremoloSettings(settings);
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new RangeError('采样率必须是大于零的有限数值');
  }
  if (!Number.isSafeInteger(state.sampleOffset) || state.sampleOffset < 0) {
    throw new RangeError('Tremolo LFO 采样偏移无效');
  }
  if (channels.length === 0) throw new RangeError('至少需要一个音频声道');
  const length = channels[0].length;
  if (channels.some((channel) => channel.length !== length)) {
    throw new RangeError('Tremolo 输入声道必须等长');
  }
  if (!Number.isSafeInteger(state.sampleOffset + length)) {
    throw new RangeError('Tremolo LFO 采样偏移超出安全范围');
  }
  for (const channel of channels) {
    for (let index = 0; index < channel.length; index += 1) {
      if (!Number.isFinite(channel[index])) {
        throw new RangeError(`Tremolo 输入在第 ${index} 个采样包含非有限数值`);
      }
    }
  }

  const output = channels.map(() => new Float32Array(length));
  const level = settings.wetPercent / 200;
  const tablePhaseOffset = settings.phaseDegrees / 360 - (settings.waveform === 'sine' ? 0.25 : 0);
  for (let index = 0; index < length; index += 1) {
    const cycles = ((state.sampleOffset + index) * settings.frequencyHz) / sampleRate;
    const oscillator = sampleWaveform(settings.waveform, cycles + tablePhaseOffset);
    const gain = 1 - level + level * oscillator;
    for (let channelIndex = 0; channelIndex < channels.length; channelIndex += 1) {
      const value = channels[channelIndex][index] * gain;
      if (!Number.isFinite(value)) {
        throw new RangeError(`Tremolo 在第 ${index} 个采样产生非有限输出`);
      }
      output[channelIndex][index] = value;
    }
  }
  state.sampleOffset += length;
  return output;
}

export function processTremolo(
  input: Float32Array,
  settings: TremoloSettings,
  sampleRate: number,
  state = createTremoloState(),
): Float32Array {
  return processTremoloChannels([input], settings, sampleRate, state)[0];
}
