// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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
    duration: 0.2, originalDuration: 0.2, stretchRatio: 1,
    gain: 0, fadeIn: 0, fadeOut: 0, name: `Clip ${id.toUpperCase()}`,
  };
}

function makeProject(): IProject {
  return {
    id: 'project-measure-rms', name: 'Measure RMS integration', createdAt: 1, updatedAt: 1,
    sampleRate: 1000, tempo: 120, timeSignature: { numerator: 4, denominator: 4 }, cursorPosition: 0,
    tracks: [
      { id: 'track-a', name: 'Track A', type: 'audio', clips: [makeClip('a')], muted: false, solo: false, armed: false, gain: 0, pan: 0, effects: [], color: '#7aa2f7' },
      { id: 'track-b', name: 'Track B', type: 'audio', clips: [makeClip('b')], muted: false, solo: false, armed: false, gain: 0, pan: 0, effects: [], color: '#7aa2f7' },
    ],
    viewState: { horizontalZoom: 100, verticalZoom: 1, scrollX: 0, viewMode: 'waveform', snapEnabled: false, snapMode: 'clips' },
    selection: { start: 0, end: 0.2 }, loopRegion: null, loopEnabled: false,
  };
}

function renderEditor(): void {
  render(<MemoryRouter initialEntries={['/editor/project-measure-rms']}><Routes><Route path="/editor/:projectId" element={<AudioEditorPage />} /></Routes></MemoryRouter>);
}

async function openMeasureRms(): Promise<HTMLElement> {
  const trigger = await screen.findByRole('button', { name: '分析' });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  return screen.findByRole('menuitem', { name: 'Measure RMS… RMS 测量…' });
}

beforeEach(() => {
  window.localStorage.clear();
  const project = makeProject();
  vi.mocked(projectService.openProject).mockResolvedValue(project);
  vi.mocked(projectService.getProject).mockResolvedValue(project);
  vi.mocked(projectService.saveProject).mockResolvedValue(undefined);
  vi.mocked(projectService.loadAudioBuffer).mockResolvedValue(null);
  vi.mocked(projectService.loadAudioChannels).mockImplementation(async (id: string) => {
    if (id === 'buffer-a') return [new Float32Array(200).fill(0.5)];
    return [new Float32Array(200).fill(0.25)];
  });
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

describe('AudioEditorPage Measure RMS integration', () => {
  it('opens the official no-control result and measures mono without project or history writes', async () => {
    renderEditor();
    await screen.findByText('Measure RMS integration');
    fireEvent.click(await screen.findByRole('button', { name: /^Clip A/ }));
    fireEvent.click(await openMeasureRms());

    expect(await screen.findByRole('dialog', { name: 'Measure RMS' })).toBeInTheDocument();
    expect(await screen.findByLabelText('Track A Mono RMS')).toHaveTextContent('-6.0206 dB');
    expect(projectService.loadAudioChannels).toHaveBeenCalledWith('buffer-a');
    expect(projectService.loadAudioChannels).not.toHaveBeenCalledWith('buffer-b');
    expect(projectService.saveProject).not.toHaveBeenCalled();
    expect(historyManager.push).not.toHaveBeenCalled();
    expect(projectService.addGeneratedAudioToTracks).not.toHaveBeenCalled();
  });

  it('shows Left, Right and quadratic Stereo for effective stereo PCM', async () => {
    vi.mocked(projectService.loadAudioChannels).mockResolvedValue([
      new Float32Array(200).fill(0.5), new Float32Array(200).fill(0.25),
    ]);
    renderEditor();
    await screen.findByText('Measure RMS integration');
    fireEvent.click(await openMeasureRms());

    expect(await screen.findByLabelText('Track A Left RMS')).toHaveTextContent('-6.0206 dB');
    expect(screen.getByLabelText('Track A Right RMS')).toHaveTextContent('-12.0412 dB');
    expect(screen.getByLabelText('Track A Stereo RMS')).toHaveTextContent('-8.0618 dB');
  });

  it('measures explicitly selected tracks independently in project order', async () => {
    renderEditor();
    await screen.findByText('Measure RMS integration');
    fireEvent.click(await screen.findByRole('button', { name: /^Clip A/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Clip B/ }), { shiftKey: true });
    fireEvent.click(await openMeasureRms());

    expect(await screen.findByLabelText('Track A Mono RMS')).toHaveTextContent('-6.0206 dB');
    expect(screen.getByLabelText('Track B Mono RMS')).toHaveTextContent('-12.0412 dB');
    expect(projectService.saveProject).not.toHaveBeenCalled();
    expect(historyManager.push).not.toHaveBeenCalled();
  });

  it('disables the command without a real time selection', async () => {
    const withoutSelection: IProject = { ...makeProject(), selection: null };
    vi.mocked(projectService.openProject).mockResolvedValue(withoutSelection);
    vi.mocked(projectService.getProject).mockResolvedValue(withoutSelection);
    renderEditor();
    await screen.findByText('Measure RMS integration');

    expect(await openMeasureRms()).toHaveAttribute('aria-disabled', 'true');
    expect(screen.queryByRole('dialog', { name: 'Measure RMS' })).not.toBeInTheDocument();
  });
});
