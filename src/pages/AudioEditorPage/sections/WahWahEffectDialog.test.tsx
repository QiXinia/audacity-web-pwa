import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import WahWahEffectDialog from './WahWahEffectDialog';

const mockStartPreview = vi.hoisted(() => vi.fn());
const mockStopPreview = vi.hoisted(() => vi.fn());
const previewState = vi.hoisted(() => ({ isPreviewing: false, previewError: null as string | null }));

vi.mock('./useGeneratorPreview', () => ({
  useGeneratorPreview: () => ({
    isPreviewing: previewState.isPreviewing,
    previewError: previewState.previewError,
    startPreview: mockStartPreview,
    stopPreview: mockStopPreview,
  }),
}));

function renderDialog(overrides: Partial<Parameters<typeof WahWahEffectDialog>[0]> = {}) {
  const onPreview = vi.fn().mockResolvedValue([new Float32Array([1, 0]), new Float32Array([0, 1])]);
  const onApply = vi.fn().mockResolvedValue(undefined);
  const onOpenChange = vi.fn();
  render(
    <WahWahEffectDialog
      open
      onOpenChange={onOpenChange}
      sampleRate={48000}
      selectionStart={0.25}
      selectionEnd={2.25}
      isApplying={false}
      onPreview={onPreview}
      onApply={onApply}
      {...overrides}
    />,
  );
  return { onPreview, onApply, onOpenChange };
}

describe('WahWahEffectDialog', () => {
  beforeEach(() => {
    mockStartPreview.mockReset();
    mockStopPreview.mockClear();
    previewState.isPreviewing = false;
    previewState.previewError = null;
  });

  it('opens with all six official defaults and no-time-stretch semantics', () => {
    renderDialog();
    expect(screen.getByLabelText('LFO 频率（Hz）')).toHaveValue(1.5);
    expect(screen.getByLabelText('LFO 起始相位（°）')).toHaveValue(0);
    expect(screen.getByLabelText('深度（%）')).toHaveValue(70);
    expect(screen.getByLabelText('谐振')).toHaveValue(2.5);
    expect(screen.getByLabelText('Wah 频率偏移（%）')).toHaveValue(30);
    expect(screen.getByLabelText('输出增益（dB）')).toHaveValue(-6);
    expect(screen.getByTestId('wah-wah-plan')).toHaveTextContent('每 30 个采样');
    expect(screen.getByText(/不会改变输出时长|不会增加输出时长/)).toBeInTheDocument();
  });

  it('submits all edited parameters to the real parent command', async () => {
    const { onApply } = renderDialog();
    fireEvent.change(screen.getByLabelText('LFO 频率（Hz）'), { target: { value: '2.5' } });
    fireEvent.change(screen.getByLabelText('LFO 起始相位（°）'), { target: { value: '90' } });
    fireEvent.change(screen.getByLabelText('深度（%）'), { target: { value: '55' } });
    fireEvent.change(screen.getByLabelText('谐振'), { target: { value: '3.5' } });
    fireEvent.change(screen.getByLabelText('Wah 频率偏移（%）'), { target: { value: '40' } });
    fireEvent.change(screen.getByLabelText('输出增益（dB）'), { target: { value: '-3' } });
    fireEvent.click(screen.getByRole('button', { name: '应用 Wah Wah' }));
    await waitFor(() => expect(onApply).toHaveBeenCalledWith({
      frequencyHz: 2.5,
      phaseDegrees: 90,
      depthPercent: 55,
      resonance: 3.5,
      frequencyOffsetPercent: 40,
      outputGainDb: -3,
    }));
    expect(mockStopPreview).toHaveBeenCalled();
  });

  it('previews real parent PCM without applying or writing project state', async () => {
    const { onPreview, onApply } = renderDialog();
    mockStartPreview.mockImplementation(async (createSamples: () => Promise<Float32Array[]>) => {
      const samples = await createSamples();
      expect(samples).toHaveLength(2);
    });
    fireEvent.click(screen.getByRole('button', { name: '试听' }));
    await waitFor(() => expect(onPreview).toHaveBeenCalledWith(expect.objectContaining({
      frequencyHz: 1.5,
      resonance: 2.5,
    })));
    expect(mockStartPreview.mock.calls[0][1]).toBe(48000);
    expect(onApply).not.toHaveBeenCalled();
  });

  it('blocks invalid values before preview or application', () => {
    const { onApply, onPreview } = renderDialog();
    fireEvent.change(screen.getByLabelText('LFO 频率（Hz）'), { target: { value: '5' } });
    expect(screen.getByRole('alert')).toHaveTextContent('LFO 频率必须在 0.1–4 之间');
    expect(screen.getByRole('button', { name: '应用 Wah Wah' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '试听' })).toBeDisabled();
    expect(onApply).not.toHaveBeenCalled();
    expect(onPreview).not.toHaveBeenCalled();
  });

  it('disables every parameter and both actions while applying', () => {
    renderDialog({ isApplying: true });
    expect(screen.getByLabelText('LFO 频率（Hz）')).toBeDisabled();
    expect(screen.getByLabelText('LFO 起始相位（°）')).toBeDisabled();
    expect(screen.getByLabelText('深度（%）')).toBeDisabled();
    expect(screen.getByLabelText('谐振')).toBeDisabled();
    expect(screen.getByLabelText('Wah 频率偏移（%）')).toBeDisabled();
    expect(screen.getByLabelText('输出增益（dB）')).toBeDisabled();
    expect(screen.getByRole('button', { name: '试听' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '正在应用…' })).toBeDisabled();
  });

  it('stops playback when the dialog closes', () => {
    const { onOpenChange } = renderDialog();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(mockStopPreview).toHaveBeenCalled();
  });
});
