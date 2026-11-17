import { sampleToLinearWaveY } from '@/lib/dbWaveform';

export const LINEAR_RULER_COLLAPSE_HEIGHT = 40;

const STEP_INCREMENTS = [
  { major: 0.1, minor: 0.05 },
  { major: 0.5, minor: 0.1 },
  { major: 0.5, minor: 0.25 },
  { major: 1, minor: 0.5 },
] as const;

const MIN_MAJOR_STEP_HEIGHT = 20;
const MIN_MINOR_STEP_HEIGHT = 10;
const MAX_PRECISION = 4;

export interface LinearRulerTick {
  value: number;
  y: number;
  label: string;
  bold: boolean;
  fullWidth: boolean;
  negative: boolean;
  alignment: 'upper' | 'center' | 'lower';
}

export interface LinearRulerTicks {
  major: LinearRulerTick[];
  minor: LinearRulerTick[];
  collapsed: boolean;
  majorIncrement: number;
  minorIncrement: number;
}

function normalizedZoom(verticalZoom: number): number {
  return Number.isFinite(verticalZoom) && verticalZoom > 0 ? verticalZoom : 1;
}

function displayBounds(verticalZoom: number, halfWave: boolean) {
  const max = 1 / normalizedZoom(verticalZoom);
  return { min: halfWave ? 0 : -max, max };
}

function approximatelyEqual(first: number, second: number): boolean {
  return Math.abs(first - second) < 1e-9;
}

function rounded(value: number): number {
  return Number(value.toFixed(10));
}

/** Audacity LinearBaseRuler::stepsIncrement, including its zoom display factor. */
export function linearRulerIncrements(height: number, verticalZoom = 1, halfWave = false) {
  const { min, max } = displayBounds(verticalZoom, halfWave);
  const factor = (max - min) / 2;
  let increment = { major: factor, minor: 0.5 * factor };

  for (const candidate of STEP_INCREMENTS) {
    if (candidate.major * factor < 1e-4) continue;
    const majorHeight = candidate.major * height / 2;
    const minorHeight = candidate.minor * height / 2;
    if (majorHeight >= MIN_MAJOR_STEP_HEIGHT && minorHeight >= MIN_MINOR_STEP_HEIGHT) {
      increment = { major: candidate.major * factor, minor: candidate.minor * factor };
      break;
    }
  }
  return increment;
}

function stepPrecision(step: number): number {
  let precision = 0;
  while (precision < MAX_PRECISION) {
    const shifted = step * 10 ** precision;
    if (approximatelyEqual(shifted - Math.floor(shifted), 0)) break;
    precision += 1;
  }
  return Math.max(1, Math.min(MAX_PRECISION, precision));
}

/** Linear ruler labels are absolute values with Audacity's 1–4 digit precision. */
export function formatLinearRulerLabel(value: number, majorIncrement: number): string {
  return Math.abs(value).toFixed(stepPrecision(majorIncrement));
}

function rulerValues(min: number, max: number, increment: number): number[] {
  if (approximatelyEqual(min, max)) return [rounded(min)];
  const values: number[] = [];
  for (let value = min, guard = 0; value <= max + increment * 0.5 && guard < 10000; value += increment, guard += 1) {
    values.push(rounded(value));
  }
  return values;
}

/** Build mono/stereo ticks for one channel band, including Audacity's collapsed form. */
export function buildLinearRulerTicks({
  height,
  verticalZoom = 1,
  halfWave = false,
  channel = 0,
  stereo = false,
}: {
  height: number;
  verticalZoom?: number;
  halfWave?: boolean;
  channel?: number;
  stereo?: boolean;
}): LinearRulerTicks {
  const { min, max } = displayBounds(verticalZoom, halfWave);
  const { major: majorIncrement, minor: minorIncrement } = linearRulerIncrements(height, verticalZoom, halfWave);
  const collapsed = height < LINEAR_RULER_COLLAPSE_HEIGHT;
  const majorValues = collapsed
    ? [rounded((max - min) / 2 + min)]
    : rulerValues(min, max, majorIncrement);
  const minorValues = collapsed
    ? [0]
    : rulerValues(min, max, minorIncrement).filter((value) => !majorValues.some((major) => approximatelyEqual(major, value)));

  const makeTick = (value: number, isMajor: boolean): LinearRulerTick => ({
    value,
    y: sampleToLinearWaveY(value, height, verticalZoom, halfWave),
    label: isMajor ? formatLinearRulerLabel(value, majorIncrement) : '',
    bold: isMajor && (collapsed || approximatelyEqual(value, min) || approximatelyEqual(value, max) || approximatelyEqual(value, 0)),
    fullWidth: isMajor && (
      collapsed
      || approximatelyEqual(value, 0)
      || (stereo && ((channel === 0 && approximatelyEqual(value, min)) || (channel === 1 && approximatelyEqual(value, max))))
    ),
    negative: value < 0,
    alignment: approximatelyEqual(value, max) ? 'upper' : approximatelyEqual(value, min) ? 'lower' : 'center',
  });

  return {
    major: majorValues.map((value) => makeTick(value, true)),
    minor: minorValues.map((value) => makeTick(value, false)),
    collapsed,
    majorIncrement,
    minorIncrement,
  };
}
