import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IClip, IProject, ITrack, TrackSampleFormat } from '@/types/project';

const mocks = vi.hoisted(() => ({
  getProject: vi.fn(),
  loadMetadata: vi.fn(),
  loadChannels: vi.fn(),
  changeFormat: vi.fn(),
  changeRate: vi.fn(),
  resample: vi.fn(),
  pushHistory: vi.fn(),
  toastSuccess: vi.fn(),
  toastWarning: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('@/services/projectService', () => ({
  projectService: {
    getProject: mocks.getProject,
    openProject: mocks.getProject,
    loadAudioBufferMetadata: mocks.loadMetadata,
    loadAudioBufferChannels: mocks.loadChannels,
    loadAudioChannels: mocks.loadChannels,
    loadAudioBuffer: vi.fn(async () => new Float32Array(10)),
    changeTrackFormatOnTracks: mocks.changeFormat,
    changeTrackRateOnTracks: mocks.changeRate,
    resampleTracksOnTracks: mocks.resample,
    swapStereoChannelsOnTracks: vi.fn(),
    splitStereoTrackOnTracks: vi.fn(),
    makeStereoTrackFromMono: vi.fn(),
  },
}));
vi.mock('@/services/historyService', () => ({
  historyManager: {
    push: mocks.pushHistory,
    pushCommand: mocks.pushHistory,
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
  },
}));
vi.mock('@/hooks/useCommandHistory', () => ({
  useCommandHistory: () => ({
    push: mocks.pushHistory,
    undo: vi.fn(), redo: vi.fn(), canUndo: false, canRedo: false,
    undoStack: [], redoStack: [], clear: vi.fn(),
  }),
}));
vi.mock('@/engine/audioEngine', () => ({
  audioEngine: {
    subscribe: vi.fn(() => () => {}),
    getPlaybackState: vi.fn(() => 'stopped'),
    getRecordingState: vi.fn(() => 'idle'),
    getCurrentTime: vi.fn(() => 0),
    playTracks: vi.fn(),
    stopPlayback: vi.fn(),
    pausePlayback: vi.fn(),
    resumePlayback: vi.fn(),
    seek: vi.fn(),
    ensureContext: vi.fn(async () => undefined),
    startRecording: vi.fn(async () => undefined),
    stopRecording: vi.fn(),
    cancelRecording: vi.fn(),
    cleanupRecording: vi.fn(),
    initialize: vi.fn(),
    getLevel: vi.fn(() => 0),
    getSampleRate: vi.fn(() => 48000),
    getRecordingMode: vi.fn(() => 'AudioWorklet'),
    setMonitoringEnabled: vi.fn(),
    cacheBuffer: vi.fn(),
    evictBuffer: vi.fn(),
    getPlaybackLevels: vi.fn(() => ({ left: -Infinity, right: -Infinity })),
    getRecordingLevels: vi.fn(() => ({ left: -Infinity, right: -Infinity })),
    setCursorChangeCallback: vi.fn(),
    setStateChangeCallback: vi.fn(),
    setPlaybackCompleteCallback: vi.fn(),
    setTracksEndCallback: vi.fn(),
    processClipChannels: vi.fn((_clip: unknown, source: Float32Array[]) => source.map((channel) => new Float32Array(channel))),
  },
}));
vi.mock('@/db/audioDb', () => ({
  audioDb: {},
  serializeTracks: (tracks: unknown) => JSON.stringify(tracks),
  deserializeTracks: (data: string) => JSON.parse(data),
  serializeSelection: (selection: unknown) => selection ? JSON.stringify(selection) : null,
  deserializeSelection: (data: string | null) => data ? JSON.parse(data) : null,
}));
vi.mock('@/utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), log: vi.fn() } }));
vi.mock('sonner', () => ({
  toast: { success: mocks.toastSuccess, warning: mocks.toastWarning, error: mocks.toastError, info: vi.fn() },
}));
vi.mock('react-router-dom', () => ({
  useParams: () => ({ projectId: 'track-media-ui' }), useNavigate: () => vi.fn(),
}));
vi.mock('@/wasm/processor', () => ({ isWasmAvailable: vi.fn(() => false), wasmProcessor: {} }));

import AudioEditorPage from './AudioEditorPage';

function makeClip(id: string, trackId: string): IClip {
  return {
    id, audioBufferId: `buffer-${id}`, startTime: trackId === 'a' ? 0 : 1,
    offset: 0.01, duration: 0.2, originalDuration: 0.2,
    stretchRatio: 1, gain: 0, fadeIn: 0.01, fadeOut: 0.02, name: `clip-${id}`,
  };
}

function makeTrack(id: string): ITrack {
  return {
    id, name: `Track ${id}`, type: 'audio', gain: 0, pan: 0,
    muted: false, solo: false, armed: false, color: `${id}-color`,
    clips: [makeClip(id, id)], effects: [], channelCount: 1,
    sampleFormat: 'float32', sampleRate: 48000,
  };
}

function makeProject(): IProject {
  return {
    id: 'track-media-ui', name: 'Track media UI integration', sampleRate: 48000,
    timeSignature: { numerator: 4, denominator: 4 }, tempo: 120,
    tracks: [makeTrack('a'), makeTrack('b')], cursorPosition: 0, selection: null,
    viewState: { horizontalZoom: 100, verticalZoom: 1, scrollX: 0, viewMode: 'waveform' },
    updatedAt: 100, createdAt: 50,
  };
}

let currentProject: IProject;

async function renderEditor(): Promise<void> {
  render(<AudioEditorPage />);
  expect(await screen.findByText('Track media UI integration')).toBeInTheDocument();
}

async function openTrackMenu(trackId = 'a'): Promise<void> {
  fireEvent.contextMenu(screen.getByTestId(`track-panel-row-${trackId}`));
  await screen.findByTestId('track-format-submenu');
}

async function openSubmenu(id: 'track-format-submenu' | 'track-rate-submenu'): Promise<void> {
  fireEvent.keyDown(await screen.findByTestId(id), { key: 'ArrowRight' });
}

function selectBothClips(): void {
  const first = document.querySelector('[data-audio-buffer-id="buffer-a"]');
  const second = document.querySelector('[data-audio-buffer-id="buffer-b"]');
  if (!first || !second) throw new Error('clip fixtures not rendered');
  fireEvent.click(first);
  fireEvent.click(second, { shiftKey: true });
}

describe('AudioEditorPage Track Format Rate and Resample context menu', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    currentProject = makeProject();
    mocks.getProject.mockImplementation(async () => structuredClone(currentProject));
    mocks.loadMetadata.mockImplementation(async (id: string) => ({
      id, sampleRate: 48000, channels: 1, length: 9600, duration: 0.2,
    }));
    mocks.loadChannels.mockResolvedValue([Float32Array.from([0.2, 0.4])]);
    mocks.changeFormat.mockImplementation(async (_projectId: string, ids: string[], format: TrackSampleFormat) => {
      const updated = structuredClone(currentProject);
      let clipCount = 0;
      let trackCount = 0;
      for (const track of updated.tracks) {
        if (!ids.includes(track.id) || track.sampleFormat === format) continue;
        trackCount += 1;
        track.sampleFormat = format;
        for (const clip of track.clips) {
          clip.audioBufferId = `${clip.audioBufferId}-${format}`;
          clipCount += 1;
        }
      }
      currentProject = updated;
      return { trackCount, clipCount };
    });
    mocks.changeRate.mockImplementation(async (_projectId: string, ids: string[], rate: number) => {
      const updated = structuredClone(currentProject);
      let clipCount = 0;
      let trackCount = 0;
      for (const track of updated.tracks) {
        if (!ids.includes(track.id) || track.sampleRate === rate) continue;
        trackCount += 1;
        track.sampleRate = rate;
        clipCount += track.clips.length;
      }
      currentProject = updated;
      return { trackCount, clipCount };
    });
    mocks.resample.mockImplementation(async (_projectId: string, ids: string[], rate: number) => {
      const updated = structuredClone(currentProject);
      for (const track of updated.tracks) if (ids.includes(track.id)) track.sampleRate = rate;
      currentProject = updated;
      return { trackCount: ids.length, clipCount: ids.length, outputSampleCount: 9600, sampleRate: rate };
    });
  });

  afterEach(() => cleanup());

  it('places official Format Rate Resample after channel actions and checks current values', async () => {
    await renderEditor();
    await openTrackMenu();
    const make = screen.getByTestId('track-make-stereo');
    const format = screen.getByTestId('track-format-submenu');
    const rate = screen.getByTestId('track-rate-submenu');
    const resample = screen.getByTestId('track-resample');
    expect(format).toHaveTextContent('Format: 32-bit Float');
    expect(rate).toHaveTextContent('Rate: 48000 Hz');
    expect(resample).toHaveTextContent('Resample track…');
    expect(make.compareDocumentPosition(format) & 4).toBeTruthy();
    expect(format.compareDocumentPosition(rate) & 4).toBeTruthy();
    expect(rate.compareDocumentPosition(resample) & 4).toBeTruthy();

    await openSubmenu('track-format-submenu');
    expect(screen.getByTestId('track-format-float32')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('track-format-int16')).toHaveAttribute('aria-checked', 'false');
    await openSubmenu('track-rate-submenu');
    expect(await screen.findByTestId('track-rate-48000')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('track-rate-custom')).toHaveAttribute('aria-checked', 'false');
  });

  it('commits 16-bit format once, refreshes the project and writes one history entry', async () => {
    await renderEditor();
    await openTrackMenu();
    await openSubmenu('track-format-submenu');
    fireEvent.click(await screen.findByTestId('track-format-int16'));
    await waitFor(() => expect(mocks.changeFormat).toHaveBeenCalledWith('track-media-ui', ['a'], 'int16'));
    await waitFor(() => expect(mocks.pushHistory).toHaveBeenCalledTimes(1));
    expect(mocks.pushHistory.mock.calls[0]![0].label).toBe('Changed track format');
    expect(currentProject.tracks[0]!.sampleFormat).toBe('int16');
    expect(currentProject.tracks[1]!.sampleFormat).toBe('float32');

    await openTrackMenu();
    expect(await screen.findByTestId('track-format-submenu')).toHaveTextContent('Format: 16-bit PCM');
  });

  it('uses Shift-selected clip tracks for a direct common Rate action', async () => {
    await renderEditor();
    selectBothClips();
    await openTrackMenu();
    await openSubmenu('track-rate-submenu');
    fireEvent.click(await screen.findByTestId('track-rate-44100'));
    await waitFor(() => expect(mocks.changeRate).toHaveBeenCalledWith('track-media-ui', ['a', 'b'], 44100));
    await waitFor(() => expect(mocks.pushHistory).toHaveBeenCalledTimes(1));
    expect(mocks.pushHistory.mock.calls[0]![0].label).toBe('Changed track rate');
    expect(currentProject.tracks.map((track) => track.sampleRate)).toEqual([44100, 44100]);
  });

  it('validates Other… Set rate input and commits only a valid integer', async () => {
    await renderEditor();
    await openTrackMenu();
    await openSubmenu('track-rate-submenu');
    fireEvent.click(await screen.findByTestId('track-rate-custom'));
    const input = await screen.findByTestId('track-rate-input');
    expect(screen.getByTestId('track-rate-dialog')).toHaveTextContent('Set rate');
    expect(screen.getByTestId('track-rate-dialog')).toHaveTextContent('without resampling PCM');
    fireEvent.change(input, { target: { value: '0' } });
    expect(screen.getByTestId('track-rate-confirm')).toBeDisabled();
    expect(mocks.changeRate).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: '96000' } });
    fireEvent.click(screen.getByTestId('track-rate-confirm'));
    await waitFor(() => expect(mocks.changeRate).toHaveBeenCalledWith('track-media-ui', ['a'], 96000));
    await waitFor(() => expect(screen.queryByTestId('track-rate-dialog')).not.toBeInTheDocument());
    expect(mocks.pushHistory.mock.calls[0]![0].label).toBe('Changed track rate');
  });

  it('disables Format and Rate while recording', async () => {
    await renderEditor();
    fireEvent.click(screen.getByRole('button', { name: '开始录音' }));
    await screen.findByRole('button', { name: '停止录音' });
    await openTrackMenu();
    expect(screen.getByTestId('track-format-submenu')).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByTestId('track-rate-submenu')).toHaveAttribute('aria-disabled', 'true');
  });

  it('does not create a history entry when the current format is reselected', async () => {
    await renderEditor();
    await openTrackMenu();
    await openSubmenu('track-format-submenu');
    fireEvent.click(await screen.findByTestId('track-format-float32'));
    await waitFor(() => expect(mocks.changeFormat).toHaveBeenCalledWith('track-media-ui', ['a'], 'float32'));
    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalledWith('选中轨道已经是 32-bit Float'));
    expect(mocks.pushHistory).not.toHaveBeenCalled();
  });

  it('opens Resample track… and records a separate resample history action', async () => {
    await renderEditor();
    await openTrackMenu();
    fireEvent.click(screen.getByTestId('track-resample'));
    const input = await screen.findByTestId('resample-input');
    fireEvent.change(input, { target: { value: '22050' } });
    fireEvent.click(screen.getByTestId('resample-confirm'));
    await waitFor(() => expect(mocks.resample).toHaveBeenCalledWith('track-media-ui', ['a'], 22050));
    await waitFor(() => expect(mocks.pushHistory).toHaveBeenCalledTimes(1));
    expect(mocks.pushHistory.mock.calls[0]![0].label).toBe('Resampled audio track(s)');
    expect(currentProject.tracks[0]!.sampleRate).toBe(22050);
    expect(currentProject.tracks[1]!.sampleRate).toBe(48000);
  });
});
