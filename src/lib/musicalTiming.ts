import type { IProject } from '@/types/project';

export const MIN_TEMPO = 1;
export const MAX_TEMPO = 999;
export const MIN_TIME_SIGNATURE_NUMERATOR = 1;
export const MAX_TIME_SIGNATURE_NUMERATOR = 128;
export const TIME_SIGNATURE_DENOMINATORS = [2, 4, 8, 16, 32, 64] as const;

export type TimeSignature = IProject['timeSignature'];

/** Audacity 4 accepts fractional BPM values in the inclusive 1–999 range. */
export function validateTempo(value: unknown): number | null {
  return typeof value === 'number'
    && Number.isFinite(value)
    && value >= MIN_TEMPO
    && value <= MAX_TEMPO
    ? value
    : null;
}

export function validateTimeSignature(numerator: unknown, denominator: unknown): TimeSignature | null {
  if (
    typeof numerator !== 'number'
    || !Number.isInteger(numerator)
    || numerator < MIN_TIME_SIGNATURE_NUMERATOR
    || numerator > MAX_TIME_SIGNATURE_NUMERATOR
    || typeof denominator !== 'number'
    || !TIME_SIGNATURE_DENOMINATORS.includes(denominator as typeof TIME_SIGNATURE_DENOMINATORS[number])
  ) {
    return null;
  }
  return { numerator, denominator };
}

export function quarterNoteDuration(tempo: unknown): number {
  const validTempo = validateTempo(tempo);
  return validTempo === null ? 0 : 60 / validTempo;
}

/** Audacity 4 bar duration: quarter note × 4/lower × upper. */
export function barDuration(tempo: unknown, timeSignature: unknown): number {
  const quarter = quarterNoteDuration(tempo);
  if (quarter <= 0 || typeof timeSignature !== 'object' || timeSignature === null) return 0;
  const candidate = timeSignature as Partial<TimeSignature>;
  const validSignature = validateTimeSignature(candidate.numerator, candidate.denominator);
  if (!validSignature) return 0;
  return quarter * (4 / validSignature.denominator) * validSignature.numerator;
}

export function updateProjectTempo(project: IProject, value: unknown): IProject {
  const tempo = validateTempo(value);
  return tempo === null || tempo === project.tempo ? project : { ...project, tempo };
}

export function updateProjectTimeSignature(
  project: IProject,
  numerator: unknown,
  denominator: unknown,
): IProject {
  const timeSignature = validateTimeSignature(numerator, denominator);
  if (!timeSignature) return project;
  if (
    timeSignature.numerator === project.timeSignature.numerator
    && timeSignature.denominator === project.timeSignature.denominator
  ) {
    return project;
  }
  return { ...project, timeSignature };
}
