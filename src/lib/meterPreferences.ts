export const METER_DB_RANGES = [-36, -48, -60, -72, -84, -96, -120, -144] as const;
export type MeterDbRange = (typeof METER_DB_RANGES)[number];
export const DEFAULT_METER_DB_RANGE: MeterDbRange = -60;
export const METER_PREFERENCES_STORAGE_KEY = 'audacity-web:meter-preferences:v1';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

export function isMeterDbRange(value: unknown): value is MeterDbRange {
  return typeof value === 'number' && (METER_DB_RANGES as readonly number[]).includes(value);
}

/** Read the playback meter range, falling back to Audacity's -60 dB default. */
export function getMeterDbRange(storage?: StorageLike): MeterDbRange {
  try {
    const target = storage ?? (typeof window === 'undefined' ? undefined : window.localStorage);
    const raw = target?.getItem(METER_PREFERENCES_STORAGE_KEY);
    if (!raw) return DEFAULT_METER_DB_RANGE;
    const parsed: unknown = JSON.parse(raw);
    const value = typeof parsed === 'number'
      ? parsed
      : (parsed as { dbRange?: unknown } | null)?.dbRange;
    return isMeterDbRange(value) ? value : DEFAULT_METER_DB_RANGE;
  } catch {
    return DEFAULT_METER_DB_RANGE;
  }
}

/** Persist only supported values and report browser storage failures to the caller. */
export function saveMeterDbRange(range: MeterDbRange, storage?: StorageLike): boolean {
  if (!isMeterDbRange(range)) return false;
  try {
    const target = storage ?? (typeof window === 'undefined' ? undefined : window.localStorage);
    if (!target) return false;
    target.setItem(METER_PREFERENCES_STORAGE_KEY, JSON.stringify({ dbRange: range }));
    return true;
  } catch {
    return false;
  }
}
