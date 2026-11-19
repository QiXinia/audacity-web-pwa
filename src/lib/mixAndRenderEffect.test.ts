import { describe, expect, it } from 'vitest';
import {
  MAX_MIX_AND_RENDER_TOTAL_OUTPUT_SAMPLES,
  renderMixAndRenderTracks,
  resolveMixAndRenderTrackIds,
  type MixAndRenderClipInput,
  type MixAndRenderTrackInput,
} from './mixAndRenderEffect';

function clip(overrides: Partial<MixAndRenderClipInput> = {}): MixAndRenderClipInput {
  return {
    clipId: 'clip-a',
    startTime: 0,
    duration: 0.4,
    sourceOffset: 0,
    gain: 0,
    fadeIn: 0,
    fadeOut: 0,
    sampleData: [Float32Array.from([1, 1, 1, 1])],
    ...overrides,
  };
}

function track(overrides: Partial<MixAndRenderTrackInput> = {}): MixAndRenderTrackInput {
  return { trackId: 'track-a', gain: 0, pan: 0, clips: [clip()], ...overrides };
}

describe('Mix and Render track selection', () => {
  it('combines a selected track and Shift-selected clips in project order', () => {
    expect(resolveMixAndRenderTrackIds(
      ['track-a', 'track-b', 'track-c'], 'track-c', ['track-b', 'track-b', 'missing'],
    )).toEqual(['track-b', 'track-c']);
    expect(resolveMixAndRenderTrackIds(['track-a'], null, [])).toEqual([]);
  });
});

describe('Mix and Render PCM', () => {
  it('renders centre-panned mono inputs to mono with gaps and summed overlaps', () => {
    const result = renderMixAndRenderTracks([
      track({ clips: [clip({ startTime: 0.2, duration: 0.3, sampleData: [Float32Array.from([1, 2, 3])] })] }),
      track({ trackId: 'track-b', clips: [clip({ startTime: 0.3, duration: 0.2, sampleData: [Float32Array.from([0.5, 0.5])] })] }),
    ], 10);

    expect(result.startTime).toBe(0.2);
    expect(result.duration).toBe(0.3);
    expect(result.channels).toHaveLength(1);
    expect(Array.from(result.channels[0]!)).toEqual([1, 2.5, 3.5]);
  });

  it('uses Audacity linear balance for mono and stereo sources without clipping', () => {
    const result = renderMixAndRenderTracks([
      track({
        gain: 20,
        pan: 0.5,
        clips: [clip({ duration: 0.1, sampleData: [Float32Array.from([0.1])] })],
      }),
      track({
        trackId: 'track-b',
        pan: -1,
        clips: [clip({
          clipId: 'clip-b', duration: 0.1,
          sampleData: [Float32Array.from([0.2]), Float32Array.from([0.4])],
        })],
      }),
    ], 10);

    expect(result.channels).toHaveLength(2);
    expect(result.channels[0]?.[0]).toBeCloseTo(0.7, 6);
    expect(result.channels[1]?.[0]).toBeCloseTo(1, 6);
  });

  it('preserves leading and inter-clip silence and bakes clip gain and fades', () => {
    const result = renderMixAndRenderTracks([
      track({ clips: [clip({
        startTime: 0.1,
        gain: -20,
        fadeIn: 0.2,
        fadeOut: 0.2,
      })] }),
    ], 10);

    expect(result.startTime).toBe(0.1);
    const rendered = Array.from(result.channels[0]!);
    [0, 0.05, 0.1, 0.05].forEach((expected, index) => {
      expect(rendered[index]).toBeCloseTo(expected, 6);
    });
  });

  it('honours source offsets produced by stretched clip processing', () => {
    const result = renderMixAndRenderTracks([
      track({ clips: [clip({ sourceOffset: 0.1, duration: 0.2 })] }),
    ], 10);
    expect(Array.from(result.channels[0]!)).toEqual([1, 1]);
  });

  it('renders an explicit shared range, including silence for an empty hard-panned track', () => {
    const empty = renderMixAndRenderTracks([
      track({ pan: -1, clips: [] }),
    ], 10, { startTime: 0.1, endTime: 0.4 });
    expect(empty.startTime).toBe(0.1);
    expect(empty.duration).toBeCloseTo(0.3, 6);
    expect(empty.channels).toHaveLength(2);
    expect(Array.from(empty.channels[0]!)).toEqual([0, 0, 0]);
    expect(Array.from(empty.channels[1]!)).toEqual([0, 0, 0]);

    const earlyClip = renderMixAndRenderTracks([
      track({ pan: -1, clips: [clip({ duration: 0.1, sampleData: [Float32Array.from([1])] })] }),
    ], 10, { startTime: 0, endTime: 0.3 });
    expect(Array.from(earlyClip.channels[0]!)).toEqual([1, 0, 0]);
    expect(Array.from(earlyClip.channels[1]!)).toEqual([0, 0, 0]);
  });

  it('rejects invalid later tracks and non-finite PCM before producing output', () => {
    const invalid = clip({ sampleData: [Float32Array.from([1, Number.NaN, 1, 1])] });
    expect(() => renderMixAndRenderTracks([
      track(),
      track({ trackId: 'track-b', clips: [invalid] }),
    ], 10)).toThrow(/非有限数值/);
    expect(() => renderMixAndRenderTracks([
      track(),
      track({ trackId: 'track-b', pan: 2 }),
    ], 10)).toThrow(/声像/);
  });

  it('rejects unsupported channel layouts, empty tracks and oversized output', () => {
    expect(() => renderMixAndRenderTracks([
      track({ clips: [clip({ sampleData: [new Float32Array(4), new Float32Array(4), new Float32Array(4)] })] }),
    ], 10)).toThrow(/单声道或立体声/);
    expect(() => renderMixAndRenderTracks([track({ clips: [] })], 10)).toThrow(/没有可渲染/);

    const veryLong = clip({ duration: MAX_MIX_AND_RENDER_TOTAL_OUTPUT_SAMPLES + 1 });
    expect(() => renderMixAndRenderTracks([track({ clips: [veryLong] })], 1)).toThrow(/输出过大/);
  });
});
