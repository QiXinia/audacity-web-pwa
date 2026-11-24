import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import EffectPanel from '@/pages/AudioEditorPage/sections/EffectPanel';
import type { ITrack } from '@/types/project';

vi.spyOn(window, 'scrollTo').mockImplementation(() => {});

const track: ITrack = {
  id: 'track-a', name: 'Track A', type: 'audio', gain: 0, pan: 0,
  muted: false, solo: false, armed: false, color: '#66A3FF', clips: [],
  effects: [
    { id: 'fx-gain', type: 'gain', bypassed: false, params: { gain: 0 } },
    { id: 'fx-high-pass', type: 'highPass', bypassed: false, params: { frequency: 80 } },
    { id: 'fx-reverb', type: 'reverb', bypassed: false, params: { mix: 30 } },
  ],
};

function renderPanel(overrides: Partial<Parameters<typeof EffectPanel>[0]> = {}) {
  const props = {
    track,
    onClose: vi.fn(),
    onAddEffect: vi.fn(),
    onUpdateEffect: vi.fn(),
    onToggleBypass: vi.fn(),
    onToggleAllEffects: vi.fn(),
    onRemoveEffect: vi.fn(),
    onMoveEffect: vi.fn(),
    onReplaceEffect: vi.fn(),
    ...overrides,
  };
  render(<EffectPanel {...props} />);
  return props;
}

describe('EffectPanel parameter edits and newly added effects', () => {
  it('keeps independent rapid parameter edits instead of restoring stale sibling values', () => {
    const twoParamTrack: ITrack = {
      ...track,
      effects: [
        { id: 'fx-high-pass', type: 'highPass', bypassed: false, params: { frequency: 80, q: 0.707 } },
      ],
    };
    let persisted = { frequency: 80, q: 0.707 };
    const onUpdateEffect = vi.fn((_effectId: string, params: Record<string, number>) => {
      persisted = { ...persisted, ...params };
    });
    renderPanel({ track: twoParamTrack, onUpdateEffect });

    const sliders = screen.getAllByRole('slider');
    expect(sliders).toHaveLength(2);
    fireEvent.keyDown(sliders[0]!, { key: 'ArrowRight' });
    expect(persisted.frequency).toBe(81);
    fireEvent.keyDown(sliders[1]!, { key: 'End' });

    expect(onUpdateEffect).toHaveBeenNthCalledWith(1, 'fx-high-pass', { frequency: 81 });
    expect(onUpdateEffect).toHaveBeenNthCalledWith(2, 'fx-high-pass', { q: 10 });
    expect(persisted).toEqual({ frequency: 81, q: 10 });
  });

  it('uses the current track selection and effect id after switching tracks', () => {
    const props = {
      track,
      onClose: vi.fn(), onAddEffect: vi.fn(), onUpdateEffect: vi.fn(),
      onToggleBypass: vi.fn(), onToggleAllEffects: vi.fn(), onRemoveEffect: vi.fn(), onMoveEffect: vi.fn(),
      onReplaceEffect: vi.fn(),
    };
    const view = render(<EffectPanel {...props} />);
    expect(screen.getByText('0.00dB')).toBeInTheDocument();

    const otherTrack: ITrack = {
      ...track,
      id: 'track-b',
      name: 'Track B',
      effects: [
        { id: 'fx-low-pass-b', type: 'lowPass', bypassed: false, params: { frequency: 6400, q: 0.707 } },
      ],
    };
    view.rerender(<EffectPanel {...props} track={otherTrack} />);

    expect(screen.getByText('6400Hz')).toBeInTheDocument();
    expect(screen.getByTestId('realtime-effect-fx-low-pass-b')).toHaveClass('border-primary');
    fireEvent.keyDown(screen.getAllByRole('slider')[0]!, { key: 'ArrowRight' });
    expect(props.onUpdateEffect).toHaveBeenCalledWith('fx-low-pass-b', { frequency: 6401 });
  });

  it('selects the effect returned by a successful add so its parameters open immediately', async () => {
    const added = {
      id: 'fx-low-pass-new', type: 'lowPass' as const, bypassed: false,
      params: { frequency: 8000, q: 0.707 },
    };
    const emptyTrack = { ...track, effects: [] };
    const onAddEffect = vi.fn();
    onAddEffect.mockResolvedValue(added);
    const props = {
      track: emptyTrack,
      onClose: vi.fn(), onAddEffect, onUpdateEffect: vi.fn(),
      onToggleBypass: vi.fn(), onToggleAllEffects: vi.fn(), onRemoveEffect: vi.fn(), onMoveEffect: vi.fn(),
      onReplaceEffect: vi.fn(),
    };
    const view = render(<EffectPanel {...props} />);
    fireEvent.click(screen.getByRole('button', { name: '添加效果' }));
    fireEvent.click(screen.getByRole('button', { name: '低通滤波' }));
    await waitFor(() => expect(onAddEffect).toHaveBeenCalledWith('lowPass'));

    view.rerender(<EffectPanel {...props} track={{ ...emptyTrack, effects: [added] }} />);
    expect(await screen.findByText('8000Hz')).toBeInTheDocument();
    expect(screen.getByTestId('realtime-effect-fx-low-pass-new')).toHaveClass('border-primary');
  });

  it('moves focus from the keyboard-navigated add menu to the new effect parameters', async () => {
    const added = {
      id: 'fx-low-pass-keyboard', type: 'lowPass' as const, bypassed: false,
      params: { frequency: 8000, q: 0.707 },
    };
    const emptyTrack = { ...track, effects: [] };
    const onAddEffect = vi.fn(async () => added);
    const props = {
      track: emptyTrack,
      onClose: vi.fn(), onAddEffect, onUpdateEffect: vi.fn(),
      onToggleBypass: vi.fn(), onToggleAllEffects: vi.fn(), onRemoveEffect: vi.fn(), onMoveEffect: vi.fn(),
      onReplaceEffect: vi.fn(),
    };
    const view = render(<EffectPanel {...props} />);
    const add = screen.getByRole('button', { name: '添加效果' });
    add.focus();
    fireEvent.click(add);

    const gain = screen.getByRole('button', { name: '增益' });
    fireEvent.keyDown(gain, { key: 'ArrowDown' });
    const lowPass = screen.getByRole('button', { name: '低通滤波' });
    fireEvent.keyDown(screen.getByRole('button', { name: '高通滤波' }), { key: 'ArrowDown' });
    expect(lowPass).toHaveFocus();
    fireEvent.click(lowPass);
    await waitFor(() => expect(onAddEffect).toHaveBeenCalledWith('lowPass'));

    view.rerender(<EffectPanel {...props} track={{ ...emptyTrack, effects: [added] }} />);
    expect(await screen.findByText('8000Hz')).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByRole('slider')[0]).toHaveFocus());
  });

  it('discards pending add-parameter focus when the asynchronous add finishes on another track', async () => {
    const added = {
      id: 'fx-low-pass-cross-track', type: 'lowPass' as const, bypassed: false,
      params: { frequency: 8000, q: 0.707 },
    };
    let finish!: () => void;
    const onAddEffect = vi.fn(() => new Promise<typeof added>((resolve) => {
      finish = () => resolve(added);
    }));
    const emptyTrack = { ...track, effects: [] };
    const otherTrack: ITrack = {
      ...track,
      id: 'track-b',
      name: 'Track B',
      effects: [
        { id: 'fx-low-pass-b', type: 'lowPass', bypassed: false, params: { frequency: 6400, q: 0.707 } },
      ],
    };
    const props = {
      track: emptyTrack,
      onClose: vi.fn(), onAddEffect, onUpdateEffect: vi.fn(),
      onToggleBypass: vi.fn(), onToggleAllEffects: vi.fn(), onRemoveEffect: vi.fn(), onMoveEffect: vi.fn(),
      onReplaceEffect: vi.fn(),
    };
    const view = render(<EffectPanel {...props} />);
    fireEvent.click(screen.getByRole('button', { name: '添加效果' }));
    fireEvent.click(screen.getByRole('button', { name: '低通滤波' }));
    expect(onAddEffect).toHaveBeenCalledWith('lowPass');

    view.rerender(<EffectPanel {...props} track={otherTrack} />);
    act(() => {
      document.body.tabIndex = -1;
      document.body.focus();
    });
    await act(async () => { finish(); });
    await waitFor(() => expect(screen.getByRole('button', { name: '添加效果' })).toBeEnabled());
    expect(document.body).toHaveFocus();

    view.rerender(<EffectPanel {...props} track={{ ...emptyTrack, effects: [added] }} />);

    expect(document.body).toHaveFocus();
  });

  it('does not auto-select an asynchronous add that completes during a cross-track visit', async () => {
    const added = {
      id: 'fx-low-pass-cross-track-selection', type: 'lowPass' as const, bypassed: false,
      params: { frequency: 8000, q: 0.707 },
    };
    let finish!: () => void;
    const onAddEffect = vi.fn(() => new Promise<typeof added>((resolve) => {
      finish = () => resolve(added);
    }));
    const sourceTrack = { ...track, effects: [track.effects[0]!, track.effects[2]!] };
    const otherTrack: ITrack = {
      ...track,
      id: 'track-b',
      name: 'Track B',
      effects: [
        { id: 'fx-low-pass-b', type: 'lowPass', bypassed: false, params: { frequency: 6400, q: 0.707 } },
      ],
    };
    const props = {
      track: sourceTrack,
      onClose: vi.fn(), onAddEffect, onUpdateEffect: vi.fn(),
      onToggleBypass: vi.fn(), onToggleAllEffects: vi.fn(), onRemoveEffect: vi.fn(), onMoveEffect: vi.fn(),
      onReplaceEffect: vi.fn(),
    };
    const view = render(<EffectPanel {...props} />);
    fireEvent.click(screen.getByRole('button', { name: '添加效果' }));
    fireEvent.click(screen.getByRole('button', { name: '低通滤波' }));

    view.rerender(<EffectPanel {...props} track={otherTrack} />);
    await act(async () => { finish(); });
    await waitFor(() => expect(screen.getByRole('button', { name: '添加效果' })).toBeEnabled());
    view.rerender(<EffectPanel
      {...props}
      track={{ ...sourceTrack, effects: [...sourceTrack.effects, added] }}
    />);

    expect(screen.getByTestId('realtime-effect-fx-gain')).toHaveClass('border-primary');
    expect(screen.getByTestId(`realtime-effect-${added.id}`)).not.toHaveClass('border-primary');
    expect(screen.getByText('0.00dB')).toBeInTheDocument();
    expect(screen.queryByText('8000Hz')).not.toBeInTheDocument();
  });

  it('does not auto-select an asynchronous add after an external undo reorders the same track chain', async () => {
    const added = {
      id: 'fx-low-pass-external-chain', type: 'lowPass' as const, bypassed: false,
      params: { frequency: 8000, q: 0.707 },
    };
    let finish!: () => void;
    const onAddEffect = vi.fn(() => new Promise<typeof added>((resolve) => {
      finish = () => resolve(added);
    }));
    const externallyReorderedTrack = {
      ...track,
      effects: [track.effects[1]!, track.effects[0]!, track.effects[2]!],
    };
    const props = {
      track,
      onClose: vi.fn(), onAddEffect, onUpdateEffect: vi.fn(),
      onToggleBypass: vi.fn(), onToggleAllEffects: vi.fn(), onRemoveEffect: vi.fn(), onMoveEffect: vi.fn(),
      onReplaceEffect: vi.fn(),
    };
    const view = render(<EffectPanel {...props} />);
    fireEvent.click(screen.getByRole('button', { name: '添加效果' }));
    fireEvent.click(screen.getByRole('button', { name: '低通滤波' }));

    // No explicit effect selection or track switch: an external history/cross-tab update
    // replaces the chain while the add is still saving. The service later appends to it.
    view.rerender(<EffectPanel {...props} track={externallyReorderedTrack} />);
    expect(screen.getByTestId('realtime-effect-fx-gain')).toHaveClass('border-primary');
    await act(async () => { finish(); });
    await waitFor(() => expect(screen.getByRole('button', { name: '添加效果' })).toBeEnabled());
    view.rerender(<EffectPanel
      {...props}
      track={{ ...externallyReorderedTrack, effects: [...externallyReorderedTrack.effects, added] }}
    />);

    expect(screen.getByTestId('realtime-effect-fx-gain')).toHaveClass('border-primary');
    expect(screen.getByTestId(`realtime-effect-${added.id}`)).not.toHaveClass('border-primary');
    expect(screen.getByText('0.00dB')).toBeInTheDocument();
    expect(screen.queryByText('8000Hz')).not.toBeInTheDocument();
  });

  it('cancels stale add-parameter focus after the user explicitly selects another effect', async () => {
    const added = {
      id: 'fx-low-pass-explicit-selection', type: 'lowPass' as const, bypassed: false,
      params: { frequency: 8000, q: 0.707 },
    };
    let finish!: () => void;
    const onAddEffect = vi.fn(() => new Promise<typeof added>((resolve) => {
      finish = () => resolve(added);
    }));
    const props = {
      track,
      onClose: vi.fn(), onAddEffect, onUpdateEffect: vi.fn(),
      onToggleBypass: vi.fn(), onToggleAllEffects: vi.fn(), onRemoveEffect: vi.fn(), onMoveEffect: vi.fn(),
      onReplaceEffect: vi.fn(),
    };
    const view = render(<EffectPanel {...props} />);
    fireEvent.click(screen.getByRole('button', { name: '添加效果' }));
    fireEvent.click(screen.getByRole('button', { name: '低通滤波' }));
    expect(onAddEffect).toHaveBeenCalledWith('lowPass');

    // The returned effect is committed by the external store in a later render.
    await act(async () => { finish(); });
    await waitFor(() => expect(screen.getByRole('button', { name: '添加效果' })).toBeEnabled());
    const highPass = screen.getByRole('button', { name: '打开高通滤波参数' });
    highPass.focus();
    fireEvent.click(highPass);
    expect(highPass).toHaveFocus();

    view.rerender(<EffectPanel {...props} track={{ ...track, effects: [...track.effects, added] }} />);
    const openAdded = screen.getByRole('button', { name: '打开低通滤波参数' });
    openAdded.focus();
    fireEvent.click(openAdded);

    // A newer explicit selection supersedes the old add-operation focus request.
    expect(openAdded).toHaveFocus();
    expect(screen.getAllByRole('slider')[0]).not.toHaveFocus();
  });

  it('preserves an explicit selection made while a successful add is still pending', async () => {
    const added = {
      id: 'fx-low-pass-pending-explicit-selection', type: 'lowPass' as const, bypassed: false,
      params: { frequency: 8000, q: 0.707 },
    };
    let finish!: () => void;
    const onAddEffect = vi.fn(() => new Promise<typeof added>((resolve) => {
      finish = () => resolve(added);
    }));
    const props = {
      track,
      onClose: vi.fn(), onAddEffect, onUpdateEffect: vi.fn(),
      onToggleBypass: vi.fn(), onToggleAllEffects: vi.fn(), onRemoveEffect: vi.fn(), onMoveEffect: vi.fn(),
      onReplaceEffect: vi.fn(),
    };
    const view = render(<EffectPanel {...props} />);
    fireEvent.click(screen.getByRole('button', { name: '添加效果' }));
    fireEvent.click(screen.getByRole('button', { name: '低通滤波' }));
    expect(onAddEffect).toHaveBeenCalledWith('lowPass');

    const reverb = screen.getByRole('button', { name: '打开混响参数' });
    reverb.focus();
    fireEvent.click(reverb);
    expect(reverb).toHaveFocus();

    await act(async () => { finish(); });
    await waitFor(() => expect(screen.getByRole('button', { name: '添加效果' })).toBeEnabled());
    view.rerender(<EffectPanel {...props} track={{ ...track, effects: [...track.effects, added] }} />);

    expect(screen.getByTestId('realtime-effect-fx-reverb')).toHaveClass('border-primary');
    expect(screen.getByTestId(`realtime-effect-${added.id}`)).not.toHaveClass('border-primary');
    expect(reverb).toHaveFocus();
    expect(screen.queryByText('8000Hz')).not.toBeInTheDocument();
  });

  it.each([
    { outcome: 'null', result: null },
    { outcome: 'void', result: undefined },
  ])('discards add-button focus restoration when an asynchronous $outcome result finishes on another track', async ({ result }) => {
    let finish!: () => void;
    const onAddEffect = vi.fn(() => new Promise<null | undefined>((resolve) => {
      finish = () => resolve(result);
    }));
    const emptyTrack = { ...track, effects: [] };
    const otherTrack: ITrack = {
      ...track,
      id: 'track-b',
      name: 'Track B',
      effects: [
        { id: 'fx-low-pass-b', type: 'lowPass', bypassed: false, params: { frequency: 6400, q: 0.707 } },
      ],
    };
    const props = {
      track: emptyTrack,
      onClose: vi.fn(), onAddEffect, onUpdateEffect: vi.fn(),
      onToggleBypass: vi.fn(), onToggleAllEffects: vi.fn(), onRemoveEffect: vi.fn(), onMoveEffect: vi.fn(),
      onReplaceEffect: vi.fn(),
    };
    const view = render(<EffectPanel {...props} />);
    fireEvent.click(screen.getByRole('button', { name: '添加效果' }));
    fireEvent.click(screen.getByRole('button', { name: '低通滤波' }));
    expect(onAddEffect).toHaveBeenCalledWith('lowPass');

    view.rerender(<EffectPanel {...props} track={otherTrack} />);
    act(() => {
      document.body.tabIndex = -1;
      document.body.focus();
    });
    await act(async () => { finish(); });
    await waitFor(() => expect(screen.queryByText('选择效果类型')).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole('button', { name: '添加效果' })).toBeEnabled());
    expect(document.body).toHaveFocus();

    view.rerender(<EffectPanel {...props} track={emptyTrack} />);
    expect(document.body).toHaveFocus();
  });

  it.each([
    { outcome: 'null', result: null },
    { outcome: 'void', result: undefined },
  ])('restores the add button focus when adding returns $outcome without an effect', async ({ result }) => {
    const onAddEffect = vi.fn(async () => result);
    const props = renderPanel({ onAddEffect });
    const add = screen.getByRole('button', { name: '添加效果' });
    add.focus();
    fireEvent.click(add);

    const lowPass = screen.getByRole('button', { name: '低通滤波' });
    lowPass.focus();
    fireEvent.click(lowPass);
    await waitFor(() => expect(onAddEffect).toHaveBeenCalledWith('lowPass'));
    await waitFor(() => expect(screen.queryByText('选择效果类型')).not.toBeInTheDocument());

    expect(props.onAddEffect).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: '添加效果' })).toHaveFocus();
  });

  it.each([
    { outcome: 'null', result: null, shouldReject: false },
    { outcome: 'void', result: undefined, shouldReject: false },
    { outcome: 'rejection', result: null, shouldReject: true },
  ])('cancels stale add-button focus after explicit selection when the add returns $outcome', async ({ result, shouldReject }) => {
    let settle!: () => void;
    const onAddEffect = vi.fn(() => new Promise<null | undefined>((resolve, reject) => {
      settle = () => {
        if (shouldReject) reject(new Error('add save failed after explicit selection'));
        else resolve(result);
      };
    }));
    renderPanel({ onAddEffect });
    fireEvent.click(screen.getByRole('button', { name: '添加效果' }));
    fireEvent.click(screen.getByRole('button', { name: '低通滤波' }));
    expect(onAddEffect).toHaveBeenCalledWith('lowPass');

    const reverb = screen.getByRole('button', { name: '打开混响参数' });
    reverb.focus();
    fireEvent.click(reverb);
    expect(reverb).toHaveFocus();

    await act(async () => { settle(); });
    await waitFor(() => expect(screen.queryByText('选择效果类型')).not.toBeInTheDocument());
    const add = screen.getByRole('button', { name: '添加效果' });
    expect(add).toBeEnabled();
    expect(reverb).toHaveFocus();
    expect(add).not.toHaveFocus();
    expect(onAddEffect).toHaveBeenCalledTimes(1);
  });

  it.each([
    { outcome: 'null', result: null, shouldReject: false },
    { outcome: 'void', result: undefined, shouldReject: false },
    { outcome: 'rejection', result: null, shouldReject: true },
  ])('discards add-button focus after an external chain update when the add returns $outcome', async ({ result, shouldReject }) => {
    let settle!: () => void;
    const onAddEffect = vi.fn(() => new Promise<null | undefined>((resolve, reject) => {
      settle = () => {
        if (shouldReject) reject(new Error('add save failed after external chain update'));
        else resolve(result);
      };
    }));
    const externallyReorderedTrack = {
      ...track,
      effects: [track.effects[1]!, track.effects[0]!, track.effects[2]!],
    };
    const props = {
      track,
      onClose: vi.fn(), onAddEffect, onUpdateEffect: vi.fn(),
      onToggleBypass: vi.fn(), onToggleAllEffects: vi.fn(), onRemoveEffect: vi.fn(), onMoveEffect: vi.fn(),
      onReplaceEffect: vi.fn(),
    };
    const view = render(<EffectPanel {...props} />);
    fireEvent.click(screen.getByRole('button', { name: '添加效果' }));
    fireEvent.click(screen.getByRole('button', { name: '低通滤波' }));
    expect(onAddEffect).toHaveBeenCalledWith('lowPass');

    // An external undo/cross-tab update replaces the chain without an explicit selection.
    view.rerender(<EffectPanel {...props} track={externallyReorderedTrack} />);
    act(() => {
      document.body.tabIndex = -1;
      document.body.focus();
    });
    await act(async () => { settle(); });

    await waitFor(() => expect(screen.queryByText('选择效果类型')).not.toBeInTheDocument());
    const add = screen.getByRole('button', { name: '添加效果' });
    expect(add).toBeEnabled();
    expect(document.body).toHaveFocus();
    expect(add).not.toHaveFocus();
  });

  it('closes the add menu and restores its trigger focus when the asynchronous add rejects', async () => {
    let fail!: () => void;
    const onAddEffect = vi.fn(() => new Promise<null>((_resolve, reject) => {
      fail = () => reject(new Error('add save failed'));
    }));
    renderPanel({ onAddEffect });
    const add = screen.getByRole('button', { name: '添加效果' });
    add.focus();
    fireEvent.click(add);

    const lowPass = screen.getByRole('button', { name: '低通滤波' });
    lowPass.focus();
    fireEvent.click(lowPass);
    expect(onAddEffect).toHaveBeenCalledWith('lowPass');
    expect(lowPass).toBeDisabled();

    await act(async () => { fail(); });

    await waitFor(() => expect(screen.queryByText('选择效果类型')).not.toBeInTheDocument());
    const restoredAdd = screen.getByRole('button', { name: '添加效果' });
    expect(restoredAdd).toBeEnabled();
    expect(restoredAdd).toHaveFocus();
    expect(onAddEffect).toHaveBeenCalledTimes(1);
  });
});

describe('EffectPanel Audacity effect name controls', () => {
  it('exposes each effect name as a focusable button that opens its parameters', () => {
    renderPanel();
    const openHighPass = screen.getByRole('button', { name: '打开高通滤波参数' });

    openHighPass.focus();
    expect(openHighPass).toHaveFocus();
    fireEvent.click(openHighPass);

    expect(screen.getByText('80Hz')).toBeInTheDocument();
    expect(screen.getByTestId('realtime-effect-fx-high-pass')).toHaveClass('border-primary');
    expect(screen.queryByText('0.00dB')).not.toBeInTheDocument();
  });
});

describe('EffectPanel Audacity track effects power', () => {
  it('exposes Toggle all effects independently from individual bypass states', async () => {
    const onToggleAllEffects = vi.fn(async () => {});
    const props = renderPanel({ onToggleAllEffects });
    const toggle = screen.getByRole('button', { name: '切换全部效果' });

    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(toggle);
    await waitFor(() => expect(onToggleAllEffects).toHaveBeenCalledTimes(1));
    expect(props.onToggleBypass).not.toHaveBeenCalled();
  });

  it('reflects a persistently inactive track chain and locks duplicate commands', async () => {
    let finish!: () => void;
    const onToggleAllEffects = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    renderPanel({
      track: { ...track, effectsActive: false },
      onToggleAllEffects,
    });
    const toggle = screen.getByRole('button', { name: '切换全部效果' });

    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(toggle);
    expect(toggle).toBeDisabled();
    fireEvent.click(toggle);
    expect(onToggleAllEffects).toHaveBeenCalledTimes(1);
    finish();
    await waitFor(() => expect(toggle).toBeEnabled());
  });
});

describe('EffectPanel realtime bypass focus', () => {
  it.each([
    { outcome: 'a committed toggle', committed: true },
    { outcome: 'no committed change', committed: false },
  ])('restores the bypass-button focus after $outcome', async ({ committed }) => {
    let finish!: () => void;
    const onToggleBypass = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const props = {
      track,
      onClose: vi.fn(), onAddEffect: vi.fn(), onUpdateEffect: vi.fn(),
      onToggleBypass, onToggleAllEffects: vi.fn(), onRemoveEffect: vi.fn(), onMoveEffect: vi.fn(),
      onReplaceEffect: vi.fn(),
    };
    const view = render(<EffectPanel {...props} />);
    const bypass = screen.getByRole('button', { name: '旁路高通滤波' });
    await act(async () => {
      bypass.focus();
      await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
    });
    fireEvent.click(bypass);
    expect(onToggleBypass).toHaveBeenCalledWith('fx-high-pass');
    expect(bypass).toBeDisabled();

    const updatedTrack = committed
      ? {
          ...track,
          effects: track.effects.map((effect) => effect.id === 'fx-high-pass'
            ? { ...effect, bypassed: true }
            : effect),
        }
      : track;
    view.rerender(<EffectPanel {...props} track={updatedTrack} />);
    const currentBypass = screen.getByRole('button', {
      name: committed ? '启用高通滤波' : '旁路高通滤波',
    });
    // Chromium drops focus when the activated button becomes disabled during saving.
    act(() => {
      document.body.tabIndex = -1;
      document.body.focus();
    });
    expect(document.body).toHaveFocus();
    await act(async () => { finish(); });

    await waitFor(() => expect(currentBypass).toHaveFocus());
    expect(currentBypass).toBeEnabled();
  });

  it('cancels stale bypass focus after the user explicitly selects another effect', async () => {
    let finish!: () => void;
    const onToggleBypass = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const props = {
      track,
      onClose: vi.fn(), onAddEffect: vi.fn(), onUpdateEffect: vi.fn(),
      onToggleBypass, onToggleAllEffects: vi.fn(), onRemoveEffect: vi.fn(), onMoveEffect: vi.fn(),
      onReplaceEffect: vi.fn(),
    };
    const view = render(<EffectPanel {...props} />);
    fireEvent.click(screen.getByRole('button', { name: '旁路高通滤波' }));
    expect(onToggleBypass).toHaveBeenCalledWith('fx-high-pass');

    view.rerender(<EffectPanel
      {...props}
      track={{
        ...track,
        effects: track.effects.map((effect) => effect.id === 'fx-high-pass'
          ? { ...effect, bypassed: true }
          : effect),
      }}
    />);
    const reverb = screen.getByRole('button', { name: '打开混响参数' });
    reverb.focus();
    fireEvent.click(reverb);
    expect(reverb).toHaveFocus();

    await act(async () => { finish(); });

    await waitFor(() => expect(screen.getByRole('button', { name: '启用高通滤波' })).toBeEnabled());
    expect(reverb).toHaveFocus();
  });

  it('restores bypass-button focus and unlocks when the asynchronous toggle rejects', async () => {
    let fail!: () => void;
    const onToggleBypass = vi.fn(() => new Promise<void>((_resolve, reject) => {
      fail = () => reject(new Error('bypass save failed'));
    }));
    renderPanel({ onToggleBypass });
    const bypass = screen.getByRole('button', { name: '旁路高通滤波' });
    await act(async () => {
      bypass.focus();
      await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
    });
    fireEvent.click(bypass);
    expect(onToggleBypass).toHaveBeenCalledWith('fx-high-pass');
    expect(bypass).toBeDisabled();

    act(() => {
      document.body.tabIndex = -1;
      document.body.focus();
    });
    await act(async () => { fail(); });

    await waitFor(() => expect(bypass).toHaveFocus());
    expect(bypass).toBeEnabled();
    expect(onToggleBypass).toHaveBeenCalledTimes(1);
  });

  it('restores the track-effects power-button focus after an asynchronous toggle', async () => {
    let finish!: () => void;
    const onToggleAllEffects = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const props = {
      track,
      onClose: vi.fn(), onAddEffect: vi.fn(), onUpdateEffect: vi.fn(),
      onToggleBypass: vi.fn(), onToggleAllEffects, onRemoveEffect: vi.fn(), onMoveEffect: vi.fn(),
      onReplaceEffect: vi.fn(),
    };
    const view = render(<EffectPanel {...props} />);
    const toggle = screen.getByRole('button', { name: '切换全部效果' });
    await act(async () => {
      toggle.focus();
      await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
    });
    fireEvent.click(toggle);
    expect(onToggleAllEffects).toHaveBeenCalledWith('track-a', false);
    expect(toggle).toBeDisabled();

    view.rerender(<EffectPanel {...props} track={{ ...track, effectsActive: false }} />);
    act(() => {
      document.body.tabIndex = -1;
      document.body.focus();
    });
    expect(document.body).toHaveFocus();
    await act(async () => { finish(); });

    await waitFor(() => expect(toggle).toHaveFocus());
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(toggle).toBeEnabled();
  });

  it('cancels stale track-effects power focus after the user explicitly selects another effect', async () => {
    let finish!: () => void;
    const onToggleAllEffects = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const props = {
      track,
      onClose: vi.fn(), onAddEffect: vi.fn(), onUpdateEffect: vi.fn(),
      onToggleBypass: vi.fn(), onToggleAllEffects, onRemoveEffect: vi.fn(), onMoveEffect: vi.fn(),
      onReplaceEffect: vi.fn(),
    };
    const view = render(<EffectPanel {...props} />);
    fireEvent.click(screen.getByRole('button', { name: '切换全部效果' }));
    expect(onToggleAllEffects).toHaveBeenCalledWith('track-a', false);

    view.rerender(<EffectPanel {...props} track={{ ...track, effectsActive: false }} />);
    const reverb = screen.getByRole('button', { name: '打开混响参数' });
    reverb.focus();
    fireEvent.click(reverb);
    expect(reverb).toHaveFocus();

    await act(async () => { finish(); });
    const toggle = screen.getByRole('button', { name: '切换全部效果' });
    await waitFor(() => expect(toggle).toBeEnabled());
    expect(reverb).toHaveFocus();
    expect(toggle).not.toHaveFocus();
  });

  it('restores track-effects power-button focus and unlocks when the asynchronous toggle rejects', async () => {
    let fail!: () => void;
    const onToggleAllEffects = vi.fn(() => new Promise<void>((_resolve, reject) => {
      fail = () => reject(new Error('track effects save failed'));
    }));
    renderPanel({ onToggleAllEffects });
    const toggle = screen.getByRole('button', { name: '切换全部效果' });
    await act(async () => {
      toggle.focus();
      await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
    });
    fireEvent.click(toggle);
    expect(onToggleAllEffects).toHaveBeenCalledWith('track-a', false);
    expect(toggle).toBeDisabled();

    act(() => {
      document.body.tabIndex = -1;
      document.body.focus();
    });
    await act(async () => { fail(); });

    await waitFor(() => expect(toggle).toHaveFocus());
    expect(toggle).toBeEnabled();
    expect(onToggleAllEffects).toHaveBeenCalledTimes(1);
  });

  it.each([
    { outcome: 'resolves', shouldReject: false },
    { outcome: 'rejects', shouldReject: true },
  ])('discards pending bypass focus when the target disappears before the asynchronous toggle $outcome', async ({ shouldReject }) => {
    let settle!: () => void;
    const onToggleBypass = vi.fn(() => new Promise<void>((resolve, reject) => {
      settle = () => {
        if (shouldReject) reject(new Error('bypass save failed after external removal'));
        else resolve();
      };
    }));
    const props = {
      track,
      onClose: vi.fn(), onAddEffect: vi.fn(), onUpdateEffect: vi.fn(),
      onToggleBypass, onToggleAllEffects: vi.fn(), onRemoveEffect: vi.fn(), onMoveEffect: vi.fn(),
      onReplaceEffect: vi.fn(),
    };
    const view = render(<EffectPanel {...props} />);
    fireEvent.click(screen.getByRole('button', { name: '旁路高通滤波' }));
    expect(onToggleBypass).toHaveBeenCalledWith('fx-high-pass');

    const withoutTarget = {
      ...track,
      effects: track.effects.filter((effect) => effect.id !== 'fx-high-pass'),
    };
    view.rerender(<EffectPanel {...props} track={withoutTarget} />);
    act(() => {
      document.body.tabIndex = -1;
      document.body.focus();
    });
    await act(async () => { settle(); });

    await waitFor(() => expect(screen.getByRole('button', { name: '添加效果' })).toBeEnabled());
    expect(document.body).toHaveFocus();

    // An external undo can restore the same effect id; the old bypass request must not steal focus now.
    view.rerender(<EffectPanel {...props} track={track} />);
    expect(screen.getByRole('button', { name: '旁路高通滤波' })).toBeEnabled();
    expect(document.body).toHaveFocus();
  });

  it('does not restore a pending bypass focus into a different track', async () => {
    let finish!: () => void;
    const onToggleBypass = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const props = {
      track,
      onClose: vi.fn(), onAddEffect: vi.fn(), onUpdateEffect: vi.fn(),
      onToggleBypass, onToggleAllEffects: vi.fn(), onRemoveEffect: vi.fn(), onMoveEffect: vi.fn(),
      onReplaceEffect: vi.fn(),
    };
    const view = render(<EffectPanel {...props} />);
    fireEvent.click(screen.getByRole('button', { name: '旁路高通滤波' }));
    expect(onToggleBypass).toHaveBeenCalledWith('fx-high-pass');

    const otherTrack = { ...track, id: 'track-b', name: 'Track B' };
    view.rerender(<EffectPanel {...props} track={otherTrack} />);
    const otherTrackEffect = screen.getByRole('button', { name: '打开混响参数' });
    otherTrackEffect.focus();
    expect(otherTrackEffect).toHaveFocus();
    await act(async () => { finish(); });

    expect(otherTrackEffect).toHaveFocus();
    expect(screen.getByRole('button', { name: '旁路高通滤波' })).not.toHaveFocus();
  });
});

describe('EffectPanel Audacity empty effect guidance', () => {
  it('shows non-destructive guidance and the official video link for an empty chain', () => {
    renderPanel({ track: { ...track, effects: [] } });

    expect(screen.getByText('实时效果为非破坏性处理，可随时更改。')).toBeInTheDocument();
    const video = screen.getByRole('link', { name: '观看介绍视频' });
    expect(video).toHaveAttribute('href', 'https://www.audacityteam.org/realtime-video');
    expect(video).toHaveAttribute('target', '_blank');
    expect(video).toHaveAttribute('rel', expect.stringContaining('noreferrer'));
  });

  it('hides the empty-chain guidance as soon as effects exist', () => {
    renderPanel();

    expect(screen.queryByText('实时效果为非破坏性处理，可随时更改。')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '观看介绍视频' })).not.toBeInTheDocument();
  });
});

describe('EffectPanel add menu keyboard navigation', () => {
  it('focuses the first effect on open and restores the trigger after Escape or Cancel', () => {
    const props = renderPanel();
    const add = screen.getByRole('button', { name: '添加效果' });
    add.focus();
    fireEvent.click(add);

    const firstEffect = screen.getByRole('button', { name: '增益' });
    expect(firstEffect).toHaveFocus();
    fireEvent.keyDown(firstEffect, { key: 'Escape' });

    expect(screen.queryByText('选择效果类型')).not.toBeInTheDocument();
    const restoredAdd = screen.getByRole('button', { name: '添加效果' });
    expect(restoredAdd).toHaveFocus();

    fireEvent.click(restoredAdd);
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(screen.getByRole('button', { name: '添加效果' })).toHaveFocus();
    expect(props.onAddEffect).not.toHaveBeenCalled();
  });

  it('moves between effect options with arrows, Home and End without scrolling the page', () => {
    const props = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: '添加效果' }));

    const gain = screen.getByRole('button', { name: '增益' });
    const highPass = screen.getByRole('button', { name: '高通滤波' });
    const noiseGate = screen.getByRole('button', { name: '噪声门' });
    expect(gain).toHaveFocus();

    expect(fireEvent.keyDown(gain, { key: 'ArrowDown' })).toBe(false);
    expect(highPass).toHaveFocus();
    expect(fireEvent.keyDown(highPass, { key: 'ArrowUp' })).toBe(false);
    expect(gain).toHaveFocus();

    expect(fireEvent.keyDown(gain, { key: 'ArrowUp' })).toBe(false);
    expect(noiseGate).toHaveFocus();
    expect(fireEvent.keyDown(noiseGate, { key: 'ArrowDown' })).toBe(false);
    expect(gain).toHaveFocus();

    expect(fireEvent.keyDown(gain, { key: 'End' })).toBe(false);
    expect(noiseGate).toHaveFocus();
    expect(fireEvent.keyDown(noiseGate, { key: 'Home' })).toBe(false);
    expect(gain).toHaveFocus();
    expect(props.onAddEffect).not.toHaveBeenCalled();
  });
});

describe('EffectPanel Audacity replacement menu commands', () => {
  it('marks the current effect in the replacement menu', () => {
    renderPanel();

    const menu = screen.getByRole('combobox', { name: '替换高通滤波' });
    expect(within(menu).getByRole('option', { name: '✓ 高通滤波' })).toBeInTheDocument();
    expect(within(menu).getByRole('option', { name: '增益' })).toBeInTheDocument();
  });

  it('removes the effect from the same dropdown without invoking replacement', async () => {
    const props = renderPanel();

    const menu = screen.getByRole('combobox', { name: '替换高通滤波' });
    expect(within(menu).getByRole('option', { name: '移除效果' })).toBeInTheDocument();
    fireEvent.change(menu, { target: { value: '__remove__' } });

    await waitFor(() => expect(props.onRemoveEffect).toHaveBeenCalledWith('fx-high-pass'));
    expect(props.onReplaceEffect).not.toHaveBeenCalled();
  });
});

describe('EffectPanel Audacity replacement controls', () => {
  it('replaces an effect from its accessible dropdown and selects the returned effect', async () => {
    const replacement = { id: 'fx-low-pass-new', type: 'lowPass' as const, bypassed: false, params: { frequency: 8000, q: 0.7 } };
    const props = {
      track,
      onClose: vi.fn(), onAddEffect: vi.fn(), onUpdateEffect: vi.fn(),
      onToggleBypass: vi.fn(), onToggleAllEffects: vi.fn(), onRemoveEffect: vi.fn(), onMoveEffect: vi.fn(),
      onReplaceEffect: vi.fn(async () => replacement),
    };
    const view = render(<EffectPanel {...props} />);
    fireEvent.change(screen.getByRole('combobox', { name: '替换高通滤波' }), { target: { value: 'lowPass' } });
    expect(props.onReplaceEffect).toHaveBeenCalledWith('fx-high-pass', 'lowPass');

    const updatedTrack = {
      ...track,
      effects: [track.effects[0]!, replacement, track.effects[2]!],
    };
    await waitFor(() => expect(props.onReplaceEffect).toHaveBeenCalledTimes(1));
    view.rerender(<EffectPanel {...props} track={updatedTrack} />);
    expect(await screen.findByText('8000Hz')).toBeInTheDocument();
  });

  it('moves focus to the replacement parameters after the old effect menu unmounts', async () => {
    const replacement = {
      id: 'fx-delay-replacement', type: 'delay' as const, bypassed: false,
      params: { time: 0.3, feedback: 0.4, wet: 0.3 },
    };
    const props = {
      track,
      onClose: vi.fn(), onAddEffect: vi.fn(), onUpdateEffect: vi.fn(),
      onToggleBypass: vi.fn(), onToggleAllEffects: vi.fn(), onRemoveEffect: vi.fn(), onMoveEffect: vi.fn(),
      onReplaceEffect: vi.fn(async () => replacement),
    };
    const view = render(<EffectPanel {...props} />);
    const menu = screen.getByRole('combobox', { name: '替换高通滤波' });
    menu.focus();
    fireEvent.change(menu, { target: { value: 'delay' } });
    await waitFor(() => expect(props.onReplaceEffect).toHaveBeenCalledWith('fx-high-pass', 'delay'));

    view.rerender(<EffectPanel
      {...props}
      track={{ ...track, effects: [track.effects[0]!, replacement, track.effects[2]!] }}
    />);
    expect(await screen.findByText('0.30s')).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByRole('slider')[0]).toHaveFocus());
  });

  it('discards pending replacement-parameter focus when replacement finishes on another track', async () => {
    const replacement = {
      id: 'fx-delay-cross-track', type: 'delay' as const, bypassed: false,
      params: { time: 0.3, feedback: 0.4, wet: 0.3 },
    };
    let finish!: () => void;
    const onReplaceEffect = vi.fn(() => new Promise<typeof replacement>((resolve) => {
      finish = () => resolve(replacement);
    }));
    const otherTrack: ITrack = {
      ...track,
      id: 'track-b',
      name: 'Track B',
      effects: [
        { id: 'fx-low-pass-b', type: 'lowPass', bypassed: false, params: { frequency: 6400, q: 0.707 } },
      ],
    };
    const props = {
      track,
      onClose: vi.fn(), onAddEffect: vi.fn(), onUpdateEffect: vi.fn(),
      onToggleBypass: vi.fn(), onToggleAllEffects: vi.fn(), onRemoveEffect: vi.fn(), onMoveEffect: vi.fn(),
      onReplaceEffect,
    };
    const view = render(<EffectPanel {...props} />);
    fireEvent.change(screen.getByRole('combobox', { name: '替换高通滤波' }), { target: { value: 'delay' } });
    expect(onReplaceEffect).toHaveBeenCalledWith('fx-high-pass', 'delay');

    view.rerender(<EffectPanel {...props} track={otherTrack} />);
    act(() => {
      document.body.tabIndex = -1;
      document.body.focus();
    });
    await act(async () => { finish(); });
    await waitFor(() => expect(screen.getByRole('button', { name: '添加效果' })).toBeEnabled());
    expect(document.body).toHaveFocus();

    view.rerender(<EffectPanel
      {...props}
      track={{ ...track, effects: [track.effects[0]!, replacement, track.effects[2]!] }}
    />);

    expect(document.body).toHaveFocus();
  });

  it('does not auto-select an asynchronous replacement that completes during a cross-track visit', async () => {
    const replacement = {
      id: 'fx-delay-cross-track-selection', type: 'delay' as const, bypassed: false,
      params: { time: 0.3, feedback: 0.4, wet: 0.3 },
    };
    let finish!: () => void;
    const onReplaceEffect = vi.fn(() => new Promise<typeof replacement>((resolve) => {
      finish = () => resolve(replacement);
    }));
    const otherTrack: ITrack = {
      ...track,
      id: 'track-b',
      name: 'Track B',
      effects: [
        { id: 'fx-low-pass-b', type: 'lowPass', bypassed: false, params: { frequency: 6400, q: 0.707 } },
      ],
    };
    const props = {
      track,
      onClose: vi.fn(), onAddEffect: vi.fn(), onUpdateEffect: vi.fn(),
      onToggleBypass: vi.fn(), onToggleAllEffects: vi.fn(), onRemoveEffect: vi.fn(), onMoveEffect: vi.fn(),
      onReplaceEffect,
    };
    const view = render(<EffectPanel {...props} />);
    fireEvent.change(screen.getByRole('combobox', { name: '替换高通滤波' }), { target: { value: 'delay' } });

    view.rerender(<EffectPanel {...props} track={otherTrack} />);
    await act(async () => { finish(); });
    await waitFor(() => expect(screen.getByRole('button', { name: '添加效果' })).toBeEnabled());
    view.rerender(<EffectPanel
      {...props}
      track={{ ...track, effects: [track.effects[0]!, replacement, track.effects[2]!] }}
    />);

    expect(screen.getByTestId('realtime-effect-fx-gain')).toHaveClass('border-primary');
    expect(screen.getByTestId(`realtime-effect-${replacement.id}`)).not.toHaveClass('border-primary');
    expect(screen.getByText('0.00dB')).toBeInTheDocument();
    expect(screen.queryByText('0.30s')).not.toBeInTheDocument();
  });

  it('does not auto-select an asynchronous replacement after an external undo reorders the same track chain', async () => {
    const replacement = {
      id: 'fx-delay-external-chain', type: 'delay' as const, bypassed: false,
      params: { time: 0.3, feedback: 0.4, wet: 0.3 },
    };
    let finish!: () => void;
    const onReplaceEffect = vi.fn(() => new Promise<typeof replacement>((resolve) => {
      finish = () => resolve(replacement);
    }));
    const externallyReorderedTrack = {
      ...track,
      effects: [track.effects[1]!, track.effects[0]!, track.effects[2]!],
    };
    const props = {
      track,
      onClose: vi.fn(), onAddEffect: vi.fn(), onUpdateEffect: vi.fn(),
      onToggleBypass: vi.fn(), onToggleAllEffects: vi.fn(), onRemoveEffect: vi.fn(), onMoveEffect: vi.fn(),
      onReplaceEffect,
    };
    const view = render(<EffectPanel {...props} />);
    fireEvent.change(screen.getByRole('combobox', { name: '替换高通滤波' }), { target: { value: 'delay' } });

    // The replacement is committed by ID into the latest externally reordered chain.
    // Its old UI completion must not override the selection established by that new chain.
    view.rerender(<EffectPanel {...props} track={externallyReorderedTrack} />);
    expect(screen.getByTestId('realtime-effect-fx-gain')).toHaveClass('border-primary');
    await act(async () => { finish(); });
    await waitFor(() => expect(screen.getByRole('combobox', { name: '替换高通滤波' })).toBeEnabled());
    view.rerender(<EffectPanel
      {...props}
      track={{ ...externallyReorderedTrack, effects: [track.effects[0]!, replacement, track.effects[2]!] }}
    />);

    expect(screen.getByTestId('realtime-effect-fx-gain')).toHaveClass('border-primary');
    expect(screen.getByTestId(`realtime-effect-${replacement.id}`)).not.toHaveClass('border-primary');
    expect(screen.getByText('0.00dB')).toBeInTheDocument();
    expect(screen.queryByText('0.30s')).not.toBeInTheDocument();
  });

  it('cancels stale replacement-parameter focus after the user explicitly selects another effect', async () => {
    const replacement = {
      id: 'fx-delay-explicit-selection', type: 'delay' as const, bypassed: false,
      params: { time: 0.3, feedback: 0.4, wet: 0.3 },
    };
    let finish!: () => void;
    const onReplaceEffect = vi.fn(() => new Promise<typeof replacement>((resolve) => {
      finish = () => resolve(replacement);
    }));
    const props = {
      track,
      onClose: vi.fn(), onAddEffect: vi.fn(), onUpdateEffect: vi.fn(),
      onToggleBypass: vi.fn(), onToggleAllEffects: vi.fn(), onRemoveEffect: vi.fn(), onMoveEffect: vi.fn(),
      onReplaceEffect,
    };
    const view = render(<EffectPanel {...props} />);
    fireEvent.change(screen.getByRole('combobox', { name: '替换高通滤波' }), { target: { value: 'delay' } });
    expect(onReplaceEffect).toHaveBeenCalledWith('fx-high-pass', 'delay');

    // The returned replacement is committed by the external store in a later render.
    await act(async () => { finish(); });
    await waitFor(() => expect(screen.getByRole('combobox', { name: '替换高通滤波' })).toBeEnabled());
    const reverb = screen.getByRole('button', { name: '打开混响参数' });
    reverb.focus();
    fireEvent.click(reverb);
    expect(reverb).toHaveFocus();

    view.rerender(<EffectPanel
      {...props}
      track={{ ...track, effects: [track.effects[0]!, replacement, track.effects[2]!] }}
    />);
    const openReplacement = screen.getByRole('button', { name: '打开延迟参数' });
    openReplacement.focus();
    fireEvent.click(openReplacement);

    // A newer explicit selection supersedes the old replacement-operation focus request.
    expect(openReplacement).toHaveFocus();
    expect(screen.getAllByRole('slider')[0]).not.toHaveFocus();
  });

  it('preserves an explicit selection made while a successful replacement is still pending', async () => {
    const replacement = {
      id: 'fx-delay-pending-explicit-selection', type: 'delay' as const, bypassed: false,
      params: { time: 0.3, feedback: 0.4, wet: 0.3 },
    };
    let finish!: () => void;
    const onReplaceEffect = vi.fn(() => new Promise<typeof replacement>((resolve) => {
      finish = () => resolve(replacement);
    }));
    const props = {
      track,
      onClose: vi.fn(), onAddEffect: vi.fn(), onUpdateEffect: vi.fn(),
      onToggleBypass: vi.fn(), onToggleAllEffects: vi.fn(), onRemoveEffect: vi.fn(), onMoveEffect: vi.fn(),
      onReplaceEffect,
    };
    const view = render(<EffectPanel {...props} />);
    fireEvent.change(screen.getByRole('combobox', { name: '替换高通滤波' }), { target: { value: 'delay' } });
    expect(onReplaceEffect).toHaveBeenCalledWith('fx-high-pass', 'delay');

    const reverb = screen.getByRole('button', { name: '打开混响参数' });
    reverb.focus();
    fireEvent.click(reverb);
    expect(reverb).toHaveFocus();

    await act(async () => { finish(); });
    await waitFor(() => expect(screen.getByRole('combobox', { name: '替换高通滤波' })).toBeEnabled());
    view.rerender(<EffectPanel
      {...props}
      track={{ ...track, effects: [track.effects[0]!, replacement, track.effects[2]!] }}
    />);

    expect(screen.getByTestId('realtime-effect-fx-reverb')).toHaveClass('border-primary');
    expect(screen.getByTestId(`realtime-effect-${replacement.id}`)).not.toHaveClass('border-primary');
    expect(reverb).toHaveFocus();
    expect(screen.queryByText('0.30s')).not.toBeInTheDocument();
  });

  it.each([
    { outcome: 'null', shouldReject: false },
    { outcome: 'rejection', shouldReject: true },
  ])('preserves explicit selection when a pending replacement ends with $outcome', async ({ shouldReject }) => {
    let settle!: () => void;
    const onReplaceEffect = vi.fn(() => new Promise<null>((resolve, reject) => {
      settle = () => {
        if (shouldReject) reject(new Error('replacement failed after explicit selection'));
        else resolve(null);
      };
    }));
    renderPanel({ onReplaceEffect });
    fireEvent.change(screen.getByRole('combobox', { name: '替换高通滤波' }), { target: { value: 'lowPass' } });
    expect(onReplaceEffect).toHaveBeenCalledWith('fx-high-pass', 'lowPass');

    const reverb = screen.getByRole('button', { name: '打开混响参数' });
    reverb.focus();
    fireEvent.click(reverb);
    expect(reverb).toHaveFocus();

    await act(async () => { settle(); });
    const highPass = screen.getByRole('button', { name: '打开高通滤波参数' });
    await waitFor(() => expect(screen.getByRole('combobox', { name: '替换高通滤波' })).toBeEnabled());

    expect(reverb).toHaveFocus();
    expect(highPass).not.toHaveFocus();
    expect(screen.getByTestId('realtime-effect-fx-reverb')).toHaveClass('border-primary');
  });

  it.each([
    { outcome: 'null', result: null },
    { outcome: 'void', result: undefined },
  ])('restores the original effect-row focus when replacement returns $outcome', async ({ result }) => {
    let finish!: () => void;
    const onReplaceEffect = vi.fn(() => new Promise<null | undefined>((resolve) => {
      finish = () => resolve(result);
    }));
    renderPanel({ onReplaceEffect });
    const menu = screen.getByRole('combobox', { name: '替换高通滤波' });
    menu.focus();
    fireEvent.change(menu, { target: { value: 'lowPass' } });
    expect(onReplaceEffect).toHaveBeenCalledWith('fx-high-pass', 'lowPass');
    expect(menu).toBeDisabled();

    await act(async () => { finish(); });
    // jsdom retains focus on a disabled select; reproduce Chromium's dropped focus explicitly.
    menu.blur();

    await waitFor(() => expect(screen.getByRole('button', { name: '打开高通滤波参数' })).toHaveFocus());
    expect(menu).toBeEnabled();
  });

  it('restores the original effect-row focus and unlocks when asynchronous replacement rejects', async () => {
    let fail!: () => void;
    const onReplaceEffect = vi.fn(() => new Promise<null>((_resolve, reject) => {
      fail = () => reject(new Error('replacement save failed'));
    }));
    renderPanel({ onReplaceEffect });
    const menu = screen.getByRole('combobox', { name: '替换高通滤波' });
    menu.focus();
    fireEvent.change(menu, { target: { value: 'lowPass' } });
    expect(onReplaceEffect).toHaveBeenCalledWith('fx-high-pass', 'lowPass');
    expect(menu).toBeDisabled();

    act(() => {
      document.body.tabIndex = -1;
      document.body.focus();
    });
    await act(async () => { fail(); });

    await waitFor(() => expect(screen.getByRole('button', { name: '打开高通滤波参数' })).toHaveFocus());
    expect(menu).toBeEnabled();
    expect(onReplaceEffect).toHaveBeenCalledTimes(1);
  });

  it.each([
    { outcome: 'null', result: null, shouldReject: false },
    { outcome: 'void', result: undefined, shouldReject: false },
    { outcome: 'rejection', result: null, shouldReject: true },
  ])('discards original-row focus after an external chain update when replacement returns $outcome', async ({ result, shouldReject }) => {
    let settle!: () => void;
    const onReplaceEffect = vi.fn(() => new Promise<null | undefined>((resolve, reject) => {
      settle = () => {
        if (shouldReject) reject(new Error('replacement failed after external chain update'));
        else resolve(result);
      };
    }));
    const externallyReorderedTrack = {
      ...track,
      effects: [track.effects[1]!, track.effects[0]!, track.effects[2]!],
    };
    const props = {
      track,
      onClose: vi.fn(), onAddEffect: vi.fn(), onUpdateEffect: vi.fn(),
      onToggleBypass: vi.fn(), onToggleAllEffects: vi.fn(), onRemoveEffect: vi.fn(), onMoveEffect: vi.fn(),
      onReplaceEffect,
    };
    const view = render(<EffectPanel {...props} />);
    fireEvent.change(screen.getByRole('combobox', { name: '替换高通滤波' }), { target: { value: 'lowPass' } });
    expect(onReplaceEffect).toHaveBeenCalledWith('fx-high-pass', 'lowPass');

    // The old row may still exist, but its pending command no longer owns focus after a new chain arrives.
    view.rerender(<EffectPanel {...props} track={externallyReorderedTrack} />);
    act(() => {
      document.body.tabIndex = -1;
      document.body.focus();
    });
    await act(async () => { settle(); });

    const menu = screen.getByRole('combobox', { name: '替换高通滤波' });
    await waitFor(() => expect(menu).toBeEnabled());
    expect(document.body).toHaveFocus();
    expect(screen.getByRole('button', { name: '打开高通滤波参数' })).not.toHaveFocus();
  });

  it('displays persisted frequency values instead of falling back to zero', () => {
    renderPanel();
    fireEvent.click(screen.getByTestId('realtime-effect-fx-high-pass'));
    expect(screen.getByText('80Hz')).toBeInTheDocument();
    expect(screen.queryByText('0Hz')).not.toBeInTheDocument();
  });

  it('locks replacement while an asynchronous chain mutation is saving', async () => {
    let finish!: () => void;
    const onMoveEffect = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const props = renderPanel({ onMoveEffect });
    fireEvent.click(screen.getByRole('button', { name: '下移增益' }));
    const replacement = screen.getByRole('combobox', { name: '替换高通滤波' });
    expect(replacement).toBeDisabled();
    fireEvent.change(replacement, { target: { value: 'lowPass' } });
    expect(props.onReplaceEffect).not.toHaveBeenCalled();
    finish();
    await waitFor(() => expect(replacement).toBeEnabled());
  });
  it('locks add, bypass, and remove while another chain mutation is saving', async () => {
    let finish!: () => void;
    const onMoveEffect = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const props = renderPanel({ onMoveEffect });
    fireEvent.click(screen.getByRole('button', { name: '下移增益' }));

    const add = screen.getByRole('button', { name: '添加效果' });
    const bypass = screen.getByRole('button', { name: '旁路增益' });
    const remove = screen.getByRole('button', { name: '移除增益' });
    expect(add).toBeDisabled();
    expect(bypass).toBeDisabled();
    expect(remove).toBeDisabled();
    fireEvent.click(add);
    fireEvent.click(bypass);
    fireEvent.click(remove);
    expect(props.onAddEffect).not.toHaveBeenCalled();
    expect(props.onToggleBypass).not.toHaveBeenCalled();
    expect(props.onRemoveEffect).not.toHaveBeenCalled();

    finish();
    await waitFor(() => expect(add).toBeEnabled());
  });

  it('prevents duplicate add commands while the first add is saving', async () => {
    let finish!: () => void;
    const onAddEffect = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    renderPanel({ onAddEffect });
    fireEvent.click(screen.getByRole('button', { name: '添加效果' }));
    fireEvent.click(screen.getByRole('button', { name: '增益' }));

    const lowPass = screen.getByRole('button', { name: '低通滤波' });
    expect(lowPass).toBeDisabled();
    fireEvent.click(lowPass);
    expect(onAddEffect).toHaveBeenCalledTimes(1);
    expect(onAddEffect).toHaveBeenCalledWith('gain');

    finish();
    await waitFor(() => expect(screen.queryByText('选择效果类型')).not.toBeInTheDocument());
  });
});

describe('EffectPanel Audacity reorder controls', () => {
  it('consumes boundary arrow keys without no-op moves or page scrolling', () => {
    const props = renderPanel();
    const firstGrip = screen.getByRole('button', { name: '拖动排序增益' });
    const lastGrip = screen.getByRole('button', { name: '拖动排序混响' });

    expect(fireEvent.keyDown(firstGrip, { key: 'ArrowUp' })).toBe(false);
    expect(fireEvent.keyDown(lastGrip, { key: 'ArrowDown' })).toBe(false);
    expect(props.onMoveEffect).not.toHaveBeenCalled();
    expect(fireEvent.keyDown(firstGrip, { key: 'ArrowLeft' })).toBe(true);
  });

  it('moves effects with accessible up/down commands and disables list boundaries', async () => {
    const props = renderPanel();
    expect(screen.getByRole('button', { name: '上移增益' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '下移混响' })).toBeDisabled();

    const down = screen.getByRole('button', { name: '下移增益' });
    fireEvent.click(down);
    expect(props.onMoveEffect).toHaveBeenCalledWith('fx-gain', 1);
    await waitFor(() => expect(down).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '上移混响' }));
    expect(props.onMoveEffect).toHaveBeenCalledWith('fx-reverb', 1);
    await waitFor(() => expect(screen.getByRole('button', { name: '上移混响' })).toBeEnabled());
  });

  it('locks stale-index commands while an asynchronous move is being saved', async () => {
    let finish!: () => void;
    const onMoveEffect = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    renderPanel({ onMoveEffect });
    const down = screen.getByRole('button', { name: '下移增益' });
    fireEvent.click(down);
    expect(down).toBeDisabled();
    expect(screen.getByRole('button', { name: '拖动排序增益' })).toBeDisabled();
    fireEvent.click(down);
    fireEvent.keyDown(screen.getByRole('button', { name: '拖动排序增益' }), { key: 'ArrowDown' });
    expect(onMoveEffect).toHaveBeenCalledTimes(1);

    finish();
    await waitFor(() => expect(down).toBeEnabled());
  });

  it('supports native grip drag and keyboard reordering', async () => {
    const props = renderPanel();
    const grip = screen.getByRole('button', { name: '拖动排序增益' });
    fireEvent.keyDown(grip, { key: 'ArrowDown' });
    expect(props.onMoveEffect).toHaveBeenCalledWith('fx-gain', 1);
    await waitFor(() => expect(grip).toBeEnabled());

    const dataTransfer = { effectAllowed: '', dropEffect: '', setData: vi.fn(), getData: vi.fn(() => 'fx-gain') };
    fireEvent.dragStart(grip, { dataTransfer });
    fireEvent.dragOver(screen.getByTestId('realtime-effect-fx-reverb'), { dataTransfer });
    fireEvent.drop(screen.getByTestId('realtime-effect-fx-reverb'), { dataTransfer });
    expect(dataTransfer.setData).toHaveBeenCalledWith('application/x-audacity-effect-id', 'fx-gain');
    expect(props.onMoveEffect).toHaveBeenCalledWith('fx-gain', 2);
    await waitFor(() => expect(grip).toBeEnabled());
  });

  it('ignores no-op and stale drop commits before entering the asynchronous mutation lock', () => {
    const props = renderPanel();
    const ownRow = screen.getByTestId('realtime-effect-fx-gain');
    const dataTransfer = {
      effectAllowed: '',
      dropEffect: '',
      setData: vi.fn(),
      getData: vi.fn(() => 'fx-gain'),
    };

    fireEvent.drop(ownRow, { dataTransfer });
    expect(props.onMoveEffect).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '拖动排序增益' })).toBeEnabled();

    dataTransfer.getData.mockReturnValue('missing-effect');
    fireEvent.drop(ownRow, { dataTransfer });
    expect(props.onMoveEffect).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '拖动排序增益' })).toBeEnabled();
  });

  it('restores grip focus at the target index after an asynchronous keyboard reorder', async () => {
    let finish!: () => void;
    const onMoveEffect = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const props = {
      track,
      onClose: vi.fn(), onAddEffect: vi.fn(), onUpdateEffect: vi.fn(),
      onToggleBypass: vi.fn(), onToggleAllEffects: vi.fn(), onRemoveEffect: vi.fn(), onMoveEffect,
      onReplaceEffect: vi.fn(),
    };
    const view = render(<EffectPanel {...props} />);
    const grip = screen.getByRole('button', { name: '拖动排序增益' });
    grip.focus();
    fireEvent.keyDown(grip, { key: 'ArrowDown' });
    expect(onMoveEffect).toHaveBeenCalledWith('fx-gain', 1);

    view.rerender(<EffectPanel
      {...props}
      track={{ ...track, effects: [track.effects[1]!, track.effects[0]!, track.effects[2]!] }}
    />);
    // Chromium can drop focus when the active grip becomes disabled during saving.
    screen.getByRole('button', { name: '拖动排序增益' }).blur();
    finish();

    await waitFor(() => expect(screen.getByRole('button', { name: '拖动排序增益' })).toHaveFocus());
  });

  it('restores grip focus and unlocks when an asynchronous keyboard reorder rejects', async () => {
    let fail!: () => void;
    const onMoveEffect = vi.fn(() => new Promise<void>((_resolve, reject) => {
      fail = () => reject(new Error('keyboard reorder save failed'));
    }));
    renderPanel({ onMoveEffect });
    const grip = screen.getByRole('button', { name: '拖动排序增益' });
    grip.focus();
    fireEvent.keyDown(grip, { key: 'ArrowDown' });
    expect(onMoveEffect).toHaveBeenCalledWith('fx-gain', 1);
    expect(grip).toBeDisabled();

    act(() => {
      document.body.tabIndex = -1;
      document.body.focus();
    });
    await act(async () => { fail(); });

    await waitFor(() => expect(grip).toHaveFocus());
    expect(grip).toBeEnabled();
    expect(onMoveEffect).toHaveBeenCalledTimes(1);
  });

  it('restores effect-row focus after an asynchronous arrow-button reorder', async () => {
    let finish!: () => void;
    const onMoveEffect = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const props = {
      track,
      onClose: vi.fn(), onAddEffect: vi.fn(), onUpdateEffect: vi.fn(),
      onToggleBypass: vi.fn(), onToggleAllEffects: vi.fn(), onRemoveEffect: vi.fn(), onMoveEffect,
      onReplaceEffect: vi.fn(),
    };
    const view = render(<EffectPanel {...props} />);
    const down = screen.getByRole('button', { name: '下移增益' });
    down.focus();
    fireEvent.click(down);
    expect(onMoveEffect).toHaveBeenCalledWith('fx-gain', 1);

    view.rerender(<EffectPanel
      {...props}
      track={{ ...track, effects: [track.effects[1]!, track.effects[0]!, track.effects[2]!] }}
    />);
    // Chromium drops focus when the activated command becomes disabled during saving.
    screen.getByRole('button', { name: '下移增益' }).blur();
    finish();

    await waitFor(() => expect(screen.getByRole('button', { name: '打开增益参数' })).toHaveFocus());
  });

  it('restores effect-row focus and unlocks when an asynchronous button reorder rejects', async () => {
    let fail!: () => void;
    const onMoveEffect = vi.fn(() => new Promise<void>((_resolve, reject) => {
      fail = () => reject(new Error('button reorder save failed'));
    }));
    renderPanel({ onMoveEffect });
    const down = screen.getByRole('button', { name: '下移增益' });
    down.focus();
    fireEvent.click(down);
    expect(onMoveEffect).toHaveBeenCalledWith('fx-gain', 1);
    expect(down).toBeDisabled();

    act(() => {
      document.body.tabIndex = -1;
      document.body.focus();
    });
    await act(async () => { fail(); });

    await waitFor(() => expect(screen.getByRole('button', { name: '打开增益参数' })).toHaveFocus());
    expect(down).toBeEnabled();
    expect(onMoveEffect).toHaveBeenCalledTimes(1);
  });

  it('discards pending effect-row focus when an asynchronous reorder finishes on another track', async () => {
    let finish!: () => void;
    const onMoveEffect = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const props = {
      track,
      onClose: vi.fn(), onAddEffect: vi.fn(), onUpdateEffect: vi.fn(),
      onToggleBypass: vi.fn(), onToggleAllEffects: vi.fn(), onRemoveEffect: vi.fn(), onMoveEffect,
      onReplaceEffect: vi.fn(),
    };
    const otherTrack: ITrack = {
      ...track,
      id: 'track-b',
      name: 'Track B',
      effects: [
        { id: 'fx-low-pass-b', type: 'lowPass', bypassed: false, params: { frequency: 6400, q: 0.707 } },
      ],
    };
    const view = render(<EffectPanel {...props} />);
    const down = screen.getByRole('button', { name: '下移增益' });
    down.focus();
    fireEvent.click(down);
    expect(onMoveEffect).toHaveBeenCalledWith('fx-gain', 1);

    view.rerender(<EffectPanel {...props} track={otherTrack} />);
    act(() => {
      document.body.tabIndex = -1;
      document.body.focus();
    });
    await act(async () => { finish(); });
    await waitFor(() => expect(screen.getByRole('button', { name: '添加效果' })).toBeEnabled());
    expect(document.body).toHaveFocus();

    view.rerender(<EffectPanel
      {...props}
      track={{ ...track, effects: [track.effects[1]!, track.effects[0]!, track.effects[2]!] }}
    />);

    expect(document.body).toHaveFocus();
  });

  it('discards pending grip focus when an asynchronous keyboard reorder rejects on another track', async () => {
    let fail!: () => void;
    const onMoveEffect = vi.fn(() => new Promise<void>((_resolve, reject) => {
      fail = () => reject(new Error('cross-track keyboard reorder save failed'));
    }));
    const props = {
      track,
      onClose: vi.fn(), onAddEffect: vi.fn(), onUpdateEffect: vi.fn(),
      onToggleBypass: vi.fn(), onToggleAllEffects: vi.fn(), onRemoveEffect: vi.fn(), onMoveEffect,
      onReplaceEffect: vi.fn(),
    };
    const otherTrack: ITrack = {
      ...track,
      id: 'track-b',
      name: 'Track B',
      effects: [
        { id: 'fx-gain', type: 'lowPass', bypassed: false, params: { frequency: 6400, q: 0.707 } },
      ],
    };
    const view = render(<EffectPanel {...props} />);
    const grip = screen.getByRole('button', { name: '拖动排序增益' });
    grip.focus();
    fireEvent.keyDown(grip, { key: 'ArrowDown' });
    expect(onMoveEffect).toHaveBeenCalledWith('fx-gain', 1);

    view.rerender(<EffectPanel {...props} track={otherTrack} />);
    const otherTrackGrip = screen.getByRole('button', { name: '拖动排序低通滤波' });
    act(() => {
      document.body.tabIndex = -1;
      document.body.focus();
    });
    await act(async () => { fail(); });

    await waitFor(() => expect(otherTrackGrip).toBeEnabled());
    expect(document.body).toHaveFocus();

    view.rerender(<EffectPanel {...props} track={track} />);
    expect(document.body).toHaveFocus();
  });

  it('discards pending grip focus when an asynchronous keyboard reorder succeeds on another track', async () => {
    let finish!: () => void;
    const onMoveEffect = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const props = {
      track,
      onClose: vi.fn(), onAddEffect: vi.fn(), onUpdateEffect: vi.fn(),
      onToggleBypass: vi.fn(), onToggleAllEffects: vi.fn(), onRemoveEffect: vi.fn(), onMoveEffect,
      onReplaceEffect: vi.fn(),
    };
    const otherTrack: ITrack = {
      ...track,
      id: 'track-b',
      name: 'Track B',
      effects: [
        { id: 'fx-gain', type: 'lowPass', bypassed: false, params: { frequency: 6400, q: 0.707 } },
      ],
    };
    const view = render(<EffectPanel {...props} />);
    const grip = screen.getByRole('button', { name: '拖动排序增益' });
    grip.focus();
    fireEvent.keyDown(grip, { key: 'ArrowDown' });
    expect(onMoveEffect).toHaveBeenCalledWith('fx-gain', 1);

    view.rerender(<EffectPanel {...props} track={otherTrack} />);
    const otherTrackGrip = screen.getByRole('button', { name: '拖动排序低通滤波' });
    act(() => {
      document.body.tabIndex = -1;
      document.body.focus();
    });
    await act(async () => { finish(); });

    await waitFor(() => expect(otherTrackGrip).toBeEnabled());
    expect(otherTrackGrip).not.toHaveFocus();
    expect(document.body).toHaveFocus();

    view.rerender(<EffectPanel
      {...props}
      track={{ ...track, effects: [track.effects[1]!, track.effects[0]!, track.effects[2]!] }}
    />);
    expect(document.body).toHaveFocus();
  });

  it('discards pending effect-row focus when an asynchronous button reorder succeeds on another track with the same effect id', async () => {
    let finish!: () => void;
    const onMoveEffect = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const props = {
      track,
      onClose: vi.fn(), onAddEffect: vi.fn(), onUpdateEffect: vi.fn(),
      onToggleBypass: vi.fn(), onToggleAllEffects: vi.fn(), onRemoveEffect: vi.fn(), onMoveEffect,
      onReplaceEffect: vi.fn(),
    };
    const otherTrack: ITrack = {
      ...track,
      id: 'track-b',
      name: 'Track B',
      effects: [
        { id: 'fx-gain', type: 'lowPass', bypassed: false, params: { frequency: 6400, q: 0.707 } },
      ],
    };
    const view = render(<EffectPanel {...props} />);
    const down = screen.getByRole('button', { name: '下移增益' });
    down.focus();
    fireEvent.click(down);
    expect(onMoveEffect).toHaveBeenCalledWith('fx-gain', 1);

    view.rerender(<EffectPanel {...props} track={otherTrack} />);
    const otherTrackEffect = screen.getByRole('button', { name: '打开低通滤波参数' });
    act(() => {
      document.body.tabIndex = -1;
      document.body.focus();
    });
    await act(async () => { finish(); });

    await waitFor(() => expect(screen.getByRole('button', { name: '添加效果' })).toBeEnabled());
    expect(otherTrackEffect).not.toHaveFocus();
    expect(document.body).toHaveFocus();

    view.rerender(<EffectPanel
      {...props}
      track={{ ...track, effects: [track.effects[1]!, track.effects[0]!, track.effects[2]!] }}
    />);
    expect(document.body).toHaveFocus();
  });

  it('discards pending effect-row focus when an asynchronous native drag reorder succeeds on another track with the same effect id', async () => {
    let finish!: () => void;
    const onMoveEffect = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const props = {
      track,
      onClose: vi.fn(), onAddEffect: vi.fn(), onUpdateEffect: vi.fn(),
      onToggleBypass: vi.fn(), onToggleAllEffects: vi.fn(), onRemoveEffect: vi.fn(), onMoveEffect,
      onReplaceEffect: vi.fn(),
    };
    const otherTrack: ITrack = {
      ...track,
      id: 'track-b',
      name: 'Track B',
      effects: [
        { id: 'fx-gain', type: 'lowPass', bypassed: false, params: { frequency: 6400, q: 0.707 } },
      ],
    };
    const view = render(<EffectPanel {...props} />);
    const grip = screen.getByRole('button', { name: '拖动排序增益' });
    const dataTransfer = {
      effectAllowed: '', dropEffect: '', setData: vi.fn(), getData: vi.fn(() => 'fx-gain'),
    };
    grip.focus();
    fireEvent.dragStart(grip, { dataTransfer });
    fireEvent.drop(screen.getByTestId('realtime-effect-fx-reverb'), { dataTransfer });
    expect(onMoveEffect).toHaveBeenCalledWith('fx-gain', 2);

    view.rerender(<EffectPanel {...props} track={otherTrack} />);
    const otherTrackEffect = screen.getByRole('button', { name: '打开低通滤波参数' });
    act(() => {
      document.body.tabIndex = -1;
      document.body.focus();
    });
    await act(async () => { finish(); });

    await waitFor(() => expect(screen.getByRole('button', { name: '添加效果' })).toBeEnabled());
    expect(otherTrackEffect).not.toHaveFocus();
    expect(document.body).toHaveFocus();

    view.rerender(<EffectPanel
      {...props}
      track={{ ...track, effects: [track.effects[1]!, track.effects[2]!, track.effects[0]!] }}
    />);
    expect(document.body).toHaveFocus();
  });

  it('restores effect-row focus and unlocks when an asynchronous native drag reorder rejects', async () => {
    let fail!: () => void;
    const onMoveEffect = vi.fn(() => new Promise<void>((_resolve, reject) => {
      fail = () => reject(new Error('native drag reorder save failed'));
    }));
    renderPanel({ onMoveEffect });
    const grip = screen.getByRole('button', { name: '拖动排序增益' });
    const dataTransfer = {
      effectAllowed: '', dropEffect: '', setData: vi.fn(), getData: vi.fn(() => 'fx-gain'),
    };
    grip.focus();
    fireEvent.dragStart(grip, { dataTransfer });
    fireEvent.drop(screen.getByTestId('realtime-effect-fx-reverb'), { dataTransfer });
    expect(onMoveEffect).toHaveBeenCalledWith('fx-gain', 2);
    expect(grip).toBeDisabled();

    act(() => {
      document.body.tabIndex = -1;
      document.body.focus();
    });
    await act(async () => { fail(); });

    await waitFor(() => expect(screen.getByRole('button', { name: '打开增益参数' })).toHaveFocus());
    expect(grip).toBeEnabled();
    expect(onMoveEffect).toHaveBeenCalledTimes(1);
  });

  it('restores effect-row focus after an asynchronous native drag reorder', async () => {
    let finish!: () => void;
    const onMoveEffect = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const props = {
      track,
      onClose: vi.fn(), onAddEffect: vi.fn(), onUpdateEffect: vi.fn(),
      onToggleBypass: vi.fn(), onToggleAllEffects: vi.fn(), onRemoveEffect: vi.fn(), onMoveEffect,
      onReplaceEffect: vi.fn(),
    };
    const view = render(<EffectPanel {...props} />);
    const grip = screen.getByRole('button', { name: '拖动排序增益' });
    const dataTransfer = {
      effectAllowed: '', dropEffect: '', setData: vi.fn(), getData: vi.fn(() => 'fx-gain'),
    };
    grip.focus();
    fireEvent.dragStart(grip, { dataTransfer });
    fireEvent.drop(screen.getByTestId('realtime-effect-fx-reverb'), { dataTransfer });
    expect(onMoveEffect).toHaveBeenCalledWith('fx-gain', 2);

    view.rerender(<EffectPanel
      {...props}
      track={{ ...track, effects: [track.effects[1]!, track.effects[2]!, track.effects[0]!] }}
    />);
    screen.getByRole('button', { name: '拖动排序增益' }).blur();
    finish();

    await waitFor(() => expect(screen.getByRole('button', { name: '打开增益参数' })).toHaveFocus());
  });

  it('cancels stale grip focus after the user explicitly selects another effect', async () => {
    let finish!: () => void;
    const onMoveEffect = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const props = {
      track,
      onClose: vi.fn(), onAddEffect: vi.fn(), onUpdateEffect: vi.fn(),
      onToggleBypass: vi.fn(), onToggleAllEffects: vi.fn(), onRemoveEffect: vi.fn(), onMoveEffect,
      onReplaceEffect: vi.fn(),
    };
    const view = render(<EffectPanel {...props} />);
    const grip = screen.getByRole('button', { name: '拖动排序增益' });
    grip.focus();
    fireEvent.keyDown(grip, { key: 'ArrowDown' });
    expect(onMoveEffect).toHaveBeenCalledWith('fx-gain', 1);

    view.rerender(<EffectPanel
      {...props}
      track={{ ...track, effects: [track.effects[1]!, track.effects[0]!, track.effects[2]!] }}
    />);
    const reverb = screen.getByRole('button', { name: '打开混响参数' });
    reverb.focus();
    fireEvent.click(reverb);
    expect(reverb).toHaveFocus();

    await act(async () => { finish(); });

    await waitFor(() => expect(screen.getByRole('button', { name: '拖动排序增益' })).toBeEnabled());
    expect(reverb).toHaveFocus();
  });

  it('cancels stale effect-row focus after the user explicitly selects another effect', async () => {
    let finish!: () => void;
    const onMoveEffect = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const props = {
      track,
      onClose: vi.fn(), onAddEffect: vi.fn(), onUpdateEffect: vi.fn(),
      onToggleBypass: vi.fn(), onToggleAllEffects: vi.fn(), onRemoveEffect: vi.fn(), onMoveEffect,
      onReplaceEffect: vi.fn(),
    };
    const view = render(<EffectPanel {...props} />);
    fireEvent.click(screen.getByRole('button', { name: '下移增益' }));
    expect(onMoveEffect).toHaveBeenCalledWith('fx-gain', 1);

    view.rerender(<EffectPanel
      {...props}
      track={{ ...track, effects: [track.effects[1]!, track.effects[0]!, track.effects[2]!] }}
    />);
    const reverb = screen.getByRole('button', { name: '打开混响参数' });
    reverb.focus();
    fireEvent.click(reverb);
    expect(reverb).toHaveFocus();

    await act(async () => { finish(); });

    await waitFor(() => expect(screen.getByRole('button', { name: '下移增益' })).toBeEnabled());
    expect(reverb).toHaveFocus();
  });
});

describe('EffectPanel realtime effect removal focus', () => {
  it('focuses the effect now at the removed index after an asynchronous remove-button command', async () => {
    let finish!: () => void;
    const onRemoveEffect = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const props = {
      track,
      onClose: vi.fn(), onAddEffect: vi.fn(), onUpdateEffect: vi.fn(),
      onToggleBypass: vi.fn(), onToggleAllEffects: vi.fn(), onRemoveEffect, onMoveEffect: vi.fn(),
      onReplaceEffect: vi.fn(),
    };
    const view = render(<EffectPanel {...props} />);
    const remove = screen.getByRole('button', { name: '移除高通滤波' });
    await act(async () => {
      remove.focus();
      await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
    });
    fireEvent.click(remove);
    expect(onRemoveEffect).toHaveBeenCalledWith('fx-high-pass');

    view.rerender(<EffectPanel
      {...props}
      track={{ ...track, effects: [track.effects[0]!, track.effects[2]!] }}
    />);
    await act(async () => { finish(); });

    await waitFor(() => expect(screen.getByRole('button', { name: '打开混响参数' })).toHaveFocus());
  });

  it('returns focus to Add effect after the replacement menu removes the only effect', async () => {
    let finish!: () => void;
    const onRemoveEffect = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const singleEffectTrack = { ...track, effects: [track.effects[0]!] };
    const props = {
      track: singleEffectTrack,
      onClose: vi.fn(), onAddEffect: vi.fn(), onUpdateEffect: vi.fn(),
      onToggleBypass: vi.fn(), onToggleAllEffects: vi.fn(), onRemoveEffect, onMoveEffect: vi.fn(),
      onReplaceEffect: vi.fn(),
    };
    const view = render(<EffectPanel {...props} />);
    const menu = screen.getByRole('combobox', { name: '替换增益' });
    menu.focus();
    fireEvent.change(menu, { target: { value: '__remove__' } });
    expect(onRemoveEffect).toHaveBeenCalledWith('fx-gain');

    view.rerender(<EffectPanel {...props} track={{ ...singleEffectTrack, effects: [] }} />);
    await act(async () => { finish(); });

    await waitFor(() => expect(screen.getByRole('button', { name: '添加效果' })).toHaveFocus());
  });

  it('falls back to the previous effect when the asynchronous command removes the last effect', async () => {
    let finish!: () => void;
    const onRemoveEffect = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const props = {
      track,
      onClose: vi.fn(), onAddEffect: vi.fn(), onUpdateEffect: vi.fn(),
      onToggleBypass: vi.fn(), onToggleAllEffects: vi.fn(), onRemoveEffect, onMoveEffect: vi.fn(),
      onReplaceEffect: vi.fn(),
    };
    const view = render(<EffectPanel {...props} />);
    const remove = screen.getByRole('button', { name: '移除混响' });
    await act(async () => {
      remove.focus();
      await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
    });
    fireEvent.click(remove);
    expect(onRemoveEffect).toHaveBeenCalledWith('fx-reverb');

    view.rerender(<EffectPanel
      {...props}
      track={{ ...track, effects: [track.effects[0]!, track.effects[1]!] }}
    />);
    await act(async () => { finish(); });

    await waitFor(() => expect(screen.getByRole('button', { name: '打开高通滤波参数' })).toHaveFocus());
  });

  it('restores the original effect-row focus when the remove command completes without a commit', async () => {
    let finish!: () => void;
    const onRemoveEffect = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const props = renderPanel({ onRemoveEffect });
    const menu = screen.getByRole('combobox', { name: '替换增益' });
    menu.focus();
    fireEvent.change(menu, { target: { value: '__remove__' } });
    expect(props.onRemoveEffect).toHaveBeenCalledWith('fx-gain');
    menu.blur();

    await act(async () => { finish(); });

    await waitFor(() => expect(screen.getByRole('button', { name: '打开增益参数' })).toHaveFocus());
    expect(menu).toBeEnabled();
  });

  it('restores the original effect-row focus and unlocks when the asynchronous remove rejects', async () => {
    let fail!: () => void;
    const onRemoveEffect = vi.fn(() => new Promise<void>((_resolve, reject) => {
      fail = () => reject(new Error('remove save failed'));
    }));
    renderPanel({ onRemoveEffect });
    const remove = screen.getByRole('button', { name: '移除增益' });
    await act(async () => {
      remove.focus();
      await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
    });
    fireEvent.click(remove);
    expect(onRemoveEffect).toHaveBeenCalledWith('fx-gain');
    expect(remove).toBeDisabled();

    act(() => {
      document.body.tabIndex = -1;
      document.body.focus();
    });
    await act(async () => { fail(); });

    await waitFor(() => expect(screen.getByRole('button', { name: '打开增益参数' })).toHaveFocus());
    expect(remove).toBeEnabled();
    expect(onRemoveEffect).toHaveBeenCalledTimes(1);
  });

  it('cancels stale removal focus after the user explicitly selects another effect', async () => {
    let finish!: () => void;
    const onRemoveEffect = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const props = {
      track,
      onClose: vi.fn(), onAddEffect: vi.fn(), onUpdateEffect: vi.fn(),
      onToggleBypass: vi.fn(), onToggleAllEffects: vi.fn(), onRemoveEffect, onMoveEffect: vi.fn(),
      onReplaceEffect: vi.fn(),
    };
    const view = render(<EffectPanel {...props} />);
    const remove = screen.getByRole('button', { name: '移除增益' });
    await act(async () => {
      remove.focus();
      await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
    });
    fireEvent.click(remove);
    expect(onRemoveEffect).toHaveBeenCalledWith('fx-gain');

    // The store commits the removal before the mutation promise releases the UI lock.
    view.rerender(<EffectPanel
      {...props}
      track={{ ...track, effects: [track.effects[1]!, track.effects[2]!] }}
    />);
    const reverb = screen.getByRole('button', { name: '打开混响参数' });
    reverb.focus();
    fireEvent.click(reverb);
    expect(reverb).toHaveFocus();

    await act(async () => { finish(); });
    await waitFor(() => expect(screen.getByRole('button', { name: '添加效果' })).toBeEnabled());

    // The newer explicit selection supersedes the old remove-operation focus request.
    expect(reverb).toHaveFocus();
    expect(screen.getByRole('button', { name: '打开高通滤波参数' })).not.toHaveFocus();
  });

  it('discards removal focus when an external reorder keeps the pending target', async () => {
    let finish!: () => void;
    const onRemoveEffect = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const props = {
      track,
      onClose: vi.fn(), onAddEffect: vi.fn(), onUpdateEffect: vi.fn(),
      onToggleBypass: vi.fn(), onToggleAllEffects: vi.fn(), onRemoveEffect, onMoveEffect: vi.fn(),
      onReplaceEffect: vi.fn(),
    };
    const view = render(<EffectPanel {...props} />);
    const remove = screen.getByRole('button', { name: '移除增益' });
    await act(async () => {
      remove.focus();
      await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
    });
    fireEvent.click(remove);
    expect(onRemoveEffect).toHaveBeenCalledWith('fx-gain');

    // Undo/redo or another tab can replace the chain without performing this removal.
    view.rerender(<EffectPanel
      {...props}
      track={{ ...track, effects: [track.effects[1]!, track.effects[0]!, track.effects[2]!] }}
    />);
    const highPass = screen.getByRole('button', { name: '打开高通滤波参数' });
    highPass.focus();
    await act(async () => { finish(); });

    expect(highPass).toHaveFocus();
    expect(screen.getByRole('button', { name: '打开增益参数' })).not.toHaveFocus();
  });

  it('discards removal focus when an external replacement also changes another effect', async () => {
    let finish!: () => void;
    const onRemoveEffect = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const props = {
      track,
      onClose: vi.fn(), onAddEffect: vi.fn(), onUpdateEffect: vi.fn(),
      onToggleBypass: vi.fn(), onToggleAllEffects: vi.fn(), onRemoveEffect, onMoveEffect: vi.fn(),
      onReplaceEffect: vi.fn(),
    };
    const view = render(<EffectPanel {...props} />);
    const remove = screen.getByRole('button', { name: '移除高通滤波' });
    await act(async () => {
      remove.focus();
      await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
    });
    fireEvent.click(remove);
    expect(onRemoveEffect).toHaveBeenCalledWith('fx-high-pass');

    const lowPass = {
      id: 'fx-low-pass-external', type: 'lowPass' as const, bypassed: false,
      params: { frequency: 6400, q: 0.707 },
    };
    view.rerender(<EffectPanel
      {...props}
      track={{ ...track, effects: [track.effects[0]!, lowPass, track.effects[2]!] }}
    />);
    const gain = screen.getByRole('button', { name: '打开增益参数' });
    gain.focus();
    await act(async () => { finish(); });

    expect(gain).toHaveFocus();
    expect(screen.getByRole('button', { name: '打开低通滤波参数' })).not.toHaveFocus();
  });

  it.each([
    { kind: 'ABA reorder', shouldReject: false, outcome: 'resolves' },
    { kind: 'ABA reorder', shouldReject: true, outcome: 'rejects' },
    { kind: 'parameter-only update', shouldReject: false, outcome: 'resolves' },
    { kind: 'parameter-only update', shouldReject: true, outcome: 'rejects' },
    { kind: 'bypass-only update', shouldReject: false, outcome: 'resolves' },
    { kind: 'bypass-only update', shouldReject: true, outcome: 'rejects' },
  ])('discards removal focus after an external $kind when the command $outcome', async ({ kind, shouldReject }) => {
    let settle!: () => void;
    const onRemoveEffect = vi.fn(() => new Promise<void>((resolve, reject) => {
      settle = () => {
        if (shouldReject) reject(new Error('remove save failed after external chain update'));
        else resolve();
      };
    }));
    const props = {
      track,
      onClose: vi.fn(), onAddEffect: vi.fn(), onUpdateEffect: vi.fn(),
      onToggleBypass: vi.fn(), onToggleAllEffects: vi.fn(), onRemoveEffect, onMoveEffect: vi.fn(),
      onReplaceEffect: vi.fn(),
    };
    const view = render(<EffectPanel {...props} />);
    const remove = screen.getByRole('button', { name: '移除增益' });
    await act(async () => {
      remove.focus();
      await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
    });
    fireEvent.click(remove);
    expect(onRemoveEffect).toHaveBeenCalledWith('fx-gain');

    const externallyUpdatedTrack: ITrack = kind === 'parameter-only update'
      ? {
          ...track,
          effects: track.effects.map((effect) => effect.id === 'fx-gain'
            ? { ...effect, params: { ...effect.params, gain: 3 } }
            : effect),
        }
      : kind === 'bypass-only update'
        ? {
            ...track,
            effects: track.effects.map((effect) => effect.id === 'fx-high-pass'
              ? { ...effect, bypassed: true }
              : effect),
          }
        : { ...track, effects: [track.effects[1]!, track.effects[0]!, track.effects[2]!] };
    view.rerender(<EffectPanel {...props} track={externallyUpdatedTrack} />);
    if (kind === 'ABA reorder') {
      // The final ID list is identical to the original, but two external revisions occurred.
      view.rerender(<EffectPanel
        {...props}
        track={{ ...track, effects: track.effects.map((effect) => ({ ...effect })) }}
      />);
    }
    act(() => {
      document.body.tabIndex = -1;
      document.body.focus();
    });
    await act(async () => { settle(); });

    await waitFor(() => expect(screen.getByRole('button', { name: '添加效果' })).toBeEnabled());
    expect(document.body).toHaveFocus();
    expect(screen.getByRole('button', { name: '打开增益参数' })).not.toHaveFocus();
    expect(onRemoveEffect).toHaveBeenCalledTimes(1);
  });
});

describe('EffectPanel focus after an external chain update', () => {
  const externallyReorderedTrack: ITrack = {
    ...track,
    effects: [track.effects[2]!, track.effects[0]!, track.effects[1]!],
  };

  it.each([
    { outcome: 'resolves', shouldReject: false },
    { outcome: 'rejects', shouldReject: true },
  ])('discards reorder focus after an external chain update when the keyboard command $outcome', async ({ shouldReject }) => {
    let settle!: () => void;
    const onMoveEffect = vi.fn(() => new Promise<void>((resolve, reject) => {
      settle = () => {
        if (shouldReject) reject(new Error('keyboard reorder failed after external chain update'));
        else resolve();
      };
    }));
    const props = {
      track,
      onClose: vi.fn(), onAddEffect: vi.fn(), onUpdateEffect: vi.fn(),
      onToggleBypass: vi.fn(), onToggleAllEffects: vi.fn(), onRemoveEffect: vi.fn(), onMoveEffect,
      onReplaceEffect: vi.fn(),
    };
    const view = render(<EffectPanel {...props} />);
    const grip = screen.getByRole('button', { name: '拖动排序增益' });
    grip.focus();
    fireEvent.keyDown(grip, { key: 'ArrowDown' });
    view.rerender(<EffectPanel {...props} track={externallyReorderedTrack} />);
    act(() => {
      document.body.tabIndex = -1;
      document.body.focus();
    });
    await act(async () => { settle(); });

    await waitFor(() => expect(screen.getByRole('button', { name: '添加效果' })).toBeEnabled());
    expect(document.body).toHaveFocus();
  });

  it.each([
    { outcome: 'resolves', shouldReject: false },
    { outcome: 'rejects', shouldReject: true },
  ])('discards reorder focus after an external chain update when the button command $outcome', async ({ shouldReject }) => {
    let settle!: () => void;
    const onMoveEffect = vi.fn(() => new Promise<void>((resolve, reject) => {
      settle = () => {
        if (shouldReject) reject(new Error('button reorder failed after external chain update'));
        else resolve();
      };
    }));
    const props = {
      track,
      onClose: vi.fn(), onAddEffect: vi.fn(), onUpdateEffect: vi.fn(),
      onToggleBypass: vi.fn(), onToggleAllEffects: vi.fn(), onRemoveEffect: vi.fn(), onMoveEffect,
      onReplaceEffect: vi.fn(),
    };
    const view = render(<EffectPanel {...props} />);
    fireEvent.click(screen.getByRole('button', { name: '下移增益' }));
    view.rerender(<EffectPanel {...props} track={externallyReorderedTrack} />);
    act(() => {
      document.body.tabIndex = -1;
      document.body.focus();
    });
    await act(async () => { settle(); });

    await waitFor(() => expect(screen.getByRole('button', { name: '添加效果' })).toBeEnabled());
    expect(document.body).toHaveFocus();
  });

  it.each([
    { outcome: 'resolves', shouldReject: false },
    { outcome: 'rejects', shouldReject: true },
  ])('discards reorder focus after an external chain update when the native drag command $outcome', async ({ shouldReject }) => {
    let settle!: () => void;
    const onMoveEffect = vi.fn(() => new Promise<void>((resolve, reject) => {
      settle = () => {
        if (shouldReject) reject(new Error('native drag failed after external chain update'));
        else resolve();
      };
    }));
    const props = {
      track,
      onClose: vi.fn(), onAddEffect: vi.fn(), onUpdateEffect: vi.fn(),
      onToggleBypass: vi.fn(), onToggleAllEffects: vi.fn(), onRemoveEffect: vi.fn(), onMoveEffect,
      onReplaceEffect: vi.fn(),
    };
    const view = render(<EffectPanel {...props} />);
    const grip = screen.getByRole('button', { name: '拖动排序增益' });
    const dataTransfer = {
      effectAllowed: '', dropEffect: '', setData: vi.fn(), getData: vi.fn(() => 'fx-gain'),
    };
    fireEvent.dragStart(grip, { dataTransfer });
    fireEvent.drop(screen.getByTestId('realtime-effect-fx-reverb'), { dataTransfer });
    view.rerender(<EffectPanel {...props} track={externallyReorderedTrack} />);
    act(() => {
      document.body.tabIndex = -1;
      document.body.focus();
    });
    await act(async () => { settle(); });

    await waitFor(() => expect(screen.getByRole('button', { name: '添加效果' })).toBeEnabled());
    expect(document.body).toHaveFocus();
  });

  it.each([
    { outcome: 'resolves', shouldReject: false },
    { outcome: 'rejects', shouldReject: true },
  ])('discards bypass focus after an external chain update when the toggle $outcome', async ({ shouldReject }) => {
    let settle!: () => void;
    const onToggleBypass = vi.fn(() => new Promise<void>((resolve, reject) => {
      settle = () => {
        if (shouldReject) reject(new Error('bypass failed after external chain update'));
        else resolve();
      };
    }));
    const props = {
      track,
      onClose: vi.fn(), onAddEffect: vi.fn(), onUpdateEffect: vi.fn(),
      onToggleBypass, onToggleAllEffects: vi.fn(), onRemoveEffect: vi.fn(), onMoveEffect: vi.fn(),
      onReplaceEffect: vi.fn(),
    };
    const view = render(<EffectPanel {...props} />);
    fireEvent.click(screen.getByRole('button', { name: '旁路高通滤波' }));
    view.rerender(<EffectPanel {...props} track={externallyReorderedTrack} />);
    act(() => {
      document.body.tabIndex = -1;
      document.body.focus();
    });
    await act(async () => { settle(); });

    await waitFor(() => expect(screen.getByRole('button', { name: '添加效果' })).toBeEnabled());
    expect(document.body).toHaveFocus();
  });

  it.each([
    { outcome: 'resolves', shouldReject: false },
    { outcome: 'rejects', shouldReject: true },
  ])('discards track-effects power focus after an external chain update when the toggle $outcome', async ({ shouldReject }) => {
    let settle!: () => void;
    const onToggleAllEffects = vi.fn(() => new Promise<void>((resolve, reject) => {
      settle = () => {
        if (shouldReject) reject(new Error('track effects failed after external chain update'));
        else resolve();
      };
    }));
    const props = {
      track,
      onClose: vi.fn(), onAddEffect: vi.fn(), onUpdateEffect: vi.fn(),
      onToggleBypass: vi.fn(), onToggleAllEffects, onRemoveEffect: vi.fn(), onMoveEffect: vi.fn(),
      onReplaceEffect: vi.fn(),
    };
    const view = render(<EffectPanel {...props} />);
    fireEvent.click(screen.getByRole('button', { name: '切换全部效果' }));
    view.rerender(<EffectPanel {...props} track={externallyReorderedTrack} />);
    act(() => {
      document.body.tabIndex = -1;
      document.body.focus();
    });
    await act(async () => { settle(); });

    await waitFor(() => expect(screen.getByRole('button', { name: '添加效果' })).toBeEnabled());
    expect(document.body).toHaveFocus();
  });
});

describe('EffectPanel focus consumption after an external chain update', () => {
  function makeProps(overrides: Partial<Parameters<typeof EffectPanel>[0]> = {}) {
    return {
      track,
      onClose: vi.fn(), onAddEffect: vi.fn(), onUpdateEffect: vi.fn(),
      onToggleBypass: vi.fn(), onToggleAllEffects: vi.fn(), onRemoveEffect: vi.fn(), onMoveEffect: vi.fn(),
      onReplaceEffect: vi.fn(),
      ...overrides,
    };
  }

  function focusBody() {
    act(() => {
      document.body.tabIndex = -1;
      document.body.focus();
    });
  }

  async function settleThenUpdateBeforeFocus(settle: () => void, update: () => void) {
    await act(async () => {
      settle();
      // Let the mutation continuation run its finally block and queue isMovingEffect=false.
      // The external render is then batched before React consumes the pending focus effect.
      await Promise.resolve();
      update();
    });
  }

  it.each([
    { command: 'keyboard', targetName: '拖动排序增益' },
    { command: 'button', targetName: '打开增益参数' },
  ])('discards $command reorder focus when an external update arrives after settlement but before focus consumption', async ({ command, targetName }) => {
    let finish!: () => void;
    const onMoveEffect = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const props = makeProps({ onMoveEffect });
    const view = render(<EffectPanel {...props} />);
    if (command === 'keyboard') {
      const grip = screen.getByRole('button', { name: '拖动排序增益' });
      grip.focus();
      fireEvent.keyDown(grip, { key: 'ArrowDown' });
    } else {
      fireEvent.click(screen.getByRole('button', { name: '下移增益' }));
    }
    expect(onMoveEffect).toHaveBeenCalledWith('fx-gain', 1);

    const committedTrack: ITrack = {
      ...track,
      effects: [track.effects[1]!, track.effects[0]!, track.effects[2]!],
    };
    view.rerender(<EffectPanel {...props} track={committedTrack} />);
    focusBody();
    await settleThenUpdateBeforeFocus(finish, () => {
      view.rerender(<EffectPanel
        {...props}
        track={{
          ...committedTrack,
          effects: [committedTrack.effects[2]!, committedTrack.effects[1]!, committedTrack.effects[0]!],
        }}
      />);
    });

    await waitFor(() => expect(screen.getByRole('button', { name: '添加效果' })).toBeEnabled());
    expect(document.body).toHaveFocus();
    expect(screen.getByRole('button', { name: targetName })).not.toHaveFocus();
  });

  it('discards bypass focus when an external reorder arrives after settlement but before focus consumption', async () => {
    let finish!: () => void;
    const onToggleBypass = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const props = makeProps({ onToggleBypass });
    const view = render(<EffectPanel {...props} />);
    fireEvent.click(screen.getByRole('button', { name: '旁路高通滤波' }));
    expect(onToggleBypass).toHaveBeenCalledWith('fx-high-pass');

    const committedTrack: ITrack = {
      ...track,
      effects: track.effects.map((effect) => effect.id === 'fx-high-pass'
        ? { ...effect, bypassed: true }
        : effect),
    };
    view.rerender(<EffectPanel {...props} track={committedTrack} />);
    focusBody();
    await settleThenUpdateBeforeFocus(finish, () => {
      view.rerender(<EffectPanel
        {...props}
        track={{
          ...committedTrack,
          effects: [committedTrack.effects[2]!, committedTrack.effects[0]!, committedTrack.effects[1]!],
        }}
      />);
    });

    await waitFor(() => expect(screen.getByRole('button', { name: '添加效果' })).toBeEnabled());
    expect(document.body).toHaveFocus();
    expect(screen.getByRole('button', { name: '启用高通滤波' })).not.toHaveFocus();
  });

  it('discards track-effects power focus when an external reorder arrives after settlement but before focus consumption', async () => {
    let finish!: () => void;
    const onToggleAllEffects = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const props = makeProps({ onToggleAllEffects });
    const view = render(<EffectPanel {...props} />);
    fireEvent.click(screen.getByRole('button', { name: '切换全部效果' }));
    expect(onToggleAllEffects).toHaveBeenCalledWith('track-a', false);

    const committedTrack = { ...track, effectsActive: false };
    view.rerender(<EffectPanel {...props} track={committedTrack} />);
    focusBody();
    await settleThenUpdateBeforeFocus(finish, () => {
      view.rerender(<EffectPanel
        {...props}
        track={{ ...committedTrack, effects: [track.effects[2]!, track.effects[0]!, track.effects[1]!] }}
      />);
    });

    await waitFor(() => expect(screen.getByRole('button', { name: '添加效果' })).toBeEnabled());
    expect(document.body).toHaveFocus();
    expect(screen.getByRole('button', { name: '切换全部效果' })).not.toHaveFocus();
  });

  it('discards removal focus when an external bypass update arrives after settlement but before focus consumption', async () => {
    let finish!: () => void;
    const onRemoveEffect = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const props = makeProps({ onRemoveEffect });
    const view = render(<EffectPanel {...props} />);
    fireEvent.click(screen.getByRole('button', { name: '移除增益' }));
    expect(onRemoveEffect).toHaveBeenCalledWith('fx-gain');

    const committedTrack: ITrack = { ...track, effects: [track.effects[1]!, track.effects[2]!] };
    view.rerender(<EffectPanel {...props} track={committedTrack} />);
    focusBody();
    await settleThenUpdateBeforeFocus(finish, () => {
      view.rerender(<EffectPanel
        {...props}
        track={{
          ...committedTrack,
          effects: committedTrack.effects.map((effect) => effect.id === 'fx-high-pass'
            ? { ...effect, bypassed: true }
            : effect),
        }}
      />);
    });

    await waitFor(() => expect(screen.getByRole('button', { name: '添加效果' })).toBeEnabled());
    expect(document.body).toHaveFocus();
    expect(screen.getByRole('button', { name: '打开高通滤波参数' })).not.toHaveFocus();
  });

  it('discards rejected removal focus when an external parameter update arrives after settlement but before focus consumption', async () => {
    let fail!: () => void;
    const onRemoveEffect = vi.fn(() => new Promise<void>((_resolve, reject) => {
      fail = () => reject(new Error('remove failed before an external parameter update'));
    }));
    const props = makeProps({ onRemoveEffect });
    const view = render(<EffectPanel {...props} />);
    fireEvent.click(screen.getByRole('button', { name: '移除增益' }));
    expect(onRemoveEffect).toHaveBeenCalledWith('fx-gain');
    focusBody();

    await settleThenUpdateBeforeFocus(fail, () => {
      view.rerender(<EffectPanel
        {...props}
        track={{
          ...track,
          effects: track.effects.map((effect) => effect.id === 'fx-reverb'
            ? { ...effect, params: { ...effect.params, mix: 45 } }
            : effect),
        }}
      />);
    });

    await waitFor(() => expect(screen.getByRole('button', { name: '添加效果' })).toBeEnabled());
    expect(document.body).toHaveFocus();
    expect(screen.getByRole('button', { name: '打开增益参数' })).not.toHaveFocus();
  });

  it.each([
    { command: 'reorder', targetName: '拖动排序增益' },
    { command: 'bypass', targetName: '启用高通滤波' },
  ])('discards $command focus when an external parameter-only update follows its own commit', async ({ command, targetName }) => {
    let finish!: () => void;
    const onMoveEffect = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const onToggleBypass = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const props = makeProps({ onMoveEffect, onToggleBypass });
    const view = render(<EffectPanel {...props} />);
    if (command === 'reorder') {
      const grip = screen.getByRole('button', { name: '拖动排序增益' });
      grip.focus();
      fireEvent.keyDown(grip, { key: 'ArrowDown' });
    } else {
      fireEvent.click(screen.getByRole('button', { name: '旁路高通滤波' }));
    }

    const committedTrack: ITrack = command === 'reorder'
      ? { ...track, effects: [track.effects[1]!, track.effects[0]!, track.effects[2]!] }
      : {
          ...track,
          effects: track.effects.map((effect) => effect.id === 'fx-high-pass'
            ? { ...effect, bypassed: true }
            : effect),
        };
    view.rerender(<EffectPanel {...props} track={committedTrack} />);
    focusBody();
    await settleThenUpdateBeforeFocus(finish, () => {
      view.rerender(<EffectPanel
        {...props}
        track={{
          ...committedTrack,
          effects: committedTrack.effects.map((effect) => effect.id === 'fx-reverb'
            ? { ...effect, params: { ...effect.params, mix: 45 } }
            : effect),
        }}
      />);
    });

    await waitFor(() => expect(screen.getByRole('button', { name: '添加效果' })).toBeEnabled());
    expect(document.body).toHaveFocus();
    expect(screen.getByRole('button', { name: targetName })).not.toHaveFocus();
  });

  it.each([
    { outcome: 'null', shouldReject: false },
    { outcome: 'rejection', shouldReject: true },
  ])('discards add-trigger focus when an external update follows an asynchronous $outcome result', async ({ shouldReject }) => {
    let settle!: () => void;
    const onAddEffect = vi.fn(() => new Promise<null>((resolve, reject) => {
      settle = () => {
        if (shouldReject) reject(new Error('add failed before an external update'));
        else resolve(null);
      };
    }));
    const props = makeProps({ onAddEffect });
    const view = render(<EffectPanel {...props} />);
    fireEvent.click(screen.getByRole('button', { name: '添加效果' }));
    fireEvent.click(screen.getByRole('button', { name: '低通滤波' }));
    focusBody();

    await settleThenUpdateBeforeFocus(settle, () => {
      view.rerender(<EffectPanel
        {...props}
        track={{ ...track, effects: [track.effects[1]!, track.effects[0]!, track.effects[2]!] }}
      />);
    });

    await waitFor(() => expect(screen.getByRole('button', { name: '添加效果' })).toBeEnabled());
    expect(document.body).toHaveFocus();
    expect(screen.getByRole('button', { name: '添加效果' })).not.toHaveFocus();
  });

  it.each([
    { outcome: 'null', shouldReject: false },
    { outcome: 'rejection', shouldReject: true },
  ])('discards replacement-row focus when an external update follows an asynchronous $outcome result', async ({ shouldReject }) => {
    let settle!: () => void;
    const onReplaceEffect = vi.fn(() => new Promise<null>((resolve, reject) => {
      settle = () => {
        if (shouldReject) reject(new Error('replacement failed before an external update'));
        else resolve(null);
      };
    }));
    const props = makeProps({ onReplaceEffect });
    const view = render(<EffectPanel {...props} />);
    fireEvent.change(screen.getByRole('combobox', { name: '替换高通滤波' }), { target: { value: 'lowPass' } });
    focusBody();

    await settleThenUpdateBeforeFocus(settle, () => {
      view.rerender(<EffectPanel
        {...props}
        track={{ ...track, effects: [track.effects[1]!, track.effects[0]!, track.effects[2]!] }}
      />);
    });

    await waitFor(() => expect(screen.getByRole('combobox', { name: '替换高通滤波' })).toBeEnabled());
    expect(document.body).toHaveFocus();
    expect(screen.getByRole('button', { name: '打开高通滤波参数' })).not.toHaveFocus();
  });

  it('discards a successful add selection and parameter focus when an external update follows settlement', async () => {
    const added = {
      id: 'fx-low-pass-late-external', type: 'lowPass' as const, bypassed: false,
      params: { frequency: 8000, q: 0.707 },
    };
    let finish!: () => void;
    const onAddEffect = vi.fn(() => new Promise<typeof added>((resolve) => { finish = () => resolve(added); }));
    const props = makeProps({ onAddEffect });
    const view = render(<EffectPanel {...props} />);
    fireEvent.click(screen.getByRole('button', { name: '添加效果' }));
    fireEvent.click(screen.getByRole('button', { name: '低通滤波' }));
    focusBody();
    const externallyReorderedTrack: ITrack = {
      ...track,
      effects: [track.effects[1]!, track.effects[0]!, track.effects[2]!],
    };

    await settleThenUpdateBeforeFocus(finish, () => {
      view.rerender(<EffectPanel {...props} track={externallyReorderedTrack} />);
    });
    view.rerender(<EffectPanel
      {...props}
      track={{ ...externallyReorderedTrack, effects: [...externallyReorderedTrack.effects, added] }}
    />);
    await act(async () => { await Promise.resolve(); });

    expect(screen.getByTestId(`realtime-effect-${added.id}`)).not.toHaveClass('border-primary');
    expect(screen.queryByText('8000Hz')).not.toBeInTheDocument();
    expect(document.body).toHaveFocus();
    expect(screen.getAllByRole('slider')[0]).not.toHaveFocus();
  });

  it('discards a successful replacement selection and parameter focus when an external update follows settlement', async () => {
    const replacement = {
      id: 'fx-delay-late-external', type: 'delay' as const, bypassed: false,
      params: { time: 0.3, feedback: 0.4, wet: 0.3 },
    };
    let finish!: () => void;
    const onReplaceEffect = vi.fn(() => new Promise<typeof replacement>((resolve) => {
      finish = () => resolve(replacement);
    }));
    const props = makeProps({ onReplaceEffect });
    const view = render(<EffectPanel {...props} />);
    fireEvent.change(screen.getByRole('combobox', { name: '替换高通滤波' }), { target: { value: 'delay' } });
    focusBody();
    const externallyReorderedTrack: ITrack = {
      ...track,
      effects: [track.effects[0]!, track.effects[2]!, track.effects[1]!],
    };

    await settleThenUpdateBeforeFocus(finish, () => {
      view.rerender(<EffectPanel {...props} track={externallyReorderedTrack} />);
    });
    view.rerender(<EffectPanel
      {...props}
      track={{
        ...externallyReorderedTrack,
        effects: externallyReorderedTrack.effects.map((effect) => (
          effect.id === 'fx-high-pass' ? replacement : effect
        )),
      }}
    />);
    await act(async () => { await Promise.resolve(); });

    expect(screen.getByTestId(`realtime-effect-${replacement.id}`)).not.toHaveClass('border-primary');
    expect(screen.queryByText('0.30s')).not.toBeInTheDocument();
    expect(document.body).toHaveFocus();
    expect(screen.getAllByRole('slider')[0]).not.toHaveFocus();
  });
});
