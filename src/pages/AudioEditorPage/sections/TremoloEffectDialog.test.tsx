import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TremoloEffectDialog from './TremoloEffectDialog';

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

function renderDialog(overrides: Partial<Parameters<typeof TremoloEffectDialog>[0]> = {}) {
  const onPreview = vi.fn().mockResolvedValue([new Float32Array([1, 0]), new Float32Array([0, 1])]);
  const onApply = vi.fn().mockResolvedValue(undefined);
  const onOpenChange = vi.fn();
  render(
    <TremoloEffectDialog
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

describe('TremoloEffectDialog', () => {
  beforeEach(() => {
    mockStartPreview.mockReset();
    mockStopPreview.mockClear();
    previewState.isPreviewing = false;
    previewState.previewError = null;
  });

  it('opens with the four official Nyquist defaults and continuous-LFO semantics', () => {
    renderDialog();
    expect(screen.getByLabelText('波形类型')).toHaveTextContent('Sine 正弦波');
    expect(screen.getByLabelText('起始相位（°）')).toHaveValue(0);
    expect(screen.getByLabelText('Wet（%）')).toHaveValue(40);
    expect(screen.getByLabelText('LFO 频率（Hz）')).toHaveValue(4);
    expect(screen.getByTestId('tremolo-plan')).toHaveTextContent('Wet/200');
    expect(screen.getByTestId('tremolo-plan')).toHaveTextContent('所有声道共享连续 LFO');
  });

  it('submits the selected waveform and all edited numeric parameters', async () => {
    const { onApply } = renderDialog();
    const nativeSelect = document.querySelector('select[aria-hidden="true"]') as HTMLSelectElement;
    fireEvent.change(nativeSelect, { target: { value: 'square' } });
    expect(screen.getByLabelText('波形类型')).toHaveTextContent('Square 方波');
    fireEvent.change(screen.getByLabelText('起始相位（°）'), { target: { value: '90' } });
    fireEvent.change(screen.getByLabelText('Wet（%）'), { target: { value: '85' } });
    fireEvent.change(screen.getByLabelText('LFO 频率（Hz）'), { target: { value: '7.5' } });
    fireEvent.click(screen.getByRole('button', { name: '应用 Tremolo' }));
    await waitFor(() => expect(onApply).toHaveBeenCalledWith({
      waveform: 'square', phaseDegrees: 90, wetPercent: 85, frequencyHz: 7.5,
    }));
    expect(mockStopPreview).toHaveBeenCalled();
  });

  it('previews real parent PCM without applying project state', async () => {
    const { onPreview, onApply } = renderDialog();
    mockStartPreview.mockImplementation(async (createSamples: () => Promise<Float32Array[]>) => {
      expect(await createSamples()).toHaveLength(2);
    });
    fireEvent.click(screen.getByRole('button', { name: '试听' }));
    await waitFor(() => expect(onPreview).toHaveBeenCalledWith({
      waveform: 'sine', phaseDegrees: 0, wetPercent: 40, frequencyHz: 4,
    }));
    expect(mockStartPreview.mock.calls[0][1]).toBe(48000);
    expect(onApply).not.toHaveBeenCalled();
  });

  it.each([
    ['起始相位（°）', '0.5', '起始相位'],
    ['Wet（%）', '0', 'Wet 百分比'],
    ['LFO 频率（Hz）', '0', 'LFO 频率'],
  ])('rejects invalid numeric drafts %#', (label, value, message) => {
    const { onApply, onPreview } = renderDialog();
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
    expect(screen.getByRole('alert')).toHaveTextContent(message);
    expect(screen.getByRole('button', { name: '应用 Tremolo' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '试听' })).toBeDisabled();
    expect(onApply).not.toHaveBeenCalled();
    expect(onPreview).not.toHaveBeenCalled();
  });

  it('disables every parameter and both actions while applying', () => {
    renderDialog({ isApplying: true });
    expect(screen.getByLabelText('波形类型')).toBeDisabled();
    expect(screen.getByLabelText('起始相位（°）')).toBeDisabled();
    expect(screen.getByLabelText('Wet（%）')).toBeDisabled();
    expect(screen.getByLabelText('LFO 频率（Hz）')).toBeDisabled();
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
