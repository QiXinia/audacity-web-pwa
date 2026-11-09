export type GeneratorKind = 'tone' | 'chirp' | 'dtmf' | 'noise' | 'silence' | 'pluck';

export const GENERATOR_DEFAULT_DURATION = 30;

const DEFAULT_GENERATOR_DURATIONS: Record<GeneratorKind, number> = {
  tone: GENERATOR_DEFAULT_DURATION,
  chirp: GENERATOR_DEFAULT_DURATION,
  dtmf: 1,
  noise: GENERATOR_DEFAULT_DURATION,
  silence: GENERATOR_DEFAULT_DURATION,
  pluck: 1,
};

export function getDefaultGeneratorDuration(kind: GeneratorKind): number {
  return DEFAULT_GENERATOR_DURATIONS[kind];
}

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

/** Built-ins start at 30 s; Audacity DTMF and Pluck start at 1 s. */
export function loadGeneratorDuration(kind: GeneratorKind, storage?: StorageReader): number {
  const fallback = getDefaultGeneratorDuration(kind);
  try {
    const raw = (storage ?? browserStorage())?.getItem(`${STORAGE_PREFIX}${kind}`);
    if (raw === null || raw === undefined) return fallback;
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  } catch {
    return fallback;
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
