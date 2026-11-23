import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
});
