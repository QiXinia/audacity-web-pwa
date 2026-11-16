import { describe, expect, it } from 'vitest';
import {
  analyzeFindClippingTracks,
  detectFindClippingRuns,
  validateFindClippingSettings,
  type FindClippingClip,
} from './findClipping';
import { deserializeAnalysisLabels, serializeAnalysisLabels } from './analysisLabels';
import type { IAnalysisLabel } from '@/types/project';

const DEFAULTS = { startThreshold: 3, stopThreshold: 3 };

describe('Audacity FindClippingBase run semantics', () => {
  it('labels a full-scale run only after the stop threshold and keeps upstream boundaries', () => {
    expect(detectFindClippingRuns(new Float32Array([1, -1, 1, 0, 0, 0]), 10, 8, DEFAULTS))
      .toEqual([{ start: 10, end: 10.25, text: '3 of 3' }]);
  });

  it('accepts interrupted clipped runs using the official aggregate counters', () => {
    expect(detectFindClippingRuns(new Float32Array([1, 1, 1, 0, -1, 0, 0, 0]), 0, 8, DEFAULTS))
      .toEqual([{ start: 0, end: 0.5, text: '4 of 5' }]);
  });

  it('does not flush a run at the selection end, matching upstream', () => {
    expect(detectFindClippingRuns(new Float32Array([1, 1, 1]), 0, 8, DEFAULTS)).toEqual([]);
    expect(detectFindClippingRuns(new Float32Array([1, 1, 1, 0, 0]), 0, 8, DEFAULTS)).toEqual([]);
  });

  it('rejects short runs and values below full scale', () => {
    expect(detectFindClippingRuns(new Float32Array([1, 1, 0, 0, 0, 0.999, 0.999, 0.999]), 0, 8, DEFAULTS))
      .toEqual([]);
    expect(detectFindClippingRuns(new Float32Array([1, 1]), 0, 8, { startThreshold: 3, stopThreshold: 1 }))
      .toEqual([]);
  });

  it('validates positive integer thresholds and analysis timebase', () => {
    expect(() => validateFindClippingSettings({ startThreshold: 0, stopThreshold: 3 })).toThrow('Start threshold');
    expect(() => validateFindClippingSettings({ startThreshold: 3, stopThreshold: 1.5 })).toThrow('Stop threshold');
    expect(() => detectFindClippingRuns(new Float32Array([1]), 0, 0, DEFAULTS)).toThrow('采样率');
    expect(() => detectFindClippingRuns(new Float32Array([1]), -1, 8, DEFAULTS)).toThrow('选区起点');
  });
});

describe('Find Clipping selected-track timelines', () => {
  function clip(id: string, startTime: number, values: number[]): FindClippingClip {
    return {
      clipId: id,
      startTime,
      duration: values.length / 8,
      sourceOffset: 0,
      channels: [new Float32Array(values)],
    };
  }

  it('keeps track/channel identity and treats clip gaps as silence', () => {
    const labels = analyzeFindClippingTracks([
      { trackId: 'track-b', clips: [clip('b1', 0, [1, 1, 1]), clip('b2', 0.75, [0, 0, 0])] },
      { trackId: 'track-a', clips: [clip('a1', 0, [0, 0, 0, 0, 0, 0, 0, 0])] },
    ], { start: 0, end: 1 }, 8, DEFAULTS);
    expect(labels).toEqual([{ trackId: 'track-b', channelIndex: 0, start: 0, end: 0.25, text: '3 of 3' }]);
  });

  it('analyzes stereo channels independently without mixing them', () => {
    const stereo: FindClippingClip = {
      ...clip('stereo', 2, [1, 1, 1, 0, 0, 0]),
      channels: [new Float32Array([1, 1, 1, 0, 0, 0]), new Float32Array([0, 0, 0, 0, 0, 0])],
    };
    expect(analyzeFindClippingTracks([{ trackId: 'stereo-track', clips: [stereo] }], { start: 2, end: 2.75 }, 8, DEFAULTS))
      .toEqual([{ trackId: 'stereo-track', channelIndex: 0, start: 2, end: 2.25, text: '3 of 3' }]);
  });

  it('rejects empty input, invalid selections and inconsistent channels', () => {
    expect(() => analyzeFindClippingTracks([], { start: 0, end: 1 }, 8, DEFAULTS)).toThrow('没有可分析的音频');
    expect(() => analyzeFindClippingTracks([], { start: 1, end: 1 }, 8, DEFAULTS)).toThrow('正长度时间选区');
    const inconsistent = clip('bad', 0, [0, 0]);
    inconsistent.channels = [new Float32Array(2), new Float32Array(2)];
    const other = clip('other', 0.5, [0, 0]);
    expect(() => analyzeFindClippingTracks([{ trackId: 'bad-track', clips: [inconsistent, other] }], { start: 0, end: 1 }, 8, DEFAULTS))
      .toThrow('声道布局不一致');
  });
});

describe('analysis label persistence', () => {
  const label: IAnalysisLabel = {
    id: 'label-1', kind: 'clipping', trackId: 'track-1', channelIndex: 1,
    start: 1, end: 1.25, text: '3 of 3',
  };

  it('round-trips valid labels and defaults legacy projects to an empty track', () => {
    expect(deserializeAnalysisLabels(serializeAnalysisLabels([label]))).toEqual([label]);
    expect(deserializeAnalysisLabels(undefined)).toEqual([]);
    expect(deserializeAnalysisLabels('not json')).toEqual([]);
  });

  it('drops malformed labels instead of rendering invalid timeline regions', () => {
    const serialized = JSON.stringify([label, { ...label, end: 0 }, { ...label, channelIndex: -1 }, null]);
    expect(deserializeAnalysisLabels(serialized)).toEqual([label]);
  });
});
