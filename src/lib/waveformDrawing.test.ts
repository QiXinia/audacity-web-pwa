import { describe, expect, it, vi } from 'vitest';
import { drawWaveform } from '@/lib/waveformDrawing';
import { sampleToDbDisplayValue } from '@/lib/dbWaveform';
import type { IClip } from '@/types/project';

const clip: IClip = {
  id: 'clip-1',
  audioBufferId: 'buffer-1',
  startTime: 0,
  offset: 0,
  duration: 1,
  originalDuration: 1,
  gain: 1,
  fadeIn: 0,
  fadeOut: 0,
};

function contextSpy() {
  const moveTo = vi.fn();
  const lineTo = vi.fn();
  const strokeStyles: string[] = [];
  const ctx = {
    beginPath: vi.fn(),
    moveTo,
    lineTo,
    strokeStyle: '',
    stroke: vi.fn(),
  };
  ctx.stroke = vi.fn(() => { strokeStyles.push(ctx.strokeStyle); });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, moveTo, lineTo, strokeStyles };
}

describe('waveform vertical zoom', () => {
  it('applies zoom once to the actual canvas coordinates', () => {
    const { ctx, moveTo, lineTo } = contextSpy();
    drawWaveform(ctx, new Float32Array([0.1, -0.1]), 1, 104, '#20252a', clip, 2, 2, 1);

    expect(moveTo.mock.calls[1]?.[0]).toBe(0);
    expect(moveTo.mock.calls[1]?.[1]).toBeCloseTo(42.4, 5);
    expect(lineTo.mock.calls[0]?.[0]).toBe(0);
    expect(lineTo.mock.calls[0]?.[1]).toBeCloseTo(61.6, 5);
  });

  it('clips magnified peaks at the waveform bounds without double scaling', () => {
    const { ctx, moveTo, lineTo } = contextSpy();
    drawWaveform(ctx, new Float32Array([2, -2]), 1, 104, '#20252a', clip, 2, 3, 1);

    expect(moveTo.mock.calls[1]).toEqual([0, 4]);
    expect(lineTo.mock.calls[0]).toEqual([0, 100]);
  });

  it('draws low-level samples only when the dB preference exposes them', () => {
    const hidden = contextSpy();
    const samples = new Float32Array([0.0001, -0.0001]);
    drawWaveform(hidden.ctx, samples, 1, 104, '#20252a', clip, 2, 1, 1, false, -60);
    expect(hidden.moveTo.mock.calls[1]).toEqual([0, 52]);
    expect(hidden.lineTo.mock.calls[0]).toEqual([0, 52]);

    const visible = contextSpy();
    drawWaveform(visible.ctx, samples, 1, 104, '#20252a', clip, 2, 1, 1, false, -96);
    expect(visible.moveTo.mock.calls[1]?.[0]).toBe(0);
    expect(visible.moveTo.mock.calls[1]?.[1]).toBeCloseTo(44, 6);
    expect(visible.lineTo.mock.calls[0]?.[0]).toBe(0);
    expect(visible.lineTo.mock.calls[0]?.[1]).toBeCloseTo(60, 6);
  });

  it('draws half-wave against a zero lower bound and moves the zero line to the bottom', () => {
    const linear = contextSpy();
    const samples = new Float32Array([0.5, -0.5]);
    drawWaveform(linear.ctx, samples, 1, 104, '#20252a', clip, 2, 1, 1, false, undefined, true);
    expect(linear.moveTo.mock.calls[0]).toEqual([0, 100]);
    expect(linear.moveTo.mock.calls[1]?.[1]).toBeCloseTo(52, 6);
    expect(linear.lineTo.mock.calls[0]?.[1]).toBeCloseTo(100, 6);

    const logarithmic = contextSpy();
    drawWaveform(logarithmic.ctx, samples, 1, 104, '#20252a', clip, 2, 1, 1, false, -60, true);
    expect(logarithmic.moveTo.mock.calls[0]).toEqual([0, 100]);
    expect(logarithmic.moveTo.mock.calls[1]?.[1]).toBeCloseTo(
      4 + (1 - sampleToDbDisplayValue(0.5, -60)) * 96,
      10,
    );
    expect(logarithmic.lineTo.mock.calls[0]?.[1]).toBeCloseTo(100, 6);
  });
});

describe('waveform RMS overlay', () => {
  it('draws the mean-square envelope after peaks with the official lighter color', () => {
    const { ctx, moveTo, lineTo, strokeStyles } = contextSpy();
    drawWaveform(ctx, new Float32Array([1, 0, 0, 0]), 1, 104, '#20252a', clip, 4, 1, 1,
      false, undefined, false, true);

    // RMS = sqrt((1² + 0² + 0² + 0²) / 4) = 0.5.
    expect(moveTo.mock.calls[2]).toEqual([0, 28]);
    expect(lineTo.mock.calls[1]).toEqual([0, 52]);
    expect(strokeStyles).toEqual(['#20252a', '#585c5f', '#20252a']);
  });

  it('uses dB coordinates and constrains the negative RMS edge to the column minimum', () => {
    const { ctx, moveTo, lineTo } = contextSpy();
    const samples = new Float32Array([0.01, 0, 0, 0]);
    drawWaveform(ctx, samples, 1, 104, '#20252a', clip, 4, 1, 1, false, -60, false, true);

    const rms = 0.005;
    expect(moveTo.mock.calls[2]?.[1]).toBeCloseTo(
      4 + ((1 - sampleToDbDisplayValue(rms, -60)) / 2) * 96,
      5,
    );
    // This non-negative column has min=0, so max(-rms, min)=0 rather than -rms.
    expect(lineTo.mock.calls[1]).toEqual([0, 52]);
  });

  it('clamps the positive RMS edge to the actual peak in half-wave mode', () => {
    const { ctx, moveTo, lineTo } = contextSpy();
    const samples = new Float32Array([0.25, -1, 0, 0]);
    drawWaveform(ctx, samples, 1, 104, '#20252a', clip, 4, 1, 1, false, undefined, true, true);

    // RMS exceeds the positive 0.25 peak, so the overlay cannot paint above it.
    expect(moveTo.mock.calls[2]).toEqual([0, 76]);
    expect(lineTo.mock.calls[1]).toEqual([0, 100]);
  });

  it('does not invent RMS segments for columns with no source samples', () => {
    const { ctx, moveTo } = contextSpy();
    drawWaveform(ctx, new Float32Array([1, 0, 0, 0]), 8, 104, '#20252a', clip, 4, 1, 1,
      false, undefined, false, true);

    // moveTo[0] is the initial zero line; four peak lines follow at x=0..3.
    // Only those same four non-empty columns receive RMS moveTo calls.
    const rmsMoveTo = moveTo.mock.calls.slice(9, 13);
    expect(rmsMoveTo.map((call) => call[0])).toEqual([0, 1, 2, 3]);
    expect(moveTo.mock.calls).toHaveLength(14); // initial zero + 8 peaks + 4 RMS + final zero
  });
});
