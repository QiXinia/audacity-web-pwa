import { DEFAULT_METER_DB_RANGE } from '@/lib/meterPreferences';

export const DB_WAVE_RULER_WIDTH = 44;

function normalizedRange(dbRange: number): number {
  return Number.isFinite(dbRange) && dbRange < 0 ? -dbRange : -DEFAULT_METER_DB_RANGE;
}

function normalizedZoom(verticalZoom: number): number {
  return Number.isFinite(verticalZoom) && verticalZoom > 0 ? verticalZoom : 1;
}

/**
 * Audacity's logarithmic waveform coordinate, before applying display bounds.
 * Zero and values below the selected dB floor collapse to the centre line.
 */
export function sampleToDbDisplayValue(sample: number, dbRange: number): number {
  if (!Number.isFinite(sample) || sample === 0) return 0;
  const sign = sample < 0 ? -1 : 1;
  const range = normalizedRange(dbRange);
  const db = 20 * Math.log10(Math.abs(sample));
  return sign * Math.max(0, 1 + db / range);
}

/** Map a linear-amplitude sample using Audacity's full- or half-wave display bounds. */
export function sampleToLinearWaveY(
  sample: number,
  height: number,
  verticalZoom = 1,
  halfWave = false,
): number {
  if (!Number.isFinite(height) || height <= 0) return 0;
  const zoom = normalizedZoom(verticalZoom);
  const displayMax = 1 / zoom;
  const displayMin = halfWave ? 0 : -displayMax;
  const value = Number.isFinite(sample) ? sample : 0;
  const clamped = Math.min(displayMax, Math.max(displayMin, value));
  const padding = Math.min(4, height / 2);
  const usableHeight = Math.max(0, height - 2 * padding);
  const y = padding + ((displayMax - clamped) / (displayMax - displayMin)) * usableHeight;
  return Math.min(height - padding, Math.max(padding, y));
}

/** Map one sample into the same vertical coordinates used by the dB ruler. */
export function sampleToDbWaveY(
  sample: number,
  height: number,
  dbRange: number,
  verticalZoom = 1,
  halfWave = false,
): number {
  if (!Number.isFinite(height) || height <= 0) return 0;
  const zoom = normalizedZoom(verticalZoom);
  const value = sampleToDbDisplayValue(sample, dbRange);
  const displayMax = 1 / zoom;
  const padding = Math.min(4, height / 2);
  const usableHeight = Math.max(0, height - 2 * padding);
  const clamped = halfWave ? Math.min(displayMax, Math.max(0, value)) : value;
  const displayMin = halfWave ? 0 : -displayMax;
  const y = padding + ((displayMax - clamped) / (displayMax - displayMin)) * usableHeight;
  return Math.min(height - padding, Math.max(padding, y));
}

/** Position a ruler value on either the positive or negative half-wave. */
export function dbValueToWaveY(
  db: number,
  height: number,
  dbRange: number,
  verticalZoom = 1,
  negative = false,
  halfWave = false,
): number {
  const amplitude = 10 ** (db / 20);
  return sampleToDbWaveY(negative ? -amplitude : amplitude, height, dbRange, verticalZoom, halfWave);
}

/**
 * Build Audacity-style major dB ticks. Candidates advance in three-dB units,
 * but are only accepted when labels have enough vertical separation.
 */
export function buildDbRulerValues(
  height: number,
  dbRange: number,
  verticalZoom = 1,
  minAdjacentStepsHeight = 20,
  halfWave = false,
): number[] {
  const range = normalizedRange(dbRange);
  const zoom = normalizedZoom(verticalZoom);
  const floor = -range;
  const displayMax = 1 / zoom;
  const maxDisplayDb = Math.round((displayMax - 1) * range);
  const difference = Math.max(1, Math.round(maxDisplayDb - floor));
  let increment = difference;

  for (let candidate = 3; candidate < difference; candidate += 3) {
    if (difference % candidate !== 0) continue;
    const previousY = dbValueToWaveY(maxDisplayDb, height, floor, zoom, false, halfWave);
    const nextY = dbValueToWaveY(maxDisplayDb - candidate, height, floor, zoom, false, halfWave);
    if (nextY - previousY >= minAdjacentStepsHeight) {
      increment = candidate;
      break;
    }
  }

  const values: number[] = [];
  for (let value = floor; value < maxDisplayDb; value += increment) values.push(value);
  if (values.at(-1) !== maxDisplayDb) values.push(maxDisplayDb);
  return values;
}

/** Position a Linear (dB) ruler value after Audacity's db_to_linear conversion. */
export function dbValueToLinearWaveY(
  db: number,
  height: number,
  dbRange: number,
  verticalZoom = 1,
  negative = false,
  halfWave = false,
): number {
  const range = normalizedRange(dbRange);
  // Audacity pins the selected dB floor to the zero line even when zoomed beyond it.
  if (Math.abs(db + range) < 1e-9) return sampleToLinearWaveY(0, height, verticalZoom, halfWave);
  const amplitude = 10 ** (db / 20);
  return sampleToLinearWaveY(negative ? -amplitude : amplitude, height, verticalZoom, halfWave);
}

/**
 * Build Linear (dB) major steps using Audacity's 1/2/3/6(/9) spacing families.
 * The floor and current upper display boundary are always included.
 */
export function buildDbLinearRulerValues(
  height: number,
  dbRange: number,
  verticalZoom = 1,
  isStereo = false,
  halfWave = false,
): number[] {
  const range = normalizedRange(dbRange);
  const zoom = normalizedZoom(verticalZoom);
  const floor = -range;
  const maxDisplayDb = 20 * Math.log10(1 / zoom);
  const minFullStepToInfHeight = isStereo ? 14 : 23;
  const minFullStepToZeroHeight = isStereo ? 10 : 14;
  const fullStepSizes = isStereo ? [1, 2, 3, 6, 9] : [1, 2, 3, 6];
  const baselineY = sampleToLinearWaveY(0, height, zoom, halfWave);
  let lowestFullStep = 0;

  for (let value = floor + 3; value < Math.min(0, maxDisplayDb); value += 3) {
    const position = dbValueToLinearWaveY(value, height, floor, zoom, false, halfWave);
    if (baselineY - position > minFullStepToInfHeight && position > minFullStepToZeroHeight) {
      lowestFullStep = value;
      break;
    }
  }

  const values = [floor];
  if (lowestFullStep !== 0) {
    values.push(lowestFullStep);
    let previousValidStep = lowestFullStep;
    for (let step = lowestFullStep + 1; step < maxDisplayDb; step += 1) {
      if (!fullStepSizes.includes(step - previousValidStep)) continue;
      const position = dbValueToLinearWaveY(step, height, floor, zoom, false, halfWave);
      if (position < minFullStepToZeroHeight) break;
      const previousPosition = dbValueToLinearWaveY(
        previousValidStep,
        height,
        floor,
        zoom,
        false,
        halfWave,
      );
      if (previousPosition - position >= 10) {
        values.push(step);
        previousValidStep = step;
      }
    }
  }
  if (values.at(-1) !== maxDisplayDb) values.push(maxDisplayDb);
  return values;
}
