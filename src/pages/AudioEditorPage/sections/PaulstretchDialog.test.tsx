import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PaulstretchDialog } from './PaulstretchDialog';

const originalAudioContext = window.AudioContext;
const contexts: FakeAudioContext[] = [];

class FakeAudioContext {
  state = 'running';
  destination = {};
  constructor() { contexts.push(this); }
  createBuffer(_channels: number, length: number) {
    const data = new Float32Array(length);
    return { getChannelData: () => data };
  }
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

function renderDialog(overrides: Partial<Parameters<typeof PaulstretchDialog>[0]> = {}) {
  const props = {
    open: true,
    onOpenChange: vi.fn(),
    selectionDuration: 1,
    hasSelection: true,
    sampleRate: 1000,
    applying: false,
    onPreview: vi.fn().mockResolvedValue([new Float32Array(1000)]),
    onApply: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  return { ...render(<PaulstretchDialog {...props} />), props };
}

describe('PaulstretchDialog controls and preview lifecycle', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    contexts.length = 0;
    window.AudioContext = originalAudioContext;
  });

  it('uses official defaults and applies exact stretch and resolution settings', () => {
    const { props } = renderDialog();
    expect(screen.getByLabelText('拉伸倍数')).toHaveValue(10);
    expect(screen.getByLabelText('时间分辨率（秒）')).toHaveValue(0.25);
    fireEvent.change(screen.getByLabelText('拉伸倍数'), { target: { value: '2.5' } });
    fireEvent.change(screen.getByLabelText('时间分辨率（秒）'), { target: { value: '0.5' } });
    expect(screen.getByText(/预计输出时长：2.500 秒/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '应用效果' }));
    expect(props.onApply).toHaveBeenCalledWith({ stretchFactor: 2.5, timeResolution: 0.5 });
  });

  it('rejects invalid controls and too-short selections, then restores defaults', () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText('拉伸倍数'), { target: { value: '0' } });
    expect(screen.getByRole('alert')).toHaveTextContent('拉伸倍数');
    expect(screen.getByRole('button', { name: '应用效果' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '重置' }));
    expect(screen.getByLabelText('拉伸倍数')).toHaveValue(10);
    fireEvent.change(screen.getByLabelText('时间分辨率（秒）'), { target: { value: '2' } });
    expect(screen.getByRole('alert')).toHaveTextContent('选区太短');
    expect(screen.getByRole('button', { name: '试听' })).toBeDisabled();
  });

  it('keeps preview failure non-destructive and still allows Apply', async () => {
    const { props } = renderDialog({ onPreview: vi.fn().mockRejectedValue(new Error('no device')) });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '试听' })); });
    expect(await screen.findByRole('alert')).toHaveTextContent('no device');
    expect(screen.getByRole('button', { name: '应用效果' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '应用效果' }));
    expect(props.onApply).toHaveBeenCalledWith({ stretchFactor: 10, timeResolution: 0.25 });
  });

  it('ignores a late preview result after the dialog closes', async () => {
    window.AudioContext = FakeAudioContext as unknown as typeof AudioContext;
    const pending = deferred<Float32Array[]>();
    const { rerender, props } = renderDialog({ onPreview: vi.fn(() => pending.promise) });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '试听' })); });
    rerender(<PaulstretchDialog {...props} open={false} />);
    await act(async () => { pending.resolve([new Float32Array(1000)]); await pending.promise; });
    expect(contexts).toHaveLength(0);
  });
});
