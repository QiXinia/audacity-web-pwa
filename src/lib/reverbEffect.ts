export interface ReverbSettings {
  roomSize: number;
  preDelayMs: number;
  reverberance: number;
  hfDamping: number;
  toneLow: number;
  toneHigh: number;
  wetGainDb: number;
  dryGainDb: number;
  stereoWidth: number;
  wetOnly: boolean;
}

export const DEFAULT_REVERB_SETTINGS: Readonly<ReverbSettings> = Object.freeze({
  roomSize: 75,
  preDelayMs: 10,
  reverberance: 50,
  hfDamping: 50,
  toneLow: 100,
  toneHigh: 100,
  wetGainDb: -1,
  dryGainDb: -1,
  stereoWidth: 100,
  wetOnly: false,
});

const COMB_LENGTHS = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617] as const;
const ALLPASS_LENGTHS = [225, 341, 441, 556] as const;
const STEREO_ADJUST = 12;

function assertRange(value: number, minimum: number, maximum: number, label: string): void {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new RangeError(`${label}必须在 ${minimum}–${maximum} 之间`);
  }
}

export function validateReverbSettings(settings: ReverbSettings): void {
  assertRange(settings.roomSize, 0, 100, '房间大小');
  assertRange(settings.preDelayMs, 0, 200, '预延迟');
  assertRange(settings.reverberance, 0, 100, '混响强度');
  assertRange(settings.hfDamping, 0, 100, '高频阻尼');
  assertRange(settings.toneLow, 0, 100, '低音色调');
  assertRange(settings.toneHigh, 0, 100, '高音色调');
  assertRange(settings.wetGainDb, -20, 10, '湿声增益');
  assertRange(settings.dryGainDb, -20, 10, '干声增益');
  assertRange(settings.stereoWidth, 0, 100, '立体声宽度');
  if (typeof settings.wetOnly !== 'boolean') throw new RangeError('仅湿声开关无效');
}

function dbToLinear(db: number): number {
  return 10 ** (db / 20);
}

function midiToFrequency(note: number): number {
  return 440 * 2 ** ((note - 69) / 12);
}

interface DelayLine {
  buffer: Float32Array;
  pointer: number;
  store: number;
}

interface OnePole {
  a1: number;
  b0: number;
  b1: number;
  i1: number;
  o1: number;
}

interface FilterArray {
  comb: DelayLine[];
  allpass: DelayLine[];
  highpass: OnePole;
  lowpass: OnePole;
}

interface ReverbCore {
  preDelay: Float32Array;
  preDelayPointer: number;
  filters: FilterArray[];
  feedback: number;
  hfDamping: number;
  gain: number;
}

export interface ReverbState {
  readonly settings: ReverbSettings;
  readonly sampleRate: number;
  readonly channelCount: number;
  readonly cores: ReverbCore[];
}

function createDelayLine(length: number): DelayLine {
  const size = Math.max(1, Math.floor(length + 0.5));
  if (!Number.isSafeInteger(size)) throw new RangeError('Reverb 滤波器长度无效');
  return { buffer: new Float32Array(size), pointer: 0, store: 0 };
}

function advance(line: DelayLine): void {
  line.pointer = line.pointer === 0 ? line.buffer.length - 1 : line.pointer - 1;
}

function processComb(line: DelayLine, input: number, feedback: number, damping: number): number {
  const output = line.buffer[line.pointer];
  line.store = Math.fround(output + (line.store - output) * damping);
  line.buffer[line.pointer] = input + line.store * feedback;
  advance(line);
  return output;
}

function processAllpass(line: DelayLine, input: number): number {
  const output = line.buffer[line.pointer];
  line.buffer[line.pointer] = input + output * 0.5;
  advance(line);
  return Math.fround(output - input);
}

function createOnePole(sampleRate: number, cutoff: number, highpass: boolean): OnePole {
  const a1 = -Math.exp(-2 * Math.PI * cutoff / sampleRate);
  const b0 = highpass ? (1 - a1) / 2 : 1 + a1;
  return { a1, b0, b1: highpass ? -b0 : 0, i1: 0, o1: 0 };
}

function processOnePole(filter: OnePole, input: number): number {
  const output = input * filter.b0 + filter.i1 * filter.b1 - filter.o1 * filter.a1;
  filter.i1 = input;
  filter.o1 = output;
  return Math.fround(output);
}

function createFilterArray(settings: ReverbSettings, sampleRate: number, offset: number): FilterArray {
  const rateScale = sampleRate / 44100;
  const roomScale = settings.roomSize / 100 * 0.9 + 0.1;
  let combOffset = offset;
  const comb = COMB_LENGTHS.map((length) => {
    const line = createDelayLine(roomScale * rateScale * (length + STEREO_ADJUST * combOffset));
    combOffset = -combOffset;
    return line;
  });
  let allpassOffset = offset;
  const allpass = ALLPASS_LENGTHS.map((length) => {
    const line = createDelayLine(rateScale * (length + STEREO_ADJUST * allpassOffset));
    allpassOffset = -allpassOffset;
    return line;
  });
  return {
    comb,
    allpass,
    highpass: createOnePole(sampleRate, midiToFrequency(72 - settings.toneLow / 100 * 48), true),
    lowpass: createOnePole(sampleRate, midiToFrequency(72 + settings.toneHigh / 100 * 48), false),
  };
}

function createCore(settings: ReverbSettings, sampleRate: number, stereoWidth: number): ReverbCore {
  const feedbackA = -1 / Math.log(1 - 0.3);
  const feedbackB = 100 / (Math.log(1 - 0.98) * feedbackA + 1);
  const depth = stereoWidth / 100;
  const filters = [createFilterArray(settings, sampleRate, 0)];
  if (depth > 0) filters.push(createFilterArray(settings, sampleRate, depth));
  return {
    preDelay: new Float32Array(Math.max(0, Math.floor(settings.preDelayMs / 1000 * sampleRate + 0.5))),
    preDelayPointer: 0,
    filters,
    feedback: 1 - Math.exp((settings.reverberance - feedbackB) / (feedbackA * feedbackB)),
    hfDamping: settings.hfDamping / 100 * 0.3 + 0.2,
    gain: dbToLinear(settings.wetGainDb) * 0.015,
  };
}

function processFilterArray(filter: FilterArray, input: number, core: ReverbCore): number {
  let output = 0;
  for (let index = filter.comb.length - 1; index >= 0; index -= 1) {
    output = Math.fround(output + processComb(filter.comb[index], input, core.feedback, core.hfDamping));
  }
  for (let index = filter.allpass.length - 1; index >= 0; index -= 1) {
    output = processAllpass(filter.allpass[index], output);
  }
  output = processOnePole(filter.highpass, output);
  output = processOnePole(filter.lowpass, output);
  return Math.fround(output * core.gain);
}

function processCore(core: ReverbCore, input: number): [number, number] {
  let delayed = input;
  if (core.preDelay.length > 0) {
    delayed = core.preDelay[core.preDelayPointer];
    core.preDelay[core.preDelayPointer] = input;
    core.preDelayPointer = (core.preDelayPointer + 1) % core.preDelay.length;
  }
  const left = processFilterArray(core.filters[0], delayed, core);
  const right = core.filters[1] ? processFilterArray(core.filters[1], delayed, core) : left;
  return [left, right];
}

export function createReverbState(
  settings: ReverbSettings,
  sampleRate: number,
  channelCount: number,
): ReverbState {
  validateReverbSettings(settings);
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new RangeError('采样率必须是大于零的有限数值');
  }
  if (channelCount !== 1 && channelCount !== 2) {
    throw new RangeError('Reverb 仅支持单声道或立体声轨道');
  }
  const width = channelCount === 2 ? settings.stereoWidth : 0;
  return {
    settings: { ...settings },
    sampleRate,
    channelCount,
    cores: Array.from({ length: channelCount }, () => createCore(settings, sampleRate, width)),
  };
}

/**
 * Audacity 4 ReverbEffect::InstanceProcess and Reverb_libSoX.h. Each input
 * channel owns an independent reverb core. Positive stereo widths average the
 * two wet cores; zero width follows the official independent mono path for
 * each channel. Pre-delay and all filter histories persist across selected clips.
 * Source: https://github.com/audacity/audacity/tree/master/src/effects/builtin_collection/reverb
 */
export function processReverbSelection(
  channels: readonly Float32Array[],
  startSample: number,
  endSample: number,
  state: ReverbState,
): Float32Array[] {
  const length = channels[0]?.length ?? 0;
  if (
    channels.length !== state.channelCount
    || length < 1
    || channels.some((channel) => channel.length !== length)
  ) {
    throw new RangeError('Reverb 输入声道必须与状态一致且等长');
  }
  if (
    !Number.isSafeInteger(startSample)
    || !Number.isSafeInteger(endSample)
    || startSample < 0
    || endSample > length
    || endSample <= startSample
  ) {
    throw new RangeError('Reverb 选区必须是声道范围内的非空整数采样区间');
  }

  const output = channels.map((channel) => new Float32Array(channel));
  const dryMultiplier = state.settings.wetOnly ? 0 : dbToLinear(state.settings.dryGainDb);
  for (let index = startSample; index < endSample; index += 1) {
    const wet: [number, number][] = [];
    for (let channel = 0; channel < state.channelCount; channel += 1) {
      const input = channels[channel][index];
      if (!Number.isFinite(input)) throw new RangeError(`Reverb 输入在第 ${index} 个采样包含非有限值`);
      wet.push(processCore(state.cores[channel], input));
    }
    for (let channel = 0; channel < state.channelCount; channel += 1) {
      const wetSample = state.channelCount === 2 && state.settings.stereoWidth > 0
        ? 0.5 * (wet[0][channel] + wet[1][channel])
        : wet[channel][0];
      const value = Math.fround(dryMultiplier * channels[channel][index] + wetSample);
      if (!Number.isFinite(value)) throw new RangeError(`Reverb 在第 ${index} 个采样产生非有限输出`);
      output[channel][index] = value;
    }
  }
  return output;
}

export function processReverbChannels(
  channels: readonly Float32Array[],
  settings: ReverbSettings,
  sampleRate: number,
  state?: ReverbState,
): Float32Array[] {
  if (channels.length === 0) throw new RangeError('Reverb 至少需要一个音频声道');
  const activeState = state ?? createReverbState(settings, sampleRate, channels.length);
  return processReverbSelection(channels, 0, channels[0]?.length ?? 0, activeState);
}
