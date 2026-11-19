// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ExportLabelsDialog from './ExportLabelsDialog';

const tracks = [
  { id: 'lane-a', name: 'A labels', colorIndex: 0 },
  { id: 'lane-b', name: 'B labels', colorIndex: 2 },
];

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ExportLabelsDialog', () => {
  it('selects the context lane, validates inputs and exports chosen lanes and format', () => {
    const onExport = vi.fn();
    const onOpenChange = vi.fn();
    render(<ExportLabelsDialog
      open onOpenChange={onOpenChange} tracks={tracks} initialTrackId="lane-a" onExport={onExport}
    />);
    const confirm = screen.getByTestId('export-labels-confirm');
    expect(confirm).toBeDisabled();
    expect(screen.getByTestId('export-label-track-lane-a')).toBeChecked();
    expect(screen.getByTestId('export-label-track-lane-b')).not.toBeChecked();

    fireEvent.change(screen.getByTestId('export-labels-file-name'), { target: { value: '  markers  ' } });
    fireEvent.click(screen.getByTestId('export-label-track-lane-b'));
    fireEvent.change(screen.getByTestId('export-labels-file-type'), { target: { value: 'vtt' } });
    fireEvent.click(confirm);
    expect(onExport).toHaveBeenCalledWith({
      fileName: 'markers', fileType: 'vtt', trackIds: ['lane-a', 'lane-b'],
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('supports select/deselect all and blocks an empty selection', () => {
    render(<ExportLabelsDialog
      open onOpenChange={vi.fn()} tracks={tracks} initialTrackId={null} onExport={vi.fn()}
    />);
    expect(screen.getByTestId('export-label-track-lane-a')).toBeChecked();
    expect(screen.getByTestId('export-label-track-lane-b')).toBeChecked();
    fireEvent.change(screen.getByTestId('export-labels-file-name'), { target: { value: 'labels' } });
    fireEvent.click(screen.getByTestId('export-labels-deselect-all'));
    expect(screen.getByTestId('export-labels-confirm')).toBeDisabled();
    fireEvent.click(screen.getByTestId('export-labels-select-all'));
    expect(screen.getByTestId('export-labels-confirm')).toBeEnabled();
  });
});
