import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  saveProject: vi.fn(),
  exportWav: vi.fn(),
  createObjectURL: vi.fn(),
  revokeObjectURL: vi.fn(),
  anchorClick: vi.fn(),
  navigate: vi.fn(),
}));
let mockProject: IProject;

Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: mocks.createObjectURL });
Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: mocks.revokeObjectURL });
Object.defineProperty(HTMLAnchorElement.prototype, 'click', { configurable: true, value: mocks.anchorClick });

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
    saveProject: mocks.saveProject,
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
    exportWav: mocks.exportWav,
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
vi.mock('react-router-dom', () => ({
  useParams: () => ({ projectId: 'timer-record-project' }),
  useNavigate: () => mocks.navigate,
}));
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

function getRecordButton(label: '开始录音' | '停止录音'): HTMLElement {
  return screen.getAllByRole('button', { name: label })[0]!;
}

describe('AudioEditorPage Timer Record', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.removeItem('audacity.timerRecord.advanced.v1');
    mockProject = makeProject();
    mocks.createObjectURL.mockReturnValue('blob:timer-record');
    mocks.saveProject.mockImplementation(async (project: IProject) => { mockProject = project; });
    mocks.exportWav.mockResolvedValue(new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/wav' }));
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
    fireEvent.click(getRecordButton('停止录音'));
    await waitFor(() => expect(mocks.stopRecording).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByTestId('timer-record-status')).not.toBeInTheDocument());
    expect(mocks.addRecordingToTrack).toHaveBeenCalledTimes(1);
  }, 10_000);

  it('coalesces repeated manual stops into one saved clip and history step', async () => {
    let resolveStop!: (channels: Float32Array[]) => void;
    mocks.stopRecording.mockReturnValue(new Promise<Float32Array[]>((resolve) => {
      resolveStop = resolve;
    }));
    render(<AudioEditorPage />);
    await openTimerRecordDialog();
    setDuration('0', '1', '0');
    submitTimerRecord();

    await waitFor(() => expect(mocks.startRecording).toHaveBeenCalledTimes(1), { timeout: 2000 });
    const stopButton = getRecordButton('停止录音');
    fireEvent.click(stopButton);
    fireEvent.click(stopButton);
    resolveStop([Float32Array.from([0.1, 0.2, 0.3, 0.4])]);

    await waitFor(() => expect(mocks.addRecordingToTrack).toHaveBeenCalledTimes(1));
    expect(mocks.stopRecording).toHaveBeenCalledTimes(1);
    expect(mocks.push).toHaveBeenCalledTimes(1);
    expect(mockProject.tracks[0].clips).toHaveLength(1);
  }, 10_000);

  it('runs Timer Record automatic actions once when manual stop is repeated', async () => {
    let resolveStop!: (channels: Float32Array[]) => void;
    mocks.stopRecording.mockReturnValue(new Promise<Float32Array[]>((resolve) => {
      resolveStop = resolve;
    }));
    render(<AudioEditorPage />);
    await openTimerRecordDialog();
    fireEvent.click(screen.getByRole('checkbox', { name: /Enable Automatic Save/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Enable Automatic Export/ }));
    setDuration('0', '1', '0');
    submitTimerRecord();

    await waitFor(() => expect(mocks.startRecording).toHaveBeenCalledTimes(1), { timeout: 2000 });
    const stopButton = getRecordButton('停止录音');
    fireEvent.click(stopButton);
    fireEvent.click(stopButton);
    resolveStop([Float32Array.from([0.1, 0.2, 0.3, 0.4])]);

    await waitFor(() => expect(mocks.exportWav).toHaveBeenCalled());
    expect(mocks.stopRecording).toHaveBeenCalledTimes(1);
    expect(mocks.addRecordingToTrack).toHaveBeenCalledTimes(1);
    expect(mocks.saveProject).toHaveBeenCalledTimes(1);
    expect(mocks.exportWav).toHaveBeenCalledTimes(1);
    expect(mocks.createObjectURL).toHaveBeenCalledTimes(1);
  }, 10_000);

  it('does not restart recording while manual Timer Record finalization is pending', async () => {
    let resolveSave!: () => void;
    mocks.saveProject.mockImplementation(async (project: IProject) => {
      await new Promise<void>((resolve) => { resolveSave = resolve; });
      mockProject = project;
    });
    render(<AudioEditorPage />);
    await openTimerRecordDialog();
    fireEvent.click(screen.getByRole('checkbox', { name: /Enable Automatic Save/ }));
    setDuration('0', '1', '0');
    submitTimerRecord();

    await waitFor(() => expect(mocks.startRecording).toHaveBeenCalledTimes(1), { timeout: 2000 });
    fireEvent.click(getRecordButton('停止录音'));
    await waitFor(() => expect(mocks.saveProject).toHaveBeenCalledTimes(1));
    fireEvent.click(getRecordButton('开始录音'));
    resolveSave();

    await waitFor(() => expect(mocks.success).toHaveBeenCalledWith('定时录音完成：工程已自动保存'));
    expect(mocks.startRecording).toHaveBeenCalledTimes(1);
    expect(mocks.stopRecording).toHaveBeenCalledTimes(1);
    expect(mocks.addRecordingToTrack).toHaveBeenCalledTimes(1);
    expect(mocks.saveProject).toHaveBeenCalledTimes(1);
  }, 10_000);

  it('cancels a pending manual startup and permits a clean restart', async () => {
    let resolveFirstStart!: () => void;
    mocks.startRecording
      .mockImplementationOnce(() => new Promise<void>((resolve) => {
        resolveFirstStart = resolve;
      }))
      .mockResolvedValueOnce(undefined);
    mocks.stopRecording.mockResolvedValueOnce(null);
    render(<AudioEditorPage />);
    expect(await screen.findByText('Timer Record integration')).toBeInTheDocument();

    fireEvent.click(getRecordButton('开始录音'));
    await waitFor(() => expect(mocks.startRecording).toHaveBeenCalledTimes(1));
    fireEvent.click(getRecordButton('开始录音'));

    await waitFor(() => expect(mocks.stopRecording).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(getRecordButton('开始录音')).toBeInTheDocument());
    fireEvent.click(getRecordButton('开始录音'));
    await waitFor(() => expect(mocks.startRecording).toHaveBeenCalledTimes(2));
    await act(async () => {
      resolveFirstStart();
      await Promise.resolve();
    });

    await waitFor(() => expect(getRecordButton('停止录音')).toBeInTheDocument());
    expect(mocks.info.mock.calls.filter(([message]) => String(message).startsWith('正在录音'))).toHaveLength(1);
    expect(mocks.addRecordingToTrack).not.toHaveBeenCalled();
  }, 10_000);

  it('cancels Timer Record immediately while microphone startup is pending', async () => {
    let resolveStart!: () => void;
    mocks.startRecording.mockReturnValue(new Promise<void>((resolve) => {
      resolveStart = resolve;
    }));
    mocks.stopRecording.mockResolvedValue(null);
    render(<AudioEditorPage />);
    await openTimerRecordDialog();
    setDuration('0', '1', '0');
    submitTimerRecord();
    await waitFor(() => expect(mocks.startRecording).toHaveBeenCalledTimes(1), { timeout: 2000 });

    fireEvent.pointerDown(screen.getByRole('button', { name: '走带' }));
    fireEvent.click(screen.getAllByRole('menuitem', { name: '停止定时录音' })[0]!);
    await waitFor(() => expect(mocks.stopRecording).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('timer-record-status')).not.toBeInTheDocument();
    await act(async () => {
      resolveStart();
      await Promise.resolve();
    });

    await waitFor(() => expect(mocks.info).toHaveBeenCalledWith('已取消定时录音'));
    expect(mocks.stopRecording).toHaveBeenCalledTimes(1);
    expect(mocks.info.mock.calls.filter(([message]) => String(message).startsWith('正在录音'))).toHaveLength(0);
    expect(mocks.addRecordingToTrack).not.toHaveBeenCalled();
  }, 10_000);

  it('stops and invalidates a pending manual startup when the editor unmounts', async () => {
    let resolveStart!: () => void;
    mocks.startRecording.mockReturnValue(new Promise<void>((resolve) => {
      resolveStart = resolve;
    }));
    mocks.stopRecording.mockResolvedValue(null);
    const { unmount } = render(<AudioEditorPage />);
    expect(await screen.findByText('Timer Record integration')).toBeInTheDocument();

    fireEvent.click(getRecordButton('开始录音'));
    await waitFor(() => expect(mocks.startRecording).toHaveBeenCalledTimes(1));
    unmount();
    await act(async () => {
      resolveStart();
      await Promise.resolve();
    });

    expect(mocks.stopRecording).toHaveBeenCalledTimes(1);
    expect(mocks.info.mock.calls.filter(([message]) => String(message).startsWith('正在录音'))).toHaveLength(0);
    expect(mocks.addRecordingToTrack).not.toHaveBeenCalled();
  }, 10_000);

  it('discards an in-flight stop continuation when the editor unmounts', async () => {
    let resolveStop!: (channels: Float32Array[]) => void;
    mocks.stopRecording.mockReturnValue(new Promise<Float32Array[]>((resolve) => {
      resolveStop = resolve;
    }));
    const { unmount } = render(<AudioEditorPage />);
    expect(await screen.findByText('Timer Record integration')).toBeInTheDocument();

    fireEvent.click(getRecordButton('开始录音'));
    await waitFor(() => expect(getRecordButton('停止录音')).toBeInTheDocument());
    fireEvent.click(getRecordButton('停止录音'));
    await waitFor(() => expect(mocks.stopRecording).toHaveBeenCalledTimes(1));
    unmount();
    await act(async () => {
      resolveStop([Float32Array.from([0.1, 0.2, 0.3, 0.4])]);
      await Promise.resolve();
    });

    expect(mocks.addRecordingToTrack).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.success).not.toHaveBeenCalledWith('录音已添加到「Track 1」');
  }, 10_000);

  it('stops an active recording without persisting it when the editor unmounts', async () => {
    const { unmount } = render(<AudioEditorPage />);
    expect(await screen.findByText('Timer Record integration')).toBeInTheDocument();

    fireEvent.click(getRecordButton('开始录音'));
    await waitFor(() => expect(getRecordButton('停止录音')).toBeInTheDocument());
    unmount();
    await act(async () => { await Promise.resolve(); });

    expect(mocks.stopRecording).toHaveBeenCalledTimes(1);
    expect(mocks.addRecordingToTrack).not.toHaveBeenCalled();
    expect(mocks.success).not.toHaveBeenCalledWith('录音已添加到「Track 1」');
  }, 10_000);

  it('allows a clean retry after microphone startup fails', async () => {
    let rejectStart!: (reason: Error) => void;
    mocks.startRecording
      .mockImplementationOnce(() => new Promise<void>((_resolve, reject) => {
        rejectStart = reject;
      }))
      .mockResolvedValueOnce(undefined);
    render(<AudioEditorPage />);
    expect(await screen.findByText('Timer Record integration')).toBeInTheDocument();

    fireEvent.click(getRecordButton('开始录音'));
    await waitFor(() => expect(mocks.startRecording).toHaveBeenCalledTimes(1));
    rejectStart(new Error('permission denied'));

    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith('无法访问麦克风，请检查权限设置'));
    expect(mocks.error).toHaveBeenCalledTimes(1);
    fireEvent.click(getRecordButton('开始录音'));
    await waitFor(() => expect(getRecordButton('停止录音')).toBeInTheDocument());
    expect(mocks.startRecording).toHaveBeenCalledTimes(2);
    expect(mocks.info.mock.calls.filter(([message]) => String(message).startsWith('正在录音'))).toHaveLength(1);
  }, 10_000);

  it('does not schedule Timer Record while another microphone startup is pending', async () => {
    let resolveStart!: () => void;
    mocks.startRecording.mockReturnValue(new Promise<void>((resolve) => {
      resolveStart = resolve;
    }));
    render(<AudioEditorPage />);
    expect(await screen.findByText('Timer Record integration')).toBeInTheDocument();
    fireEvent.click(getRecordButton('开始录音'));
    await waitFor(() => expect(mocks.startRecording).toHaveBeenCalledTimes(1));

    await openTimerRecordDialog();
    setDuration('0', '1', '0');
    submitTimerRecord();

    expect(mocks.warning).toHaveBeenCalledWith('请先停止当前录音或取消已有定时录音');
    expect(screen.queryByTestId('timer-record-status')).not.toBeInTheDocument();
    resolveStart();
    await waitFor(() => expect(mocks.info).toHaveBeenCalledWith('正在录音（worklet）…'));
    expect(mocks.startRecording).toHaveBeenCalledTimes(1);
  }, 10_000);

  it('links advanced controls and rejects an invalid automatic export filename', async () => {
    render(<AudioEditorPage />);
    await openTimerRecordDialog();
    const postAction = screen.getByLabelText('After Recording completes 录音完成后');
    expect(postAction).toBeDisabled();

    fireEvent.click(screen.getByRole('checkbox', { name: /Enable Automatic Export/ }));
    expect(postAction).toBeEnabled();
    fireEvent.change(screen.getByLabelText('Export Project As WAV 文件名'), {
      target: { value: 'bad/name.wav' },
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Automatic Export path is invalid.');
    expect(screen.getByRole('button', { name: 'Start Timer Recording 开始定时录音' })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Export Project As WAV 文件名'), {
      target: { value: 'valid-name' },
    });
    fireEvent.change(postAction, { target: { value: 'close-project' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /Enable Automatic Export/ }));
    expect(postAction).toBeDisabled();
    expect(postAction).toHaveValue('nothing');
    expect(mocks.startRecording).not.toHaveBeenCalled();
  });

  it('saves and exports the newly recorded project before closing it', async () => {
    render(<AudioEditorPage />);
    await openTimerRecordDialog();
    fireEvent.click(screen.getByRole('checkbox', { name: /Enable Automatic Save/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Enable Automatic Export/ }));
    fireEvent.change(screen.getByLabelText('Export Project As WAV 文件名'), {
      target: { value: 'advanced-proof' },
    });
    fireEvent.change(screen.getByLabelText('After Recording completes 录音完成后'), {
      target: { value: 'close-project' },
    });
    setDuration('0', '0', '1');
    submitTimerRecord();

    await waitFor(() => expect(mocks.saveProject).toHaveBeenCalledTimes(1), { timeout: 4000 });
    await waitFor(() => expect(mocks.exportWav).toHaveBeenCalledTimes(1));
    const savedProject = mocks.saveProject.mock.calls[0][0] as IProject;
    expect(savedProject.tracks[0].clips).toHaveLength(1);
    expect(savedProject.tracks[0].clips[0].id).toBe('recorded-clip');
    expect(mocks.exportWav).toHaveBeenCalledWith(savedProject.tracks, 0.004, 1000, 16);
    expect(mocks.createObjectURL).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/'));
    expect(mocks.success).toHaveBeenCalledWith(expect.stringContaining('advanced-proof.wav'));
  }, 10_000);

  it('still exports after save failure but never closes the project', async () => {
    mocks.saveProject.mockRejectedValueOnce(new Error('disk full'));
    render(<AudioEditorPage />);
    await openTimerRecordDialog();
    fireEvent.click(screen.getByRole('checkbox', { name: /Enable Automatic Save/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Enable Automatic Export/ }));
    fireEvent.change(screen.getByLabelText('After Recording completes 录音完成后'), {
      target: { value: 'close-project' },
    });
    setDuration('0', '0', '1');
    submitTimerRecord();

    await waitFor(() => expect(mocks.exportWav).toHaveBeenCalledTimes(1), { timeout: 4000 });
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith(expect.stringContaining('自动保存失败')));
    expect(mocks.error).toHaveBeenCalledWith(expect.stringContaining('已取消关闭工程'));
    expect(mocks.navigate).not.toHaveBeenCalled();
  }, 10_000);

  it('manual stop performs automatic actions but suppresses closing', async () => {
    render(<AudioEditorPage />);
    await openTimerRecordDialog();
    fireEvent.click(screen.getByRole('checkbox', { name: /Enable Automatic Save/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Enable Automatic Export/ }));
    fireEvent.change(screen.getByLabelText('After Recording completes 录音完成后'), {
      target: { value: 'close-project' },
    });
    setDuration('0', '1', '0');
    submitTimerRecord();

    await waitFor(() => expect(mocks.startRecording).toHaveBeenCalledTimes(1), { timeout: 2000 });
    fireEvent.click(getRecordButton('停止录音'));
    await waitFor(() => expect(mocks.saveProject).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mocks.exportWav).toHaveBeenCalledTimes(1));
    expect(mocks.info).toHaveBeenCalledWith('已手动停止定时录音；已取消关闭工程');
    expect(mocks.navigate).not.toHaveBeenCalled();
  }, 10_000);

  it('does not run advanced actions when the recording cannot be persisted', async () => {
    mocks.addRecordingToTrack.mockResolvedValueOnce(null);
    render(<AudioEditorPage />);
    await openTimerRecordDialog();
    fireEvent.click(screen.getByRole('checkbox', { name: /Enable Automatic Save/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Enable Automatic Export/ }));
    setDuration('0', '0', '1');
    submitTimerRecord();

    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith(
      expect.stringContaining('录音保存失败，未执行自动保存或导出'),
    ), { timeout: 4000 });
    expect(mocks.saveProject).not.toHaveBeenCalled();
    expect(mocks.exportWav).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
  }, 10_000);
});
