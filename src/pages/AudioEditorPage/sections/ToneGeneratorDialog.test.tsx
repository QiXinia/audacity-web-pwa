// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import ToneGeneratorDialog from '@/pages/AudioEditorPage/sections/ToneGeneratorDialog';
import { GeneratorPreviewPlayer } from '@/lib/generatorPreview';
import { generateTone } from '@/lib/toneGenerator';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderDialog(overrides: Partial<Parameters<typeof ToneGeneratorDialog>[0]> = {}) {
  const props = {
    open: true,
    onOpenChange: vi.fn(),
    sampleRate: 44100,
    cursorPosition: 1.25,
    defaultDuration: 30,
    isGenerating: false,
    onGenerate: vi.fn(),
    ...overrides,
  };
  return { ...render(<ToneGeneratorDialog {...props} />), props };
}

describe('ToneGeneratorDialog', () => {
  it('submits Audacity tone parameters to the editor command', () => {
    const view = renderDialog();
    fireEvent.change(view.getByLabelText('频率 (Hz)'), { target: { value: '220' } });
    fireEvent.change(view.getByLabelText('振幅 (0–1)'), { target: { value: '0.25' } });
    fireEvent.change(view.getByLabelText('时长（秒）'), { target: { value: '1.5' } });
    fireEvent.click(view.getByRole('button', { name: '生成音调' }));

    expect(view.props.onGenerate).toHaveBeenCalledWith({
      waveform: 'sine',
      frequency: 220,
      amplitude: 0.25,
      duration: 1.5,
    });
  });

  it('locks a sample-quantized selection duration and preserves both endpoints', async () => {
    const view = renderDialog({
      defaultDuration: 0.30000000000000004,
      selectionActive: true,
      replacementPosition: 0.1,
      replacementEnd: 0.4,
    });
    const input = view.getByLabelText('时长（秒）') as HTMLInputElement;
    await waitFor(() => expect(input.value).toBe('0.3'));
    expect(input.readOnly).toBe(true);
    expect(view.getByText(/替换选区 00:00\.100–00:00\.400/)).toBeInTheDocument();
    expect(view.getByText(/时长已锁定到音频采样/)).toBeInTheDocument();
  });

  it('restores a remembered cursor duration independently of selection replacements', async () => {
    const view = renderDialog({ defaultDuration: 4.75, selectionActive: false });
    const input = view.getByLabelText('时长（秒）') as HTMLInputElement;
    await waitFor(() => expect(input.value).toBe('4.75'));
    expect(input.readOnly).toBe(false);
    expect(view.getByText(/默认 30 秒并记住上次时长/)).toBeInTheDocument();
  });

  it('reloads the current editor duration whenever the dialog reopens', async () => {
    const view = renderDialog({ defaultDuration: 2 });
    const input = view.getByLabelText('时长（秒）') as HTMLInputElement;
    await waitFor(() => expect(input.value).toBe('2'));

    view.rerender(<ToneGeneratorDialog {...view.props} open={false} defaultDuration={1.25} />);
    view.rerender(<ToneGeneratorDialog {...view.props} open defaultDuration={1.25} />);
    await waitFor(() => expect((view.getByLabelText('时长（秒）') as HTMLInputElement).value).toBe('1.25'));
  });

  it('prevents duplicate submissions while the audio clip is being stored', () => {
    const view = renderDialog({ isGenerating: true });
    expect((view.getByRole('button', { name: '正在生成…' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('previews the exact tone without submitting and cleans up on stop and completion', async () => {
    let finishPreview!: () => void;
    const play = vi.spyOn(GeneratorPreviewPlayer.prototype, 'play')
      .mockImplementation(async (_samples, _sampleRate, onEnded) => { finishPreview = onEnded; });
    const stop = vi.spyOn(GeneratorPreviewPlayer.prototype, 'stop');
    const view = renderDialog({ sampleRate: 100 });
    fireEvent.change(view.getByLabelText('频率 (Hz)'), { target: { value: '10' } });
    fireEvent.change(view.getByLabelText('振幅 (0–1)'), { target: { value: '0.25' } });
    fireEvent.change(view.getByLabelText('时长（秒）'), { target: { value: '0.03' } });

    fireEvent.click(view.getByRole('button', { name: '试听' }));
    await waitFor(() => expect(play).toHaveBeenCalledOnce());
    const [samples, sampleRate] = play.mock.calls[0];
    expect(sampleRate).toBe(100);
    expect(Array.from(samples)).toEqual(Array.from(generateTone({
      waveform: 'sine', frequency: 10, amplitude: 0.25, duration: 0.03, sampleRate: 100,
    })));
    expect(view.props.onGenerate).not.toHaveBeenCalled();
    expect(view.getByRole('button', { name: '停止试听' })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(view.getByRole('button', { name: '停止试听' }));
    expect(stop).toHaveBeenCalled();
    expect(view.getByRole('button', { name: '试听' })).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(view.getByRole('button', { name: '试听' }));
    await waitFor(() => expect(play).toHaveBeenCalledTimes(2));
    act(() => finishPreview());
    expect(view.getByRole('button', { name: '试听' })).toBeInTheDocument();
  });
});
