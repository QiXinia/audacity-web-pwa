// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IProject, ViewMode } from '@/types/project';
import { loadWorkspaceStore, saveWorkspaceStore, WORKSPACE_STORAGE_KEY } from '@/services/workspaceService';
import { METER_PREFERENCES_STORAGE_KEY } from '@/lib/meterPreferences';
import {
  CHANNEL_HEIGHT_RATIO_STORAGE_PREFIX,
  STEREO_HEIGHTS_PREFERENCES_STORAGE_KEY,
} from '@/lib/stereoHeights';

const mocks = vi.hoisted(() => ({
  loadChannels: vi.fn(),
  drawWaveform: vi.fn(),
  error: vi.fn(),
}));

const left = new Float32Array(4000).fill(0.0001);
const right = new Float32Array(4000).fill(-0.0001);
let mockProject: IProject;

function makeProject(channelMode: 'stereo' | 'mono' = 'stereo'): IProject {
  return {
    id: 'db-waveform-project',
    name: 'dB waveform integration',
    tracks: [{
      id: 'track-db',
      name: 'Low-level stereo track',
      type: 'audio',
      gain: 0,
      pan: 0,
      muted: false,
      solo: false,
      armed: false,
      color: '#7aa2f7',
      effects: [],
      clips: [{
        id: 'clip-db',
        audioBufferId: channelMode === 'stereo' ? 'buffer-stereo' : 'buffer-mono',
        startTime: 0,
        offset: 0,
        duration: 4,
        originalDuration: 4,
        stretchRatio: 1,
        gain: 0,
        fadeIn: 0,
        fadeOut: 0,
        name: 'Minus eighty dB clip',
      }],
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
  useParams: () => ({ projectId: 'db-waveform-project' }), useNavigate: () => vi.fn(),
}));
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: mocks.error, info: vi.fn(), warning: vi.fn() },
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), log: vi.fn() } }));

import AudioEditorPage from './AudioEditorPage';
import { audioEngine } from '@/engine/audioEngine';

function setWorkspaceViewMode(viewMode: ViewMode, verticalZoom = 1) {
  const store = loadWorkspaceStore();
  saveWorkspaceStore({
    ...store,
    presets: store.presets.map((preset) => preset.id === store.activeId
      ? { ...preset, layout: { ...preset.layout, viewMode, verticalZoom } }
      : preset),
  });
}

async function renderProject() {
  render(<AudioEditorPage />);
  expect(await screen.findByText('dB waveform integration')).toBeInTheDocument();
  await screen.findByText('Minus eighty dB clip');
  await waitFor(() => expect(mocks.loadChannels).toHaveBeenCalled());
}

describe('AudioEditorPage dB waveform and ruler', () => {
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

  it('switches through the real tab, passes the default range, and restores the Workspace mode', async () => {
    await renderProject();
    expect(screen.queryByTestId('track-db-ruler-track-db')).not.toBeInTheDocument();
    expect(screen.getByTestId('track-linear-ruler-track-db')).toHaveAttribute('data-ruler-format', 'waveform');

    const tab = screen.getByTestId('waveform-db-tab');
    fireEvent.mouseDown(tab, { button: 0, ctrlKey: false });
    fireEvent.click(tab);
    const ruler = await screen.findByTestId('track-db-ruler-track-db');
    expect(ruler).toHaveAttribute('data-db-range', '-60');
    await waitFor(() => expect(ruler).toHaveAttribute('data-channel-count', '2'));
    await waitFor(() => expect(mocks.drawWaveform.mock.calls.some((call) => call[10] === -60)).toBe(true));
    await waitFor(() => {
      const store = loadWorkspaceStore();
      expect(store.presets.find((preset) => preset.id === store.activeId)?.layout.viewMode).toBe('waveformDb');
    });

    cleanup();
    await renderProject();
    expect(screen.getByTestId('waveform-db-tab')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('track-db-ruler-track-db')).toBeInTheDocument();
  });

  it('reuses -96 dB, asymmetric stereo heights, and vertical zoom in drawing and ruler state', async () => {
    window.localStorage.setItem(METER_PREFERENCES_STORAGE_KEY, JSON.stringify({ dbRange: -96 }));
    window.localStorage.setItem(STEREO_HEIGHTS_PREFERENCES_STORAGE_KEY, JSON.stringify({ mode: 'always', workspaceNames: [] }));
    window.localStorage.setItem(
      `${CHANNEL_HEIGHT_RATIO_STORAGE_PREFIX}db-waveform-project`,
      JSON.stringify({ 'track-db': 0.75 }),
    );
    setWorkspaceViewMode('waveformDb');
    await renderProject();

    const ruler = await screen.findByTestId('track-db-ruler-track-db');
    const canvas = screen.getByTestId('waveform-canvas-clip-db');
    await waitFor(() => expect(canvas).toHaveAttribute('data-channel-count', '2'));
    expect(ruler).toHaveAttribute('data-db-range', '-96');
    expect(canvas).toHaveAttribute('data-db-range', '-96');
    expect(Number(ruler.getAttribute('data-stereo-ratio'))).toBeCloseTo(56 / 76, 8);
    expect(Number(canvas.getAttribute('data-stereo-ratio'))).toBeCloseTo(56 / 76, 8);
    await waitFor(() => expect(mocks.drawWaveform.mock.calls.some((call) => call[10] === -96)).toBe(true));
    expect(document.querySelector('[data-testid="db-ruler-tick-track-db-0-positive-n96"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="db-ruler-tick-track-db-1-positive-n96"]')).not.toBeNull();

    fireEvent.pointerDown(screen.getByRole('button', { name: '视图' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: '纵向放大' }));
    await waitFor(() => expect(ruler).toHaveAttribute('data-vertical-zoom', '2'));
    await waitFor(() => expect(mocks.drawWaveform.mock.calls.some((call) => call[7] === 2 && call[10] === -96)).toBe(true));
  });

  it('uses one ruler band for mono audio and removes the ruler in spectrum mode', async () => {
    mockProject = makeProject('mono');
    setWorkspaceViewMode('waveformDb');
    await renderProject();
    const ruler = await screen.findByTestId('track-db-ruler-track-db');
    await waitFor(() => expect(ruler).toHaveAttribute('data-channel-count', '1'));
    expect(document.querySelector('[data-testid="db-ruler-tick-track-db-1-positive-n60"]')).toBeNull();

    const spectrumTab = screen.getByRole('tab', { name: '频谱' });
    fireEvent.mouseDown(spectrumTab, { button: 0, ctrlKey: false });
    fireEvent.click(spectrumTab);
    await waitFor(() => expect(screen.queryByTestId('track-db-ruler-track-db')).not.toBeInTheDocument());
  });

  it('subtracts the ruler width from mouse time conversion in dB and linear modes', async () => {
    mockProject = makeProject('mono');
    setWorkspaceViewMode('waveformDb');
    await renderProject();
    await screen.findByTestId('track-db-ruler-track-db');
    const timeline = screen.getByTestId('track-db-ruler-track-db').parentElement as HTMLElement;
    Object.defineProperty(timeline, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ left: 100, top: 0, right: 1144, bottom: 76, width: 1044, height: 76, x: 100, y: 0 }),
    });

    fireEvent.mouseDown(timeline, { button: 0, clientX: 344, clientY: 20 });
    expect(audioEngine.seek).toHaveBeenLastCalledWith(2);

    const linearTab = screen.getByRole('tab', { name: /^波形$/ });
    fireEvent.mouseDown(linearTab, { button: 0, ctrlKey: false });
    fireEvent.click(linearTab);
    await waitFor(() => expect(screen.queryByTestId('track-db-ruler-track-db')).not.toBeInTheDocument());
    expect(screen.getByTestId('track-linear-ruler-track-db')).toBeInTheDocument();
    fireEvent.mouseDown(timeline, { button: 0, clientX: 344, clientY: 20 });
    expect(audioEngine.seek).toHaveBeenLastCalledWith(2);
  });

  it('switches Linear (dB), applies half-wave, and saves both in the active Workspace', async () => {
    setWorkspaceViewMode('waveformDb');
    await renderProject();
    const ruler = await screen.findByTestId('track-db-ruler-track-db');
    expect(screen.getByTestId('db-ruler-tick-track-db-0-positive-n60')).toHaveTextContent('60');

    fireEvent.pointerDown(screen.getByTestId('track-ruler-settings-track-db'));
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'Linear (dB)' }));
    await waitFor(() => expect(ruler).toHaveAttribute('data-ruler-format', 'waveformDbLinear'));
    expect(screen.getByTestId('waveform-canvas-clip-db')).toHaveAttribute('data-view-mode', 'waveformDbLinear');
    expect(screen.getByTestId('db-ruler-tick-track-db-0-positive-n60')).toHaveTextContent('∞');
    await waitFor(() => expect(mocks.drawWaveform.mock.calls.some(
      (call) => call[10] === undefined && call[11] === false,
    )).toBe(true));

    mocks.drawWaveform.mockClear();
    fireEvent.pointerDown(screen.getByTestId('track-ruler-settings-track-db'));
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'Half wave' }));
    await waitFor(() => expect(ruler).toHaveAttribute('data-half-wave', 'true'));
    expect(screen.getByTestId('waveform-canvas-clip-db')).toHaveAttribute('data-half-wave', 'true');
    expect(screen.queryByTestId('db-ruler-tick-track-db-0-negative-n60')).not.toBeInTheDocument();
    await waitFor(() => expect(mocks.drawWaveform.mock.calls.some(
      (call) => call[10] === undefined && call[11] === true,
    )).toBe(true));
    await waitFor(() => {
      const stored = JSON.parse(window.localStorage.getItem(WORKSPACE_STORAGE_KEY) ?? '{}');
      expect(stored.presets.find((preset: { id: string }) => preset.id === stored.activeId).layout).toMatchObject({
        viewMode: 'waveformDbLinear',
        halfWave: true,
      });
    });
  });

  it('zooms and resets from the ruler popup and returns to Linear (amp)', async () => {
    setWorkspaceViewMode('waveformDbLinear');
    await renderProject();
    const ruler = await screen.findByTestId('track-db-ruler-track-db');
    fireEvent.pointerDown(screen.getByTestId('track-ruler-settings-track-db'));
    fireEvent.click(await screen.findByRole('menuitem', { name: '放大' }));
    await waitFor(() => expect(ruler).toHaveAttribute('data-vertical-zoom', '2'));

    fireEvent.pointerDown(screen.getByTestId('track-ruler-settings-track-db'));
    fireEvent.click(await screen.findByRole('menuitem', { name: '重置' }));
    await waitFor(() => expect(ruler).toHaveAttribute('data-vertical-zoom', '1'));

    fireEvent.pointerDown(screen.getByTestId('track-ruler-settings-track-db'));
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'Linear (amp)' }));
    await waitFor(() => expect(screen.queryByTestId('track-db-ruler-track-db')).not.toBeInTheDocument());
    expect(screen.getByTestId('track-linear-ruler-track-db')).toHaveAttribute('data-ruler-format', 'waveform');
    expect(screen.getByTestId('waveform-canvas-clip-db')).toHaveAttribute('data-view-mode', 'waveform');

    const linearDbTab = screen.getByRole('tab', { name: '线性 dB' });
    fireEvent.mouseDown(linearDbTab, { button: 0, ctrlKey: false });
    fireEvent.click(linearDbTab);
    await waitFor(() => expect(screen.getByTestId('track-db-ruler-track-db')).toHaveAttribute(
      'data-ruler-format',
      'waveformDbLinear',
    ));
  });

  it('renders official Linear (amp) mono ticks and switches to half-wave', async () => {
    mockProject = makeProject('mono');
    setWorkspaceViewMode('waveform');
    await renderProject();
    const ruler = await screen.findByTestId('track-linear-ruler-track-db');
    await waitFor(() => expect(ruler).toHaveAttribute('data-channel-count', '1'));

    expect(screen.getByTestId('linear-ruler-major-tick-track-db-0-n1')).toHaveTextContent('1.0');
    expect(screen.getByTestId('linear-ruler-major-tick-track-db-0-0')).toHaveTextContent('0.0');
    expect(screen.getByTestId('linear-ruler-major-tick-track-db-0-1')).toHaveTextContent('1.0');
    expect(screen.getByTestId('linear-ruler-minor-tick-track-db-0-n0p5')).toHaveAttribute('data-y', '55');
    expect(screen.getByTestId('linear-ruler-minor-tick-track-db-0-0p5')).toHaveAttribute('data-y', '21');
    expect(screen.queryByTestId('track-db-ruler-track-db')).not.toBeInTheDocument();

    fireEvent.pointerDown(screen.getByTestId('track-ruler-settings-track-db'));
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'Half wave' }));
    await waitFor(() => expect(ruler).toHaveAttribute('data-half-wave', 'true'));
    expect(screen.queryByTestId('linear-ruler-major-tick-track-db-0-n1')).not.toBeInTheDocument();
    expect(screen.getByTestId('linear-ruler-major-tick-track-db-0-0')).toHaveAttribute('data-y', '72');
    expect(screen.getByTestId('linear-ruler-major-tick-track-db-0-0p5')).toHaveTextContent('0.5');
    expect(screen.getByTestId('waveform-canvas-clip-db')).toHaveAttribute('data-half-wave', 'true');
  });

  it('collapses short stereo channels and persists Linear (amp) zoom and half-wave', async () => {
    setWorkspaceViewMode('waveform');
    await renderProject();
    const ruler = await screen.findByTestId('track-linear-ruler-track-db');
    await waitFor(() => expect(ruler).toHaveAttribute('data-channel-count', '2'));
    expect(screen.getByTestId('linear-ruler-major-tick-track-db-0-0')).toHaveTextContent('0.0');
    expect(screen.getByTestId('linear-ruler-major-tick-track-db-1-0')).toHaveAttribute('data-collapsed', 'true');
    expect(screen.getByTestId('linear-ruler-major-tick-track-db-1-0')).toHaveAttribute('data-full-width', 'true');
    expect(screen.queryByTestId('linear-ruler-major-tick-track-db-0-n1')).not.toBeInTheDocument();

    fireEvent.pointerDown(screen.getByTestId('track-ruler-settings-track-db'));
    fireEvent.click(await screen.findByRole('menuitem', { name: '放大' }));
    await waitFor(() => expect(ruler).toHaveAttribute('data-vertical-zoom', '2'));
    fireEvent.pointerDown(screen.getByTestId('track-ruler-settings-track-db'));
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'Half wave' }));
    await waitFor(() => expect(ruler).toHaveAttribute('data-half-wave', 'true'));
    expect(screen.getByTestId('linear-ruler-major-tick-track-db-0-0p25')).toHaveTextContent('0.25');
    expect(screen.getByTestId('linear-ruler-major-tick-track-db-1-0p25')).toHaveTextContent('0.25');

    cleanup();
    await renderProject();
    const restored = screen.getByTestId('track-linear-ruler-track-db');
    expect(restored).toHaveAttribute('data-ruler-format', 'waveform');
    expect(restored).toHaveAttribute('data-vertical-zoom', '2');
    expect(restored).toHaveAttribute('data-half-wave', 'true');
  });

  it('exposes both dB formats and half-wave in the View menu', async () => {
    await renderProject();
    fireEvent.pointerDown(screen.getByRole('button', { name: '视图' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: '波形 (线性 dB)' }));
    const ruler = await screen.findByTestId('track-db-ruler-track-db');
    expect(ruler).toHaveAttribute('data-ruler-format', 'waveformDbLinear');

    fireEvent.pointerDown(screen.getByRole('button', { name: '视图' }));
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: '半波显示' }));
    await waitFor(() => expect(ruler).toHaveAttribute('data-half-wave', 'true'));

    fireEvent.pointerDown(screen.getByRole('button', { name: '视图' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: '波形 (对数 dB)' }));
    await waitFor(() => expect(ruler).toHaveAttribute('data-ruler-format', 'waveformDb'));
    expect(ruler).toHaveAttribute('data-half-wave', 'true');
    expect(screen.getByTestId('db-ruler-tick-track-db-0-positive-n60')).toHaveTextContent('60');
  });

  it('toggles RMS from the View menu, redraws and restores it with the Workspace', async () => {
    await renderProject();
    expect(screen.getByTestId('waveform-canvas-clip-db')).toHaveAttribute('data-show-rms', 'false');
    await waitFor(() => expect(mocks.drawWaveform).toHaveBeenCalled());
    expect(mocks.drawWaveform.mock.calls.some((call) => call[12] === false)).toBe(true);

    fireEvent.pointerDown(screen.getByRole('button', { name: '视图' }));
    const menuItem = await screen.findByTestId('view-show-rms');
    expect(menuItem).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(menuItem);

    await waitFor(() => expect(screen.getByTestId('waveform-canvas-clip-db')).toHaveAttribute('data-show-rms', 'true'));
    await waitFor(() => expect(mocks.drawWaveform.mock.calls.some((call) => call[12] === true)).toBe(true));
    await waitFor(() => {
      const active = loadWorkspaceStore().presets.find((preset) => preset.id === loadWorkspaceStore().activeId);
      expect(active?.layout.showRMS).toBe(true);
    });

    cleanup();
    mocks.drawWaveform.mockClear();
    await renderProject();
    expect(screen.getByTestId('waveform-canvas-clip-db')).toHaveAttribute('data-show-rms', 'true');
    await waitFor(() => expect(mocks.drawWaveform.mock.calls.some((call) => call[12] === true)).toBe(true));
  });
});
