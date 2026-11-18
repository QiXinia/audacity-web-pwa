import type { SelectionPasteMode } from './selectionPaste';

export const PASTE_PREFERENCES_STORAGE_KEY = 'audacity-web:paste-preferences:v1';

export type PasteBehavior = 'overlap' | 'insert';
export type PasteInsertBehavior = Exclude<SelectionPasteMode, 'overlap'>;

export interface PastePreferences {
  pasteBehavior: PasteBehavior;
  pasteInsertBehavior: PasteInsertBehavior;
}

export const DEFAULT_PASTE_PREFERENCES: Readonly<PastePreferences> = Object.freeze({
  pasteBehavior: 'overlap',
  pasteInsertBehavior: 'per-track',
});

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

export function isPasteBehavior(value: unknown): value is PasteBehavior {
  return value === 'overlap' || value === 'insert';
}

export function isPasteInsertBehavior(value: unknown): value is PasteInsertBehavior {
  return value === 'per-track' || value === 'all-tracks';
}

/** Match Audacity 4 pasteDefault(): explicit Paste and… commands bypass this preference. */
export function resolveDefaultPasteMode(preferences: PastePreferences): SelectionPasteMode {
  return preferences.pasteBehavior === 'overlap' ? 'overlap' : preferences.pasteInsertBehavior;
}

/** Load Audacity's PasteOverlap/PasteInsert defaults, preserving valid fields independently. */
export function loadPastePreferences(storage?: StorageLike): PastePreferences {
  try {
    const target = storage ?? (typeof window === 'undefined' ? undefined : window.localStorage);
    const raw = target?.getItem(PASTE_PREFERENCES_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PASTE_PREFERENCES };
    const parsed = JSON.parse(raw) as Partial<PastePreferences> | null;
    return {
      pasteBehavior: isPasteBehavior(parsed?.pasteBehavior)
        ? parsed.pasteBehavior
        : DEFAULT_PASTE_PREFERENCES.pasteBehavior,
      pasteInsertBehavior: isPasteInsertBehavior(parsed?.pasteInsertBehavior)
        ? parsed.pasteInsertBehavior
        : DEFAULT_PASTE_PREFERENCES.pasteInsertBehavior,
    };
  } catch {
    return { ...DEFAULT_PASTE_PREFERENCES };
  }
}

/** Persist only a complete supported value and report unavailable or full browser storage. */
export function savePastePreferences(preferences: PastePreferences, storage?: StorageLike): boolean {
  if (!isPasteBehavior(preferences.pasteBehavior)
    || !isPasteInsertBehavior(preferences.pasteInsertBehavior)) return false;
  try {
    const target = storage ?? (typeof window === 'undefined' ? undefined : window.localStorage);
    if (!target) return false;
    target.setItem(PASTE_PREFERENCES_STORAGE_KEY, JSON.stringify({
      pasteBehavior: preferences.pasteBehavior,
      pasteInsertBehavior: preferences.pasteInsertBehavior,
    }));
    return true;
  } catch {
    return false;
  }
}
