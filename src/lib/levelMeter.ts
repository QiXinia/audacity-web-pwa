export const MIN_METER_DBFS = -60;
export const MAX_METER_DBFS = 0;
export const METER_DECAY_DB_PER_SECOND = 36;

export interface StereoLevels {
  left: number;
  right: number;
}

export function silentStereoLevels(): StereoLevels {
  return { left: MIN_METER_DBFS, right: MIN_METER_DBFS };
}

/** Convert a linear full-scale peak to the clamped dBFS meter range. */
export function peakToDbfs(peak: number): number {
  if (!Number.isFinite(peak) || peak <= 0) return MIN_METER_DBFS;
  const dbfs = 20 * Math.log10(Math.min(1, peak));
  return Math.min(MAX_METER_DBFS, Math.max(MIN_METER_DBFS, dbfs));
}

/** Read the absolute sample peak from one analyser channel. */
export function readAnalyserPeakDbfs(
  analyser: Pick<AnalyserNode, 'getFloatTimeDomainData'>,
  buffer: Float32Array<ArrayBuffer>,
): number {
  if (buffer.length === 0) return MIN_METER_DBFS;
  analyser.getFloatTimeDomainData(buffer);
  let peak = 0;
  for (const sample of buffer) {
    if (Number.isFinite(sample)) peak = Math.max(peak, Math.abs(sample));
  }
  return peakToDbfs(peak);
}

// Audacity 4's DbLinearMeter allocates progressively less screen space to
// successive portions of the dB range instead of using a linear -60…0 scale.
const DB_SECTIONS = [
  { multiplier: 0, percentage: 1 },
  { multiplier: 1 / 3, percentage: 0.5 },
  { multiplier: 1 / 2, percentage: 0.3 },
  { multiplier: 2 / 3, percentage: 0.15 },
  { multiplier: 5 / 6, percentage: 0.075 },
  { multiplier: 1, percentage: 0 },
] as const;

export function dbfsToMeterPercent(value: number): number {
  const dbfs = Number.isFinite(value)
    ? Math.min(MAX_METER_DBFS, Math.max(MIN_METER_DBFS, value))
    : MIN_METER_DBFS;
  if (dbfs >= MAX_METER_DBFS) return 100;

  for (let index = 0; index < DB_SECTIONS.length - 1; index++) {
    const left = DB_SECTIONS[index];
    const right = DB_SECTIONS[index + 1];
    const leftDb = left.multiplier * MIN_METER_DBFS;
    const rightDb = right.multiplier * MIN_METER_DBFS;
    if (dbfs <= leftDb && dbfs > rightDb) {
      const ratio = (dbfs - rightDb) / (leftDb - rightDb);
      return (right.percentage + ratio * (left.percentage - right.percentage)) * 100;
    }
  }
  return 0;
}

/** Audacity 4-style peak decay: rise immediately, fall at 36 dB per second. */
export function decayDbfs(previous: number, instantaneous: number, elapsedSeconds: number): number {
  const current = Number.isFinite(previous) ? previous : MIN_METER_DBFS;
  const next = Number.isFinite(instantaneous) ? instantaneous : MIN_METER_DBFS;
  const elapsed = Number.isFinite(elapsedSeconds) ? Math.max(0, elapsedSeconds) : 0;
  const decayed = current - METER_DECAY_DB_PER_SECOND * elapsed;
  return Math.min(
    MAX_METER_DBFS,
    Math.max(MIN_METER_DBFS, next, decayed),
  );
}

export function formatDbfs(value: number): string {
  if (!Number.isFinite(value) || value <= MIN_METER_DBFS) return '-∞';
  return Math.min(MAX_METER_DBFS, value).toFixed(1);
}
