import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IProject } from '@/types/project';

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  success: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
  saveProject: vi.fn(),
  loadChannels: vi.fn(),
}));
let mockProject: IProject;

function makeProject(): IProject {
  return {
    id: 'mute-project',
    name: 'Mute integration',
    tracks: [
      {
        id: 'track-a', name: 'Track A', type: 'audio', gain: 0, pan: 0,
        muted: false, solo: true, armed: false, color: '',
        clips: [{
          id: 'clip-a', audioBufferId: 'buffer-a', startTime: 0, offset: 0,
          duration: 0.01, originalDuration: 0.01, stretchRatio: 1,
          gain: 0, fadeIn: 0, fadeOut: 0, name: 'Clip A',
        }],
        effects: [],
      },
      {
        id: 'track-b', name: 'Track B', type: 'audio', gain: 0, pan: 0,
        muted: true, solo: true, armed: false, color: '',
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
vi.mock('react-router-dom', () => ({ useParams: () => ({ projectId: 'mute-project' }), useNavigate: () => vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: mocks.success, warning: mocks.warning, error: mocks.error } }));
vi.mock('@/utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), log: vi.fn() } }));

import AudioEditorPage from './AudioEditorPage';

async function renderEditor(): Promise<void> {
  render(<AudioEditorPage />);
  expect(await screen.findByText('Mute integration')).toBeInTheDocument();
}

async function openMuteMenu(): Promise<void> {
  fireEvent.pointerDown(screen.getByRole('button', { name: '轨道' }));
  const trigger = await screen.findByText('Mute/Unmute 静音/取消静音');
  fireEvent.pointerMove(trigger);
  fireEvent.keyDown(trigger, { key: 'ArrowRight' });
}

async function selectTrackB(): Promise<void> {
  fireEvent.click(await screen.findByRole('button', { name: /^Clip B/ }));
}

function savedTracks(): Pick<IProject, 'tracks'>['tracks'] {
  return mocks.saveProject.mock.calls[0]![0].tracks;
}

describe('AudioEditorPage Mute/Unmute commands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProject = makeProject();
    mocks.saveProject.mockImplementation(async (project: IProject) => {
      mockProject = project;
    });
    mocks.loadChannels.mockResolvedValue([Float32Array.from([0.2, 0.4])]);
  });

  afterEach(() => cleanup());

  it('exposes the official submenu and mutes every track with one save and history step', async () => {
    await renderEditor();
    await openMuteMenu();
    fireEvent.click(await screen.findByText('Mute All Tracks 静音所有轨道'));

    await waitFor(() => expect(mocks.saveProject).toHaveBeenCalledTimes(1));
    expect(savedTracks().map((track) => [track.muted, track.solo])).toEqual([[true, false], [true, false]]);
    await waitFor(() => {
      for (const name of ['Track A', 'Track B']) {
        expect(screen.getByRole('button', { name: `静音 ${name}` })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: `静音 ${name}` })).not.toHaveClass('au-secondary');
        expect(screen.getByRole('button', { name: `独奏 ${name}` })).toHaveAttribute('aria-pressed', 'false');
        expect(screen.getByRole('button', { name: `独奏 ${name}` })).toHaveClass('au-secondary');
      }
    });
    expect(mocks.push).toHaveBeenCalledTimes(1);
    expect(mocks.push.mock.calls[0]![0].label).toBe('Mute All Tracks');
  });

  it('unmutes every track and clears Simple Solo with Ctrl+Shift+U', async () => {
    await renderEditor();
    fireEvent.keyDown(window, { key: 'U', ctrlKey: true, shiftKey: true });

    await waitFor(() => expect(mocks.saveProject).toHaveBeenCalledTimes(1));
    expect(savedTracks().map((track) => [track.muted, track.solo])).toEqual([[false, false], [false, false]]);
    expect(mocks.push).toHaveBeenCalledTimes(1);
    expect(mocks.push.mock.calls[0]![0].label).toBe('Unmute All Tracks');
  });

  it('mutes only the explicitly selected track with Ctrl+Alt+U', async () => {
    await renderEditor();
    await selectTrackB();
    fireEvent.keyDown(window, { key: 'U', ctrlKey: true, altKey: true });

    await waitFor(() => expect(mocks.saveProject).toHaveBeenCalledTimes(1));
    expect(savedTracks().map((track) => [track.id, track.muted, track.solo])).toEqual([
      ['track-a', false, true],
      ['track-b', true, false],
    ]);
    expect(mocks.push).toHaveBeenCalledTimes(1);
    expect(mocks.push.mock.calls[0]![0].label).toBe('Mute Tracks');
  });

  it('unmutes only the explicitly selected track with Ctrl+Alt+Shift+U', async () => {
    await renderEditor();
    await selectTrackB();
    fireEvent.keyDown(window, { key: 'U', ctrlKey: true, altKey: true, shiftKey: true });

    await waitFor(() => expect(mocks.saveProject).toHaveBeenCalledTimes(1));
    expect(savedTracks().map((track) => [track.id, track.muted, track.solo])).toEqual([
      ['track-a', false, true],
      ['track-b', false, false],
    ]);
    expect(mocks.push).toHaveBeenCalledTimes(1);
    expect(mocks.push.mock.calls[0]![0].label).toBe('Unmute Tracks');
  });

  it('does not create history when the single project save fails', async () => {
    mocks.saveProject.mockRejectedValue(new Error('storage unavailable'));
    await renderEditor();
    fireEvent.keyDown(window, { key: 'U', ctrlKey: true });

    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith('storage unavailable'));
    expect(mocks.saveProject).toHaveBeenCalledTimes(1);
    expect(mocks.push).not.toHaveBeenCalled();
  });
});
