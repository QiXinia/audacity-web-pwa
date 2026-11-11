import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CompressorDialog from './CompressorDialog';
import { DEFAULT_COMPRESSOR_SETTINGS } from '@/lib/compressorEffect';

const previewChannels = [new Float32Array([0, 0.25, -0.25])];

function renderDialog(overrides: Partial<React.ComponentProps<typeof CompressorDialog>> = {}) {
  const props: React.ComponentProps<typeof CompressorDialog> = {
    open: true,
    onOpenChange: vi.fn(),
    sampleRate: 44100,
    selectionStart: 0,
    selectionEnd: 1,
    hasSelection: true,
    isApplying: false,
    onPreview: vi.fn().mockResolvedValue(previewChannels),
    onApply: vi.fn(),
    ...overrides,
  };
  return { ...render(<CompressorDialog {...props} />), props };
}

describe('CompressorDialog', () => {
  it('exposes all seven Audacity parameters, defaults and a live compression curve', () => {
    renderDialog();
    expect(screen.getByRole('heading', { name: 'Compressor 压缩器' })).toBeInTheDocument();
    expect(screen.getByLabelText('阈值（dB）')).toHaveValue(-12);
    expect(screen.getByLabelText('补偿增益（dB）')).toHaveValue(9);
    expect(screen.getByLabelText('拐点宽度（dB）')).toHaveValue(6);
    expect(screen.getByLabelText('压缩比（:1）')).toHaveValue(4);
    expect(screen.getByLabelText('Look-ahead（ms）')).toHaveValue(3);
    expect(screen.getByLabelText('Attack（ms）')).toHaveValue(3);
    expect(screen.getByLabelText('Release（ms）')).toHaveValue(100);
    expect(screen.getByRole('img', { name: '压缩传递曲线' })).toBeInTheDocument();
    expect(screen.getByText(/最大压缩：9.00 dB/)).toBeInTheDocument();
  });

  it('previews the latest edited dynamics settings', async () => {
    const { props } = renderDialog();
    fireEvent.change(screen.getByLabelText('Attack（ms）'), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText('Release（ms）'), { target: { value: '50' } });
    fireEvent.change(screen.getByLabelText('Look-ahead（ms）'), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText('压缩比（:1）'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: '试听' }));
    await waitFor(() => expect(props.onPreview).toHaveBeenCalledWith({
      ...DEFAULT_COMPRESSOR_SETTINGS,
      attackMs: 0,
      releaseMs: 50,
      lookaheadMs: 0,
      compressionRatio: 2,
    }));
  });

  it('restores the official default set', () => {
    renderDialog();
    for (const label of ['阈值（dB）', '补偿增益（dB）', '拐点宽度（dB）', '压缩比（:1）', 'Look-ahead（ms）', 'Attack（ms）', 'Release（ms）']) {
      fireEvent.change(screen.getByLabelText(label), { target: { value: '1' } });
    }
    fireEvent.click(screen.getByRole('button', { name: '恢复 Audacity 默认值' }));
    expect(screen.getByLabelText('阈值（dB）')).toHaveValue(-12);
    expect(screen.getByLabelText('补偿增益（dB）')).toHaveValue(9);
    expect(screen.getByLabelText('拐点宽度（dB）')).toHaveValue(6);
    expect(screen.getByLabelText('压缩比（:1）')).toHaveValue(4);
    expect(screen.getByLabelText('Look-ahead（ms）')).toHaveValue(3);
    expect(screen.getByLabelText('Attack（ms）')).toHaveValue(3);
    expect(screen.getByLabelText('Release（ms）')).toHaveValue(100);
  });

  it('blocks invalid and incomplete parameters', () => {
    const { props } = renderDialog();
    fireEvent.change(screen.getByLabelText('Release（ms）'), { target: { value: '' } });
    expect(screen.getByRole('button', { name: '应用' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('请填写全部 Compressor 参数');
    fireEvent.change(screen.getByLabelText('Release（ms）'), { target: { value: '1001' } });
    expect(screen.getByRole('alert')).toHaveTextContent('Release必须在 0–1000 之间');
    expect(props.onApply).not.toHaveBeenCalled();
  });

  it('disables preview and apply without a selection and forwards valid settings', () => {
    const disabled = renderDialog({ hasSelection: false });
    expect(disabled.props.onPreview).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '试听' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '应用' })).toBeDisabled();
    disabled.unmount();

    const enabled = renderDialog();
    fireEvent.click(screen.getByRole('button', { name: '应用' }));
    expect(enabled.props.onApply).toHaveBeenCalledWith({ ...DEFAULT_COMPRESSOR_SETTINGS });
  });
});
