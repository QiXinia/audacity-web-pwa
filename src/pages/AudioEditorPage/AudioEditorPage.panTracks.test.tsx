import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IProject } from '@/types/project';

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  success: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
  saveProject: vi.fn(),
  setTracksPan: vi.fn(),
  loadChannels: vi.fn(),
}));
let mockProject: IProject;

function makeProject(): IProject {
  return {
    id: 'pan-project',
    name: 'Pan integration',
    tracks: [
      {
        id: 'track-a', name: 'Track A', type: 'audio', gain: 0, pan: 0.25,
        muted: false, solo: false, armed: false, color: '',
        clips: [{
          id: 'clip-a', audioBufferId: 'buffer-a', startTime: 0, offset: 0,
          duration: 0.01, originalDuration: 0.01, stretchRatio: 1,
          gain: 0, fadeIn: 0, fadeOut: 0, name: 'Clip A',
        }],
        effects: [],
      },
      {
        id: 'track-b', name: 'Track B', type: 'audio', gain: 0, pan: -0.25,
        muted: false, solo: false, armed: false, color: '',
        clips: [{
          id: 'clip-b', audioBufferId: 'buffer-b', startTime: 0, offset: 0,
          duration: 0.01, originalDuration: 0.01, stretchRatio: 1,
          gain: 0, fadeIn: 0, fadeOut: 0, name: 'Clip B',
        }],
        effects: [],
      },
    ],
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
    saveProject: mocks.saveProject,
    setTracksPan: mocks.setTracksPan,
    loadAudioChannels: mocks.loadChannels,
    loadAudioBuffer: vi.fn(async () => new Float32Array(10)),
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
vi.mock('react-router-dom', () => ({ useParams: () => ({ projectId: 'pan-project' }), useNavigate: () => vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: mocks.success, warning: mocks.warning, error: mocks.error } }));
vi.mock('@/utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), log: vi.fn() } }));

import AudioEditorPage from './AudioEditorPage';

async function renderEditor(): Promise<void> {
  render(<AudioEditorPage />);
  expect(await screen.findByText('Pan integration')).toBeInTheDocument();
}

async function openPanMenu(): Promise<void> {
  fireEvent.pointerDown(screen.getByRole('button', { name: '轨道' }));
  const trigger = await screen.findByText('Pan 声像');
  fireEvent.pointerMove(trigger);
  fireEvent.keyDown(trigger, { key: 'ArrowRight' });
}

function savedTracks(): Pick<IProject, 'tracks'>['tracks'] {
  return mockProject.tracks;
}

function mutationCallCount(): number {
  return mocks.saveProject.mock.calls.length + mocks.setTracksPan.mock.calls.length;
}

describe('AudioEditorPage Pan commands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProject = makeProject();
    mocks.saveProject.mockImplementation(async (project: IProject) => {
      mockProject = project;
    });
    mocks.setTracksPan.mockImplementation(async (_projectId: string, trackIds: string[], pan: -1 | 0 | 1) => {
      const before = structuredClone(mockProject);
      const targets = new Set(trackIds);
      const after: IProject = {
        ...mockProject,
        tracks: mockProject.tracks.map((track) => targets.has(track.id) ? { ...track, pan } : track),
      };
      mockProject = after;
      return { before, after };
    });
    mocks.loadChannels.mockResolvedValue([Float32Array.from([0.2, 0.4])]);
  });

  afterEach(() => cleanup());

  it('exposes the official submenu and pans only the selected track left with one save and history step', async () => {
    await renderEditor();
    fireEvent.click(await screen.findByRole('button', { name: /^Clip B/ }));
    await openPanMenu();
    fireEvent.click(await screen.findByText('Left 左侧'));

    await waitFor(() => expect(mutationCallCount()).toBe(1));
    expect(savedTracks().map((track) => [track.id, track.pan])).toEqual([
      ['track-a', 0.25],
      ['track-b', -1],
    ]);
    expect(await screen.findByText('L1.0')).toBeInTheDocument();
    expect(mocks.push).toHaveBeenCalledTimes(1);
    expect(mocks.push.mock.calls[0]![0].label).toBe('Pan Left');
  });

  it('pans only the selected track right and preserves the other track', async () => {
    await renderEditor();
    fireEvent.click(await screen.findByRole('button', { name: /^Clip A/ }));
    await openPanMenu();
    fireEvent.click(await screen.findByText('Right 右侧'));

    await waitFor(() => expect(mutationCallCount()).toBe(1));
    expect(savedTracks().map((track) => [track.id, track.pan])).toEqual([
      ['track-a', 1],
      ['track-b', -0.25],
    ]);
    expect(await screen.findByText('R1.0')).toBeInTheDocument();
    expect(mocks.push).toHaveBeenCalledTimes(1);
    expect(mocks.push.mock.calls[0]![0].label).toBe('Pan Right');
  });

  it('centers every explicitly selected track with one save and one history step', async () => {
    await renderEditor();
    fireEvent.click(await screen.findByRole('button', { name: /^Clip A/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Clip B/ }), { shiftKey: true });
    await openPanMenu();
    fireEvent.click(await screen.findByText('Center 中央'));

    await waitFor(() => expect(mutationCallCount()).toBe(1));
    expect(savedTracks().map((track) => track.pan)).toEqual([0, 0]);
    expect(mocks.push).toHaveBeenCalledTimes(1);
    expect(mocks.push.mock.calls[0]![0].label).toBe('Pan Center');
  });

  it('disables the submenu when there is no target track', async () => {
    mockProject = { ...mockProject, tracks: [] };
    await renderEditor();
    fireEvent.pointerDown(screen.getByRole('button', { name: '轨道' }));
    expect(await screen.findByText('Pan 声像')).toHaveAttribute('aria-disabled', 'true');
    expect(mutationCallCount()).toBe(0);
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('does not create history or change the visible pan when the single project save fails', async () => {
    mocks.setTracksPan.mockRejectedValue(new Error('storage unavailable'));
    await renderEditor();
    fireEvent.click(await screen.findByRole('button', { name: /^Clip B/ }));
    await openPanMenu();
    fireEvent.click(await screen.findByText('Center 中央'));

    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith('storage unavailable'));
    expect(mutationCallCount()).toBe(1);
    expect(mocks.push).not.toHaveBeenCalled();
    expect(screen.getByText('L0.3')).toBeInTheDocument();
  });

  it('preserves a concurrent track addition and rename while pan is being saved', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    mocks.saveProject.mockImplementation(async (project: IProject) => {
      await gate;
      mockProject = project;
    });
    mocks.setTracksPan.mockImplementation(async (_projectId: string, trackIds: string[], pan: -1 | 0 | 1) => {
      await gate;
      const before = structuredClone(mockProject);
      const targets = new Set(trackIds);
      const after: IProject = {
        ...mockProject,
        tracks: mockProject.tracks.map((track) => targets.has(track.id) ? { ...track, pan } : track),
      };
      mockProject = after;
      return { before, after };
    });
    await renderEditor();
    fireEvent.click(await screen.findByRole('button', { name: /^Clip B/ }));
    await openPanMenu();
    fireEvent.click(await screen.findByText('Left 左侧'));
    await waitFor(() => expect(mocks.saveProject.mock.calls.length + mocks.setTracksPan.mock.calls.length).toBe(1));

    const added = structuredClone(mockProject.tracks[0]!);
    added.id = 'track-c';
    added.name = 'Track C';
    added.clips = added.clips.map((clip) => ({ ...clip, id: 'clip-c', audioBufferId: 'buffer-c' }));
    mockProject = {
      ...mockProject,
      tracks: [
        ...mockProject.tracks.map((track) => track.id === 'track-a' ? { ...track, name: 'Renamed A' } : track),
        added,
      ],
    };
    release();

    await waitFor(() => expect(mocks.push).toHaveBeenCalledTimes(1));
    expect(mockProject.tracks.map((track) => track.id)).toEqual(['track-a', 'track-b', 'track-c']);
    expect(mockProject.tracks[0]?.name).toBe('Renamed A');
    expect(mockProject.tracks.map((track) => track.pan)).toEqual([0.25, -1, 0.25]);
    const command = mocks.push.mock.calls[0]![0];
    expect(command.undo().tracks.map((track: { id: string }) => track.id)).toEqual(['track-a', 'track-b', 'track-c']);
  });
});
