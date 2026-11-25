import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IProject } from '@/types/project';
import type { PassFilterTrackAudio } from '@/services/projectService';
import { processPassFilterChannels, type PassFilterSettings } from '@/lib/passFilterEffect';

const mocks = vi.hoisted(() => ({
  push: vi.fn(), success: vi.fn(), error: vi.fn(), info: vi.fn(), saveProject: vi.fn(),
  passFilter: vi.fn(), loadChannels: vi.fn(),
  previewBuffers: [] as { channels: number; length: number; sampleRate: number; data: Float32Array[] }[],
}));
let mockProject: IProject;
let mockRouteProjectId = 'pass-filter-project';
const clipDuration = 10 / 48000;
const settings: PassFilterSettings = { kind: 'highpass', frequencyHz: 1200, rolloff: 24 };

function makeProject(): IProject {
  const clip = (id: string) => ({
    id, audioBufferId: `buffer-${id}`, startTime: 0, offset: 0, duration: clipDuration,
    originalDuration: clipDuration, stretchRatio: 1, gain: 0, fadeIn: 0, fadeOut: 0, name: `clip-${id}`,
  });
  const track = (id: string) => ({
    id, name: `Track ${id}`, type: 'audio' as const, gain: 0, pan: 0, muted: false, solo: false,
    armed: false, color: '', clips: [clip(id)], effects: [],
  });
  return {
    id: 'pass-filter-project', name: 'High/Low Pass integration', tracks: [track('one'), track('two')],
    cursorPosition: 0, selection: { start: 0, end: clipDuration },
    viewState: { horizontalZoom: 100, verticalZoom: 1, scrollX: 0, viewMode: 'waveform' },
    updatedAt: 100, createdAt: 50, sampleRate: 48000,
    timeSignature: { numerator: 4, denominator: 4 }, tempo: 120,
  };
}

vi.mock('@/services/projectService', () => ({
  projectService: {
    getProject: vi.fn(async () => mockProject), openProject: vi.fn(async () => mockProject),
    saveProject: mocks.saveProject, loadAudioChannels: mocks.loadChannels,
    loadAudioBuffer: vi.fn(async () => new Float32Array(10)),
    passFilterSelectionOnTracks: mocks.passFilter,
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
    setCursorChangeCallback: vi.fn(), setStateChangeCallback: vi.fn(), setPlaybackCompleteCallback: vi.fn(),
    setTracksEndCallback: vi.fn(),
    processClipChannels: vi.fn((_clip: unknown, source: Float32Array[]) => source.map((channel) => new Float32Array(channel))),
  },
}));
vi.mock('@/wasm/processor', () => ({ isWasmAvailable: vi.fn(() => false), wasmProcessor: {} }));
vi.mock('react-router-dom', () => ({
  useParams: () => ({ projectId: mockRouteProjectId }), useNavigate: () => vi.fn(),
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
      buffer: null, onended: null, connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(),
    };
  }
}

import AudioEditorPage from './AudioEditorPage';

async function openPassFilterDialog(kind: 'highpass' | 'lowpass' = 'highpass') {
  fireEvent.pointerDown(screen.getByRole('button', { name: '效果' }));
  fireEvent.click(await screen.findByText(kind === 'highpass' ? 'High-pass filter 高通滤波…' : 'Low-pass filter 低通滤波…'));
  expect(await screen.findByRole('heading', { name: kind === 'highpass' ? 'High-pass filter' : 'Low-pass filter' })).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Frequency (Hz)'), { target: { value: String(settings.frequencyHz) } });
  fireEvent.click(screen.getByLabelText('Roll-off (dB per octave)'));
  fireEvent.click(await screen.findByRole('option', { name: '24 dB' }));
}

async function verifyLatePassFilterResultIsIgnored(kind: 'highpass' | 'lowpass') {
  const title = kind === 'highpass' ? 'High-pass filter' : 'Low-pass filter';
  let release!: (changed: number) => void;
  const oldApply = new Promise<number>((resolve) => { release = resolve; });
  mocks.passFilter.mockReturnValueOnce(oldApply);
  const { rerender } = render(<AudioEditorPage />);
  expect(await screen.findByText('High/Low Pass integration')).toBeInTheDocument();
  await openPassFilterDialog(kind);
  fireEvent.click(screen.getByRole('button', { name: '应用' }));
  await waitFor(() => expect(mocks.passFilter).toHaveBeenCalledTimes(1));

  const replacement = {
    ...structuredClone(makeProject()),
    id: 'replacement-pass-filter-project',
    name: 'Replacement pass filter project',
  };
  mockProject = replacement;
  mockRouteProjectId = replacement.id;
  rerender(<AudioEditorPage key={replacement.id} />);
  expect(await screen.findByText(replacement.name)).toBeInTheDocument();
  mocks.push.mockClear();
  mocks.success.mockClear();
  mocks.error.mockClear();

  release(2);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(mocks.push).not.toHaveBeenCalled();
  await waitFor(() => expect(mocks.info).toHaveBeenCalledWith(`已切换工程，忽略过期的 ${title} 结果`));
  expect(mocks.success).not.toHaveBeenCalled();
  expect(mocks.error).not.toHaveBeenCalled();
  expect(screen.queryByRole('heading', { name: title })).not.toBeInTheDocument();
  expect(screen.getByText(replacement.name)).toBeInTheDocument();
}

describe('AudioEditorPage High/Low Pass effects', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.previewBuffers.length = 0;
    mockProject = makeProject();
    mockRouteProjectId = 'pass-filter-project';
    vi.stubGlobal('AudioContext', MockAudioContext);
    Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
    mocks.loadChannels.mockImplementation(async (id: string) => {
      if (id === 'buffer-one') {
        return [Float32Array.from({ length: 10 }, (_, index) => index / 10), new Float32Array(10).fill(0.2)];
      }
      return [new Float32Array(10).fill(0.4)];
    });
    mocks.saveProject.mockImplementation(async (project: IProject) => { mockProject = project; });
    mocks.passFilter.mockImplementation(async (
      _id: string,
      _selection: { start: number; end: number },
      _settings: PassFilterSettings,
      targets: PassFilterTrackAudio[],
    ) => {
      mockProject = structuredClone(mockProject);
      mockProject.tracks.forEach((track) => { track.clips[0].audioBufferId = `pass-filter-${track.id}`; });
      return targets.reduce((total, target) => total + target.clips.length, 0);
    });
    mocks.push.mockImplementation(() => undefined);
  });

  it('previews exact stereo PCM without writes, then applies both tracks with one undo', async () => {
    render(<AudioEditorPage />);
    expect(await screen.findByText('High/Low Pass integration')).toBeInTheDocument();
    await openPassFilterDialog();
    fireEvent.click(screen.getByRole('button', { name: '试听' }));
    await waitFor(() => expect(mocks.previewBuffers).toHaveLength(1));
    const preview = mocks.previewBuffers[0];
    expect(preview).toMatchObject({ channels: 2, length: 10, sampleRate: 48000 });
    const expected = processPassFilterChannels([
      Float32Array.from({ length: 10 }, (_, index) => index / 10), new Float32Array(10).fill(0.2),
    ], settings, 48000);
    expect(preview.data[0]).toEqual(expected[0]);
    expect(preview.data[1]).toEqual(expected[1]);
    expect(mocks.passFilter).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.saveProject).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '应用' }));
    await waitFor(() => expect(mocks.success).toHaveBeenCalledWith('已对 2 个片段应用 High-pass filter'));
    expect(mocks.passFilter).toHaveBeenCalledTimes(1);
    const [, selection, appliedSettings, targets] = mocks.passFilter.mock.calls[0];
    expect(selection).toEqual({ start: 0, end: clipDuration });
    expect(appliedSettings).toEqual(settings);
    expect(targets).toHaveLength(2);
    expect(targets[0].clips[0].sampleData).toHaveLength(2);
    expect(mocks.push).toHaveBeenCalledTimes(1);
    expect(mocks.push.mock.calls[0][0].label).toBe('High-pass filter');
    expect(mocks.push.mock.calls[0][1].selection).toEqual({ start: 0, end: clipDuration });
    const restored = mocks.push.mock.calls[0][0].undo() as IProject;
    expect(restored.tracks[0].clips[0].audioBufferId).toBe('buffer-one');
    expect(mocks.saveProject).not.toHaveBeenCalled();
  });

  it('opens the independent Low-pass dialog with official defaults', async () => {
    render(<AudioEditorPage />);
    expect(await screen.findByText('High/Low Pass integration')).toBeInTheDocument();
    fireEvent.pointerDown(screen.getByRole('button', { name: '效果' }));
    fireEvent.click(await screen.findByText('Low-pass filter 低通滤波…'));
    expect(await screen.findByRole('heading', { name: 'Low-pass filter' })).toBeInTheDocument();
    expect(screen.getByLabelText('Frequency (Hz)')).toHaveValue(1000);
    expect(screen.getByLabelText('Roll-off (dB per octave)')).toHaveTextContent('6 dB');
  });

  it('keeps the dialog open and records no history when the atomic service fails', async () => {
    mocks.passFilter.mockRejectedValueOnce(new Error('injected pass filter failure'));
    render(<AudioEditorPage />);
    expect(await screen.findByText('High/Low Pass integration')).toBeInTheDocument();
    await openPassFilterDialog();
    fireEvent.click(screen.getByRole('button', { name: '应用' }));
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith('应用 High-pass filter 失败：injected pass filter failure'));
    expect(screen.getByRole('heading', { name: 'High-pass filter' })).toBeInTheDocument();
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.saveProject).not.toHaveBeenCalled();
  });

  it('disables both effects when there is no real selection', async () => {
    mockProject.selection = null;
    render(<AudioEditorPage />);
    expect(await screen.findByText('High/Low Pass integration')).toBeInTheDocument();
    fireEvent.pointerDown(screen.getByRole('button', { name: '效果' }));
    expect(await screen.findByText('High-pass filter 高通滤波…')).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText('Low-pass filter 低通滤波…')).toHaveAttribute('aria-disabled', 'true');
  });

  it('ignores a late High-pass result after switching projects', async () => {
    await verifyLatePassFilterResultIsIgnored('highpass');
  });

  it('ignores a late Low-pass result after switching projects', async () => {
    await verifyLatePassFilterResultIsIgnored('lowpass');
  });
});
