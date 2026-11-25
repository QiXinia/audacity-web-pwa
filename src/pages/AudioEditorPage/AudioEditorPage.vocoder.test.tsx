import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IProject } from '@/types/project';
import type { VocoderTrackAudio } from '@/services/projectService';
import { DEFAULT_VOCODER_SETTINGS, type VocoderSettings } from '@/lib/vocoderEffect';

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  saveProject: vi.fn(),
  vocoder: vi.fn(),
  loadChannels: vi.fn(),
}));
let mockProject: IProject;
let mockRouteProjectId = 'vocoder-project';

function makeProject(): IProject {
  const clip = (id: string) => ({
    id,
    audioBufferId: `buffer-${id}`,
    startTime: 0,
    offset: 0,
    duration: 0.01,
    originalDuration: 0.01,
    stretchRatio: 1,
    gain: 0,
    fadeIn: 0,
    fadeOut: 0,
    name: `clip-${id}`,
  });
  const track = (id: string) => ({
    id,
    name: `Track ${id}`,
    type: 'audio' as const,
    gain: 0,
    pan: 0,
    muted: false,
    solo: false,
    armed: false,
    color: '',
    clips: [clip(id)],
    effects: [],
  });
  return {
    id: 'vocoder-project',
    name: 'Vocoder integration',
    tracks: [track('one'), track('two')],
    cursorPosition: 0,
    selection: { start: 0, end: 0.01 },
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
    vocoderSelectionOnTracks: mocks.vocoder,
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
  audioDb: {
    audioBuffers: { get: vi.fn(), put: vi.fn(), delete: vi.fn() },
    clipboard: {},
    historySnapshots: {},
  },
  serializeTracks: (tracks: unknown) => JSON.stringify(tracks),
  deserializeTracks: (data: string) => JSON.parse(data),
  serializeSelection: (selection: unknown) => selection ? JSON.stringify(selection) : null,
  deserializeSelection: (data: string | null) => data ? JSON.parse(data) : null,
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
    setCursorChangeCallback: vi.fn(), setStateChangeCallback: vi.fn(), setPlaybackCompleteCallback: vi.fn(),
    setTracksEndCallback: vi.fn(),
    processClipChannels: vi.fn((_clip: unknown, source: Float32Array[]) => source.map((channel) => new Float32Array(channel))),
  },
}));
vi.mock('@/wasm/processor', () => ({ isWasmAvailable: vi.fn(() => false), wasmProcessor: {} }));
vi.mock('react-router-dom', () => ({
  useParams: () => ({ projectId: mockRouteProjectId }),
  useNavigate: () => vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { success: mocks.success, error: mocks.error, info: mocks.info } }));
vi.mock('@/utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), log: vi.fn() } }));

class MockAudioContext {
  state = 'running';
  destination = {};
  resume = vi.fn(async () => undefined);
  close = vi.fn(async () => undefined);
  createBuffer(channels: number, length: number, sampleRate: number) {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { getChannelData: (index: number) => data[index], duration: length / sampleRate };
  }
  createBufferSource() {
    return {
      buffer: null,
      onended: null,
      connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(),
    };
  }
}

import AudioEditorPage from './AudioEditorPage';

async function openVocoderDialog() {
  fireEvent.pointerDown(screen.getByRole('button', { name: '效果' }));
  fireEvent.click(await screen.findByText('Vocoder…'));
  return screen.findByRole('heading', { name: 'Vocoder' });
}

describe('AudioEditorPage Vocoder effect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProject = makeProject();
    mockRouteProjectId = 'vocoder-project';
    vi.stubGlobal('AudioContext', MockAudioContext);
    Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
    mocks.loadChannels.mockImplementation(async (id: string) => {
      if (id === 'buffer-one') {
        return [
          Float32Array.from({ length: 10 }, (_, index) => index / 10),
          new Float32Array(10).fill(0.2),
        ];
      }
      return [new Float32Array(10).fill(0.4)];
    });
    mocks.saveProject.mockImplementation(async (project: IProject) => { mockProject = project; });
    mocks.vocoder.mockImplementation(async (
      _id: string,
      _selection: { start: number; end: number },
      _settings: VocoderSettings,
      targets: VocoderTrackAudio[],
    ) => {
      mockProject = structuredClone(mockProject);
      mockProject.tracks.forEach((track) => { track.clips[0].audioBufferId = `vocoder-${track.id}`; });
      return targets.reduce((total, target) => total + target.clips.length, 0);
    });
    mocks.push.mockImplementation(() => undefined);
  });

  it('applies both tracks with one undo through the atomic service', async () => {
    render(<AudioEditorPage />);
    expect(await screen.findByText('Vocoder integration')).toBeInTheDocument();
    await openVocoderDialog();
    fireEvent.click(screen.getByRole('button', { name: '应用 Vocoder' }));

    await waitFor(() => expect(mocks.success).toHaveBeenCalledWith('已对 2 个片段应用 Vocoder'));
    expect(mocks.vocoder).toHaveBeenCalledTimes(1);
    const [, selection, settings, targets] = mocks.vocoder.mock.calls[0];
    expect(selection).toEqual({ start: 0, end: 0.01 });
    expect(settings).toEqual(DEFAULT_VOCODER_SETTINGS);
    expect(targets).toHaveLength(2);
    expect(mocks.push).toHaveBeenCalledTimes(1);
    expect(mocks.push.mock.calls[0][0].label).toBe('Vocoder');
    expect(mocks.saveProject).not.toHaveBeenCalled();
  });

  it('ignores a late Vocoder result after switching projects', async () => {
    let release!: (changed: number) => void;
    const oldApply = new Promise<number>((resolve) => { release = resolve; });
    mocks.vocoder.mockReturnValueOnce(oldApply);
    const { rerender } = render(<AudioEditorPage />);
    expect(await screen.findByText('Vocoder integration')).toBeInTheDocument();
    await openVocoderDialog();
    fireEvent.click(screen.getByRole('button', { name: '应用 Vocoder' }));
    await waitFor(() => expect(mocks.vocoder).toHaveBeenCalledTimes(1));

    const replacement = {
      ...structuredClone(makeProject()),
      id: 'replacement-vocoder-project',
      name: 'Replacement Vocoder project',
    };
    mockProject = replacement;
    mockRouteProjectId = replacement.id;
    rerender(<AudioEditorPage key={replacement.id} />);
    expect(await screen.findByText(replacement.name)).toBeInTheDocument();
    mocks.push.mockClear();
    mocks.success.mockClear();
    mocks.error.mockClear();

    release(2);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.success).not.toHaveBeenCalled();
    expect(mocks.error).not.toHaveBeenCalled();
    expect(screen.queryByRole('heading', { name: 'Vocoder' })).not.toBeInTheDocument();
    expect(screen.getByText(replacement.name)).toBeInTheDocument();
  });
});
