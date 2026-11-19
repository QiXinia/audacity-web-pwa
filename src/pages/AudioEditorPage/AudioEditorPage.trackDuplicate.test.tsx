import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IProject, ITrack } from '@/types/project';

const mocks = vi.hoisted(() => ({
  push: vi.fn(), success: vi.fn(), warning: vi.fn(), error: vi.fn(),
  duplicateTrack: vi.fn(), removeTrack: vi.fn(), loadChannels: vi.fn(),
}));
let mockProject: IProject;

function makeTrack(id: string, name: string): ITrack {
  return {
    id, name, type: 'audio', gain: -2, pan: 0.25, muted: false, solo: false, armed: false, color: '#123456',
    clips: [{
      id: `clip-${id}`, audioBufferId: `buffer-${id}`, startTime: 0, offset: 0,
      duration: 0.01, originalDuration: 0.01, stretchRatio: 1, gain: 0,
      fadeIn: 0, fadeOut: 0, name: `Clip ${id}`,
    }],
    effects: [],
  };
}

function makeProject(): IProject {
  return {
    id: 'track-duplicate-project', name: 'Track duplicate integration',
    tracks: [makeTrack('a', 'Alpha'), makeTrack('b', 'Beta'), makeTrack('c', 'Gamma')],
    cursorPosition: 0, selection: null,
    viewState: { horizontalZoom: 100, verticalZoom: 1, scrollX: 0, viewMode: 'waveform' },
    updatedAt: 100, createdAt: 50, sampleRate: 1000,
    timeSignature: { numerator: 4, denominator: 4 }, tempo: 120,
  };
}

function appendCopy(trackId: string): ITrack {
  const source = mockProject.tracks.find((track) => track.id === trackId)!;
  const copy = structuredClone(source);
  copy.id = `${trackId}-copy`;
  copy.clips = copy.clips.map((clip, index) => ({
    ...clip, id: `${clip.id}-copy-${index}`, audioBufferId: `${clip.audioBufferId}-copy`,
  }));
  mockProject = { ...mockProject, tracks: [...mockProject.tracks, copy] };
  return copy;
}

vi.mock('@/services/projectService', () => ({
  projectService: {
    getProject: vi.fn(async () => mockProject),
    openProject: vi.fn(async () => mockProject),
    duplicateTrack: mocks.duplicateTrack,
    removeTrack: mocks.removeTrack,
    loadAudioChannels: mocks.loadChannels,
    loadAudioBuffer: vi.fn(async () => new Float32Array(10)),
  },
}));
vi.mock('@/services/historyService', () => ({
  historyManager: {
    push: mocks.push, pushCommand: mocks.push,
    canUndo: vi.fn(() => false), canRedo: vi.fn(() => false),
    loadForProject: vi.fn(async () => 0), flush: vi.fn(async () => undefined),
    undo: vi.fn(), redo: vi.fn(), getUndoStack: vi.fn(() => []), getRedoStack: vi.fn(() => []),
    getHistoryState: vi.fn(() => ({ canUndo: false, canRedo: false, undoLabel: '', redoLabel: '' })),
    clearHistory: vi.fn(), flushPersistence: vi.fn(),
  },
}));
vi.mock('@/db/audioDb', () => ({
  audioDb: { audioBuffers: { get: vi.fn(), put: vi.fn(), delete: vi.fn() }, clipboard: {}, historySnapshots: {} },
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
    processClipChannels: vi.fn((_clip: unknown, source: Float32Array[]) => source.map((channel) => new Float32Array(channel))),
  },
}));
vi.mock('@/wasm/processor', () => ({ isWasmAvailable: vi.fn(() => false), wasmProcessor: {} }));
vi.mock('react-router-dom', () => ({ useParams: () => ({ projectId: 'track-duplicate-project' }), useNavigate: () => vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: mocks.success, warning: mocks.warning, error: mocks.error } }));
vi.mock('@/utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), log: vi.fn() } }));

import AudioEditorPage from './AudioEditorPage';

async function renderEditor(): Promise<void> {
  render(<AudioEditorPage />);
  expect(await screen.findByText('Track duplicate integration')).toBeInTheDocument();
}

async function duplicateFromMenu(trackId: string): Promise<void> {
  fireEvent.contextMenu(screen.getByTestId(`track-panel-row-${trackId}`));
  fireEvent.click(await screen.findByTestId('track-duplicate-menu'));
}

describe('AudioEditorPage Track context Duplicate track', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProject = makeProject();
    mocks.duplicateTrack.mockImplementation(async (_projectId: string, trackId: string) => appendCopy(trackId));
    mocks.removeTrack.mockImplementation(async (_projectId: string, trackId: string) => {
      mockProject = { ...mockProject, tracks: mockProject.tracks.filter((track) => track.id !== trackId) };
    });
    mocks.loadChannels.mockResolvedValue([Float32Array.from([0.2, 0.4])]);
  });

  afterEach(() => cleanup());

  it('duplicates the complete context track with one official history step', async () => {
    await renderEditor();
    await act(async () => { await duplicateFromMenu('b'); });

    await screen.findByTestId('track-panel-row-b-copy');
    expect(mocks.duplicateTrack).toHaveBeenCalledWith('track-duplicate-project', 'b');
    expect(screen.getAllByText('Beta')).toHaveLength(2);
    expect(mockProject.tracks.map((track) => track.id)).toEqual(['a', 'b', 'c', 'b-copy']);
    expect(mockProject.tracks[3]!.clips[0]).toMatchObject({
      startTime: 0, duration: 0.01, originalDuration: 0.01, stretchRatio: 1,
    });
    expect(mocks.push).toHaveBeenCalledTimes(1);
    expect(mocks.push.mock.calls[0]![0].label).toBe('Duplicate track');
    expect(mocks.success).toHaveBeenCalledWith('已复制轨道「Beta」');
  });

  it('duplicates an empty track through the same official entry', async () => {
    mockProject.tracks[1]!.clips = [];
    await renderEditor();
    await act(async () => { await duplicateFromMenu('b'); });

    await screen.findByTestId('track-panel-row-b-copy');
    expect(mockProject.tracks[3]!.clips).toEqual([]);
    expect(mocks.push).toHaveBeenCalledTimes(1);
  });

  it('keeps the visible project and creates no history when duplication fails', async () => {
    mocks.duplicateTrack.mockRejectedValue(new Error('storage unavailable'));
    await renderEditor();
    await act(async () => { await duplicateFromMenu('b'); });

    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith('storage unavailable'));
    fireEvent.contextMenu(screen.getByTestId('track-panel-row-b'));
    await waitFor(() => expect(screen.getByTestId('track-duplicate-menu')).not.toHaveAttribute('aria-disabled', 'true'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getAllByText('Beta')).toHaveLength(1);
    expect(screen.queryByTestId('track-panel-row-b-copy')).not.toBeInTheDocument();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('retargets selection and the effects panel when the duplicated source is deleted', async () => {
    await renderEditor();
    await act(async () => { await duplicateFromMenu('b'); });
    await screen.findByTestId('track-panel-row-b-copy');
    expect(screen.getByText('效果器 - Beta')).toBeInTheDocument();

    fireEvent.contextMenu(screen.getByTestId('track-panel-row-b'));
    await act(async () => {
      fireEvent.click(await screen.findByTestId('track-delete-menu'));
    });

    await waitFor(() => expect(screen.queryByTestId('track-panel-row-b')).not.toBeInTheDocument());
    expect(screen.getByTestId('track-panel-row-b-copy')).toBeInTheDocument();
    expect(screen.getByText('效果器 - Alpha')).toBeInTheDocument();
    expect(screen.queryByText('应用遇到错误')).not.toBeInTheDocument();
  });

  it('disables the entry while a duplicate is already pending', async () => {
    let resolveDuplicate!: (track: ITrack) => void;
    mocks.duplicateTrack.mockImplementation(() => new Promise<ITrack>((resolve) => {
      resolveDuplicate = resolve;
    }));
    await renderEditor();
    await duplicateFromMenu('b');
    await waitFor(() => expect(mocks.duplicateTrack).toHaveBeenCalledTimes(1));

    fireEvent.contextMenu(screen.getByTestId('track-panel-row-b'));
    const pendingItem = await screen.findByTestId('track-duplicate-menu');
    expect(pendingItem).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(pendingItem);
    expect(mocks.duplicateTrack).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveDuplicate(appendCopy('b'));
    });
    await screen.findByTestId('track-panel-row-b-copy');
    await waitFor(() => expect(screen.getByTestId('track-duplicate-menu')).not.toHaveAttribute('aria-disabled', 'true'));
    expect(mocks.push).toHaveBeenCalledTimes(1);
  });
});
