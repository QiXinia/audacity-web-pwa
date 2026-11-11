import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DISTORTION_SETTINGS } from '@/lib/distortionEffect';
import DistortionDialog from './DistortionDialog';

class MockAudioContext {
  state = 'running';
  destination = {};
  resume = vi.fn(async () => undefined);
  close = vi.fn(async () => undefined);
  createBuffer(channels: number, length: number, sampleRate: number) {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { getChannelData: (index: number) => data[index], duration: length / sampleRate };
  }
  createBufferSource() {
    return {
      buffer: null,
      onended: null,
      connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(),
    };
  }
}

function renderDialog(overrides: Partial<Parameters<typeof DistortionDialog>[0]> = {}) {
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
  render(<DistortionDialog {...props} />);
  return props;
}

describe('DistortionDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('AudioContext', MockAudioContext);
  });

  it('previews and applies the official hard-clipping parameters', async () => {
    const props = renderDialog();
    fireEvent.change(screen.getByLabelText('Clipping level（dB）'), { target: { value: '-12' } });
    fireEvent.change(screen.getByLabelText('Drive（%）'), { target: { value: '75' } });
    fireEvent.change(screen.getByLabelText('Make-up Gain（%）滑块'), { target: { value: '25' } });
    fireEvent.click(screen.getByRole('button', { name: '试听' }));
    const expected = {
      ...DEFAULT_DISTORTION_SETTINGS,
      thresholdDb: -12,
      param1: 75,
      param2: 25,
    };
    await waitFor(() => expect(props.onPreview).toHaveBeenCalledWith(expected));
    fireEvent.click(screen.getByRole('button', { name: '应用失真' }));
    expect(props.onApply).toHaveBeenCalledWith(expected);
  });

  it('changes controls with the official type rules and clears hidden DC blocking', () => {
    renderDialog();
    const type = screen.getByLabelText('失真类型');
    fireEvent.change(type, { target: { value: 'rectifier' } });
    expect(screen.getByLabelText('Distortion amount（%）')).toBeInTheDocument();
    expect(screen.queryByLabelText('Output level（%）')).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('DC blocking'));
    expect(screen.getByLabelText('DC blocking')).toBeChecked();
    fireEvent.change(type, { target: { value: 'sine-curve' } });
    expect(screen.queryByLabelText('DC blocking')).not.toBeInTheDocument();
    fireEvent.change(type, { target: { value: 'leveller' } });
    expect(screen.getByLabelText('Noise Floor（dB）')).toBeInTheDocument();
    expect(screen.getByLabelText('Degree of Levelling（次）')).toBeInTheDocument();
    fireEvent.change(type, { target: { value: 'rectifier' } });
    expect(screen.getByLabelText('DC blocking')).not.toBeChecked();
  });

  it('keeps incomplete drafts visible and blocks out-of-range repeats', () => {
    const props = renderDialog();
    fireEvent.change(screen.getByLabelText('失真类型'), { target: { value: 'cubic-curve' } });
    fireEvent.change(screen.getByLabelText('Repeat processing（次）'), { target: { value: '' } });
    expect(screen.getByRole('alert')).toHaveTextContent('请填写全部 Distortion 参数');
    expect(screen.getByRole('button', { name: '试听' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Repeat processing（次）'), { target: { value: '6' } });
    expect(screen.getByRole('alert')).toHaveTextContent('重复处理次数必须是 0–5 的整数');
    expect(screen.getByRole('button', { name: '应用失真' })).toBeDisabled();
    expect(props.onApply).not.toHaveBeenCalled();
  });

  it('resets every parameter to the Audacity defaults', () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText('失真类型'), { target: { value: 'leveller' } });
    fireEvent.change(screen.getByLabelText('Noise Floor（dB）'), { target: { value: '-30' } });
    fireEvent.click(screen.getByRole('button', { name: '恢复默认' }));
    expect(screen.getByLabelText('失真类型')).toHaveValue(DEFAULT_DISTORTION_SETTINGS.type);
    expect(screen.getByLabelText('Clipping level（dB）')).toHaveValue(DEFAULT_DISTORTION_SETTINGS.thresholdDb);
    expect(screen.getByLabelText('Drive（%）')).toHaveValue(DEFAULT_DISTORTION_SETTINGS.param1);
    expect(screen.getByLabelText('Make-up Gain（%）')).toHaveValue(DEFAULT_DISTORTION_SETTINGS.param2);
  });

  it('shows preview errors without submitting settings', async () => {
    const props = renderDialog({ onPreview: vi.fn(async () => { throw new Error('preview unavailable'); }) });
    fireEvent.click(screen.getByRole('button', { name: '试听' }));
    expect(await screen.findByText('试听失败：preview unavailable')).toBeInTheDocument();
    expect(props.onApply).not.toHaveBeenCalled();
  });

  it('disables preview and apply without a real selection', () => {
    renderDialog({ hasSelection: false });
    expect(screen.getByRole('button', { name: '试听' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '应用失真' })).toBeDisabled();
    expect(screen.getByText('请先选择要处理的音频')).toBeInTheDocument();
  });
});
