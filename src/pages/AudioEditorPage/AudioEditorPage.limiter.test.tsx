import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IProject } from '@/types/project';
import type { LimiterTrackAudio } from '@/services/projectService';
import {
  DEFAULT_LIMITER_SETTINGS,
  processLimiterChannels,
  type LimiterSettings,
} from '@/lib/limiterEffect';

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  saveProject: vi.fn(),
  limiter: vi.fn(),
  loadChannels: vi.fn(),
  previewBuffers: [] as { channels: number; length: number; sampleRate: number; data: Float32Array[] }[],
}));
let mockProject: IProject;

function makeProject(): IProject {
  const clip = (id: string, startTime = 0) => ({
    id,
    audioBufferId: `buffer-${id}`,
    startTime,
    offset: 0,
    duration: 0.5,
    originalDuration: 0.5,
    stretchRatio: 1,
    gain: 0,
    fadeIn: 0,
    fadeOut: 0,
    name: `clip-${id}`,
  });
  const track = (id: string, clips: ReturnType<typeof clip>[]) => ({
    id,
    name: `Track ${id}`,
    type: 'audio' as const,
    gain: 0,
    pan: 0,
    muted: false,
    solo: false,
    armed: false,
    color: '',
    clips,
    effects: [],
  });
  return {
    id: 'limiter-project',
    name: 'Limiter integration',
    tracks: [track('one', [clip('one-a'), clip('one-b', 0.5)]), track('two', [clip('two-c')])],
    cursorPosition: 0,
    selection: { start: 0.25, end: 0.75 },
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
    limiterSelectionOnTracks: mocks.limiter,
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
  useParams: () => ({ projectId: 'limiter-project' }),
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

async function openLimiterDialog() {
  fireEvent.pointerDown(screen.getByRole('button', { name: '效果' }));
  fireEvent.click(await screen.findByText('Limiter 限制器…'));
  return screen.findByRole('heading', { name: 'Limiter 限制器' });
}

describe('AudioEditorPage Limiter effect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.previewBuffers.length = 0;
    mockProject = makeProject();
    vi.stubGlobal('AudioContext', MockAudioContext);
    mocks.loadChannels.mockImplementation(async (id: string) => {
      if (id === 'buffer-one-a') {
        return [
          Float32Array.from({ length: 500 }, (_, index) => index / 500),
          new Float32Array(500).fill(0.2),
        ];
      }
      if (id === 'buffer-one-b') {
        return [new Float32Array(500).fill(0.3), new Float32Array(500).fill(-0.1)];
      }
      return [new Float32Array(500).fill(0.4)];
    });
    mocks.saveProject.mockImplementation(async (project: IProject) => { mockProject = project; });
    mocks.limiter.mockImplementation(async (
      _id: string,
      _selection: { start: number; end: number },
      _settings: LimiterSettings,
      targets: LimiterTrackAudio[],
    ) => {
      mockProject = structuredClone(mockProject);
      mockProject.tracks.forEach((track) => {
        track.clips.forEach((clip) => { clip.audioBufferId = `limiter-${clip.id}`; });
      });
      return targets.reduce((total, target) => total + target.clips.length, 0);
    });
    mocks.push.mockImplementation(() => undefined);
  });

  it('previews concatenated stereo selections with input history and no writes, then applies all tracks with one undo', async () => {
    render(<AudioEditorPage />);
    expect(await screen.findByText('Limiter integration')).toBeInTheDocument();
    await openLimiterDialog();
    fireEvent.click(screen.getByRole('button', { name: '试听' }));

    await waitFor(() => expect(mocks.previewBuffers).toHaveLength(1));
    const preview = mocks.previewBuffers[0];
    expect(preview).toMatchObject({ channels: 2, length: 500, sampleRate: 1000 });
    const left = new Float32Array(500);
    const right = new Float32Array(500);
    left.set(Float32Array.from({ length: 250 }, (_, index) => (index + 250) / 500), 0);
    left.set(new Float32Array(250).fill(0.3), 250);
    right.set(new Float32Array(250).fill(0.2), 0);
    right.set(new Float32Array(250).fill(-0.1), 250);
    const expected = processLimiterChannels(
      [left, right], { ...DEFAULT_LIMITER_SETTINGS }, 1000,
    );
    expect(preview.data[0]).toEqual(expected[0]);
    expect(preview.data[1]).toEqual(expected[1]);
    expect(screen.getByText(/输入、输出与实际压缩来自当前选区试听 PCM/)).toBeInTheDocument();
    expect(mocks.limiter).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.saveProject).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '应用' }));
    await waitFor(() => expect(mocks.success).toHaveBeenCalledWith('已对 3 个片段应用 Limiter 限制器'));
    expect(mocks.limiter).toHaveBeenCalledTimes(1);
    const [, selection, appliedSettings, targets] = mocks.limiter.mock.calls[0];
    expect(selection).toEqual({ start: 0.25, end: 0.75 });
    expect(appliedSettings).toEqual({ ...DEFAULT_LIMITER_SETTINGS });
    expect(targets.map((target: LimiterTrackAudio) => target.clips.length)).toEqual([2, 1]);
    expect(targets[0].clips[0].sampleData).toHaveLength(2);
    expect(mocks.push).toHaveBeenCalledTimes(1);
    expect(mocks.push.mock.calls[0][0].label).toBe('Limiter 限制器');
    const restored = mocks.push.mock.calls[0][0].undo() as IProject;
    expect(restored.tracks[0].clips[0].audioBufferId).toBe('buffer-one-a');
    expect(restored.selection).toEqual({ start: 0.25, end: 0.75 });
    expect(mocks.saveProject).not.toHaveBeenCalled();
  });

  it('keeps the dialog open and records no history when the atomic service fails', async () => {
    mocks.limiter.mockRejectedValueOnce(new Error('injected limiter failure'));
    render(<AudioEditorPage />);
    expect(await screen.findByText('Limiter integration')).toBeInTheDocument();
    await openLimiterDialog();
    fireEvent.click(screen.getByRole('button', { name: '应用' }));

    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith('应用 Limiter 失败：injected limiter failure'));
    expect(screen.getByRole('heading', { name: 'Limiter 限制器' })).toBeInTheDocument();
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.saveProject).not.toHaveBeenCalled();
  });

  it('disables Limiter when there is no real selection', async () => {
    mockProject.selection = null;
    render(<AudioEditorPage />);
    expect(await screen.findByText('Limiter integration')).toBeInTheDocument();
    fireEvent.pointerDown(screen.getByRole('button', { name: '效果' }));
    expect(await screen.findByText('Limiter 限制器…')).toHaveAttribute('aria-disabled', 'true');
  });
});
