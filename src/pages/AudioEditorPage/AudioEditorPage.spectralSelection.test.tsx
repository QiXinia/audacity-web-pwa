// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IProject } from '@/types/project';
import type { FrequencySelection } from '@/lib/spectralSelection';
import { loadSpectrogramPreferences, saveSpectrogramPreferences } from '@/lib/spectrogramSettings';

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
  saveProject: vi.fn(),
  spectralEdit: vi.fn(),
  loadChannels: vi.fn(),
}));
let mockProject: IProject;

function makeProject(): IProject {
  return {
    id: 'spectral-selection-project',
    name: 'Spectral rectangle integration',
    tracks: [{
      id: 'track-one',
      name: 'Track one',
      type: 'audio',
      gain: 0,
      pan: 0,
      muted: false,
      solo: false,
      armed: false,
      color: '#7aa2f7',
      effects: [],
      spectrogramUseGlobalSettings: false,
      spectrogramSettings: {
        scale: 'linear', minFreq: 0, maxFreq: 100, gainDb: 0, rangeDb: 100,
        highBoostDbPerDec: 0, colorScheme: 'classic',
        algorithm: 'frequencies', windowType: 'hann', windowSize: 2048, zeroPaddingFactor: 2,
      },
      clips: [{
        id: 'clip-one',
        audioBufferId: 'buffer-one',
        startTime: 0,
        offset: 0,
        duration: 8,
        originalDuration: 8,
        stretchRatio: 1,
        gain: 0,
        fadeIn: 0,
        fadeOut: 0,
        name: 'Eight seconds',
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
    saveProject: mocks.saveProject,
    loadAudioChannels: mocks.loadChannels,
    loadAudioBuffer: vi.fn(async () => null),
    spectralEditSelectionOnTracks: mocks.spectralEdit,
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
    getUndoLabel: vi.fn(() => null),
    getRedoLabel: vi.fn(() => null),
  },
}));
vi.mock('@/db/audioDb', () => ({
  audioDb: {
    audioBuffers: { get: vi.fn(), put: vi.fn(), delete: vi.fn() },
    clipboard: { get: vi.fn(), put: vi.fn() },
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
    setCursorChangeCallback: vi.fn(), setStateChangeCallback: vi.fn(), setPlaybackCompleteCallback: vi.fn(), setTracksEndCallback: vi.fn(),
    getPlaybackLevels: vi.fn(() => ({ left: -Infinity, right: -Infinity })),
    getRecordingLevels: vi.fn(() => ({ left: -Infinity, right: -Infinity })),
    processClipChannels: vi.fn((_clip: unknown, source: Float32Array[]) => source.map((channel) => new Float32Array(channel))),
  },
}));
vi.mock('@/wasm/processor', () => ({
  isWasmAvailable: vi.fn(() => false),
  wasmProcessor: { spectrogram: vi.fn(), sliceBuffer: vi.fn() },
}));
vi.mock('react-router-dom', () => ({
  useParams: () => ({ projectId: 'spectral-selection-project' }),
  useNavigate: () => vi.fn(),
}));
vi.mock('sonner', () => ({
  toast: { success: mocks.success, error: mocks.error, info: mocks.info, warning: mocks.warning },
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), log: vi.fn() } }));

import AudioEditorPage from './AudioEditorPage';

async function showSpectrum() {
  render(<AudioEditorPage />);
  expect(await screen.findByText('Spectral rectangle integration')).toBeInTheDocument();
  expect(await screen.findByText('Eight seconds')).toBeInTheDocument();
  const spectrumTab = screen.getByRole('tab', { name: '频谱' });
  fireEvent.mouseDown(spectrumTab, { button: 0, ctrlKey: false });
  fireEvent.click(spectrumTab);
  return screen.findByTestId('spectral-selection-surface-clip-one');
}

async function showMultiView() {
  render(<AudioEditorPage />);
  expect(await screen.findByText('Spectral rectangle integration')).toBeInTheDocument();
  expect(await screen.findByText('Eight seconds')).toBeInTheDocument();
  const bothTab = screen.getByRole('tab', { name: '叠加' });
  fireEvent.mouseDown(bothTab, { button: 0, ctrlKey: false });
  fireEvent.click(bothTab);
  return screen.findByTestId('spectral-selection-surface-clip-one');
}

function mockSurface(surface: HTMLElement, height = 76) {
  Object.defineProperty(surface, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      left: 0, top: 0, right: 800, bottom: height, width: 800, height, x: 0, y: 0,
      toJSON: () => ({}),
    }),
  });
  Object.defineProperties(surface, {
    setPointerCapture: { configurable: true, value: vi.fn() },
    hasPointerCapture: { configurable: true, value: vi.fn(() => true) },
    releasePointerCapture: { configurable: true, value: vi.fn() },
  });
}

async function openDeleteSelection() {
  fireEvent.pointerDown(screen.getByRole('button', { name: '效果' }));
  fireEvent.click(await screen.findByTestId('effect-spectral-delete-selection'));
  return screen.findByTestId('spectral-edit-dialog');
}

describe('AudioEditorPage spectral rectangle selection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
    mockProject = makeProject();
    mocks.loadChannels.mockResolvedValue([new Float32Array(8000).fill(0.1)]);
    mocks.saveProject.mockImplementation(async (updated: IProject) => { mockProject = updated; });
    mocks.spectralEdit.mockImplementation(async (
      _id: string,
      selection: { start: number; end: number },
      _settings: unknown,
      _targets: unknown,
      spectralSelection: FrequencySelection | null,
    ) => {
      mockProject = { ...mockProject, selection, spectralSelection, updatedAt: 200 };
      return 1;
    });
  });

  it('draws a reverse drag, persists both dimensions and feeds Spectral Edit', async () => {
    const surface = await showSpectrum();
    mockSurface(surface);

    fireEvent.pointerDown(surface, { button: 0, pointerId: 7, clientX: 600, clientY: 14 });
    fireEvent.pointerMove(surface, { pointerId: 7, clientX: 200, clientY: 52 });
    fireEvent.pointerUp(surface, { pointerId: 7, clientX: 200, clientY: 52 });

    const status = await screen.findByTestId('spectral-selection-status');
    expect(status.textContent).toContain('31.579–81.579 Hz');
    const rectangle = screen.getByTestId('spectral-selection-rectangle');
    expect(parseFloat(rectangle.style.left)).toBeCloseTo(200);
    expect(parseFloat(rectangle.style.width)).toBeCloseTo(400);
    expect(parseFloat(rectangle.style.top)).toBeCloseTo(14);
    expect(parseFloat(rectangle.style.height)).toBeCloseTo(38);

    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(mocks.saveProject).toHaveBeenCalled());
    const saved = mocks.saveProject.mock.calls.at(-1)?.[0] as IProject;
    expect(saved.selection).toEqual({ start: 2, end: 6 });
    expect(saved.spectralSelection?.lowHz).toBeCloseTo(100 * 24 / 76);
    expect(saved.spectralSelection?.highHz).toBeCloseTo(100 * 62 / 76);

    await openDeleteSelection();
    expect(screen.getByTestId('spectral-selection-source').textContent).toContain('已读取频谱图矩形');
    expect(Number((screen.getByTestId('spectral-low-input') as HTMLInputElement).value))
      .toBeCloseTo(100 * 24 / 76);
    expect(Number((screen.getByTestId('spectral-high-input') as HTMLInputElement).value))
      .toBeCloseTo(100 * 62 / 76);

    fireEvent.click(screen.getByTestId('spectral-apply-button'));
    await waitFor(() => expect(mocks.spectralEdit).toHaveBeenCalledTimes(1));
    const [, appliedSelection, settings, , persistedFrequency] = mocks.spectralEdit.mock.calls[0];
    expect(appliedSelection).toEqual({ start: 2, end: 6 });
    expect(settings.kind).toBe('delete-selection');
    expect(settings.lowHz).toBeCloseTo(100 * 24 / 76);
    expect(settings.highHz).toBeCloseTo(100 * 62 / 76);
    expect(persistedFrequency.lowHz).toBeCloseTo(100 * 24 / 76);
    expect(persistedFrequency.highHz).toBeCloseTo(100 * 62 / 76);
    expect(mocks.push).toHaveBeenCalledTimes(1);
    const before = mocks.push.mock.calls[0][0].undo() as IProject;
    expect(before.selection).toEqual({ start: 2, end: 6 });
    expect(before.spectralSelection?.lowHz).toBeCloseTo(100 * 24 / 76);

    fireEvent.click(screen.getByRole('button', { name: '清除选区' }));
    expect(screen.queryByTestId('spectral-selection-status')).toBeNull();
    expect(screen.queryByTestId('spectral-selection-rectangle')).toBeNull();
  });

  it('restores a persisted frequency rectangle when spectrum view is opened', async () => {
    mockProject.selection = { start: 1, end: 3 };
    mockProject.spectralSelection = { lowHz: 20, highHz: 60 };
    const surface = await showSpectrum();
    expect(surface).toBeTruthy();

    expect(screen.getByTestId('spectral-selection-status').textContent).toContain('20.000–60.000 Hz');
    const rectangle = screen.getByTestId('spectral-selection-rectangle');
    expect(parseFloat(rectangle.style.left)).toBeCloseTo(100);
    expect(parseFloat(rectangle.style.width)).toBeCloseTo(200);

    await openDeleteSelection();
    expect((screen.getByTestId('spectral-low-input') as HTMLInputElement).value).toBe('20');
    expect((screen.getByTestId('spectral-high-input') as HTMLInputElement).value).toBe('60');
  });

  it('edits geometric center and log bandwidth into the canvas, persistence and Spectral Edit', async () => {
    mockProject.selection = { start: 1, end: 3 };
    mockProject.spectralSelection = { lowHz: 20, highHz: 60 };
    await showSpectrum();

    expect(screen.getByTestId('spectral-selection-bar')).toBeInTheDocument();
    expect(Number((screen.getByLabelText('几何中心频率（Hz）') as HTMLInputElement).value))
      .toBeCloseTo(Math.sqrt(1200));
    expect(Number((screen.getByLabelText('对数带宽 ln(high/low)') as HTMLInputElement).value))
      .toBeCloseTo(Math.log(3));

    fireEvent.change(screen.getByLabelText('几何中心频率（Hz）'), { target: { value: '40' } });
    fireEvent.change(screen.getByLabelText('对数带宽 ln(high/low)'), { target: { value: String(Math.log(4)) } });
    fireEvent.click(screen.getByRole('button', { name: '应用频率边界' }));

    await waitFor(() => expect(screen.getByTestId('spectral-selection-bar-values').textContent)
      .toContain('20.000–80.000 Hz'));
    const rectangle = screen.getByTestId('spectral-selection-rectangle');
    expect(parseFloat(rectangle.style.top)).toBeCloseTo(15.2);
    expect(parseFloat(rectangle.style.height)).toBeCloseTo(45.6);

    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(mocks.saveProject).toHaveBeenCalled());
    const saved = mocks.saveProject.mock.calls.at(-1)?.[0] as IProject;
    expect(saved.spectralSelection?.lowHz).toBeCloseTo(20);
    expect(saved.spectralSelection?.highHz).toBeCloseTo(80);

    await openDeleteSelection();
    expect(Number((screen.getByTestId('spectral-low-input') as HTMLInputElement).value)).toBeCloseTo(20);
    expect(Number((screen.getByTestId('spectral-high-input') as HTMLInputElement).value)).toBeCloseTo(80);
  });

  it('edits low and high bounds and rejects values beyond the displayed range', async () => {
    mockProject.selection = { start: 1, end: 3 };
    mockProject.spectralSelection = { lowHz: 20, highHz: 60 };
    await showSpectrum();

    fireEvent.click(screen.getByLabelText('频率编辑模式'));
    fireEvent.click(await screen.findByRole('option', { name: '低频与高频' }));
    fireEvent.change(screen.getByLabelText('低频（Hz）'), { target: { value: '30' } });
    fireEvent.change(screen.getByLabelText('高频（Hz）'), { target: { value: '90' } });
    fireEvent.click(screen.getByRole('button', { name: '应用频率边界' }));
    await waitFor(() => expect(screen.getByTestId('spectral-selection-bar-values').textContent)
      .toContain('30.000–90.000 Hz'));

    fireEvent.change(screen.getByLabelText('高频（Hz）'), { target: { value: '200' } });
    fireEvent.click(screen.getByRole('button', { name: '应用频率边界' }));
    expect(screen.getByRole('alert').textContent).toContain('100 Hz');
    expect(screen.getByTestId('spectral-selection-bar-values').textContent).toContain('30.000–90.000 Hz');

    fireEvent.change(screen.getByLabelText('低频（Hz）'), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText('高频（Hz）'), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: '应用频率边界' }));
    await waitFor(() => expect(screen.getByTestId('spectral-selection-bar-values').textContent)
      .toContain('0.000–100.000 Hz'));
    const rectangle = screen.getByTestId('spectral-selection-rectangle');
    expect(parseFloat(rectangle.style.top)).toBeCloseTo(0);
    expect(parseFloat(rectangle.style.height)).toBeCloseTo(76);

    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(mocks.saveProject).toHaveBeenCalled());
    const saved = mocks.saveProject.mock.calls.at(-1)?.[0] as IProject;
    expect(saved.spectralSelection).toEqual({ lowHz: 0, highHz: 100 });
  });

  it('confines Multi-view frequency selection to the lower pane and persists its half-height mapping', async () => {
    const surface = await showMultiView();
    const canvas = screen.getByTestId('waveform-canvas-clip-one');
    expect(canvas).toHaveAttribute('data-layout', 'split');
    expect(canvas).toHaveAttribute('data-waveform-pane-height', '38');
    expect(canvas).toHaveAttribute('data-spectrum-pane-height', '38');
    expect(canvas).toHaveAttribute('data-spectrum-top', '38');
    expect(surface).toHaveAttribute('data-layout', 'split');
    expect(surface.style.top).toBe('58px');
    expect(surface.style.height).toBe('38px');
    mockSurface(surface, 38);

    fireEvent.pointerDown(surface, { button: 0, pointerId: 9, clientX: 600, clientY: 7 });
    fireEvent.pointerMove(surface, { pointerId: 9, clientX: 200, clientY: 26 });
    fireEvent.pointerUp(surface, { pointerId: 9, clientX: 200, clientY: 26 });

    expect((await screen.findByTestId('spectral-selection-status')).textContent).toContain('31.579–81.579 Hz');
    const rectangle = screen.getByTestId('spectral-selection-rectangle');
    expect(parseFloat(rectangle.style.left)).toBeCloseTo(200);
    expect(parseFloat(rectangle.style.width)).toBeCloseTo(400);
    expect(parseFloat(rectangle.style.top)).toBeCloseTo(7);
    expect(parseFloat(rectangle.style.height)).toBeCloseTo(19);

    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(mocks.saveProject).toHaveBeenCalled());
    const saved = mocks.saveProject.mock.calls.at(-1)?.[0] as IProject;
    expect(saved.selection).toEqual({ start: 2, end: 6 });
    expect(saved.spectralSelection?.lowHz).toBeCloseTo(100 * 12 / 38);
    expect(saved.spectralSelection?.highHz).toBeCloseTo(100 * 31 / 38);
  });

  it('opens official track Spectrogram settings, validates, saves overrides and restores global defaults', async () => {
    await showSpectrum();
    mocks.saveProject.mockClear();
    fireEvent.click(screen.getByTestId('track-spectrogram-settings-track-one'));
    expect(await screen.findByTestId('track-spectrogram-settings-dialog')).toBeInTheDocument();
    expect(screen.getByTestId('spectrogram-use-global')).not.toBeChecked();
    expect(screen.getByTestId('spectrogram-scale')).toHaveValue('linear');

    fireEvent.change(screen.getByTestId('spectrogram-maxFreq'), { target: { value: '150' } });
    fireEvent.click(screen.getByTestId('spectrogram-cancel'));
    await waitFor(() => expect(screen.queryByTestId('track-spectrogram-settings-dialog')).not.toBeInTheDocument());
    expect(mocks.saveProject).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('track-spectrogram-settings-track-one'));
    await screen.findByTestId('track-spectrogram-settings-dialog');
    expect(screen.getByTestId('spectrogram-maxFreq')).toHaveValue(100);
    fireEvent.change(screen.getByTestId('spectrogram-scale'), { target: { value: 'logarithmic' } });
    fireEvent.change(screen.getByTestId('spectrogram-maxFreq'), { target: { value: '200' } });
    fireEvent.click(screen.getByTestId('spectrogram-apply'));
    expect(await screen.findByRole('alert')).toHaveTextContent('至少为 1 Hz');
    expect(mocks.saveProject).not.toHaveBeenCalled();

    fireEvent.change(screen.getByTestId('spectrogram-minFreq'), { target: { value: '20' } });
    fireEvent.change(screen.getByTestId('spectrogram-gainDb'), { target: { value: '35' } });
    fireEvent.change(screen.getByTestId('spectrogram-rangeDb'), { target: { value: '60' } });
    fireEvent.change(screen.getByTestId('spectrogram-highBoostDbPerDec'), { target: { value: '12' } });
    fireEvent.change(screen.getByTestId('spectrogram-color-scheme'), { target: { value: 'grayscale' } });
    fireEvent.change(screen.getByTestId('spectrogram-algorithm'), { target: { value: 'reassignment' } });
    fireEvent.change(screen.getByTestId('spectrogram-window-type'), { target: { value: 'blackman' } });
    fireEvent.change(screen.getByTestId('spectrogram-window-size'), { target: { value: '1024' } });
    fireEvent.change(screen.getByTestId('spectrogram-zero-padding'), { target: { value: '4' } });
    fireEvent.click(screen.getByTestId('spectrogram-apply'));
    await waitFor(() => expect(mocks.saveProject).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByTestId('track-spectrogram-settings-dialog')).not.toBeInTheDocument());
    const saved = mocks.saveProject.mock.calls.at(-1)?.[0] as IProject;
    expect(saved.tracks[0]?.spectrogramUseGlobalSettings).toBe(false);
    expect(saved.tracks[0]?.spectrogramSettings).toEqual({
      scale: 'logarithmic', minFreq: 20, maxFreq: 200, gainDb: 35, rangeDb: 60,
      highBoostDbPerDec: 12, colorScheme: 'grayscale',
      algorithm: 'reassignment', windowType: 'blackman', windowSize: 1024, zeroPaddingFactor: 4,
    });
    const canvas = screen.getByTestId('waveform-canvas-clip-one');
    expect(canvas).toHaveAttribute('data-spectrogram-scale', 'logarithmic');
    expect(canvas).toHaveAttribute('data-spectrogram-min-frequency', '20');
    expect(canvas).toHaveAttribute('data-spectrogram-max-frequency', '200');
    expect(canvas).toHaveAttribute('data-spectrogram-gain', '35');
    expect(canvas).toHaveAttribute('data-spectrogram-range', '60');
    expect(canvas).toHaveAttribute('data-spectrogram-high-boost', '12');
    expect(canvas).toHaveAttribute('data-spectrogram-color-scheme', 'grayscale');
    expect(canvas).toHaveAttribute('data-spectrogram-algorithm', 'reassignment');
    expect(canvas).toHaveAttribute('data-spectrogram-window-type', 'blackman');
    expect(canvas).toHaveAttribute('data-spectrogram-window-size', '1024');
    expect(canvas).toHaveAttribute('data-spectrogram-zero-padding', '4');
    expect(Number(screen.getByTestId('spectrum-ruler-tick-track-one-0-4').getAttribute('data-frequency-hz'))).toBeCloseTo(200);

    fireEvent.click(screen.getByTestId('track-spectrogram-settings-track-one'));
    await screen.findByTestId('track-spectrogram-settings-dialog');
    fireEvent.click(screen.getByTestId('spectrogram-use-global'));
    expect(screen.getByTestId('spectrogram-scale')).toHaveValue('mel');
    expect(screen.getByTestId('spectrogram-maxFreq')).toHaveValue(500);
    fireEvent.click(screen.getByTestId('spectrogram-apply'));
    await waitFor(() => expect(mocks.saveProject).toHaveBeenCalledTimes(2));
    const restored = mocks.saveProject.mock.calls.at(-1)?.[0] as IProject;
    expect(restored.tracks[0]?.spectrogramUseGlobalSettings).toBe(true);
    expect(restored.tracks[0]?.spectrogramSettings).toBeUndefined();
    expect(canvas).toHaveAttribute('data-spectrogram-scale', 'mel');
    expect(canvas).toHaveAttribute('data-spectrogram-max-frequency', '500');
  });

  it('honors the global Enable spectral selection preference while retaining time selection', async () => {
    saveSpectrogramPreferences({ ...loadSpectrogramPreferences(), spectralSelectionEnabled: false });
    const surface = await showSpectrum();
    mockSurface(surface);
    fireEvent.pointerDown(surface, { pointerId: 9, button: 0, clientX: 0, clientY: 7 });
    fireEvent.pointerMove(surface, { pointerId: 9, clientX: 200, clientY: 26 });
    fireEvent.pointerUp(surface, { pointerId: 9, clientX: 200, clientY: 26 });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(mocks.saveProject).toHaveBeenCalled());
    await waitFor(() => expect(mockProject.selection).toEqual({ start: 0, end: 2 }));
    expect(mockProject.spectralSelection).toBeNull();
    expect(screen.queryByTestId('spectral-selection-rectangle')).not.toBeInTheDocument();
  });
});
