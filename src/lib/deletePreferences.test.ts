import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DELETE_PREFERENCES,
  DELETE_PREFERENCES_STORAGE_KEY,
  isCloseGapBehavior,
  isDeleteBehavior,
  loadDeletePreferences,
  needsDeleteOnboarding,
  resolveDeleteRippleMode,
  saveDeletePreferences,
  type CloseGapBehavior,
  type DeletePreferences,
} from './deletePreferences';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
}

describe('Audacity 4 delete behavior preferences', () => {
  it('defaults to NotSet plus ClipRipple and requires first-use onboarding', () => {
    expect(DEFAULT_DELETE_PREFERENCES).toEqual({ deleteBehavior: 'not-set', closeGapBehavior: 'per-clip' });
    const loaded = loadDeletePreferences(memoryStorage());
    expect(loaded).toEqual(DEFAULT_DELETE_PREFERENCES);
    expect(needsDeleteOnboarding(loaded)).toBe(true);
    expect(resolveDeleteRippleMode(loaded)).toBe('per-clip');
  });

  it.each([
    ['per-clip', 'per-clip'],
    ['per-track', 'per-track'],
    ['all-tracks', 'all-tracks'],
  ] as const)('resolves CloseGapBehavior %s to the existing non-destructive edit', (closeGapBehavior, mode) => {
    const preferences = { deleteBehavior: 'close-gap', closeGapBehavior } as const;
    expect(needsDeleteOnboarding(preferences)).toBe(false);
    expect(resolveDeleteRippleMode(preferences)).toBe(mode);
    expect(resolveDeleteRippleMode({ ...preferences, deleteBehavior: 'leave-gap' })).toBe('leave-gap');
  });

  it('round-trips leave-gap without discarding the selected close-gap fallback', () => {
    const storage = memoryStorage();
    const preferences: DeletePreferences = { deleteBehavior: 'leave-gap', closeGapBehavior: 'all-tracks' };
    expect(saveDeletePreferences(preferences, storage)).toBe(true);
    expect(JSON.parse(storage.values.get(DELETE_PREFERENCES_STORAGE_KEY) || '{}')).toEqual(preferences);
    expect(loadDeletePreferences(storage)).toEqual(preferences);
  });

  it('validates every official enum and rejects unsupported values', () => {
    for (const value of ['not-set', 'leave-gap', 'close-gap']) expect(isDeleteBehavior(value)).toBe(true);
    for (const value of ['per-clip', 'per-track', 'all-tracks']) expect(isCloseGapBehavior(value)).toBe(true);
    for (const value of [null, 0, '', 'clip-ripple', 'leaveGap']) {
      expect(isDeleteBehavior(value)).toBe(false);
      expect(isCloseGapBehavior(value)).toBe(false);
    }
  });

  it('sanitizes corrupt fields independently and tolerates malformed JSON', () => {
    const storage = memoryStorage();
    storage.values.set(DELETE_PREFERENCES_STORAGE_KEY, JSON.stringify({
      deleteBehavior: 'close-gap', closeGapBehavior: 'invalid',
    }));
    expect(loadDeletePreferences(storage)).toEqual({ deleteBehavior: 'close-gap', closeGapBehavior: 'per-clip' });
    storage.values.set(DELETE_PREFERENCES_STORAGE_KEY, JSON.stringify({
      deleteBehavior: 'invalid', closeGapBehavior: 'per-track',
    }));
    expect(loadDeletePreferences(storage)).toEqual({ deleteBehavior: 'not-set', closeGapBehavior: 'per-track' });
    storage.values.set(DELETE_PREFERENCES_STORAGE_KEY, '{broken');
    expect(loadDeletePreferences(storage)).toEqual(DEFAULT_DELETE_PREFERENCES);
  });

  it('falls back safely when browser storage cannot be read', () => {
    expect(loadDeletePreferences({
      getItem: () => { throw new DOMException('denied'); },
      setItem: () => {},
    })).toEqual(DEFAULT_DELETE_PREFERENCES);
  });

  it('rejects invalid writes without replacing a valid stored preference', () => {
    const storage = memoryStorage();
    const valid: DeletePreferences = { deleteBehavior: 'close-gap', closeGapBehavior: 'per-track' };
    expect(saveDeletePreferences(valid, storage)).toBe(true);
    const before = storage.values.get(DELETE_PREFERENCES_STORAGE_KEY);
    expect(saveDeletePreferences({ ...valid, closeGapBehavior: 'bad' as CloseGapBehavior }, storage)).toBe(false);
    expect(storage.values.get(DELETE_PREFERENCES_STORAGE_KEY)).toBe(before);
  });

  it('reports storage write failures', () => {
    expect(saveDeletePreferences({ deleteBehavior: 'close-gap', closeGapBehavior: 'per-clip' }, {
      getItem: () => null,
      setItem: () => { throw new DOMException('full', 'QuotaExceededError'); },
    })).toBe(false);
  });
});
