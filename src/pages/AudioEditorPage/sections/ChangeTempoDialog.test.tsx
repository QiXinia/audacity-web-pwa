import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChangeTempoDialog } from './ChangeTempoDialog';

class FakeAudioBuffer {
  private readonly data: Float32Array[];
  constructor(channels: number, readonly length: number) {
    this.data = Array.from({ length: channels }, () => new Float32Array(length));
  }
  getChannelData(channel: number) { return this.data[channel]; }
}

class FakeAudioContext {
  readonly destination = {};
  readonly buffers: FakeAudioBuffer[] = [];
  createBuffer(channels: number, length: number) {
    const buffer = new FakeAudioBuffer(channels, length);
    this.buffers.push(buffer);
    return buffer;
  }
  createBufferSource() {
    return {
      buffer: null,
      onended: null,
      connect: vi.fn(),
      disconnect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    };
  }
  resume = vi.fn().mockResolvedValue(undefined);
  close = vi.fn().mockResolvedValue(undefined);
}

describe('ChangeTempoDialog', () => {
  const preview = vi.fn().mockResolvedValue([new Float32Array(8)]);
  const apply = vi.fn();
  const openChange = vi.fn();
  const originalAudioContext = window.AudioContext;

  function renderDialog(overrides: Partial<Parameters<typeof ChangeTempoDialog>[0]> = {}) {
    return render(
      <ChangeTempoDialog
        open
        onOpenChange={openChange}
        selectionStart={1}
        selectionEnd={2}
        sampleRate={10}
        initialBpm={120}
        hasSelection
        isApplying={false}
        onPreview={preview}
        onApply={apply}
        {...overrides}
      />,
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();
    preview.mockResolvedValue([new Float32Array(8)]);
    Object.defineProperty(window, 'AudioContext', {
      configurable: true,
      value: FakeAudioContext,
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'AudioContext', {
      configurable: true,
      value: originalAudioContext,
    });
  });

  it('links BPM, percentage and target duration, then applies exact settings', () => {
    renderDialog();
    expect(screen.getByRole('button', { name: '应用' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('原始 BPM'), { target: { value: '120' } });
    fireEvent.change(screen.getByLabelText('变化百分比（%）'), { target: { value: '100' } });
    expect(screen.getByLabelText('目标 BPM')).toHaveValue('240.000');
    expect(screen.getByLabelText('目标时长（秒）')).toHaveValue('0.50');
    fireEvent.click(screen.getByRole('button', { name: '应用' }));
    expect(apply).toHaveBeenCalledWith({ percentChange: 100 });
  });

  it('derives percentage from BPM and target duration, including homologous tempo ratios', () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText('原始 BPM'), { target: { value: '120' } });
    fireEvent.change(screen.getByLabelText('目标 BPM'), { target: { value: '240' } });
    expect(screen.getByLabelText('变化百分比（%）')).toHaveValue('100.000');
    fireEvent.change(screen.getByLabelText('目标时长（秒）'), { target: { value: '2' } });
    expect(screen.getByLabelText('变化百分比（%）')).toHaveValue('-50.000');
    expect(screen.getByLabelText('目标 BPM')).toHaveValue('60.000');
    fireEvent.change(screen.getByLabelText('变化百分比滑块'), { target: { value: '100' } });
    expect(screen.getByLabelText('变化百分比（%）')).toHaveValue('400.037');
  });

  it('blocks invalid, zero and no-selection operations with clear feedback', () => {
    const { unmount } = renderDialog();
    fireEvent.change(screen.getByLabelText('变化百分比（%）'), { target: { value: '3001' } });
    expect(screen.getByRole('button', { name: '应用' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('-95% 至 3000%');
    fireEvent.change(screen.getByLabelText('变化百分比（%）'), { target: { value: '0' } });
    expect(screen.getByRole('button', { name: '应用' })).toBeDisabled();
    unmount();
    renderDialog({ hasSelection: false });
    expect(screen.getByText('请先选择要处理的音频。')).toBeInTheDocument();
  });

  it('previews the current settings and still applies after a preview failure', async () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText('变化百分比（%）'), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: '试听' }));
    await waitFor(() => expect(preview).toHaveBeenCalledWith({ percentChange: 100 }));
    await waitFor(() => expect(screen.getByRole('button', { name: '停止试听' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '停止试听' }));
    preview.mockRejectedValueOnce(new Error('preview failed'));
    fireEvent.click(screen.getByRole('button', { name: '试听' }));
    expect(await screen.findByText('preview failed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '应用' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '应用' }));
    expect(apply).toHaveBeenCalledWith({ percentChange: 100 });
  });

  it('does not let a late preview response start audio after close', async () => {
    let resolvePreview!: (channels: Float32Array[]) => void;
    preview.mockReturnValueOnce(new Promise<Float32Array[]>((resolve) => { resolvePreview = resolve; }));
    renderDialog();
    fireEvent.change(screen.getByLabelText('变化百分比（%）'), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: '试听' }));
    await waitFor(() => expect(preview).toHaveBeenCalled());
    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });
    resolvePreview([new Float32Array(8)]);
    await waitFor(() => expect(openChange).toHaveBeenCalledWith(false));
  });
});
