import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import RissetDrumDialog from './RissetDrumDialog';

const mockGenerateRisset = vi.hoisted(() => vi.fn(() => ({
  samples: new Float32Array([0, 0.8, -0.4, 0]),
})));
const mockStartPreview = vi.hoisted(() => vi.fn());
const mockStopPreview = vi.hoisted(() => vi.fn());
const previewState = vi.hoisted(() => ({ isPreviewing: false, previewError: null as string | null }));

vi.mock('@/lib/rissetDrumGenerator', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/rissetDrumGenerator')>()),
  generateRissetDrum: mockGenerateRisset,
}));
vi.mock('./useGeneratorPreview', () => ({
  useGeneratorPreview: () => ({
    isPreviewing: previewState.isPreviewing,
    previewError: previewState.previewError,
    startPreview: mockStartPreview,
    stopPreview: mockStopPreview,
  }),
}));

function renderDialog(overrides: Partial<Parameters<typeof RissetDrumDialog>[0]> = {}) {
  const onGenerate = vi.fn().mockResolvedValue(undefined);
  const onOpenChange = vi.fn();
  render(
    <RissetDrumDialog
      open
      onOpenChange={onOpenChange}
      sampleRate={1000}
      cursorPosition={0}
      isGenerating={false}
      onGenerate={onGenerate}
      {...overrides}
    />,
  );
  return { onGenerate, onOpenChange };
}

describe('RissetDrumDialog', () => {
  beforeEach(() => {
    mockGenerateRisset.mockClear();
    mockStartPreview.mockReset();
    mockStopPreview.mockClear();
    previewState.isPreviewing = false;
    previewState.previewError = null;
  });

  it('opens with all six current official controls and defaults', () => {
    renderDialog();
    expect(screen.getByLabelText('主频率（Hz）')).toHaveValue(100);
    expect(screen.getByLabelText('衰减时长（秒）')).toHaveValue(2);
    expect(screen.getByLabelText('噪声中心频率（Hz）')).toHaveValue(500);
    expect(screen.getByLabelText('噪声带宽（Hz）')).toHaveValue(400);
    expect(screen.getByLabelText('噪声混合比例（%）')).toHaveValue(25);
    expect(screen.getByLabelText('振幅（0–1）')).toHaveValue(0.8);
    expect(screen.getByTestId('risset-plan')).toHaveTextContent('2000 个采样');
  });

  it('submits every edited DSP parameter', async () => {
    const { onGenerate } = renderDialog();
    fireEvent.change(screen.getByLabelText('主频率（Hz）'), { target: { value: '120' } });
    fireEvent.change(screen.getByLabelText('衰减时长（秒）'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('噪声中心频率（Hz）'), { target: { value: '700' } });
    fireEvent.change(screen.getByLabelText('噪声带宽（Hz）'), { target: { value: '300' } });
    fireEvent.change(screen.getByLabelText('噪声混合比例（%）'), { target: { value: '40' } });
    fireEvent.change(screen.getByLabelText('振幅（0–1）'), { target: { value: '0.6' } });
    fireEvent.click(screen.getByRole('button', { name: '生成 Risset Drum' }));

    await waitFor(() => expect(onGenerate).toHaveBeenCalledWith({
      frequency: 120,
      decay: 3,
      centerFrequency: 700,
      bandwidth: 300,
      noisePercent: 40,
      amplitude: 0.6,
      sampleRate: 1000,
    }));
    expect(mockStopPreview).toHaveBeenCalled();
  });

  it('previews deterministic samples without committing audio', async () => {
    const { onGenerate } = renderDialog();
    mockStartPreview.mockImplementation(async (createSamples: () => Float32Array) => {
      createSamples();
    });
    fireEvent.click(screen.getByRole('button', { name: '试听' }));
    await waitFor(() => expect(mockStartPreview).toHaveBeenCalledTimes(1));
    expect(mockGenerateRisset).toHaveBeenCalledWith(expect.objectContaining({
      frequency: 100,
      decay: 2,
      seed: 1,
      sampleRate: 1000,
    }));
    expect(mockStartPreview.mock.calls[0][1]).toBe(1000);
    expect(onGenerate).not.toHaveBeenCalled();
  });

  it('keeps decay editable for a selection and reports tail movement', () => {
    renderDialog({ selectionActive: true, replacementPosition: 0.25, replacementEnd: 2 });
    expect(screen.getByLabelText('衰减时长（秒）')).not.toHaveAttribute('readonly');
    expect(screen.getByText(/按实际生成时长替换并平移后续片段/)).toBeInTheDocument();
  });

  it('allows zero amplitude as an explicit silent result', async () => {
    const { onGenerate } = renderDialog();
    fireEvent.change(screen.getByLabelText('振幅（0–1）'), { target: { value: '0' } });
    expect(screen.getByRole('button', { name: '生成 Risset Drum' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '生成 Risset Drum' }));
    await waitFor(() => expect(onGenerate).toHaveBeenCalledWith(expect.objectContaining({ amplitude: 0 })));
  });

  it('blocks out-of-range frequency before generation', () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText('主频率（Hz）'), { target: { value: '49' } });
    expect(screen.getByRole('alert')).toHaveTextContent('主频率须为 50–2000 Hz');
    expect(screen.getByRole('button', { name: '生成 Risset Drum' })).toBeDisabled();
  });

  it('blocks out-of-range noise percentage before generation', () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText('噪声混合比例（%）'), { target: { value: '101' } });
    expect(screen.getByRole('alert')).toHaveTextContent('噪声混合比例须为 0–100%');
    expect(screen.getByRole('button', { name: '生成 Risset Drum' })).toBeDisabled();
    expect(mockGenerateRisset).not.toHaveBeenCalled();
  });
});
