// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TruncateSilenceDialog from './TruncateSilenceDialog';

function renderDialog(overrides: Partial<Parameters<typeof TruncateSilenceDialog>[0]> = {}) {
  const onPreview = vi.fn().mockResolvedValue([new Float32Array(4000)]);
  const onApply = vi.fn();
  const result = render(
    <TruncateSilenceDialog
      open
      onOpenChange={vi.fn()}
      selectionStart={0}
      selectionEnd={4}
      sampleRate={1000}
      hasSelection
      isApplying={false}
      onPreview={onPreview}
      onApply={onApply}
      {...overrides}
    />,
  );
  return { onPreview, onApply, ...result };
}

class MockAudioContext {
  sampleRate = 1000;
  destination = {};
  resume = vi.fn(async () => undefined);
  close = vi.fn(async () => undefined);
  createBuffer(channels: number, length: number, sampleRate: number) {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { sampleRate, getChannelData: (index: number) => data[index] };
  }
  createBufferSource() {
    return {
      buffer: null,
      onended: null,
      connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(),
    };
  }
}

describe('TruncateSilenceDialog', () => {
  beforeEach(() => {
    vi.stubGlobal('AudioContext', MockAudioContext);
  });

  it('offers the official defaults and submits the complete truncate settings', async () => {
    const { onPreview, onApply } = renderDialog();
    expect(screen.getByLabelText('Threshold (dB)')).toHaveValue(-20);
    expect(screen.getByLabelText('Duration (seconds)')).toHaveValue(0.5);
    expect(screen.getByLabelText('Truncate to (seconds)')).toHaveValue(0.5);
    expect(screen.getByLabelText('Truncate detected silence')).toBeChecked();
    expect(screen.getByLabelText('Truncate tracks independently')).not.toBeChecked();
    expect(screen.queryByText('Silence Generator', { exact: true })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '试听' }));
    await waitFor(() => expect(onPreview).toHaveBeenCalledWith({
      thresholdDb: -20,
      minimumDuration: 0.5,
      action: 'truncate',
      truncateDuration: 0.5,
      compressPercent: 50,
      independent: false,
    }));
    fireEvent.click(await screen.findByRole('button', { name: '停止试听' }));
    fireEvent.click(screen.getByRole('button', { name: '应用 Truncate Silence' }));
    expect(onApply).toHaveBeenCalledWith({
      thresholdDb: -20,
      minimumDuration: 0.5,
      action: 'truncate',
      truncateDuration: 0.5,
      compressPercent: 50,
      independent: false,
    });
  });

  it('switches to the official compress controls and independent track action', () => {
    const { onApply } = renderDialog();
    fireEvent.click(screen.getByLabelText('Compress excess silence'));
    expect(screen.queryByLabelText('Truncate to (seconds)')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Compress to (%)'), { target: { value: '25.5' } });
    fireEvent.click(screen.getByLabelText('Compress tracks independently'));
    fireEvent.click(screen.getByRole('button', { name: '应用 Truncate Silence' }));
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({
      action: 'compress',
      compressPercent: 25.5,
      independent: true,
    }));
  });

  it('validates bounds and restores every official default', () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText('Threshold (dB)'), { target: { value: '-81' } });
    expect(screen.getByRole('alert')).toHaveTextContent('-80–-20');
    expect(screen.getByRole('button', { name: '应用 Truncate Silence' })).toBeDisabled();
    fireEvent.click(screen.getByLabelText('Compress excess silence'));
    fireEvent.click(screen.getByLabelText('Compress tracks independently'));
    fireEvent.click(screen.getByRole('button', { name: '恢复默认' }));
    expect(screen.getByLabelText('Threshold (dB)')).toHaveValue(-20);
    expect(screen.getByLabelText('Truncate detected silence')).toBeChecked();
    expect(screen.getByLabelText('Truncate tracks independently')).not.toBeChecked();
    expect(screen.getByRole('button', { name: '应用 Truncate Silence' })).toBeEnabled();
  });

  it('blocks actions without a real selection or while applying', () => {
    const { rerender } = renderDialog({ hasSelection: false });
    expect(screen.getByRole('button', { name: '应用 Truncate Silence' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '试听' })).toBeDisabled();
    rerender(
      <TruncateSilenceDialog
        open
        onOpenChange={vi.fn()}
        selectionStart={0}
        selectionEnd={4}
        sampleRate={1000}
        hasSelection
        isApplying
        onPreview={vi.fn()}
        onApply={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: '正在应用…' })).toBeDisabled();
  });
});
