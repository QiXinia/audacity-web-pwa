// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IProject } from '@/types/project';
import { METER_PREFERENCES_STORAGE_KEY } from '@/lib/meterPreferences';

const mocks = vi.hoisted(() => ({
  stateChange: null as null | ((state: 'stopped' | 'playing' | 'paused') => void),
  play: vi.fn(),
}));

const project: IProject = {
  id: 'meter-range-project',
  name: 'Meter range integration',
  tracks: [],
  cursorPosition: 0,
  selection: null,
  spectralSelection: null,
  viewState: { horizontalZoom: 100, verticalZoom: 1, scrollX: 0, viewMode: 'waveform' },
  updatedAt: 100,
  createdAt: 50,
  sampleRate: 44100,
  timeSignature: { numerator: 4, denominator: 4 },
  tempo: 120,
};

vi.mock('@/services/projectService', () => ({
  projectService: {
    getProject: vi.fn(async () => project),
    openProject: vi.fn(async () => project),
    saveProject: vi.fn(async () => undefined),
    loadAudioChannels: vi.fn(async () => []),
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
    setCursorChangeCallback: vi.fn(),
    setStateChangeCallback: vi.fn((callback: (state: 'stopped' | 'playing' | 'paused') => void) => {
      mocks.stateChange = callback;
    }),
    getRecordingLevels: vi.fn(() => ({ left: -60, right: -60 })),
    getPlaybackLevels: vi.fn(() => ({ left: -80, right: -80 })),
    cacheBuffer: vi.fn(), processClipChannels: vi.fn(), seek: vi.fn(),
    play: mocks.play.mockImplementation(async () => undefined),
    pause: vi.fn(), resume: vi.fn(), stopPlayback: vi.fn(),
  },
}));
vi.mock('@/wasm/processor', () => ({
  isWasmAvailable: vi.fn(() => false),
  wasmProcessor: { spectrogram: vi.fn(), sliceBuffer: vi.fn() },
}));
vi.mock('@/lib/waveformDrawing', () => ({ drawWaveform: vi.fn() }));
vi.mock('react-router-dom', () => ({
  useParams: () => ({ projectId: 'meter-range-project' }), useNavigate: () => vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), log: vi.fn() } }));

import AudioEditorPage from './AudioEditorPage';

async function renderAndPlay() {
  render(<AudioEditorPage />);
  expect(await screen.findByText('Meter range integration')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '播放' }));
  expect(mocks.play).toHaveBeenCalled();
  expect(mocks.stateChange).not.toBeNull();
  act(() => mocks.stateChange?.('playing'));
  expect(screen.getByRole('button', { name: '暂停' })).toBeInTheDocument();
}

describe('AudioEditorPage meter dB range', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    mocks.stateChange = null;
    Object.defineProperty(window, 'requestAnimationFrame', {
      configurable: true,
      value: (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 1),
    });
    Object.defineProperty(window, 'cancelAnimationFrame', {
      configurable: true,
      value: (handle: number) => window.clearTimeout(handle),
    });
  });

  afterEach(() => cleanup());

  it('keeps the official -60 dB default and clamps a -80 dB input to silence', async () => {
    await renderAndPlay();
    expect(screen.getByText('-60 … 0 dBFS · 峰值')).toBeInTheDocument();
    const meter = screen.getByRole('meter', { name: '播放左声道峰值电平' });
    expect(meter).toHaveAttribute('aria-valuemin', '-60');
    await waitFor(() => expect(meter).toHaveAttribute('aria-valuenow', '-60'));
    expect(meter).toHaveAttribute('aria-valuetext', '-∞ dBFS');
    expect(screen.getByTestId('playback-left-meter-fill')).toHaveStyle({ width: '0%' });
  });

  it('shows the same -80 dB input on the -96 dB scale after restoring preferences', async () => {
    window.localStorage.setItem(METER_PREFERENCES_STORAGE_KEY, JSON.stringify({ dbRange: -96 }));
    await renderAndPlay();
    expect(screen.getByText('-96 … 0 dBFS · 峰值')).toBeInTheDocument();
    const meter = screen.getByRole('meter', { name: '播放左声道峰值电平' });
    expect(meter).toHaveAttribute('aria-valuemin', '-96');
    await waitFor(() => expect(meter).toHaveAttribute('aria-valuenow', '-80'));
    expect(meter).toHaveAttribute('aria-valuetext', '-80.0 dBFS');
    expect(screen.getByTestId('playback-left-meter-fill')).toHaveStyle({ width: '7.5%' });
  });
});
