import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import EchoEffectDialog from './EchoEffectDialog';

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

function renderDialog(overrides: Partial<Parameters<typeof EchoEffectDialog>[0]> = {}) {
  const onPreview = vi.fn().mockResolvedValue([new Float32Array([1, 0]), new Float32Array([0, 1])]);
  const onApply = vi.fn().mockResolvedValue(undefined);
  const onOpenChange = vi.fn();
  render(
    <EchoEffectDialog
      open
      onOpenChange={onOpenChange}
      sampleRate={10}
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

describe('EchoEffectDialog', () => {
  beforeEach(() => {
    mockStartPreview.mockReset();
    mockStopPreview.mockClear();
    previewState.isPreviewing = false;
    previewState.previewError = null;
  });

  it('opens with official defaults, selection details and no-extension semantics', () => {
    renderDialog();
    expect(screen.getByLabelText('延迟时间（秒）')).toHaveValue(1);
    expect(screen.getByLabelText('衰减因子')).toHaveValue(0.5);
    expect(screen.getByTestId('echo-plan')).toHaveTextContent('延迟 10 个采样');
    expect(screen.getByText(/不延长选区或片段/)).toBeInTheDocument();
    expect(screen.getByText(/延迟不短于选区时不会产生回声/)).toBeInTheDocument();
  });

  it('submits edited delay and decay to the real parent command', async () => {
    const { onApply } = renderDialog();
    fireEvent.change(screen.getByLabelText('延迟时间（秒）'), { target: { value: '0.5' } });
    fireEvent.change(screen.getByLabelText('衰减因子'), { target: { value: '1.25' } });
    fireEvent.click(screen.getByRole('button', { name: '应用回声' }));
    await waitFor(() => expect(onApply).toHaveBeenCalledWith(0.5, 1.25));
    expect(mockStopPreview).toHaveBeenCalled();
  });

  it('previews real parent PCM without applying or writing project state', async () => {
    const { onPreview, onApply } = renderDialog();
    mockStartPreview.mockImplementation(async (createSamples: () => Promise<Float32Array[]>) => {
      const samples = await createSamples();
      expect(samples).toHaveLength(2);
    });
    fireEvent.click(screen.getByRole('button', { name: '试听' }));
    await waitFor(() => expect(onPreview).toHaveBeenCalledWith(1, 0.5));
    expect(mockStartPreview.mock.calls[0][1]).toBe(10);
    expect(onApply).not.toHaveBeenCalled();
  });

  it('allows a decay factor above one', async () => {
    const { onApply } = renderDialog();
    fireEvent.change(screen.getByLabelText('衰减因子'), { target: { value: '2' } });
    expect(screen.getByRole('button', { name: '应用回声' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '应用回声' }));
    await waitFor(() => expect(onApply).toHaveBeenCalledWith(1, 2));
  });

  it('blocks invalid delay and negative decay before DSP or application', () => {
    const { onApply, onPreview } = renderDialog();
    fireEvent.change(screen.getByLabelText('延迟时间（秒）'), { target: { value: '0' } });
    expect(screen.getByRole('alert')).toHaveTextContent('延迟时间须不小于 0.001 秒');
    expect(screen.getByRole('button', { name: '应用回声' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '试听' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('延迟时间（秒）'), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText('衰减因子'), { target: { value: '-0.1' } });
    expect(screen.getByRole('alert')).toHaveTextContent('衰减因子须为不小于零的有限数值');
    expect(onApply).not.toHaveBeenCalled();
    expect(onPreview).not.toHaveBeenCalled();
  });

  it('reports the browser memory guard instead of allocating an excessive delay', () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText('延迟时间（秒）'), { target: { value: '600000' } });
    expect(screen.getByRole('alert')).toHaveTextContent('浏览器内存上限');
    expect(screen.getByRole('button', { name: '应用回声' })).toBeDisabled();
  });

  it('disables parameter changes and both actions while applying', () => {
    renderDialog({ isApplying: true });
    expect(screen.getByLabelText('延迟时间（秒）')).toBeDisabled();
    expect(screen.getByLabelText('衰减因子')).toBeDisabled();
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
