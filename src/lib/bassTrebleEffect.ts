export interface BassTrebleSettings {
  bassDb: number;
  trebleDb: number;
  gainDb: number;
  linkSliders: boolean;
}

export const DEFAULT_BASS_TREBLE_SETTINGS: Readonly<BassTrebleSettings> = Object.freeze({
  bassDb: 0,
  trebleDb: 0,
  gainDb: 0,
  linkSliders: false,
});

const MIN_DB = -30;
const MAX_DB = 30;
const BASS_HZ = 250;
const TREBLE_HZ = 4000;
// Audacity assigns a C++ float literal to the double state field.
const FILTER_SLOPE = Math.fround(0.4);

interface ShelfCoefficients {
  b0: number;
  b1: number;
  b2: number;
  a0: number;
  a1: number;
  a2: number;
}

interface ShelfHistory {
  xn1: number;
  xn2: number;
  yn1: number;
  yn2: number;
}

export interface BassTrebleChannelState {
  bass: ShelfCoefficients;
  treble: ShelfCoefficients;
  bassHistory: ShelfHistory;
  trebleHistory: ShelfHistory;
  outputGain: number;
}

function assertDbRange(value: number, label: string): void {
  if (!Number.isFinite(value) || value < MIN_DB || value > MAX_DB) {
    throw new RangeError(`${label}必须在 ${MIN_DB}–${MAX_DB} dB 之间`);
  }
}

export function validateBassTrebleSettings(settings: BassTrebleSettings): void {
  assertDbRange(settings.bassDb, '低音');
  assertDbRange(settings.trebleDb, '高音');
  assertDbRange(settings.gainDb, '输出音量');
  if (typeof settings.linkSliders !== 'boolean') throw new TypeError('联动开关必须是布尔值');
}

export function isBassTrebleBypassed(settings: BassTrebleSettings): boolean {
  return settings.bassDb === 0 && settings.trebleDb === 0 && settings.gainDb === 0;
}

/** Audacity BassTreble editor's Link Volume control to Tone controls rule. */
export function applyLinkedToneChange(
  settings: BassTrebleSettings,
  control: 'bass' | 'treble',
  nextValue: number,
): BassTrebleSettings {
  assertDbRange(nextValue, control === 'bass' ? '低音' : '高音');
  const key = control === 'bass' ? 'bassDb' : 'trebleDb';
  if (!settings.linkSliders) return { ...settings, [key]: nextValue };
  const oldValue = settings[key];
  const oldCompensation = oldValue > 0 ? oldValue / 2 : oldValue / 4;
  const newCompensation = nextValue > 0 ? nextValue / 2 : nextValue / 4;
  return {
    ...settings,
    [key]: nextValue,
    gainDb: Math.min(MAX_DB, Math.max(MIN_DB, settings.gainDb - newCompensation + oldCompensation)),
  };
}

function shelfCoefficients(
  hz: number,
  gainDb: number,
  sampleRate: number,
  type: 'bass' | 'treble',
): ShelfCoefficients {
  const w = 2 * Math.PI * hz / sampleRate;
  const a = Math.exp(Math.log(10) * gainDb / 40);
  const b = Math.sqrt((a * a + 1) / FILTER_SLOPE - ((a - 1) ** 2));
  const cosine = Math.cos(w);
  const sine = Math.sin(w);
  if (type === 'bass') {
    return {
      b0: a * ((a + 1) - (a - 1) * cosine + b * sine),
      b1: 2 * a * ((a - 1) - (a + 1) * cosine),
      b2: a * ((a + 1) - (a - 1) * cosine - b * sine),
      a0: (a + 1) + (a - 1) * cosine + b * sine,
      a1: -2 * ((a - 1) + (a + 1) * cosine),
      a2: (a + 1) + (a - 1) * cosine - b * sine,
    };
  }
  return {
    b0: a * ((a + 1) + (a - 1) * cosine + b * sine),
    b1: -2 * a * ((a - 1) + (a + 1) * cosine),
    b2: a * ((a + 1) + (a - 1) * cosine - b * sine),
    a0: (a + 1) - (a - 1) * cosine + b * sine,
    a1: 2 * ((a - 1) - (a + 1) * cosine),
    a2: (a + 1) - (a - 1) * cosine - b * sine,
  };
}

export function createBassTrebleState(
  settings: BassTrebleSettings,
  sampleRate: number,
): BassTrebleChannelState {
  validateBassTrebleSettings(settings);
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new RangeError('采样率必须是大于零的有限数值');
  }
  const upstreamSampleRate = Math.fround(sampleRate);
  return {
    bass: shelfCoefficients(BASS_HZ, settings.bassDb, upstreamSampleRate, 'bass'),
    treble: shelfCoefficients(TREBLE_HZ, settings.trebleDb, upstreamSampleRate, 'treble'),
    bassHistory: { xn1: 0, xn2: 0, yn1: 0, yn2: 0 },
    trebleHistory: { xn1: 0, xn2: 0, yn1: 0, yn2: 0 },
    outputGain: 10 ** (settings.gainDb / 20),
  };
}

function filterSample(coefficients: ShelfCoefficients, history: ShelfHistory, input: number): number {
  const output = Math.fround(
    (coefficients.b0 * input
      + coefficients.b1 * history.xn1
      + coefficients.b2 * history.xn2
      - coefficients.a1 * history.yn1
      - coefficients.a2 * history.yn2) / coefficients.a0,
  );
  history.xn2 = history.xn1;
  history.xn1 = input;
  history.yn2 = history.yn1;
  history.yn1 = output;
  return output;
}

/** Process one channel, preserving state when a selection crosses clip boundaries. */
export function processBassTreble(
  input: Float32Array,
  settings: BassTrebleSettings,
  sampleRate: number,
  state = createBassTrebleState(settings, sampleRate),
): Float32Array {
  validateBassTrebleSettings(settings);
  const output = new Float32Array(input.length);
  for (let index = 0; index < input.length; index += 1) {
    const bass = filterSample(state.bass, state.bassHistory, input[index]);
    const treble = filterSample(state.treble, state.trebleHistory, bass);
    output[index] = treble * state.outputGain;
    if (!Number.isFinite(output[index])) {
      throw new RangeError(`低音和高音在第 ${index} 个采样产生非有限输出`);
    }
  }
  return output;
}

export function processBassTrebleChannels(
  channels: readonly Float32Array[],
  settings: BassTrebleSettings,
  sampleRate: number,
  states?: BassTrebleChannelState[],
): Float32Array[] {
  if (channels.length === 0) throw new RangeError('至少需要一个音频声道');
  const length = channels[0].length;
  if (channels.some((channel) => channel.length !== length)) {
    throw new RangeError('低音和高音输入声道必须等长');
  }
  if (states && states.length !== channels.length) {
    throw new RangeError('每个输入声道必须有一个滤波状态');
  }
  return channels.map((channel, index) => processBassTreble(
    channel,
    settings,
    sampleRate,
    states?.[index] ?? createBassTrebleState(settings, sampleRate),
  ));
}
