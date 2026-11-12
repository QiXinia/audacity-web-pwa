import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IProject } from '@/types/project';
import type { FilterCurveEqTrackAudio } from '@/services/projectService';
import {
  FILTER_CURVE_EQ_PRESETS,
  processFilterCurveEqChannels,
  type FilterCurveEqSettings,
} from '@/lib/filterCurveEffect';

const mocks = vi.hoisted(() => ({
  push: vi.fn(), success: vi.fn(), error: vi.fn(), info: vi.fn(), saveProject: vi.fn(),
  filterCurve: vi.fn(), loadChannels: vi.fn(),
  previewBuffers: [] as { channels: number; length: number; sampleRate: number; data: Float32Array[] }[],
}));
let mockProject: IProject;

function makeProject(): IProject {
  const clip = (id: string) => ({
    id, audioBufferId: `buffer-${id}`, startTime: 0, offset: 0,
    duration: 2, originalDuration: 2, stretchRatio: 1, gain: 0, fadeIn: 0, fadeOut: 0, name: `clip-${id}`,
  });
  const track = (id: string) => ({
    id, name: `Track ${id}`, type: 'audio' as const, gain: 0, pan: 0, muted: false, solo: false,
    armed: false, color: '', clips: [clip(id)], effects: [],
  });
  return {
    id: 'filter-curve-project', name: 'Filter Curve integration', tracks: [track('one'), track('two')],
    cursorPosition: 0, selection: { start: 0, end: 2 },
    viewState: { horizontalZoom: 100, verticalZoom: 1, scrollX: 0, viewMode: 'waveform' },
    updatedAt: 100, createdAt: 50, sampleRate: 8000,
    timeSignature: { numerator: 4, denominator: 4 }, tempo: 120,
  };
}

vi.mock('@/services/projectService', () => ({
  projectService: {
    getProject: vi.fn(async () => mockProject), openProject: vi.fn(async () => mockProject),
    saveProject: mocks.saveProject, loadAudioChannels: mocks.loadChannels,
    loadAudioBuffer: vi.fn(async () => new Float32Array(10)),
    filterCurveEqSelectionOnTracks: mocks.filterCurve,
  },
}));
vi.mock('@/services/historyService', () => ({
  historyManager: {
    push: mocks.push, pushCommand: mocks.push, canUndo: vi.fn(() => false), canRedo: vi.fn(() => false),
    loadForProject: vi.fn(async () => 0), flush: vi.fn(async () => undefined), undo: vi.fn(), redo: vi.fn(),
    getUndoStack: vi.fn(() => []), getRedoStack: vi.fn(() => []),
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
    setCursorChangeCallback: vi.fn(), setStateChangeCallback: vi.fn(), setPlaybackCompleteCallback: vi.fn(), setTracksEndCallback: vi.fn(),
    processClipChannels: vi.fn((_clip: unknown, source: Float32Array[]) => source.map((channel) => new Float32Array(channel))),
  },
}));
vi.mock('@/wasm/processor', () => ({ isWasmAvailable: vi.fn(() => false), wasmProcessor: {} }));
vi.mock('react-router-dom', () => ({ useParams: () => ({ projectId: 'filter-curve-project' }), useNavigate: () => vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: mocks.success, error: mocks.error, info: mocks.info } }));
vi.mock('@/utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), log: vi.fn() } }));

class MockAudioContext {
  state = 'running'; sampleRate = 8000; destination = {};
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

function noise(seed: number, amplitude: number): Float32Array {
  let state = seed >>> 0;
  const result = new Float32Array(16_000);
  for (let index = 0; index < result.length; index += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    result[index] = Math.fround((state / 0x100000000 - 0.5) * amplitude);
  }
  return result;
}

async function openDialog() {
  fireEvent.pointerDown(screen.getByRole('button', { name: '效果' }));
  fireEvent.click(await screen.findByText('Filter Curve EQ 滤波曲线均衡…'));
  return screen.findByRole('heading', { name: 'Filter Curve EQ' });
}

function chooseBassBoost() {
  fireEvent.change(screen.getByLabelText('工厂预设'), { target: { value: 'Bass Boost' } });
  fireEvent.change(screen.getByLabelText('Filter Length (taps)'), { target: { value: '21' } });
}

const bassSettings = (): FilterCurveEqSettings => ({
  points: FILTER_CURVE_EQ_PRESETS.find(({ name }) => name === 'Bass Boost')!.points,
  filterLength: 21,
  linearFrequencyScale: false,
});

describe('AudioEditorPage Filter Curve EQ', () => {
  beforeEach(() => {
    vi.clearAllMocks(); mocks.previewBuffers.length = 0; mockProject = makeProject();
    vi.stubGlobal('AudioContext', MockAudioContext);
    mocks.loadChannels.mockImplementation(async (id: string) => (
      id === 'buffer-one'
        ? [noise(0x12345678, 0.16), noise(0x87654321, 0.08)]
        : [noise(0x10203040, 0.12)]
    ));
    mocks.saveProject.mockImplementation(async (project: IProject) => { mockProject = project; });
    mocks.filterCurve.mockImplementation(async (
      _id: string, _selection: { start: number; end: number }, _settings: FilterCurveEqSettings,
      targets: FilterCurveEqTrackAudio[],
    ) => {
      mockProject = structuredClone(mockProject);
      mockProject.tracks.forEach((track) => { track.clips[0].audioBufferId = `filter-curve-${track.id}`; });
      return targets.reduce((total, target) => total + target.clips.length, 0);
    });
    mocks.push.mockImplementation(() => undefined);
  });

  it('previews exact FIR PCM without writes, then applies both tracks with one undo', async () => {
    render(<AudioEditorPage />);
    expect(await screen.findByText('Filter Curve integration')).toBeInTheDocument();
    await openDialog();
    expect(screen.getByLabelText('Filter Length (taps)')).toHaveValue(8191);
    expect(screen.getByLabelText('Linear frequency scale')).not.toBeChecked();
    expect(screen.getByLabelText('Grid lines')).toBeChecked();
    chooseBassBoost();
    fireEvent.click(screen.getByRole('button', { name: '试听' }));
    await waitFor(() => {
      const alert = screen.queryByRole('alert');
      if (alert) throw new Error(`预览错误：${alert.textContent ?? ''}`);
      expect(mocks.previewBuffers).toHaveLength(1);
    });
    const preview = mocks.previewBuffers[0];
    const settings = bassSettings();
    const source = [noise(0x12345678, 0.16), noise(0x87654321, 0.08)];
    expect(preview).toMatchObject({ channels: 2, length: 16_000, sampleRate: 8000 });
    expect(preview.data).toEqual(processFilterCurveEqChannels(source, settings, 8000));
    expect(mocks.filterCurve).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.saveProject).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '停止试听' }));
    fireEvent.click(screen.getByRole('button', { name: '应用' }));
    await waitFor(() => expect(mocks.success).toHaveBeenCalledWith('已对 2 个片段应用 Filter Curve EQ'));
    expect(mocks.filterCurve).toHaveBeenCalledTimes(1);
    const [, selection, appliedSettings, targets] = mocks.filterCurve.mock.calls[0];
    expect(selection).toEqual({ start: 0, end: 2 });
    expect(appliedSettings).toEqual(settings);
    expect(targets).toHaveLength(2);
    expect(mocks.push).toHaveBeenCalledTimes(1);
    expect(mocks.push.mock.calls[0][0].label).toBe('Filter Curve EQ 滤波曲线均衡');
    const restored = mocks.push.mock.calls[0][0].undo() as IProject;
    expect(restored.tracks[0].clips[0].audioBufferId).toBe('buffer-one');
  });

  it('passes edited points, inversion, linear scale and grid settings through the dialog', async () => {
    render(<AudioEditorPage />);
    expect(await screen.findByText('Filter Curve integration')).toBeInTheDocument();
    await openDialog();
    fireEvent.click(screen.getByRole('button', { name: '放大 dB 范围' }));
    expect(screen.getByText(/dB -24…24/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '缩小 dB 范围' }));
    expect(screen.getByText(/dB -30…30/)).toBeInTheDocument();
    chooseBassBoost();
    fireEvent.click(screen.getByRole('button', { name: '100 Hz · 9.0 dB' }));
    fireEvent.change(screen.getByLabelText('控制点增益（dB）'), { target: { value: '12' } });
    fireEvent.click(screen.getByLabelText('Linear frequency scale'));
    fireEvent.click(screen.getByLabelText('Grid lines'));
    fireEvent.click(screen.getByRole('button', { name: 'Invert' }));
    fireEvent.click(screen.getByRole('button', { name: '添加控制点' }));
    fireEvent.change(screen.getByLabelText('控制点频率（Hz）'), { target: { value: '2000' } });
    fireEvent.change(screen.getByLabelText('控制点增益（dB）'), { target: { value: '3' } });
    expect(screen.getByLabelText('Grid lines')).not.toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: '应用' }));
    await waitFor(() => expect(mocks.filterCurve).toHaveBeenCalledTimes(1));
    const applied = mocks.filterCurve.mock.calls[0][2] as FilterCurveEqSettings;
    expect(applied.linearFrequencyScale).toBe(true);
    expect(applied.filterLength).toBe(21);
    expect(applied.points).toHaveLength(3);
    expect(applied.points).toContainEqual({ frequency: 100, gainDb: -12 });
    expect(applied.points).toContainEqual({ frequency: 2000, gainDb: 3 });
  });

  it('keeps the dialog open and records no history when the atomic service fails', async () => {
    mocks.filterCurve.mockRejectedValueOnce(new Error('injected filter failure'));
    render(<AudioEditorPage />);
    expect(await screen.findByText('Filter Curve integration')).toBeInTheDocument();
    await openDialog();
    chooseBassBoost();
    fireEvent.click(screen.getByRole('button', { name: '应用' }));
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith('应用 Filter Curve EQ 失败：injected filter failure'));
    expect(screen.getByRole('heading', { name: 'Filter Curve EQ' })).toBeInTheDocument();
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.saveProject).not.toHaveBeenCalled();
  });

  it('disables Filter Curve EQ when there is no real selection', async () => {
    mockProject.selection = null;
    render(<AudioEditorPage />);
    expect(await screen.findByText('Filter Curve integration')).toBeInTheDocument();
    fireEvent.pointerDown(screen.getByRole('button', { name: '效果' }));
    expect(await screen.findByText('Filter Curve EQ 滤波曲线均衡…')).toHaveAttribute('aria-disabled', 'true');
  });
});
