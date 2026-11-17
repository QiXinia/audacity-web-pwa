import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IProject } from '@/types/project';
import { toDateTimeLocalValue } from '@/lib/timerRecord';

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  success: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  startRecording: vi.fn(),
  stopRecording: vi.fn(),
  addRecordingToTrack: vi.fn(),
}));
let mockProject: IProject;

function makeProject(): IProject {
  return {
    id: 'timer-record-project',
    name: 'Timer Record integration',
    tracks: [{
      id: 'track-1', name: 'Track 1', type: 'audio', gain: 0, pan: 0,
      muted: false, solo: false, armed: false, color: '', clips: [], effects: [],
    }],
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
    loadAudioChannels: vi.fn(async () => [new Float32Array(10)]),
    loadAudioBuffer: vi.fn(async () => new Float32Array(10)),
    addRecordingToTrack: mocks.addRecordingToTrack,
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
    getRecordingState: vi.fn(() => 'idle'),
    getCurrentTime: vi.fn(() => 0),
    playTracks: vi.fn(), stopPlayback: vi.fn(), pausePlayback: vi.fn(), resumePlayback: vi.fn(),
    seek: vi.fn(), startRecording: mocks.startRecording, stopRecording: mocks.stopRecording,
    cancelRecording: vi.fn(), ensureContext: vi.fn(async () => undefined),
    getSampleRate: vi.fn(() => 1000), getRecordingMode: vi.fn(() => 'worklet'),
    initialize: vi.fn(), getLevel: vi.fn(() => 0), cacheBuffer: vi.fn(), evictBuffer: vi.fn(),
    getPlaybackLevels: vi.fn(() => ({ left: -60, right: -60 })),
    getRecordingLevels: vi.fn(() => ({ left: -60, right: -60 })),
    setCursorChangeCallback: vi.fn(), setStateChangeCallback: vi.fn(),
    setPlaybackCompleteCallback: vi.fn(), setTracksEndCallback: vi.fn(),
    processClipChannels: vi.fn((_clip: unknown, source: Float32Array[]) => source.map((channel) => new Float32Array(channel))),
  },
}));
vi.mock('@/wasm/processor', () => ({ isWasmAvailable: vi.fn(() => false), wasmProcessor: {} }));
vi.mock('react-router-dom', () => ({ useParams: () => ({ projectId: 'timer-record-project' }), useNavigate: () => vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: mocks.success, warning: mocks.warning, error: mocks.error, info: mocks.info } }));
vi.mock('@/utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), log: vi.fn() } }));

import AudioEditorPage from './AudioEditorPage';

async function openTimerRecordDialog(): Promise<void> {
  expect(await screen.findByText('Timer Record integration')).toBeInTheDocument();
  fireEvent.pointerDown(screen.getByRole('button', { name: '走带' }));
  fireEvent.click(await screen.findByText('Timer Record… 定时录音…'));
  expect(await screen.findByTestId('timer-record-dialog')).toBeInTheDocument();
}

function setDuration(hours: string, minutes: string, seconds: string): void {
  fireEvent.change(screen.getByLabelText('Hours 小时'), { target: { value: hours } });
  fireEvent.change(screen.getByLabelText('Minutes 分钟'), { target: { value: minutes } });
  fireEvent.change(screen.getByLabelText('Seconds 秒'), { target: { value: seconds } });
}

function submitTimerRecord(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Start Timer Recording 开始定时录音' }));
}

describe('AudioEditorPage Timer Record', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProject = makeProject();
    mocks.startRecording.mockResolvedValue(undefined);
    mocks.stopRecording.mockResolvedValue([Float32Array.from([0.1, 0.2, 0.3, 0.4])]);
    mocks.addRecordingToTrack.mockImplementation(async (
      _projectId: string,
      trackId: string,
      channels: Float32Array[],
      sampleRate: number,
      startTime: number,
    ) => {
      const clip = {
        id: 'recorded-clip', audioBufferId: 'recorded-buffer', startTime, offset: 0,
        duration: channels[0].length / sampleRate, originalDuration: channels[0].length / sampleRate,
        stretchRatio: 1, gain: 0, fadeIn: 0, fadeOut: 0, name: 'Recording',
      };
      mockProject = {
        ...mockProject,
        tracks: mockProject.tracks.map((track) => track.id === trackId
          ? { ...track, clips: [...track.clips, clip] }
          : track),
      };
      return clip;
    });
  });

  it('starts and stops a real scheduled recording and saves one history step', async () => {
    render(<AudioEditorPage />);
    await openTimerRecordDialog();
    setDuration('0', '0', '1');
    submitTimerRecord();

    await waitFor(() => expect(mocks.startRecording).toHaveBeenCalledTimes(1), { timeout: 2000 });
    expect(screen.getByTestId('timer-record-status')).toHaveTextContent('定时录音至');
    await waitFor(() => expect(mocks.stopRecording).toHaveBeenCalledTimes(1), { timeout: 3000 });
    await waitFor(() => expect(mocks.addRecordingToTrack).toHaveBeenCalledTimes(1));
    expect(mocks.addRecordingToTrack.mock.calls[0][0]).toBe('timer-record-project');
    expect(mocks.addRecordingToTrack.mock.calls[0][1]).toBe('track-1');
    expect(mocks.addRecordingToTrack.mock.calls[0][3]).toBe(1000);
    expect(mocks.push).toHaveBeenCalledTimes(1);
    expect(mocks.push.mock.calls[0][0].label).toBe('录音');
    expect(mocks.success).toHaveBeenCalledWith('录音已添加到「Track 1」');
    await waitFor(() => expect(screen.queryByTestId('timer-record-status')).not.toBeInTheDocument());
  }, 10_000);

  it('cancels a future recording before touching the microphone', async () => {
    render(<AudioEditorPage />);
    await openTimerRecordDialog();
    fireEvent.change(screen.getByLabelText('Start Date and Time 开始日期和时间'), {
      target: { value: toDateTimeLocalValue(Date.now() + 60_000) },
    });
    setDuration('0', '0', '1');
    submitTimerRecord();

    expect(await screen.findByTestId('timer-record-status')).toHaveTextContent('定时等待');
    fireEvent.click(screen.getByRole('button', { name: '取消定时录音' }));
    await waitFor(() => expect(screen.queryByTestId('timer-record-status')).not.toBeInTheDocument());
    expect(mocks.startRecording).not.toHaveBeenCalled();
    expect(mocks.stopRecording).not.toHaveBeenCalled();
  });

  it('rejects the official zero-duration case', async () => {
    render(<AudioEditorPage />);
    await openTimerRecordDialog();
    setDuration('0', '0', '0');

    expect(screen.getByRole('alert')).toHaveTextContent('Duration is zero. Nothing will be recorded.');
    expect(screen.getByRole('button', { name: 'Start Timer Recording 开始定时录音' })).toBeDisabled();
    expect(mocks.startRecording).not.toHaveBeenCalled();
  });

  it('derives duration fields when the end time is edited', async () => {
    render(<AudioEditorPage />);
    await openTimerRecordDialog();
    const start = screen.getByLabelText('Start Date and Time 开始日期和时间') as HTMLInputElement;
    const startAt = new Date(start.value).getTime();
    fireEvent.change(screen.getByLabelText('End Date and Time 结束日期和时间'), {
      target: { value: toDateTimeLocalValue(startAt + 3_661_000) },
    });

    expect(screen.getByLabelText('Hours 小时')).toHaveValue('1');
    expect(screen.getByLabelText('Minutes 分钟')).toHaveValue('1');
    expect(screen.getByLabelText('Seconds 秒')).toHaveValue('1');
  });

  it('manual stop closes the active timer session after saving', async () => {
    render(<AudioEditorPage />);
    await openTimerRecordDialog();
    setDuration('0', '1', '0');
    submitTimerRecord();

    await waitFor(() => expect(mocks.startRecording).toHaveBeenCalledTimes(1), { timeout: 2000 });
    fireEvent.click(screen.getByRole('button', { name: '停止录音' }));
    await waitFor(() => expect(mocks.stopRecording).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByTestId('timer-record-status')).not.toBeInTheDocument());
    expect(mocks.addRecordingToTrack).toHaveBeenCalledTimes(1);
  }, 10_000);
});
