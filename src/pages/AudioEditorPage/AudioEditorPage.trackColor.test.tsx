import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IProject, ITrack } from '@/types/project';

const mocks = vi.hoisted(() => ({
  success: vi.fn(), warning: vi.fn(), error: vi.fn(), saveProject: vi.fn(), loadChannels: vi.fn(),
}));
let mockProject: IProject;

function makeTrack(id: string, name: string, color: string): ITrack {
  return {
    id, name, type: 'audio', gain: -2, pan: 0.25, muted: false, solo: false, armed: false, color,
    clips: [
      {
        id: `auto-${id}`, audioBufferId: `buffer-auto-${id}`, startTime: 0, offset: 0,
        duration: 0.01, originalDuration: 0.01, stretchRatio: 1, gain: 0,
        fadeIn: 0, fadeOut: 0, name: `Auto ${id}`, colorIndex: 0,
      },
      {
        id: `explicit-${id}`, audioBufferId: `buffer-explicit-${id}`, startTime: 0.02, offset: 0,
        duration: 0.01, originalDuration: 0.01, stretchRatio: 1, gain: 0,
        fadeIn: 0, fadeOut: 0, name: `Explicit ${id}`, colorIndex: 4,
      },
    ],
    effects: [],
  };
}

function makeProject(): IProject {
  return {
    id: 'track-color-project', name: 'Track color integration',
    tracks: [makeTrack('a', 'Alpha', '#66A3FF'), makeTrack('b', 'Beta', '#F08080')],
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
vi.mock('react-router-dom', () => ({ useParams: () => ({ projectId: 'track-color-project' }), useNavigate: () => vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: mocks.success, warning: mocks.warning, error: mocks.error } }));
vi.mock('@/utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), log: vi.fn() } }));

import AudioEditorPage from './AudioEditorPage';

async function renderEditor(): Promise<void> {
  render(<AudioEditorPage />);
  expect(await screen.findByText('Track color integration')).toBeInTheDocument();
}

async function openTrackColorMenu(trackId: string): Promise<void> {
  fireEvent.contextMenu(screen.getByTestId(`track-panel-row-${trackId}`));
  fireEvent.keyDown(await screen.findByTestId('track-color-submenu'), { key: 'ArrowRight' });
}

function clipColor(bufferId: string): string | undefined {
  return document.querySelector(`[data-audio-buffer-id="${bufferId}"]`)?.getAttribute('data-clip-color') ?? undefined;
}

describe('AudioEditorPage Track context Track color', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProject = makeProject();
    mocks.saveProject.mockImplementation(async (project: IProject) => { mockProject = project; });
    mocks.loadChannels.mockResolvedValue([Float32Array.from([0.2, 0.4])]);
  });

  afterEach(() => cleanup());

  it('places the official nine-color submenu after Move track and checks the current theme color', async () => {
    await renderEditor();
    await openTrackColorMenu('b');
    const move = screen.getByTestId('track-move-submenu');
    const color = screen.getByTestId('track-color-submenu');
    expect(move.compareDocumentPosition(color) & 4).toBeTruthy();
    const names = ['Blue', 'Violet', 'Magenta', 'Red', 'Orange', 'Yellow', 'Green', 'Turquoise', 'Cyan'];
    for (const [index, name] of names.entries()) {
      const item = screen.getByTestId(`track-color-${index + 1}`);
      expect(item).toHaveTextContent(name);
      expect(item).toHaveAttribute('aria-checked', index + 1 === 4 ? 'true' : 'false');
      if (index > 0) {
        const previous = screen.getByTestId(`track-color-${index}`);
        expect(previous.compareDocumentPosition(item) & 4).toBeTruthy();
      }
    }
  });

  it('persists only the target track color while automatic clips follow and explicit clips stay unchanged', async () => {
    await renderEditor();
    await openTrackColorMenu('b');
    fireEvent.click(await screen.findByTestId('track-color-9'));

    await waitFor(() => expect(mocks.saveProject).toHaveBeenCalledTimes(1));
    expect(mockProject.tracks.map((track) => track.color)).toEqual(['#66A3FF', '#48BECF']);
    expect(mockProject.tracks[1]!.clips.map((clip) => clip.colorIndex)).toEqual([0, 4]);
    expect(screen.getByTestId('track-color-swatch-b')).toHaveAttribute('data-track-color', '#48BECF');
    expect(screen.getByTestId('track-color-swatch-a')).toHaveAttribute('data-track-color', '#66A3FF');
    expect(clipColor('buffer-auto-b')).toBe('#48BECF');
    expect(clipColor('buffer-explicit-b')).toBe('#F08080');

    await openTrackColorMenu('b');
    expect(await screen.findByTestId('track-color-9')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('track-color-4')).toHaveAttribute('aria-checked', 'false');
  });

  it('does not save again when the current track color is reselected', async () => {
    await renderEditor();
    await openTrackColorMenu('b');
    fireEvent.click(await screen.findByTestId('track-color-4'));
    expect(mocks.saveProject).not.toHaveBeenCalled();
    expect(mockProject.tracks[1]!.color).toBe('#F08080');
  });

  it('keeps the visible and persisted colors unchanged when saving fails', async () => {
    mocks.saveProject.mockRejectedValue(new Error('storage unavailable'));
    await renderEditor();
    await openTrackColorMenu('b');
    fireEvent.click(await screen.findByTestId('track-color-7'));

    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith('storage unavailable'));
    expect(mockProject.tracks[1]!.color).toBe('#F08080');
    expect(screen.getByTestId('track-color-swatch-b')).toHaveAttribute('data-track-color', '#F08080');
    expect(clipColor('buffer-auto-b')).toBe('#F08080');
    expect(clipColor('buffer-explicit-b')).toBe('#F08080');
  });
});
