import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChangeSpeedDialog } from './ChangeSpeedDialog';

const originalAudioContext = window.AudioContext;
const contexts: FakeAudioContext[] = [];

class FakeAudioContext {
  state = 'running';
  destination = {};
  constructor() { contexts.push(this); }
  createBuffer() {
    return { getChannelData: () => new Float32Array(4) };
  }
  createBufferSource() {
    return { connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: null };
  }
  resume() { return Promise.resolve(); }
  close() { this.state = 'closed'; return Promise.resolve(); }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function renderDialog(overrides: Partial<Parameters<typeof ChangeSpeedDialog>[0]> = {}) {
  const props = {
    open: true,
    onOpenChange: vi.fn(),
    selectionDuration: 1,
    hasSelection: true,
    sampleRate: 48_000,
    applying: false,
    onPreview: vi.fn().mockResolvedValue([new Float32Array(4)]),
    onApply: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  return { ...render(<ChangeSpeedDialog {...props} />), props };
}

describe('ChangeSpeedDialog parameter linkage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    contexts.length = 0;
    window.AudioContext = originalAudioContext;
  });

  it('links multiplier, percent and target duration, then applies exact settings', () => {
    const { props } = renderDialog();
    fireEvent.change(screen.getByLabelText('速度倍率'), { target: { value: '2' } });
    expect(screen.getByLabelText('变化百分比（%）')).toHaveValue(100);
    expect(screen.getByLabelText('目标时长（秒）')).toHaveValue(0.5);
    expect(screen.getByLabelText('变化百分比滑块')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '应用效果' }));
    expect(props.onApply).toHaveBeenCalledWith({ percentChange: 100 });
  });

  it('links target duration and directed standard-vinyl transitions', () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText('目标时长（秒）'), { target: { value: '2' } });
    expect(screen.getByLabelText('变化百分比（%）')).toHaveValue(-50);
    expect(screen.getByLabelText('速度倍率')).toHaveValue(0.5);

    fireEvent.change(screen.getByLabelText('目标唱片转速'), { target: { value: '45' } });
    expect(screen.getByLabelText('变化百分比（%）')).toHaveValue(35);
    expect(screen.getByLabelText('速度倍率')).toHaveValue(1.35);
    fireEvent.change(screen.getByLabelText('目标唱片转速'), { target: { value: '78' } });
    expect(screen.getByLabelText('变化百分比（%）')).toHaveValue(134);
    fireEvent.change(screen.getByLabelText('原始唱片转速'), { target: { value: '45' } });
    expect(screen.getByLabelText('变化百分比（%）')).toHaveValue(73.33333);
  });

  it('rejects out-of-range and malformed values and disables the official zero no-op', () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText('变化百分比（%）'), { target: { value: '4901' } });
    expect(screen.getByRole('alert')).toHaveTextContent('-99% 至 4900%');
    expect(screen.getByRole('button', { name: '应用效果' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '重置' }));
    expect(screen.getByLabelText('变化百分比（%）')).toHaveValue(0);
    expect(screen.getByRole('button', { name: '应用效果' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('速度倍率'), { target: { value: '0' } });
    expect(screen.getByRole('alert')).toHaveTextContent('大于零');
  });

  it('keeps preview failure non-destructive and still allows Apply', async () => {
    const { props } = renderDialog({ onPreview: vi.fn().mockRejectedValue(new Error('no device')) });
    fireEvent.change(screen.getByLabelText('变化百分比（%）'), { target: { value: '100' } });
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
    fireEvent.change(screen.getByLabelText('变化百分比（%）'), { target: { value: '100' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '试听' })); });
    rerender(<ChangeSpeedDialog {...props} open={false} />);
    await act(async () => { pending.resolve([new Float32Array(4)]); await pending.promise; });
    expect(contexts).toHaveLength(0);
  });
});
