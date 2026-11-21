import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IProject, ITrack, ViewMode } from '@/types/project';
import { setTrackHalfWave, setTrackViewMode } from '@/lib/trackVisualization';

type AppearanceChange =
  | { type: 'viewMode'; viewMode: ViewMode }
  | { type: 'halfWave'; halfWave: boolean };

const mocks = vi.hoisted(() => ({
  success: vi.fn(), warning: vi.fn(), error: vi.fn(), saveProject: vi.fn(),
  updateTrackAppearance: vi.fn(), loadChannels: vi.fn(),
}));
let mockProject: IProject;

function makeTrack(id: string, name: string): ITrack {
  return {
    id, name, type: 'audio', gain: 0, pan: 0, muted: false, solo: false, armed: false,
    color: '#66A3FF', effects: [],
    clips: [{
      id: `clip-${id}`, audioBufferId: `buffer-${id}`, startTime: 0, offset: 0,
      duration: 0.01, originalDuration: 0.01, stretchRatio: 1, gain: 0,
      fadeIn: 0, fadeOut: 0, name: `Clip ${id}`,
    }],
  };
}

function makeProject(): IProject {
  return {
    id: 'track-visualization-project', name: 'Track visualization integration',
    tracks: [makeTrack('a', 'Alpha'), makeTrack('b', 'Beta')],
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
    updateTrackAppearance: mocks.updateTrackAppearance,
    loadAudioChannels: mocks.loadChannels,
    loadAudioBuffer: vi.fn(async () => new Float32Array(10)),
  },
}));
vi.mock('@/services/historyService', () => ({
  historyManager: {
    push: vi.fn(), pushCommand: vi.fn(), canUndo: vi.fn(() => false), canRedo: vi.fn(() => false),
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
vi.mock('react-router-dom', () => ({ useParams: () => ({ projectId: 'track-visualization-project' }), useNavigate: () => vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: mocks.success, warning: mocks.warning, error: mocks.error } }));
vi.mock('@/utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), log: vi.fn() } }));

import AudioEditorPage from './AudioEditorPage';

async function renderEditor(): Promise<void> {
  render(<AudioEditorPage />);
  expect(await screen.findByText('Track visualization integration')).toBeInTheDocument();
}

async function openVisualizationMenu(trackId: string): Promise<void> {
  fireEvent.contextMenu(screen.getByTestId(`track-panel-row-${trackId}`));
  fireEvent.keyDown(await screen.findByTestId('track-visualization-submenu'), { key: 'ArrowRight' });
}

function canvasMode(trackId: string): string | null {
  return screen.getByTestId(`waveform-canvas-clip-${trackId}`).getAttribute('data-view-mode');
}

function canvasHalfWave(trackId: string): string | null {
  return screen.getByTestId(`waveform-canvas-clip-${trackId}`).getAttribute('data-half-wave');
}

describe('AudioEditorPage Track context Track visualization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProject = makeProject();
    mocks.saveProject.mockImplementation(async (project: IProject) => { mockProject = project; });
    mocks.updateTrackAppearance.mockImplementation(async (
      _projectId: string,
      trackId: string,
      change: AppearanceChange,
    ) => {
      const updated = change.type === 'viewMode'
        ? setTrackViewMode(mockProject, trackId, change.viewMode)
        : setTrackHalfWave(mockProject, trackId, change.halfWave);
      if (updated === mockProject) return null;
      await mocks.saveProject(updated);
      mockProject = updated;
      return updated;
    });
    mocks.loadChannels.mockResolvedValue([Float32Array.from([0.2, 0.4])]);
  });

  afterEach(() => cleanup());

  it('places the official submenu between Move and color, checks per-track state, and opens settings', async () => {
    mockProject.tracks[1]!.viewMode = 'both';
    mockProject.tracks[1]!.halfWave = true;
    await renderEditor();
    await openVisualizationMenu('b');

    const move = screen.getByTestId('track-move-submenu');
    const visualization = screen.getByTestId('track-visualization-submenu');
    const color = screen.getByTestId('track-color-submenu');
    expect(move.compareDocumentPosition(visualization) & 4).toBeTruthy();
    expect(visualization.compareDocumentPosition(color) & 4).toBeTruthy();
    expect(screen.getByTestId('track-view-waveform')).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByTestId('track-view-spectrogram')).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByTestId('track-view-multi')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('track-view-half-wave')).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(screen.getByTestId('track-view-multi'));
    expect(mocks.saveProject).not.toHaveBeenCalled();
    await openVisualizationMenu('b');
    fireEvent.click(await screen.findByTestId('track-spectrogram-settings-menu'));
    expect(await screen.findByTestId('track-spectrogram-settings-dialog')).toBeInTheDocument();
    expect(mocks.saveProject).not.toHaveBeenCalled();
  });

  it('persists Spectrogram, Multi-view, and Waveform only on the context track without changing clips', async () => {
    const originalClips = mockProject.tracks[1]!.clips;
    await renderEditor();

    await openVisualizationMenu('b');
    fireEvent.click(await screen.findByTestId('track-view-spectrogram'));
    await waitFor(() => expect(mocks.saveProject).toHaveBeenCalledTimes(1));
    expect(mockProject.tracks[1]!.viewMode).toBe('spectrum');
    expect(mockProject.tracks[0]!.viewMode).toBeUndefined();
    expect(mockProject.viewState.viewMode).toBe('waveform');
    await waitFor(() => expect(canvasMode('b')).toBe('spectrum'));
    expect(canvasMode('a')).toBe('waveform');

    await openVisualizationMenu('b');
    fireEvent.click(await screen.findByTestId('track-view-multi'));
    await waitFor(() => expect(mocks.saveProject).toHaveBeenCalledTimes(2));
    expect(mockProject.tracks[1]!.viewMode).toBe('both');
    await waitFor(() => expect(canvasMode('b')).toBe('both'));

    await openVisualizationMenu('b');
    fireEvent.click(await screen.findByTestId('track-view-waveform'));
    await waitFor(() => expect(mocks.saveProject).toHaveBeenCalledTimes(3));
    expect(mockProject.tracks[1]!.viewMode).toBe('waveform');
    expect(mockProject.tracks[1]!.clips).toBe(originalClips);
    await waitFor(() => expect(canvasMode('b')).toBe('waveform'));
    expect(canvasMode('a')).toBe('waveform');
  });

  it('toggles Half-wave per track even in Spectrogram view and supports explicit false', async () => {
    mockProject.tracks[1]!.viewMode = 'spectrum';
    mockProject.tracks[1]!.halfWave = true;
    await renderEditor();

    await openVisualizationMenu('b');
    fireEvent.click(await screen.findByTestId('track-view-half-wave'));
    await waitFor(() => expect(mocks.saveProject).toHaveBeenCalledTimes(1));
    expect(mockProject.tracks[1]!.halfWave).toBe(false);
    expect(mockProject.tracks[0]!.halfWave).toBeUndefined();
    await waitFor(() => expect(canvasHalfWave('b')).toBe('false'));

    await openVisualizationMenu('a');
    fireEvent.click(await screen.findByTestId('track-view-half-wave'));
    await waitFor(() => expect(mocks.saveProject).toHaveBeenCalledTimes(2));
    expect(mockProject.tracks[0]!.halfWave).toBe(true);
    expect(mockProject.tracks[1]!.halfWave).toBe(false);
    await waitFor(() => expect(canvasHalfWave('a')).toBe('true'));
    expect(canvasHalfWave('b')).toBe('false');
  });

  it('keeps the visible and persisted view unchanged when saving fails', async () => {
    mockProject.tracks[1]!.viewMode = 'both';
    mocks.saveProject.mockRejectedValue(new Error('storage unavailable'));
    await renderEditor();
    await openVisualizationMenu('b');
    fireEvent.click(await screen.findByTestId('track-view-spectrogram'));

    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith('storage unavailable'));
    expect(mockProject.tracks[1]!.viewMode).toBe('both');
    expect(canvasMode('b')).toBe('both');
    expect(canvasMode('a')).toBe('waveform');
  });
});
