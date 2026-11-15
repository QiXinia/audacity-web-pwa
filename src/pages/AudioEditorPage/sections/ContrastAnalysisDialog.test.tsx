import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ContrastAnalysisDialog } from './ContrastAnalysisDialog';
import type { ContrastMeasurement } from '@/lib/contrastAnalysis';

function measurement(rmsDb: number, start: number, end: number): ContrastMeasurement {
  return { start, end, rmsDb, rms: 10 ** (rmsDb / 20), sampleCounts: [4] };
}

function renderDialog(overrides: Partial<Parameters<typeof ContrastAnalysisDialog>[0]> = {}) {
  const props: Parameters<typeof ContrastAnalysisDialog>[0] = {
    open: true,
    onOpenChange: vi.fn(),
    projectName: 'Narration.aup3',
    onMeasure: vi.fn(),
    ...overrides,
  };
  const view = render(<ContrastAnalysisDialog {...props} />);
  return { ...props, ...view };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('ContrastAnalysisDialog', () => {
  it('measures foreground and background independently in a non-modal project window', async () => {
    const onMeasure = vi.fn()
      .mockResolvedValueOnce(measurement(-6, 0, 1))
      .mockResolvedValueOnce(measurement(-30, 2, 3));
    renderDialog({ onMeasure });

    expect(screen.getByRole('dialog', { name: 'Contrast Analysis (WCAG 2 compliance)' })).toHaveAttribute('aria-modal', 'false');
    expect(document.querySelector('[data-slot="dialog-overlay"]')).toBeNull();
    expect(screen.getByLabelText('Contrast Result')).toBeEmptyDOMElement();

    fireEvent.click(screen.getByRole('button', { name: 'Measure foreground selection' }));
    await waitFor(() => expect(screen.getByLabelText('Foreground volume')).toHaveTextContent('-6.00 dB'));
    expect(screen.getByLabelText('Foreground start')).toHaveValue('00:00:00.00');
    expect(screen.getByLabelText('Foreground end')).toHaveValue('00:00:01.00');
    expect(screen.getByLabelText('Contrast Result')).toHaveTextContent('Background not yet measured');

    fireEvent.click(screen.getByRole('button', { name: 'Measure background selection' }));
    await waitFor(() => expect(screen.getByLabelText('Contrast Result')).toHaveTextContent('WCAG2 Pass'));
    expect(screen.getByLabelText('Background volume')).toHaveTextContent('-30.00 dB');
    expect(screen.getByLabelText('Background start')).toHaveValue('00:00:02.00');
    expect(screen.getByLabelText('Background end')).toHaveValue('00:00:03.00');
    expect(screen.getByLabelText('Difference')).toHaveTextContent('24.00 dB RMS');
    expect(onMeasure).toHaveBeenCalledTimes(2);
  });

  it('reports a missing foreground when only the background has been measured', async () => {
    const onMeasure = vi.fn().mockResolvedValue(measurement(-30, 2, 3));
    renderDialog({ onMeasure });
    fireEvent.click(screen.getByRole('button', { name: 'Measure background selection' }));
    await waitFor(() => expect(screen.getByLabelText('Background volume')).toHaveTextContent('-30.00 dB'));
    expect(screen.getByLabelText('Contrast Result')).toHaveTextContent('Foreground not yet measured');
  });

  it('resets both selections and exports the official text report', async () => {
    const onMeasure = vi.fn()
      .mockResolvedValueOnce(measurement(-6, 0, 1))
      .mockResolvedValueOnce(measurement(-6, 0, 1))
      .mockResolvedValueOnce(measurement(-26, 2, 3));
    renderDialog({ onMeasure });
    fireEvent.click(screen.getByRole('button', { name: 'Measure foreground selection' }));
    await waitFor(() => expect(screen.getByLabelText('Foreground volume')).toHaveTextContent('-6.00 dB'));
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(screen.getByLabelText('Foreground volume')).toBeEmptyDOMElement();
    expect(screen.getByLabelText('Contrast Result')).toBeEmptyDOMElement();

    fireEvent.click(screen.getByRole('button', { name: 'Measure foreground selection' }));
    await waitFor(() => expect(screen.getByLabelText('Foreground volume')).toHaveTextContent('-6.00 dB'));
    fireEvent.click(screen.getByRole('button', { name: 'Measure background selection' }));
    await waitFor(() => expect(screen.getByLabelText('Background volume')).toHaveTextContent('-26.00 dB'));
    expect(screen.getByLabelText('Contrast Result')).toHaveTextContent('WCAG2 Fail');

    let capturedBlob: Blob | null = null;
    let downloadedName = '';
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn((blob: Blob) => { capturedBlob = blob; return 'blob:contrast'; }) });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () { downloadedName = this.download; });
    fireEvent.click(screen.getByRole('button', { name: /Export/ }));
    expect(downloadedName).toBe('contrast.txt');
    expect(capturedBlob).not.toBeNull();
    expect(await (capturedBlob as unknown as Blob).text()).toContain('WCAG 2.0 Success Criteria 1.4.7 Contrast Results');
  });

  it('keeps the window open with an explicit measurement error', async () => {
    const onMeasure = vi.fn().mockRejectedValue(new Error('一次只能测量一条音频轨道'));
    renderDialog({ onMeasure });
    fireEvent.click(screen.getByRole('button', { name: 'Measure foreground selection' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('一次只能测量一条音频轨道');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText('Contrast Result')).toBeEmptyDOMElement();
  });

  it('ignores an asynchronous measurement that finishes after Reset', async () => {
    let resolveMeasurement!: (value: ContrastMeasurement) => void;
    const pending = new Promise<ContrastMeasurement>((resolve) => { resolveMeasurement = resolve; });
    renderDialog({ onMeasure: vi.fn(() => pending) });
    fireEvent.click(screen.getByRole('button', { name: 'Measure foreground selection' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    await act(async () => {
      resolveMeasurement(measurement(-6, 0, 1));
      await pending;
    });
    expect(screen.getByLabelText('Foreground volume')).toBeEmptyDOMElement();
    expect(screen.getByLabelText('Contrast Result')).toBeEmptyDOMElement();
    expect(screen.getByRole('button', { name: 'Measure foreground selection' })).toBeEnabled();
  });

  it('resets on Close and starts fresh when reopened', async () => {
    const onMeasure = vi.fn().mockResolvedValue(measurement(-6, 0, 1));
    const props = renderDialog({ onMeasure });
    fireEvent.click(screen.getByRole('button', { name: 'Measure foreground selection' }));
    await waitFor(() => expect(screen.getByLabelText('Foreground volume')).toHaveTextContent('-6.00 dB'));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(props.onOpenChange).toHaveBeenCalledWith(false);

    props.rerender(<ContrastAnalysisDialog {...props} open={false} />);
    props.rerender(<ContrastAnalysisDialog {...props} open />);
    expect(screen.getByLabelText('Foreground volume')).toBeEmptyDOMElement();
    expect(screen.getByLabelText('Contrast Result')).toBeEmptyDOMElement();
  });
});
