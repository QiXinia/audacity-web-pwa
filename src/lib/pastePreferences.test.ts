import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PASTE_PREFERENCES,
  PASTE_PREFERENCES_STORAGE_KEY,
  isPasteBehavior,
  isPasteInsertBehavior,
  loadPastePreferences,
  resolveDefaultPasteMode,
  savePastePreferences,
  shouldPasteIntoExistingClip,
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
  it('defaults to PasteOverlap, same-track insertion and a new clip', () => {
    expect(DEFAULT_PASTE_PREFERENCES).toEqual({
      pasteBehavior: 'overlap', pasteInsertBehavior: 'per-track', pasteAsNewClip: true,
    });
    const loaded = loadPastePreferences(memoryStorage());
    expect(loaded).toEqual(DEFAULT_PASTE_PREFERENCES);
    expect(resolveDefaultPasteMode(loaded)).toBe('overlap');
  });

  it.each([
    ['per-track', 'per-track'],
    ['all-tracks', 'all-tracks'],
  ] as const)('dispatches PasteInsert/%s to the matching existing paste operation', (insertBehavior, mode) => {
    expect(resolveDefaultPasteMode({ pasteBehavior: 'insert', pasteInsertBehavior: insertBehavior, pasteAsNewClip: true })).toBe(mode);
    expect(resolveDefaultPasteMode({ pasteBehavior: 'overlap', pasteInsertBehavior: insertBehavior, pasteAsNewClip: true })).toBe('overlap');
  });

  it('round-trips overlap without discarding the selected insertion fallback', () => {
    const storage = memoryStorage();
    const preferences: PastePreferences = { pasteBehavior: 'overlap', pasteInsertBehavior: 'all-tracks', pasteAsNewClip: false };
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

  it('enables existing-clip merging only for non-all-tracks paste when explicitly disabled', () => {
    expect(shouldPasteIntoExistingClip({ pasteAsNewClip: false }, 'overlap')).toBe(true);
    expect(shouldPasteIntoExistingClip({ pasteAsNewClip: false }, 'per-track')).toBe(true);
    expect(shouldPasteIntoExistingClip({ pasteAsNewClip: false }, 'all-tracks')).toBe(false);
    expect(shouldPasteIntoExistingClip({ pasteAsNewClip: true }, 'overlap')).toBe(false);
  });

  it('sanitizes corrupt fields independently and tolerates malformed JSON', () => {
    const storage = memoryStorage();
    storage.values.set(PASTE_PREFERENCES_STORAGE_KEY, JSON.stringify({
      pasteBehavior: 'insert', pasteInsertBehavior: 'invalid', pasteAsNewClip: false,
    }));
    expect(loadPastePreferences(storage)).toEqual({
      pasteBehavior: 'insert', pasteInsertBehavior: 'per-track', pasteAsNewClip: false,
    });
    storage.values.set(PASTE_PREFERENCES_STORAGE_KEY, JSON.stringify({
      pasteBehavior: 'invalid', pasteInsertBehavior: 'all-tracks', pasteAsNewClip: 'invalid',
    }));
    expect(loadPastePreferences(storage)).toEqual({
      pasteBehavior: 'overlap', pasteInsertBehavior: 'all-tracks', pasteAsNewClip: true,
    });
    storage.values.set(PASTE_PREFERENCES_STORAGE_KEY, JSON.stringify({
      pasteBehavior: 'insert', pasteInsertBehavior: 'all-tracks',
    }));
    expect(loadPastePreferences(storage)).toEqual({
      pasteBehavior: 'insert', pasteInsertBehavior: 'all-tracks', pasteAsNewClip: true,
    });
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
    const valid: PastePreferences = { pasteBehavior: 'insert', pasteInsertBehavior: 'all-tracks', pasteAsNewClip: false };
    expect(savePastePreferences(valid, storage)).toBe(true);
    const before = storage.values.get(PASTE_PREFERENCES_STORAGE_KEY);
    expect(savePastePreferences({ ...valid, pasteInsertBehavior: 'bad' as PasteInsertBehavior }, storage)).toBe(false);
    expect(savePastePreferences({ ...valid, pasteAsNewClip: 'bad' as unknown as boolean }, storage)).toBe(false);
    expect(storage.values.get(PASTE_PREFERENCES_STORAGE_KEY)).toBe(before);
  });

  it('reports storage write failures', () => {
    expect(savePastePreferences({ pasteBehavior: 'insert', pasteInsertBehavior: 'per-track', pasteAsNewClip: true }, {
      getItem: () => null,
      setItem: () => { throw new DOMException('full', 'QuotaExceededError'); },
    })).toBe(false);
  });
});
