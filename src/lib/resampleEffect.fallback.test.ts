import { describe, expect, it, vi } from 'vitest';
import SoxrModuleFactory from 'wasm-audio-resampler/app/soxr_wasm';
import { resampleChannelsDetailed, SOXR_FALLBACK_WARNING } from './resampleEffect';

vi.mock('wasm-audio-resampler/app/soxr_wasm', () => ({
  default: vi.fn(async () => {
    throw new Error('Simulated unavailable WASM');
  }),
}));

describe('resampleEffect explicit fallback', () => {
  it('reports a degraded backend instead of disguising sinc output as libsoxr', async () => {
    const result = await resampleChannelsDetailed([
      new Float32Array([0, 0.25, -0.5, 1]),
    ], 1000, 2000);

    expect(result.backend).toBe('typescript-fallback');
    expect(result.warning).toContain(SOXR_FALLBACK_WARNING);
    expect(result.warning).toContain('Simulated unavailable WASM');
    expect(result.channels).toHaveLength(1);
    expect(result.channels[0]).toHaveLength(8);
    expect(result.channels[0].every(Number.isFinite)).toBe(true);
    expect(vi.mocked(SoxrModuleFactory)).toHaveBeenCalledTimes(1);
  });

  it('does not initialize WASM for same-rate copies', async () => {
    vi.mocked(SoxrModuleFactory).mockClear();
    const result = await resampleChannelsDetailed([new Float32Array([1, 2])], 1000, 1000);
    expect(result.backend).toBe('same-rate');
    expect(vi.mocked(SoxrModuleFactory)).not.toHaveBeenCalled();
  });
});
