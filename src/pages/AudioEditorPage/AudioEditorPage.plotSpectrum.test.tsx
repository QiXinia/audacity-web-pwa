// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import AudioEditorPage from './AudioEditorPage';
import { projectService } from '@/services/projectService';
import { historyManager } from '@/services/historyService';
import type { IClip, IProject } from '@/types/project';
import type { PlotSpectrumAnalysisProgress, PlotSpectrumOptions } from '@/lib/plotSpectrum';

const mocks = vi.hoisted(() => ({
  analyze: vi.fn(),
  processClip: vi.fn(),
}));

vi.mock('@/lib/plotSpectrum', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/plotSpectrum')>();
  return {
    ...actual,
    analyzePlotSpectrum: (data: Float32Array, options: PlotSpectrumOptions) => {
      mocks.analyze(data, options);
      return actual.analyzePlotSpectrum(data, options);
    },
    analyzePlotSpectrumWithProgress: async (
      data: Float32Array,
      options: PlotSpectrumOptions,
      onProgress: PlotSpectrumAnalysisProgress,
      signal?: AbortSignal,
    ) => {
      mocks.analyze(data, options);
      return actual.analyzePlotSpectrumWithProgress(data, options, onProgress, signal);
    },
  };
});

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
    cacheBuffer: vi.fn(), processClipChannels: mocks.processClip,
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
    duration: 0.128, originalDuration: 0.256, stretchRatio: 2,
    gain: 0, fadeIn: 0, fadeOut: 0, name: `Clip ${id.toUpperCase()}`,
  };
}

function makeProject(): IProject {
  return {
    id: 'project-plot-spectrum', name: 'Plot Spectrum integration', createdAt: 1, updatedAt: 1,
    sampleRate: 8000, tempo: 120, timeSignature: { numerator: 4, denominator: 4 }, cursorPosition: 0,
    tracks: [
      { id: 'track-a', name: 'Track A', type: 'audio', clips: [makeClip('a')], muted: false, solo: false, armed: false, gain: 0, pan: 0, effects: [], color: '#7aa2f7' },
      { id: 'track-b', name: 'Track B', type: 'audio', clips: [makeClip('b')], muted: false, solo: false, armed: false, gain: 0, pan: 0, effects: [], color: '#7aa2f7' },
    ],
    viewState: { horizontalZoom: 100, verticalZoom: 1, scrollX: 0, viewMode: 'waveform', snapEnabled: false, snapMode: 'clips' },
    selection: { start: 0, end: 0.128 }, loopRegion: null, loopEnabled: false,
  };
}

function renderEditor() {
  render(<MemoryRouter initialEntries={['/editor/project-plot-spectrum']}><Routes><Route path="/editor/:projectId" element={<AudioEditorPage />} /></Routes></MemoryRouter>);
}

async function openAnalysisMenu() {
  const trigger = await screen.findByRole('button', { name: '分析' });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  return screen.findByRole('menuitem', { name: 'Plot Spectrum… 频谱分析…' });
}

beforeEach(() => {
  window.localStorage.clear();
  const project = makeProject();
  vi.mocked(projectService.openProject).mockResolvedValue(project);
  vi.mocked(projectService.getProject).mockResolvedValue(project);
  vi.mocked(projectService.saveProject).mockResolvedValue(undefined);
  vi.mocked(projectService.loadAudioBuffer).mockResolvedValue(null);
  vi.mocked(projectService.loadAudioChannels).mockImplementation(async (id: string) => {
    if (id === 'buffer-a') return [new Float32Array(2048).fill(0.1), new Float32Array(2048).fill(0.2)];
    return [new Float32Array(2048).fill(0.4)];
  });
  mocks.processClip.mockImplementation((_clip: IClip, channels: Float32Array[]) =>
    channels.map((channel) => channel.slice(0, 1024).map((value) => value * 2)));
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

describe('AudioEditorPage Plot Spectrum integration', () => {
  it('uses Shift-selected tracks and stretched effective stereo PCM without project or history writes', async () => {
    renderEditor();
    await screen.findByText('Plot Spectrum integration');
    fireEvent.click(await screen.findByRole('button', { name: /^Clip A/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Clip B/ }), { shiftKey: true });
    fireEvent.click(await openAnalysisMenu());

    expect(await screen.findByRole('img', { name: /Spectrum 频谱分析图，1 个分析窗/ })).toBeInTheDocument();
    expect(projectService.loadAudioChannels).toHaveBeenCalledWith('buffer-a');
    expect(projectService.loadAudioChannels).toHaveBeenCalledWith('buffer-b');
    expect(mocks.processClip).toHaveBeenCalledTimes(2);
    expect(mocks.analyze).toHaveBeenCalled();
    const [samples, options] = mocks.analyze.mock.calls[0] as [Float32Array, PlotSpectrumOptions];
    expect(samples).toHaveLength(1024);
    expect(options).toMatchObject({ algorithm: 'spectrum', size: 1024, window: 'hann', sampleRate: 8000 });
    expect(Array.from(samples).every((value) => Math.abs(value - 1.4) < 1e-6)).toBe(true);
    expect(screen.getByText(/1024 个采样 · 2 轨/)).toBeInTheDocument();
    expect(historyManager.push).not.toHaveBeenCalled();
    expect(projectService.saveProject).not.toHaveBeenCalled();
    expect(projectService.addGeneratedAudioToTracks).not.toHaveBeenCalled();
  });

  it('disables Plot Spectrum when no real time selection exists', async () => {
    const withoutSelection: IProject = { ...makeProject(), selection: null };
    vi.mocked(projectService.openProject).mockResolvedValue(withoutSelection);
    vi.mocked(projectService.getProject).mockResolvedValue(withoutSelection);
    renderEditor();
    await screen.findByText('Plot Spectrum integration');
    expect(await openAnalysisMenu()).toHaveAttribute('aria-disabled', 'true');
    expect(mocks.analyze).not.toHaveBeenCalled();
  });
});
