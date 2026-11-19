// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClippingLabelTimeline } from './ClippingLabelTimeline';

function renderTimeline() {
  const callbacks = {
    onSelect: vi.fn(), onEdit: vi.fn(), onRenameTrack: vi.fn(), onDuplicateTrack: vi.fn(),
    onDeleteTrack: vi.fn(), onMoveTrack: vi.fn(), onTrackColorChange: vi.fn(), onExportLabels: vi.fn(),
  };
  render(<ClippingLabelTimeline
    labels={[{ id: 'label-a', kind: 'manual', trackId: 'audio-a', labelTrackId: 'lane-a', start: 0, end: 1, text: 'A' }]}
    labelTracks={[{ id: 'lane-a', name: 'A labels', colorIndex: 0 }, { id: 'lane-b', name: 'Empty lane', colorIndex: 4 }]}
    tracks={[{ id: 'audio-a', name: 'Audio A' }]}
    pxPerSec={100}
    totalWidth={1000}
    offsetX={240}
    {...callbacks}
  />);
  return callbacks;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ClippingLabelTimeline Label Track context menu', () => {
  it('shows every official item in order and invokes Duplicate/Export for the context lane', async () => {
    const callbacks = renderTimeline();
    expect(screen.getByTestId('label-track-lane-b')).toBeInTheDocument();
    fireEvent.contextMenu(screen.getByTestId('label-track-lane-a'));
    const menu = await screen.findByTestId('label-track-context-menu-lane-a');
    expect(menu.textContent).toBe('Rename trackDuplicate trackDelete trackMove trackTrack colorExport labels');
    fireEvent.click(screen.getByTestId('label-track-duplicate-menu'));
    expect(callbacks.onDuplicateTrack).toHaveBeenCalledWith('lane-a');

    fireEvent.contextMenu(screen.getByTestId('label-track-lane-a'));
    await screen.findByTestId('label-track-context-menu-lane-a');
    fireEvent.click(screen.getByTestId('label-track-export-menu'));
    expect(callbacks.onExportLabels).toHaveBeenCalledWith('lane-a');
  });

  it('renames inline without changing the audio track', async () => {
    const callbacks = renderTimeline();
    fireEvent.contextMenu(screen.getByTestId('label-track-lane-a'));
    fireEvent.click(await screen.findByTestId('label-track-rename-menu'));
    const input = await screen.findByLabelText('Label Track name A labels');
    fireEvent.change(input, { target: { value: '  Renamed labels  ' } });
    fireEvent.blur(input);
    await waitFor(() => expect(callbacks.onRenameTrack).toHaveBeenCalledWith('lane-a', 'Renamed labels'));
  });
});
