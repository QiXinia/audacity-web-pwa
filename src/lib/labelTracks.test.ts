import { describe, expect, it } from 'vitest';
import type { IAnalysisLabel, IProject } from '@/types/project';
import {
  appendAnalysisLabels,
  deleteLabelTrack,
  deserializeLabelTracks,
  duplicateLabelTrack,
  getProjectLabelTracks,
  importLabelsAsNewTrack,
  moveLabelTrack,
  parseLabelsForImport,
  renameLabelTrack,
  replaceAnalysisLabels,
  serializeLabelTracks,
  serializeLabelsForExport,
  setLabelTrackColor,
} from '@/lib/labelTracks';

function label(id: string, labelTrackId: string | undefined, start: number, text = id): IAnalysisLabel {
  return {
    id,
    kind: 'manual',
    trackId: 'audio-1',
    labelTrackId,
    start,
    end: start + 0.25,
    text,
  };
}

function project(labels: IAnalysisLabel[] = []): IProject {
  return {
    id: 'project-1',
    name: 'Test',
    sampleRate: 48000,
    timeSignature: { numerator: 4, denominator: 4 },
    tempo: 120,
    tracks: [{
      id: 'audio-1', name: 'Audio', type: 'audio', gain: 0, pan: 0,
      muted: false, solo: false, armed: false, color: '#66A3FF', clips: [], effects: [],
    }],
    cursorPosition: 0,
    selection: null,
    analysisLabels: labels,
    viewState: { horizontalZoom: 100, verticalZoom: 1, scrollX: 0, viewMode: 'waveform' },
    updatedAt: 1,
    createdAt: 1,
  };
}

describe('Label Track model and transactions', () => {
  it('materializes the legacy implicit lane only when labels are replaced', () => {
    const original = project([label('old', undefined, 1)]);
    expect(getProjectLabelTracks(original)).toEqual([
      { id: 'legacy-label-track', name: 'Label Track', colorIndex: 0 },
    ]);
    const updated = replaceAnalysisLabels(original, original.analysisLabels!, () => 'unused');
    expect(updated.labelTracks).toHaveLength(1);
    expect(updated.analysisLabels?.[0]).toMatchObject({
      id: 'old', trackId: 'audio-1', labelTrackId: 'legacy-label-track',
    });
    expect(original.labelTracks).toBeUndefined();
  });

  it('creates a real lane for the first generated label and appends later labels', () => {
    const ids = ['lane-1'];
    const updated = appendAnalysisLabels(project(), [label('new', undefined, 0)], () => ids.shift()!);
    expect(updated.labelTracks).toEqual([{ id: 'lane-1', name: 'Label Track', colorIndex: 0 }]);
    expect(updated.analysisLabels?.[0].labelTrackId).toBe('lane-1');
    const appended = appendAnalysisLabels(updated, [label('second', undefined, 2)], () => 'unused');
    expect(appended.analysisLabels?.map((item) => item.labelTrackId)).toEqual(['lane-1', 'lane-1']);
  });

  it('duplicates the lane and all labels with fresh identities and preserves the official name', () => {
    const base = replaceAnalysisLabels(project([label('source-label', undefined, 1)]), project([label('source-label', undefined, 1)]).analysisLabels!, () => 'unused');
    const ids = ['copy-lane', 'copy-label'];
    const updated = duplicateLabelTrack(base, 'legacy-label-track', () => ids.shift()!);
    expect(updated.labelTracks?.map((track) => track.name)).toEqual(['Label Track', 'Label Track']);
    expect(updated.labelTracks?.map((track) => track.id)).toEqual(['legacy-label-track', 'copy-lane']);
    expect(updated.analysisLabels).toHaveLength(2);
    expect(updated.analysisLabels?.[1]).toMatchObject({ id: 'copy-label', labelTrackId: 'copy-lane' });
    expect(updated.analysisLabels?.[0]).toMatchObject({ id: 'source-label', labelTrackId: 'legacy-label-track' });
  });

  it('renames, moves, colors and deletes lanes without touching audio tracks', () => {
    let current = replaceAnalysisLabels(project([label('a', undefined, 1)]), project([label('a', undefined, 1)]).analysisLabels!, () => 'unused');
    const ids = ['lane-2', 'label-2'];
    current = duplicateLabelTrack(current, 'legacy-label-track', () => ids.shift()!);
    current = renameLabelTrack(current, 'lane-2', '  Markers  ');
    expect(current.labelTracks?.[1].name).toBe('Markers');
    current = moveLabelTrack(current, 'lane-2', 'top');
    expect(current.labelTracks?.map((track) => track.id)).toEqual(['lane-2', 'legacy-label-track']);
    expect(moveLabelTrack(current, 'lane-2', 'up')).toBe(current);
    current = setLabelTrackColor(current, 'lane-2', 4);
    expect(current.labelTracks?.[0].colorIndex).toBe(4);
    current = deleteLabelTrack(current, 'lane-2');
    expect(current.labelTracks?.map((track) => track.id)).toEqual(['legacy-label-track']);
    expect(current.analysisLabels?.map((item) => item.labelTrackId)).toEqual(['legacy-label-track']);
    expect(current.tracks.map((track) => track.id)).toEqual(['audio-1']);
  });

  it('round-trips valid lanes and rejects malformed or duplicate records', () => {
    const serialized = serializeLabelTracks([
      { id: 'a', name: 'A', colorIndex: 3 },
      { id: 'b', name: 'B', colorIndex: 99 },
    ]);
    expect(deserializeLabelTracks(serialized)).toEqual([
      { id: 'a', name: 'A', colorIndex: 3 },
      { id: 'b', name: 'B', colorIndex: 0 },
    ]);
    expect(deserializeLabelTracks('[{"id":"a","name":"A"},{"id":"a","name":"dup"},{"id":"b","name":""}]')).toEqual([
      { id: 'a', name: 'A', colorIndex: 0 },
    ]);
    expect(deserializeLabelTracks('not-json')).toEqual([]);
  });
});

describe('Audacity LabelTrack export formats', () => {
  it('writes sorted TXT rows with six significant digits and only selected lanes', () => {
    const current = project([
      label('later', 'b', 1.25, 'Later'),
      label('small', 'a', 0.00001, 'Small'),
      label('first', 'a', 1, 'First'),
    ]);
    current.labelTracks = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }];
    expect(serializeLabelsForExport(current, ['a'], 'txt')).toBe(
      '1e-05\t0.25001\tSmall\n1\t1.25\tFirst\n',
    );
  });

  it('writes official SubRip numbering per lane and WebVTT headers/timestamps', () => {
    const current = project([
      { ...label('a1', 'a', 0, 'A1'), end: 1.25 },
      { ...label('b1', 'b', 3661.5, 'B1'), end: 3662 },
    ]);
    current.labelTracks = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }];
    expect(serializeLabelsForExport(current, ['a', 'b'], 'srt')).toBe(
      '1\n00:00:00,000 --> 00:00:01,250\nA1\n\n'
      + '1\n01:01:01,500 --> 01:01:02,000\nB1\n\n',
    );
    expect(serializeLabelsForExport(current, ['b'], 'vtt')).toBe(
      'WEBVTT\n\n1\n01:01:01.500 --> 01:01:02.000\nB1\n\n',
    );
  });

  it('rejects an empty track selection', () => {
    expect(() => serializeLabelsForExport(project(), [], 'txt')).toThrow('请至少选择一条 Label Track');
  });
});

describe('Audacity LabelTrack import', () => {
  it('round-trips TXT point/region labels, continuation lines, ordering and reversed times', () => {
    const result = parseLabelsForImport([
      '2\t1\tReverse',
      '0.5\tPoint',
      '1e-05\t0.25001\tSmall',
      '\\\t20\t20000',
      'bad\t0\tRejected',
    ].join('\r\n') + '\r\n', 'LABELS.TXT');
    expect(result).toEqual({
      labels: [
        { start: 0.00001, end: 0.25001, text: 'Small' },
        { start: 0.5, end: 0.5, text: 'Point' },
        { start: 1, end: 2, text: 'Reverse' },
      ],
      rejectedCount: 1,
    });
  });

  it('reads SubRip cues with multiline text and reports malformed cues without losing valid ones', () => {
    const result = parseLabelsForImport([
      '1',
      '00:00:02,000 --> 00:00:01,000',
      'Second line',
      'joined',
      '',
      'not-a-number',
      'bad timestamp',
      'Rejected',
      '',
      '2',
      '01:01:01,500 --> 01:01:02,000',
      'Valid',
      '',
    ].join('\n'), 'captions.srt');
    expect(result).toEqual({
      labels: [
        { start: 1, end: 2, text: 'Second line joined' },
        { start: 3661.5, end: 3662, text: 'Valid' },
      ],
      rejectedCount: 1,
    });
  });

  it('matches the official WebVTT limitation without creating an empty lane', () => {
    expect(() => parseLabelsForImport('WEBVTT\n', 'captions.vtt'))
      .toThrow('Importing WebVTT files is not currently supported.');
  });

  it('appends one independently owned Label Track for each imported file', () => {
    const original = project([label('existing', undefined, 0)]);
    const ids = ['import-lane', 'imported-label'];
    const result = importLabelsAsNewTrack(original, [
      { start: 1, end: 2, text: 'Imported' },
    ], 'audio-1', () => ids.shift()!);
    expect(result.project.labelTracks).toEqual([
      { id: 'legacy-label-track', name: 'Label Track', colorIndex: 0 },
      { id: 'import-lane', name: 'Label Track', colorIndex: 0 },
    ]);
    expect(result.labels).toEqual([expect.objectContaining({
      id: 'imported-label', kind: 'manual', trackId: 'audio-1', labelTrackId: 'import-lane',
      start: 1, end: 2, text: 'Imported',
    })]);
    expect(result.project.analysisLabels).toHaveLength(2);
    expect(original.labelTracks).toBeUndefined();
    expect(original.analysisLabels).toHaveLength(1);
  });
});
