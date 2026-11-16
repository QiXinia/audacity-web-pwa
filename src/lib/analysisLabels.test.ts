import { describe, expect, it } from 'vitest';
import { deserializeAnalysisLabels, serializeAnalysisLabels } from './analysisLabels';
import type { IAnalysisLabel } from '@/types/project';

describe('analysis label persistence', () => {
  it('round-trips manual and clipping labels without inventing channel metadata', () => {
    const labels: IAnalysisLabel[] = [
      { id: 'manual-1', kind: 'manual', trackId: 'track-a', start: 1, end: 2, text: '' },
      { id: 'clip-1', kind: 'clipping', trackId: 'track-b', channelIndex: 1, start: 0, end: 0.025, text: '3 of 3' },
    ];
    expect(deserializeAnalysisLabels(serializeAnalysisLabels(labels))).toEqual(labels);
    expect(deserializeAnalysisLabels(serializeAnalysisLabels(labels))[0]).not.toHaveProperty('channelIndex');
  });

  it('drops malformed ranges and clipping labels with missing channels', () => {
    const malformed = JSON.stringify([
      { id: 'bad-range', kind: 'manual', trackId: 'track-a', start: 3, end: 2, text: 'bad' },
      { id: 'bad-clip', kind: 'clipping', trackId: 'track-a', start: 0, end: 1, text: 'bad' },
      { id: 'good', kind: 'manual', trackId: 'track-a', start: 0, end: 0, text: 'point' },
    ]);
    expect(deserializeAnalysisLabels(malformed)).toEqual([
      { id: 'good', kind: 'manual', trackId: 'track-a', start: 0, end: 0, text: 'point' },
    ]);
  });
});
