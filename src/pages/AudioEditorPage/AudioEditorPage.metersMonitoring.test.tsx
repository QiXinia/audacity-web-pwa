import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IProject, ITrack } from '@/types/project';
import {
  RECORDING_MONITORING_PREFERENCES_STORAGE_KEY,
  loadRecordingMonitoringPreferences,
  saveRecordingMonitoringPreferences,
} from '@/lib/recordingMonitoringPreferences';
import { loadWorkspaceStore } from '@/services/workspaceService';

const mocks = vi.hoisted(() => ({
  success: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  saveProject: vi.fn(),
  loadChannels: vi.fn(),
  startMonitoring: vi.fn(),
  stopMonitoring: vi.fn(),
  setMonitoring: vi.fn(),
  isMonitoring: vi.fn(),
}));
let mockProject: IProject;

function makeTrack(id: string, name: string): ITrack {
  return {
    id, name, type: 'audio', gain: 0, pan: 0, muted: false, solo: false, armed: false,
    color: '#66A3FF', effects: [],
    clips: [{
      id: `clip-${id}`, audioBufferId: `buffer-${id}`, startTime: 0, offset: 0,
      duration: 0.01, originalDuration: 0.01, stretchRatio: 1, gain: 0,
      fadeIn: 0, fadeOut: 0, name: `Clip ${id}`,
    }],
  };
}

function makeProject(): IProject {
  return {
    id: 'meters-monitoring-project', name: 'Meters monitoring integration',
    tracks: [makeTrack('a', 'Alpha')], cursorPosition: 0, selection: null,
    viewState: { horizontalZoom: 100, verticalZoom: 1, scrollX: 0, viewMode: 'waveform' },
    updatedAt: 100, createdAt: 50, sampleRate: 1000,
    timeSignature: { numerator: 4, denominator: 4 }, tempo: 120,
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
    push: vi.fn(), pushCommand: vi.fn(), canUndo: vi.fn(() => false), canRedo: vi.fn(() => false),
    loadForProject: vi.fn(async () => 0), flush: vi.fn(async () => undefined),
    undo: vi.fn(), redo: vi.fn(), getUndoStack: vi.fn(() => []), getRedoStack: vi.fn(() => []),
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
    subscribe: vi.fn(() => () => {}), getPlaybackState: vi.fn(() => 'stopped'),
    getRecordingState: vi.fn(() => 'inactive'), getCurrentTime: vi.fn(() => 0),
    playTracks: vi.fn(), stopPlayback: vi.fn(), pausePlayback: vi.fn(), resumePlayback: vi.fn(),
    seek: vi.fn(), startRecording: vi.fn(), stopRecording: vi.fn(), cancelRecording: vi.fn(),
    initialize: vi.fn(), getLevel: vi.fn(() => 0), cacheBuffer: vi.fn(), evictBuffer: vi.fn(),
    getPlaybackLevels: vi.fn(() => ({ left: -Infinity, right: -Infinity })),
    getRecordingLevels: vi.fn(() => ({ left: -Infinity, right: -Infinity })),
    setCursorChangeCallback: vi.fn(), setStateChangeCallback: vi.fn(),
    setPlaybackCompleteCallback: vi.fn(), setTracksEndCallback: vi.fn(),
    setMonitoringEnabled: mocks.setMonitoring,
    startMicrophoneMonitoring: mocks.startMonitoring,
    stopMicrophoneMonitoring: mocks.stopMonitoring,
    isMicrophoneMonitoringActive: mocks.isMonitoring,
    processClipChannels: vi.fn((_clip: unknown, source: Float32Array[]) => source.map((channel) => new Float32Array(channel))),
  },
}));
vi.mock('@/wasm/processor', () => ({ isWasmAvailable: vi.fn(() => false), wasmProcessor: {} }));
vi.mock('react-router-dom', () => ({ useParams: () => ({ projectId: 'meters-monitoring-project' }), useNavigate: () => vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: mocks.success, warning: mocks.warning, error: mocks.error, info: mocks.info } }));
vi.mock('@/utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), log: vi.fn() } }));

import AudioEditorPage from './AudioEditorPage';

async function renderEditor(): Promise<void> {
  render(<AudioEditorPage />);
  expect(await screen.findByText('Meters monitoring integration')).toBeInTheDocument();
}

async function openTrackMenu(): Promise<void> {
  fireEvent.contextMenu(screen.getByTestId('track-panel-row-a'));
  await screen.findByTestId('track-context-menu-a');
}

async function openMetersMenu(): Promise<void> {
  await openTrackMenu();
  fireEvent.keyDown(await screen.findByTestId('track-meters-monitoring-submenu'), { key: 'ArrowRight' });
  await screen.findByTestId('track-show-mic-metering');
}

describe('AudioEditorPage Track rulers and Meters & monitoring', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    mockProject = makeProject();
    mocks.saveProject.mockImplementation(async (project: IProject) => { mockProject = project; });
    mocks.loadChannels.mockResolvedValue([Float32Array.from([0.2, 0.4])]);
    mocks.isMonitoring.mockReturnValue(false);
    mocks.startMonitoring.mockImplementation(async () => { mocks.isMonitoring.mockReturnValue(true); });
    mocks.stopMonitoring.mockImplementation(() => { mocks.isMonitoring.mockReturnValue(false); });
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('places official items after Track color and shares the Workspace vertical-ruler state', async () => {
    await renderEditor();
    await openTrackMenu();
    const color = screen.getByTestId('track-color-submenu');
    const rulers = screen.getByTestId('track-toggle-vertical-rulers');
    const meters = screen.getByTestId('track-meters-monitoring-submenu');
    expect(color.compareDocumentPosition(rulers) & 4).toBeTruthy();
    expect(rulers.compareDocumentPosition(meters) & 4).toBeTruthy();
    expect(rulers).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(rulers);
    await waitFor(() => expect(loadWorkspaceStore().presets[0]!.layout.showVerticalRulers).toBe(false));
    await openTrackMenu();
    expect(screen.getByTestId('track-toggle-vertical-rulers')).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(screen.getByTestId('track-toggle-vertical-rulers'));
    await waitFor(() => expect(loadWorkspaceStore().presets[0]!.layout.showVerticalRulers).toBe(true));
    expect(mocks.saveProject).not.toHaveBeenCalled();
  });

  it('toggles and persists mic metering and input monitoring with explicit false', async () => {
    await renderEditor();
    await openMetersMenu();
    expect(screen.getByTestId('track-show-mic-metering')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('track-input-monitoring')).toHaveAttribute('aria-checked', 'false');

    fireEvent.click(screen.getByTestId('track-show-mic-metering'));
    await waitFor(() => expect(loadRecordingMonitoringPreferences().showMicMetering).toBe(false));
    expect(mocks.stopMonitoring).toHaveBeenCalled();
    expect(screen.getByTestId('audio-level-meters')).toHaveAttribute('data-mic-input-active', 'false');

    await openMetersMenu();
    fireEvent.click(screen.getByTestId('track-input-monitoring'));
    await waitFor(() => expect(loadRecordingMonitoringPreferences().inputMonitoring).toBe(true));
    await waitFor(() => expect(screen.getByTestId('audio-level-meters')).toHaveAttribute('data-mic-input-active', 'true'));
    expect(mocks.startMonitoring).toHaveBeenLastCalledWith({ audible: true });
    expect(mocks.setMonitoring).toHaveBeenLastCalledWith(true);

    cleanup();
    await renderEditor();
    await openMetersMenu();
    expect(screen.getByTestId('track-show-mic-metering')).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByTestId('track-input-monitoring')).toHaveAttribute('aria-checked', 'true');
  });

  it('does not change checked state when preference storage fails', async () => {
    await renderEditor();
    const originalSetItem = Storage.prototype.setItem;
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
      if (key === RECORDING_MONITORING_PREFERENCES_STORAGE_KEY) throw new Error('quota');
      originalSetItem.call(this, key, value);
    });
    try {
      await openMetersMenu();
      fireEvent.click(screen.getByTestId('track-input-monitoring'));
      await waitFor(() => expect(mocks.error).toHaveBeenCalledWith('浏览器存储不可用，录音监控偏好未保存'));
      expect(loadRecordingMonitoringPreferences().inputMonitoring).toBe(false);
      expect(screen.getByTestId('audio-level-meters')).toHaveAttribute('data-input-monitoring', 'false');
      expect(mocks.startMonitoring).not.toHaveBeenCalledWith({ audible: true });
    } finally {
      setItem.mockRestore();
    }
  });

  it('resynchronizes mic metering when Stop does not emit a playback transition', async () => {
    await renderEditor();
    await waitFor(() => expect(mocks.startMonitoring).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId('audio-level-meters')).toHaveAttribute('data-mic-input-active', 'true'));

    fireEvent.click(screen.getByRole('button', { name: '停止', exact: true }));

    await waitFor(() => expect(mocks.startMonitoring).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByTestId('audio-level-meters')).toHaveAttribute('data-mic-input-active', 'true'));
    expect(mocks.startMonitoring).toHaveBeenLastCalledWith({ audible: false });
  });

  it('reports microphone denial and exposes inactive state without claiming audible monitoring', async () => {
    mocks.startMonitoring.mockRejectedValue(new Error('permission denied'));
    await renderEditor();
    await openMetersMenu();
    fireEvent.click(screen.getByTestId('track-input-monitoring'));

    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith('无法启动输入监听，请检查麦克风权限与设备'));
    expect(screen.getByTestId('audio-level-meters')).toHaveAttribute('data-mic-input-active', 'false');
    expect(screen.getByTestId('audio-level-meters')).toHaveAttribute('data-input-monitoring', 'true');
    expect(loadRecordingMonitoringPreferences().inputMonitoring).toBe(true);
  });
});
