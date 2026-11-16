import { describe, expect, it } from 'vitest';
import {
  analyzeBeatFinderChannels,
  analyzeBeatFinderTracks,
  DEFAULT_BEAT_FINDER_SETTINGS,
  detectBeatTimes,
  MAX_BEAT_FINDER_LABELS,
  validateBeatFinderSettings,
} from './beatFinder';

const SETTINGS = { ...DEFAULT_BEAT_FINDER_SETTINGS };

function pulseTrack(trackId = 'track-a', startTime = 0) {
  const samples = new Float32Array(2000);
  samples[100] = 1;
  samples[101] = 0.8;
  samples[1500] = 1;
  samples[1501] = 0.8;
  return {
    trackId,
    clips: [{
      clipId: `clip-${trackId}`,
      startTime,
      duration: 2,
      sourceOffset: 0,
      channels: [samples],
    }],
  };
}

describe('Beat finder settings and threshold state machine', () => {
  it('uses the official default and accepts only integer percentages from 5 to 100', () => {
    expect(DEFAULT_BEAT_FINDER_SETTINGS.thresholdPercentage).toBe(65);
    expect(() => validateBeatFinderSettings({ thresholdPercentage: 5 })).not.toThrow();
    expect(() => validateBeatFinderSettings({ thresholdPercentage: 100 })).not.toThrow();
    for (const thresholdPercentage of [4, 101, 65.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => validateBeatFinderSettings({ thresholdPercentage })).toThrow('5 到 100');
    }
  });

  it('labels strict upward crossings and rearms only after falling below threshold', () => {
    expect(detectBeatTimes([0, 0.8, 0.8, 0.4, 0.2, 0.9], 2, 65)).toEqual([2.001, 2.005]);
  });

  it('does not label a sample merely equal to the threshold', () => {
    expect(detectBeatTimes([0.5, 1, 1, 0.999, 1], 0, 100)).toEqual([]);
  });

  it('returns no labels for a silent envelope and caps pathological output', () => {
    expect(detectBeatTimes(new Float64Array(100), 0, 65)).toEqual([]);
    const envelope = Array.from({ length: MAX_BEAT_FINDER_LABELS * 2 + 1 }, (_, index) => index % 2);
    expect(detectBeatTimes(envelope, 0, 65)).toHaveLength(MAX_BEAT_FINDER_LABELS);
  });
});

describe('Beat finder channel analysis', () => {
  it('finds two separated bass pulses as point labels on the 1 ms control axis', () => {
    const track = pulseTrack();
    const times = analyzeBeatFinderChannels(
      track.clips[0].channels,
      { start: 0, end: 2 },
      1000,
      SETTINGS,
    );
    expect(times).toHaveLength(2);
    expect(times[0]).toBeGreaterThanOrEqual(0);
    expect(times[0]).toBeLessThan(0.2);
    // The official 512-sample lookahead can anticipate the second pulse by up to 0.512 s at 1 kHz.
    expect(times[1]).toBeGreaterThan(0.9);
    expect(times[1]).toBeLessThan(1.5);
    for (const time of times) {
      const milliseconds = time * 1000;
      expect(Math.abs(milliseconds - Math.round(milliseconds))).toBeLessThan(1e-8);
    }
  });

  it('sums stereo channels like the official plug-in and preserves cancellation', () => {
    const mono = new Float32Array(1000);
    mono[200] = 0.5;
    const zeros = new Float32Array(1000);
    const negative = mono.map((value) => -value);
    expect(analyzeBeatFinderChannels([mono, mono], { start: 0, end: 1 }, 1000, SETTINGS)).toHaveLength(1);
    expect(analyzeBeatFinderChannels([mono, negative], { start: 0, end: 1 }, 1000, SETTINGS)).toEqual([]);
    expect(analyzeBeatFinderChannels([zeros], { start: 0, end: 1 }, 1000, SETTINGS)).toEqual([]);
  });

  it('maps clips onto the selection timeline and returns B point labels with track ownership', () => {
    const track = pulseTrack('track-b', 4);
    const labels = analyzeBeatFinderTracks([track], { start: 4, end: 6 }, 1000, SETTINGS);
    expect(labels).toHaveLength(2);
    expect(labels[0]).toEqual(expect.objectContaining({ trackId: 'track-b', text: 'B' }));
    for (const label of labels) {
      expect(label.start).toBe(label.end);
      expect(label.start).toBeGreaterThanOrEqual(4);
      expect(label.start).toBeLessThan(6);
    }
  });

  it('rejects silent selections, malformed channels and non-finite samples', () => {
    const track = pulseTrack();
    expect(() => analyzeBeatFinderTracks([], { start: 0, end: 2 }, 1000, SETTINGS)).toThrow('没有可分析');
    expect(() => analyzeBeatFinderChannels(track.clips[0].channels, { start: 0, end: 2 }, 1000, { thresholdPercentage: 65.5 }))
      .toThrow('5 到 100');
    const malformed = new Float32Array(2000);
    malformed[10] = Number.NaN;
    expect(() => analyzeBeatFinderChannels([malformed], { start: 0, end: 2 }, 1000, SETTINGS))
      .toThrow('非有限');
    expect(() => analyzeBeatFinderChannels([new Float32Array(10)], { start: 0, end: 2 }, 1000, SETTINGS))
      .toThrow('等长');
  });
});
