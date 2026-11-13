import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IProject } from '@/types/project';

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
  stereoToMono: vi.fn(),
  loadChannels: vi.fn(),
}));
let mockProject: IProject;

function makeProject(): IProject {
  return {
    id: 'stereo-project',
    name: 'Stereo integration',
    tracks: [{
      id: 'track-1',
      name: 'Track 1',
      type: 'audio',
      gain: 0,
      pan: 0,
      muted: false,
      solo: false,
      armed: false,
      color: '',
      clips: [{
        id: 'clip-1',
        audioBufferId: 'buffer-1',
        startTime: 0,
        offset: 0,
        duration: 0.01,
        originalDuration: 0.01,
        stretchRatio: 1,
        gain: 0,
        fadeIn: 0,
        fadeOut: 0,
        name: 'clip-1',
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
    stereoToMonoOnTracks: mocks.stereoToMono,
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
    undo: vi.fn(),
    redo: vi.fn(),
    getUndoStack: vi.fn(() => []),
    getRedoStack: vi.fn(() => []),
    getHistoryState: vi.fn(() => ({ canUndo: false, canRedo: false, undoLabel: '', redoLabel: '' })),
    clearHistory: vi.fn(),
    flushPersistence: vi.fn(),
  },
}));
vi.mock('@/db/audioDb', () => ({
  audioDb: { audioBuffers: { get: vi.fn(), put: vi.fn(), delete: vi.fn() }, clipboard: {}, historySnapshots: {} },
  serializeTracks: (tracks: unknown) => JSON.stringify(tracks),
  deserializeTracks: (data: string) => JSON.parse(data),
  serializeSelection: vi.fn(),
  deserializeSelection: vi.fn(),
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
    setCursorChangeCallback: vi.fn(), setStateChangeCallback: vi.fn(), setPlaybackCompleteCallback: vi.fn(), setTracksEndCallback: vi.fn(),
    processClipChannels: vi.fn((_clip: unknown, source: Float32Array[]) => source.map((channel) => new Float32Array(channel))),
  },
}));
vi.mock('@/wasm/processor', () => ({ isWasmAvailable: vi.fn(() => false), wasmProcessor: {} }));
vi.mock('react-router-dom', () => ({ useParams: () => ({ projectId: 'stereo-project' }), useNavigate: () => vi.fn() }));
vi.mock('sonner', () => ({ toast: { warning: mocks.warning, error: mocks.error } }));
vi.mock('@/utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), log: vi.fn() } }));

import AudioEditorPage from './AudioEditorPage';

describe('AudioEditorPage Stereo To Mono', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProject = makeProject();
    mocks.loadChannels.mockResolvedValue([new Float32Array(10).fill(0.2), new Float32Array(10).fill(0.6)]);
    mocks.stereoToMono.mockResolvedValue(1);
  });

  it('applies the track menu operation once and records one undo entry', async () => {
    render(<AudioEditorPage />);
    expect(await screen.findByText('Stereo integration')).toBeInTheDocument();
    fireEvent.pointerDown(screen.getByRole('button', { name: '轨道' }));
    fireEvent.click(await screen.findByText('Stereo To Mono 立体声转单声道'));

    await waitFor(() => expect(mocks.stereoToMono).toHaveBeenCalledTimes(1));
    expect(mocks.push).toHaveBeenCalledTimes(1);
    expect(mocks.push.mock.calls[0][0].label).toBe('Stereo To Mono');
  });
});
