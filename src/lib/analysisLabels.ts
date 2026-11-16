import type { IAnalysisLabel } from '@/types/project';

export function serializeAnalysisLabels(labels: readonly IAnalysisLabel[] | undefined): string {
  return JSON.stringify(labels ?? []);
}

/** Ignore malformed or legacy data rather than fabricating timeline labels. */
export function deserializeAnalysisLabels(data: string | null | undefined): IAnalysisLabel[] {
  if (!data) return [];
  try {
    const parsed: unknown = JSON.parse(data);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((value): IAnalysisLabel[] => {
      if (!value || typeof value !== 'object') return [];
      const label = value as Partial<IAnalysisLabel>;
      if (
        (label.kind !== 'clipping' && label.kind !== 'manual')
        || typeof label.id !== 'string' || label.id.length === 0
        || typeof label.trackId !== 'string' || label.trackId.length === 0
        || !Number.isFinite(label.start) || (label.start ?? -1) < 0
        || !Number.isFinite(label.end) || (label.end ?? -1) < (label.start ?? 0)
        || typeof label.text !== 'string'
      ) return [];
      const common = {
        id: label.id,
        trackId: label.trackId,
        start: label.start!,
        end: label.end!,
        text: label.text,
      };
      if (label.kind === 'manual') return [{ ...common, kind: 'manual' }];
      if (!Number.isSafeInteger(label.channelIndex) || (label.channelIndex ?? -1) < 0) return [];
      return [{ ...common, kind: 'clipping', channelIndex: label.channelIndex! }];
    });
  } catch {
    return [];
  }
}
