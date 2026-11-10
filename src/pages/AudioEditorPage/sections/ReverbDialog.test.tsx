import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_REVERB_SETTINGS } from '@/lib/reverbEffect';
import ReverbDialog from './ReverbDialog';

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

function renderDialog(overrides: Partial<Parameters<typeof ReverbDialog>[0]> = {}) {
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
  render(<ReverbDialog {...props} />);
  return props;
}

describe('ReverbDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('AudioContext', MockAudioContext);
  });

  it('previews and applies all Audacity Reverb parameters', async () => {
    const props = renderDialog();
    fireEvent.change(screen.getByLabelText('房间大小（%）'), { target: { value: '90' } });
    fireEvent.change(screen.getByLabelText('预延迟（ms）'), { target: { value: '20' } });
    fireEvent.change(screen.getByLabelText('混响强度（%）'), { target: { value: '60' } });
    fireEvent.change(screen.getByLabelText('高频阻尼（%）'), { target: { value: '40' } });
    fireEvent.change(screen.getByLabelText('低音色调（%）'), { target: { value: '80' } });
    fireEvent.change(screen.getByLabelText('高音色调（%）'), { target: { value: '70' } });
    fireEvent.change(screen.getByLabelText('湿声增益（dB）'), { target: { value: '-3' } });
    fireEvent.change(screen.getByLabelText('干声增益（dB）'), { target: { value: '-6' } });
    fireEvent.change(screen.getByLabelText('立体声宽度（%）滑块'), { target: { value: '65' } });
    fireEvent.click(screen.getByLabelText('仅湿声'));
    fireEvent.click(screen.getByRole('button', { name: '试听' }));
    const expected = {
      roomSize: 90,
      preDelayMs: 20,
      reverberance: 60,
      hfDamping: 40,
      toneLow: 80,
      toneHigh: 70,
      wetGainDb: -3,
      dryGainDb: -6,
      stereoWidth: 65,
      wetOnly: true,
    };
    await waitFor(() => expect(props.onPreview).toHaveBeenCalledWith(expected));
    fireEvent.click(screen.getByRole('button', { name: '应用混响' }));
    expect(props.onApply).toHaveBeenCalledWith(expected);
  });

  it('keeps incomplete drafts visible and blocks invalid values', () => {
    const props = renderDialog();
    fireEvent.change(screen.getByLabelText('房间大小（%）'), { target: { value: '' } });
    expect(screen.getByLabelText('房间大小（%）')).toHaveValue(null);
    expect(screen.getByRole('alert')).toHaveTextContent('请填写全部 Reverb 参数');
    expect(screen.getByRole('button', { name: '试听' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('预延迟（ms）'), { target: { value: '201' } });
    fireEvent.change(screen.getByLabelText('房间大小（%）'), { target: { value: '75' } });
    expect(screen.getByRole('alert')).toHaveTextContent('预延迟必须在 0–200 之间');
    expect(screen.getByRole('button', { name: '应用混响' })).toBeDisabled();
    expect(props.onApply).not.toHaveBeenCalled();
  });

  it('resets every parameter to the Audacity defaults', () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText('房间大小（%）'), { target: { value: '5' } });
    fireEvent.click(screen.getByLabelText('仅湿声'));
    fireEvent.click(screen.getByRole('button', { name: '恢复默认' }));
    expect(screen.getByLabelText('房间大小（%）')).toHaveValue(DEFAULT_REVERB_SETTINGS.roomSize);
    expect(screen.getByLabelText('预延迟（ms）')).toHaveValue(DEFAULT_REVERB_SETTINGS.preDelayMs);
    expect(screen.getByLabelText('混响强度（%）')).toHaveValue(DEFAULT_REVERB_SETTINGS.reverberance);
    expect(screen.getByLabelText('湿声增益（dB）')).toHaveValue(DEFAULT_REVERB_SETTINGS.wetGainDb);
    expect(screen.getByLabelText('立体声宽度（%）')).toHaveValue(DEFAULT_REVERB_SETTINGS.stereoWidth);
    expect(screen.getByLabelText('仅湿声')).not.toBeChecked();
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
    expect(screen.getByRole('button', { name: '应用混响' })).toBeDisabled();
    expect(screen.getByText('请先选择要处理的音频')).toBeInTheDocument();
  });
});
