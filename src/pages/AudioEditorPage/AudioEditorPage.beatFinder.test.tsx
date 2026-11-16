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
    duration: 0.2, originalDuration: 0.2, stretchRatio: 1,
    gain: 0, fadeIn: 0, fadeOut: 0, name: `Clip ${id.toUpperCase()}`,
  };
}

function makeProject(): IProject {
  return {
    id: 'project-beat-finder', name: 'Beat finder integration', createdAt: 1, updatedAt: 1,
    sampleRate: 1000, tempo: 120, timeSignature: { numerator: 4, denominator: 4 }, cursorPosition: 0,
    tracks: [
      { id: 'track-a', name: 'Track A', type: 'audio', clips: [makeClip('a')], muted: false, solo: false, armed: false, gain: 0, pan: 0, effects: [], color: '#7aa2f7' },
    ],
    viewState: { horizontalZoom: 100, verticalZoom: 1, scrollX: 0, viewMode: 'waveform', snapEnabled: false, snapMode: 'clips' },
    selection: { start: 0, end: 0.2 }, loopRegion: null, loopEnabled: false,
  };
}

function renderEditor(): void {
  render(<MemoryRouter initialEntries={['/editor/project-beat-finder']}><Routes><Route path="/editor/:projectId" element={<AudioEditorPage />} /></Routes></MemoryRouter>);
}

async function openBeatFinder(): Promise<void> {
  const trigger = await screen.findByRole('button', { name: '分析' });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Beat finder… 节拍查找…' }));
}

beforeEach(() => {
  window.localStorage.clear();
  const project = makeProject();
  vi.mocked(projectService.openProject).mockResolvedValue(project);
  vi.mocked(projectService.getProject).mockResolvedValue(project);
  vi.mocked(projectService.saveProject).mockResolvedValue(undefined);
  vi.mocked(projectService.loadAudioBuffer).mockResolvedValue(null);
  const samples = new Float32Array(200);
  samples[100] = 1;
  samples[101] = 0.8;
  vi.mocked(projectService.loadAudioChannels).mockResolvedValue([samples]);
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

describe('AudioEditorPage Beat finder integration', () => {
  it('opens the official single control and creates a persistent B point label in one transaction', async () => {
    renderEditor();
    await screen.findByText('Beat finder integration');
    await openBeatFinder();

    expect(await screen.findByRole('dialog', { name: 'Beat finder' })).toBeInTheDocument();
    expect(screen.getByLabelText('Threshold Percentage')).toHaveValue(65);
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));

    await screen.findByRole('button', { name: /选择标签 B/ });
    await waitFor(() => expect(screen.queryByTestId('beat-finder-dialog')).not.toBeInTheDocument());
    expect(projectService.saveProject).toHaveBeenCalledTimes(1);
    expect(projectService.saveProject).toHaveBeenCalledWith(expect.objectContaining({
      analysisLabels: [expect.objectContaining({ kind: 'manual', trackId: 'track-a', text: 'B' })],
    }));
    const labels = vi.mocked(projectService.saveProject).mock.calls[0][0].analysisLabels ?? [];
    expect(labels).toHaveLength(1);
    expect(labels[0].start).toBe(labels[0].end);
    expect(labels[0].start).toBeGreaterThanOrEqual(0);
    expect(labels[0].start).toBeLessThan(0.2);
    expect(historyManager.push).toHaveBeenCalledWith(expect.objectContaining({ label: 'Beat finder 节拍查找（1 个标签）' }), expect.anything());
    expect(toast.success).toHaveBeenCalledWith('已创建 1 个节拍标签');
  });

  it('closes without saving project or history when no beats are detected', async () => {
    vi.mocked(projectService.loadAudioChannels).mockResolvedValue([new Float32Array(200)]);
    renderEditor();
    await screen.findByText('Beat finder integration');
    await openBeatFinder();
    fireEvent.click(await screen.findByRole('button', { name: 'OK' }));

    await waitFor(() => expect(screen.queryByTestId('beat-finder-dialog')).not.toBeInTheDocument());
    expect(toast.info).toHaveBeenCalledWith('No beats found. Try lowering Threshold Percentage.');
    expect(projectService.saveProject).not.toHaveBeenCalled();
    expect(historyManager.push).not.toHaveBeenCalled();
  });

  it('blocks out-of-range and fractional thresholds before writing', async () => {
    renderEditor();
    await screen.findByText('Beat finder integration');
    await openBeatFinder();
    const input = await screen.findByLabelText('Threshold Percentage');
    fireEvent.change(input, { target: { value: '65.5' } });
    expect(screen.getByRole('button', { name: 'OK' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('5 到 100');
    fireEvent.change(input, { target: { value: '4' } });
    expect(screen.getByRole('button', { name: 'OK' })).toBeDisabled();
    expect(projectService.saveProject).not.toHaveBeenCalled();
    expect(historyManager.push).not.toHaveBeenCalled();
  });
});
