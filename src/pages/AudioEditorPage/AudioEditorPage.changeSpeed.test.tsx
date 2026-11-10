import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IProject } from '@/types/project';
import type { ChangeSpeedTrackAudio } from '@/services/projectService';
import type { ChangeSpeedSettings } from '@/lib/changeSpeedEffect';

const mocks = vi.hoisted(() => ({
  push: vi.fn(), success: vi.fn(), error: vi.fn(), info: vi.fn(), saveProject: vi.fn(),
  changeSpeed: vi.fn(), undo: vi.fn(), canUndo: vi.fn(() => false), loadChannels: vi.fn(),
  previewBuffers: [] as { channels: number; length: number; sampleRate: number; data: Float32Array[] }[],
}));
let mockProject: IProject;

function makeProject(): IProject {
  const clip = (id: string) => ({
    id, audioBufferId: `buffer-${id}`, startTime: 0, offset: 0, duration: 0.01,
    originalDuration: 0.01, stretchRatio: 1, gain: 0, fadeIn: 0, fadeOut: 0, name: `clip-${id}`,
  });
  const track = (id: string) => ({
    id, name: `Track ${id}`, type: 'audio' as const, gain: 0, pan: 0, muted: false,
    solo: false, armed: false, color: '', clips: [clip(id)], effects: [],
  });
  return {
    id: 'change-speed-project', name: 'Change Speed integration', tracks: [track('one'), track('two')],
    cursorPosition: 0, selection: { start: 0, end: 0.01 },
    viewState: { horizontalZoom: 100, verticalZoom: 1, scrollX: 0, viewMode: 'waveform' },
    updatedAt: 100, createdAt: 50, sampleRate: 1000,
    timeSignature: { numerator: 4, denominator: 4 }, tempo: 120,
  };
}

vi.mock('@/services/projectService', () => ({
  projectService: {
    getProject: vi.fn(async () => mockProject), openProject: vi.fn(async () => mockProject),
    saveProject: mocks.saveProject, loadAudioChannels: mocks.loadChannels,
    loadAudioBuffer: vi.fn(async () => new Float32Array(10)),
    changeSpeedSelectionOnTracks: mocks.changeSpeed,
  },
}));
vi.mock('@/services/historyService', () => ({
  historyManager: {
    push: mocks.push, pushCommand: mocks.push, canUndo: mocks.canUndo, canRedo: vi.fn(() => false),
    loadForProject: vi.fn(async () => 0), flush: vi.fn(async () => undefined), undo: mocks.undo,
    redo: vi.fn(), getUndoStack: vi.fn(() => []), getRedoStack: vi.fn(() => []),
    getHistoryState: vi.fn(() => ({ canUndo: false, canRedo: false, undoLabel: '', redoLabel: '' })),
    clearHistory: vi.fn(), flushPersistence: vi.fn(),
  },
}));
vi.mock('@/db/audioDb', () => ({
  audioDb: { audioBuffers: { get: vi.fn(), put: vi.fn(), delete: vi.fn() }, clipboard: {}, historySnapshots: {} },
  serializeTracks: (tracks: unknown) => JSON.stringify(tracks),
  deserializeTracks: (data: string) => JSON.parse(data),
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
    setCursorChangeCallback: vi.fn(), setStateChangeCallback: vi.fn(),
    setPlaybackCompleteCallback: vi.fn(), setTracksEndCallback: vi.fn(),
    processClipChannels: vi.fn((_clip: unknown, source: Float32Array[]) => source.map((channel) => new Float32Array(channel))),
  },
}));
vi.mock('@/wasm/processor', () => ({ isWasmAvailable: vi.fn(() => false), wasmProcessor: {} }));
vi.mock('react-router-dom', () => ({
  useParams: () => ({ projectId: 'change-speed-project' }), useNavigate: () => vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { success: mocks.success, error: mocks.error, info: mocks.info } }));
vi.mock('@/utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), log: vi.fn() } }));

class MockAudioContext {
  state = 'running'; sampleRate = 1000; destination = {};
  resume = vi.fn(async () => undefined); close = vi.fn(async () => undefined);
  createBuffer(channels: number, length: number, sampleRate: number) {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    mocks.previewBuffers.push({ channels, length, sampleRate, data });
    return { getChannelData: (index: number) => data[index], duration: length / sampleRate };
  }
  createBufferSource() {
    return { buffer: null, onended: null, connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn() };
  }
}

import AudioEditorPage from './AudioEditorPage';

async function openChangeSpeedDialog() {
  fireEvent.pointerDown(screen.getByRole('button', { name: '效果' }));
  fireEvent.click(await screen.findByText('Change Speed（速度及音高）…'));
  return screen.findByRole('heading', { name: 'Change Speed（速度及音高）' });
}

describe('AudioEditorPage Change Speed effect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.canUndo.mockReturnValue(false); mocks.undo.mockImplementation(() => undefined);
    mocks.previewBuffers.length = 0; mockProject = makeProject();
    vi.stubGlobal('AudioContext', MockAudioContext);
    mocks.loadChannels.mockImplementation(async (id: string) => {
      if (id === 'buffer-one') return [
        Float32Array.from({ length: 10 }, (_, index) => index / 10), new Float32Array(10).fill(0.2),
      ];
      return [new Float32Array(10).fill(0.4)];
    });
    mocks.saveProject.mockImplementation(async (project: IProject) => { mockProject = project; });
    mocks.changeSpeed.mockImplementation(async (
      _id: string, _selection: { start: number; end: number },
      _settings: ChangeSpeedSettings, targets: ChangeSpeedTrackAudio[],
    ) => {
      mockProject = structuredClone(mockProject);
      mockProject.tracks.forEach((track) => {
        track.clips[0].audioBufferId = `speed-${track.id}`;
        track.clips[0].duration = 0.005; track.clips[0].originalDuration = 0.005;
      });
      mockProject.selection = { start: 0, end: 0.005 };
      return targets.reduce((total, target) => total + target.clips.length, 0);
    });
    mocks.push.mockImplementation(() => undefined);
  });

  it('previews resampled PCM without writes, then applies both tracks with one undo', async () => {
    render(<AudioEditorPage />);
    expect(await screen.findByText('Change Speed integration')).toBeInTheDocument();
    await openChangeSpeedDialog();
    fireEvent.change(screen.getByLabelText('变化百分比（%）'), { target: { value: '100' } });
    expect(screen.getByLabelText('速度倍率')).toHaveValue(2);
    expect(screen.getByLabelText('目标时长（秒）')).toHaveValue(0.005);
    fireEvent.click(screen.getByRole('button', { name: '试听' }));

    await waitFor(() => {
      const alert = screen.queryByRole('alert');
      if (alert) throw new Error(`预览错误：${alert.textContent ?? ''}`);
      expect(mocks.previewBuffers).toHaveLength(1);
    });
    const preview = mocks.previewBuffers[0];
    expect(preview).toMatchObject({ channels: 2, length: 5, sampleRate: 1000 });
    [0, 0.2, 0.4, 0.6, 0.8].forEach((expected, index) => {
      expect(preview.data[0][index]).toBeCloseTo(expected, 1);
    });
    for (const value of preview.data[1]) expect(value).toBeCloseTo(0.2, 5);
    expect(mocks.changeSpeed).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled(); expect(mocks.saveProject).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '停止试听' }));
    mocks.canUndo.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: '应用效果' }));
    await waitFor(() => expect(mocks.success).toHaveBeenCalledWith('已对 2 个片段应用 Change Speed（速度及音高）'));
    await waitFor(() => expect(screen.getByLabelText('选区结束时间')).toHaveValue('00h00m00.005s'));
    expect(mocks.changeSpeed).toHaveBeenCalledTimes(1);
    const [id, selection, appliedSettings, targets] = mocks.changeSpeed.mock.calls[0];
    expect(id).toBe('change-speed-project'); expect(selection).toEqual({ start: 0, end: 0.01 });
    expect(appliedSettings).toEqual({ percentChange: 100 }); expect(targets).toHaveLength(2);
    expect(targets[0].clips[0].sampleData).toHaveLength(2);
    expect(mocks.push).toHaveBeenCalledTimes(1); expect(mocks.push.mock.calls[0][0].label).toBe('Change Speed');
    expect(mocks.saveProject).not.toHaveBeenCalled();
    const restored = mocks.push.mock.calls[0][0].undo() as IProject;
    expect(restored.tracks[0].clips[0].audioBufferId).toBe('buffer-one');
    expect(restored.selection).toEqual({ start: 0, end: 0.01 });
    mocks.undo.mockReturnValue({ project: restored, command: { label: 'Change Speed' } });
    fireEvent.click(screen.getByRole('button', { name: '撤销' }));
    await waitFor(() => expect(mocks.info).toHaveBeenCalledWith('撤销：Change Speed'));
    expect(screen.getByLabelText('选区结束时间')).toHaveValue('00h00m00.010s');
  });

  it('keeps the dialog open and records no history when the atomic service fails', async () => {
    mocks.changeSpeed.mockRejectedValueOnce(new Error('injected speed failure'));
    render(<AudioEditorPage />);
    expect(await screen.findByText('Change Speed integration')).toBeInTheDocument();
    await openChangeSpeedDialog();
    fireEvent.change(screen.getByLabelText('变化百分比（%）'), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: '应用效果' }));
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith('Change Speed 失败：injected speed failure'));
    expect(screen.getByRole('heading', { name: 'Change Speed（速度及音高）' })).toBeInTheDocument();
    expect(mocks.push).not.toHaveBeenCalled(); expect(mocks.saveProject).not.toHaveBeenCalled();
  });

  it('disables Change Speed when there is no real selection', async () => {
    mockProject.selection = null;
    render(<AudioEditorPage />);
    expect(await screen.findByText('Change Speed integration')).toBeInTheDocument();
    fireEvent.pointerDown(screen.getByRole('button', { name: '效果' }));
    expect(await screen.findByText('Change Speed（速度及音高）…')).toHaveAttribute('aria-disabled', 'true');
  });
});
