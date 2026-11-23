import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
    onRemoveEffect: vi.fn(),
    onMoveEffect: vi.fn(),
    ...overrides,
  };
  render(<EffectPanel {...props} />);
  return props;
}

describe('EffectPanel Audacity reorder controls', () => {
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
