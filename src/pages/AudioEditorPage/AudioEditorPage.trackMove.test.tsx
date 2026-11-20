import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IProject, ITrack } from '@/types/project';
import { moveTrackInOrder, type TrackMoveDirection } from '@/lib/trackMove';

const mocks = vi.hoisted(() => ({
  push: vi.fn(), success: vi.fn(), warning: vi.fn(), error: vi.fn(),
  saveProject: vi.fn(), moveTrack: vi.fn(), updateTrack: vi.fn(), loadChannels: vi.fn(),
}));
let mockProject: IProject;

function makeTrack(id: string, name: string): ITrack {
  return {
    id, name, type: 'audio', gain: 0, pan: 0, muted: false, solo: false, armed: false, color: '',
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
    id: 'track-move-project', name: 'Track move integration',
    tracks: [makeTrack('a', 'Alpha'), makeTrack('b', 'Beta'), makeTrack('c', 'Gamma')],
    cursorPosition: 0, selection: null,
    viewState: { horizontalZoom: 100, verticalZoom: 1, scrollX: 0, viewMode: 'waveform' },
    updatedAt: 100, createdAt: 50, sampleRate: 1000,
    timeSignature: { numerator: 4, denominator: 4 }, tempo: 120,
  };
}

vi.mock('@/services/projectService', () => ({
  projectService: {
    getProject: vi.fn(async () => mockProject),
    openProject: vi.fn(async () => mockProject),
    saveProject: mocks.saveProject,
    moveTrack: mocks.moveTrack,
    updateTrack: mocks.updateTrack,
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
vi.mock('react-router-dom', () => ({ useParams: () => ({ projectId: 'track-move-project' }), useNavigate: () => vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: mocks.success, warning: mocks.warning, error: mocks.error } }));
vi.mock('@/utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), log: vi.fn() } }));

import AudioEditorPage from './AudioEditorPage';

async function renderEditor(): Promise<void> {
  render(<AudioEditorPage />);
  expect(await screen.findByText('Track move integration')).toBeInTheDocument();
}

async function openMoveMenu(trackId: string): Promise<void> {
  fireEvent.contextMenu(screen.getByTestId(`track-panel-row-${trackId}`));
  fireEvent.keyDown(await screen.findByTestId('track-move-submenu'), { key: 'ArrowRight' });
}

function expectVisibleOrder(names: string[]): void {
  const elements = names.map((name) => screen.getByText(name));
  for (let index = 0; index < elements.length - 1; index += 1) {
    expect(elements[index]!.compareDocumentPosition(elements[index + 1]!) & 4).toBeTruthy();
  }
}

describe('AudioEditorPage Track context movement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProject = makeProject();
    mocks.saveProject.mockImplementation(async (project: IProject) => { mockProject = project; });
    mocks.moveTrack.mockImplementation(async (
      _projectId: string,
      trackId: string,
      direction: TrackMoveDirection,
    ) => {
      const before = structuredClone(mockProject);
      const ordered = moveTrackInOrder(mockProject.tracks, trackId, direction);
      if (ordered.every((track, index) => track.id === mockProject.tracks[index]?.id)) return null;
      const after = { ...mockProject, tracks: ordered };
      mockProject = after;
      return { before, after };
    });
    mocks.updateTrack.mockImplementation(async (_projectId: string, trackId: string, updates: Partial<ITrack>) => {
      mockProject = {
        ...mockProject,
        tracks: mockProject.tracks.map((track) => track.id === trackId ? { ...track, ...updates } : track),
      };
    });
    mocks.loadChannels.mockResolvedValue([Float32Array.from([0.2, 0.4])]);
  });

  afterEach(() => cleanup());

  it('moves the context track up with one save and one official history step', async () => {
    await renderEditor();
    await openMoveMenu('b');
    fireEvent.click(await screen.findByTestId('track-move-up-menu'));

    await waitFor(() => expect(mocks.moveTrack).toHaveBeenCalledTimes(1));
    expect(mockProject.tracks.map((track) => track.id)).toEqual(['b', 'a', 'c']);
    expectVisibleOrder(['Beta', 'Alpha', 'Gamma']);
    expect(mocks.push).toHaveBeenCalledTimes(1);
    expect(mocks.push.mock.calls[0]![0].label).toBe('Move track');
  });

  it('moves to top and bottom through the real submenu', async () => {
    await renderEditor();
    await openMoveMenu('c');
    fireEvent.click(await screen.findByTestId('track-move-top-menu'));
    await waitFor(() => expect(mockProject.tracks.map((track) => track.id)).toEqual(['c', 'a', 'b']));

    await openMoveMenu('c');
    fireEvent.click(await screen.findByTestId('track-move-bottom-menu'));
    await waitFor(() => expect(mockProject.tracks.map((track) => track.id)).toEqual(['a', 'b', 'c']));
    expect(mocks.moveTrack).toHaveBeenCalledTimes(2);
    expect(mocks.push).toHaveBeenCalledTimes(2);
  });

  it('disables impossible first/last-track commands without creating history', async () => {
    await renderEditor();
    await openMoveMenu('a');
    expect(await screen.findByTestId('track-move-up-menu')).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByTestId('track-move-top-menu')).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByTestId('track-move-down-menu')).not.toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByTestId('track-move-bottom-menu')).not.toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(screen.getByTestId('track-move-up-menu'));
    expect(mocks.saveProject).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('track-move-submenu')).not.toBeInTheDocument());

    await openMoveMenu('c');
    expect(await screen.findByTestId('track-move-down-menu')).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByTestId('track-move-bottom-menu')).toHaveAttribute('aria-disabled', 'true');
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('keeps only one context menu open when another track is selected', async () => {
    await renderEditor();
    fireEvent.contextMenu(screen.getByTestId('track-panel-row-a'));
    await screen.findByTestId('track-context-menu-a');
    fireEvent.contextMenu(screen.getByTestId('track-panel-row-b'));
    await screen.findByTestId('track-context-menu-b');
    await waitFor(() => expect(screen.queryByTestId('track-context-menu-a')).not.toBeInTheDocument());
    expect(screen.getAllByTestId('track-rename-menu')).toHaveLength(1);
  });

  it('opens the existing rename editor from the official context entry', async () => {
    await renderEditor();
    fireEvent.contextMenu(screen.getByTestId('track-panel-row-b'));
    fireEvent.click(await screen.findByTestId('track-rename-menu'));
    const input = await screen.findByLabelText('轨道名称');
    fireEvent.change(input, { target: { value: 'Renamed Beta' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(mocks.updateTrack).toHaveBeenCalledWith('track-move-project', 'b', { name: 'Renamed Beta' }));
  });

  it('keeps the visible order and creates no history when saving fails', async () => {
    mocks.moveTrack.mockRejectedValue(new Error('storage unavailable'));
    await renderEditor();
    await openMoveMenu('b');
    fireEvent.click(await screen.findByTestId('track-move-up-menu'));
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith('storage unavailable'));
    expectVisibleOrder(['Alpha', 'Beta', 'Gamma']);
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('does not overwrite a rename committed while the move is waiting to save', async () => {
    let resolveSave!: () => void;
    const saveGate = new Promise<void>((resolve) => { resolveSave = resolve; });
    mocks.moveTrack.mockImplementation(async (
      _projectId: string,
      trackId: string,
      direction: TrackMoveDirection,
    ) => {
      const before = structuredClone(mockProject);
      await saveGate;
      const after = {
        ...mockProject,
        tracks: moveTrackInOrder(mockProject.tracks, trackId, direction),
      };
      mockProject = after;
      return { before, after };
    });
    await renderEditor();
    await openMoveMenu('b');
    fireEvent.click(await screen.findByTestId('track-move-up-menu'));
    await waitFor(() => expect(mocks.moveTrack).toHaveBeenCalledTimes(1));

    fireEvent.contextMenu(screen.getByTestId('track-panel-row-b'));
    fireEvent.click(await screen.findByTestId('track-rename-menu'));
    const input = await screen.findByLabelText('轨道名称');
    fireEvent.change(input, { target: { value: 'Renamed during move' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(mockProject.tracks.find((track) => track.id === 'b')?.name)
      .toBe('Renamed during move'));

    resolveSave();
    await waitFor(() => expect(mocks.push).toHaveBeenCalledTimes(1));
    expect(mockProject.tracks.map((track) => track.id)).toEqual(['b', 'a', 'c']);
    expect(mockProject.tracks.find((track) => track.id === 'b')?.name).toBe('Renamed during move');
  });
});
