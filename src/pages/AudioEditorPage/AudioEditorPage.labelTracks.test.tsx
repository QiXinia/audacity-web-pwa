// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import AudioEditorPage from './AudioEditorPage';
import { projectService } from '@/services/projectService';
import { historyManager } from '@/services/historyService';
import type { IProject } from '@/types/project';

vi.mock('@/services/projectService', () => ({
  projectService: {
    openProject: vi.fn(), getProject: vi.fn(), addRecordingToTrack: vi.fn(),
    addGeneratedAudioToTracks: vi.fn(), silenceSelectionOnTracks: vi.fn(),
    loadAudioBuffer: vi.fn(), loadAudioChannels: vi.fn(), saveProject: vi.fn(),
  },
}));
vi.mock('@/services/historyService', () => ({
  historyManager: {
    loadForProject: vi.fn(), canUndo: vi.fn(), canRedo: vi.fn(), getUndoLabel: vi.fn(),
    getRedoLabel: vi.fn(), push: vi.fn(), pushCommand: vi.fn(), undo: vi.fn(), redo: vi.fn(),
    flush: vi.fn(), getHistoryState: vi.fn(() => ({ canUndo: false, canRedo: false })),
  },
}));
vi.mock('@/engine/audioEngine', () => ({
  audioEngine: {
    setCursorChangeCallback: vi.fn(), setStateChangeCallback: vi.fn(),
    getPlaybackLevels: vi.fn(() => ({ left: -Infinity, right: -Infinity })),
    getRecordingLevels: vi.fn(() => ({ left: -Infinity, right: -Infinity })),
    cacheBuffer: vi.fn(), processClipChannels: vi.fn(), seek: vi.fn(),
  },
}));
vi.mock('@/wasm/processor', () => ({
  isWasmAvailable: vi.fn(() => false),
  wasmProcessor: { spectrogram: vi.fn(), sliceBuffer: vi.fn() },
}));
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }, Toaster: () => null,
}));

let downloadedBlob: Blob | null = null;
let downloadedFileName = '';
let anchorClickSpy: ReturnType<typeof vi.spyOn>;

function makeProject(): IProject {
  return {
    id: 'project-label-tracks', name: 'Label Track integration', createdAt: 1, updatedAt: 1,
    sampleRate: 48000, tempo: 120, timeSignature: { numerator: 4, denominator: 4 }, cursorPosition: 0,
    tracks: [{
      id: 'audio-a', name: 'Audio A', type: 'audio', clips: [], muted: false, solo: false,
      armed: false, gain: 0, pan: 0, effects: [], color: '#7aa2f7',
    }],
    labelTracks: [{ id: 'lane-a', name: 'Markers', colorIndex: 0 }],
    analysisLabels: [{
      id: 'label-a', kind: 'manual', trackId: 'audio-a', labelTrackId: 'lane-a',
      start: 1, end: 2, text: 'Marker',
    }],
    viewState: { horizontalZoom: 100, verticalZoom: 1, scrollX: 0, viewMode: 'waveform', snapEnabled: false, snapMode: 'clips' },
    selection: null, loopRegion: null, loopEnabled: false,
  };
}

beforeEach(() => {
  window.localStorage.clear();
  downloadedBlob = null;
  downloadedFileName = '';
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn((blob: Blob) => { downloadedBlob = blob; return 'blob:label-export'; }),
  });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  anchorClickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    downloadedFileName = this.download;
  });
  const project = makeProject();
  vi.mocked(projectService.openProject).mockResolvedValue(project);
  vi.mocked(projectService.getProject).mockResolvedValue(project);
  vi.mocked(projectService.saveProject).mockResolvedValue(undefined);
  vi.mocked(projectService.loadAudioBuffer).mockResolvedValue(null);
  vi.mocked(projectService.loadAudioChannels).mockResolvedValue([]);
  vi.mocked(historyManager.loadForProject).mockResolvedValue(0);
  vi.mocked(historyManager.canUndo).mockReturnValue(false);
  vi.mocked(historyManager.canRedo).mockReturnValue(false);
  vi.mocked(historyManager.getUndoLabel).mockReturnValue(null);
  vi.mocked(historyManager.getRedoLabel).mockReturnValue(null);
  vi.mocked(historyManager.flush).mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  anchorClickSpy.mockRestore();
  vi.clearAllMocks();
});

describe('AudioEditorPage Label Track integration', () => {
  it('duplicates labels transactionally and exports the selected lane as an actual download', async () => {
    render(<MemoryRouter initialEntries={['/editor/project-label-tracks']}><Routes><Route path="/editor/:projectId" element={<AudioEditorPage />} /></Routes></MemoryRouter>);
    await screen.findByTestId('label-track-lane-a');
    fireEvent.contextMenu(screen.getByTestId('label-track-lane-a'));
    fireEvent.click(await screen.findByTestId('label-track-duplicate-menu'));

    await waitFor(() => expect(document.querySelectorAll('[data-label-track-id]')).toHaveLength(2));
    const saved = vi.mocked(projectService.saveProject).mock.calls.at(-1)?.[0];
    if (!saved) throw new Error('Expected the duplicated Label Tracks to be saved');
    expect(saved.labelTracks).toHaveLength(2);
    expect(saved.labelTracks?.map((track) => track.name)).toEqual(['Markers', 'Markers']);
    expect(saved.analysisLabels).toHaveLength(2);
    expect(saved.analysisLabels?.[0].id).not.toBe(saved.analysisLabels?.[1].id);
    expect(saved.analysisLabels?.[1].labelTrackId).toBe(saved.labelTracks?.[1].id);
    expect(screen.getByTestId(`label-track-panel-${saved.labelTracks![1].id}`)).toHaveTextContent('Markers');
    expect(saved.tracks.map((track) => track.id)).toEqual(['audio-a']);
    expect(historyManager.push).toHaveBeenCalledWith(expect.objectContaining({ label: 'Duplicate label track' }), expect.anything());

    fireEvent.contextMenu(screen.getByTestId('label-track-lane-a'));
    fireEvent.click(await screen.findByTestId('label-track-export-menu'));
    expect(await screen.findByTestId('export-label-track-lane-a')).toBeChecked();
    fireEvent.change(screen.getByTestId('export-labels-file-name'), { target: { value: 'labels' } });
    fireEvent.change(screen.getByTestId('export-labels-file-type'), { target: { value: 'srt' } });
    fireEvent.click(screen.getByTestId('export-labels-confirm'));

    await waitFor(() => expect(downloadedBlob).not.toBeNull());
    expect(downloadedFileName).toBe('labels.srt');
    expect(await downloadedBlob!.text()).toBe('1\n00:00:01,000 --> 00:00:02,000\nMarker\n\n');
  });
});
