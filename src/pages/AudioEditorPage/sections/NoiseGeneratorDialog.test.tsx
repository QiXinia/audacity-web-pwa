// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import NoiseGeneratorDialog from '@/pages/AudioEditorPage/sections/NoiseGeneratorDialog';

afterEach(cleanup);

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
});
