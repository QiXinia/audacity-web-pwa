import type { IAnalysisLabel, ILabelTrack, IProject } from '@/types/project';
import { CLIP_COLORS, normalizeClipColorIndex } from '@/lib/clipColor';
import { moveTrackInOrder, type TrackMoveDirection } from '@/lib/trackMove';

export const LEGACY_LABEL_TRACK_ID = 'legacy-label-track';
export const DEFAULT_LABEL_TRACK_NAME = 'Label Track';
export const DEFAULT_LABEL_TRACK_COLOR = '#d3a64f';
const LEGACY_LABEL_TRACK_LIST: ILabelTrack[] = [
  { id: LEGACY_LABEL_TRACK_ID, name: DEFAULT_LABEL_TRACK_NAME, colorIndex: 0 },
];

export type LabelExportFileType = 'txt' | 'srt' | 'vtt';

/** Legacy projects had one implicit lane. Materialize it only when it is edited. */
export function getProjectLabelTracks(project: IProject): ILabelTrack[] {
  if ((project.labelTracks?.length ?? 0) > 0) return project.labelTracks!;
  if ((project.analysisLabels?.length ?? 0) > 0) return LEGACY_LABEL_TRACK_LIST;
  return [];
}

export function resolveAnalysisLabelTrackId(
  label: IAnalysisLabel,
  tracks: readonly ILabelTrack[],
): string {
  if (label.labelTrackId && tracks.some((track) => track.id === label.labelTrackId)) {
    return label.labelTrackId;
  }
  return tracks[0]?.id ?? LEGACY_LABEL_TRACK_ID;
}

function materializeLabelTracks(project: IProject): IProject {
  const labelTracks = getProjectLabelTracks(project).map((track) => ({ ...track }));
  const analysisLabels = (project.analysisLabels ?? []).map((label) => ({
    ...label,
    labelTrackId: resolveAnalysisLabelTrackId(label, labelTracks),
  }));
  return { ...project, labelTracks, analysisLabels };
}

/** Assign edited/new labels to a real Label Track without changing their audio provenance. */
export function replaceAnalysisLabels(
  project: IProject,
  labels: readonly IAnalysisLabel[],
  createId: () => string,
): IProject {
  let base = materializeLabelTracks(project);
  if (labels.length > 0 && base.labelTracks!.length === 0) {
    base = {
      ...base,
      labelTracks: [{ id: createId(), name: DEFAULT_LABEL_TRACK_NAME, colorIndex: 0 }],
    };
  }
  const tracks = base.labelTracks!;
  return {
    ...base,
    analysisLabels: labels.map((label) => ({
      ...label,
      labelTrackId: resolveAnalysisLabelTrackId(label, tracks),
    })),
  };
}

export function appendAnalysisLabels(
  project: IProject,
  labels: readonly IAnalysisLabel[],
  createId: () => string,
): IProject {
  return replaceAnalysisLabels(
    project,
    [...(project.analysisLabels ?? []), ...labels],
    createId,
  );
}

export function renameLabelTrack(project: IProject, trackId: string, name: string): IProject {
  const trimmed = name.trim();
  if (!trimmed) return project;
  const base = materializeLabelTracks(project);
  if (!base.labelTracks!.some((track) => track.id === trackId && track.name !== trimmed)) return project;
  return {
    ...base,
    labelTracks: base.labelTracks!.map((track) => track.id === trackId ? { ...track, name: trimmed } : track),
  };
}

/** Audacity TrackList::Add appends the duplicate and LabelTrack::Duplicate preserves its name. */
export function duplicateLabelTrack(
  project: IProject,
  trackId: string,
  createId: () => string,
): IProject {
  const base = materializeLabelTracks(project);
  const source = base.labelTracks!.find((track) => track.id === trackId);
  if (!source) return project;
  const duplicatedId = createId();
  const duplicated: ILabelTrack = { ...source, id: duplicatedId };
  const copiedLabels = (base.analysisLabels ?? [])
    .filter((label) => label.labelTrackId === trackId)
    .map((label) => ({ ...label, id: createId(), labelTrackId: duplicatedId }));
  return {
    ...base,
    labelTracks: [...base.labelTracks!, duplicated],
    analysisLabels: [...(base.analysisLabels ?? []), ...copiedLabels],
  };
}

export function deleteLabelTrack(project: IProject, trackId: string): IProject {
  const base = materializeLabelTracks(project);
  if (!base.labelTracks!.some((track) => track.id === trackId)) return project;
  return {
    ...base,
    labelTracks: base.labelTracks!.filter((track) => track.id !== trackId),
    analysisLabels: (base.analysisLabels ?? []).filter((label) => label.labelTrackId !== trackId),
  };
}

export function moveLabelTrack(
  project: IProject,
  trackId: string,
  direction: TrackMoveDirection,
): IProject {
  const base = materializeLabelTracks(project);
  const ordered = moveTrackInOrder(base.labelTracks!, trackId, direction);
  if (ordered.every((track, index) => track.id === base.labelTracks![index]?.id)) return project;
  return { ...base, labelTracks: ordered };
}

export function setLabelTrackColor(project: IProject, trackId: string, colorIndex: number): IProject {
  const base = materializeLabelTracks(project);
  const normalized = normalizeClipColorIndex(colorIndex);
  if (normalized === 0 || !base.labelTracks!.some((track) => track.id === trackId)) return project;
  if (base.labelTracks!.some((track) => track.id === trackId && track.colorIndex === normalized)) return project;
  return {
    ...base,
    labelTracks: base.labelTracks!.map((track) => track.id === trackId
      ? { ...track, colorIndex: normalized }
      : track),
  };
}

export function getLabelTrackColor(track: ILabelTrack): string {
  return CLIP_COLORS.find((entry) => entry.index === normalizeClipColorIndex(track.colorIndex))?.color
    ?? DEFAULT_LABEL_TRACK_COLOR;
}

export function serializeLabelTracks(tracks: readonly ILabelTrack[] | undefined): string {
  return JSON.stringify(tracks ?? []);
}

export function deserializeLabelTracks(data: string | null | undefined): ILabelTrack[] {
  if (!data) return [];
  try {
    const parsed: unknown = JSON.parse(data);
    if (!Array.isArray(parsed)) return [];
    const ids = new Set<string>();
    return parsed.flatMap((value): ILabelTrack[] => {
      if (!value || typeof value !== 'object') return [];
      const track = value as Partial<ILabelTrack>;
      if (typeof track.id !== 'string' || !track.id || ids.has(track.id)
        || typeof track.name !== 'string' || !track.name.trim()) return [];
      ids.add(track.id);
      return [{
        id: track.id,
        name: track.name,
        colorIndex: normalizeClipColorIndex(track.colorIndex),
      }];
    });
  } catch {
    return [];
  }
}

export interface LabelImportRecord {
  start: number;
  end: number;
  text: string;
}

export interface LabelImportParseResult {
  labels: LabelImportRecord[];
  rejectedCount: number;
}

function orderedImportRecord(start: number, end: number, text: string): LabelImportRecord {
  return { start: Math.min(start, end), end: Math.max(start, end), text };
}

function parseImportNumber(token: string | undefined): number | null {
  if (!token?.trim()) return null;
  const value = Number(token);
  return Number.isFinite(value) ? value : null;
}

function importLines(content: string): string[] {
  const normalized = content.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

function parseSubRipTimestamp(value: string): number | null {
  const match = value.match(/^([01]\d|2[0-3]):([0-5]\d):([0-5]\d),(\d{3})$/);
  if (!match) return null;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4]) / 1000;
}

function parseTextLabels(lines: readonly string[]): LabelImportParseResult {
  const labels: LabelImportRecord[] = [];
  let rejectedCount = 0;
  let index = 0;
  while (index < lines.length) {
    const fields = lines[index++].split('\t');
    const start = parseImportNumber(fields[0]);
    if (start === null) {
      rejectedCount += 1;
      continue;
    }
    let end = parseImportNumber(fields[1]);
    let text: string;
    if (end === null) {
      end = start;
      text = fields[1] ?? '';
    } else {
      text = fields[2] ?? '';
    }
    let valid = true;
    if (index < lines.length && lines[index].startsWith('\\')) {
      const continuation = lines[index].split('\t');
      valid = continuation[0] === '\\'
        && parseImportNumber(continuation[1]) !== null
        && parseImportNumber(continuation[2]) !== null;
      while (index < lines.length && lines[index].startsWith('\\')) index += 1;
    }
    if (valid) labels.push(orderedImportRecord(start, end, text));
    else rejectedCount += 1;
  }
  return { labels, rejectedCount };
}

function parseSubRipLabels(lines: readonly string[]): LabelImportParseResult {
  const labels: LabelImportRecord[] = [];
  let rejectedCount = 0;
  let index = 0;
  while (index < lines.length) {
    if (lines[index] === '') {
      index += 1;
      continue;
    }
    const identifier = lines[index++];
    const timestamp = lines[index++] ?? '';
    const titleLines: string[] = [];
    while (index < lines.length && lines[index] !== '') titleLines.push(lines[index++]);
    if (index < lines.length) index += 1;
    const match = timestamp.match(/^(.{12}) --> (.{12})$/);
    const start = match ? parseSubRipTimestamp(match[1]) : null;
    const end = match ? parseSubRipTimestamp(match[2]) : null;
    if (!/^[+-]?\d+$/.test(identifier) || start === null || end === null) {
      rejectedCount += 1;
      continue;
    }
    labels.push(orderedImportRecord(start, end, titleLines.join(' ')));
  }
  return { labels, rejectedCount };
}

/** Mirror Audacity 4.0.2 TXT/SRT import; its WebVTT importer is explicitly unsupported. */
export function parseLabelsForImport(content: string, fileName: string): LabelImportParseResult {
  if (/\.vtt$/i.test(fileName)) {
    throw new Error('Importing WebVTT files is not currently supported.');
  }
  const result = /\.srt$/i.test(fileName)
    ? parseSubRipLabels(importLines(content))
    : parseTextLabels(importLines(content));
  result.labels = result.labels
    .map((label, index) => ({ label, index }))
    .sort((left, right) => left.label.start - right.label.start
      || left.label.end - right.label.end || left.index - right.index)
    .map(({ label }) => label);
  return result;
}

/** Audacity creates a separate Label Track for every imported file. */
export function importLabelsAsNewTrack(
  project: IProject,
  imported: readonly LabelImportRecord[],
  audioTrackId: string,
  createId: () => string,
): { project: IProject; labels: IAnalysisLabel[] } {
  const base = materializeLabelTracks(project);
  const labelTrackId = createId();
  const labels = imported.map((label): IAnalysisLabel => ({
    id: createId(),
    kind: 'manual',
    trackId: audioTrackId,
    labelTrackId,
    start: label.start,
    end: label.end,
    text: label.text,
  }));
  return {
    project: {
      ...base,
      labelTracks: [...base.labelTracks!, {
        id: labelTrackId, name: DEFAULT_LABEL_TRACK_NAME, colorIndex: 0,
      }],
      analysisLabels: [...(base.analysisLabels ?? []), ...labels],
    },
    labels,
  };
}

function formatTextNumber(value: number): string {
  if (Object.is(value, -0)) return '0';
  const absolute = Math.abs(value);
  if (absolute !== 0 && (absolute < 1e-4 || absolute >= 1e6)) {
    return value.toExponential(5)
      .replace(/(\.\d*?[1-9])0+e/, '$1e')
      .replace(/\.0+e/, 'e')
      .replace(/e([+-])(\d)$/, 'e$10$2');
  }
  return value.toPrecision(6).replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, '');
}

function formatSubtitleTimestamp(value: number, webvtt: boolean): string {
  // Audacity constructs a UTC wxDateTime from whole seconds, then sets rounded ms.
  const date = new Date(Math.trunc(value) * 1000);
  const milliseconds = ((Math.round(value * 1000) % 1000) + 1000) % 1000;
  const base = [date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds()]
    .map((part) => String(part).padStart(2, '0')).join(':');
  return `${base}${webvtt ? '.' : ','}${String(milliseconds).padStart(3, '0')}`;
}

function labelsForTrack(project: IProject, trackId: string): IAnalysisLabel[] {
  const tracks = getProjectLabelTracks(project);
  return (project.analysisLabels ?? [])
    .filter((label) => resolveAnalysisLabelTrackId(label, tracks) === trackId)
    .map((label, index) => ({ label, index }))
    .sort((left, right) => left.label.start - right.label.start
      || left.label.end - right.label.end || left.index - right.index)
    .map(({ label }) => label);
}

/** Mirror LabelTrack::Export for the browser formats exposed by Audacity 4.0.2. */
export function serializeLabelsForExport(
  project: IProject,
  trackIds: readonly string[],
  fileType: LabelExportFileType,
): string {
  const included = new Set(trackIds);
  const tracks = getProjectLabelTracks(project).filter((track) => included.has(track.id));
  if (tracks.length === 0) throw new Error('请至少选择一条 Label Track');

  const chunks = tracks.map((track) => {
    const labels = labelsForTrack(project, track.id);
    if (fileType === 'txt') {
      return labels.map((label) => [
        formatTextNumber(label.start), formatTextNumber(label.end), label.text,
      ].join('\t') + '\n').join('');
    }
    const header = fileType === 'vtt' ? 'WEBVTT\n\n' : '';
    return header + labels.map((label, index) => [
      String(index + 1),
      `${formatSubtitleTimestamp(label.start, fileType === 'vtt')} --> ${formatSubtitleTimestamp(label.end, fileType === 'vtt')}`,
      label.text,
      '',
      '',
    ].join('\n')).join('');
  });
  return chunks.join('');
}
