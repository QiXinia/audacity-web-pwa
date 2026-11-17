// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import LabelEditorDialog from './LabelEditorDialog';
import type { IAnalysisLabel, ITrack } from '@/types/project';

const tracks: ITrack[] = ['track-a', 'track-b'].map((id, index) => ({
  id, name: `Track ${index === 0 ? 'A' : 'B'}`, type: 'audio', gain: 0, pan: 0,
  muted: false, solo: false, armed: false, color: '#fff', clips: [], effects: [],
}));

const clipping: IAnalysisLabel = {
  id: 'clip-1', kind: 'clipping', trackId: 'track-a', channelIndex: 1,
  start: 0.01, end: 0.04, text: '3 of 3',
};

function renderDialog(overrides: Partial<Parameters<typeof LabelEditorDialog>[0]> = {}) {
  const onApply = vi.fn().mockResolvedValue(undefined);
  const onOpenChange = vi.fn();
  render(<LabelEditorDialog
    open onOpenChange={onOpenChange} labels={[clipping]} tracks={tracks}
    selectedTrackId="track-a" selection={{ start: 1, end: 2 }}
    isApplying={false} onApply={onApply} {...overrides}
  />);
  return { onApply, onOpenChange };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('LabelEditorDialog', () => {
  it('edits text, track and ordered times while retaining clipping metadata', () => {
    const { onApply } = renderDialog();
    fireEvent.change(screen.getByLabelText('标签文本 1'), { target: { value: 'Peak edited' } });
    fireEvent.change(screen.getByLabelText('轨道 1'), { target: { value: 'track-b' } });
    fireEvent.change(screen.getByLabelText('开始时间 1'), { target: { value: '0.08' } });
    expect(screen.getByLabelText('结束时间 1')).toHaveValue(0.08);
    fireEvent.change(screen.getByLabelText('结束时间 1'), { target: { value: '0.03' } });
    expect(screen.getByLabelText('开始时间 1')).toHaveValue(0.03);
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(onApply).toHaveBeenCalledWith([{
      ...clipping, text: 'Peak edited', trackId: 'track-b', start: 0.03, end: 0.03,
    }]);
  });

  it('inserts a manual selection label and deletes only the selected draft row', () => {
    const { onApply } = renderDialog({ selectedTrackId: 'track-b' });
    fireEvent.click(screen.getByRole('button', { name: 'Insert' }));
    fireEvent.change(screen.getByLabelText('标签文本 2'), { target: { value: 'Manual note' } });
    expect(screen.getByLabelText('轨道 2')).toHaveValue('track-b');
    expect(screen.getByLabelText('开始时间 2')).toHaveValue(1);
    expect(screen.getByLabelText('结束时间 2')).toHaveValue(2);
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(onApply).toHaveBeenLastCalledWith([
      clipping,
      expect.objectContaining({ kind: 'manual', trackId: 'track-b', start: 1, end: 2, text: 'Manual note' }),
    ]);
    expect(onApply.mock.calls[0][0][1]).not.toHaveProperty('channelIndex');
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(onApply).toHaveBeenLastCalledWith([clipping]);
  });

  it('keeps Cancel transactional and blocks invalid numeric input', () => {
    const { onApply, onOpenChange } = renderDialog();
    fireEvent.change(screen.getByLabelText('标签文本 1'), { target: { value: 'Discard me' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onApply).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('开始时间 1'), { target: { value: '' } });
    expect(screen.getByRole('button', { name: 'OK' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('开始时间必须是有限秒数');
  });

  it('keeps negative Sync-Lock labels editable after persistence', () => {
    const negative: IAnalysisLabel = {
      id: 'negative-sync', kind: 'manual', trackId: 'track-a', start: -0.75, end: -0.5, text: 'L3',
    };
    const { onApply } = renderDialog({ labels: [negative] });
    expect(screen.getByRole('button', { name: 'OK' })).toBeEnabled();
    fireEvent.change(screen.getByLabelText('标签文本 1'), { target: { value: 'L3 edited' } });
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(onApply).toHaveBeenCalledWith([{ ...negative, text: 'L3 edited' }]);
  });

  it('offers one unsaved manual row when no labels exist', () => {
    const { onApply } = renderDialog({ labels: [] });
    expect(screen.getByLabelText('标签文本 1')).toHaveValue('');
    fireEvent.change(screen.getByLabelText('标签文本 1'), { target: { value: 'First label' } });
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(onApply).toHaveBeenCalledWith([
      expect.objectContaining({ kind: 'manual', start: 1, end: 2, text: 'First label' }),
    ]);
  });
});
