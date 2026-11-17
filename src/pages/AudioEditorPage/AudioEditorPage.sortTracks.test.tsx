import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IProject, ITrack } from '@/types/project';

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  success: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
  saveProject: vi.fn(),
  loadChannels: vi.fn(),
  setStateChangeCallback: vi.fn(),
}));
let mockProject: IProject;

function makeTrack(id: string, name: string, startTime: number): ITrack {
  return {
    id,
    name,
    type: 'audio',
    gain: 0,
    pan: 0,
    muted: false,
    solo: false,
    armed: false,
    color: '',
    clips: [{
      id: `clip-${id}`,
      audioBufferId: `buffer-${id}`,
      startTime,
      offset: 0,
      duration: 0.01,
      originalDuration: 0.01,
      stretchRatio: 1,
      gain: 0,
      fadeIn: 0,
      fadeOut: 0,
      name: `Clip ${id}`,
    }],
    effects: [],
  };
}

function makeProject(): IProject {
  return {
    id: 'sort-project',
    name: 'Sort integration',
    tracks: [
      makeTrack('late', 'beta', 5),
      makeTrack('early', 'Alpha', 1),
      makeTrack('early-2', 'Beta', 1),
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
  audioDb: {
    audioBuffers: { get: vi.fn(), put: vi.fn(), delete: vi.fn() }, clipboard: {}, historySnapshots: {},
  },
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
    getPlaybackLevels: vi.fn(() => ({ left: -Infinity, right: -Infinity })),
    getRecordingLevels: vi.fn(() => ({ left: -Infinity, right: -Infinity })),
    setCursorChangeCallback: vi.fn(), setStateChangeCallback: mocks.setStateChangeCallback,
    setPlaybackCompleteCallback: vi.fn(), setTracksEndCallback: vi.fn(),
    processClipChannels: vi.fn((_clip: unknown, source: Float32Array[]) => source.map((channel) => new Float32Array(channel))),
  },
}));
vi.mock('@/wasm/processor', () => ({ isWasmAvailable: vi.fn(() => false), wasmProcessor: {} }));
vi.mock('react-router-dom', () => ({ useParams: () => ({ projectId: 'sort-project' }), useNavigate: () => vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: mocks.success, warning: mocks.warning, error: mocks.error } }));
vi.mock('@/utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), log: vi.fn() } }));

import AudioEditorPage from './AudioEditorPage';

async function renderEditor(): Promise<void> {
  render(<AudioEditorPage />);
  expect(await screen.findByText('Sort integration')).toBeInTheDocument();
}

async function openSortMenu(): Promise<HTMLElement> {
  fireEvent.pointerDown(screen.getByRole('button', { name: '轨道' }));
  const trigger = await screen.findByText('Sort Tracks 轨道排序');
  fireEvent.pointerMove(trigger);
  fireEvent.keyDown(trigger, { key: 'ArrowRight' });
  return trigger;
}

function savedProject(): IProject {
  return mocks.saveProject.mock.calls[0]![0] as IProject;
}

function expectVisibleOrder(names: string[]): void {
  const elements = names.map((name) => screen.getByText(name));
  for (let index = 0; index < elements.length - 1; index += 1) {
    expect(elements[index]!.compareDocumentPosition(elements[index + 1]!) & 4).toBeTruthy();
  }
}

describe('AudioEditorPage Sort Tracks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProject = makeProject();
    mocks.saveProject.mockImplementation(async (project: IProject) => {
      mockProject = project;
    });
    mocks.loadChannels.mockResolvedValue([Float32Array.from([0.2, 0.4])]);
  });

  afterEach(() => cleanup());

  it('sorts every track by visible start time with one save and one official history step', async () => {
    await renderEditor();
    fireEvent.click(screen.getByText('beta'));
    await openSortMenu();
    fireEvent.click(await screen.findByText('By Start Time 按开始时间'));

    await waitFor(() => expect(mocks.saveProject).toHaveBeenCalledTimes(1));
    expect(savedProject().tracks.map((track) => track.id)).toEqual(['early', 'early-2', 'late']);
    expectVisibleOrder(['Alpha', 'Beta', 'beta']);
    expect(mocks.push).toHaveBeenCalledTimes(1);
    expect(mocks.push.mock.calls[0]![0].label).toBe('Sort by Time');
  });

  it('uses official case-insensitive name ordering and lowercase-first ties', async () => {
    await renderEditor();
    await openSortMenu();
    fireEvent.click(await screen.findByText('By Name 按名称'));

    await waitFor(() => expect(mocks.saveProject).toHaveBeenCalledTimes(1));
    expect(savedProject().tracks.map((track) => track.name)).toEqual(['Alpha', 'beta', 'Beta']);
    expectVisibleOrder(['Alpha', 'beta', 'Beta']);
    expect(mocks.push).toHaveBeenCalledTimes(1);
    expect(mocks.push.mock.calls[0]![0].label).toBe('Sort by Name');
  });

  it('keeps the official sort commands available while audio is playing', async () => {
    await renderEditor();
    const onPlaybackStateChange = mocks.setStateChangeCallback.mock.calls.at(-1)![0] as (state: string) => void;
    act(() => onPlaybackStateChange('playing'));
    await openSortMenu();
    const item = await screen.findByText('By Start Time 按开始时间');
    expect(item).not.toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(item);

    await waitFor(() => expect(mocks.saveProject).toHaveBeenCalledTimes(1));
    expect(mocks.push).toHaveBeenCalledTimes(1);
  });

  it('disables the submenu for an empty project', async () => {
    mockProject = { ...mockProject, tracks: [] };
    await renderEditor();
    fireEvent.pointerDown(screen.getByRole('button', { name: '轨道' }));
    expect(await screen.findByText('Sort Tracks 轨道排序')).toHaveAttribute('aria-disabled', 'true');
    expect(mocks.saveProject).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('keeps the visible order and creates no history when saving fails', async () => {
    mocks.saveProject.mockRejectedValue(new Error('storage unavailable'));
    await renderEditor();
    await openSortMenu();
    fireEvent.click(await screen.findByText('By Name 按名称'));

    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith('storage unavailable'));
    expect(mocks.saveProject).toHaveBeenCalledTimes(1);
    expect(mocks.push).not.toHaveBeenCalled();
    expectVisibleOrder(['beta', 'Alpha', 'Beta']);
  });
});
