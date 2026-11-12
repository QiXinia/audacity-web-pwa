import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import LimiterDialog, { type LimiterPreview } from './LimiterDialog';
import { DEFAULT_LIMITER_SETTINGS } from '@/lib/limiterEffect';

const previewResult: LimiterPreview = {
  inputChannels: [new Float32Array([0, 0.25, -0.25])],
  channels: [new Float32Array([0, 0.2, -0.2])],
};

function renderDialog(overrides: Partial<React.ComponentProps<typeof LimiterDialog>> = {}) {
  const props: React.ComponentProps<typeof LimiterDialog> = {
    open: true,
    onOpenChange: vi.fn(),
    sampleRate: 44100,
    selectionStart: 0,
    selectionEnd: 1,
    hasSelection: true,
    isApplying: false,
    onPreview: vi.fn().mockResolvedValue(previewResult),
    onApply: vi.fn(),
    ...overrides,
  };
  return { ...render(<LimiterDialog {...props} />), props };
}

describe('LimiterDialog', () => {
  it('exposes the five Audacity 4.0.2 parameters and dynamics history panel', () => {
    renderDialog();
    expect(screen.getByRole('heading', { name: 'Limiter 限制器' })).toBeInTheDocument();
    expect(screen.getByLabelText('Threshold 阈值（dB）')).toHaveValue(-6);
    expect(screen.getByLabelText('Output 输出目标（dB）')).toHaveValue(-1);
    expect(screen.getByLabelText('Lookahead（ms）')).toHaveValue(1);
    expect(screen.getByLabelText('Knee width 拐点宽度（dB）')).toHaveValue(2);
    expect(screen.getByLabelText('Release（ms）')).toHaveValue(20);
    expect(screen.getByRole('img', { name: 'Limiter 传递曲线' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Limiter 动态历史（2 秒，-12 dB 至 0 dB，3 dB 网格）' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: '输入' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: '输出' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: '压缩' })).toBeChecked();
    expect(screen.getByText(/无 clipping 指示/)).toBeInTheDocument();
  });

  it('previews the latest edited settings and draws actual selection history', async () => {
    const { props } = renderDialog();
    fireEvent.change(screen.getByLabelText('Threshold 阈值（dB）'), { target: { value: '-12' } });
    fireEvent.change(screen.getByLabelText('Output 输出目标（dB）'), { target: { value: '-2' } });
    fireEvent.change(screen.getByLabelText('Lookahead（ms）'), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText('Knee width 拐点宽度（dB）'), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText('Release（ms）'), { target: { value: '50' } });
    fireEvent.click(screen.getByRole('button', { name: '试听' }));
    await waitFor(() => expect(props.onPreview).toHaveBeenCalledWith({
      ...DEFAULT_LIMITER_SETTINGS,
      thresholdDb: -12,
      makeupTargetDb: -2,
      lookaheadMs: 0,
      kneeWidthDb: 0,
      releaseMs: 50,
    }));
    await screen.findByText(/输入、输出与实际压缩来自当前选区试听 PCM/);
    fireEvent.click(screen.getByRole('checkbox', { name: '输入' }));
    expect(screen.getByRole('checkbox', { name: '输入' })).not.toBeChecked();
  });

  it('restores the official default set', () => {
    renderDialog();
    for (const label of ['Threshold 阈值（dB）', 'Output 输出目标（dB）', 'Lookahead（ms）', 'Knee width 拐点宽度（dB）', 'Release（ms）']) {
      fireEvent.change(screen.getByLabelText(label), { target: { value: '1' } });
    }
    fireEvent.click(screen.getByRole('button', { name: '恢复 Audacity 默认值' }));
    expect(screen.getByLabelText('Threshold 阈值（dB）')).toHaveValue(-6);
    expect(screen.getByLabelText('Output 输出目标（dB）')).toHaveValue(-1);
    expect(screen.getByLabelText('Lookahead（ms）')).toHaveValue(1);
    expect(screen.getByLabelText('Knee width 拐点宽度（dB）')).toHaveValue(2);
    expect(screen.getByLabelText('Release（ms）')).toHaveValue(20);
  });

  it('blocks invalid and incomplete parameters', () => {
    const { props } = renderDialog();
    fireEvent.change(screen.getByLabelText('Release（ms）'), { target: { value: '' } });
    expect(screen.getByRole('button', { name: '应用' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('请填写全部 Limiter 参数');
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
    expect(enabled.props.onApply).toHaveBeenCalledWith({ ...DEFAULT_LIMITER_SETTINGS });
  });
});
