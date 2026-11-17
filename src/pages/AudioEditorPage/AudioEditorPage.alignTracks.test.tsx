import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IProject, ITrack } from '@/types/project';

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  success: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
  saveProject: vi.fn(),
  getPreferences: vi.fn(() => ({ moveSelectionWithTracks: false })),
  savePreferences: vi.fn(),
  loadChannels: vi.fn(),
  setStateChangeCallback: vi.fn(),
  setCursorChangeCallback: vi.fn(),
  seek: vi.fn(),
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
    id: 'align-project',
    name: 'Align integration',
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
    getPreferences: mocks.getPreferences,
    savePreferences: mocks.savePreferences,
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
    seek: mocks.seek, startRecording: vi.fn(), stopRecording: vi.fn(), cancelRecording: vi.fn(),
    initialize: vi.fn(), getLevel: vi.fn(() => 0), cacheBuffer: vi.fn(), evictBuffer: vi.fn(),
    getPlaybackLevels: vi.fn(() => ({ left: -Infinity, right: -Infinity })),
    getRecordingLevels: vi.fn(() => ({ left: -Infinity, right: -Infinity })),
    setCursorChangeCallback: mocks.setCursorChangeCallback, setStateChangeCallback: mocks.setStateChangeCallback,
    setPlaybackCompleteCallback: vi.fn(), setTracksEndCallback: vi.fn(),
    processClipChannels: vi.fn((_clip: unknown, source: Float32Array[]) => source.map((channel) => new Float32Array(channel))),
  },
}));
vi.mock('@/wasm/processor', () => ({ isWasmAvailable: vi.fn(() => false), wasmProcessor: {} }));
vi.mock('react-router-dom', () => ({ useParams: () => ({ projectId: 'align-project' }), useNavigate: () => vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: mocks.success, warning: mocks.warning, error: mocks.error } }));
vi.mock('@/utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), log: vi.fn() } }));

import AudioEditorPage from './AudioEditorPage';

async function renderEditor(): Promise<void> {
  render(<AudioEditorPage />);
  expect(await screen.findByText('Align integration')).toBeInTheDocument();
}

async function openAlignMenu(): Promise<void> {
  fireEvent.pointerDown(screen.getByRole('button', { name: '轨道' }));
  const trigger = await screen.findByText('Align Tracks 对齐轨道');
  fireEvent.pointerMove(trigger);
  fireEvent.keyDown(trigger, { key: 'ArrowRight' });
}

function savedProject(): IProject {
  return mocks.saveProject.mock.calls[0]![0] as IProject;
}

function start(id: string): number {
  return savedProject().tracks.find((track) => track.id === id)!.clips[0]!.startTime;
}

async function selectTwoTracks(): Promise<void> {
  fireEvent.click(await screen.findByRole('button', { name: /^Clip late，/ }), { ctrlKey: true });
  fireEvent.click(await screen.findByRole('button', { name: /^Clip early，/ }), { ctrlKey: true });
}

describe('AudioEditorPage Align Tracks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProject = makeProject();
    mocks.getPreferences.mockReturnValue({ moveSelectionWithTracks: false });
    mocks.saveProject.mockImplementation(async (project: IProject) => {
      mockProject = project;
    });
    mocks.loadChannels.mockResolvedValue([Float32Array.from([0.2, 0.4])]);
  });

  afterEach(() => cleanup());

  it('aligns the selected track start to zero with one save and one official history step', async () => {
    await renderEditor();
    await openAlignMenu();
    fireEvent.click(await screen.findByText('Start to Zero 起点到零'));

    await waitFor(() => expect(mocks.saveProject).toHaveBeenCalledTimes(1));
    expect(start('late')).toBe(0);
    expect(start('early')).toBe(1);
    expect(start('early-2')).toBe(1);
    expect(mocks.push).toHaveBeenCalledTimes(1);
    expect(mocks.push.mock.calls[0]![0].label).toBe('Align Start');
  });

  it('uses the cursor when there is no selection for Start to Cursor/Selection Start', async () => {
    await renderEditor();
    const onCursorChange = mocks.setCursorChangeCallback.mock.calls.at(-1)![0] as (position: number) => void;
    act(() => onCursorChange(2.5));
    await openAlignMenu();
    fireEvent.click(await screen.findByText('Start to Cursor/Selection Start 起点到光标/选区起点'));

    await waitFor(() => expect(mocks.saveProject).toHaveBeenCalledTimes(1));
    expect(start('late')).toBe(2.5);
    expect(mocks.push.mock.calls[0]![0].label).toBe('Align Start');
  });

  it('uses the latest selected track end for End to Selection End', async () => {
    mockProject.selection = { start: 1, end: 4 };
    await renderEditor();
    await openAlignMenu();
    fireEvent.click(await screen.findByText('End to Selection End 终点到选区终点'));

    await waitFor(() => expect(mocks.saveProject).toHaveBeenCalledTimes(1));
    expect(start('late')).toBeCloseTo(3.99, 10);
    expect(mocks.push.mock.calls[0]![0].label).toBe('Align End');
  });

  it('moves all selected tracks to their average start for Align Together', async () => {
    await renderEditor();
    await selectTwoTracks();
    await openAlignMenu();
    fireEvent.click(await screen.findByText('Align Together 对齐到一起'));

    await waitFor(() => expect(mocks.saveProject).toHaveBeenCalledTimes(1));
    expect(start('late')).toBe(3);
    expect(start('early')).toBe(3);
    expect(start('early-2')).toBe(1);
    expect(mocks.push.mock.calls[0]![0].label).toBe('Align Together');
  });

  it('uses the official Move history label for Together without moving the selection', async () => {
    mockProject.selection = { start: 6, end: 8 };
    mockProject.cursorPosition = 6;
    await renderEditor();
    await selectTwoTracks();
    await openAlignMenu();
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: /Move Selection with Tracks/ }));
    await openAlignMenu();
    fireEvent.click(await screen.findByText('Align Together 对齐到一起'));

    await waitFor(() => expect(mocks.saveProject).toHaveBeenCalledTimes(1));
    expect(start('late')).toBe(3);
    expect(start('early')).toBe(3);
    expect(savedProject().selection).toEqual({ start: 6, end: 8 });
    expect(savedProject().cursorPosition).toBe(6);
    expect(mocks.push).toHaveBeenCalledTimes(1);
    expect(mocks.push.mock.calls[0]![0].label).toBe('Align/Move Together');
  });

  it('places selected tracks end to end and zooms to the persisted project duration', async () => {
    mockProject.tracks[0]!.clips[0]!.duration = 1;
    mockProject.tracks[1]!.clips[0]!.duration = 2;
    await renderEditor();
    const viewport = await screen.findByTestId('timeline-viewport');
    Object.defineProperty(viewport, 'clientWidth', { configurable: true, value: 800 });
    await selectTwoTracks();
    await openAlignMenu();
    fireEvent.click(await screen.findByText('Align End to End 首尾相接'));

    await waitFor(() => expect(mocks.saveProject).toHaveBeenCalledTimes(1));
    expect(start('late')).toBe(5);
    expect(start('early')).toBe(6);
    expect(start('early-2')).toBe(1);
    expect(mocks.push.mock.calls[0]![0].label).toBe('Align End to End');
    // 800 px usable width / the new 8 s project, not the stale 6 s duration.
    await waitFor(() => expect(screen.getByText('缩放 100 px/s')).toBeInTheDocument());
    await waitFor(() => expect(viewport.scrollLeft).toBe(0));
  });

  it('persists Move Selection with Tracks and moves the saved selection, cursor, and history label', async () => {
    mockProject.selection = { start: 6, end: 8 };
    mockProject.cursorPosition = 2;
    await renderEditor();
    expect(mocks.seek).toHaveBeenCalledWith(2);
    const onCursorChange = mocks.setCursorChangeCallback.mock.calls.at(-1)![0] as (position: number) => void;
    act(() => onCursorChange(6));

    await openAlignMenu();
    const preference = await screen.findByRole('menuitemcheckbox', { name: /Move Selection with Tracks/ });
    expect(preference).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(preference);
    expect(mocks.savePreferences).toHaveBeenCalledWith({ moveSelectionWithTracks: true });

    await openAlignMenu();
    fireEvent.click(await screen.findByText('Start to Zero 起点到零'));

    await waitFor(() => expect(mocks.saveProject).toHaveBeenCalledTimes(1));
    expect(start('late')).toBe(0);
    expect(start('early')).toBe(1);
    expect(savedProject().selection).toEqual({ start: 1, end: 3 });
    expect(savedProject().cursorPosition).toBe(1);
    expect(mocks.seek).toHaveBeenLastCalledWith(1);
    expect(mocks.push).toHaveBeenCalledTimes(1);
    expect(mocks.push).toHaveBeenCalledWith(
      expect.objectContaining({ label: 'Align/Move Start' }),
      expect.objectContaining({ cursorPosition: 6, selection: { start: 6, end: 8 } }),
    );
  });

  it('disables Align Tracks while audio is playing and for an empty project', async () => {
    await renderEditor();
    const onPlaybackStateChange = mocks.setStateChangeCallback.mock.calls.at(-1)![0] as (state: string) => void;
    act(() => onPlaybackStateChange('playing'));
    fireEvent.pointerDown(screen.getByRole('button', { name: '轨道' }));
    expect(await screen.findByText('Align Tracks 对齐轨道')).toHaveAttribute('aria-disabled', 'true');
    cleanup();
    vi.clearAllMocks();
    mockProject = { ...makeProject(), tracks: [] };
    await renderEditor();
    fireEvent.pointerDown(screen.getByRole('button', { name: '轨道' }));
    expect(await screen.findByText('Align Tracks 对齐轨道')).toHaveAttribute('aria-disabled', 'true');
    expect(mocks.saveProject).not.toHaveBeenCalled();
  });

  it('keeps visible clip positions and creates no history when saving fails', async () => {
    mocks.saveProject.mockRejectedValue(new Error('storage unavailable'));
    await renderEditor();
    await openAlignMenu();
    fireEvent.click(await screen.findByText('Start to Zero 起点到零'));

    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith('storage unavailable'));
    expect(mocks.saveProject).toHaveBeenCalledTimes(1);
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mockProject.tracks[0]!.clips[0]!.startTime).toBe(5);
  });
});
