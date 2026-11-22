import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IProject } from '@/types/project';

const mocks = vi.hoisted(() => ({
  addTrack: vi.fn(),
  updateTrack: vi.fn(),
  removeTrack: vi.fn(),
  push: vi.fn(),
  error: vi.fn(),
}));

let mockProject: IProject;

function makeProject(): IProject {
  return {
    id: 'track-rollback-project',
    name: 'Track rollback integration',
    tracks: [{
      id: 'track-a', name: 'Alpha', type: 'audio', gain: 0, pan: 0,
      muted: false, solo: false, armed: false, color: '', clips: [], effects: [],
    }],
    cursorPosition: 0,
    selection: null,
    viewState: { horizontalZoom: 100, verticalZoom: 1, scrollX: 0, viewMode: 'waveform' },
    updatedAt: 100,
    createdAt: 50,
    sampleRate: 44100,
    timeSignature: { numerator: 4, denominator: 4 },
    tempo: 120,
  };
}

vi.mock('@/services/projectService', () => ({
  projectService: {
    getProject: vi.fn(async () => mockProject),
    openProject: vi.fn(async () => mockProject),
    addTrack: mocks.addTrack,
    updateTrack: mocks.updateTrack,
    removeTrack: mocks.removeTrack,
    loadAudioChannels: vi.fn(async () => [new Float32Array(0)]),
    loadAudioBuffer: vi.fn(async () => new Float32Array(0)),
  },
}));
vi.mock('@/services/historyService', () => ({
  historyManager: {
    push: mocks.push, pushCommand: mocks.push, canUndo: vi.fn(() => false), canRedo: vi.fn(() => false),
    loadForProject: vi.fn(async () => 0), flush: vi.fn(async () => undefined),
    undo: vi.fn(), redo: vi.fn(), getUndoStack: vi.fn(() => []), getRedoStack: vi.fn(() => []),
    getHistoryState: vi.fn(() => ({ canUndo: false, canRedo: false, undoLabel: '', redoLabel: '' })),
    clearHistory: vi.fn(), flushPersistence: vi.fn(),
  },
}));
vi.mock('@/db/audioDb', () => ({
  audioDb: { audioBuffers: { get: vi.fn() }, clipboard: {}, historySnapshots: {} },
  serializeTracks: (tracks: unknown) => JSON.stringify(tracks),
  deserializeTracks: (data: string) => JSON.parse(data),
  serializeSelection: vi.fn(), deserializeSelection: vi.fn(),
}));
vi.mock('@/engine/audioEngine', () => ({
  audioEngine: {
    subscribe: vi.fn(() => () => {}), getPlaybackState: vi.fn(() => 'stopped'),
    getRecordingState: vi.fn(() => 'inactive'), getCurrentTime: vi.fn(() => 0),
    playTracks: vi.fn(), stopPlayback: vi.fn(), pausePlayback: vi.fn(), resumePlayback: vi.fn(),
    seek: vi.fn(), startRecording: vi.fn(), stopRecording: vi.fn(), cancelRecording: vi.fn(),
    initialize: vi.fn(), getLevel: vi.fn(() => 0), cacheBuffer: vi.fn(), evictBuffer: vi.fn(),
    getPlaybackLevels: vi.fn(() => ({ left: -Infinity, right: -Infinity })),
    getRecordingLevels: vi.fn(() => ({ left: -Infinity, right: -Infinity })),
    setCursorChangeCallback: vi.fn(), setStateChangeCallback: vi.fn(),
    setPlaybackCompleteCallback: vi.fn(), setTracksEndCallback: vi.fn(),
    processClipChannels: vi.fn((_clip: unknown, source: Float32Array[]) => source),
  },
}));
vi.mock('@/wasm/processor', () => ({ isWasmAvailable: vi.fn(() => false), wasmProcessor: {} }));
vi.mock('react-router-dom', () => ({
  useParams: () => ({ projectId: 'track-rollback-project' }),
  useNavigate: () => vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: mocks.error } }));
vi.mock('@/utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), log: vi.fn() } }));

import AudioEditorPage from './AudioEditorPage';

async function renameTrack(name: string): Promise<void> {
  fireEvent.contextMenu(await screen.findByTestId('track-panel-row-track-a'));
  fireEvent.click(await screen.findByTestId('track-rename-menu'));
  const input = await screen.findByLabelText('轨道名称');
  fireEvent.change(input, { target: { value: name } });
  await act(async () => {
    fireEvent.keyDown(input, { key: 'Enter' });
  });
}

describe('AudioEditorPage track mutation rollback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProject = makeProject();
    mocks.addTrack.mockImplementation(async () => {
      const newTrack = { ...mockProject.tracks[0]!, id: 'track-b', name: 'Beta' };
      mockProject = { ...mockProject, tracks: [...mockProject.tracks, newTrack] };
      return newTrack;
    });
    mocks.removeTrack.mockImplementation(async (_projectId: string, trackId: string) => {
      mockProject = {
        ...mockProject,
        tracks: mockProject.tracks.filter((track) => track.id !== trackId),
      };
    });
  });

  afterEach(() => cleanup());

  it('does not render an uncommitted track update when permanent deletion wins', async () => {
    mocks.updateTrack.mockResolvedValue(null);
    render(<AudioEditorPage />);
    expect(await screen.findByText('Track rollback integration')).toBeInTheDocument();

    await renameTrack('Unsaved rename');

    await waitFor(() => expect(mocks.updateTrack).toHaveBeenCalledWith(
      'track-rollback-project', 'track-a', { name: 'Unsaved rename' },
    ));
    expect(await screen.findByText('Alpha')).toBeInTheDocument();
    expect(screen.queryByText('Unsaved rename')).not.toBeInTheDocument();
  });

  it('renders the exact immutable project returned by a successful update', async () => {
    mocks.updateTrack.mockImplementation(async () => ({
      ...mockProject,
      tracks: [{ ...mockProject.tracks[0]!, name: 'Committed rename' }],
    }));
    render(<AudioEditorPage />);
    expect(await screen.findByText('Track rollback integration')).toBeInTheDocument();

    await renameTrack('Committed rename');

    expect(await screen.findByText('Committed rename')).toBeInTheDocument();
    expect(screen.queryByText('Alpha')).not.toBeInTheDocument();
  });

  it('handles a rejected track update, preserves the visible track, and allows a retry', async () => {
    mocks.updateTrack.mockRejectedValueOnce(new Error('update storage unavailable'));
    render(<AudioEditorPage />);
    expect(await screen.findByText('Track rollback integration')).toBeInTheDocument();

    await renameTrack('Rejected rename');

    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith(
      '轨道更新失败：update storage unavailable',
    ));
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.queryByText('Rejected rename')).not.toBeInTheDocument();

    mocks.updateTrack.mockImplementationOnce(async () => ({
      ...mockProject,
      tracks: [{ ...mockProject.tracks[0]!, name: 'Recovered rename' }],
    }));
    await renameTrack('Recovered rename');

    expect(await screen.findByText('Recovered rename')).toBeInTheDocument();
    expect(mocks.updateTrack).toHaveBeenCalledTimes(2);
    expect(mocks.error).toHaveBeenCalledTimes(1);
  });

  it('handles a rejected track addition without history and commits a later retry', async () => {
    mocks.addTrack.mockRejectedValueOnce(new Error('add storage unavailable'));
    render(<AudioEditorPage />);
    expect(await screen.findByText('Track rollback integration')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '添加轨道' }));
    });

    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith(
      '添加轨道失败：add storage unavailable',
    ));
    expect(screen.getByTestId('track-panel-row-track-a')).toBeInTheDocument();
    expect(screen.queryByTestId('track-panel-row-track-b')).not.toBeInTheDocument();
    expect(mocks.push).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '添加轨道' }));
    });

    expect(await screen.findByTestId('track-panel-row-track-b')).toBeInTheDocument();
    expect(mocks.addTrack).toHaveBeenCalledTimes(2);
    expect(mocks.push).toHaveBeenCalledTimes(1);
    expect(mocks.push.mock.calls[0]![0].label).toBe('添加轨道');
    expect(mocks.error).toHaveBeenCalledTimes(1);
  });

  it('handles a rejected track deletion without history and commits a later retry', async () => {
    mocks.removeTrack.mockRejectedValueOnce(new Error('delete storage unavailable'));
    render(<AudioEditorPage />);
    expect(await screen.findByText('Track rollback integration')).toBeInTheDocument();

    fireEvent.contextMenu(screen.getByTestId('track-panel-row-track-a'));
    await act(async () => {
      fireEvent.click(await screen.findByTestId('track-delete-menu'));
    });

    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith(
      '删除轨道失败：delete storage unavailable',
    ));
    expect(screen.getByTestId('track-panel-row-track-a')).toBeInTheDocument();
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(mocks.push).not.toHaveBeenCalled();

    fireEvent.contextMenu(screen.getByTestId('track-panel-row-track-a'));
    await act(async () => {
      fireEvent.click(await screen.findByTestId('track-delete-menu'));
    });

    expect(await screen.findByText('空工程')).toBeInTheDocument();
    expect(mocks.removeTrack).toHaveBeenCalledTimes(2);
    expect(mocks.push).toHaveBeenCalledTimes(1);
    expect(mocks.push.mock.calls[0]![0].label).toBe('删除轨道');
    expect(mocks.error).toHaveBeenCalledTimes(1);
  });
});
