// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import type { IClip, IProject } from '@/types/project';

const mocks = vi.hoisted(() => ({
  loadChannels: vi.fn(),
  loadMetadata: vi.fn(),
  editLatestProject: vi.fn(),
  saveProject: vi.fn(async () => undefined),
  drawWaveform: vi.fn(),
}));

const left = new Float32Array(2000).fill(0.4);
const right = new Float32Array(2000).fill(-0.3);

const clipA: IClip = {
  id: 'clip-a', audioBufferId: 'buffer-a', startTime: 1.25, offset: 0.5,
  duration: 2, originalDuration: 8, stretchRatio: 1.5, pitchCents: 125,
  optimizeForVoice: true, gain: -3, fadeIn: 0.1, fadeOut: 0.2,
  name: 'Voice take', colorIndex: 2, stretchToMatchTempo: true,
  clipTempo: 120, rawAudioTempo: 90,
};
const clipB: IClip = {
  id: 'clip-b', audioBufferId: 'buffer-b', startTime: 5, offset: 0,
  duration: 1, originalDuration: 1, gain: 0, fadeIn: 0, fadeOut: 0, name: 'Second clip',
};

const project: IProject = {
  id: 'clip-properties-project', name: 'Clip properties integration', sampleRate: 44100,
  tracks: [{
    id: 'track-a', name: 'Narration', type: 'audio', gain: 0, pan: 0,
    muted: false, solo: false, armed: false, color: '#7aa2f7', clips: [clipA, clipB], effects: [],
  }],
  cursorPosition: 0, selection: null, spectralSelection: null,
  viewState: { horizontalZoom: 100, verticalZoom: 1, scrollX: 0, viewMode: 'waveform' },
  updatedAt: 100, createdAt: 50, timeSignature: { numerator: 4, denominator: 4 }, tempo: 120,
};

vi.mock('@/services/projectService', () => ({
  projectService: {
    getProject: vi.fn(async () => project), openProject: vi.fn(async () => project),
    saveProject: mocks.saveProject, loadAudioChannels: mocks.loadChannels,
    editLatestProject: mocks.editLatestProject,
    loadAudioBufferMetadata: mocks.loadMetadata, loadAudioBuffer: vi.fn(async () => null),
  },
}));
vi.mock('@/services/historyService', () => ({
  historyManager: {
    push: vi.fn(), pushCommand: vi.fn(), canUndo: vi.fn(() => false), canRedo: vi.fn(() => false),
    loadForProject: vi.fn(async () => 0), flush: vi.fn(async () => undefined), undo: vi.fn(), redo: vi.fn(),
    getUndoStack: vi.fn(() => []), getRedoStack: vi.fn(() => []),
    getHistoryState: vi.fn(() => ({ canUndo: false, canRedo: false, undoLabel: '', redoLabel: '' })),
    clearHistory: vi.fn(), flushPersistence: vi.fn(), getUndoLabel: vi.fn(() => null), getRedoLabel: vi.fn(() => null),
  },
}));
vi.mock('@/db/audioDb', () => ({
  audioDb: {
    audioBuffers: { get: vi.fn(), put: vi.fn(), delete: vi.fn() },
    clipboard: { get: vi.fn(), put: vi.fn() }, historySnapshots: {},
  },
  serializeTracks: (tracks: unknown) => JSON.stringify(tracks), deserializeTracks: (data: string) => JSON.parse(data),
  serializeSelection: (selection: unknown) => selection ? JSON.stringify(selection) : null,
  deserializeSelection: (data: string | null) => data ? JSON.parse(data) : null,
}));
vi.mock('@/engine/audioEngine', () => ({
  audioEngine: {
    subscribe: vi.fn(() => () => {}), getPlaybackState: vi.fn(() => 'stopped'),
    getRecordingState: vi.fn(() => 'inactive'), getCurrentTime: vi.fn(() => 0),
    playTracks: vi.fn(), stopPlayback: vi.fn(), pausePlayback: vi.fn(), resumePlayback: vi.fn(),
    seek: vi.fn(), startRecording: vi.fn(), stopRecording: vi.fn(), cancelRecording: vi.fn(),
    initialize: vi.fn(), getLevel: vi.fn(() => 0), cacheBuffer: vi.fn(), evictBuffer: vi.fn(),
    setCursorChangeCallback: vi.fn(), setStateChangeCallback: vi.fn(), setPlaybackCompleteCallback: vi.fn(),
    setTracksEndCallback: vi.fn(), getPlaybackLevels: vi.fn(() => ({ left: -Infinity, right: -Infinity })),
    getRecordingLevels: vi.fn(() => ({ left: -Infinity, right: -Infinity })),
    processClipChannels: vi.fn((_clip: unknown, source: Float32Array[]) => source.map((channel) => new Float32Array(channel))),
  },
}));
vi.mock('@/wasm/processor', () => ({
  isWasmAvailable: vi.fn(() => false),
  wasmProcessor: {
    spectrogram: vi.fn((_data: Float32Array, windowSize: number) => new Float32Array(windowSize / 2 + 1)),
    sliceBuffer: vi.fn(),
  },
}));
vi.mock('@/lib/waveformDrawing', () => ({ drawWaveform: mocks.drawWaveform }));
vi.mock('react-router-dom', () => ({
  useParams: () => ({ projectId: 'clip-properties-project' }), useNavigate: () => vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), log: vi.fn() } }));

import AudioEditorPage from './AudioEditorPage';

async function renderProject() {
  const { container } = render(<AudioEditorPage />);
  expect(await screen.findByText('Clip properties integration')).toBeInTheDocument();
  await screen.findByText('Voice take');
  await waitFor(() => expect(mocks.loadChannels).toHaveBeenCalled());
  return Array.from(container.querySelectorAll<HTMLElement>('.au-clip'));
}

describe('AudioEditorPage Clip properties integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    project.sampleRate = 44100;
    window.localStorage.clear();
    mocks.loadChannels.mockResolvedValue([left, right]);
    mocks.loadMetadata.mockResolvedValue({
      id: 'buffer-a', sampleRate: 48000, channels: 2, length: 384000, duration: 8,
    });
    Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
    const context = {
      scale: vi.fn(), clearRect: vi.fn(), save: vi.fn(), translate: vi.fn(),
      beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn(), restore: vi.fn(), fillRect: vi.fn(),
    };
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', { configurable: true, value: vi.fn(() => context) });
  });

  afterEach(() => cleanup());

  it('opens the first official menu item with real metadata and performs no project edit', async () => {
    const clips = await renderProject();
    fireEvent.contextMenu(clips[0]!);
    const menuItem = await screen.findByTestId('clip-properties-menu');
    expect(menuItem.parentElement?.firstElementChild).toBe(menuItem);
    expect(menuItem).not.toHaveAttribute('aria-disabled', 'true');

    fireEvent.click(menuItem);
    expect(await screen.findByTestId('clip-properties-dialog')).toBeInTheDocument();
    expect(await screen.findByTestId('clip-property-sample-rate')).toHaveTextContent('48000 Hz');
    expect(screen.getByTestId('clip-property-timeline-end')).toHaveTextContent('3.250000 s');
    expect(screen.getByTestId('clip-property-source-end')).toHaveTextContent('3.500000 s');
    expect(screen.getByTestId('clip-property-source-duration')).toHaveTextContent('3.000000 s');
    expect(within(screen.getByTestId('clip-properties-dialog')).getByText('Narration')).toBeInTheDocument();
    expect(mocks.saveProject).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('clip-properties-close'));
    await waitFor(() => expect(screen.queryByTestId('clip-properties-dialog')).not.toBeInTheDocument());
  });

  it('uses the dedicated multi Clip menu instead of exposing single Clip properties', async () => {
    const clips = await renderProject();
    fireEvent.click(clips[0]!);
    fireEvent.click(clips[1]!, { shiftKey: true });
    fireEvent.contextMenu(clips[0]!);
    expect(await screen.findByTestId('multi-clip-copy-menu')).toBeInTheDocument();
    expect(screen.queryByTestId('clip-properties-menu')).not.toBeInTheDocument();
    expect(screen.queryByTestId('clip-properties-dialog')).not.toBeInTheDocument();
  });

  it('rejects stale rendered PCM when the Clip changes while its audio is loading', async () => {
    project.sampleRate = 1000;
    const clips = await renderProject();
    let resolveRenderChannels!: (channels: Float32Array[]) => void;
    const renderChannels = new Promise<Float32Array[]>((resolve) => {
      resolveRenderChannels = resolve;
    });
    const pendingRenderLoad = vi.fn(() => renderChannels);
    mocks.loadChannels.mockImplementationOnce(pendingRenderLoad);

    const latestProject = structuredClone(project);
    let committedAfter: IProject | null = null;
    mocks.editLatestProject.mockImplementationOnce(async (
      _projectId: string,
      edit: (value: IProject) => IProject | Promise<IProject>,
    ) => {
      const before = structuredClone(latestProject);
      const after = await edit(latestProject);
      committedAfter = after;
      return { before, after };
    });

    fireEvent.contextMenu(clips[0]!);
    fireEvent.click(await screen.findByText('Render pitch and speed'));
    await waitFor(() => expect(pendingRenderLoad).toHaveBeenCalledTimes(1));

    const externallyEdited = latestProject.tracks[0]!.clips[0]!;
    latestProject.tracks[0]!.clips[0] = {
      ...externallyEdited,
      pitchCents: 600,
      stretchRatio: 1.25,
    };
    resolveRenderChannels([new Float32Array(8000).fill(0.1)]);

    await waitFor(() => expect(mocks.editLatestProject).toHaveBeenCalledTimes(1));
    await waitFor(() => {
      expect(committedAfter !== null || vi.mocked(toast.error).mock.calls.length > 0).toBe(true);
    });
    expect(committedAfter).toBeNull();
    expect(toast.error).toHaveBeenCalledWith('片段在渲染期间已被修改，请重试');
    expect(latestProject.tracks[0]!.clips[0]).toMatchObject({
      audioBufferId: 'buffer-a',
      pitchCents: 600,
      stretchRatio: 1.25,
    });
  });
});
