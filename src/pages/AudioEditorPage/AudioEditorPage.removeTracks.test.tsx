import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IProject, ITrack } from '@/types/project';

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  success: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
  saveProject: vi.fn(),
  loadChannels: vi.fn(),
  deleteBuffer: vi.fn(),
  setStateChangeCallback: vi.fn(),
}));
let mockProject: IProject;

function makeTrack(id: string): ITrack {
  const suffix = id.toUpperCase();
  return {
    id: `track-${id}`,
    name: `Track ${suffix}`,
    type: 'audio',
    gain: 0,
    pan: 0,
    muted: false,
    solo: false,
    armed: false,
    color: '',
    clips: [{
      id: `clip-${id}`,
      audioBufferId: `buffer-${id}`,
      startTime: 0,
      offset: 0,
      duration: 0.01,
      originalDuration: 0.01,
      stretchRatio: 1,
      gain: 0,
      fadeIn: 0,
      fadeOut: 0,
      name: `Clip ${suffix}`,
    }],
    effects: [],
  };
}

function makeProject(): IProject {
  return {
    id: 'remove-project',
    name: 'Remove integration',
    tracks: [makeTrack('a'), makeTrack('b'), makeTrack('c')],
    analysisLabels: ['a', 'b', 'c'].map((id, index) => ({
      id: `label-${id}`,
      kind: 'manual',
      trackId: `track-${id}`,
      start: index,
      end: index + 1,
      text: `Label ${id.toUpperCase()}`,
    })),
    cursorPosition: 0,
    selection: null,
    viewState: { horizontalZoom: 100, verticalZoom: 1, scrollX: 0, viewMode: 'waveform' },
    updatedAt: 100,
    createdAt: 50,
    sampleRate: 1000,
    timeSignature: { numerator: 4, denominator: 4 },
    tempo: 120,
  };
}

vi.mock('@/services/projectService', () => ({
  projectService: {
    getProject: vi.fn(async () => mockProject),
    openProject: vi.fn(async () => mockProject),
    saveProject: mocks.saveProject,
    loadAudioChannels: mocks.loadChannels,
    loadAudioBuffer: vi.fn(async () => new Float32Array(10)),
  },
}));
vi.mock('@/services/historyService', () => ({
  historyManager: {
    push: mocks.push,
    pushCommand: mocks.push,
    canUndo: vi.fn(() => false),
    canRedo: vi.fn(() => false),
    loadForProject: vi.fn(async () => 0),
    flush: vi.fn(async () => undefined),
    undo: vi.fn(), redo: vi.fn(),
    getUndoStack: vi.fn(() => []), getRedoStack: vi.fn(() => []),
    getHistoryState: vi.fn(() => ({ canUndo: false, canRedo: false, undoLabel: '', redoLabel: '' })),
    clearHistory: vi.fn(), flushPersistence: vi.fn(),
  },
}));
vi.mock('@/db/audioDb', () => ({
  audioDb: {
    audioBuffers: { get: vi.fn(), put: vi.fn(), delete: mocks.deleteBuffer },
    clipboard: {}, historySnapshots: {},
  },
  serializeTracks: (tracks: unknown) => JSON.stringify(tracks),
  deserializeTracks: (data: string) => JSON.parse(data),
  serializeSelection: vi.fn(), deserializeSelection: vi.fn(),
}));
vi.mock('@/engine/audioEngine', () => ({
  audioEngine: {
    subscribe: vi.fn(() => () => {}),
    getPlaybackState: vi.fn(() => 'stopped'),
    getRecordingState: vi.fn(() => 'inactive'),
    getCurrentTime: vi.fn(() => 0),
    playTracks: vi.fn(), stopPlayback: vi.fn(), pausePlayback: vi.fn(), resumePlayback: vi.fn(),
    seek: vi.fn(), startRecording: vi.fn(), stopRecording: vi.fn(), cancelRecording: vi.fn(),
    initialize: vi.fn(), getLevel: vi.fn(() => 0), cacheBuffer: vi.fn(), evictBuffer: vi.fn(),
    getPlaybackLevels: vi.fn(() => ({ left: -Infinity, right: -Infinity })),
    getRecordingLevels: vi.fn(() => ({ left: -Infinity, right: -Infinity })),
    setCursorChangeCallback: vi.fn(), setStateChangeCallback: mocks.setStateChangeCallback,
    setPlaybackCompleteCallback: vi.fn(), setTracksEndCallback: vi.fn(),
    processClipChannels: vi.fn((_clip: unknown, source: Float32Array[]) => source.map((channel) => new Float32Array(channel))),
  },
}));
vi.mock('@/wasm/processor', () => ({ isWasmAvailable: vi.fn(() => false), wasmProcessor: {} }));
vi.mock('react-router-dom', () => ({ useParams: () => ({ projectId: 'remove-project' }), useNavigate: () => vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: mocks.success, warning: mocks.warning, error: mocks.error } }));
vi.mock('@/utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), log: vi.fn() } }));

import AudioEditorPage from './AudioEditorPage';

async function renderEditor(): Promise<void> {
  render(<AudioEditorPage />);
  expect(await screen.findByText('Remove integration')).toBeInTheDocument();
}

async function openRemoveMenuItem(): Promise<HTMLElement> {
  fireEvent.pointerDown(screen.getByRole('button', { name: '轨道' }));
  return screen.findByText('Remove Tracks 移除轨道');
}

function savedProject(): IProject {
  return mocks.saveProject.mock.calls[0]![0] as IProject;
}

describe('AudioEditorPage Remove Tracks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProject = makeProject();
    mocks.saveProject.mockImplementation(async (project: IProject) => {
      mockProject = project;
    });
    mocks.loadChannels.mockResolvedValue([Float32Array.from([0.2, 0.4])]);
  });

  afterEach(() => cleanup());

  it('removes only the selected track, filters its labels, and applies the official next-track focus', async () => {
    await renderEditor();
    fireEvent.click(await screen.findByRole('button', { name: /^Clip B/ }));
    fireEvent.click(await openRemoveMenuItem());

    await waitFor(() => expect(mocks.saveProject).toHaveBeenCalledTimes(1));
    expect(savedProject().tracks.map((track) => track.id)).toEqual(['track-a', 'track-c']);
    expect(savedProject().analysisLabels?.map((label) => label.trackId)).toEqual(['track-a', 'track-c']);
    expect(mocks.deleteBuffer).not.toHaveBeenCalled();
    expect(mocks.push).toHaveBeenCalledTimes(1);
    expect(mocks.push.mock.calls[0]![0].label).toBe('Remove Track');
    expect(screen.queryByText('Track B')).not.toBeInTheDocument();
    expect(screen.getByText('Track C').closest('.au-panel')?.className).toContain('shadow-[inset_0_0_0_1px_#84b5ff]');
  });

  it('removes a Shift multi-selection in one save and one history step', async () => {
    await renderEditor();
    fireEvent.click(await screen.findByRole('button', { name: /^Clip A/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Clip B/ }), { shiftKey: true });
    fireEvent.click(await openRemoveMenuItem());

    await waitFor(() => expect(mocks.saveProject).toHaveBeenCalledTimes(1));
    expect(savedProject().tracks.map((track) => track.id)).toEqual(['track-c']);
    expect(savedProject().analysisLabels?.map((label) => label.trackId)).toEqual(['track-c']);
    expect(mocks.push).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Track C')).toBeInTheDocument();
  });

  it('allows removing every selected track and shows the empty project state', async () => {
    await renderEditor();
    fireEvent.click(await screen.findByRole('button', { name: /^Clip A/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Clip C/ }), { shiftKey: true });
    fireEvent.click(await openRemoveMenuItem());

    await waitFor(() => expect(mocks.saveProject).toHaveBeenCalledTimes(1));
    expect(savedProject().tracks).toEqual([]);
    expect(savedProject().analysisLabels).toEqual([]);
    expect(await screen.findByText('空工程')).toBeInTheDocument();
    expect(mocks.push).toHaveBeenCalledTimes(1);
    expect(await openRemoveMenuItem()).toHaveAttribute('aria-disabled', 'true');
  });

  it('disables the command when there is no selected track', async () => {
    mockProject = { ...mockProject, tracks: [], analysisLabels: [] };
    await renderEditor();
    expect(await openRemoveMenuItem()).toHaveAttribute('aria-disabled', 'true');
    expect(mocks.saveProject).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('disables the command while audio is busy', async () => {
    await renderEditor();
    const onPlaybackStateChange = mocks.setStateChangeCallback.mock.calls.at(-1)![0] as (state: string) => void;
    act(() => onPlaybackStateChange('playing'));
    expect(await openRemoveMenuItem()).toHaveAttribute('aria-disabled', 'true');
    expect(mocks.saveProject).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('keeps visible tracks and creates no history when saving fails', async () => {
    mocks.saveProject.mockRejectedValue(new Error('storage unavailable'));
    await renderEditor();
    fireEvent.click(await screen.findByRole('button', { name: /^Clip B/ }));
    fireEvent.click(await openRemoveMenuItem());

    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith('storage unavailable'));
    expect(mocks.saveProject).toHaveBeenCalledTimes(1);
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.deleteBuffer).not.toHaveBeenCalled();
    expect(screen.getByText('Track B')).toBeInTheDocument();
  });
});
