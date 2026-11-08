export type GeneratorKind = 'tone' | 'chirp' | 'dtmf' | 'noise' | 'silence';

export const GENERATOR_DEFAULT_DURATION = 30;

/** Avoid binary floating-point noise in exact sample-based Duration fields. */
export function formatGeneratorDuration(duration: number): string {
  return Number.isFinite(duration) ? String(Number(duration.toFixed(9))) : '';
}

const STORAGE_PREFIX = 'audacity-web:generator-duration:v1:';

type StorageReader = Pick<Storage, 'getItem'>;
type StorageWriter = Pick<Storage, 'setItem'>;

function browserStorage(): Storage | undefined {
  return typeof window === 'undefined' ? undefined : window.localStorage;
}

/** Audacity generators start at 30 s, then restore their own last duration. */
export function loadGeneratorDuration(kind: GeneratorKind, storage?: StorageReader): number {
  try {
    const raw = (storage ?? browserStorage())?.getItem(`${STORAGE_PREFIX}${kind}`);
    if (raw === null || raw === undefined) return GENERATOR_DEFAULT_DURATION;
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : GENERATOR_DEFAULT_DURATION;
  } catch {
    return GENERATOR_DEFAULT_DURATION;
  }
}

/** Storage denial must not undo a successfully generated clip. */
export function saveGeneratorDuration(
  kind: GeneratorKind,
  duration: number,
  storage?: StorageWriter,
): boolean {
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new RangeError('Generator duration must be greater than zero');
  }
  try {
    const target = storage ?? browserStorage();
    if (!target) return false;
    target.setItem(`${STORAGE_PREFIX}${kind}`, String(duration));
    return true;
  } catch {
    return false;
  }
}
