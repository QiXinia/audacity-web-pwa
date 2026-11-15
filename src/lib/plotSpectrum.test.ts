import { describe, expect, it } from 'vitest';
import {
  analyzePlotSpectrum,
  createAnalysisWindow,
  findNearestPlotSpectrumPeak,
  frequencyToPitchName,
  mixPlotSpectrumSegments,
  PLOT_SPECTRUM_ALGORITHMS,
  PLOT_SPECTRUM_WINDOWS,
  samplePlotSpectrum,
  serializePlotSpectrum,
  type PlotSpectrumResult,
  type PlotSpectrumSegment,
} from './plotSpectrum';

function sine(size: number, bin: number, amplitude = 1): Float32Array {
  return Float32Array.from({ length: size }, (_, index) => amplitude * Math.sin(2 * Math.PI * bin * index / size));
}

function directDftPower(data: Float64Array, bin: number): number {
  let real = 0;
  let imaginary = 0;
  for (let index = 0; index < data.length; index += 1) {
    const angle = -2 * Math.PI * bin * index / data.length;
    real += data[index] * Math.cos(angle);
    imaginary += data[index] * Math.sin(angle);
  }
  return real * real + imaginary * imaginary;
}

describe('Plot Spectrum Audacity DSP semantics', () => {
  it('matches an independent direct DFT and coherent amplitude normalization', () => {
    const size = 128;
    const input = sine(size, 8, 0.5);
    const result = analyzePlotSpectrum(input, { algorithm: 'spectrum', size, window: 'rectangular', sampleRate: 128 });
    const expectedDb = 10 * Math.log10(directDftPower(Float64Array.from(input), 8) * 4 / (size * size));
    expect(result.windowCount).toBe(1);
    expect(result.values).toHaveLength(64);
    expect(result.values[8]).toBeCloseTo(expectedDb, 10);
    expect(result.values[8]).toBeCloseTo(-6.020599913, 6);
    expect(result.values[7]).toBeLessThan(-250);
  });

  it('uses Audacity periodic Hann denominator N-1 and reaches 0 dB for a coherent unit sine', () => {
    const size = 128;
    const window = createAnalysisWindow('hann', size);
    expect(window[0]).toBe(0);
    expect(window[size - 1]).toBe(0);
    expect(window[1]).toBeCloseTo(0.5 - 0.5 * Math.cos(2 * Math.PI / 127), 14);
    const input = sine(size, 8);
    const result = analyzePlotSpectrum(input, { algorithm: 'spectrum', size, window: 'hann', sampleRate: 128 });
    const windowed = Float64Array.from(input, (value, index) => value * window[index]);
    const windowSum = window.reduce((sum, value) => sum + value, 0);
    const expectedDb = 10 * Math.log10(directDftPower(windowed, 8) * 4 / (windowSum * windowSum));
    expect(result.values[8]).toBeCloseTo(expectedDb, 10);
    expect(result.values[8]).toBeCloseTo(0, 3);
  });

  it('averages half-window-overlapped power rather than treating trailing samples as another frame', () => {
    const size = 128;
    const input = new Float32Array(192);
    input.set(sine(size, 8), 0);
    input.set(sine(size, 8), 64);
    const result = analyzePlotSpectrum(input, { algorithm: 'spectrum', size, window: 'rectangular', sampleRate: 128 });
    expect(result.windowCount).toBe(2);
    expect(result.values[8]).toBeCloseTo(0, 6);
    const short = analyzePlotSpectrum(input.subarray(0, 129), { algorithm: 'spectrum', size, window: 'rectangular', sampleRate: 128 });
    expect(short.windowCount).toBe(1);
  });

  it('implements every official window family with finite deterministic coefficients', () => {
    for (const { id } of PLOT_SPECTRUM_WINDOWS) {
      const first = createAnalysisWindow(id, 128);
      const second = createAnalysisWindow(id, 128);
      expect(first).toEqual(second);
      expect(first.every(Number.isFinite)).toBe(true);
      expect(first.some((value) => value !== 0)).toBe(true);
    }
    expect(createAnalysisWindow('hamming', 128)[127]).toBeCloseTo(0.08, 12);
    expect(createAnalysisWindow('bartlett', 128)[1]).toBeCloseTo(1 / 64, 12);
    expect(createAnalysisWindow('bartlett', 128)[127]).toBeCloseTo(1 / 64, 12);
  });

  it('matches official impulse anchors for all four non-spectrum algorithms', () => {
    const size = 128;
    const impulse = new Float32Array(size);
    impulse[0] = 1;
    const standard = analyzePlotSpectrum(impulse, { algorithm: 'autocorrelation', size, window: 'rectangular', sampleRate: 128 });
    expect(standard.values[0]).toBeCloseTo(size, 8);
    expect(standard.values[20]).toBeCloseTo(0, 8);
    const cubeRoot = analyzePlotSpectrum(impulse, { algorithm: 'cuberoot-autocorrelation', size, window: 'rectangular', sampleRate: 128 });
    expect(cubeRoot.values[0]).toBeCloseTo(size, 8);
    const enhanced = analyzePlotSpectrum(impulse, { algorithm: 'enhanced-autocorrelation', size, window: 'rectangular', sampleRate: 128 });
    expect(Array.from(enhanced.values).every((value) => Math.abs(value) < 1e-8)).toBe(true);
    const cepstrum = analyzePlotSpectrum(impulse, { algorithm: 'cepstrum', size, window: 'rectangular', sampleRate: 128 });
    expect(Array.from(cepstrum.values).every((value) => Math.abs(value) < 1e-8)).toBe(true);
  });

  it('keeps cepstrum log-power floor deterministic for silence', () => {
    const size = 128;
    const result = analyzePlotSpectrum(new Float32Array(size), { algorithm: 'cepstrum', size, window: 'rectangular', sampleRate: 128 });
    expect(result.values[0]).toBeCloseTo(Math.log(1e-20 * size * size), 8);
    expect(result.values[20]).toBeCloseTo(0, 8);
  });

  it('fails closed on short input, invalid sizes, rates, algorithms and non-finite PCM', () => {
    expect(() => analyzePlotSpectrum(new Float32Array(127), { algorithm: 'spectrum', size: 128, window: 'hann', sampleRate: 128 }))
      .toThrow('不足 128 个采样');
    expect(() => analyzePlotSpectrum(new Float32Array(128), { algorithm: 'spectrum', size: 100, window: 'hann', sampleRate: 128 }))
      .toThrow('2 的幂');
    expect(() => analyzePlotSpectrum(new Float32Array(128), { algorithm: 'spectrum', size: 128, window: 'hann', sampleRate: 0 }))
      .toThrow('采样率');
    const invalid = new Float32Array(128);
    invalid[7] = Number.NaN;
    expect(() => analyzePlotSpectrum(invalid, { algorithm: 'spectrum', size: 128, window: 'hann', sampleRate: 128 }))
      .toThrow('采样 7');
    expect(PLOT_SPECTRUM_ALGORITHMS).toHaveLength(5);
  });
});

describe('Plot Spectrum cursor, peak and export', () => {
  function synthetic(values: number[]): PlotSpectrumResult {
    return {
      algorithm: 'spectrum', size: 128, window: 'hann', sampleRate: 128,
      values: Float64Array.from(values), windowCount: 1, yMin: Math.min(...values), yMax: Math.max(...values),
    };
  }

  it('uses cubic interpolation for sub-bin cursor reads and cubic maximum for peaks', () => {
    const linear = synthetic(Array.from({ length: 64 }, (_, index) => index));
    expect(samplePlotSpectrum(linear, 4.5, 4.6)).toBeCloseTo(4.55, 10);
    const parabolic = synthetic(Array.from({ length: 64 }, (_, index) => -((index - 10) ** 2)));
    const peak = findNearestPlotSpectrumPeak(parabolic, 10.2);
    expect(peak?.position).toBeCloseTo(10, 8);
    expect(peak?.value).toBeCloseTo(0, 8);
  });

  it('exports Audacity-compatible headers and excludes DC and Nyquist endpoints', () => {
    const result = analyzePlotSpectrum(sine(128, 8), { algorithm: 'spectrum', size: 128, window: 'rectangular', sampleRate: 128 });
    const lines = serializePlotSpectrum(result).trim().split('\n');
    expect(lines[0]).toBe('Frequency (Hz)\tLevel (dB)');
    expect(lines).toHaveLength(64);
    expect(lines[1]).toMatch(/^1\.000000\t/);
    expect(lines.at(-1)).toMatch(/^63\.000000\t/);
    expect(lines[8].split('\t')[0]).toBe('8.000000');
    expect(Number(lines[8].split('\t')[1])).toBeCloseTo(0, 6);
  });

  it('exports lag, equivalent frequency and level for autocorrelation', () => {
    const result = analyzePlotSpectrum(sine(128, 8), { algorithm: 'autocorrelation', size: 128, window: 'rectangular', sampleRate: 128 });
    const lines = serializePlotSpectrum(result).trim().split('\n');
    expect(lines[0]).toBe('Lag (seconds)\tFrequency (Hz)\tLevel');
    expect(lines[1]).toMatch(/^0\.007813\t128\.000000\t/);
    expect(frequencyToPitchName(440)).toBe('A4');
  });
});

describe('Plot Spectrum selected PCM mixing', () => {
  it('sums every channel and selected track into timeline positions while leaving gaps silent', () => {
    const segments: PlotSpectrumSegment[] = [
      { trackId: 'one', clips: [{ clipId: 'a', startTime: 1, duration: 2, sourceOffset: 0, channels: [new Float32Array(20).fill(1), new Float32Array(20).fill(0.5)] }] },
      { trackId: 'two', clips: [{ clipId: 'b', startTime: 1, duration: 2, sourceOffset: 0, channels: [new Float32Array(20).fill(2)] }] },
    ];
    const mixed = mixPlotSpectrumSegments(segments, { start: 0, end: 4 }, 10);
    expect(mixed.trackCount).toBe(2);
    expect(mixed.samples).toHaveLength(40);
    expect(Array.from(mixed.samples.subarray(0, 10)).every((value) => value === 0)).toBe(true);
    expect(Array.from(mixed.samples.subarray(10, 30)).every((value) => value === 3.5)).toBe(true);
    expect(Array.from(mixed.samples.subarray(30)).every((value) => value === 0)).toBe(true);
  });

  it('honours effective source offsets and enforces the browser sample cap explicitly', () => {
    const source = Float32Array.from({ length: 30 }, (_, index) => index);
    const mixed = mixPlotSpectrumSegments([
      { trackId: 'one', clips: [{ clipId: 'a', startTime: 0, duration: 3, sourceOffset: 0.5, channels: [source] }] },
    ], { start: 0, end: 2 }, 10, 10);
    expect(mixed.sourceSamples).toBe(20);
    expect(mixed.samples).toHaveLength(10);
    expect(mixed.truncated).toBe(true);
    expect(Array.from(mixed.samples)).toEqual([5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
  });

  it('rejects empty ownership and malformed channels instead of inventing a spectrum', () => {
    expect(() => mixPlotSpectrumSegments([], { start: 0, end: 1 }, 10)).toThrow('没有可分析的音频');
    expect(() => mixPlotSpectrumSegments([
      { trackId: 'one', clips: [{ clipId: 'bad', startTime: 0, duration: 1, sourceOffset: 0, channels: [new Float32Array(5), new Float32Array(4)] }] },
    ], { start: 0, end: 1 }, 10)).toThrow('等长声道');
  });
});
