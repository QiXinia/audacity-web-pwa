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

/** Map one sample into the same vertical coordinates used by the dB ruler. */
export function sampleToDbWaveY(
  sample: number,
  height: number,
  dbRange: number,
  verticalZoom = 1,
): number {
  if (!Number.isFinite(height) || height <= 0) return 0;
  const zoom = normalizedZoom(verticalZoom);
  const value = sampleToDbDisplayValue(sample, dbRange);
  const displayMax = 1 / zoom;
  const padding = Math.min(4, height / 2);
  const usableHeight = Math.max(0, height - 2 * padding);
  const y = padding + ((displayMax - value) / (2 * displayMax)) * usableHeight;
  return Math.min(height - padding, Math.max(padding, y));
}

/** Position a ruler value on either the positive or negative half-wave. */
export function dbValueToWaveY(
  db: number,
  height: number,
  dbRange: number,
  verticalZoom = 1,
  negative = false,
): number {
  const amplitude = 10 ** (db / 20);
  return sampleToDbWaveY(negative ? -amplitude : amplitude, height, dbRange, verticalZoom);
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
    const previousY = dbValueToWaveY(maxDisplayDb, height, floor, zoom);
    const nextY = dbValueToWaveY(maxDisplayDb - candidate, height, floor, zoom);
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
