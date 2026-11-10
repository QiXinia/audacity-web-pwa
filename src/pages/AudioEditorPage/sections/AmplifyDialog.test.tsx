// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AmplifyDialog } from './AmplifyDialog';

function renderDialog(overrides: Partial<Parameters<typeof AmplifyDialog>[0]> = {}) {
  const onAnalyze = vi.fn().mockResolvedValue(0.5);
  const onPreview = vi.fn().mockResolvedValue([new Float32Array(8)]);
  const onApply = vi.fn();
  const result = render(
    <AmplifyDialog
      open
      onOpenChange={vi.fn()}
      selectionStart={0}
      selectionEnd={1}
      sampleRate={44100}
      hasSelection
      isApplying={false}
      onAnalyze={onAnalyze}
      onPreview={onPreview}
      onApply={onApply}
      {...overrides}
    />,
  );
  return { onAnalyze, onPreview, onApply, ...result };
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

describe('AmplifyDialog', () => {
  beforeEach(() => {
    vi.stubGlobal('AudioContext', MockAudioContext);
  });

  it('analyses the selection, sets 0 dB new peak, and previews the exact ratio', async () => {
    const { onAnalyze, onPreview } = renderDialog();
    await waitFor(() => expect(screen.getByLabelText('放大增益（dB）')).toHaveValue('6.0206'));
    expect(onAnalyze).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('新峰值振幅（dB）')).toHaveValue('0.0000');
    expect(screen.getByLabelText('允许削波')).not.toBeChecked();
    expect(screen.getByText('选区峰值：-6.0206 dB')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '试听' }));
    await waitFor(() => expect(onPreview).toHaveBeenCalledWith({ ratio: 2, allowClipping: false }));
    fireEvent.click(await screen.findByRole('button', { name: '停止试听' }));
    expect(screen.getByRole('button', { name: '试听' })).toBeEnabled();
  });

  it('links amplification and new peak in both directions', async () => {
    const { onApply } = renderDialog();
    await waitFor(() => expect(screen.getByLabelText('放大增益（dB）')).toHaveValue('6.0206'));
    fireEvent.change(screen.getByLabelText('放大增益（dB）'), { target: { value: '-6' } });
    expect(screen.getByLabelText('新峰值振幅（dB）')).toHaveValue('-12.0206');

    fireEvent.change(screen.getByLabelText('新峰值振幅（dB）'), { target: { value: '-6' } });
    expect(screen.getByLabelText('放大增益（dB）')).toHaveValue('0.0206');
    fireEvent.click(screen.getByRole('button', { name: '应用' }));
    expect(onApply).toHaveBeenCalledWith({
      ratio: 10 ** (-6 / 20) / 0.5,
      allowClipping: false,
    });
  });

  it('blocks clipping until explicitly allowed', async () => {
    const { onApply } = renderDialog();
    await waitFor(() => expect(screen.getByLabelText('放大增益（dB）')).toHaveValue('6.0206'));
    fireEvent.change(screen.getByLabelText('新峰值振幅（dB）'), { target: { value: '6' } });
    expect(screen.getByText('新峰值超过 0 dB；请降低增益或明确允许削波。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '应用' })).toBeDisabled();
    expect(onApply).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText('允许削波'));
    expect(screen.getByRole('button', { name: '应用' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '应用' }));
    expect(onApply).toHaveBeenCalledWith({ ratio: 10 ** (6 / 20) / 0.5, allowClipping: true });
  });

  it('uses the project sample rate and surfaces preview errors', async () => {
    const createBuffer = vi.spyOn(MockAudioContext.prototype, 'createBuffer');
    const onPreview = vi.fn()
      .mockResolvedValue([new Float32Array(8)])
      .mockRejectedValueOnce(new Error('preview failed'));
    renderDialog({ sampleRate: 48000, onPreview });
    await waitFor(() => expect(screen.getByLabelText('放大增益（dB）')).toHaveValue('6.0206'));
    fireEvent.click(screen.getByRole('button', { name: '试听' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('preview failed');
    fireEvent.click(screen.getByRole('button', { name: '试听' }));
    await waitFor(() => expect(createBuffer).toHaveBeenCalledWith(1, 8, 48000));
    fireEvent.click(await screen.findByRole('button', { name: '停止试听' }));
    createBuffer.mockRestore();
  });

  it('resets official defaults and rejects silent selections', async () => {
    const onAnalyze = vi.fn().mockRejectedValue(new Error('所选音频为静音，无法放大'));
    renderDialog({ onAnalyze });
    expect(await screen.findByRole('alert')).toHaveTextContent('所选音频为静音');
    expect(screen.getByRole('button', { name: '应用' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '试听' })).toBeDisabled();
  });

  it('blocks actions without a selection or while applying', async () => {
    const { rerender } = renderDialog({ hasSelection: false });
    await waitFor(() => expect(screen.getByLabelText('放大增益（dB）')).toHaveValue('6.0206'));
    expect(screen.getByRole('button', { name: '应用' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '试听' })).toBeDisabled();
    rerender(
      <AmplifyDialog
        open
        onOpenChange={vi.fn()}
        selectionStart={0}
        selectionEnd={1}
        sampleRate={44100}
        hasSelection
        isApplying
        onAnalyze={vi.fn().mockResolvedValue(0.5)}
        onPreview={vi.fn()}
        onApply={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: '应用中…' })).toBeDisabled();
  });
});
