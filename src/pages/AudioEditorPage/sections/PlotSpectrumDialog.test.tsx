import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PlotSpectrumDialog } from './PlotSpectrumDialog';
import type { PlotSpectrumAudio } from '@/lib/plotSpectrum';

vi.mock('framer-motion', () => ({ useReducedMotion: () => false }));

function makeAudio(length = 1024, trackCount = 1): PlotSpectrumAudio {
  return {
    samples: Float32Array.from({ length }, (_, index) => Math.sin(2 * Math.PI * 8 * index / 128)),
    sourceSamples: length,
    truncated: false,
    trackCount,
  };
}

function renderDialog(overrides: Partial<Parameters<typeof PlotSpectrumDialog>[0]> = {}) {
  const props: Parameters<typeof PlotSpectrumDialog>[0] = {
    open: true,
    onOpenChange: vi.fn(),
    selectionStart: 0,
    selectionEnd: 1024 / 8000,
    sampleRate: 8000,
    onLoadAudio: vi.fn().mockResolvedValue(makeAudio()),
    ...overrides,
  };
  const view = render(<PlotSpectrumDialog {...props} />);
  return { ...props, ...view };
}

beforeEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('PlotSpectrumDialog', () => {
  it('loads real selected PCM with official defaults and exposes plot, algorithm and export controls', async () => {
    const audio = makeAudio(1024, 2);
    const props = renderDialog({ onLoadAudio: vi.fn().mockResolvedValue(audio) });
    expect(await screen.findByRole('img', { name: /Spectrum 频谱分析图，1 个分析窗/ })).toBeInTheDocument();
    expect(props.onLoadAudio).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('FFT Size')).toHaveValue('1024');
    expect(screen.getByLabelText('窗函数')).toHaveValue('hann');
    expect(screen.getByLabelText('频率轴')).toHaveValue('log');
    expect(screen.getByLabelText('显示网格')).toBeChecked();
    expect(screen.getByText(/1024 个采样 · 2 轨/)).toBeInTheDocument();
    expect(screen.getByTestId('spectrum-plot-path').getAttribute('d')?.length).toBeGreaterThan(1000);

    fireEvent.change(screen.getByLabelText('分析算法'), { target: { value: 'autocorrelation' } });
    expect(await screen.findByRole('img', { name: /Standard Autocorrelation/ })).toBeInTheDocument();
    expect(screen.getByLabelText('频率轴')).toBeDisabled();
    expect(screen.getByLabelText('频率轴')).toHaveValue('linear');

    fireEvent.change(screen.getByLabelText('FFT Size'), { target: { value: '2048' } });
    expect(screen.getByText(/不足当前 FFT Size 2048/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Export/ })).toBeDisabled();
  });

  it('supports cursor peak inspection, text export, Replot and close without mutating project state', async () => {
    const onOpenChange = vi.fn();
    const onLoadAudio = vi.fn().mockResolvedValue(makeAudio());
    renderDialog({ onOpenChange, onLoadAudio });
    const svg = await screen.findByRole('img', { name: /Spectrum 频谱分析图/ });
    vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 960, bottom: 360,
      width: 960, height: 360, toJSON: () => ({}),
    });
    fireEvent.pointerMove(svg, { clientX: 160, clientY: 100 });
    await waitFor(() => expect(screen.getByTestId('spectrum-peak-line')).toBeInTheDocument());
    expect(screen.getByLabelText('光标读数')).toHaveTextContent(/Hz .* dB/);
    expect(screen.getByLabelText('峰值读数')).toHaveTextContent(/Hz .* dB/);

    let capturedBlob: Blob | null = null;
    let downloadedName = '';
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn((blob: Blob) => { capturedBlob = blob; return 'blob:plot-spectrum'; }) });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () { downloadedName = this.download; });
    fireEvent.click(screen.getByRole('button', { name: /Export/ }));
    expect(downloadedName).toBe('spectrum.txt');
    expect(capturedBlob).not.toBeNull();
    expect(await (capturedBlob as unknown as Blob).text()).toMatch(/^Frequency \(Hz\)\tLevel \(dB\)\n/);

    fireEvent.click(screen.getByRole('button', { name: /Replot/ }));
    await waitFor(() => expect(onLoadAudio).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('reports truncation instead of hiding the browser resource cap', async () => {
    const truncated = { ...makeAudio(1024), sourceSamples: 4096, truncated: true };
    renderDialog({ onLoadAudio: vi.fn().mockResolvedValue(truncated) });
    expect(await screen.findByText(/选区过长，仅分析前 1024 个采样/)).toBeInTheDocument();
  });

  it('zooms about the vertical centre, pans to the range boundary and resets without changing the DSP result', async () => {
    renderDialog();
    const svg = await screen.findByRole('img', { name: /Spectrum 频谱分析图/ });
    const initialYMin = Number(svg.getAttribute('data-y-min'));
    const initialYMax = Number(svg.getAttribute('data-y-max'));
    const initialPath = screen.getByTestId('spectrum-plot-path').getAttribute('d');

    fireEvent.change(screen.getByLabelText('纵向缩放'), { target: { value: '25' } });
    expect(screen.getByLabelText('纵向缩放')).toHaveValue('25');
    expect(screen.getByLabelText('纵向平移')).toBeEnabled();
    expect(Number(svg.getAttribute('data-y-max'))).toBeLessThan(initialYMax);
    expect(Number(svg.getAttribute('data-y-min'))).toBeGreaterThan(initialYMin);
    expect(screen.getByTestId('spectrum-plot-path').getAttribute('d')).not.toBe(initialPath);

    const pan = screen.getByLabelText('纵向平移');
    const maximum = Number(pan.getAttribute('max'));
    expect(maximum).toBeGreaterThan(0);
    const zoomedYMin = Number(svg.getAttribute('data-y-min'));
    fireEvent.change(pan, { target: { value: String(maximum) } });
    expect(Number(svg.getAttribute('data-y-min'))).toBeLessThan(zoomedYMin);
    expect(screen.getByLabelText('纵向显示范围')).toHaveTextContent(/Y: .* dB/);

    fireEvent.click(screen.getByRole('button', { name: /重置纵向视图/ }));
    expect(screen.getByLabelText('纵向缩放')).toHaveValue('100');
    expect(screen.getByLabelText('纵向平移')).toBeDisabled();
    expect(Number(svg.getAttribute('data-y-min'))).toBeCloseTo(initialYMin, 10);
    expect(Number(svg.getAttribute('data-y-max'))).toBeCloseTo(initialYMax, 10);
    expect(screen.getByTestId('spectrum-plot-path').getAttribute('d')).toBe(initialPath);
  });

  it('shows real analysis progress and cancels the stale run when the algorithm changes', async () => {
    renderDialog({ onLoadAudio: vi.fn().mockResolvedValue(makeAudio(65536)) });
    expect(await screen.findByRole('progressbar', { name: '频谱分析进度' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('分析算法'), { target: { value: 'autocorrelation' } });
    expect(await screen.findByRole('img', { name: /Standard Autocorrelation 频谱分析图，127 个分析窗/ })).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /^Spectrum 频谱分析图/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('progressbar', { name: '频谱分析进度' })).not.toBeInTheDocument();
  });

  it('restores official preferences after close and remount while resetting transient zoom and pan', async () => {
    const first = renderDialog();
    expect(await screen.findByRole('img', { name: /Spectrum 频谱分析图/ })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('FFT Size'), { target: { value: '512' } });
    fireEvent.change(screen.getByLabelText('窗函数'), { target: { value: 'blackman' } });
    fireEvent.change(screen.getByLabelText('频率轴'), { target: { value: 'linear' } });
    fireEvent.click(screen.getByLabelText('显示网格'));
    fireEvent.change(screen.getByLabelText('分析算法'), { target: { value: 'autocorrelation' } });
    expect(await screen.findByRole('img', { name: /Standard Autocorrelation 频谱分析图，3 个分析窗/ })).toBeInTheDocument();
    first.unmount();

    renderDialog();
    expect(await screen.findByRole('img', { name: /Standard Autocorrelation 频谱分析图，3 个分析窗/ })).toBeInTheDocument();
    expect(screen.getByLabelText('分析算法')).toHaveValue('autocorrelation');
    expect(screen.getByLabelText('FFT Size')).toHaveValue('512');
    expect(screen.getByLabelText('窗函数')).toHaveValue('blackman');
    expect(screen.getByLabelText('频率轴')).toHaveValue('linear');
    expect(screen.getByLabelText('显示网格')).not.toBeChecked();
    expect(screen.getByLabelText('纵向缩放')).toHaveValue('100');
    expect(screen.getByLabelText('纵向平移')).toBeDisabled();

    fireEvent.change(screen.getByLabelText('分析算法'), { target: { value: 'spectrum' } });
    expect(await screen.findByRole('img', { name: /Spectrum 频谱分析图，3 个分析窗/ })).toBeInTheDocument();
    expect(screen.getByLabelText('频率轴')).toBeEnabled();
    expect(screen.getByLabelText('频率轴')).toHaveValue('linear');
  });
});
