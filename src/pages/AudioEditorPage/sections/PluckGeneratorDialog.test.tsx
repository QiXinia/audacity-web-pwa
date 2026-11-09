import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PluckGeneratorDialog from './PluckGeneratorDialog';

const mockGeneratePluck = vi.hoisted(() => vi.fn(() => new Float32Array([0, 0.8, -0.8, 0])));
const mockStartPreview = vi.hoisted(() => vi.fn());
const mockStopPreview = vi.hoisted(() => vi.fn());
const previewState = vi.hoisted(() => ({ isPreviewing: false, previewError: null as string | null }));

vi.mock('@/lib/pluckGenerator', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/pluckGenerator')>()),
  generatePluck: mockGeneratePluck,
}));
vi.mock('./useGeneratorPreview', () => ({
  useGeneratorPreview: () => ({
    isPreviewing: previewState.isPreviewing,
    previewError: previewState.previewError,
    startPreview: mockStartPreview,
    stopPreview: mockStopPreview,
  }),
}));

function renderDialog(overrides: Partial<Parameters<typeof PluckGeneratorDialog>[0]> = {}) {
  const onGenerate = vi.fn().mockResolvedValue(undefined);
  const onOpenChange = vi.fn();
  render(
    <PluckGeneratorDialog
      open
      onOpenChange={onOpenChange}
      sampleRate={1000}
      cursorPosition={0}
      defaultDuration={1}
      isGenerating={false}
      onGenerate={onGenerate}
      {...overrides}
    />,
  );
  return { onGenerate, onOpenChange };
}

describe('PluckGeneratorDialog', () => {
  beforeEach(() => {
    mockGeneratePluck.mockClear();
    mockStartPreview.mockReset();
    mockStopPreview.mockClear();
    previewState.isPreviewing = false;
    previewState.previewError = null;
  });

  it('opens with the official MIDI 60, abrupt fade, and one-second defaults', () => {
    renderDialog();
    expect(screen.getByLabelText('MIDI 音高')).toHaveValue(60);
    expect(screen.getByLabelText('淡出类型')).toHaveValue('abrupt');
    expect(screen.getByLabelText('时长（秒）')).toHaveValue(1);
    expect(screen.getByText(/C4 · 261.63 Hz/)).toBeInTheDocument();
    expect(screen.getByText(/默认 1 秒并独立记住上次时长/)).toBeInTheDocument();
  });

  it('submits the current pitch, fade, and duration to the page generator', async () => {
    const { onGenerate } = renderDialog();
    fireEvent.change(screen.getByLabelText('MIDI 音高'), { target: { value: '61' } });
    fireEvent.change(screen.getByLabelText('淡出类型'), { target: { value: 'gradual' } });
    fireEvent.change(screen.getByLabelText('时长（秒）'), { target: { value: '0.25' } });
    fireEvent.click(screen.getByRole('button', { name: '生成 Pluck' }));

    await waitFor(() => expect(onGenerate).toHaveBeenCalledWith({
      midi: 61, fade: 'gradual', duration: 0.25, sampleRate: 1000,
    }));
    expect(mockStopPreview).toHaveBeenCalled();
  });

  it('keeps Nyquist duration editable for a selection and reports tail movement', async () => {
    const { onGenerate } = renderDialog({
      selectionActive: true,
      replacementPosition: 0.25,
      replacementEnd: 2,
      defaultDuration: 2,
    });
    const duration = screen.getByLabelText('时长（秒）');
    expect(duration).toHaveValue(2);
    expect(duration).not.toHaveAttribute('readonly');
    expect(screen.getByText(/按指定时长替换并平移后续片段/)).toBeInTheDocument();
    fireEvent.change(duration, { target: { value: '1.5' } });
    fireEvent.click(screen.getByRole('button', { name: '生成 Pluck' }));
    await waitFor(() => expect(onGenerate).toHaveBeenCalledWith(expect.objectContaining({ duration: 1.5 })));
  });

  it('previews through the same settings without committing audio', async () => {
    const { onGenerate } = renderDialog();
    mockStartPreview.mockImplementation(async (createSamples: () => Float32Array) => {
      createSamples();
    });
    fireEvent.click(screen.getByRole('button', { name: '试听' }));
    await waitFor(() => expect(mockStartPreview).toHaveBeenCalledTimes(1));
    expect(mockGeneratePluck).toHaveBeenCalledWith({
      midi: 60, fade: 'abrupt', duration: 1, sampleRate: 1000,
    });
    expect(mockStartPreview.mock.calls[0][1]).toBe(1000);
    expect(onGenerate).not.toHaveBeenCalled();
  });

  it('blocks frequencies unsupported by the current sample rate', () => {
    const { onGenerate } = renderDialog();
    fireEvent.change(screen.getByLabelText('MIDI 音高'), { target: { value: '69' } });
    expect(screen.getByRole('alert')).toHaveTextContent('当前采样率不支持该音高');
    expect(screen.getByRole('button', { name: '生成 Pluck' })).toBeDisabled();
    expect(onGenerate).not.toHaveBeenCalled();
  });

  it('blocks out-of-range durations before generation', () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText('时长（秒）'), { target: { value: '61' } });
    expect(screen.getByRole('alert')).toHaveTextContent('时长须为 0.001–60 秒');
    expect(screen.getByRole('button', { name: '生成 Pluck' })).toBeDisabled();
    expect(mockGeneratePluck).not.toHaveBeenCalled();
  });
});
