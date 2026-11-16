// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { toast } from 'sonner';
import AudioEditorPage from './AudioEditorPage';
import { projectService } from '@/services/projectService';
import { historyManager } from '@/services/historyService';
import type { IClip, IProject } from '@/types/project';

const mocks = vi.hoisted(() => ({ processClip: vi.fn() }));

vi.mock('@/services/projectService', () => ({
  projectService: {
    openProject: vi.fn(), getProject: vi.fn(), addRecordingToTrack: vi.fn(),
    addGeneratedAudioToTracks: vi.fn(), silenceSelectionOnTracks: vi.fn(),
    loadAudioBuffer: vi.fn(), loadAudioChannels: vi.fn(), saveProject: vi.fn(),
  },
}));

vi.mock('@/services/historyService', () => ({
  historyManager: {
    loadForProject: vi.fn(), canUndo: vi.fn(), canRedo: vi.fn(),
    getUndoLabel: vi.fn(), getRedoLabel: vi.fn(), push: vi.fn(), pushCommand: vi.fn(),
    undo: vi.fn(), redo: vi.fn(), flush: vi.fn(), getHistoryState: vi.fn(() => ({ canUndo: false, canRedo: false })),
  },
}));

vi.mock('@/engine/audioEngine', () => ({
  audioEngine: {
    setCursorChangeCallback: vi.fn(), setStateChangeCallback: vi.fn(),
    getPlaybackLevels: vi.fn(() => ({ left: -Infinity, right: -Infinity })),
    getRecordingLevels: vi.fn(() => ({ left: -Infinity, right: -Infinity })),
    cacheBuffer: vi.fn(), processClipChannels: mocks.processClip, seek: vi.fn(),
  },
}));

vi.mock('@/wasm/processor', () => ({
  isWasmAvailable: vi.fn(() => false),
  wasmProcessor: { spectrogram: vi.fn(), sliceBuffer: vi.fn() },
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
  Toaster: () => null,
}));

function makeClip(id: string): IClip {
  return {
    id, audioBufferId: `buffer-${id}`, startTime: 0, offset: 0,
    duration: 0.1, originalDuration: 0.1, stretchRatio: 1,
    gain: 0, fadeIn: 0, fadeOut: 0, name: `Clip ${id.toUpperCase()}`,
  };
}

function makeProject(): IProject {
  return {
    id: 'project-regular-interval-labels', name: 'Regular interval labels integration', createdAt: 1, updatedAt: 1,
    sampleRate: 100, tempo: 120, timeSignature: { numerator: 4, denominator: 4 }, cursorPosition: 0,
    tracks: [
      { id: 'track-a', name: 'Track A', type: 'audio', clips: [makeClip('a')], muted: false, solo: false, armed: false, gain: 0, pan: 0, effects: [], color: '#7aa2f7' },
    ],
    viewState: { horizontalZoom: 100, verticalZoom: 1, scrollX: 0, viewMode: 'waveform', snapEnabled: false, snapMode: 'clips' },
    selection: { start: 0, end: 0.1 }, loopRegion: null, loopEnabled: false,
  };
}

function renderEditor(): void {
  render(<MemoryRouter initialEntries={['/editor/project-regular-interval-labels']}><Routes><Route path="/editor/:projectId" element={<AudioEditorPage />} /></Routes></MemoryRouter>);
}

async function openRegularIntervalLabels(): Promise<void> {
  const trigger = await screen.findByRole('button', { name: '分析' });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Regular interval labels… 等间隔标签…' }));
}

beforeEach(() => {
  window.localStorage.clear();
  const project = makeProject();
  vi.mocked(projectService.openProject).mockResolvedValue(project);
  vi.mocked(projectService.getProject).mockResolvedValue(project);
  vi.mocked(projectService.saveProject).mockResolvedValue(undefined);
  vi.mocked(projectService.loadAudioBuffer).mockResolvedValue(null);
  vi.mocked(projectService.loadAudioChannels).mockResolvedValue([new Float32Array(10).fill(0.5)]);
  mocks.processClip.mockImplementation((_clip: IClip, channels: Float32Array[]) => channels);
  vi.mocked(historyManager.loadForProject).mockResolvedValue(0);
  vi.mocked(historyManager.canUndo).mockReturnValue(false);
  vi.mocked(historyManager.canRedo).mockReturnValue(false);
  vi.mocked(historyManager.getUndoLabel).mockReturnValue(null);
  vi.mocked(historyManager.getRedoLabel).mockReturnValue(null);
  vi.mocked(historyManager.flush).mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('AudioEditorPage Regular interval labels integration', () => {
  it('creates persistent numbered region labels in one transaction and locates them', async () => {
    renderEditor();
    await screen.findByText('Regular interval labels integration');
    await openRegularIntervalLabels();

    expect(await screen.findByRole('dialog', { name: 'Regular interval labels' })).toBeInTheDocument();
    expect(screen.getByLabelText('Create labels based on')).toHaveValue('both');
    expect(screen.getByLabelText('Number of labels')).toHaveValue(10);
    expect(screen.getByLabelText('Label interval (seconds)')).toHaveValue(10);
    expect(screen.getByLabelText('Minimum number of digits in label')).toHaveValue('2');
    fireEvent.change(screen.getByLabelText('Create labels based on'), { target: { value: 'number' } });
    fireEvent.change(screen.getByLabelText('Number of labels'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('Length of label region (seconds)'), { target: { value: '0.02' } });
    fireEvent.change(screen.getByLabelText('Label text'), { target: { value: 'Cue ' } });
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));

    const labelButton = await screen.findByRole('button', { name: /选择标签 01Cue/ });
    await waitFor(() => expect(screen.queryByTestId('regular-interval-labels-dialog')).not.toBeInTheDocument());
    expect(projectService.saveProject).toHaveBeenCalledTimes(1);
    expect(projectService.saveProject).toHaveBeenCalledWith(expect.objectContaining({
      analysisLabels: [
        expect.objectContaining({ kind: 'manual', trackId: 'track-a', start: 0, end: 0.02, text: '01Cue ' }),
        expect.objectContaining({ kind: 'manual', trackId: 'track-a', start: 0.04, end: 0.06, text: '02Cue ' }),
        expect.objectContaining({ kind: 'manual', trackId: 'track-a', start: 0.08, end: 0.1, text: '03Cue ' }),
      ],
    }));
    expect(historyManager.push).toHaveBeenCalledWith(expect.objectContaining({ label: 'Regular interval labels 等间隔标签（3 个标签）' }), expect.anything());
    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('3 region labels at intervals of 0.04 seconds.'));

    fireEvent.click(labelButton);
    expect(screen.getByLabelText('选区开始时间')).toHaveValue('00h00m00.000s');
    expect(screen.getByLabelText('选区结束时间')).toHaveValue('00h00m00.020s');
  });

  it('closes without saving when no labels fit and reports the official error', async () => {
    renderEditor();
    await screen.findByText('Regular interval labels integration');
    await openRegularIntervalLabels();
    fireEvent.change(await screen.findByLabelText('Create labels based on'), { target: { value: 'interval' } });
    fireEvent.change(screen.getByLabelText('Length of label region (seconds)'), { target: { value: '0.1' } });
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));

    await waitFor(() => expect(screen.queryByTestId('regular-interval-labels-dialog')).not.toBeInTheDocument());
    expect(toast.error).toHaveBeenCalledWith('Error: There is insufficient space to create labels.');
    expect(projectService.saveProject).not.toHaveBeenCalled();
    expect(historyManager.push).not.toHaveBeenCalled();
  });

  it('blocks the one-region division-by-zero case before writing project or history', async () => {
    renderEditor();
    await screen.findByText('Regular interval labels integration');
    await openRegularIntervalLabels();
    fireEvent.change(await screen.findByLabelText('Create labels based on'), { target: { value: 'number' } });
    fireEvent.change(screen.getByLabelText('Number of labels'), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText('Length of label region (seconds)'), { target: { value: '0.02' } });

    expect(screen.getByRole('button', { name: 'OK' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('至少需要 2 个标签');
    expect(projectService.saveProject).not.toHaveBeenCalled();
    expect(historyManager.push).not.toHaveBeenCalled();
  });
});
