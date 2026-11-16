// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import AudioEditorPage from './AudioEditorPage';
import { projectService } from '@/services/projectService';
import { historyManager } from '@/services/historyService';
import type { IAnalysisLabel, IClip, IProject } from '@/types/project';

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

const clipping: IAnalysisLabel = {
  id: 'clip-1', kind: 'clipping', trackId: 'track-a', channelIndex: 1,
  start: 0.01, end: 0.04, text: '3 of 3',
};

function makeClip(id: string): IClip {
  return {
    id, audioBufferId: `buffer-${id}`, startTime: 0, offset: 0,
    duration: 0.1, originalDuration: 0.1, gain: 0, fadeIn: 0, fadeOut: 0,
    name: `Clip ${id.toUpperCase()}`,
  };
}

function makeProject(): IProject {
  return {
    id: 'project-label-editor', name: 'Label editor integration', createdAt: 1, updatedAt: 1,
    sampleRate: 80, tempo: 120, timeSignature: { numerator: 4, denominator: 4 }, cursorPosition: 0,
    tracks: [
      { id: 'track-a', name: 'Track A', type: 'audio', clips: [makeClip('a')], muted: false, solo: false, armed: false, gain: 0, pan: 0, effects: [], color: '#7aa2f7' },
      { id: 'track-b', name: 'Track B', type: 'audio', clips: [makeClip('b')], muted: false, solo: false, armed: false, gain: 0, pan: 0, effects: [], color: '#7aa2f7' },
    ],
    viewState: { horizontalZoom: 100, verticalZoom: 1, scrollX: 0, viewMode: 'waveform', snapEnabled: false, snapMode: 'clips' },
    selection: { start: 0, end: 0.1 }, loopRegion: null, loopEnabled: false,
    analysisLabels: [{ ...clipping }],
  };
}

function renderEditor() {
  render(<MemoryRouter initialEntries={['/editor/project-label-editor']}><Routes><Route path="/editor/:projectId" element={<AudioEditorPage />} /></Routes></MemoryRouter>);
}

async function openEditor() {
  const triggers = await screen.findAllByRole('button', { name: '编辑' });
  fireEvent.pointerDown(triggers[0], { button: 0, ctrlKey: false, pointerType: 'mouse' });
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Edit Labels… 编辑标签…' }));
}

beforeEach(() => {
  window.localStorage.clear();
  const project = makeProject();
  vi.mocked(projectService.openProject).mockResolvedValue(project);
  vi.mocked(projectService.getProject).mockResolvedValue(project);
  vi.mocked(projectService.saveProject).mockResolvedValue(undefined);
  vi.mocked(projectService.loadAudioBuffer).mockResolvedValue(null);
  vi.mocked(projectService.loadAudioChannels).mockResolvedValue([new Float32Array(16)]);
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

describe('AudioEditorPage Edit Labels integration', () => {
  it('saves edits and insertion once with clipping metadata and reversible history', async () => {
    renderEditor();
    await screen.findByText('Label editor integration');
    await openEditor();
    fireEvent.change(screen.getByLabelText('标签文本 1'), { target: { value: 'Peak A' } });
    fireEvent.change(screen.getByLabelText('轨道 1'), { target: { value: 'track-b' } });
    fireEvent.change(screen.getByLabelText('开始时间 1'), { target: { value: '0.02' } });
    fireEvent.change(screen.getByLabelText('结束时间 1'), { target: { value: '0.05' } });
    fireEvent.click(screen.getByRole('button', { name: 'Insert' }));
    fireEvent.change(screen.getByLabelText('标签文本 2'), { target: { value: 'Manual note' } });
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));

    await waitFor(() => expect(projectService.saveProject).toHaveBeenCalled(), { timeout: 5000 });
    const saved = vi.mocked(projectService.saveProject).mock.calls.map(([project]) => project)
      .find((project) => project.analysisLabels?.length === 2);
    expect(saved?.analysisLabels?.[0]).toEqual({
      ...clipping, text: 'Peak A', trackId: 'track-b', start: 0.02, end: 0.05,
    });
    expect(saved?.analysisLabels?.[1]).toEqual(expect.objectContaining({
      kind: 'manual', trackId: 'track-a', start: 0, end: 0.1, text: 'Manual note',
    }));
    expect(saved?.analysisLabels?.[1].id).toEqual(expect.any(String));
    expect(saved?.analysisLabels?.[1]).not.toHaveProperty('channelIndex');
    expect(historyManager.push).toHaveBeenCalledTimes(1);
    const [command, before] = vi.mocked(historyManager.push).mock.calls[0];
    expect(before?.analysisLabels).toEqual([clipping]);
    expect(command.undo().analysisLabels).toEqual([clipping]);
    expect(command.execute().analysisLabels).toEqual(saved?.analysisLabels);
    expect(await screen.findByRole('button', { name: '选择削波标签 Peak A' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '选择标签 Manual note' })).toBeInTheDocument();
  }, 20000);

  it('deletes a label on OK but never writes a canceled draft', async () => {
    renderEditor();
    await screen.findByText('Label editor integration');
    await openEditor();
    fireEvent.change(screen.getByLabelText('标签文本 1'), { target: { value: 'Discard me' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(projectService.saveProject).not.toHaveBeenCalled();
    expect(historyManager.push).not.toHaveBeenCalled();

    await openEditor();
    expect(screen.getByLabelText('标签文本 1')).toHaveValue('3 of 3');
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    await waitFor(() => expect(projectService.saveProject).toHaveBeenCalled(), { timeout: 5000 });
    expect(vi.mocked(projectService.saveProject).mock.calls[0][0].analysisLabels).toEqual([]);
    expect(historyManager.push).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: '选择削波标签 3 of 3' })).not.toBeInTheDocument();
  }, 20000);
});
