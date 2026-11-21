import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IClip, IProject, ITrack } from '@/types/project';
import { serializeAudioClipboard } from '@/services/clipboardService';

const mocks = vi.hoisted(() => ({
  success: vi.fn(), warning: vi.fn(), error: vi.fn(), info: vi.fn(),
  saveProject: vi.fn(), editLatestProject: vi.fn(), loadChannels: vi.fn(),
  clipboardGet: vi.fn(), audioBufferPut: vi.fn(), push: vi.fn(),
}));
let mockProject: IProject;

function makeClip(id: string): IClip {
  return {
    id, audioBufferId: `buffer-${id}`, startTime: 1, offset: 0,
    duration: 2, originalDuration: 2, stretchRatio: 1, gain: 0,
    fadeIn: 0, fadeOut: 0, name: id === 'clip-a' ? 'Voice take' : id,
  };
}

function makeTrack(id: string): ITrack {
  return {
    id, name: id === 'track-a' ? 'Alpha' : id, type: 'audio', gain: 0, pan: 0,
    muted: false, solo: false, armed: false, color: '#66A3FF',
    clips: [makeClip(id === 'track-a' ? 'clip-a' : `clip-${id}`)], effects: [],
  };
}

function makeProject(): IProject {
  return {
    id: 'clip-write-race-project', name: 'Clip write race integration',
    tracks: [makeTrack('track-a'), makeTrack('track-b')],
    cursorPosition: 0, selection: null,
    viewState: { horizontalZoom: 100, verticalZoom: 1, scrollX: 0, viewMode: 'waveform' },
    updatedAt: 100, createdAt: 50, sampleRate: 1000,
    timeSignature: { numerator: 4, denominator: 4 }, tempo: 120,
    labelTracks: [{ id: 'lane-a', name: 'Markers', colorIndex: 0 }],
    analysisLabels: [{
      id: 'label-a', kind: 'manual', trackId: 'track-a', labelTrackId: 'lane-a',
      start: 1, end: 2, text: 'Marker',
    }],
  };
}

vi.mock('@/services/projectService', () => ({
  projectService: {
    getProject: vi.fn(async () => mockProject),
    openProject: vi.fn(async () => mockProject),
    saveProject: mocks.saveProject,
    editLatestProject: mocks.editLatestProject,
    loadAudioChannels: mocks.loadChannels,
    loadAudioBuffer: vi.fn(async () => new Float32Array(10)),
  },
}));
vi.mock('@/services/historyService', () => ({
  historyManager: {
    push: mocks.push,
    canUndo: vi.fn(() => false), canRedo: vi.fn(() => false),
    loadForProject: vi.fn(async () => 0), flush: vi.fn(async () => undefined),
    undo: vi.fn(), redo: vi.fn(), getUndoStack: vi.fn(() => []), getRedoStack: vi.fn(() => []),
    getHistoryState: vi.fn(() => ({ canUndo: false, canRedo: false, undoLabel: '', redoLabel: '' })),
    clearHistory: vi.fn(), flushPersistence: vi.fn(),
  },
}));
vi.mock('@/db/audioDb', () => ({
  audioDb: {
    audioBuffers: { get: vi.fn(), put: mocks.audioBufferPut, delete: vi.fn() },
    clipboard: { get: mocks.clipboardGet },
    historySnapshots: {},
  },
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
vi.mock('react-router-dom', () => ({
  useParams: () => ({ projectId: 'clip-write-race-project' }), useNavigate: () => vi.fn(),
}));
vi.mock('sonner', () => ({
  toast: { success: mocks.success, warning: mocks.warning, error: mocks.error, info: mocks.info },
}));
vi.mock('@/utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), log: vi.fn() } }));

import AudioEditorPage from './AudioEditorPage';

async function renderEditor(): Promise<void> {
  render(<AudioEditorPage />);
  expect(await screen.findByText('Clip write race integration')).toBeInTheDocument();
  await screen.findByText('Voice take');
}

function mockBlockedProjectWrite(gate: Promise<void>): void {
  // The old page takes this whole-snapshot save path. The fixed page takes
  // editLatestProject and therefore evaluates the operation after the gate.
  mocks.saveProject.mockImplementation(async (project: IProject) => {
    await gate;
    mockProject = project;
    return true;
  });
  mocks.editLatestProject.mockImplementation(async (
    _projectId: string,
    edit: (project: IProject) => IProject,
  ) => {
    await gate;
    const before = structuredClone(mockProject);
    const after = edit(mockProject);
    if (after === mockProject) return null;
    mockProject = after;
    return { before, after };
  });
}

function addConcurrentTrackAndRename(): void {
  mockProject = {
    ...mockProject,
    tracks: [
      ...mockProject.tracks.map((track) => track.id === 'track-a'
        ? { ...track, name: 'Renamed Alpha' }
        : track),
      makeTrack('track-c'),
    ],
  };
}

describe('AudioEditorPage queued clip writes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProject = makeProject();
    mocks.loadChannels.mockResolvedValue([Float32Array.from([0.2, 0.4])]);
    mocks.clipboardGet.mockResolvedValue(undefined);
    mocks.audioBufferPut.mockResolvedValue('buffer-id');
    Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
  });

  afterEach(() => cleanup());

  it.each([
    { operation: 'trim', expected: { startTime: 1, duration: 1.9, stretchRatio: 1 } },
    { operation: 'stretch', expected: { startTime: 1, duration: 1.9, stretchRatio: 2 / 1.9 } },
    { operation: 'move', expected: { startTime: 1.1, duration: 2, stretchRatio: 1 } },
  ])('preserves concurrent additions and renames during $operation', async ({ operation, expected }) => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    // The old page takes this whole-snapshot save path. The fixed page takes
    // editLatestProject and therefore evaluates the operation after the gate.
    mocks.saveProject.mockImplementation(async (project: IProject) => {
      await gate;
      mockProject = project;
      return true;
    });
    mocks.editLatestProject.mockImplementation(async (
      _projectId: string,
      edit: (project: IProject) => IProject,
    ) => {
      await gate;
      const before = structuredClone(mockProject);
      const after = edit(mockProject);
      if (after === mockProject) return null;
      mockProject = after;
      return { before, after };
    });

    await renderEditor();
    const clip = screen.getByRole('button', { name: /^Voice take/ });
    if (operation === 'move') {
      fireEvent.keyDown(clip, { key: 'ArrowRight', altKey: true });
    } else {
      fireEvent.keyDown(within(clip).getByRole('button', {
        name: operation === 'trim' ? '修剪片段右边缘' : '拉伸片段右边缘',
      }), { key: 'ArrowLeft' });
    }
    await waitFor(() => expect(
      mocks.saveProject.mock.calls.length + mocks.editLatestProject.mock.calls.length,
    ).toBe(1));

    const added = makeTrack('track-c');
    mockProject = {
      ...mockProject,
      tracks: [
        ...mockProject.tracks.map((track) => track.id === 'track-a'
          ? { ...track, name: 'Renamed Alpha' }
          : track),
        added,
      ],
    };
    release();

    await waitFor(() => expect(mocks.push).toHaveBeenCalledTimes(1));
    expect(mockProject.tracks.map((track) => track.id)).toEqual(['track-a', 'track-b', 'track-c']);
    expect(mockProject.tracks[0]?.name).toBe('Renamed Alpha');
    expect(mockProject.tracks[0]?.clips[0]).toMatchObject(expected);
    const rendered = document.querySelector('.au-clip[data-audio-buffer-id="buffer-clip-a"]');
    expect(Number(rendered?.getAttribute('data-start-time'))).toBeCloseTo(expected.startTime, 10);
    expect(Number(rendered?.getAttribute('data-duration'))).toBeCloseTo(expected.duration, 10);
    expect(Number(rendered?.getAttribute('data-stretch-ratio'))).toBeCloseTo(expected.stretchRatio, 10);
    const command = mocks.push.mock.calls[0]?.[0];
    expect(command.execute().tracks.map((track: ITrack) => track.id)).toEqual(['track-a', 'track-b', 'track-c']);
    expect(command.undo().tracks.map((track: ITrack) => track.id)).toEqual(['track-a', 'track-b', 'track-c']);
  });

  it.each([
    { operation: 'reset' },
    { operation: 'color' },
    { operation: 'split' },
    { operation: 'delete' },
    { operation: 'duplicate-label' },
  ] as const)('preserves concurrent additions and renames during $operation', async ({ operation }) => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    mockBlockedProjectWrite(gate);
    if (operation === 'reset') {
      const clip = mockProject.tracks[0]!.clips[0]!;
      mockProject.tracks[0]!.clips[0] = { ...clip, duration: 2, stretchRatio: 2 };
    }
    if (operation === 'split') mockProject = { ...mockProject, cursorPosition: 1.5 };

    await renderEditor();
    const clip = screen.getByRole('button', { name: /^Voice take/ });
    if (operation === 'reset') {
      fireEvent.click(clip);
      fireEvent.click(screen.getByRole('button', { name: '速度 100%' }));
    } else if (operation === 'color') {
      fireEvent.contextMenu(clip);
      fireEvent.keyDown(await screen.findByTestId('clip-color-menu'), { key: 'ArrowRight' });
      fireEvent.click(await screen.findByTestId('clip-color-2'));
    } else if (operation === 'split') {
      fireEvent.contextMenu(clip);
      fireEvent.click(await screen.findByTestId('clip-split-menu'));
    } else if (operation === 'delete') {
      fireEvent.click(clip);
      fireEvent.click(screen.getByRole('button', { name: '删除选中片段' }));
    } else {
      fireEvent.contextMenu(screen.getByTestId('label-track-lane-a'));
      fireEvent.click(await screen.findByTestId('label-track-duplicate-menu'));
    }
    await waitFor(() => expect(
      mocks.saveProject.mock.calls.length + mocks.editLatestProject.mock.calls.length,
    ).toBe(1));

    addConcurrentTrackAndRename();
    release();

    await waitFor(() => expect(mocks.push).toHaveBeenCalledTimes(1));
    expect(mockProject.tracks.map((track) => track.id)).toEqual(['track-a', 'track-b', 'track-c']);
    expect(mockProject.tracks[0]?.name).toBe('Renamed Alpha');
    const editedClip = mockProject.tracks[0]?.clips.find((item) => item.id === 'clip-a');
    if (operation === 'reset') expect(editedClip).toMatchObject({ duration: 4, stretchRatio: 1 });
    if (operation === 'color') expect(editedClip?.colorIndex).toBe(2);
    if (operation === 'split') expect(mockProject.tracks[0]?.clips).toHaveLength(2);
    if (operation === 'delete') expect(editedClip).toBeUndefined();
    if (operation === 'duplicate-label') {
      expect(mockProject.labelTracks).toHaveLength(2);
      expect(mockProject.analysisLabels).toHaveLength(2);
    }
    const command = mocks.push.mock.calls[0]?.[0];
    expect(command.execute().tracks.map((track: ITrack) => track.id)).toEqual(['track-a', 'track-b', 'track-c']);
    expect(command.undo().tracks.map((track: ITrack) => track.id)).toEqual(['track-a', 'track-b', 'track-c']);
  });

  it('preserves concurrent additions and renames during multi Clip paste', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    mocks.clipboardGet.mockResolvedValue({
      id: 'current',
      createdAt: 123,
      data: serializeAudioClipboard({
        sampleRate: 1000,
        duration: 1,
        tracks: [{
          trackId: 'track-a', startTime: 0, channels: [],
          segments: [{
            startTime: 0, duration: 1, name: 'Pasted segment',
            channels: [Float32Array.from([0.1, 0.2])],
          }],
        }],
      }),
    });
    mocks.audioBufferPut.mockImplementation(async () => {
      await gate;
      return 'buffer-id';
    });
    mocks.saveProject.mockImplementation(async (project: IProject) => {
      mockProject = project;
      return true;
    });
    mocks.editLatestProject.mockImplementation(async (
      _projectId: string,
      edit: (project: IProject) => IProject | Promise<IProject>,
    ) => {
      await gate;
      const before = structuredClone(mockProject);
      const after = await edit(mockProject);
      if (after === mockProject) return null;
      mockProject = after;
      return { before, after };
    });

    await renderEditor();
    fireEvent.keyDown(window, { key: 'v', ctrlKey: true });
    await waitFor(() => expect(
      mocks.audioBufferPut.mock.calls.length + mocks.editLatestProject.mock.calls.length,
    ).toBe(1));

    addConcurrentTrackAndRename();
    release();

    await waitFor(() => expect(mocks.push).toHaveBeenCalledTimes(1));
    expect(mockProject.tracks.map((track) => track.id)).toEqual(['track-a', 'track-b', 'track-c']);
    expect(mockProject.tracks[0]?.name).toBe('Renamed Alpha');
    expect(mockProject.tracks[0]?.clips.some((clip) => clip.name === 'Pasted segment')).toBe(true);
    const command = mocks.push.mock.calls[0]?.[0];
    expect(command.execute().tracks.map((track: ITrack) => track.id)).toEqual(['track-a', 'track-b', 'track-c']);
    expect(command.undo().tracks.map((track: ITrack) => track.id)).toEqual(['track-a', 'track-b', 'track-c']);
  });

  it('keeps the rendered clip and history unchanged when the queued save fails', async () => {
    mocks.editLatestProject.mockRejectedValue(new Error('storage unavailable'));
    await renderEditor();
    const clip = screen.getByRole('button', { name: /^Voice take/ });

    fireEvent.keyDown(clip, { key: 'ArrowRight', altKey: true });

    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith('storage unavailable'));
    expect(mocks.push).not.toHaveBeenCalled();
    expect(clip).toHaveAttribute('data-start-time', '1');
    expect(clip).toHaveAttribute('data-duration', '2');
    expect(mockProject.tracks[0]?.clips[0]).toMatchObject({ startTime: 1, duration: 2 });
  });
});
