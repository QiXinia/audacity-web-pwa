import { describe, expect, it } from 'vitest';
import {
  MAX_TEMPO,
  MIN_TEMPO,
  barDuration,
  quarterNoteDuration,
  updateProjectTempo,
  updateProjectTimeSignature,
  validateTempo,
  validateTimeSignature,
} from '@/lib/musicalTiming';
import type { IProject } from '@/types/project';

function project(): IProject {
  return {
    id: 'timing',
    name: 'Timing',
    createdAt: 0,
    updatedAt: 0,
    sampleRate: 48000,
    timeSignature: { numerator: 4, denominator: 4 },
    tempo: 120,
    tracks: [],
    cursorPosition: 0,
    selection: null,
    viewState: { horizontalZoom: 100, verticalZoom: 1, scrollX: 0, viewMode: 'waveform' },
  };
}

describe('Audacity 4 musical timing', () => {
  it('accepts fractional BPM only inside the official inclusive 1–999 range', () => {
    expect(validateTempo(MIN_TEMPO)).toBe(1);
    expect(validateTempo(120.5)).toBe(120.5);
    expect(validateTempo(MAX_TEMPO)).toBe(999);
    expect([0, 1000, Number.NaN, Number.POSITIVE_INFINITY, '120', null].map(validateTempo)).toEqual([
      null, null, null, null, null, null,
    ]);
  });

  it('validates the official numerator and denominator choices', () => {
    expect(validateTimeSignature(1, 2)).toEqual({ numerator: 1, denominator: 2 });
    expect(validateTimeSignature(128, 64)).toEqual({ numerator: 128, denominator: 64 });
    expect(validateTimeSignature(6, 8)).toEqual({ numerator: 6, denominator: 8 });
    for (const [upper, lower] of [[0, 4], [129, 4], [3.5, 4], [4, 3], [4, 1], [4, 128]]) {
      expect(validateTimeSignature(upper, lower)).toBeNull();
    }
  });

  it('uses the official quarter-note and bar duration formulas', () => {
    expect(quarterNoteDuration(120)).toBe(0.5);
    expect(quarterNoteDuration(90)).toBeCloseTo(2 / 3, 12);
    expect(barDuration(120, { numerator: 4, denominator: 4 })).toBe(2);
    expect(barDuration(90, { numerator: 6, denominator: 8 })).toBeCloseTo(2, 12);
    expect(barDuration(120, { numerator: 3, denominator: 16 })).toBe(0.375);
    expect(barDuration(0, { numerator: 4, denominator: 4 })).toBe(0);
    expect(barDuration(120, { numerator: 4, denominator: 3 })).toBe(0);
  });

  it('updates project timing immutably and rejects invalid or no-op edits', () => {
    const original = project();
    const faster = updateProjectTempo(original, 140);
    expect(faster).not.toBe(original);
    expect(faster.tempo).toBe(140);
    expect(original.tempo).toBe(120);
    expect(updateProjectTempo(original, 0)).toBe(original);
    expect(updateProjectTempo(original, 120)).toBe(original);

    const sixEight = updateProjectTimeSignature(original, 6, 8);
    expect(sixEight.timeSignature).toEqual({ numerator: 6, denominator: 8 });
    expect(original.timeSignature).toEqual({ numerator: 4, denominator: 4 });
    expect(updateProjectTimeSignature(original, 6, 3)).toBe(original);
    expect(updateProjectTimeSignature(original, 4, 4)).toBe(original);
  });
});
