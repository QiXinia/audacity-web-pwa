// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import AudioEditorPage from './AudioEditorPage';
import { projectService } from '@/services/projectService';
import { historyManager } from '@/services/historyService';
import type { IClip, IProject } from '@/types/project';

const mocks = vi.hoisted(() => ({
  processClip: vi.fn(),
  gain: 2,
}));

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
    id: 'project-contrast', name: 'Contrast integration', createdAt: 1, updatedAt: 1,
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
  render(<MemoryRouter initialEntries={['/editor/project-contrast']}><Routes><Route path="/editor/:projectId" element={<AudioEditorPage />} /></Routes></MemoryRouter>);
}

async function openAnalysisMenu() {
  const trigger = await screen.findByRole('button', { name: '分析' });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  return screen.findByRole('menuitem', { name: 'Contrast… 对比度分析…' });
}

beforeEach(() => {
  window.localStorage.clear();
  mocks.gain = 2;
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
    channels.map((channel) => channel.slice(0, 1024).map((value) => value * mocks.gain)));
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

describe('AudioEditorPage Contrast Analyzer integration', () => {
  it('measures one selected track twice from effective stereo PCM without project writes', async () => {
    renderEditor();
    await screen.findByText('Contrast integration');
    fireEvent.click(await screen.findByRole('button', { name: /^Clip A/ }));
    fireEvent.click(await openAnalysisMenu());

    fireEvent.click(await screen.findByRole('button', { name: 'Measure foreground selection' }));
    await waitFor(() => expect(screen.getByLabelText('Foreground volume')).toHaveTextContent('-10.00 dB'));
    expect(projectService.loadAudioChannels).toHaveBeenCalledWith('buffer-a');
    expect(projectService.loadAudioChannels).not.toHaveBeenCalledWith('buffer-b');

    mocks.gain = 0.02;
    fireEvent.click(screen.getByRole('button', { name: 'Measure background selection' }));
    await waitFor(() => expect(screen.getByLabelText('Contrast Result')).toHaveTextContent('WCAG2 Pass'));
    expect(screen.getByLabelText('Background volume')).toHaveTextContent('-50.00 dB');
    expect(screen.getByLabelText('Difference')).toHaveTextContent('40.00 dB RMS');
    expect(mocks.processClip).toHaveBeenCalledTimes(2);
    expect(historyManager.push).not.toHaveBeenCalled();
    expect(projectService.saveProject).not.toHaveBeenCalled();
    expect(projectService.addGeneratedAudioToTracks).not.toHaveBeenCalled();
  });

  it('rejects Shift multi-track measurement with an explicit diagnostic', async () => {
    renderEditor();
    await screen.findByText('Contrast integration');
    fireEvent.click(await screen.findByRole('button', { name: /^Clip A/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Clip B/ }), { shiftKey: true });
    fireEvent.click(await openAnalysisMenu());
    fireEvent.click(await screen.findByRole('button', { name: 'Measure foreground selection' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('一次只能测量一条音频轨道');
    expect(projectService.loadAudioChannels).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Contrast Result')).toBeEmptyDOMElement();
  });

  it('opens the attached analyzer with Ctrl+Shift+T', async () => {
    renderEditor();
    await screen.findByText('Contrast integration');
    fireEvent.keyDown(window, { key: 'T', ctrlKey: true, shiftKey: true });
    expect(await screen.findByRole('dialog', { name: 'Contrast Analysis (WCAG 2 compliance)' })).toBeInTheDocument();
  });

  it('disables the command without a real time selection', async () => {
    const withoutSelection: IProject = { ...makeProject(), selection: null };
    vi.mocked(projectService.openProject).mockResolvedValue(withoutSelection);
    vi.mocked(projectService.getProject).mockResolvedValue(withoutSelection);
    renderEditor();
    await screen.findByText('Contrast integration');
    expect(await openAnalysisMenu()).toHaveAttribute('aria-disabled', 'true');
    fireEvent.keyDown(window, { key: 't', ctrlKey: true, shiftKey: true });
    expect(screen.queryByRole('dialog', { name: 'Contrast Analysis (WCAG 2 compliance)' })).not.toBeInTheDocument();
  });
});
