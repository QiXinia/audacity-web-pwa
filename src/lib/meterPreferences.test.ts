import { describe, expect, it } from 'vitest';
import {
  DEFAULT_METER_DB_RANGE,
  getMeterDbRange,
  isMeterDbRange,
  METER_DB_RANGES,
  METER_PREFERENCES_STORAGE_KEY,
  saveMeterDbRange,
  type MeterDbRange,
} from './meterPreferences';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
}

describe('Audacity meter dB range preferences', () => {
  it('provides the eight official ranges and defaults to -60 dB', () => {
    expect(METER_DB_RANGES).toEqual([-36, -48, -60, -72, -84, -96, -120, -144]);
    expect(DEFAULT_METER_DB_RANGE).toBe(-60);
    expect(getMeterDbRange(memoryStorage())).toBe(-60);
    for (const range of METER_DB_RANGES) expect(isMeterDbRange(range)).toBe(true);
    expect(isMeterDbRange(-61)).toBe(false);
    expect(isMeterDbRange('-96')).toBe(false);
  });

  it.each(METER_DB_RANGES)('round-trips the %d dB range', (range) => {
    const storage = memoryStorage();
    expect(saveMeterDbRange(range, storage)).toBe(true);
    expect(JSON.parse(storage.values.get(METER_PREFERENCES_STORAGE_KEY) || '{}')).toEqual({ dbRange: range });
    expect(getMeterDbRange(storage)).toBe(range);
  });

  it('accepts a numeric value and falls back for corrupt or unsupported storage', () => {
    const storage = memoryStorage();
    storage.values.set(METER_PREFERENCES_STORAGE_KEY, '-96');
    expect(getMeterDbRange(storage)).toBe(-96);
    for (const invalid of ['{broken', 'null', '{"dbRange":-61}', '{"dbRange":"-96"}']) {
      storage.values.set(METER_PREFERENCES_STORAGE_KEY, invalid);
      expect(getMeterDbRange(storage)).toBe(-60);
    }
    expect(getMeterDbRange({ getItem: () => { throw new DOMException('denied'); }, setItem: () => {} })).toBe(-60);
  });

  it('rejects unsupported values and reports write failures', () => {
    const storage = memoryStorage();
    expect(saveMeterDbRange(-61 as unknown as MeterDbRange, storage)).toBe(false);
    expect(storage.values.size).toBe(0);
    expect(saveMeterDbRange(-96, {
      getItem: () => null,
      setItem: () => { throw new DOMException('full', 'QuotaExceededError'); },
    })).toBe(false);
  });
});
