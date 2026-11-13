import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_AUTO_DUCK_SETTINGS } from '@/lib/autoDuckEffect';
import AutoDuckEffectDialog from './AutoDuckEffectDialog';

const tracks = [
  { id: 'music', name: 'Music' },
  { id: 'voice', name: 'Voice control' },
];

function renderDialog(overrides: Partial<Parameters<typeof AutoDuckEffectDialog>[0]> = {}) {
  const props = {
    open: true,
    onOpenChange: vi.fn(),
    tracks,
    sampleRate: 1000,
    selectionStart: 0,
    selectionEnd: 2,
    isApplying: false,
    onPreview: vi.fn(async () => [new Float32Array(20)]),
    onApply: vi.fn(),
    ...overrides,
  };
  render(<AutoDuckEffectDialog {...props} />);
  return props;
}

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
    return { buffer: null, onended: null, connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn() };
  }
}

describe('AutoDuckEffectDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('AudioContext', MockAudioContext);
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    });
  });

  it('shows all seven Audacity defaults and selects the last track as control', () => {
    renderDialog();
    expect(screen.getByLabelText('Duck amount（dB）')).toHaveValue(-12);
    expect(screen.getByLabelText('Maximum pause（秒）')).toHaveValue(1);
    expect(screen.getByLabelText('Outer fade down（秒）')).toHaveValue(0.5);
    expect(screen.getByLabelText('Outer fade up（秒）')).toHaveValue(0.5);
    expect(screen.getByLabelText('Inner fade down（秒）')).toHaveValue(0);
    expect(screen.getByLabelText('Inner fade up（秒）')).toHaveValue(0);
    expect(screen.getByLabelText('Threshold（dB）')).toHaveValue(-30);
    expect(screen.getByLabelText('控制轨（使用第一声道）')).toHaveTextContent('Voice control');
    expect(screen.getByTestId('auto-duck-plan')).toHaveTextContent('100 采样 RMS 窗');
    expect(screen.getByTestId('auto-duck-curve')).toBeInTheDocument();
  });

  it('previews and applies the exact non-default settings and explicit control track', async () => {
    const props = renderDialog();
    fireEvent.change(screen.getByLabelText('Duck amount（dB）'), { target: { value: '-18' } });
    fireEvent.change(screen.getByLabelText('Maximum pause（秒）'), { target: { value: '0.75' } });
    fireEvent.change(screen.getByLabelText('Threshold（dB）'), { target: { value: '-36' } });
    fireEvent.click(screen.getByRole('button', { name: '试听' }));
    await waitFor(() => expect(props.onPreview).toHaveBeenCalledWith({
      ...DEFAULT_AUTO_DUCK_SETTINGS,
      duckAmountDb: -18,
      maximumPause: 0.75,
      thresholdDb: -36,
    }, 'voice'));
    fireEvent.click(screen.getByRole('button', { name: '应用 Auto Duck' }));
    expect(props.onApply).toHaveBeenCalledWith({
      ...DEFAULT_AUTO_DUCK_SETTINGS,
      duckAmountDb: -18,
      maximumPause: 0.75,
      thresholdDb: -36,
    }, 'voice');
  });

  it('allows choosing another control track', async () => {
    const props = renderDialog();
    fireEvent.click(screen.getByLabelText('控制轨（使用第一声道）'));
    fireEvent.click(await screen.findByRole('option', { name: 'Music' }));
    fireEvent.click(screen.getByRole('button', { name: '应用 Auto Duck' }));
    expect(props.onApply).toHaveBeenCalledWith(DEFAULT_AUTO_DUCK_SETTINGS, 'music');
  });

  it('blocks invalid values and a missing second track', () => {
    renderDialog({ tracks: [tracks[0]] });
    expect(screen.getByRole('alert')).toHaveTextContent('至少两条含音频轨道');
    expect(screen.getByRole('button', { name: '应用 Auto Duck' })).toBeDisabled();
  });

  it('rejects an out-of-range duck amount', () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText('Duck amount（dB）'), { target: { value: '-25' } });
    expect(screen.getByRole('alert')).toHaveTextContent('压降量');
    expect(screen.getByRole('button', { name: '应用 Auto Duck' })).toBeDisabled();
  });
});
