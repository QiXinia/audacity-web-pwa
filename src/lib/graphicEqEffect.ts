import type { GeneratorSelection } from '@/lib/generatorEditing';
import type { ITrack } from '@/types/project';
import {
  FILTER_CURVE_EQ_LO_FREQ,
  FILTER_CURVE_EQ_MAX_FILTER_LENGTH,
  createEqualizationPlanFromResponse,
  processEqualizationChannelsWithPlan,
  processEqualizationTrackWithPlan,
  type FilterCurveEqClipInput,
  type FilterCurveEqClipResult,
  type FilterCurveEqPlan,
  type FilterCurveEqTrackInput,
  type FilterCurveEqTrackResult,
} from '@/lib/filterCurveEffect';

/** Audacity 4.0.2 Graphic EQ: 31 third-octave bands and B-spline interpolation. */
export const GRAPHIC_EQ_BAND_COUNT = 31;
export const GRAPHIC_EQ_FILTER_LENGTH = FILTER_CURVE_EQ_MAX_FILTER_LENGTH;
export const GRAPHIC_EQ_MIN_GAIN_DB = -25;
export const GRAPHIC_EQ_MAX_GAIN_DB = 25;
export const MAX_GRAPHIC_EQ_TOTAL_SAMPLES = 20_000_000;
export const GRAPHIC_EQ_FREQUENCIES: readonly number[] = Object.freeze([
  20, 25, 31, 40, 50, 63, 80, 100, 125, 160, 200,
  250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000,
  2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000, 20000,
]);

export interface GraphicEqSettings {
  gainsDb: number[];
}

export const DEFAULT_GRAPHIC_EQ_SETTINGS: Readonly<GraphicEqSettings> = Object.freeze({
  gainsDb: Object.freeze(Array(GRAPHIC_EQ_BAND_COUNT).fill(0)) as number[],
});

export type GraphicEqPlan = FilterCurveEqPlan;
export type GraphicEqClipInput = FilterCurveEqClipInput;
export type GraphicEqClipResult = FilterCurveEqClipResult;
export type GraphicEqTrackInput = FilterCurveEqTrackInput;
export type GraphicEqTrackResult = FilterCurveEqTrackResult;

interface BandLayout {
  count: number;
  hiFrequency: number;
  positions: number[];
}

export function validateGraphicEqSettings(settings: GraphicEqSettings): void {
  if (!Array.isArray(settings.gainsDb) || settings.gainsDb.length !== GRAPHIC_EQ_BAND_COUNT) {
    throw new RangeError(`Graphic EQ 必须包含 ${GRAPHIC_EQ_BAND_COUNT} 个频段增益`);
  }
  settings.gainsDb.forEach((gain, index) => {
    if (!Number.isFinite(gain) || gain < GRAPHIC_EQ_MIN_GAIN_DB || gain > GRAPHIC_EQ_MAX_GAIN_DB) {
      throw new RangeError(`Graphic EQ 第 ${index + 1} 个频段增益必须在 −25 至 25 dB 之间`);
    }
  });
}

function createBandLayout(sampleRate: number): BandLayout {
  if (!Number.isFinite(sampleRate) || sampleRate < 50) {
    throw new RangeError('Graphic EQ 采样率必须是至少 50 Hz 的有限数值，以定义两个 B-spline 频段');
  }
  const hiFrequency = sampleRate / 2;
  const loLog = Math.log10(FILTER_CURVE_EQ_LO_FREQ);
  const denominator = Math.log10(hiFrequency) - loLog;
  const positions: number[] = [];
  for (const frequency of GRAPHIC_EQ_FREQUENCIES) {
    if (frequency > hiFrequency) break;
    positions.push(frequency === FILTER_CURVE_EQ_LO_FREQ ? 0 : (Math.log10(frequency) - loLog) / denominator);
  }
  if (positions.length < 2) throw new RangeError('Graphic EQ 至少需要两个可用频段');
  return { count: positions.length, hiFrequency, positions };
}

export function graphicEqBandsInUse(sampleRate: number): number {
  return createBandLayout(sampleRate).count;
}

function evaluateBspline(gains: readonly number[], layout: BandLayout, when: number): number {
  const { count, positions } = layout;
  let minF = 0;
  while (minF < count && positions[minF] <= when) minF += 1;
  minF -= 1;
  let value: number;
  if (minF < 0) {
    const span = positions[1] - positions[0];
    const s = (when - positions[0]) / span;
    if (s < -1.5) value = 0;
    else if (s < -0.5) value = gains[0] * (s + 1.5) ** 2 / 2;
    else value = gains[0] * (0.75 - s * s) + gains[1] * (s + 0.5) ** 2 / 2;
  } else if (minF >= count - 1 && when >= positions[count - 1]) {
    const span = positions[count - 1] - positions[count - 2];
    const s = (when - positions[count - 1]) / span;
    if (s > 1.5) value = 0;
    else if (s > 0.5) value = gains[count - 1] * (s - 1.5) ** 2 / 2;
    else {
      value = gains[count - 1] * (0.75 - s * s)
        + gains[count - 2] * (s - 0.5) ** 2 / 2;
    }
  } else {
    const span = positions[minF + 1] - positions[minF];
    const s = (when - positions[minF]) / span;
    if (s < 0.5) {
      value = gains[minF] * (0.75 - s * s);
      if (minF + 1 < count) value += gains[minF + 1] * (s + 0.5) ** 2 / 2;
      if (minF - 1 >= 0) value += gains[minF - 1] * (s - 0.5) ** 2 / 2;
    } else {
      value = gains[minF] * (s - 1.5) ** 2 / 2;
      if (minF + 1 < count) value += gains[minF + 1] * (0.75 - (1 - s) ** 2);
      if (minF + 2 < count) value += gains[minF + 2] * (s - 0.5) ** 2 / 2;
    }
  }
  return value;
}

function evaluateWithLayout(gains: readonly number[], layout: BandLayout, frequency: number): number {
  let when: number;
  if (frequency <= FILTER_CURVE_EQ_LO_FREQ) when = 0;
  else if (frequency >= layout.hiFrequency) when = 1;
  else {
    when = (Math.log10(frequency) - Math.log10(FILTER_CURVE_EQ_LO_FREQ))
      / (Math.log10(layout.hiFrequency) - Math.log10(FILTER_CURVE_EQ_LO_FREQ));
  }
  return evaluateBspline(gains, layout, when);
}

export function evaluateGraphicEqDb(
  gainsDb: readonly number[],
  frequency: number,
  sampleRate: number,
): number {
  validateGraphicEqSettings({ gainsDb: [...gainsDb] });
  if (!Number.isFinite(frequency) || frequency < 0) throw new RangeError('Graphic EQ 频率必须是非负有限数值');
  return evaluateWithLayout(gainsDb, createBandLayout(sampleRate), frequency);
}

function signatureFor(settings: GraphicEqSettings): string {
  return JSON.stringify({ filterLength: GRAPHIC_EQ_FILTER_LENGTH, gainsDb: settings.gainsDb });
}

export function isGraphicEqBypassed(settings: GraphicEqSettings): boolean {
  return settings.gainsDb.every((gain) => gain === 0);
}

export function createGraphicEqPlan(
  settings: GraphicEqSettings,
  sampleRate: number,
): GraphicEqPlan | undefined {
  validateGraphicEqSettings(settings);
  const layout = createBandLayout(sampleRate);
  if (isGraphicEqBypassed(settings)) return undefined;
  return createEqualizationPlanFromResponse(
    sampleRate,
    GRAPHIC_EQ_FILTER_LENGTH,
    signatureFor(settings),
    FILTER_CURVE_EQ_LO_FREQ,
    (frequency) => evaluateWithLayout(settings.gainsDb, layout, frequency),
  );
}

export function processGraphicEqChannels(
  channels: readonly Float32Array[],
  settings: GraphicEqSettings,
  sampleRate: number,
  suppliedPlan?: GraphicEqPlan,
): Float32Array[] {
  validateGraphicEqSettings(settings);
  createBandLayout(sampleRate);
  if (isGraphicEqBypassed(settings)) return channels.map((channel) => new Float32Array(channel));
  const plan = suppliedPlan ?? createGraphicEqPlan(settings, sampleRate);
  if (!plan || plan.sampleRate !== sampleRate || plan.signature !== signatureFor(settings)) {
    throw new RangeError('Graphic EQ 滤波计划与当前参数或采样率不一致');
  }
  return processEqualizationChannelsWithPlan(channels, plan, 'Graphic EQ');
}

export function processGraphicEqTrack(
  track: ITrack,
  target: GraphicEqTrackInput,
  selection: GeneratorSelection,
  settings: GraphicEqSettings,
  sampleRate: number,
  suppliedPlan?: GraphicEqPlan,
): GraphicEqTrackResult {
  validateGraphicEqSettings(settings);
  createBandLayout(sampleRate);
  const bypassed = isGraphicEqBypassed(settings);
  const plan = bypassed ? undefined : suppliedPlan ?? createGraphicEqPlan(settings, sampleRate);
  if (!bypassed && (!plan || plan.sampleRate !== sampleRate || plan.signature !== signatureFor(settings))) {
    throw new RangeError('Graphic EQ 滤波计划与当前参数或采样率不一致');
  }
  return processEqualizationTrackWithPlan(track, target, selection, sampleRate, plan, 'Graphic EQ');
}
