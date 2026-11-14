import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SlidingStretchDialog } from './SlidingStretchDialog';

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

describe('SlidingStretchDialog', () => {
  const preview = vi.fn().mockResolvedValue([new Float32Array(8)]);
  const apply = vi.fn();
  const openChange = vi.fn();
  const originalAudioContext = window.AudioContext;

  function renderDialog(overrides: Partial<Parameters<typeof SlidingStretchDialog>[0]> = {}) {
    return render(
      <SlidingStretchDialog
        open
        onOpenChange={openChange}
        selectionDuration={1.2}
        sampleRate={10}
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
    Object.defineProperty(window, 'AudioContext', { configurable: true, value: FakeAudioContext });
  });

  afterEach(() => {
    Object.defineProperty(window, 'AudioContext', { configurable: true, value: originalAudioContext });
  });

  it('renders the official four cards and six parameters with linked duration and apply', () => {
    renderDialog();
    expect(screen.getByText('Initial tempo change')).toBeInTheDocument();
    expect(screen.getByText('Final tempo change')).toBeInTheDocument();
    expect(screen.getByText('Initial pitch shift')).toBeInTheDocument();
    expect(screen.getByText('Final pitch shift')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '应用' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('初始 Tempo 变化（%）'), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText('最终 Tempo 变化（%）'), { target: { value: '100' } });
    expect(screen.getByText(/预计 0\.600 秒/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '应用' }));
    expect(apply).toHaveBeenCalledWith({
      initialTempoPercent: 100,
      finalTempoPercent: 100,
      initialPitchSemitones: 0,
      finalPitchSemitones: 0,
      initialPitchPercent: 0,
      finalPitchPercent: 0,
    });
  });

  it('converts semitones and pitch percentages bidirectionally with twelve-tone equal temperament', () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText('初始 Tempo 变化（%）'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('初始音高半音数'), { target: { value: '1' } });
    expect(screen.getByLabelText('初始音高变化（%）')).toHaveValue('5.946309');
    fireEvent.change(screen.getByLabelText('初始音高变化（%）'), { target: { value: '50' } });
    expect(screen.getByLabelText('初始音高半音数')).toHaveValue('7.019550');
    fireEvent.change(screen.getByLabelText('最终音高半音数'), { target: { value: '-1' } });
    expect(screen.getByLabelText('最终音高变化（%）')).toHaveValue('-5.612569');
    fireEvent.click(screen.getByRole('button', { name: '应用' }));
    expect(apply).toHaveBeenCalledWith(expect.objectContaining({
      initialPitchSemitones: 7.01955,
      initialPitchPercent: 50,
      finalPitchSemitones: -1,
      finalPitchPercent: -5.612569,
    }));
  });

  it('blocks out-of-range, neutral and no-selection operations with clear feedback', () => {
    const { unmount } = renderDialog();
    fireEvent.change(screen.getByLabelText('初始 Tempo 变化（%）'), { target: { value: '501' } });
    expect(screen.getByRole('alert')).toHaveTextContent('-90 至 500');
    expect(screen.getByRole('button', { name: '应用' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('初始 Tempo 变化（%）'), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText('初始音高半音数'), { target: { value: '12.1' } });
    expect(screen.getByRole('alert')).toHaveTextContent('-12 至 12');
    fireEvent.change(screen.getByLabelText('初始音高半音数'), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText('初始音高变化（%）'), { target: { value: '100.1' } });
    expect(screen.getByRole('alert')).toHaveTextContent('-50 至 100');
    unmount();
    renderDialog({ hasSelection: false });
    expect(screen.getByText('请先选择要处理的音频。')).toBeInTheDocument();
  });

  it('previews the current six settings and still applies after a preview failure', async () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText('初始 Tempo 变化（%）'), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: '试听' }));
    await waitFor(() => expect(preview).toHaveBeenCalledWith(expect.objectContaining({
      initialTempoPercent: 100,
      finalTempoPercent: 0,
    })));
    await waitFor(() => expect(screen.getByRole('button', { name: '停止试听' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '停止试听' }));
    preview.mockRejectedValueOnce(new Error('preview failed'));
    fireEvent.click(screen.getByRole('button', { name: '试听' }));
    expect(await screen.findByText('preview failed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '应用' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '应用' }));
    expect(apply).toHaveBeenCalledWith(expect.objectContaining({ initialTempoPercent: 100 }));
  });

  it('does not let a late preview response start audio after close', async () => {
    let resolvePreview!: (channels: Float32Array[]) => void;
    preview.mockReturnValueOnce(new Promise<Float32Array[]>((resolve) => { resolvePreview = resolve; }));
    renderDialog();
    fireEvent.change(screen.getByLabelText('初始 Tempo 变化（%）'), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: '试听' }));
    await waitFor(() => expect(preview).toHaveBeenCalled());
    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });
    resolvePreview([new Float32Array(8)]);
    await waitFor(() => expect(openChange).toHaveBeenCalledWith(false));
  });
});
