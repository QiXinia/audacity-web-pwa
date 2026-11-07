// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import NoiseGeneratorDialog from '@/pages/AudioEditorPage/sections/NoiseGeneratorDialog';
import { GeneratorPreviewPlayer } from '@/lib/generatorPreview';
import { generateNoise } from '@/lib/noiseGenerator';

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderDialog(overrides: Partial<Parameters<typeof NoiseGeneratorDialog>[0]> = {}) {
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
  return { ...render(<NoiseGeneratorDialog {...props} />), props };
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
  const createObjectURL = vi.fn((_blob: Blob) => 'blob:noise-preset');
  const revokeObjectURL = vi.fn();
  class MockURL extends URL {
    static createObjectURL = createObjectURL;
    static revokeObjectURL = revokeObjectURL;
  }
  vi.stubGlobal('URL', MockURL);
  return { createObjectURL, revokeObjectURL };
}

describe('NoiseGeneratorDialog', () => {
  it('submits Audacity white-noise parameters to the editor command', () => {
    const view = renderDialog();
    fireEvent.change(view.getByLabelText('振幅 (0–1)'), { target: { value: '0.25' } });
    fireEvent.change(view.getByLabelText('时长（秒）'), { target: { value: '1.5' } });
    fireEvent.click(view.getByRole('button', { name: '生成噪声' }));

    expect(view.props.onGenerate).toHaveBeenCalledWith({
      type: 'white',
      amplitude: 0.25,
      duration: 1.5,
    });
  });

  it('locks a sample-quantized selection duration without floating-point noise', async () => {
    const view = renderDialog({
      defaultDuration: 0.30000000000000004,
      selectionActive: true,
      replacementPosition: 0.1,
    });
    const input = view.getByLabelText('时长（秒）') as HTMLInputElement;
    await waitFor(() => expect(input.value).toBe('0.3'));
    expect(input.readOnly).toBe(true);
    expect(view.getByText(/时长已锁定到音频采样/)).toBeInTheDocument();

    view.rerender(<NoiseGeneratorDialog {...view.props} open={false} defaultDuration={1} />);
    view.rerender(<NoiseGeneratorDialog {...view.props} open defaultDuration={1} />);
    await waitFor(() => expect((view.getByLabelText('时长（秒）') as HTMLInputElement).value).toBe('1'));
  });

  it('restores a remembered cursor duration independently of selection replacements', async () => {
    const view = renderDialog({ defaultDuration: 4.75, selectionActive: false });
    const input = view.getByLabelText('时长（秒）') as HTMLInputElement;
    await waitFor(() => expect(input.value).toBe('4.75'));
    expect(input.readOnly).toBe(false);
    expect(view.getByText(/默认 30 秒并记住上次时长/)).toBeInTheDocument();
  });

  it('prevents duplicate submissions while the audio clip is being stored', () => {
    const view = renderDialog({ isGenerating: true });
    expect((view.getByRole('button', { name: '正在生成…' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('previews deterministic noise without submitting and stops when cancelled', async () => {
    const play = vi.spyOn(GeneratorPreviewPlayer.prototype, 'play').mockResolvedValue(undefined);
    const stop = vi.spyOn(GeneratorPreviewPlayer.prototype, 'stop');
    const view = renderDialog({ sampleRate: 100 });
    fireEvent.change(view.getByLabelText('振幅 (0–1)'), { target: { value: '0.25' } });
    fireEvent.change(view.getByLabelText('时长（秒）'), { target: { value: '0.03' } });

    fireEvent.click(view.getByRole('button', { name: '试听' }));
    await waitFor(() => expect(play).toHaveBeenCalledOnce());
    const [samples, sampleRate] = play.mock.calls[0];
    expect(sampleRate).toBe(100);
    expect(Array.from(samples)).toEqual(Array.from(generateNoise({
      type: 'white', amplitude: 0.25, duration: 0.03, sampleRate: 100,
    })));
    expect(view.props.onGenerate).not.toHaveBeenCalled();

    fireEvent.click(view.getByRole('button', { name: '取消' }));
    expect(stop).toHaveBeenCalled();
    expect(view.props.onOpenChange).toHaveBeenCalledWith(false);
  });

  it('keeps the locked duration when applying and deleting noise presets', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const view = renderDialog({ defaultDuration: 0.5, selectionActive: true });
    const duration = view.getByLabelText('时长（秒）') as HTMLInputElement;
    await waitFor(() => expect(duration.value).toBe('0.5'));
    fireEvent.change(view.getByLabelText('振幅 (0–1)'), { target: { value: '0.2' } });
    fireEvent.click(view.getByRole('button', { name: '保存预设' }));
    fireEvent.change(view.getByLabelText('预设名称'), { target: { value: 'Quiet noise' } });
    fireEvent.click(view.getByRole('button', { name: '确认保存' }));

    fireEvent.change(view.getByLabelText('噪声预设'), { target: { value: 'factory' } });
    expect(view.getByLabelText('振幅 (0–1)')).toHaveValue(0.8);
    expect(duration).toHaveValue(0.5);
    expect(duration.readOnly).toBe(true);

    const customId = Array.from((view.getByLabelText('噪声预设') as HTMLSelectElement).options)
      .find((option) => option.text === 'Quiet noise')?.value;
    expect(customId).toBeTruthy();
    fireEvent.change(view.getByLabelText('噪声预设'), { target: { value: customId } });
    fireEvent.click(view.getByRole('button', { name: '删除' }));
    expect(view.getByLabelText('噪声预设')).toHaveDisplayValue('Audacity 默认');
    expect(view.getByLabelText('振幅 (0–1)')).toHaveValue(0.8);
    expect(duration).toHaveValue(0.5);
  });

  it('imports and exports official Noise text through the preset options menu', async () => {
    const view = renderDialog({ defaultDuration: 0.5, selectionActive: true });
    const duration = view.getByLabelText('时长（秒）') as HTMLInputElement;
    await waitFor(() => expect(duration.value).toBe('0.5'));
    const input = view.getByLabelText('噪声预设文件') as HTMLInputElement;
    const inputClick = vi.spyOn(input, 'click');

    await openPresetMenu(view);
    fireEvent.click(view.getByRole('menuitem', { name: '导入预设…' }));
    expect(inputClick).toHaveBeenCalledOnce();
    fireEvent.change(input, {
      target: {
        files: [new File(['Noise:Type="Brownian" Amplitude="0.15"'], 'official-noise.txt')],
      },
    });

    await waitFor(() => expect(view.getByLabelText('振幅 (0–1)')).toHaveValue(0.15));
    expect(view.getByLabelText('噪声类型')).toHaveTextContent('布朗噪声 (Brownian)');
    expect(duration).toHaveValue(0.5);
    expect(view.getByRole('status')).toHaveTextContent('official-noise.txt');
    expect((view.getByLabelText('噪声预设') as HTMLSelectElement).options).toHaveLength(1);

    const { createObjectURL } = stubObjectUrls();
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await openPresetMenu(view);
    fireEvent.click(view.getByRole('menuitem', { name: '导出预设' }));
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledOnce());
    expect(anchorClick).toHaveBeenCalledOnce();
    const blob = createObjectURL.mock.calls[0][0] as Blob;
    await expect(blob.text()).resolves.toBe('Noise:Amplitude="0.15" Type="Brownian"');
    expect(view.getByRole('status')).toHaveTextContent('时长不包含在文件中');
  });

  it('rejects cross-effect and malformed files without changing current parameters', async () => {
    const view = renderDialog();
    fireEvent.change(view.getByLabelText('振幅 (0–1)'), { target: { value: '0.3' } });
    const input = view.getByLabelText('噪声预设文件');
    fireEvent.change(input, {
      target: {
        files: [new File([
          'Tone:Amplitude="0.4" Frequency="440" Interpolation="Linear" Waveform="Sine"',
        ], 'tone.txt')],
      },
    });
    await waitFor(() => expect(view.getByRole('alert')).toHaveTextContent('其他效果'));
    expect(view.getByLabelText('振幅 (0–1)')).toHaveValue(0.3);

    fireEvent.change(input, {
      target: { files: [new File(['Noise:Amplitude="0.8" Type="Blue"'], 'bad-noise.txt')] },
    });
    await waitFor(() => expect(view.getByRole('alert')).toHaveTextContent('未知噪声类型'));
    expect(view.getByLabelText('振幅 (0–1)')).toHaveValue(0.3);
    expect(view.getByLabelText('噪声类型')).toHaveTextContent('白噪声 (White)');
  });
});
