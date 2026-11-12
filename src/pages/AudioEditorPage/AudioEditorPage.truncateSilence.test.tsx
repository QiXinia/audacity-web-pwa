import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IProject } from '@/types/project';
import {
  processTruncateSilenceTracks,
  type TruncateSilenceSettings,
  type TruncateSilenceTrackInput,
} from '@/lib/truncateSilenceEffect';

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  saveProject: vi.fn(),
  truncateSilence: vi.fn(),
  loadChannels: vi.fn(),
  previewBuffers: [] as { channels: number; length: number; sampleRate: number; data: Float32Array[] }[],
}));
let mockProject: IProject;

function toneWithSilence(start: number, end: number): Float32Array {
  const pcm = new Float32Array(4000);
  pcm.fill(0.5);
  pcm.fill(0, start * 1000, end * 1000);
  return pcm;
}

function makeProject(): IProject {
  const clip = (id: string) => ({
    id,
    audioBufferId: `buffer-${id}`,
    startTime: 0,
    offset: 0,
    duration: 4,
    originalDuration: 4,
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
    id: 'truncate-silence-project',
    name: 'Truncate Silence integration',
    tracks: [track('one'), track('two')],
    cursorPosition: 0,
    selection: { start: 0, end: 4 },
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
    loadAudioBuffer: vi.fn(async () => new Float32Array(4000)),
    truncateSilenceSelectionOnTracks: mocks.truncateSilence,
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
  audioDb: {
    audioBuffers: { get: vi.fn(), put: vi.fn(), delete: vi.fn() },
    clipboard: {}, historySnapshots: {},
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
  useParams: () => ({ projectId: 'truncate-silence-project' }),
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

async function openTruncateSilenceDialog() {
  fireEvent.pointerDown(screen.getByRole('button', { name: '效果' }));
  fireEvent.click(await screen.findByText('Truncate Silence 静音截断…'));
  return screen.findByRole('heading', { name: 'Truncate Silence 静音截断' });
}

function realTargets(): TruncateSilenceTrackInput[] {
  return [
    {
      trackId: 'one',
      clips: [{
        clipId: 'one', sourceOffset: 0,
        sampleData: [toneWithSilence(1, 3), toneWithSilence(1, 3)],
      }],
    },
    {
      trackId: 'two',
      clips: [{ clipId: 'two', sourceOffset: 0, sampleData: [toneWithSilence(1.5, 2.5)] }],
    },
  ];
}

describe('AudioEditorPage Truncate Silence effect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.previewBuffers.length = 0;
    mockProject = makeProject();
    vi.stubGlobal('AudioContext', MockAudioContext);
    mocks.loadChannels.mockImplementation(async (id: string) => (
      id === 'buffer-one'
        ? [toneWithSilence(1, 3), toneWithSilence(1, 3)]
        : [toneWithSilence(1.5, 2.5)]
    ));
    mocks.saveProject.mockImplementation(async (project: IProject) => { mockProject = project; });
    mocks.truncateSilence.mockImplementation(async (
      _id: string,
      _selection: { start: number; end: number },
      _settings: TruncateSilenceSettings,
      targets: TruncateSilenceTrackInput[],
    ) => {
      mockProject = structuredClone(mockProject);
      mockProject.tracks.forEach((track) => {
        track.clips[0].audioBufferId = `truncate-${track.id}`;
        track.clips[0].duration = 3.5;
      });
      mockProject.selection = { start: 0, end: 3.5 };
      return { project: mockProject, selectionEnd: 3.5, changedTracks: targets.length };
    });
    mocks.push.mockImplementation(() => undefined);
  });

  it('previews real linked stereo PCM, then applies all tracks with one undo', async () => {
    render(<AudioEditorPage />);
    expect(await screen.findByText('Truncate Silence integration')).toBeInTheDocument();
    await openTruncateSilenceDialog();
    fireEvent.click(screen.getByRole('button', { name: '试听' }));

    await waitFor(() => expect(mocks.previewBuffers).toHaveLength(1));
    const preview = mocks.previewBuffers[0];
    const expected = processTruncateSilenceTracks(
      makeProject().tracks,
      realTargets(),
      { start: 0, end: 4 },
      {
        thresholdDb: -20, minimumDuration: 0.5, action: 'truncate',
        truncateDuration: 0.5, compressPercent: 50, independent: false,
      },
      1000,
    );
    expect(preview).toMatchObject({ channels: 2, length: 3500, sampleRate: 1000 });
    expect(preview.data[0]).toEqual(expected.tracks[0].sampleData[0]);
    expect(preview.data[1]).toEqual(expected.tracks[0].sampleData[1]);
    expect(mocks.truncateSilence).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '应用 Truncate Silence' }));
    await waitFor(() => expect(mocks.success).toHaveBeenCalledWith('已对 2 条轨道应用 Truncate Silence 静音截断'));
    const [, selection, appliedSettings, targets] = mocks.truncateSilence.mock.calls[0];
    expect(selection).toEqual({ start: 0, end: 4 });
    expect(appliedSettings).toEqual({
      thresholdDb: -20, minimumDuration: 0.5, action: 'truncate',
      truncateDuration: 0.5, compressPercent: 50, independent: false,
    });
    expect(targets).toHaveLength(2);
    expect(targets[0].clips[0].sampleData).toHaveLength(2);
    expect(mocks.push).toHaveBeenCalledTimes(1);
    expect(mocks.push.mock.calls[0][0].label).toBe('Truncate Silence 静音截断');
    expect(mocks.push.mock.calls[0][1].selection).toEqual({ start: 0, end: 4 });
    const restored = mocks.push.mock.calls[0][0].undo() as IProject;
    expect(restored.tracks[0].clips[0].audioBufferId).toBe('buffer-one');
    expect(restored.tracks[0].clips[0].duration).toBe(4);
    expect(restored.selection).toEqual({ start: 0, end: 4 });
    expect(mocks.saveProject).not.toHaveBeenCalled();
  });

  it('keeps the dialog open and records no history when the atomic service fails', async () => {
    mocks.truncateSilence.mockRejectedValueOnce(new Error('quota exceeded'));
    render(<AudioEditorPage />);
    expect(await screen.findByText('Truncate Silence integration')).toBeInTheDocument();
    await openTruncateSilenceDialog();
    fireEvent.click(screen.getByRole('button', { name: '应用 Truncate Silence' }));

    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith('应用 Truncate Silence 失败：quota exceeded'));
    expect(screen.getByRole('heading', { name: 'Truncate Silence 静音截断' })).toBeInTheDocument();
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.saveProject).not.toHaveBeenCalled();
  });

  it('reports no qualifying silence without history or closing the dialog', async () => {
    mocks.truncateSilence.mockResolvedValueOnce({
      project: mockProject, selectionEnd: 4, changedTracks: 0,
    });
    render(<AudioEditorPage />);
    expect(await screen.findByText('Truncate Silence integration')).toBeInTheDocument();
    await openTruncateSilenceDialog();
    fireEvent.click(screen.getByRole('button', { name: '应用 Truncate Silence' }));

    await waitFor(() => expect(mocks.info).toHaveBeenCalledWith('未检测到符合参数且可缩短的静音，未修改音频'));
    expect(mocks.push).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Truncate Silence 静音截断' })).toBeInTheDocument();
  });

  it('disables Truncate Silence when there is no real selection', async () => {
    mockProject.selection = null;
    render(<AudioEditorPage />);
    expect(await screen.findByText('Truncate Silence integration')).toBeInTheDocument();
    fireEvent.pointerDown(screen.getByRole('button', { name: '效果' }));
    expect(await screen.findByText('Truncate Silence 静音截断…')).toHaveAttribute('aria-disabled', 'true');
  });
});
