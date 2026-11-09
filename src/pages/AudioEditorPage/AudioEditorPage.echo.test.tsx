import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IProject } from '@/types/project';
import type { EchoTrackAudio } from '@/services/projectService';

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  update: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  saveProject: vi.fn(),
  echo: vi.fn(),
  loadChannels: vi.fn(),
  previewBuffers: [] as { channels: number; length: number; sampleRate: number; data: Float32Array[] }[],
}));
let mockProject: IProject;

function makeProject(): IProject {
  const clip = (id: string) => ({
    id,
    audioBufferId: `buffer-${id}`,
    startTime: 0,
    offset: 0,
    duration: 0.01,
    originalDuration: 0.01,
    stretchRatio: 1,
    gain: 0,
    fadeIn: 0,
    fadeOut: 0,
    name: `clip-${id}`,
  });
  const track = (id: string) => ({
    id,
    name: `Track ${id}`,
    type: 'audio' as const,
    gain: 0,
    pan: 0,
    muted: false,
    solo: false,
    armed: false,
    color: '',
    clips: [clip(id)],
    effects: [],
  });
  return {
    id: 'echo-project',
    name: 'Echo integration',
    tracks: [track('one'), track('two')],
    cursorPosition: 0,
    selection: { start: 0, end: 0.01 },
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
    echoSelectionOnTracks: mocks.echo,
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
  },
}));
vi.mock('@/db/audioDb', () => ({
  audioDb: {
    audioBuffers: { get: vi.fn(), put: vi.fn(), delete: vi.fn() },
    clipboard: {},
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
    processClipChannels: vi.fn((_clip: unknown, source: Float32Array[]) => source.map((channel) => new Float32Array(channel))),
  },
}));
vi.mock('@/wasm/processor', () => ({ isWasmAvailable: vi.fn(() => false), wasmProcessor: {} }));
vi.mock('react-router-dom', () => ({
  useParams: () => ({ projectId: 'echo-project' }),
  useNavigate: () => vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { success: mocks.success, error: mocks.error, info: mocks.info } }));
vi.mock('@/utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), log: vi.fn() } }));

class MockAudioContext {
  state = 'running';
  destination = {};
  resume = vi.fn(async () => undefined);
  close = vi.fn(async () => undefined);
  createBuffer(channels: number, length: number, sampleRate: number) {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    mocks.previewBuffers.push({ channels, length, sampleRate, data });
    return { getChannelData: (index: number) => data[index], duration: length / sampleRate };
  }
  createBufferSource() {
    return {
      buffer: null,
      onended: null,
      connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(),
    };
  }
}

import AudioEditorPage from './AudioEditorPage';

async function openEchoDialog() {
  fireEvent.pointerDown(screen.getByRole('button', { name: '效果' }));
  fireEvent.click(await screen.findByText('Echo 回声…'));
  return screen.findByRole('heading', { name: 'Echo 回声' });
}

describe('AudioEditorPage Echo effect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.previewBuffers.length = 0;
    mockProject = makeProject();
    vi.stubGlobal('AudioContext', MockAudioContext);
    mocks.loadChannels.mockImplementation(async (id: string) => {
      if (id === 'buffer-one') {
        return [
          Float32Array.from({ length: 10 }, (_, index) => index / 10),
          new Float32Array(10).fill(0.2),
        ];
      }
      return [new Float32Array(10).fill(0.4)];
    });
    mocks.saveProject.mockImplementation(async (project: IProject) => { mockProject = project; });
    mocks.echo.mockImplementation(async (
      _id: string,
      _selection: { start: number; end: number },
      _delay: number,
      _decay: number,
      targets: EchoTrackAudio[],
    ) => {
      mockProject = structuredClone(mockProject);
      mockProject.tracks.forEach((track) => { track.clips[0].audioBufferId = `echo-${track.id}`; });
      return targets.reduce((total, target) => total + target.clips.length, 0);
    });
    mocks.push.mockImplementation(() => undefined);
  });

  it('previews exact stereo selection PCM without writes, then applies both tracks with one undo', async () => {
    render(<AudioEditorPage />);
    expect(await screen.findByText('Echo integration')).toBeInTheDocument();
    await openEchoDialog();
    fireEvent.change(screen.getByLabelText('延迟时间（秒）'), { target: { value: '0.005' } });
    fireEvent.click(screen.getByRole('button', { name: '试听' }));

    await waitFor(() => expect(mocks.previewBuffers).toHaveLength(1));
    const preview = mocks.previewBuffers[0];
    expect(preview).toMatchObject({ channels: 2, length: 10, sampleRate: 1000 });
    expect(Array.from(preview.data[0].slice(0, 5))).toEqual([0, 0.1, 0.2, 0.3, 0.4].map(Math.fround));
    expect(preview.data[0][6]).toBeCloseTo(0.65);
    expect(preview.data[0][7]).toBeCloseTo(0.8);
    expect(preview.data[0][8]).toBeCloseTo(0.95);
    expect(preview.data[0][9]).toBeCloseTo(1.1);
    expect(Array.from(preview.data[1])).toEqual([
      0.2, 0.2, 0.2, 0.2, 0.2, 0.3, 0.3, 0.3, 0.3, 0.3,
    ].map(Math.fround));
    expect(mocks.echo).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.saveProject).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '应用回声' }));
    await waitFor(() => expect(mocks.success).toHaveBeenCalledWith('已对 2 个片段应用回声'));
    expect(mocks.echo).toHaveBeenCalledTimes(1);
    const [, selection, delay, decay, targets] = mocks.echo.mock.calls[0];
    expect(selection).toEqual({ start: 0, end: 0.01 });
    expect(delay).toBe(0.005);
    expect(decay).toBe(0.5);
    expect(targets).toHaveLength(2);
    expect(targets[0].clips[0].sampleData).toHaveLength(2);
    expect(mocks.push).toHaveBeenCalledTimes(1);
    expect(mocks.push.mock.calls[0][0].label).toBe('Echo 回声');

    expect(mocks.saveProject).not.toHaveBeenCalled();
    const restored = mocks.push.mock.calls[0][0].undo() as IProject;
    expect(restored.tracks[0].clips[0].audioBufferId).toBe('buffer-one');
    expect(mocks.saveProject).not.toHaveBeenCalled();
  });

  it('keeps the dialog open and records no history when the atomic service fails', async () => {
    mocks.echo.mockRejectedValueOnce(new Error('injected echo failure'));
    render(<AudioEditorPage />);
    expect(await screen.findByText('Echo integration')).toBeInTheDocument();
    await openEchoDialog();
    fireEvent.click(screen.getByRole('button', { name: '应用回声' }));

    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith('应用回声失败：injected echo failure'));
    expect(screen.getByRole('heading', { name: 'Echo 回声' })).toBeInTheDocument();
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.saveProject).not.toHaveBeenCalled();
  });

  it('disables Echo when there is no real selection', async () => {
    mockProject.selection = null;
    render(<AudioEditorPage />);
    expect(await screen.findByText('Echo integration')).toBeInTheDocument();
    fireEvent.pointerDown(screen.getByRole('button', { name: '效果' }));
    expect(await screen.findByText('Echo 回声…')).toHaveAttribute('aria-disabled', 'true');
  });
});
