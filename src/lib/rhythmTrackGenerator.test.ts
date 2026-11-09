import { describe, expect, it } from 'vitest';
import {
  RHYTHM_CLICK_TYPES,
  RHYTHM_DEFAULT_BARS,
  RHYTHM_DEFAULT_BEATS_PER_BAR,
  RHYTHM_DEFAULT_STRONG_MIDI,
  RHYTHM_DEFAULT_TEMPO,
  RHYTHM_DEFAULT_WEAK_MIDI,
  generateRhythmTrack,
  getRhythmTrackPlan,
  type RhythmTrackRequest,
} from '@/lib/rhythmTrackGenerator';

function request(overrides: Partial<RhythmTrackRequest> = {}): RhythmTrackRequest {
  return {
    tempo: 120,
    beatsPerBar: 4,
    swing: 0,
    bars: 1,
    duration: 0,
    offset: 0,
    clickType: 'pingShort',
    strongMidi: 84,
    weakMidi: 80,
    sampleRate: 1000,
    seed: 1,
    ...overrides,
  };
}

function peak(samples: Float32Array, start = 0, end = samples.length): number {
  let result = 0;
  for (let index = start; index < Math.min(end, samples.length); index += 1) {
    result = Math.max(result, Math.abs(samples[index]));
  }
  return result;
}

function expectFinite(samples: Float32Array): void {
  for (const sample of samples) expect(Number.isFinite(sample)).toBe(true);
}

describe('Audacity Rhythm Track timing contract', () => {
  it('exposes the current official defaults', () => {
    expect(RHYTHM_DEFAULT_TEMPO).toBe(120);
    expect(RHYTHM_DEFAULT_BEATS_PER_BAR).toBe(4);
    expect(RHYTHM_DEFAULT_BARS).toBe(16);
    expect(RHYTHM_DEFAULT_STRONG_MIDI).toBe(84);
    expect(RHYTHM_DEFAULT_WEAK_MIDI).toBe(80);
    const plan = getRhythmTrackPlan(request({ bars: 16, sampleRate: 44100 }));
    expect(plan.barCount).toBe(16);
    expect(plan.measureDuration).toBe(2);
    expect(plan.clickTrackDuration).toBe(32);
    expect(plan.sampleCount).toBe(1411200);
    expect(plan.beats).toHaveLength(64);
  });

  it('rounds a duration-driven track up to a whole number of bars', () => {
    const plan = getRhythmTrackPlan(request({ bars: 0, duration: 2.01 }));
    expect(plan.barCount).toBe(2);
    expect(plan.clickTrackDuration).toBe(4);
    expect(plan.sampleCount).toBe(4000);
  });

  it('does not add an extra bar when duration is already exact', () => {
    const plan = getRhythmTrackPlan(request({ bars: 0, duration: 2 }));
    expect(plan.barCount).toBe(1);
    expect(plan.clickTrackDuration).toBe(2);
  });

  it('uses cumulative absolute bar-end rounding for fractional samples', () => {
    const plan = getRhythmTrackPlan(request({ bars: 2, beatsPerBar: 3, sampleRate: 7 }));
    expect(plan.measureDuration).toBe(1.5);
    expect(plan.clickTrackSampleCount).toBe(21);
    expect(plan.duration).toBe(3);
    expect(plan.beats).toHaveLength(6);
  });

  it.each([-1, 0, 1])('applies official alternate-beat swing adjustment at swing=%s', (swing) => {
    const plan = getRhythmTrackPlan(request({ tempo: 60, bars: 2, swing }));
    const expected = [
      0, 1 + swing / 3, 2, 3 + swing / 3,
      4, 5 + swing / 3, 6, 7 + swing / 3,
    ];
    plan.beats.forEach((beat, index) => expect(beat.time).toBeCloseTo(expected[index], 12));
    expect(plan.beats.filter((beat) => beat.accent).map((beat) => beat.time)).toEqual([0, 4]);
  });

  it('allocates offset silence without changing the click-track duration', () => {
    const result = generateRhythmTrack(request({ tempo: 60, bars: 1, beatsPerBar: 1, offset: 0.25 }));
    expect(result.offsetSamples).toBe(250);
    expect(result.clickTrackSampleCount).toBe(1000);
    expect(result.samples).toHaveLength(1250);
    expect(peak(result.samples, 0, 250)).toBe(0);
    expect(peak(result.samples, 250)).toBeGreaterThan(0);
  });

  it('rejects a request with neither bars nor positive duration', () => {
    expect(() => getRhythmTrackPlan(request({ bars: 0, duration: 0 }))).toThrow(
      'Set either Number of bars or Rhythm track duration',
    );
  });
});

describe('Audacity Rhythm Track click synthesis', () => {
  it.each(RHYTHM_CLICK_TYPES)('renders finite non-zero audio for %s', (clickType) => {
    const result = generateRhythmTrack(request({
      clickType,
      beatsPerBar: 1,
      sampleRate: 8000,
      seed: 7,
    }));
    expect(result.samples.length).toBe(4000);
    expectFinite(result.samples);
    expect(peak(result.samples)).toBeGreaterThan(0);
  });

  it('keeps the official 0.75 strong and 0.5 weak ping gains', () => {
    const result = generateRhythmTrack(request({
      tempo: 30,
      beatsPerBar: 2,
      clickType: 'pingLong',
      strongMidi: 60,
      weakMidi: 60,
      sampleRate: 8000,
    }));
    const strongPeak = peak(result.samples, 0, 8000);
    const weakPeak = peak(result.samples, 16000, 24000);
    expect(strongPeak).toBeCloseTo(0.75, 2);
    expect(weakPeak).toBeCloseTo(0.5, 2);
    expect(strongPeak / weakPeak).toBeCloseTo(1.5, 2);
  });

  it('reuses the same strong and weak clicks in every measure', () => {
    const result = generateRhythmTrack(request({
      tempo: 60,
      beatsPerBar: 1,
      bars: 2,
      clickType: 'pingLong',
      sampleRate: 8000,
    }));
    const first = result.samples.slice(0, 640);
    const second = result.samples.slice(8000, 8640);
    expect(second).toEqual(first);
  });

  it('uses an explicit seed for reproducible noise regression tests', () => {
    const settings = request({ clickType: 'resonantNoise', seed: 123, sampleRate: 8000 });
    const first = generateRhythmTrack(settings).samples;
    const second = generateRhythmTrack(settings).samples;
    const different = generateRhythmTrack({ ...settings, seed: 124 }).samples;
    expect(second).toEqual(first);
    expect(different).not.toEqual(first);
  });

  it('changes timbre when strong and weak MIDI pitches change', () => {
    const low = generateRhythmTrack(request({ strongMidi: 48, sampleRate: 8000 })).samples;
    const high = generateRhythmTrack(request({ strongMidi: 96, sampleRate: 8000 })).samples;
    expect(high).not.toEqual(low);
  });
});

describe('Rhythm Track fail-closed validation', () => {
  it.each([
    ['tempo', 29], ['tempo', 301], ['tempo', Number.NaN],
    ['beatsPerBar', 0], ['beatsPerBar', 21], ['beatsPerBar', 1.5],
    ['swing', -1.01], ['swing', 1.01],
    ['bars', -1], ['bars', 1001], ['bars', 0.5],
    ['duration', -1], ['offset', -1],
    ['strongMidi', 17], ['strongMidi', 117], ['strongMidi', 60.5],
    ['weakMidi', 17], ['weakMidi', 117], ['weakMidi', 60.5],
    ['sampleRate', 0], ['sampleRate', Number.NaN], ['seed', Number.NaN],
  ])('rejects invalid %s=%s', (key, value) => {
    expect(() => getRhythmTrackPlan(request({ [key]: value }))).toThrow(RangeError);
  });

  it('rejects an unknown click type', () => {
    expect(() => getRhythmTrackPlan(request({ clickType: 'unknown' as never }))).toThrow(
      'Unsupported Rhythm Track beat sound',
    );
  });

  it('rejects impractical browser allocations before allocating a buffer', () => {
    expect(() => generateRhythmTrack(request({
      tempo: 30,
      beatsPerBar: 20,
      bars: 1000,
      sampleRate: 44100,
    }))).toThrow('browser render memory limit');
  });
});
