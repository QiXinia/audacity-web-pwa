import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IProject } from '@/types/project';
import type { ClickRemovalTrackAudio } from '@/services/projectService';
import {
  processClickRemovalChannels,
  type ClickRemovalSettings,
} from '@/lib/clickRemovalEffect';

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  saveProject: vi.fn(),
  clickRemoval: vi.fn(),
  loadChannels: vi.fn(),
  previewBuffers: [] as { channels: number; length: number; sampleRate: number; data: Float32Array[] }[],
}));
let mockProject: IProject;

function officialInput(): Float32Array {
  const input = new Float32Array(8192);
  for (let index = 0; index < input.length; index += 1) {
    input[index] = Math.fround((((index * 37) % 2001) - 1000) / 50000);
  }
  for (let index = 1500; index < 1503; index += 1) {
    input[index] = Math.fround(input[index] + Math.fround(index % 2 ? -0.9 : 0.9));
  }
  for (let index = 5000; index < 5005; index += 1) {
    input[index] = Math.fround(input[index] + Math.fround(index % 2 ? 0.8 : -0.8));
  }
  return input;
}

function makeProject(): IProject {
  const clip = (id: string) => ({
    id,
    audioBufferId: `buffer-${id}`,
    startTime: 0,
    offset: 0,
    duration: 8.192,
    originalDuration: 8.192,
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
    id: 'click-removal-project',
    name: 'Click Removal integration',
    tracks: [track('one'), track('two')],
    cursorPosition: 0,
    selection: { start: 0, end: 8.192 },
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
    loadAudioBuffer: vi.fn(async () => new Float32Array(8192)),
    clickRemovalSelectionOnTracks: mocks.clickRemoval,
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
  useParams: () => ({ projectId: 'click-removal-project' }),
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

async function openClickRemovalDialog() {
  fireEvent.pointerDown(screen.getByRole('button', { name: '效果' }));
  fireEvent.click(await screen.findByText('Click Removal 咔哒声消除…'));
  return screen.findByRole('heading', { name: 'Click Removal 咔哒声消除' });
}

describe('AudioEditorPage Click Removal effect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.previewBuffers.length = 0;
    mockProject = makeProject();
    vi.stubGlobal('AudioContext', MockAudioContext);
    mocks.loadChannels.mockImplementation(async (id: string) => {
      if (id === 'buffer-one') return [officialInput(), officialInput()];
      return [officialInput()];
    });
    mocks.saveProject.mockImplementation(async (project: IProject) => { mockProject = project; });
    mocks.clickRemoval.mockImplementation(async (
      _id: string,
      _selection: { start: number; end: number },
      _settings: ClickRemovalSettings,
      targets: ClickRemovalTrackAudio[],
    ) => {
      mockProject = structuredClone(mockProject);
      mockProject.tracks.forEach((track) => { track.clips[0].audioBufferId = `click-${track.id}`; });
      return targets.reduce((total, target) => total + target.clips.length, 0);
    });
    mocks.push.mockImplementation(() => undefined);
  });

  it('previews exact stereo selection PCM, then applies both tracks with one undo', async () => {
    render(<AudioEditorPage />);
    expect(await screen.findByText('Click Removal integration')).toBeInTheDocument();
    await openClickRemovalDialog();
    expect(screen.getByLabelText('Threshold (lower is more sensitive)')).toHaveValue(200);
    expect(screen.getByLabelText('Max spike width (higher is more sensitive)')).toHaveValue(20);
    fireEvent.change(screen.getByLabelText('Threshold (lower is more sensitive)'), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText('Max spike width (higher is more sensitive)'), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: '试听' }));

    await waitFor(() => expect(mocks.previewBuffers).toHaveLength(1));
    const preview = mocks.previewBuffers[0];
    expect(preview).toMatchObject({ channels: 2, length: 8192, sampleRate: 1000 });
    const settings = { threshold: 100, width: 30 };
    const expected = processClickRemovalChannels([officialInput(), officialInput()], settings);
    expect(preview.data[0]).toEqual(expected.sampleData[0]);
    expect(preview.data[1]).toEqual(expected.sampleData[1]);
    expect(mocks.clickRemoval).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '应用 Click Removal' }));
    await waitFor(() => expect(mocks.success).toHaveBeenCalledWith('已对 2 个片段应用 Click Removal 咔哒声消除'));
    const [, selection, appliedSettings, targets] = mocks.clickRemoval.mock.calls[0];
    expect(selection).toEqual({ start: 0, end: 8.192 });
    expect(appliedSettings).toEqual(settings);
    expect(targets).toHaveLength(2);
    expect(targets[0].clips[0].sampleData).toHaveLength(2);
    expect(mocks.push).toHaveBeenCalledTimes(1);
    expect(mocks.push.mock.calls[0][0].label).toBe('Click Removal 咔哒声消除');
    expect(mocks.push.mock.calls[0][1].selection).toEqual({ start: 0, end: 8.192 });
    const restored = mocks.push.mock.calls[0][0].undo() as IProject;
    expect(restored.tracks[0].clips[0].audioBufferId).toBe('buffer-one');
    expect(restored.selection).toEqual({ start: 0, end: 8.192 });
    expect(mocks.saveProject).not.toHaveBeenCalled();
  });

  it('keeps the dialog open and records no history when the atomic service fails', async () => {
    mocks.clickRemoval.mockRejectedValueOnce(new Error('Algorithm not effective on this audio. Nothing changed.'));
    render(<AudioEditorPage />);
    expect(await screen.findByText('Click Removal integration')).toBeInTheDocument();
    await openClickRemovalDialog();
    fireEvent.click(screen.getByRole('button', { name: '应用 Click Removal' }));

    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith(
      '应用 Click Removal 失败：Algorithm not effective on this audio. Nothing changed.',
    ));
    expect(screen.getByRole('heading', { name: 'Click Removal 咔哒声消除' })).toBeInTheDocument();
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.saveProject).not.toHaveBeenCalled();
  });

  it('reports a zero-parameter skip without history or closing the dialog', async () => {
    mocks.clickRemoval.mockResolvedValueOnce(0);
    render(<AudioEditorPage />);
    expect(await screen.findByText('Click Removal integration')).toBeInTheDocument();
    await openClickRemovalDialog();
    fireEvent.change(screen.getByLabelText('Threshold (lower is more sensitive)'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: '应用 Click Removal' }));

    await waitFor(() => expect(mocks.info).toHaveBeenCalledWith(
      'Click Removal 参数为 0，已按官方行为跳过，未修改音频',
    ));
    expect(mocks.push).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Click Removal 咔哒声消除' })).toBeInTheDocument();
  });

  it('disables Click Removal when there is no real selection', async () => {
    mockProject.selection = null;
    render(<AudioEditorPage />);
    expect(await screen.findByText('Click Removal integration')).toBeInTheDocument();
    fireEvent.pointerDown(screen.getByRole('button', { name: '效果' }));
    expect(await screen.findByText('Click Removal 咔哒声消除…')).toHaveAttribute('aria-disabled', 'true');
  });
});
