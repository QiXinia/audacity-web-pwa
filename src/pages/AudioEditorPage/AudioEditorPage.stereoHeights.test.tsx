// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IProject } from '@/types/project';
import { loadWorkspaceStore, saveWorkspaceStore } from '@/services/workspaceService';
import {
  CHANNEL_HEIGHT_RATIO_STORAGE_PREFIX,
  STEREO_HEIGHTS_PREFERENCES_STORAGE_KEY,
} from '@/lib/stereoHeights';

const mocks = vi.hoisted(() => ({
  loadChannels: vi.fn(),
  drawWaveform: vi.fn(),
  error: vi.fn(),
}));

const left = new Float32Array(4000).fill(0.4);
const right = new Float32Array(4000).fill(-0.3);

let mockProject: IProject;

function makeProject(channelMode: 'stereo' | 'mono' = 'stereo'): IProject {
  const clip = (id: string, startTime: number) => ({
    id,
    audioBufferId: channelMode === 'stereo' ? 'buffer-stereo' : 'buffer-mono',
    startTime,
    offset: 0,
    duration: 4,
    originalDuration: 4,
    stretchRatio: 1,
    gain: 0,
    fadeIn: 0,
    fadeOut: 0,
    name: id === 'clip-a' ? 'Clip A' : 'Clip B',
  });
  return {
    id: 'stereo-heights-project',
    name: 'Stereo heights integration',
    tracks: [{
      id: 'track-stereo',
      name: 'Stereo track',
      type: 'audio',
      gain: 0,
      pan: 0,
      muted: false,
      solo: false,
      armed: false,
      color: '#7aa2f7',
      effects: [],
      clips: channelMode === 'stereo' ? [clip('clip-a', 0), clip('clip-b', 5)] : [clip('clip-a', 0)],
    }],
    cursorPosition: 0,
    selection: null,
    spectralSelection: null,
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
    saveProject: vi.fn(async () => undefined),
    loadAudioChannels: mocks.loadChannels,
    loadAudioBuffer: vi.fn(async () => null),
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
  useParams: () => ({ projectId: 'stereo-heights-project' }), useNavigate: () => vi.fn(),
}));
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: mocks.error, info: vi.fn(), warning: vi.fn() },
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), log: vi.fn() } }));

import AudioEditorPage from './AudioEditorPage';

function setPreferences(mode: 'always' | 'workspace-dependent' | 'never', workspaceNames: string[] = []) {
  window.localStorage.setItem(STEREO_HEIGHTS_PREFERENCES_STORAGE_KEY, JSON.stringify({ mode, workspaceNames }));
}

function mockPointerCapture(element: HTMLElement) {
  Object.defineProperties(element, {
    setPointerCapture: { configurable: true, value: vi.fn() },
    hasPointerCapture: { configurable: true, value: vi.fn(() => true) },
    releasePointerCapture: { configurable: true, value: vi.fn() },
  });
}

async function renderProject() {
  render(<AudioEditorPage />);
  expect(await screen.findByText('Stereo heights integration')).toBeInTheDocument();
  await screen.findByText('Clip A');
  await waitFor(() => expect(mocks.loadChannels).toHaveBeenCalled());
}

describe('AudioEditorPage asymmetric stereo heights', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    mockProject = makeProject();
    mocks.loadChannels.mockImplementation(async (bufferId: string) => (
      bufferId === 'buffer-mono' ? [new Float32Array(left)] : [left, right]
    ));
    Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
    const context = {
      scale: vi.fn(), clearRect: vi.fn(), save: vi.fn(), translate: vi.fn(),
      beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn(), restore: vi.fn(), fillRect: vi.fn(),
    };
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      configurable: true,
      value: vi.fn(() => context),
    });
  });

  afterEach(() => cleanup());

  it('draws left and right channels separately and keeps Never equally split', async () => {
    await renderProject();
    const splitterA = await screen.findByTestId('stereo-channel-splitter-clip-a');
    const splitterB = screen.getByTestId('stereo-channel-splitter-clip-b');
    expect(splitterA).toBeDisabled();
    expect(splitterA).toHaveAttribute('aria-valuenow', '50');
    expect(splitterB).toHaveAttribute('aria-valuenow', '50');

    await waitFor(() => {
      expect(mocks.drawWaveform.mock.calls.some((call) => call[1] === left && call[3] === 38)).toBe(true);
      expect(mocks.drawWaveform.mock.calls.some((call) => call[1] === right && call[3] === 38)).toBe(true);
    });
  });

  it('shares dragging across clips, persists the track ratio, and enforces 20px bounds', async () => {
    setPreferences('always');
    await renderProject();
    const splitterA = await screen.findByTestId('stereo-channel-splitter-clip-a');
    const splitterB = screen.getByTestId('stereo-channel-splitter-clip-b');
    expect(splitterA).toBeEnabled();
    mockPointerCapture(splitterA);

    fireEvent.pointerDown(splitterA, { pointerId: 1, clientY: 38, button: 0 });
    fireEvent.pointerMove(splitterA, { pointerId: 1, clientY: 53, buttons: 1 });
    fireEvent.pointerUp(splitterA, { pointerId: 1, clientY: 53, button: 0 });

    const expected = 0.5 + 15 / 76;
    await waitFor(() => expect(splitterB).toHaveAttribute('aria-valuenow', '70'));
    expect(splitterA).toHaveAttribute('aria-valuenow', '70');
    const stored = JSON.parse(window.localStorage.getItem(
      `${CHANNEL_HEIGHT_RATIO_STORAGE_PREFIX}stereo-heights-project`,
    )!);
    expect(stored['track-stereo']).toBeCloseTo(expected, 10);

    fireEvent.keyDown(splitterA, { key: 'Home' });
    expect(splitterB).toHaveAttribute('aria-valuenow', '26');
    fireEvent.keyDown(splitterA, { key: 'End' });
    expect(splitterB).toHaveAttribute('aria-valuenow', '74');

    await waitFor(() => {
      const leftCall = [...mocks.drawWaveform.mock.calls].reverse().find((call) => call[1] === left);
      const rightCall = [...mocks.drawWaveform.mock.calls].reverse().find((call) => call[1] === right);
      expect(leftCall?.[3]).toBeCloseTo(56, 5);
      expect(rightCall?.[3]).toBeCloseTo(20, 5);
    });
  });

  it('allows Workspace dependent mode for the selected Music workspace', async () => {
    const store = loadWorkspaceStore();
    const music = store.presets.find((preset) => preset.name === 'Music')!;
    saveWorkspaceStore({
      ...store,
      activeId: music.id,
      presets: store.presets.map((preset) => preset.id === music.id
        ? { ...preset, layout: { ...preset.layout, viewMode: 'waveform' as const } }
        : preset),
    });
    setPreferences('workspace-dependent', ['Music']);
    await renderProject();
    expect(await screen.findByTestId('stereo-channel-splitter-clip-a')).toBeEnabled();
  });

  it('does not show a stereo splitter for mono clips', async () => {
    setPreferences('always');
    mockProject = makeProject('mono');
    await renderProject();
    await waitFor(() => expect(mocks.drawWaveform).toHaveBeenCalled());
    expect(screen.queryByTestId('stereo-channel-splitter-clip-a')).not.toBeInTheDocument();
  });
});
