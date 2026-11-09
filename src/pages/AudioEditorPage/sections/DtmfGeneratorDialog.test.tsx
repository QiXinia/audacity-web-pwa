// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import DtmfGeneratorDialog from '@/pages/AudioEditorPage/sections/DtmfGeneratorDialog';

afterEach(cleanup);

function renderDialog(overrides: Partial<Parameters<typeof DtmfGeneratorDialog>[0]> = {}) {
  const onGenerate = vi.fn();
  render(
    <DtmfGeneratorDialog
      open
      onOpenChange={vi.fn()}
      sampleRate={1000}
      cursorPosition={0}
      defaultDuration={1}
      isGenerating={false}
      onGenerate={onGenerate}
      {...overrides}
    />,
  );
  return { onGenerate };
}

describe('DtmfGeneratorDialog', () => {
  it('shows the official defaults and recalculates tone/silence durations', () => {
    renderDialog();
    expect((screen.getByLabelText('DTMF 序列') as HTMLInputElement).value).toBe('audacity');
    expect((screen.getByLabelText('振幅 (0–1)') as HTMLInputElement).value).toBe('0.8');
    expect((screen.getByLabelText('占空比 (%)') as HTMLInputElement).value).toBe('55');
    expect((screen.getByLabelText('时长（秒）') as HTMLInputElement).value).toBe('1');
    expect(screen.getByText(/默认 1 秒并记住上次时长/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText('DTMF 序列'), { target: { value: '12' } });
    fireEvent.change(screen.getByLabelText('占空比 (%)'), { target: { value: '50' } });
    fireEvent.change(screen.getByLabelText('时长（秒）'), { target: { value: '1' } });
    expect(screen.getByTestId('dtmf-tone-duration').textContent).toBe('333 ms');
    expect(screen.getByTestId('dtmf-silence-duration').textContent).toBe('333 ms');
  });

  it('submits the full sequence, amplitude, duty cycle, and duration', () => {
    const { onGenerate } = renderDialog();
    fireEvent.change(screen.getByLabelText('DTMF 序列'), { target: { value: '1A*z' } });
    fireEvent.change(screen.getByLabelText('振幅 (0–1)'), { target: { value: '0.5' } });
    fireEvent.change(screen.getByLabelText('占空比 (%)'), { target: { value: '60' } });
    fireEvent.change(screen.getByLabelText('时长（秒）'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: '生成 DTMF' }));
    expect(onGenerate).toHaveBeenCalledWith({ sequence: '1A*z', amplitude: 0.5, dutyCycle: 60, duration: 2 });
  });

  it.each(['', 'E', '1 2', '1,2'])('disables generation and preview for invalid sequence %s', (sequence) => {
    renderDialog();
    fireEvent.change(screen.getByLabelText('DTMF 序列'), { target: { value: sequence } });
    expect(screen.getByRole('button', { name: '生成 DTMF' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '试听' })).toBeDisabled();
  });

  it('restores its own duration and locks a sample-quantized selection', () => {
    renderDialog({ defaultDuration: 0.2, selectionActive: true, replacementPosition: 0.1, replacementEnd: 0.3 });
    const duration = screen.getByLabelText('时长（秒）') as HTMLInputElement;
    expect(duration.value).toBe('0.2');
    expect(duration.readOnly).toBe(true);
    expect(screen.getByText(/替换选区 00:00.100–00:00.300/)).toBeTruthy();
  });
});
