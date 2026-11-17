import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LegacyLimiterDialog from './LegacyLimiterDialog';
import { DEFAULT_LEGACY_LIMITER_SETTINGS } from '@/lib/legacyLimiterEffect';

const mocks = vi.hoisted(() => ({
  startPreview: vi.fn(),
  stopPreview: vi.fn(),
}));
vi.mock('./useGeneratorPreview', () => ({
  useGeneratorPreview: () => ({
    isPreviewing: false, previewError: '',
    startPreview: mocks.startPreview, stopPreview: mocks.stopPreview,
  }),
}));

function renderDialog(overrides: Partial<React.ComponentProps<typeof LegacyLimiterDialog>> = {}) {
  const props: React.ComponentProps<typeof LegacyLimiterDialog> = {
    open: true, onOpenChange: vi.fn(), sampleRate: 44100,
    selectionStart: 0.25, selectionEnd: 0.75, hasSelection: true,
    isApplying: false, onPreview: vi.fn(async () => new Float32Array(100)),
    onApply: vi.fn(), ...overrides,
  };
  return { ...render(<LegacyLimiterDialog {...props} />), props };
}

describe('LegacyLimiterDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.startPreview.mockImplementation(async (loader: () => Promise<Float32Array>) => { await loader(); });
  });

  it('shows the official six controls and defaults', () => {
    renderDialog();
    expect(screen.getByRole('heading', { name: 'Legacy limiter 旧版限制器' })).toBeInTheDocument();
    expect(screen.getByLabelText('Type')).toHaveValue('softLimit');
    expect(screen.getByLabelText('Input Gain (dB) mono/Left')).toHaveValue(0);
    expect(screen.getByLabelText('Input Gain (dB) Right channel')).toHaveValue(0);
    expect(screen.getByLabelText('Limit to (dB)')).toHaveValue(-3);
    expect(screen.getByLabelText('Hold (ms)')).toHaveValue(10);
    expect(screen.getByLabelText('Apply Make-up Gain')).toHaveValue('no');
    expect(screen.getByRole('button', { name: '应用 Legacy limiter' })).toBeEnabled();
  });

  it('submits and previews the edited official settings', async () => {
    const { props } = renderDialog();
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'hardClip' } });
    fireEvent.change(screen.getByLabelText('Input Gain (dB) mono/Left'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('Input Gain (dB) Right channel'), { target: { value: '6' } });
    fireEvent.change(screen.getByLabelText('Limit to (dB)'), { target: { value: '-6' } });
    fireEvent.change(screen.getByLabelText('Hold (ms)'), { target: { value: '20' } });
    fireEvent.change(screen.getByLabelText('Apply Make-up Gain'), { target: { value: 'yes' } });
    const expected = {
      type: 'hardClip', inputGainLeftDb: 3, inputGainRightDb: 6,
      limitToDb: -6, holdMs: 20, applyMakeupGain: true,
    };
    fireEvent.click(screen.getByRole('button', { name: '试听' }));
    await waitFor(() => expect(props.onPreview).toHaveBeenCalledWith(expected));
    expect(mocks.startPreview).toHaveBeenCalledWith(expect.any(Function), 44100);
    fireEvent.click(screen.getByRole('button', { name: '应用 Legacy limiter' }));
    expect(props.onApply).toHaveBeenCalledWith(expected);
  });

  it('blocks empty or out-of-range values and restores defaults', () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText('Hold (ms)'), { target: { value: '' } });
    expect(screen.getByRole('alert')).toHaveTextContent('请填写全部 Legacy limiter 参数');
    expect(screen.getByRole('button', { name: '应用 Legacy limiter' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Hold (ms)'), { target: { value: '51' } });
    expect(screen.getByRole('alert')).toHaveTextContent('Hold');
    fireEvent.click(screen.getByRole('button', { name: '恢复默认' }));
    expect(screen.getByLabelText('Hold (ms)')).toHaveValue(DEFAULT_LEGACY_LIMITER_SETTINGS.holdMs);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('disables processing without a real selection', () => {
    renderDialog({ hasSelection: false });
    expect(screen.getByRole('alert')).toHaveTextContent('请先选择要处理的音频');
    expect(screen.getByRole('button', { name: '试听' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '应用 Legacy limiter' })).toBeDisabled();
  });
});
