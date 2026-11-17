import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IProject, ITrack } from '@/types/project';

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  success: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
  mixAndRender: vi.fn(),
  loadChannels: vi.fn(),
}));
let mockProject: IProject;

function outputTrack(): ITrack {
  return {
    id: 'mix-track',
    name: 'Track 1',
    type: 'audio',
    gain: 0,
    pan: 0,
    muted: false,
    solo: false,
    armed: false,
    color: '',
    clips: [{
      id: 'mix-clip', audioBufferId: 'mix-buffer', startTime: 0, offset: 0,
      duration: 0.01, originalDuration: 0.01, stretchRatio: 1,
      gain: 0, fadeIn: 0, fadeOut: 0, name: 'Track 1',
    }],
    effects: [],
  };
}

function makeProject(): IProject {
  return {
    id: 'mix-project',
    name: 'Mix integration',
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
    mixAndRenderOnTracks: mocks.mixAndRender,
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
vi.mock('react-router-dom', () => ({ useParams: () => ({ projectId: 'mix-project' }), useNavigate: () => vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: mocks.success, warning: mocks.warning, error: mocks.error } }));
vi.mock('@/utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), log: vi.fn() } }));

import AudioEditorPage from './AudioEditorPage';

async function openMixMenu(): Promise<void> {
  expect(await screen.findByText('Mix integration')).toBeInTheDocument();
  fireEvent.pointerDown(screen.getByRole('button', { name: '轨道' }));
  const trigger = await screen.findByText('Mix 混音');
  fireEvent.pointerMove(trigger);
  fireEvent.keyDown(trigger, { key: 'ArrowRight' });
}

describe('AudioEditorPage Mix and Render', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProject = makeProject();
    mocks.loadChannels.mockResolvedValue([Float32Array.from([0.2, 0.4])]);
    mocks.mixAndRender.mockImplementation(async () => {
      mockProject = { ...mockProject, tracks: [outputTrack()] };
      return {
        trackId: 'mix-track', clipId: 'mix-clip', trackName: 'Track 1',
        inputTrackCount: 1, channelCount: 1, startTime: 0, endTime: 0.01,
      };
    });
  });

  it('renders selected tracks from the Mix submenu and records Render history', async () => {
    render(<AudioEditorPage />);
    await openMixMenu();
    fireEvent.click(await screen.findByText('Mix and Render 混音并渲染'));

    await waitFor(() => expect(mocks.mixAndRender).toHaveBeenCalledTimes(1));
    expect(mocks.mixAndRender.mock.calls[0][1]).toEqual([{
      trackId: 'track-1',
      clips: [{ clipId: 'clip-1', sampleData: [expect.any(Float32Array)], sourceOffset: 0 }],
    }]);
    expect(mocks.mixAndRender.mock.calls[0][2]).toBe(false);
    expect(mocks.push).toHaveBeenCalledTimes(1);
    expect(mocks.push.mock.calls[0][0].label).toBe('Render');
  });

  it('uses Ctrl+Shift+M for To New Track', async () => {
    render(<AudioEditorPage />);
    expect(await screen.findByText('Mix integration')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'M', ctrlKey: true, shiftKey: true });

    await waitFor(() => expect(mocks.mixAndRender).toHaveBeenCalledTimes(1));
    expect(mocks.mixAndRender.mock.calls[0][2]).toBe(true);
    expect(mocks.push).toHaveBeenCalledTimes(1);
    expect(mocks.success).toHaveBeenCalledWith('已混音渲染到新轨道「Track 1」');
  });
});
