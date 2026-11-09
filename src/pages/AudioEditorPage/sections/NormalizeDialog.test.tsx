// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NormalizeDialog } from './NormalizeDialog';

function renderDialog(overrides: Partial<Parameters<typeof NormalizeDialog>[0]> = {}) {
  const onPreview = vi.fn().mockResolvedValue([new Float32Array(8)]);
  const onApply = vi.fn();
  const result = render(
    <NormalizeDialog
      open
      onOpenChange={vi.fn()}
      selectionStart={0}
      selectionEnd={1}
      sampleRate={44100}
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

describe('NormalizeDialog', () => {
  beforeEach(() => {
    vi.stubGlobal('AudioContext', MockAudioContext);
  });

  it('offers the official defaults and previews the complete settings', async () => {
    const { onPreview } = renderDialog();
    expect(screen.getByLabelText('去除直流偏移（居中到 0.0）')).toBeChecked();
    expect(screen.getByLabelText('标准化峰值到')).toBeChecked();
    expect(screen.getByLabelText('峰值（dB）')).toHaveValue('-1');
    expect(screen.getByLabelText('独立标准化立体声声道')).not.toBeChecked();

    fireEvent.click(screen.getByRole('button', { name: '试听' }));
    await waitFor(() => expect(onPreview).toHaveBeenCalledWith({
      removeDc: true,
      normalizePeak: true,
      peakDb: -1,
      stereoIndependent: false,
    }));
    fireEvent.click(await screen.findByRole('button', { name: '停止试听' }));
    expect(screen.getByRole('button', { name: '试听' })).toBeEnabled();
  });

  it('uses the project sample rate instead of the hardware context rate', async () => {
    const createBuffer = vi.spyOn(MockAudioContext.prototype, 'createBuffer');
    renderDialog({ sampleRate: 48000 });
    fireEvent.click(screen.getByRole('button', { name: '试听' }));
    await waitFor(() => expect(createBuffer).toHaveBeenCalledWith(1, 8, 48000));
    fireEvent.click(await screen.findByRole('button', { name: '停止试听' }));
    createBuffer.mockRestore();
  });

  it('disables dependent controls and prevents a no-op application', () => {
    const { onApply } = renderDialog();
    fireEvent.click(screen.getByLabelText('标准化峰值到'));
    expect(screen.getByLabelText('峰值（dB）')).toBeDisabled();
    expect(screen.getByLabelText('独立标准化立体声声道')).toBeDisabled();
    fireEvent.click(screen.getByLabelText('去除直流偏移（居中到 0.0）'));
    expect(screen.getByText('至少启用去直流或峰值标准化之一。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '应用' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '试听' })).toBeDisabled();

    fireEvent.click(screen.getByLabelText('去除直流偏移（居中到 0.0）'));
    fireEvent.click(screen.getByRole('button', { name: '应用' }));
    expect(onApply).toHaveBeenCalledWith({
      removeDc: true,
      normalizePeak: false,
      peakDb: -1,
      stereoIndependent: false,
    });
  });

  it('validates peak bounds and applies independent stereo settings', () => {
    const { onApply } = renderDialog();
    const peak = screen.getByLabelText('峰值（dB）');
    fireEvent.change(peak, { target: { value: '0.1' } });
    expect(screen.getByRole('alert')).toHaveTextContent('-145–0');
    expect(screen.getByRole('button', { name: '应用' })).toBeDisabled();
    fireEvent.change(peak, { target: { value: '-6' } });
    fireEvent.click(screen.getByLabelText('独立标准化立体声声道'));
    fireEvent.click(screen.getByRole('button', { name: '应用' }));
    expect(onApply).toHaveBeenCalledWith({
      removeDc: true,
      normalizePeak: true,
      peakDb: -6,
      stereoIndependent: true,
    });
  });

  it('resets official defaults and surfaces preview errors', async () => {
    const onPreview = vi.fn().mockRejectedValue(new Error('preview failed'));
    renderDialog({ onPreview });
    fireEvent.change(screen.getByLabelText('峰值（dB）'), { target: { value: '-20' } });
    fireEvent.click(screen.getByLabelText('去除直流偏移（居中到 0.0）'));
    fireEvent.click(screen.getByRole('button', { name: '重置' }));
    expect(screen.getByLabelText('峰值（dB）')).toHaveValue('-1');
    expect(screen.getByLabelText('去除直流偏移（居中到 0.0）')).toBeChecked();

    fireEvent.click(screen.getByRole('button', { name: '试听' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('preview failed');
  });

  it('blocks actions without a real selection or while applying', () => {
    const { rerender } = renderDialog({ hasSelection: false });
    expect(screen.getByRole('button', { name: '应用' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '试听' })).toBeDisabled();
    rerender(
      <NormalizeDialog
        open
        onOpenChange={vi.fn()}
        selectionStart={0}
        selectionEnd={1}
        sampleRate={44100}
        hasSelection
        isApplying
        onPreview={vi.fn()}
        onApply={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: '应用中…' })).toBeDisabled();
  });
});
