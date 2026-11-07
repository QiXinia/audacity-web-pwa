// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import SilenceGeneratorDialog from '@/pages/AudioEditorPage/sections/SilenceGeneratorDialog';

afterEach(cleanup);

function renderDialog(overrides: Partial<Parameters<typeof SilenceGeneratorDialog>[0]> = {}) {
  const props = {
    open: true,
    onOpenChange: vi.fn(),
    sampleRate: 44100,
    cursorPosition: 1.25,
    defaultDuration: 30,
    selectionActive: false,
    isGenerating: false,
    onGenerate: vi.fn(),
    ...overrides,
  };
  return { ...render(<SilenceGeneratorDialog {...props} />), props };
}

describe('SilenceGeneratorDialog', () => {
  it('uses Audacity’s 30-second cursor default and submits an edited duration', async () => {
    const view = renderDialog();
    const input = view.getByLabelText('时长（秒）') as HTMLInputElement;
    await waitFor(() => expect(input.value).toBe('30'));
    expect(input.readOnly).toBe(false);

    fireEvent.change(input, { target: { value: '2.5' } });
    fireEvent.click(view.getByRole('button', { name: '生成静默' }));
    expect(view.props.onGenerate).toHaveBeenCalledWith(2.5);
  });

  it('locks replacement duration to the exact current selection', async () => {
    const view = renderDialog({ defaultDuration: 2.25, selectionActive: true });
    const input = view.getByLabelText('时长（秒）') as HTMLInputElement;
    await waitFor(() => expect(input.value).toBe('2.25'));
    expect(input.readOnly).toBe(true);
    expect(view.getByText(/不改变片段边界/)).toBeInTheDocument();

    view.rerender(<SilenceGeneratorDialog {...view.props} open={false} defaultDuration={1} />);
    view.rerender(<SilenceGeneratorDialog {...view.props} open defaultDuration={1} />);
    await waitFor(() => expect((view.getByLabelText('时长（秒）') as HTMLInputElement).value).toBe('1'));
  });

  it('prevents duplicate submissions while audio is being stored', () => {
    const view = renderDialog({ isGenerating: true });
    expect((view.getByRole('button', { name: '正在生成…' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
