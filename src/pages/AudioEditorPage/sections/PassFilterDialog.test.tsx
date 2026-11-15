import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PassFilterSettings } from '@/lib/passFilterEffect';

const mocks = vi.hoisted(() => ({
  startPreview: vi.fn(),
  stopPreview: vi.fn(),
}));

vi.mock('./useGeneratorPreview', () => ({
  useGeneratorPreview: () => ({
    isPreviewing: false,
    previewError: null,
    startPreview: mocks.startPreview,
    stopPreview: mocks.stopPreview,
  }),
}));

import PassFilterDialog from './PassFilterDialog';

function renderDialog(kind: 'highpass' | 'lowpass' = 'highpass') {
  const onOpenChange = vi.fn();
  const onPreview = vi.fn(async (_settings: PassFilterSettings) => [new Float32Array(8)]);
  const onApply = vi.fn(async (_settings: PassFilterSettings) => undefined);
  const view = render(
    <PassFilterDialog
      kind={kind}
      open
      onOpenChange={onOpenChange}
      sampleRate={48000}
      selectionStart={1}
      selectionEnd={2.5}
      isApplying={false}
      onPreview={onPreview}
      onApply={onApply}
    />,
  );
  return { onOpenChange, onPreview, onApply, ...view };
}

describe('PassFilterDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
  });

  it.each([
    { kind: 'highpass' as const, title: 'High-pass filter' },
    { kind: 'lowpass' as const, title: 'Low-pass filter' },
  ])('renders the official $title controls and defaults', async ({ kind, title }) => {
    renderDialog(kind);
    expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
    expect(screen.getByLabelText('Frequency (Hz)')).toHaveValue(1000);
    const rolloffSelect = screen.getByLabelText('Roll-off (dB per octave)');
    expect(rolloffSelect).toHaveTextContent('6 dB');
    fireEvent.click(rolloffSelect);
    for (const rolloff of [6, 12, 24, 36, 48]) {
      expect(await screen.findByRole('option', { name: `${rolloff} dB` })).toBeInTheDocument();
    }
  });

  it('previews and applies the selected frequency and 48 dB rolloff without changing them', async () => {
    const { onPreview, onApply } = renderDialog('highpass');
    fireEvent.change(screen.getByLabelText('Frequency (Hz)'), { target: { value: '250.5' } });
    fireEvent.click(screen.getByLabelText('Roll-off (dB per octave)'));
    fireEvent.click(await screen.findByRole('option', { name: '48 dB' }));
    fireEvent.click(screen.getByRole('button', { name: '试听' }));
    await waitFor(() => expect(mocks.startPreview).toHaveBeenCalledTimes(1));
    const [createSamples, sampleRate] = mocks.startPreview.mock.calls[0];
    expect(sampleRate).toBe(48000);
    await createSamples();
    expect(onPreview).toHaveBeenCalledWith({ kind: 'highpass', frequencyHz: 250.5, rolloff: 48 });

    fireEvent.click(screen.getByRole('button', { name: '应用' }));
    await waitFor(() => expect(onApply).toHaveBeenCalledWith({ kind: 'highpass', frequencyHz: 250.5, rolloff: 48 }));
    expect(mocks.stopPreview).toHaveBeenCalled();
  });

  it.each(['0.05', '24000', 'not-a-number'])('rejects invalid frequency %s and disables actions', (value) => {
    renderDialog('lowpass');
    fireEvent.change(screen.getByLabelText('Frequency (Hz)'), { target: { value } });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '试听' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '应用' })).toBeDisabled();
  });

  it('stops preview and closes through cancel', () => {
    const { onOpenChange } = renderDialog();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(mocks.stopPreview).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
