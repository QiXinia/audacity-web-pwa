import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PhaserEffectDialog from './PhaserEffectDialog';

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

function renderDialog(overrides: Partial<Parameters<typeof PhaserEffectDialog>[0]> = {}) {
  const onPreview = vi.fn().mockResolvedValue([new Float32Array([1, 0]), new Float32Array([0, 1])]);
  const onApply = vi.fn().mockResolvedValue(undefined);
  const onOpenChange = vi.fn();
  render(
    <PhaserEffectDialog
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

describe('PhaserEffectDialog', () => {
  beforeEach(() => {
    mockStartPreview.mockReset();
    mockStopPreview.mockClear();
    previewState.isPreviewing = false;
    previewState.previewError = null;
  });

  it('opens with all seven official defaults and fixed-length processing semantics', () => {
    renderDialog();
    expect(screen.getByLabelText('Stages')).toHaveValue(2);
    expect(screen.getByLabelText('Dry/Wet')).toHaveValue(128);
    expect(screen.getByLabelText('LFO 频率（Hz）')).toHaveValue(0.4);
    expect(screen.getByLabelText('LFO 起始相位（°）')).toHaveValue(0);
    expect(screen.getByLabelText('Depth')).toHaveValue(100);
    expect(screen.getByLabelText('Feedback（%）')).toHaveValue(0);
    expect(screen.getByLabelText('输出增益（dB）')).toHaveValue(-6);
    expect(screen.getByTestId('phaser-plan')).toHaveTextContent('每 20 个采样更新 LFO');
    expect(screen.getByText(/不会改变输出时长/)).toBeInTheDocument();
  });

  it('shows Audacity odd-stage normalization before preview or apply', () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText('Stages'), { target: { value: '23' } });
    expect(screen.getByTestId('phaser-plan')).toHaveTextContent('实际 22 个全通级');
    expect(screen.getByRole('button', { name: '应用 Phaser' })).toBeEnabled();
  });

  it('submits all edited parameters to the real parent command', async () => {
    const { onApply } = renderDialog();
    fireEvent.change(screen.getByLabelText('Stages'), { target: { value: '8' } });
    fireEvent.change(screen.getByLabelText('Dry/Wet'), { target: { value: '200' } });
    fireEvent.change(screen.getByLabelText('LFO 频率（Hz）'), { target: { value: '2.5' } });
    fireEvent.change(screen.getByLabelText('LFO 起始相位（°）'), { target: { value: '90' } });
    fireEvent.change(screen.getByLabelText('Depth'), { target: { value: '220' } });
    fireEvent.change(screen.getByLabelText('Feedback（%）'), { target: { value: '-75' } });
    fireEvent.change(screen.getByLabelText('输出增益（dB）'), { target: { value: '-3' } });
    fireEvent.click(screen.getByRole('button', { name: '应用 Phaser' }));
    await waitFor(() => expect(onApply).toHaveBeenCalledWith({
      stages: 8,
      dryWet: 200,
      frequencyHz: 2.5,
      phaseDegrees: 90,
      depth: 220,
      feedbackPercent: -75,
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
      stages: 2,
      frequencyHz: 0.4,
      outputGainDb: -6,
    })));
    expect(mockStartPreview.mock.calls[0][1]).toBe(48000);
    expect(onApply).not.toHaveBeenCalled();
  });

  it('blocks invalid values before preview or application', () => {
    const { onApply, onPreview } = renderDialog();
    fireEvent.change(screen.getByLabelText('LFO 频率（Hz）'), { target: { value: '5' } });
    expect(screen.getByRole('alert')).toHaveTextContent('LFO 频率必须在 0.001–4 之间');
    expect(screen.getByRole('button', { name: '应用 Phaser' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '试听' })).toBeDisabled();
    expect(onApply).not.toHaveBeenCalled();
    expect(onPreview).not.toHaveBeenCalled();
  });

  it('disables every parameter and both actions while applying', () => {
    renderDialog({ isApplying: true });
    expect(screen.getByLabelText('Stages')).toBeDisabled();
    expect(screen.getByLabelText('Dry/Wet')).toBeDisabled();
    expect(screen.getByLabelText('LFO 频率（Hz）')).toBeDisabled();
    expect(screen.getByLabelText('LFO 起始相位（°）')).toBeDisabled();
    expect(screen.getByLabelText('Depth')).toBeDisabled();
    expect(screen.getByLabelText('Feedback（%）')).toBeDisabled();
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
