import type { SelectionRippleMode } from './selectionEdit';

export const DELETE_PREFERENCES_STORAGE_KEY = 'audacity-web:delete-preferences:v1';

export type DeleteBehavior = 'not-set' | 'leave-gap' | 'close-gap';
export type SelectedDeleteBehavior = Exclude<DeleteBehavior, 'not-set'>;
export type CloseGapBehavior = Exclude<SelectionRippleMode, 'leave-gap'>;

export interface DeletePreferences {
  deleteBehavior: DeleteBehavior;
  closeGapBehavior: CloseGapBehavior;
}

export const DEFAULT_DELETE_PREFERENCES: Readonly<DeletePreferences> = Object.freeze({
  deleteBehavior: 'not-set',
  closeGapBehavior: 'per-clip',
});

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

export function isDeleteBehavior(value: unknown): value is DeleteBehavior {
  return value === 'not-set' || value === 'leave-gap' || value === 'close-gap';
}

export function isCloseGapBehavior(value: unknown): value is CloseGapBehavior {
  return value === 'per-clip' || value === 'per-track' || value === 'all-tracks';
}

export function needsDeleteOnboarding(preferences: DeletePreferences): boolean {
  return preferences.deleteBehavior === 'not-set';
}

export function resolveDeleteRippleMode(preferences: DeletePreferences): SelectionRippleMode {
  return preferences.deleteBehavior === 'leave-gap' ? 'leave-gap' : preferences.closeGapBehavior;
}

/** Load Audacity's NotSet/ClipRipple defaults, preserving each valid stored field independently. */
export function loadDeletePreferences(storage?: StorageLike): DeletePreferences {
  try {
    const target = storage ?? (typeof window === 'undefined' ? undefined : window.localStorage);
    const raw = target?.getItem(DELETE_PREFERENCES_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_DELETE_PREFERENCES };
    const parsed = JSON.parse(raw) as Partial<DeletePreferences> | null;
    return {
      deleteBehavior: isDeleteBehavior(parsed?.deleteBehavior)
        ? parsed.deleteBehavior
        : DEFAULT_DELETE_PREFERENCES.deleteBehavior,
      closeGapBehavior: isCloseGapBehavior(parsed?.closeGapBehavior)
        ? parsed.closeGapBehavior
        : DEFAULT_DELETE_PREFERENCES.closeGapBehavior,
    };
  } catch {
    return { ...DEFAULT_DELETE_PREFERENCES };
  }
}

/** Persist only a complete supported value and report unavailable or full browser storage. */
export function saveDeletePreferences(preferences: DeletePreferences, storage?: StorageLike): boolean {
  if (!isDeleteBehavior(preferences.deleteBehavior)
    || !isCloseGapBehavior(preferences.closeGapBehavior)) return false;
  try {
    const target = storage ?? (typeof window === 'undefined' ? undefined : window.localStorage);
    if (!target) return false;
    target.setItem(DELETE_PREFERENCES_STORAGE_KEY, JSON.stringify({
      deleteBehavior: preferences.deleteBehavior,
      closeGapBehavior: preferences.closeGapBehavior,
    }));
    return true;
  } catch {
    return false;
  }
}
