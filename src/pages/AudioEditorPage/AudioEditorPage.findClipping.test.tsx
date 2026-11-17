// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
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
    duration: 0.1, originalDuration: 0.2, stretchRatio: 2,
    gain: 0, fadeIn: 0, fadeOut: 0, name: `Clip ${id.toUpperCase()}`,
  };
}

function makeProject(): IProject {
  return {
    id: 'project-find-clipping', name: 'Find Clipping integration', createdAt: 1, updatedAt: 1,
    sampleRate: 80, tempo: 120, timeSignature: { numerator: 4, denominator: 4 }, cursorPosition: 0,
    tracks: [
      { id: 'track-a', name: 'Track A', type: 'audio', clips: [makeClip('a')], muted: false, solo: false, armed: false, gain: 0, pan: 0, effects: [], color: '#7aa2f7' },
      { id: 'track-b', name: 'Track B', type: 'audio', clips: [makeClip('b')], muted: false, solo: false, armed: false, gain: 0, pan: 0, effects: [], color: '#7aa2f7' },
    ],
    viewState: { horizontalZoom: 100, verticalZoom: 1, scrollX: 0, viewMode: 'waveform', snapEnabled: false, snapMode: 'clips' },
    selection: { start: 0, end: 0.1 }, loopRegion: null, loopEnabled: false,
  };
}

function renderEditor() {
  render(<MemoryRouter initialEntries={['/editor/project-find-clipping']}><Routes><Route path="/editor/:projectId" element={<AudioEditorPage />} /></Routes></MemoryRouter>);
}

async function openAnalysisMenu() {
  const trigger = await screen.findByRole('button', { name: '分析' });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  return screen.findByRole('menuitem', { name: 'Find Clipping… 查找削波…' });
}

beforeEach(() => {
  window.localStorage.clear();
  const project = makeProject();
  vi.mocked(projectService.openProject).mockResolvedValue(project);
  vi.mocked(projectService.getProject).mockResolvedValue(project);
  vi.mocked(projectService.saveProject).mockResolvedValue(undefined);
  vi.mocked(projectService.loadAudioBuffer).mockResolvedValue(null);
  vi.mocked(projectService.loadAudioChannels).mockImplementation(async (id: string) => {
    if (id === 'buffer-a') {
      return [
        new Float32Array([1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
        new Float32Array(16),
      ];
    }
    return [new Float32Array(16)];
  });
  mocks.processClip.mockImplementation((_clip: IClip, channels: Float32Array[]) => channels.map((channel) => channel.slice(0, 8)));
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

describe('AudioEditorPage Find Clipping integration', () => {
  it('creates persistent per-channel labels from Shift-selected effective PCM and locates them', async () => {
    renderEditor();
    await screen.findByText('Find Clipping integration');
    fireEvent.click(await screen.findByRole('button', { name: /^Clip A/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Clip B/ }), { shiftKey: true });
    fireEvent.click(await openAnalysisMenu());

    expect(await screen.findByRole('dialog', { name: 'Find Clipping' })).toBeInTheDocument();
    expect(screen.getByLabelText('Start threshold (samples):')).toHaveValue(3);
    expect(screen.getByLabelText('Stop threshold (samples):')).toHaveValue(3);
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));

    const labelButton = await screen.findByRole('button', { name: '选择削波标签 3 of 3' });
    await waitFor(() => expect(screen.queryByTestId('find-clipping-dialog')).not.toBeInTheDocument());
    expect(mocks.processClip).toHaveBeenCalledTimes(2);
    expect(projectService.saveProject).toHaveBeenCalledWith(expect.objectContaining({
      analysisLabels: [expect.objectContaining({
        kind: 'clipping', trackId: 'track-a', channelIndex: 0,
        start: 0, end: 0.025, text: '3 of 3',
      })],
    }));
    expect(historyManager.push).toHaveBeenCalledWith(expect.objectContaining({ label: 'Find Clipping 查找削波（1 个标签）' }), expect.anything());

    fireEvent.click(labelButton);
    expect(screen.getByLabelText('选区开始时间')).toHaveValue('00h00m00.000s');
    expect(screen.getByLabelText('选区结束时间')).toHaveValue('00h00m00.025s');
  });

  it('blocks non-integer thresholds without reading audio or writing the project', async () => {
    renderEditor();
    await screen.findByText('Find Clipping integration');
    await waitFor(() => expect(projectService.loadAudioChannels).toHaveBeenCalledTimes(2));
    vi.mocked(projectService.loadAudioChannels).mockClear();
    fireEvent.click(await openAnalysisMenu());
    const start = await screen.findByLabelText('Start threshold (samples):');
    fireEvent.change(start, { target: { value: '1.5' } });
    expect(screen.getByRole('button', { name: 'OK' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('Start threshold 必须是至少为 1 的整数');
    expect(projectService.loadAudioChannels).not.toHaveBeenCalled();
    expect(projectService.saveProject).not.toHaveBeenCalled();
  });

  it('disables the command without a real time selection', async () => {
    const withoutSelection: IProject = { ...makeProject(), selection: null };
    vi.mocked(projectService.openProject).mockResolvedValue(withoutSelection);
    vi.mocked(projectService.getProject).mockResolvedValue(withoutSelection);
    renderEditor();
    await screen.findByText('Find Clipping integration');
    expect(await openAnalysisMenu()).toHaveAttribute('aria-disabled', 'true');
    expect(screen.queryByRole('dialog', { name: 'Find Clipping' })).not.toBeInTheDocument();
  });
});
