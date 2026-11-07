// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import AudioEditorPage from '@/pages/AudioEditorPage/AudioEditorPage';
import { projectService } from '@/services/projectService';
import { historyManager } from '@/services/historyService';
import type { IClip, IProject } from '@/types/project';

vi.mock('@/services/projectService', () => ({
  projectService: {
    openProject: vi.fn(),
    getProject: vi.fn(),
    addRecordingToTrack: vi.fn(),
    saveProject: vi.fn(),
  },
}));

vi.mock('@/services/historyService', () => ({
  historyManager: {
    loadForProject: vi.fn(),
    canUndo: vi.fn(),
    canRedo: vi.fn(),
    getUndoLabel: vi.fn(),
    getRedoLabel: vi.fn(),
    push: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    flush: vi.fn(),
  },
}));

vi.mock('@/engine/audioEngine', () => ({
  audioEngine: {
    setCursorChangeCallback: vi.fn(),
    setStateChangeCallback: vi.fn(),
    getPlaybackLevels: vi.fn(() => ({ left: -Infinity, right: -Infinity })),
    getRecordingLevels: vi.fn(() => ({ left: -Infinity, right: -Infinity })),
    cacheBuffer: vi.fn(),
    processClipChannels: vi.fn(),
  },
}));

vi.mock('@/wasm/processor', () => ({
  isWasmAvailable: vi.fn(() => false),
  wasmProcessor: {
    spectrogram: vi.fn(),
    sliceBuffer: vi.fn(),
  },
}));

function createProject(selection: IProject['selection'] = null): IProject {
  return {
    id: 'project-tone-command',
    name: 'Tone command integration',
    createdAt: 1,
    updatedAt: 1,
    sampleRate: 1000,
    tempo: 120,
    timeSignature: { numerator: 4, denominator: 4 },
    cursorPosition: 0,
    tracks: [{
      id: 'track-1',
      name: 'Track 1',
      type: 'audio',
      clips: [],
      muted: false,
      solo: false,
      armed: false,
      gain: 0,
      pan: 0,
      effects: [],
      color: '#7aa2f7',
    }],
    viewState: {
      horizontalZoom: 100,
      verticalZoom: 1,
      scrollX: 0,
      viewMode: 'waveform',
      snapEnabled: false,
      snapMode: 'clips',
    },
    selection,
    loopRegion: null,
    loopEnabled: false,
  };
}

function renderEditor() {
  return render(
    <MemoryRouter initialEntries={['/editor/project-tone-command']}>
      <Routes>
        <Route path="/editor/:projectId" element={<AudioEditorPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

async function openToneDialog() {
  await screen.findByText('Tone command integration');
  const trigger = screen.getByRole('button', { name: '生成' });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  fireEvent.click(await screen.findByText('音调…'));
  return screen.findByRole('dialog');
}

beforeEach(() => {
  vi.mocked(historyManager.loadForProject).mockResolvedValue(0);
  vi.mocked(historyManager.canUndo).mockReturnValue(false);
  vi.mocked(historyManager.canRedo).mockReturnValue(false);
  vi.mocked(historyManager.getUndoLabel).mockReturnValue(null);
  vi.mocked(historyManager.getRedoLabel).mockReturnValue(null);
  vi.mocked(historyManager.flush).mockResolvedValue(undefined);
  vi.mocked(projectService.saveProject).mockResolvedValue(undefined);
  vi.mocked(projectService.addRecordingToTrack).mockResolvedValue({
    id: 'generated-clip',
    audioBufferId: 'generated-buffer',
    startTime: 0,
    offset: 0,
    duration: 0.01,
    originalDuration: 0.01,
    stretchRatio: 1,
    gain: 0,
    fadeIn: 0,
    fadeOut: 0,
    name: '音调',
  } satisfies IClip);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('AudioEditorPage tone command integration', () => {
  it('passes dialog parameters through the Generate menu to projectService', async () => {
    const project = createProject();
    vi.mocked(projectService.openProject).mockResolvedValue(project);
    vi.mocked(projectService.getProject).mockResolvedValue(project);
    renderEditor();
    await openToneDialog();

    fireEvent.change(screen.getByLabelText('频率 (Hz)'), { target: { value: '220' } });
    fireEvent.change(screen.getByLabelText('振幅 (0–1)'), { target: { value: '0.25' } });
    fireEvent.change(screen.getByLabelText('时长（秒）'), { target: { value: '0.01' } });
    fireEvent.click(screen.getByRole('button', { name: '生成音调' }));

    await waitFor(() => expect(projectService.addRecordingToTrack).toHaveBeenCalledTimes(1));
    const [projectId, trackId, channels, sampleRate, startTime, clipName, replacement] =
      vi.mocked(projectService.addRecordingToTrack).mock.calls[0];
    expect(projectId).toBe(project.id);
    expect(trackId).toBe('track-1');
    expect(sampleRate).toBe(1000);
    expect(startTime).toBe(0);
    expect(clipName).toBe('音调 220 Hz');
    expect(replacement).toBeUndefined();
    expect(channels).toHaveLength(1);
    expect(channels[0]).toHaveLength(10);
    expect(Math.max(...channels[0])).toBeLessThanOrEqual(0.25);
    await waitFor(() => expect(projectService.getProject).toHaveBeenCalledWith(project.id));
    expect(historyManager.push).toHaveBeenCalled();
  });

  it('locks the dialog to a sample-quantized selection and replaces that exact range', async () => {
    const project = createProject({ start: 0.1004, end: 0.2996 });
    vi.mocked(projectService.openProject).mockResolvedValue(project);
    vi.mocked(projectService.getProject).mockResolvedValue(project);
    renderEditor();
    await openToneDialog();

    const duration = screen.getByLabelText('时长（秒）') as HTMLInputElement;
    await waitFor(() => expect(duration.value).toBe('0.2'));
    expect(duration.readOnly).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '生成音调' }));

    await waitFor(() => expect(projectService.addRecordingToTrack).toHaveBeenCalledTimes(1));
    const [, , channels, sampleRate, startTime, , replacement] =
      vi.mocked(projectService.addRecordingToTrack).mock.calls[0];
    expect(sampleRate).toBe(1000);
    expect(startTime).toBe(0.1);
    expect(replacement).toEqual({ start: 0.1, end: 0.3 });
    expect(channels[0]).toHaveLength(200);
    await waitFor(() => expect(projectService.getProject).toHaveBeenCalledWith(project.id));
  });
});
