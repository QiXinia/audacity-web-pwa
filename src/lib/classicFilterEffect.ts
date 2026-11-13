// Audacity 4.0.2 ScienFilterBase + Biquad: Butterworth and Chebyshev I/II biquads.
export const CLASSIC_FILTER_TYPES = ['butterworth', 'chebyshev1', 'chebyshev2'] as const;
export const CLASSIC_FILTER_SUBTYPES = ['lowpass', 'highpass'] as const;

export type ClassicFilterType = typeof CLASSIC_FILTER_TYPES[number];
export type ClassicFilterSubtype = typeof CLASSIC_FILTER_SUBTYPES[number];

export interface ClassicFilterSettings {
  filterType: ClassicFilterType;
  subtype: ClassicFilterSubtype;
  order: number;
  cutoffHz: number;
  passbandRippleDb: number;
  stopbandAttenuationDb: number;
}

export const DEFAULT_CLASSIC_FILTER_SETTINGS: Readonly<ClassicFilterSettings> = Object.freeze({
  filterType: 'butterworth',
  subtype: 'lowpass',
  order: 1,
  cutoffHz: 1000,
  passbandRippleDb: 1,
  stopbandAttenuationDb: 30,
});

export interface ClassicFilterCoefficients {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

export interface ClassicFilterSection extends ClassicFilterCoefficients {
  previousInput: number;
  previousPreviousInput: number;
  previousOutput: number;
  previousPreviousOutput: number;
}

export interface ClassicFilterState {
  readonly settings: ClassicFilterSettings;
  readonly sampleRate: number;
  readonly sections: ClassicFilterSection[];
}

interface Complex {
  x: number;
  y: number;
}

function section(): ClassicFilterSection {
  return {
    b0: 1, b1: 0, b2: 0, a1: 0, a2: 0,
    previousInput: 0,
    previousPreviousInput: 0,
    previousOutput: 0,
    previousPreviousOutput: 0,
  };
}

function assertSampleRate(sampleRate: number): void {
  if (!Number.isFinite(sampleRate) || sampleRate <= 2) {
    throw new RangeError('Classic Filters 采样率必须是大于 2 的有限数值');
  }
}

function assertRange(value: number, minimum: number, maximum: number, label: string): void {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new RangeError(`Classic Filters ${label}必须在 ${minimum}–${maximum} 之间`);
  }
}

export function validateClassicFilterSettings(settings: ClassicFilterSettings, sampleRate?: number): void {
  if (!CLASSIC_FILTER_TYPES.includes(settings.filterType)) {
    throw new RangeError('Classic Filters 滤波器类型无效');
  }
  if (!CLASSIC_FILTER_SUBTYPES.includes(settings.subtype)) {
    throw new RangeError('Classic Filters  Subtype 无效');
  }
  if (!Number.isSafeInteger(settings.order) || settings.order < 1 || settings.order > 10) {
    throw new RangeError('Classic Filters Order 必须是 1–10 的整数');
  }
  if (!Number.isFinite(settings.cutoffHz) || settings.cutoffHz < 1) {
    throw new RangeError('Classic Filters Cutoff 必须是至少 1 Hz 的有限数值');
  }
  assertRange(settings.passbandRippleDb, 0, 100, 'Passband Ripple');
  assertRange(settings.stopbandAttenuationDb, 0, 100, 'Minimum Stopband Attenuation');
  if (sampleRate !== undefined) {
    assertSampleRate(sampleRate);
    const maximum = sampleRate / 2 - 1;
    if (settings.cutoffHz > maximum) {
      throw new RangeError(`Classic Filters Cutoff 不能超过当前 Nyquist 减 1 Hz（${maximum} Hz）`);
    }
  }
}

function distanceSquared(x1: number, y1: number, x2: number, y2: number): number {
  return (x1 - x2) ** 2 + (y1 - y2) ** 2;
}

function bilinearTransform(sx: number, sy: number): Complex {
  const denominator = (1 - sx) ** 2 + sy ** 2;
  return {
    x: (1 - sx ** 2 - sy ** 2) / denominator,
    y: 2 * sy / denominator,
  };
}

function complexDivide(numerator: Complex, denominator: Complex): Complex {
  const divisor = denominator.x ** 2 + denominator.y ** 2;
  return {
    x: (numerator.x * denominator.x + numerator.y * denominator.y) / divisor,
    y: (numerator.y * denominator.x - numerator.x * denominator.y) / divisor,
  };
}

function bilinearComplex(value: Complex): Complex {
  return bilinearTransform(value.x, value.y);
}

function warpedCutoff(settings: ClassicFilterSettings, sampleRate: number): { normalized: number; warped: number } {
  let normalized = settings.cutoffHz / (sampleRate / 2);
  if (normalized >= 0.9999) normalized = 0.9999;
  return { normalized, warped: Math.tan(Math.PI * normalized / 2) };
}

function calculateButterworth(settings: ClassicFilterSettings, sampleRate: number): ClassicFilterSection[] {
  const { order, subtype } = settings;
  const sections = Array.from({ length: Math.floor((order + 1) / 2) }, section);
  const { warped: cutoff } = warpedCutoff(settings, sampleRate);
  let dcPoleDistanceSquared = 1;

  if (order % 2 === 0) {
    for (let pair = 0; pair < order / 2; pair += 1) {
      const pole = bilinearTransform(
        cutoff * Math.cos(Math.PI - (pair + 0.5) * Math.PI / order),
        cutoff * Math.sin(Math.PI - (pair + 0.5) * Math.PI / order),
      );
      sections[pair].b1 = subtype === 'lowpass' ? 2 : -2;
      sections[pair].b2 = 1;
      sections[pair].a1 = -2 * pole.x;
      sections[pair].a2 = pole.x ** 2 + pole.y ** 2;
      dcPoleDistanceSquared *= distanceSquared(subtype === 'lowpass' ? 1 : -1, 0, pole.x, pole.y);
    }
  } else {
    const firstPole = bilinearTransform(-cutoff, 0);
    sections[0].b1 = subtype === 'lowpass' ? 1 : -1;
    sections[0].a1 = -firstPole.x;
    dcPoleDistanceSquared = subtype === 'lowpass' ? 1 - firstPole.x : firstPole.x + 1;
    for (let pair = 1; pair <= Math.floor(order / 2); pair += 1) {
      const pole = bilinearTransform(
        cutoff * Math.cos(Math.PI - pair * Math.PI / order),
        cutoff * Math.sin(Math.PI - pair * Math.PI / order),
      );
      sections[pair].b1 = subtype === 'lowpass' ? 2 : -2;
      sections[pair].b2 = 1;
      sections[pair].a1 = -2 * pole.x;
      sections[pair].a2 = pole.x ** 2 + pole.y ** 2;
      dcPoleDistanceSquared *= distanceSquared(subtype === 'lowpass' ? 1 : -1, 0, pole.x, pole.y);
    }
  }

  const scale = dcPoleDistanceSquared / (1 << order);
  sections[0].b0 *= scale;
  sections[0].b1 *= scale;
  sections[0].b2 *= scale;
  return sections;
}

function calculateChebyshevType1(settings: ClassicFilterSettings, sampleRate: number): ClassicFilterSection[] {
  const { order, subtype } = settings;
  const sections = Array.from({ length: Math.floor((order + 1) / 2) }, section);
  const { normalized, warped: cutoff } = warpedCutoff(settings, sampleRate);
  const beta = Math.cos(normalized * Math.PI);
  const epsilon = Math.sqrt(10 ** (Math.max(0.001, settings.passbandRippleDb) / 10) - 1);
  const a = Math.log(1 / epsilon + Math.sqrt(1 / epsilon ** 2 + 1)) / order;

  for (let pair = 0; pair < Math.floor(order / 2); pair += 1) {
    let pole = bilinearTransform(
      -cutoff * Math.sinh(a) * Math.sin((2 * pair + 1) * Math.PI / (2 * order)),
      cutoff * Math.cosh(a) * Math.cos((2 * pair + 1) * Math.PI / (2 * order)),
    );
    let zeroX: number;
    let scale: number;
    if (subtype === 'lowpass') {
      zeroX = -1;
      scale = distanceSquared(1, 0, pole.x, pole.y) / 4;
    } else {
      pole = complexDivide(
        { x: beta - pole.x, y: -pole.y },
        { x: 1 - beta * pole.x, y: -beta * pole.y },
      );
      zeroX = 1;
      scale = distanceSquared(-1, 0, pole.x, pole.y) / 4;
    }
    Object.assign(sections[pair], {
      b0: scale,
      b1: -2 * zeroX * scale,
      b2: scale,
      a1: -2 * pole.x,
      a2: pole.x ** 2 + pole.y ** 2,
    });
  }

  if (order % 2 === 0) {
    const scale = 10 ** (-Math.max(0.001, settings.passbandRippleDb) / 20);
    sections[0].b0 *= scale;
    sections[0].b1 *= scale;
    sections[0].b2 *= scale;
  } else {
    const pair = (order - 1) / 2;
    let pole = bilinearTransform(-cutoff * Math.sinh(a), 0);
    let zeroX: number;
    let scale: number;
    if (subtype === 'lowpass') {
      zeroX = -1;
      scale = Math.sqrt(distanceSquared(1, 0, pole.x, pole.y)) / 2;
    } else {
      pole = complexDivide(
        { x: beta - pole.x, y: -pole.y },
        { x: 1 - beta * pole.x, y: -beta * pole.y },
      );
      zeroX = 1;
      scale = Math.sqrt(distanceSquared(-1, 0, pole.x, pole.y)) / 2;
    }
    Object.assign(sections[pair], {
      b0: scale,
      b1: -zeroX * scale,
      b2: 0,
      a1: -pole.x,
      a2: 0,
    });
  }
  return sections;
}

function calculateChebyshevType2(settings: ClassicFilterSettings, sampleRate: number): ClassicFilterSection[] {
  const { order, subtype } = settings;
  const sections = Array.from({ length: Math.floor((order + 1) / 2) }, section);
  const { normalized, warped: cutoff } = warpedCutoff(settings, sampleRate);
  const beta = Math.cos(normalized * Math.PI);
  const epsilon = 10 ** (-Math.max(0.001, settings.stopbandAttenuationDb) / 20);
  const a = Math.log(1 / epsilon + Math.sqrt(1 / epsilon ** 2 + 1)) / order;

  for (let pair = 0; pair < Math.floor(order / 2); pair += 1) {
    const angle = (2 * pair + 1) * Math.PI / (2 * order);
    let pole = bilinearComplex(complexDivide(
      { x: cutoff, y: 0 },
      { x: -Math.sinh(a) * Math.sin(angle), y: Math.cosh(a) * Math.cos(angle) },
    ));
    let zero = bilinearTransform(0, cutoff / Math.cos(angle));
    let scale: number;
    if (subtype === 'lowpass') {
      scale = distanceSquared(1, 0, pole.x, pole.y) / distanceSquared(1, 0, zero.x, zero.y);
    } else {
      pole = complexDivide(
        { x: beta - pole.x, y: -pole.y },
        { x: 1 - beta * pole.x, y: -beta * pole.y },
      );
      zero = complexDivide(
        { x: beta - zero.x, y: -zero.y },
        { x: 1 - beta * zero.x, y: -beta * zero.y },
      );
      scale = distanceSquared(-1, 0, pole.x, pole.y) / distanceSquared(-1, 0, zero.x, zero.y);
    }
    Object.assign(sections[pair], {
      b0: scale,
      b1: -2 * zero.x * scale,
      b2: (zero.x ** 2 + zero.y ** 2) * scale,
      a1: -2 * pole.x,
      a2: pole.x ** 2 + pole.y ** 2,
    });
  }

  if (order % 2 === 1) {
    const pair = (order - 1) / 2;
    const angle = (2 * pair + 1) * Math.PI / (2 * order);
    let pole = bilinearComplex(complexDivide(
      { x: cutoff, y: 0 },
      { x: -Math.sinh(a) * Math.sin(angle), y: Math.cosh(a) * Math.cos(angle) },
    ));
    let zeroX = -1;
    let scale: number;
    if (subtype === 'lowpass') {
      scale = Math.sqrt(distanceSquared(1, 0, pole.x, pole.y)) / 2;
    } else {
      // Keep Audacity Biquad.cpp's odd-order high-pass denominator exactly:
      // unlike the even sections, its imaginary denominator term is -fZPoleY.
      pole = complexDivide(
        { x: beta - pole.x, y: -pole.y },
        { x: 1 - beta * pole.x, y: -pole.y },
      );
      zeroX = 1;
      scale = Math.sqrt(distanceSquared(-1, 0, pole.x, pole.y)) / 2;
    }
    Object.assign(sections[pair], {
      b0: scale,
      b1: -zeroX * scale,
      b2: 0,
      a1: -pole.x,
      a2: 0,
    });
  }
  return sections;
}

export function createClassicFilterState(settings: ClassicFilterSettings, sampleRate: number): ClassicFilterState {
  validateClassicFilterSettings(settings, sampleRate);
  const sections = settings.filterType === 'butterworth'
    ? calculateButterworth(settings, sampleRate)
    : settings.filterType === 'chebyshev1'
      ? calculateChebyshevType1(settings, sampleRate)
      : calculateChebyshevType2(settings, sampleRate);
  if (sections.some((item) => ![item.b0, item.b1, item.b2, item.a1, item.a2].every(Number.isFinite))) {
    throw new RangeError('Classic Filters 无法为当前参数生成有限滤波系数');
  }
  return { settings: { ...settings }, sampleRate, sections };
}

function sameSettings(left: ClassicFilterSettings, right: ClassicFilterSettings): boolean {
  return left.filterType === right.filterType
    && left.subtype === right.subtype
    && left.order === right.order
    && left.cutoffHz === right.cutoffHz
    && left.passbandRippleDb === right.passbandRippleDb
    && left.stopbandAttenuationDb === right.stopbandAttenuationDb;
}

export function processClassicFilter(
  input: Float32Array,
  settings: ClassicFilterSettings,
  sampleRate: number,
  state = createClassicFilterState(settings, sampleRate),
): Float32Array {
  validateClassicFilterSettings(settings, sampleRate);
  if (state.sampleRate !== sampleRate || !sameSettings(state.settings, settings)) {
    throw new RangeError('Classic Filters 状态与当前参数不匹配');
  }
  let current = input;
  for (const item of state.sections) {
    const output = new Float32Array(current.length);
    for (let index = 0; index < current.length; index += 1) {
      const value = current[index];
      if (!Number.isFinite(value)) {
        throw new RangeError(`Classic Filters 输入在第 ${index} 个采样包含非有限数值`);
      }
      const result = value * item.b0
        + item.previousInput * item.b1
        + item.previousPreviousInput * item.b2
        - item.previousOutput * item.a1
        - item.previousPreviousOutput * item.a2;
      item.previousPreviousInput = item.previousInput;
      item.previousInput = value;
      item.previousPreviousOutput = item.previousOutput;
      item.previousOutput = result;
      output[index] = result;
      if (!Number.isFinite(output[index])) {
        throw new RangeError(`Classic Filters 在第 ${index} 个采样产生非有限输出`);
      }
    }
    current = output;
  }
  return new Float32Array(current);
}

export function processClassicFilterChannels(
  channels: readonly Float32Array[],
  settings: ClassicFilterSettings,
  sampleRate: number,
  states?: ClassicFilterState[],
): Float32Array[] {
  if (channels.length === 0) throw new RangeError('Classic Filters 至少需要一个音频声道');
  const length = channels[0].length;
  if (channels.some((channel) => channel.length !== length)) {
    throw new RangeError('Classic Filters 输入声道必须等长');
  }
  if (states && states.length !== channels.length) {
    throw new RangeError('每个输入声道必须有一个 Classic Filters 状态');
  }
  return channels.map((channel, index) => processClassicFilter(
    channel,
    settings,
    sampleRate,
    states?.[index] ?? createClassicFilterState(settings, sampleRate),
  ));
}

const CHEBYSHEV_COEFFICIENTS: readonly (readonly number[])[] = [
  [0, 1],
  [-1, 0, 2],
  [0, -3, 0, 4],
  [1, 0, -8, 0, 8],
  [0, 5, 0, -20, 0, 16],
  [-1, 0, 18, 0, -48, 0, 32],
  [0, -7, 0, 56, 0, -112, 0, 64],
  [1, 0, -32, 0, 160, 0, -256, 0, 128],
  [0, 9, 0, -120, 0, 432, 0, -576, 0, 256],
  [-1, 0, 50, 0, -400, 0, 1120, 0, -1280, 0, 512],
];

function chebyshevPolynomial(order: number, normalizedFrequency: number): number {
  // Every leading Chebyshev coefficient is positive and dominates at +Infinity.
  if (!Number.isFinite(normalizedFrequency)) return Number.POSITIVE_INFINITY;
  let power = 1;
  let sum = 0;
  for (let index = 0; index <= order; index += 1) {
    const coefficient = CHEBYSHEV_COEFFICIENTS[order - 1][index];
    // Avoid 0 * Infinity at DC/Nyquist limits; finite inputs are bit-identical.
    if (coefficient !== 0) sum += coefficient * power;
    power *= normalizedFrequency;
  }
  return sum;
}

/** Frequency-response formula used by the official Classic Filters graph. */
export function classicFilterMagnitudeAtFrequency(
  settings: ClassicFilterSettings,
  sampleRate: number,
  frequencyHz: number,
): number {
  validateClassicFilterSettings(settings, sampleRate);
  if (!Number.isFinite(frequencyHz) || frequencyHz < 0) {
    throw new RangeError('Classic Filters 响应频率必须是非负有限数值');
  }
  const nyquist = sampleRate / 2;
  const frequency = Math.min(frequencyHz, nyquist - 1);
  const cutoff = Math.min(settings.cutoffHz, nyquist - 1);
  const frequencyWarped = Math.tan(Math.PI * frequency / (2 * nyquist));
  const cutoffWarped = Math.tan(Math.PI * cutoff / (2 * nyquist));
  const ratio = frequencyWarped / cutoffWarped;
  const inverseRatio = cutoffWarped / frequencyWarped;
  const overflowThreshold = 10 ** (12 / (2 * settings.order));

  if (settings.filterType === 'butterworth') {
    if (ratio > overflowThreshold) return settings.subtype === 'lowpass' ? 0 : 1;
    const power = ratio ** (2 * settings.order);
    return Math.sqrt(settings.subtype === 'lowpass' ? 1 / (1 + power) : power / (1 + power));
  }
  if (settings.filterType === 'chebyshev1') {
    const epsilon = Math.sqrt(10 ** (Math.max(0.001, settings.passbandRippleDb) / 10) - 1);
    const polynomial = chebyshevPolynomial(settings.order, settings.subtype === 'lowpass' ? ratio : inverseRatio);
    return Math.sqrt(1 / (1 + epsilon ** 2 * polynomial ** 2));
  }
  const epsilon = 1 / Math.sqrt(10 ** (Math.max(0.001, settings.stopbandAttenuationDb) / 10) - 1);
  const polynomial = chebyshevPolynomial(settings.order, settings.subtype === 'lowpass' ? inverseRatio : ratio);
  return Math.sqrt(1 / (1 + 1 / (epsilon ** 2 * polynomial ** 2)));
}
