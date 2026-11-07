// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import ToneGeneratorDialog from '@/pages/AudioEditorPage/sections/ToneGeneratorDialog';
import { GeneratorPreviewPlayer } from '@/lib/generatorPreview';
import { generateTone } from '@/lib/toneGenerator';

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
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

async function openPresetMenu(view: ReturnType<typeof renderDialog>) {
  fireEvent.pointerDown(view.getByRole('button', { name: '预设选项' }), {
    button: 0,
    ctrlKey: false,
    pointerType: 'mouse',
  });
  await view.findByRole('menu');
}

function stubObjectUrls() {
  const createObjectURL = vi.fn((_blob: Blob) => 'blob:tone-preset');
  const revokeObjectURL = vi.fn();
  class MockURL extends URL {
    static createObjectURL = createObjectURL;
    static revokeObjectURL = revokeObjectURL;
  }
  vi.stubGlobal('URL', MockURL);
  return { createObjectURL, revokeObjectURL };
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

  it('saves, resets and restores the last-used tone preset across remounts', () => {
    const view = renderDialog();
    fireEvent.change(view.getByLabelText('频率 (Hz)'), { target: { value: '880' } });
    fireEvent.change(view.getByLabelText('振幅 (0–1)'), { target: { value: '0.33' } });
    fireEvent.click(view.getByRole('button', { name: '保存预设' }));
    fireEvent.change(view.getByLabelText('预设名称'), { target: { value: 'Lead tone' } });
    fireEvent.click(view.getByRole('button', { name: '确认保存' }));

    fireEvent.change(view.getByLabelText('频率 (Hz)'), { target: { value: '100' } });
    expect(view.getByText(/当前参数有未保存修改/)).toBeInTheDocument();
    fireEvent.click(view.getByRole('button', { name: '重置' }));
    expect(view.getByLabelText('频率 (Hz)')).toHaveValue(880);
    expect(view.getByLabelText('振幅 (0–1)')).toHaveValue(0.33);

    view.unmount();
    const restored = renderDialog();
    expect(restored.getByLabelText('频率 (Hz)')).toHaveValue(880);
    expect(restored.getByLabelText('振幅 (0–1)')).toHaveValue(0.33);
    expect(restored.getByLabelText('音调预设')).toHaveDisplayValue('Lead tone');
  });

  it('applies presets without changing a selection-locked duration', async () => {
    const view = renderDialog({ defaultDuration: 0.5, selectionActive: true });
    const duration = view.getByLabelText('时长（秒）') as HTMLInputElement;
    await waitFor(() => expect(duration.value).toBe('0.5'));
    fireEvent.change(view.getByLabelText('频率 (Hz)'), { target: { value: '880' } });
    fireEvent.click(view.getByRole('button', { name: '保存预设' }));
    fireEvent.change(view.getByLabelText('预设名称'), { target: { value: 'Selection safe' } });
    fireEvent.click(view.getByRole('button', { name: '确认保存' }));

    fireEvent.change(view.getByLabelText('音调预设'), { target: { value: 'factory' } });
    expect(view.getByLabelText('频率 (Hz)')).toHaveValue(440);
    expect(duration).toHaveValue(0.5);
    expect(duration.readOnly).toBe(true);
  });

  it('imports and exports official Tone text through the preset options menu', async () => {
    const view = renderDialog({ defaultDuration: 0.5, selectionActive: true });
    const duration = view.getByLabelText('时长（秒）') as HTMLInputElement;
    await waitFor(() => expect(duration.value).toBe('0.5'));
    const input = view.getByLabelText('音调预设文件') as HTMLInputElement;
    const inputClick = vi.spyOn(input, 'click');

    await openPresetMenu(view);
    fireEvent.click(view.getByRole('menuitem', { name: '导入预设…' }));
    expect(inputClick).toHaveBeenCalledOnce();
    fireEvent.change(input, {
      target: {
        files: [new File([
          'Tone:Amplitude="0.25" Frequency="880" Interpolation="Linear" Waveform="Square, no alias"',
        ], 'official-tone.txt', { type: 'text/plain' })],
      },
    });

    await waitFor(() => expect(view.getByLabelText('频率 (Hz)')).toHaveValue(880));
    expect(view.getByLabelText('振幅 (0–1)')).toHaveValue(0.25);
    expect(view.getByLabelText('音调波形')).toHaveTextContent('无混叠方波 (Square, no alias)');
    expect(duration).toHaveValue(0.5);
    expect(view.getByRole('status')).toHaveTextContent('official-tone.txt');
    expect((view.getByLabelText('音调预设') as HTMLSelectElement).options).toHaveLength(1);

    const { createObjectURL } = stubObjectUrls();
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await openPresetMenu(view);
    fireEvent.click(view.getByRole('menuitem', { name: '导出预设' }));
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledOnce());
    expect(anchorClick).toHaveBeenCalledOnce();
    const blob = createObjectURL.mock.calls[0][0] as Blob;
    await expect(blob.text()).resolves.toBe(
      'Tone:Amplitude="0.25" Frequency="880" Interpolation="Linear" Waveform="Square, no alias"',
    );
    expect(view.getByRole('status')).toHaveTextContent('时长不包含在文件中');
  });

  it('rejects cross-effect and over-Nyquist files without changing current parameters', async () => {
    const view = renderDialog({ sampleRate: 44100 });
    fireEvent.change(view.getByLabelText('频率 (Hz)'), { target: { value: '220' } });
    const input = view.getByLabelText('音调预设文件');
    fireEvent.change(input, {
      target: { files: [new File(['Noise:Amplitude="0.1" Type="Pink"'], 'noise.txt')] },
    });
    await waitFor(() => expect(view.getByRole('alert')).toHaveTextContent('其他效果'));
    expect(view.getByLabelText('频率 (Hz)')).toHaveValue(220);
    expect(view.getByLabelText('振幅 (0–1)')).toHaveValue(0.8);

    fireEvent.change(input, {
      target: {
        files: [new File([
          'Tone:Amplitude="0.4" Frequency="23000" Interpolation="Linear" Waveform="Triangle"',
        ], 'too-high.txt')],
      },
    });
    await waitFor(() => expect(view.getByRole('alert')).toHaveTextContent('奈奎斯特'));
    expect(view.getByLabelText('频率 (Hz)')).toHaveValue(220);
    expect(view.getByLabelText('振幅 (0–1)')).toHaveValue(0.8);
  });
});
