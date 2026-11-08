import { describe, expect, it, vi } from 'vitest';
import { drawWaveform } from '@/lib/waveformDrawing';
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
  const ctx = {
    beginPath: vi.fn(),
    moveTo,
    lineTo,
    stroke: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
  return { ctx, moveTo, lineTo };
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
});
