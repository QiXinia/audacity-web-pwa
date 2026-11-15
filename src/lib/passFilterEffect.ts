// Audacity 4 highpass.ny / lowpass.ny and Nyquist dspprims.lsp.
// The 6 dB option uses snd-tone/snd-atone; steeper options use the
// official fixed-Q lowpass2/highpass2 Butterworth cascade.
export const PASS_FILTER_ROLLOFFS = [6, 12, 24, 36, 48] as const;
export const PASS_FILTER_KINDS = ['highpass', 'lowpass'] as const;

export type PassFilterRolloff = typeof PASS_FILTER_ROLLOFFS[number];
export type PassFilterKind = typeof PASS_FILTER_KINDS[number];

export interface PassFilterSettings {
  kind: PassFilterKind;
  frequencyHz: number;
  rolloff: PassFilterRolloff;
}

export const DEFAULT_PASS_FILTER_SETTINGS: Readonly<PassFilterSettings> = Object.freeze({
  kind: 'lowpass',
  frequencyHz: 1000,
  rolloff: 6,
});

export interface PassFilterSection {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
  z1: number;
  z2: number;
}

export interface PassFilterState {
  readonly settings: PassFilterSettings;
  readonly sampleRate: number;
  readonly onePoleCoefficient: number;
  onePolePrevious: number;
  readonly sections: PassFilterSection[];
}

const NYQUIST_PI = 3.14159265358979;
const Q_BY_ROLLOFF: Readonly<Record<Exclude<PassFilterRolloff, 6>, readonly number[]>> = Object.freeze({
  12: Object.freeze([0.7071]),
  24: Object.freeze([0.60492333, 1.33722126]),
  36: Object.freeze([0.58338080, 0.75932572, 1.95302407]),
  48: Object.freeze([0.57622191, 0.66045510, 0.94276399, 2.57900101]),
});

function officialSinh(value: number): number {
  return 0.5 * (Math.exp(value) - Math.exp(-value));
}

function onePoleCoefficient(frequencyHz: number, sampleRate: number): number {
  const b = 2 - Math.cos(frequencyHz * 2 * NYQUIST_PI / sampleRate);
  return b - Math.sqrt(b * b - 1);
}

export function validatePassFilterSettings(settings: PassFilterSettings, sampleRate?: number): void {
  if (!PASS_FILTER_KINDS.includes(settings.kind)) {
    throw new RangeError('滤波器方向无效');
  }
  if (!PASS_FILTER_ROLLOFFS.includes(settings.rolloff)) {
    throw new RangeError('Roll-off 必须是 6、12、24、36 或 48 dB/octave');
  }
  if (!Number.isFinite(settings.frequencyHz) || settings.frequencyHz < 0.1) {
    throw new RangeError('Frequency 必须是至少 0.1 Hz 的有限数值');
  }
  if (sampleRate !== undefined) {
    if (!Number.isFinite(sampleRate) || sampleRate <= 0.2) {
      throw new RangeError('采样率必须是大于 0.2 Hz 的有限数值');
    }
    if (settings.frequencyHz >= sampleRate / 2) {
      throw new RangeError(`Frequency 必须小于当前 Nyquist（${sampleRate / 2} Hz）`);
    }
  }
}

export function createPassFilterState(settings: PassFilterSettings, sampleRate: number): PassFilterState {
  validatePassFilterSettings(settings, sampleRate);
  const coefficient = onePoleCoefficient(settings.frequencyHz, sampleRate);
  const sections: PassFilterSection[] = [];
  if (settings.rolloff !== 6) {
    const w = 2 * NYQUIST_PI * (settings.frequencyHz / sampleRate);
    const cw = Math.cos(w);
    const sw = Math.sin(w);
    for (const q of Q_BY_ROLLOFF[settings.rolloff]) {
      const alpha = sw * officialSinh(0.5 / q);
      const a0r = 1 / (1 + alpha);
      const b1 = settings.kind === 'lowpass' ? 1 - cw : -1 - cw;
      const b0 = settings.kind === 'lowpass' ? 0.5 * b1 : -0.5 * b1;
      sections.push({
        b0: a0r * b0,
        b1: a0r * b1,
        b2: a0r * b0,
        a1: a0r * (2 * cw),
        a2: a0r * (alpha - 1),
        z1: 0,
        z2: 0,
      });
    }
  }
  if (!Number.isFinite(coefficient) || sections.some((section) => (
    ![section.b0, section.b1, section.b2, section.a1, section.a2].every(Number.isFinite)
  ))) {
    throw new RangeError('无法为当前参数生成有限滤波系数');
  }
  return {
    settings: { ...settings },
    sampleRate,
    onePoleCoefficient: coefficient,
    onePolePrevious: 0,
    sections,
  };
}

function sameSettings(left: PassFilterSettings, right: PassFilterSettings): boolean {
  return left.kind === right.kind
    && left.frequencyHz === right.frequencyHz
    && left.rolloff === right.rolloff;
}

function assertFiniteSamples(input: Float32Array): void {
  for (let index = 0; index < input.length; index += 1) {
    if (!Number.isFinite(input[index])) {
      throw new RangeError(`输入在第 ${index} 个采样包含非有限数值`);
    }
  }
}

export function processPassFilter(
  input: Float32Array,
  settings: PassFilterSettings,
  sampleRate: number,
  state = createPassFilterState(settings, sampleRate),
): Float32Array {
  validatePassFilterSettings(settings, sampleRate);
  if (state.sampleRate !== sampleRate || !sameSettings(state.settings, settings)) {
    throw new RangeError('滤波器状态与当前参数不匹配');
  }
  assertFiniteSamples(input);

  if (settings.rolloff === 6) {
    const output = new Float32Array(input.length);
    const coefficient = state.onePoleCoefficient;
    for (let index = 0; index < input.length; index += 1) {
      const current = input[index];
      if (settings.kind === 'lowpass') {
        const next = (1 - coefficient) * current + coefficient * state.onePolePrevious;
        state.onePolePrevious = next;
        output[index] = next;
      } else {
        const next = coefficient * (state.onePolePrevious + current);
        output[index] = next;
        state.onePolePrevious = next - current;
      }
      if (!Number.isFinite(output[index])) {
        throw new RangeError(`滤波器在第 ${index} 个采样产生非有限输出`);
      }
    }
    return output;
  }

  let current = input;
  for (const section of state.sections) {
    const output = new Float32Array(current.length);
    for (let index = 0; index < current.length; index += 1) {
      const z0 = current[index] + section.a1 * section.z1 + section.a2 * section.z2;
      const next = z0 * section.b0 + section.z1 * section.b1 + section.z2 * section.b2;
      section.z2 = section.z1;
      section.z1 = z0;
      output[index] = next;
      if (!Number.isFinite(output[index])) {
        throw new RangeError(`滤波器在第 ${index} 个采样产生非有限输出`);
      }
    }
    current = output;
  }
  return new Float32Array(current);
}

export function processPassFilterChannels(
  channels: readonly Float32Array[],
  settings: PassFilterSettings,
  sampleRate: number,
  states?: PassFilterState[],
): Float32Array[] {
  if (channels.length === 0) throw new RangeError('至少需要一个音频声道');
  const length = channels[0].length;
  if (channels.some((channel) => channel.length !== length)) {
    throw new RangeError('输入声道必须等长');
  }
  if (states && states.length !== channels.length) {
    throw new RangeError('每个输入声道必须有一个滤波器状态');
  }
  return channels.map((channel, index) => processPassFilter(
    channel,
    settings,
    sampleRate,
    states?.[index] ?? createPassFilterState(settings, sampleRate),
  ));
}
