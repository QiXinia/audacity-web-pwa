import { describe, expect, it } from 'vitest';
import type { IClip, ITrack } from '@/types/project';
import {
  DEFAULT_TRUNCATE_SILENCE_SETTINGS,
  detectSilenceRegions,
  intersectSilenceRegions,
  processTruncateSilenceTracks,
  validateTruncateSilenceSettings,
  type TruncateSilenceSettings,
  type TruncateSilenceTrackInput,
} from './truncateSilenceEffect';

const RATE = 1000;

function settings(patch: Partial<TruncateSilenceSettings> = {}): TruncateSilenceSettings {
  return { ...DEFAULT_TRUNCATE_SILENCE_SETTINGS, ...patch };
}

function clip(id: string, startTime: number, duration: number): IClip {
  return {
    id,
    audioBufferId: `buffer-${id}`,
    startTime,
    offset: 0,
    duration,
    originalDuration: duration,
    stretchRatio: 1,
    gain: 0,
    fadeIn: 0,
    fadeOut: 0,
    name: id,
  };
}

function track(id: string, clips: IClip[] = [clip(id, 0, 4)]): ITrack {
  return {
    id, name: id, type: 'audio', gain: 0, pan: 0, muted: false, solo: false,
    armed: false, color: '', clips, effects: [],
  };
}

function toneWithSilence(silenceStart: number, silenceEnd: number, seconds = 4): Float32Array {
  const pcm = new Float32Array(seconds * RATE);
  pcm.fill(0.5);
  pcm.fill(0, silenceStart * RATE, silenceEnd * RATE);
  return pcm;
}

function target(trackId: string, channels: Float32Array[]): TruncateSilenceTrackInput {
  return {
    trackId,
    clips: [{ clipId: trackId, sampleData: channels, sourceOffset: 0 }],
  };
}

describe('Truncate Silence settings and detection', () => {
  it('matches Audacity 4.0.2 defaults and validates every public range', () => {
    expect(DEFAULT_TRUNCATE_SILENCE_SETTINGS).toEqual({
      thresholdDb: -20,
      minimumDuration: 0.5,
      action: 'truncate',
      truncateDuration: 0.5,
      compressPercent: 50,
      independent: false,
    });
    for (const invalid of [
      settings({ thresholdDb: -81 }),
      settings({ thresholdDb: -19 }),
      settings({ minimumDuration: 0 }),
      settings({ minimumDuration: Number.NaN }),
      settings({ truncateDuration: -0.001 }),
      settings({ compressPercent: 100 }),
      settings({ action: 'other' as TruncateSilenceSettings['action'] }),
    ]) {
      expect(() => validateTruncateSilenceSettings(invalid)).toThrow();
    }
    expect(() => validateTruncateSilenceSettings(settings({ compressPercent: 99.9 }))).not.toThrow();
  });

  it('requires every channel to be strictly below threshold and keeps trailing silence', () => {
    const threshold = 10 ** (-20 / 20);
    const left = new Float32Array(2000);
    const right = new Float32Array(2000);
    left[100] = threshold; // Equal is non-silent in Audacity.
    right[500] = threshold;
    left[500] = threshold * 0.5;
    left[700] = threshold * 1.01;
    right[700] = threshold * 0.5;
    const regions = detectSilenceRegions(
      [left, right],
      settings({ minimumDuration: 0.1 }),
      RATE,
    );
    expect(regions).toEqual([
      { startSample: 0, endSample: 100 },
      { startSample: 101, endSample: 500 },
      { startSample: 501, endSample: 700 },
      { startSample: 701, endSample: 2000 },
    ]);
  });

  it('intersects ordered regions without manufacturing short silence', () => {
    expect(intersectSilenceRegions(
      [{ startSample: 0, endSample: 100 }, { startSample: 200, endSample: 300 }],
      [{ startSample: 50, endSample: 250 }],
    )).toEqual([
      { startSample: 50, endSample: 100 },
      { startSample: 200, endSample: 250 },
    ]);
    expect(intersectSilenceRegions([], [{ startSample: 0, endSample: 100 }])).toEqual([]);
  });
});

describe('Truncate Silence official processing', () => {
  it('centers a truncate cut and leaves exactly the requested silence', () => {
    const source = toneWithSilence(1, 2.5);
    const sourceCopy = new Float32Array(source);
    const result = processTruncateSilenceTracks(
      [track('one')], [target('one', [source])], { start: 0, end: 4 }, settings(), RATE,
    );
    expect(result.silenceRegions).toEqual([{ startSample: 1000, endSample: 2500 }]);
    expect(result.cutSamples).toBe(1000);
    expect(result.selectionEnd).toBe(3);
    expect(result.tracks).toHaveLength(1);
    expect(result.tracks[0].sampleData[0]).toHaveLength(3000);
    expect(result.tracks[0].cuts).toEqual([{
      startSample: 1250,
      endSample: 2250,
      regionStartSample: 1000,
      regionEndSample: 2500,
    }]);
    expect(result.tracks[0].sampleData[0][1249]).toBe(0);
    expect(result.tracks[0].sampleData[0][1250]).toBe(0);
    expect(result.tracks[0].sampleData[0][1500]).toBeCloseTo(0.5);
    expect(source).toEqual(sourceCopy);
  });

  it('applies the 100-frame cross-fade at a zero-duration truncation splice', () => {
    const source = toneWithSilence(1, 2.5);
    const result = processTruncateSilenceTracks(
      [track('one')],
      [target('one', [source])],
      { start: 0, end: 4 },
      settings({ truncateDuration: 0 }),
      RATE,
    );
    const output = result.tracks[0].sampleData[0];
    expect(output).toHaveLength(2500);
    expect(result.tracks[0].cuts[0]).toMatchObject({ startSample: 1000, endSample: 2500 });
    expect(output[950]).toBeCloseTo(0.5);
    expect(output[999]).toBeCloseTo(0.255);
    expect(output[1000]).toBeCloseTo(0.25);
    expect(output[1049]).toBeCloseTo(0.495);
    expect(output[1050]).toBeCloseTo(0.5);
  });

  it('compresses only excess silence using the official percentage formula', () => {
    const result = processTruncateSilenceTracks(
      [track('one')],
      [target('one', [toneWithSilence(1, 2.5)])],
      { start: 0, end: 4 },
      settings({ action: 'compress', compressPercent: 50 }),
      RATE,
    );
    expect(result.cutSamples).toBe(500);
    expect(result.tracks[0].cuts[0]).toMatchObject({ startSample: 1500, endSample: 2000 });
    expect(result.tracks[0].sampleData[0]).toHaveLength(3500);
    expect(result.selectionEnd).toBe(3.5);
  });

  it('cuts only common silence when linked, but separates independent track plans', () => {
    const tracks = [track('one'), track('two')];
    const targets = [
      target('one', [toneWithSilence(1, 3)]),
      target('two', [toneWithSilence(1.5, 2.5)]),
    ];
    const linked = processTruncateSilenceTracks(
      tracks, targets, { start: 0, end: 4 }, settings({ truncateDuration: 0 }), RATE,
    );
    expect(linked.silenceRegions).toEqual([{ startSample: 1500, endSample: 2500 }]);
    expect(linked.tracks.map(({ cutSamples }) => cutSamples)).toEqual([1000, 1000]);
    expect(linked.selectionEnd).toBe(3);

    const independent = processTruncateSilenceTracks(
      tracks, targets, { start: 0, end: 4 }, settings({ truncateDuration: 0, independent: true }), RATE,
    );
    expect(independent.tracks.map(({ cutSamples }) => cutSamples)).toEqual([2000, 1000]);
    // Audacity uses the longest resulting track selection for independent mode.
    expect(independent.selectionEnd).toBe(3);
    expect(independent.tracks[0].sampleData[0]).toHaveLength(2000);
    expect(independent.tracks[1].sampleData[0]).toHaveLength(3000);
  });

  it('detects silence across a timeline gap and a following quiet clip edge', () => {
    const gapped = track('one', [clip('a', 0, 1), clip('b', 2, 2)]);
    const tail = new Float32Array(2000);
    tail.fill(0.5);
    tail.fill(0, 0, 500);
    const input: TruncateSilenceTrackInput = {
      trackId: 'one',
      clips: [
        { clipId: 'a', sampleData: [new Float32Array(1000).fill(0.5)], sourceOffset: 0 },
        { clipId: 'b', sampleData: [tail], sourceOffset: 0 },
      ],
    };
    const result = processTruncateSilenceTracks(
      [gapped], [input], { start: 0, end: 4 }, settings({ truncateDuration: 0 }), RATE,
    );
    expect(result.silenceRegions).toEqual([{ startSample: 1000, endSample: 2500 }]);
    expect(result.tracks[0].sampleData[0]).toHaveLength(2500);
  });

  it('rejects non-finite samples and invalid targets before producing output', () => {
    const invalid = toneWithSilence(1, 2);
    invalid[1200] = Number.NaN;
    expect(() => processTruncateSilenceTracks(
      [track('one')], [target('one', [invalid])], { start: 0, end: 4 }, settings(), RATE,
    )).toThrow('非有限值');
    expect(() => processTruncateSilenceTracks(
      [track('one')], [], { start: 0, end: 4 }, settings(), RATE,
    )).toThrow('没有可应用');
    expect(() => processTruncateSilenceTracks(
      [track('one')], [target('one', [new Float32Array(4000)])],
      { start: 0, end: 4 }, settings(), 0,
    )).toThrow('采样率');
  });
});
