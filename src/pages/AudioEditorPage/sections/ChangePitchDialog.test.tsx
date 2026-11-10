import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChangePitchDialog } from './ChangePitchDialog';

const originalAudioContext = window.AudioContext;
const contexts: FakeAudioContext[] = [];

class FakeAudioContext {
  state = 'running';
  destination = {};
  constructor() { contexts.push(this); }
  createBuffer() { return { getChannelData: () => new Float32Array(4) }; }
  createBufferSource() {
    return { connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: null };
  }
  resume() { return Promise.resolve(); }
  close() { this.state = 'closed'; return Promise.resolve(); }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

function renderDialog(overrides: Partial<Parameters<typeof ChangePitchDialog>[0]> = {}) {
  const props = {
    open: true,
    onOpenChange: vi.fn(),
    hasSelection: true,
    sampleRate: 48_000,
    applying: false,
    onPreview: vi.fn().mockResolvedValue([new Float32Array(4)]),
    onApply: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  return { ...render(<ChangePitchDialog {...props} />), props };
}

describe('ChangePitchDialog parameter linkage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    contexts.length = 0;
    window.AudioContext = originalAudioContext;
  });

  it('links semitones, percent, target frequency and note names, then applies exact settings', () => {
    const { props } = renderDialog();
    fireEvent.change(screen.getByLabelText('半音（半音阶）'), { target: { value: '12' } });
    expect(screen.getByLabelText('变化百分比（%）')).toHaveValue(100);
    expect(screen.getByLabelText('原始频率（Hz）')).toHaveValue(261.626);
    expect(screen.getByLabelText('目标频率（Hz）')).toHaveValue(523.251);
    expect(screen.getByLabelText('目标音高')).toHaveValue('0');
    expect(screen.getByLabelText('目标八度')).toHaveValue(5);
    fireEvent.click(screen.getByRole('button', { name: '应用效果' }));
    expect(props.onApply).toHaveBeenCalledWith({ percentChange: 100 });
  });

  it('links directed pitch/octave selection and both frequency directions', () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText('目标音高'), { target: { value: '9' } });
    expect(screen.getByLabelText('半音（半音阶）')).toHaveValue(9);
    fireEvent.change(screen.getByLabelText('目标八度'), { target: { value: '5' } });
    expect(screen.getByLabelText('变化百分比（%）')).toHaveValue(236.358566);
    fireEvent.change(screen.getByLabelText('目标频率（Hz）'), { target: { value: '523.2511306' } });
    expect(screen.getByLabelText('变化百分比（%）')).toHaveValue(100);
    fireEvent.change(screen.getByLabelText('原始频率（Hz）'), { target: { value: '440' } });
    expect(screen.getByLabelText('原始音高')).toHaveValue('9');
    expect(screen.getByLabelText('目标频率（Hz）')).toHaveValue(880);
  });

  it('rejects malformed and out-of-range values and disables the official zero no-op', () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText('变化百分比（%）'), { target: { value: '3001' } });
    expect(screen.getByRole('alert')).toHaveTextContent('-99% 至 3000%');
    expect(screen.getByRole('button', { name: '应用效果' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '重置' }));
    expect(screen.getByLabelText('变化百分比（%）')).toHaveValue(0);
    expect(screen.getByRole('button', { name: '应用效果' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('原始频率（Hz）'), { target: { value: '0' } });
    expect(screen.getByRole('alert')).toHaveTextContent('大于零');
  });

  it('keeps preview failure non-destructive and still allows Apply', async () => {
    const { props } = renderDialog({ onPreview: vi.fn().mockRejectedValue(new Error('no device')) });
    fireEvent.change(screen.getByLabelText('半音（半音阶）'), { target: { value: '12' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '试听' })); });
    expect(await screen.findByRole('alert')).toHaveTextContent('no device');
    expect(screen.getByRole('button', { name: '应用效果' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '应用效果' }));
    expect(props.onApply).toHaveBeenCalledWith({ percentChange: 100 });
  });

  it('ignores a late preview result after the dialog closes', async () => {
    window.AudioContext = FakeAudioContext as unknown as typeof AudioContext;
    const pending = deferred<Float32Array[]>();
    const { rerender, props } = renderDialog({ onPreview: vi.fn(() => pending.promise) });
    fireEvent.change(screen.getByLabelText('半音（半音阶）'), { target: { value: '12' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '试听' })); });
    rerender(<ChangePitchDialog {...props} open={false} />);
    await act(async () => { pending.resolve([new Float32Array(4)]); await pending.promise; });
    expect(contexts).toHaveLength(0);
  });
});
