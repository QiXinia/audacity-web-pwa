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
    id: 'project-label-sounds', name: 'Label sounds integration', createdAt: 1, updatedAt: 1,
    sampleRate: 100, tempo: 120, timeSignature: { numerator: 4, denominator: 4 }, cursorPosition: 0,
    tracks: [
      { id: 'track-a', name: 'Track A', type: 'audio', clips: [makeClip('a')], muted: false, solo: false, armed: false, gain: 0, pan: 0, effects: [], color: '#7aa2f7' },
    ],
    viewState: { horizontalZoom: 100, verticalZoom: 1, scrollX: 0, viewMode: 'waveform', snapEnabled: false, snapMode: 'clips' },
    selection: { start: 0, end: 0.1 }, loopRegion: null, loopEnabled: false,
  };
}

function renderEditor(): void {
  render(<MemoryRouter initialEntries={['/editor/project-label-sounds']}><Routes><Route path="/editor/:projectId" element={<AudioEditorPage />} /></Routes></MemoryRouter>);
}

async function openLabelSounds(): Promise<void> {
  const trigger = await screen.findByRole('button', { name: '分析' });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Label sounds… 标记声音…' }));
}

beforeEach(() => {
  window.localStorage.clear();
  const project = makeProject();
  vi.mocked(projectService.openProject).mockResolvedValue(project);
  vi.mocked(projectService.getProject).mockResolvedValue(project);
  vi.mocked(projectService.saveProject).mockResolvedValue(undefined);
  vi.mocked(projectService.loadAudioBuffer).mockResolvedValue(null);
  vi.mocked(projectService.loadAudioChannels).mockResolvedValue([
    new Float32Array([0, 1, 1, 0, 0, 0, 1, 1, 0, 0]),
  ]);
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

describe('AudioEditorPage Label sounds integration', () => {
  it('creates persistent manual region labels with one history transaction and locates them', async () => {
    renderEditor();
    await screen.findByText('Label sounds integration');
    await openLabelSounds();

    expect(await screen.findByRole('dialog', { name: 'Label sounds' })).toBeInTheDocument();
    expect(screen.getByLabelText('Threshold level (dB)')).toHaveValue(-30);
    expect(screen.getByLabelText('Threshold measurement')).toHaveValue('peak');
    expect(screen.getByLabelText('Label type')).toHaveValue('around');
    expect(screen.getByLabelText('Label text')).toHaveValue('Sound ##1');
    fireEvent.change(screen.getByLabelText('Minimum silence duration (s)'), { target: { value: '0.02' } });
    fireEvent.change(screen.getByLabelText('Minimum label interval (s)'), { target: { value: '0.02' } });
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));

    const labelButton = await screen.findByRole('button', { name: '选择标签 Sound 01' });
    await waitFor(() => expect(screen.queryByTestId('label-sounds-dialog')).not.toBeInTheDocument());
    expect(projectService.saveProject).toHaveBeenCalledTimes(1);
    expect(projectService.saveProject).toHaveBeenCalledWith(expect.objectContaining({
      analysisLabels: [
        expect.objectContaining({ kind: 'manual', trackId: 'track-a', start: 0.01, end: 0.03, text: 'Sound 01' }),
        expect.objectContaining({ kind: 'manual', trackId: 'track-a', start: 0.06, end: 0.08, text: 'Sound 02' }),
      ],
    }));
    const saved = vi.mocked(projectService.saveProject).mock.calls[0][0];
    expect(saved.analysisLabels?.every((label) => label.channelIndex === undefined)).toBe(true);
    expect(historyManager.push).toHaveBeenCalledWith(expect.objectContaining({ label: 'Label sounds 标记声音（2 个标签）' }), expect.anything());

    fireEvent.click(labelButton);
    expect(screen.getByLabelText('选区开始时间')).toHaveValue('00h00m00.010s');
    expect(screen.getByLabelText('选区结束时间')).toHaveValue('00h00m00.030s');
  });

  it('keeps the dialog open without saving when between has only one sound', async () => {
    vi.mocked(projectService.loadAudioChannels).mockResolvedValue([
      new Float32Array([0, 1, 1, 0, 0, 0, 0, 0, 0, 0]),
    ]);
    renderEditor();
    await screen.findByText('Label sounds integration');
    await openLabelSounds();
    fireEvent.change(await screen.findByLabelText('Minimum silence duration (s)'), { target: { value: '0.02' } });
    fireEvent.change(screen.getByLabelText('Minimum label interval (s)'), { target: { value: '0.02' } });
    fireEvent.change(screen.getByLabelText('Label type'), { target: { value: 'between' } });
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('at least two sounds');
    expect(screen.getByTestId('label-sounds-dialog')).toBeInTheDocument();
    expect(projectService.saveProject).not.toHaveBeenCalled();
    expect(historyManager.push).not.toHaveBeenCalled();
  });

  it('blocks invalid durations before reading audio or writing history', async () => {
    renderEditor();
    await screen.findByText('Label sounds integration');
    await openLabelSounds();
    fireEvent.change(await screen.findByLabelText('Minimum silence duration (s)'), { target: { value: '0' } });
    expect(screen.getByRole('button', { name: 'OK' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('Minimum silence duration');
    expect(projectService.loadAudioChannels).not.toHaveBeenCalled();
    expect(projectService.saveProject).not.toHaveBeenCalled();
    expect(historyManager.push).not.toHaveBeenCalled();
  });
});
