import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PASTE_PREFERENCES,
  PASTE_PREFERENCES_STORAGE_KEY,
  isPasteBehavior,
  isPasteInsertBehavior,
  loadPastePreferences,
  resolveDefaultPasteMode,
  savePastePreferences,
  type PasteInsertBehavior,
  type PastePreferences,
} from './pastePreferences';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
}

describe('Audacity 4 default Paste preferences', () => {
  it('defaults to PasteOverlap and same-track insertion', () => {
    expect(DEFAULT_PASTE_PREFERENCES).toEqual({ pasteBehavior: 'overlap', pasteInsertBehavior: 'per-track' });
    const loaded = loadPastePreferences(memoryStorage());
    expect(loaded).toEqual(DEFAULT_PASTE_PREFERENCES);
    expect(resolveDefaultPasteMode(loaded)).toBe('overlap');
  });

  it.each([
    ['per-track', 'per-track'],
    ['all-tracks', 'all-tracks'],
  ] as const)('dispatches PasteInsert/%s to the matching existing paste operation', (insertBehavior, mode) => {
    expect(resolveDefaultPasteMode({ pasteBehavior: 'insert', pasteInsertBehavior: insertBehavior })).toBe(mode);
    expect(resolveDefaultPasteMode({ pasteBehavior: 'overlap', pasteInsertBehavior: insertBehavior })).toBe('overlap');
  });

  it('round-trips overlap without discarding the selected insertion fallback', () => {
    const storage = memoryStorage();
    const preferences: PastePreferences = { pasteBehavior: 'overlap', pasteInsertBehavior: 'all-tracks' };
    expect(savePastePreferences(preferences, storage)).toBe(true);
    expect(JSON.parse(storage.values.get(PASTE_PREFERENCES_STORAGE_KEY) || '{}')).toEqual(preferences);
    expect(loadPastePreferences(storage)).toEqual(preferences);
  });

  it('validates every supported enum and rejects unsupported values', () => {
    for (const value of ['overlap', 'insert']) expect(isPasteBehavior(value)).toBe(true);
    for (const value of ['per-track', 'all-tracks']) expect(isPasteInsertBehavior(value)).toBe(true);
    for (const value of [null, 0, '', 'per-clip', 'PasteInsertRipple']) {
      expect(isPasteBehavior(value)).toBe(false);
      expect(isPasteInsertBehavior(value)).toBe(false);
    }
  });

  it('sanitizes corrupt fields independently and tolerates malformed JSON', () => {
    const storage = memoryStorage();
    storage.values.set(PASTE_PREFERENCES_STORAGE_KEY, JSON.stringify({
      pasteBehavior: 'insert', pasteInsertBehavior: 'invalid',
    }));
    expect(loadPastePreferences(storage)).toEqual({ pasteBehavior: 'insert', pasteInsertBehavior: 'per-track' });
    storage.values.set(PASTE_PREFERENCES_STORAGE_KEY, JSON.stringify({
      pasteBehavior: 'invalid', pasteInsertBehavior: 'all-tracks',
    }));
    expect(loadPastePreferences(storage)).toEqual({ pasteBehavior: 'overlap', pasteInsertBehavior: 'all-tracks' });
    storage.values.set(PASTE_PREFERENCES_STORAGE_KEY, '{broken');
    expect(loadPastePreferences(storage)).toEqual(DEFAULT_PASTE_PREFERENCES);
  });

  it('falls back safely when browser storage cannot be read', () => {
    expect(loadPastePreferences({
      getItem: () => { throw new DOMException('denied'); },
      setItem: () => {},
    })).toEqual(DEFAULT_PASTE_PREFERENCES);
  });

  it('rejects invalid writes without replacing a valid stored preference', () => {
    const storage = memoryStorage();
    const valid: PastePreferences = { pasteBehavior: 'insert', pasteInsertBehavior: 'all-tracks' };
    expect(savePastePreferences(valid, storage)).toBe(true);
    const before = storage.values.get(PASTE_PREFERENCES_STORAGE_KEY);
    expect(savePastePreferences({ ...valid, pasteInsertBehavior: 'bad' as PasteInsertBehavior }, storage)).toBe(false);
    expect(storage.values.get(PASTE_PREFERENCES_STORAGE_KEY)).toBe(before);
  });

  it('reports storage write failures', () => {
    expect(savePastePreferences({ pasteBehavior: 'insert', pasteInsertBehavior: 'per-track' }, {
      getItem: () => null,
      setItem: () => { throw new DOMException('full', 'QuotaExceededError'); },
    })).toBe(false);
  });
});
