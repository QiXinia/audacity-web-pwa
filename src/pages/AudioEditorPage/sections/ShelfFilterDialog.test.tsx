import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ShelfFilterDialog from './ShelfFilterDialog';

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

function renderDialog(overrides: Partial<Parameters<typeof ShelfFilterDialog>[0]> = {}) {
  const props = {
    open: true,
    onOpenChange: vi.fn(),
    sampleRate: 48_000,
    selectionStart: 0,
    selectionEnd: 1,
    isApplying: false,
    onPreview: vi.fn(async () => [new Float32Array(48_000)]),
    onApply: vi.fn(),
    ...overrides,
  };
  render(<ShelfFilterDialog {...props} />);
  return props;
}

describe('ShelfFilterDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('AudioContext', MockAudioContext);
  });

  it('previews and applies high-shelf settings', async () => {
    const props = renderDialog();
    fireEvent.change(screen.getByLabelText('滤波类型'), { target: { value: 'high' } });
    fireEvent.change(screen.getByLabelText('频率（Hz）'), { target: { value: '2000' } });
    fireEvent.change(screen.getByLabelText('增益（dB）'), { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: '试听' }));
    await waitFor(() => expect(props.onPreview).toHaveBeenCalledWith({ type: 'high', frequencyHz: 2000, gainDb: 12 }));
    fireEvent.click(screen.getByRole('button', { name: '应用 Shelf Filter' }));
    expect(props.onApply).toHaveBeenCalledWith({ type: 'high', frequencyHz: 2000, gainDb: 12 });
  });

  it('preserves incomplete drafts and blocks out-of-range or fractional values', () => {
    const props = renderDialog();
    fireEvent.change(screen.getByLabelText('频率（Hz）'), { target: { value: '' } });
    expect(screen.getByRole('alert')).toHaveTextContent('请填写频率和增益');
    expect(screen.getByRole('button', { name: '试听' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('频率（Hz）'), { target: { value: '1000.5' } });
    expect(screen.getByRole('alert')).toHaveTextContent('频率必须是整数');
    fireEvent.change(screen.getByLabelText('增益（dB）'), { target: { value: '73' } });
    expect(screen.getByRole('button', { name: '应用 Shelf Filter' })).toBeDisabled();
    expect(props.onApply).not.toHaveBeenCalled();
  });

  it('shows the Nyquist error', () => {
    renderDialog({ sampleRate: 1000 });
    expect(screen.getByRole('alert')).toHaveTextContent('Nyquist');
    expect(screen.getByRole('button', { name: '应用 Shelf Filter' })).toBeDisabled();
  });

  it('suppresses a zero-gain history write', () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText('增益（dB）'), { target: { value: '0' } });
    expect(screen.getByRole('button', { name: '应用 Shelf Filter' })).toBeDisabled();
  });

  it('resets every control to the official defaults', () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText('滤波类型'), { target: { value: 'high' } });
    fireEvent.change(screen.getByLabelText('频率（Hz）'), { target: { value: '4000' } });
    fireEvent.change(screen.getByLabelText('增益（dB）'), { target: { value: '20' } });
    fireEvent.click(screen.getByRole('button', { name: '恢复默认' }));
    expect(screen.getByLabelText('滤波类型')).toHaveValue('low');
    expect(screen.getByLabelText('频率（Hz）')).toHaveValue(1000);
    expect(screen.getByLabelText('增益（dB）')).toHaveValue(-6);
  });
});
