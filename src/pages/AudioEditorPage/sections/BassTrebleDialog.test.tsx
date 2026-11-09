import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import BassTrebleDialog from './BassTrebleDialog';

class MockAudioContext {
  state = 'running';
  destination = {};
  resume = vi.fn(async () => undefined);
  close = vi.fn(async () => undefined);
  createBuffer(channels: number, length: number) {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { getChannelData: (index: number) => data[index], duration: length / 1000 };
  }
  createBufferSource() {
    return {
      buffer: null,
      onended: null,
      connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(),
    };
  }
}

function renderDialog(overrides: Partial<Parameters<typeof BassTrebleDialog>[0]> = {}) {
  const props = {
    open: true,
    onOpenChange: vi.fn(),
    sampleRate: 1000,
    selectionStart: 0,
    selectionEnd: 0.01,
    hasSelection: true,
    isApplying: false,
    onPreview: vi.fn(async () => [new Float32Array(10)]),
    onApply: vi.fn(),
    ...overrides,
  };
  render(<BassTrebleDialog {...props} />);
  return props;
}

describe('BassTrebleDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('AudioContext', MockAudioContext);
  });

  it('previews and applies valid bass, treble and gain settings', async () => {
    const props = renderDialog();
    fireEvent.change(screen.getByLabelText('低音（dB）'), { target: { value: '6' } });
    fireEvent.change(screen.getByLabelText('高音（dB）'), { target: { value: '-3' } });
    fireEvent.change(screen.getByLabelText('输出音量（dB）'), { target: { value: '1.5' } });
    fireEvent.click(screen.getByRole('button', { name: '试听' }));
    await waitFor(() => expect(props.onPreview).toHaveBeenCalledWith({
      bassDb: 6, trebleDb: -3, gainDb: 1.5, linkSliders: false,
    }));
    fireEvent.click(screen.getByRole('button', { name: '应用低音和高音' }));
    expect(props.onApply).toHaveBeenCalledWith({
      bassDb: 6, trebleDb: -3, gainDb: 1.5, linkSliders: false,
    });
  });

  it('implements Audacity linked volume compensation for boosts and cuts', () => {
    renderDialog();
    fireEvent.click(screen.getByLabelText('音量随音调联动'));
    fireEvent.change(screen.getByLabelText('低音（dB）'), { target: { value: '8' } });
    expect(screen.getByLabelText('输出音量（dB）')).toHaveValue(-4);
    fireEvent.change(screen.getByLabelText('高音（dB）'), { target: { value: '-12' } });
    expect(screen.getByLabelText('输出音量（dB）')).toHaveValue(-1);
  });

  it('keeps incomplete drafts visible and blocks invalid values', () => {
    const props = renderDialog();
    fireEvent.change(screen.getByLabelText('低音（dB）'), { target: { value: '' } });
    expect(screen.getByLabelText('低音（dB）')).toHaveValue(null);
    expect(screen.getByRole('alert')).toHaveTextContent('请填写低音、高音和输出音量');
    expect(screen.getByRole('button', { name: '试听' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('低音（dB）'), { target: { value: '31' } });
    expect(screen.getByRole('alert')).toHaveTextContent('低音必须在 -30–30 dB 之间');
    expect(screen.getByRole('button', { name: '应用低音和高音' })).toBeDisabled();
    expect(props.onApply).not.toHaveBeenCalled();
  });

  it('updates linked compensation from a slider and resets every control', () => {
    renderDialog();
    fireEvent.click(screen.getByLabelText('音量随音调联动'));
    fireEvent.change(screen.getByLabelText('低音（dB）滑块'), { target: { value: '10' } });
    expect(screen.getByLabelText('低音（dB）')).toHaveValue(10);
    expect(screen.getByLabelText('输出音量（dB）')).toHaveValue(-5);
    fireEvent.click(screen.getByRole('button', { name: '恢复默认' }));
    expect(screen.getByLabelText('低音（dB）')).toHaveValue(0);
    expect(screen.getByLabelText('高音（dB）')).toHaveValue(0);
    expect(screen.getByLabelText('输出音量（dB）')).toHaveValue(0);
    expect(screen.getByLabelText('音量随音调联动')).not.toBeChecked();
  });

  it('skips an all-zero apply but still permits a harmless preview', async () => {
    const props = renderDialog();
    expect(screen.getByRole('button', { name: '应用低音和高音' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '试听' }));
    await waitFor(() => expect(props.onPreview).toHaveBeenCalled());
    expect(props.onApply).not.toHaveBeenCalled();
  });

  it('shows preview errors without submitting settings', async () => {
    const props = renderDialog({ onPreview: vi.fn(async () => { throw new Error('preview unavailable'); }) });
    fireEvent.change(screen.getByLabelText('低音（dB）'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: '试听' }));
    expect(await screen.findByText('试听失败：preview unavailable')).toBeInTheDocument();
    expect(props.onApply).not.toHaveBeenCalled();
  });

  it('disables preview and apply without a real selection', () => {
    renderDialog({ hasSelection: false });
    expect(screen.getByRole('button', { name: '试听' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '应用低音和高音' })).toBeDisabled();
    expect(screen.getByText('请先选择要处理的音频')).toBeInTheDocument();
  });
});
