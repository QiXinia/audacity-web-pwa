import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IProject } from '@/types/project';

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  success: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
  resample: vi.fn(),
  loadChannels: vi.fn(),
}));
let mockProject: IProject;

function makeProject(): IProject {
  return {
    id: 'resample-project',
    name: 'Resample integration',
    tracks: [{
      id: 'track-1', name: 'Track 1', type: 'audio', gain: 0, pan: 0,
      muted: false, solo: false, armed: false, color: '',
      clips: [{
        id: 'clip-1', audioBufferId: 'buffer-1', startTime: 0, offset: 0,
        duration: 0.01, originalDuration: 0.01, stretchRatio: 1,
        gain: 0, fadeIn: 0, fadeOut: 0, name: 'clip-1',
      }],
      effects: [],
    }],
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
    loadAudioChannels: mocks.loadChannels,
    loadAudioBuffer: vi.fn(async () => new Float32Array(10)),
    resampleTracksOnTracks: mocks.resample,
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
  audioDb: { audioBuffers: { get: vi.fn(), put: vi.fn(), delete: vi.fn() }, clipboard: {}, historySnapshots: {} },
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
    setCursorChangeCallback: vi.fn(), setStateChangeCallback: vi.fn(),
    setPlaybackCompleteCallback: vi.fn(), setTracksEndCallback: vi.fn(),
    processClipChannels: vi.fn((_clip: unknown, source: Float32Array[]) => source.map((channel) => new Float32Array(channel))),
  },
}));
vi.mock('@/wasm/processor', () => ({ isWasmAvailable: vi.fn(() => false), wasmProcessor: {} }));
vi.mock('react-router-dom', () => ({ useParams: () => ({ projectId: 'resample-project' }), useNavigate: () => vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: mocks.success, warning: mocks.warning, error: mocks.error } }));
vi.mock('@/utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), log: vi.fn() } }));

import AudioEditorPage from './AudioEditorPage';

async function openResampleDialog(): Promise<void> {
  expect(await screen.findByText('Resample integration')).toBeInTheDocument();
  fireEvent.pointerDown(screen.getByRole('button', { name: '轨道' }));
  fireEvent.click(await screen.findByText('Resample… 重采样…'));
  expect(await screen.findByTestId('resample-dialog')).toBeInTheDocument();
}

describe('AudioEditorPage Resample', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProject = makeProject();
    mocks.loadChannels.mockResolvedValue([Float32Array.from([0.2, 0.4])]);
    mocks.resample.mockImplementation(async () => {
      mockProject = {
        ...mockProject,
        tracks: mockProject.tracks.map((track) => ({
          ...track,
          clips: track.clips.map((clip) => ({ ...clip, audioBufferId: 'resampled-buffer' })),
        })),
      };
      return { trackCount: 1, clipCount: 1, outputSampleCount: 20, sampleRate: 22050 };
    });
  });

  it('opens the official rate dialog, resamples selected tracks and records one history step', async () => {
    render(<AudioEditorPage />);
    await openResampleDialog();
    const input = screen.getByLabelText(/New sample rate/);
    expect(input).toHaveValue('1000');
    fireEvent.change(input, { target: { value: '22050' } });
    fireEvent.click(screen.getByRole('button', { name: 'Resample 应用' }));

    await waitFor(() => expect(mocks.resample).toHaveBeenCalledTimes(1));
    expect(mocks.resample).toHaveBeenCalledWith('resample-project', ['track-1'], 22050);
    expect(mocks.push).toHaveBeenCalledTimes(1);
    expect(mocks.push.mock.calls[0][0].label).toBe('Resample Track');
    expect(mocks.success).toHaveBeenCalledWith('已将 1 条轨道的 1 个片段重采样为 22050 Hz');
    await waitFor(() => expect(screen.queryByTestId('resample-dialog')).not.toBeInTheDocument());
  });

  it('keeps invalid rates in the dialog without calling the service', async () => {
    render(<AudioEditorPage />);
    await openResampleDialog();
    const input = screen.getByLabelText(/New sample rate/);
    fireEvent.change(input, { target: { value: '44100.5' } });

    expect(screen.getByRole('alert')).toHaveTextContent('The entered value is invalid');
    expect(screen.getByRole('button', { name: 'Resample 应用' })).toBeDisabled();
    expect(mocks.resample).not.toHaveBeenCalled();
    expect(screen.getByTestId('resample-dialog')).toBeInTheDocument();
  });
});
