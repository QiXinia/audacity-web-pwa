import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IProject } from '@/types/project';

const mocks = vi.hoisted(() => ({
  updateTrack: vi.fn(),
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
    updateTrack: mocks.updateTrack,
    loadAudioChannels: vi.fn(async () => [new Float32Array(0)]),
    loadAudioBuffer: vi.fn(async () => new Float32Array(0)),
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
  fireEvent.keyDown(input, { key: 'Enter' });
}

describe('AudioEditorPage track mutation rollback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProject = makeProject();
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
});
