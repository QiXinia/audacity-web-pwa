import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IProject } from '@/types/project';
import type { AutoDuckTrackAudio } from '@/services/projectService';
import {
  DEFAULT_AUTO_DUCK_SETTINGS,
  processAutoDuckChannels,
  type AutoDuckSettings,
} from '@/lib/autoDuckEffect';

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  saveProject: vi.fn(),
  autoDuck: vi.fn(),
  loadChannels: vi.fn(),
  previewBuffers: [] as { channels: number; length: number; sampleRate: number; data: Float32Array[] }[],
}));
let mockProject: IProject;

function makeProject(trackCount = 3): IProject {
  const clip = (id: string) => ({
    id, audioBufferId: `buffer-${id}`, startTime: 0, offset: 0, duration: 0.15,
    originalDuration: 0.15, stretchRatio: 1, gain: 0, fadeIn: 0, fadeOut: 0, name: `clip-${id}`,
  });
  const track = (id: string) => ({
    id, name: `Track ${id}`, type: 'audio' as const, gain: 0, pan: 0, muted: false,
    solo: false, armed: false, color: '', clips: [clip(id)], effects: [],
  });
  const ids = trackCount === 3 ? ['one', 'two', 'control'] : ['control'];
  return {
    id: 'auto-duck-project', name: 'Auto Duck integration', tracks: ids.map(track),
    cursorPosition: 0, selection: { start: 0, end: 0.15 },
    viewState: { horizontalZoom: 100, verticalZoom: 1, scrollX: 0, viewMode: 'waveform' },
    updatedAt: 100, createdAt: 50, sampleRate: 1000,
    timeSignature: { numerator: 4, denominator: 4 }, tempo: 120,
  };
}

vi.mock('@/services/projectService', () => ({
  projectService: {
    getProject: vi.fn(async () => mockProject),
    openProject: vi.fn(async () => mockProject),
    saveProject: mocks.saveProject,
    loadAudioChannels: mocks.loadChannels,
    loadAudioBuffer: vi.fn(async () => new Float32Array(150)),
    autoDuckSelectionOnTracks: mocks.autoDuck,
  },
}));
vi.mock('@/services/historyService', () => ({
  historyManager: {
    push: mocks.push,
    pushCommand: mocks.push,
    canUndo: vi.fn(() => false), canRedo: vi.fn(() => false),
    loadForProject: vi.fn(async () => 0), flush: vi.fn(async () => undefined),
    undo: vi.fn(), redo: vi.fn(), getUndoStack: vi.fn(() => []), getRedoStack: vi.fn(() => []),
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
    subscribe: vi.fn(() => () => {}),
    getPlaybackState: vi.fn(() => 'stopped'), getRecordingState: vi.fn(() => 'inactive'),
    getCurrentTime: vi.fn(() => 0), playTracks: vi.fn(), stopPlayback: vi.fn(),
    pausePlayback: vi.fn(), resumePlayback: vi.fn(), seek: vi.fn(), startRecording: vi.fn(),
    stopRecording: vi.fn(), cancelRecording: vi.fn(), initialize: vi.fn(), getLevel: vi.fn(() => 0),
    cacheBuffer: vi.fn(), evictBuffer: vi.fn(), setCursorChangeCallback: vi.fn(),
    setStateChangeCallback: vi.fn(), setPlaybackCompleteCallback: vi.fn(), setTracksEndCallback: vi.fn(),
    processClipChannels: vi.fn((_clip: unknown, source: Float32Array[]) => source.map((channel) => new Float32Array(channel))),
  },
}));
vi.mock('@/wasm/processor', () => ({ isWasmAvailable: vi.fn(() => false), wasmProcessor: {} }));
vi.mock('react-router-dom', () => ({ useParams: () => ({ projectId: 'auto-duck-project' }), useNavigate: () => vi.fn() }));
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
    return { buffer: null, onended: null, connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn() };
  }
}

import AudioEditorPage from './AudioEditorPage';

const settings: AutoDuckSettings = {
  ...DEFAULT_AUTO_DUCK_SETTINGS,
  thresholdDb: -20,
  maximumPause: 0.03,
  outerFadeDownLen: 0.01,
  outerFadeUpLen: 0.01,
};

function controlPcm() {
  const control = new Float32Array(150);
  control.fill(1, 8, 12);
  return control;
}

async function openAutoDuckDialog() {
  fireEvent.pointerDown(screen.getByRole('button', { name: '效果' }));
  fireEvent.click(await screen.findByText('Auto Duck…'));
  return screen.findByRole('heading', { name: 'Auto Duck' });
}

async function setShortFades() {
  fireEvent.change(screen.getByLabelText('Threshold（dB）'), { target: { value: '-20' } });
  fireEvent.change(screen.getByLabelText('Maximum pause（秒）'), { target: { value: '0.03' } });
  fireEvent.change(screen.getByLabelText('Outer fade down（秒）'), { target: { value: '0.01' } });
  fireEvent.change(screen.getByLabelText('Outer fade up（秒）'), { target: { value: '0.01' } });
}

describe('AudioEditorPage Auto Duck effect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.previewBuffers.length = 0;
    mockProject = makeProject();
    vi.stubGlobal('AudioContext', MockAudioContext);
    Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
    mocks.loadChannels.mockImplementation(async (id: string) => {
      if (id === 'buffer-one') {
        return [Float32Array.from({ length: 150 }, (_, index) => index / 150), new Float32Array(150).fill(0.2)];
      }
      if (id === 'buffer-two') return [new Float32Array(150).fill(0.4)];
      return [controlPcm()];
    });
    mocks.saveProject.mockImplementation(async (project: IProject) => { mockProject = project; });
    mocks.autoDuck.mockImplementation(async (
      _id: string,
      _selection: { start: number; end: number },
      _settings: AutoDuckSettings,
      targets: AutoDuckTrackAudio[],
      controlTrackId: string,
    ) => {
      mockProject = structuredClone(mockProject);
      mockProject.tracks.forEach((track) => {
        if (track.id !== controlTrackId) track.clips[0].audioBufferId = `auto-duck-${track.id}`;
      });
      return targets.filter((target) => target.trackId !== controlTrackId)
        .reduce((total, target) => total + target.clips.length, 0);
    });
    mocks.push.mockImplementation(() => undefined);
  });

  it('previews exact stereo PCM, then applies both non-control tracks with one undo', async () => {
    render(<AudioEditorPage />);
    expect(await screen.findByText('Auto Duck integration')).toBeInTheDocument();
    await openAutoDuckDialog();
    expect(screen.getByLabelText('控制轨（使用第一声道）')).toHaveTextContent('Track control');
    await setShortFades();
    fireEvent.click(screen.getByRole('button', { name: '试听' }));
    await waitFor(() => expect(mocks.previewBuffers).toHaveLength(1));
    const preview = mocks.previewBuffers[0];
    expect(preview).toMatchObject({ channels: 2, length: 150, sampleRate: 1000 });
    const expected = processAutoDuckChannels([
      Float32Array.from({ length: 150 }, (_, index) => index / 150), new Float32Array(150).fill(0.2),
    ], controlPcm(), settings, 1000);
    expect(preview.data[0]).toEqual(expected[0]);
    expect(preview.data[1]).toEqual(expected[1]);
    expect(mocks.autoDuck).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '应用 Auto Duck' }));
    await waitFor(() => expect(mocks.success).toHaveBeenCalledWith('已对 2 个片段应用 Auto Duck，控制轨未修改'));
    expect(mocks.autoDuck).toHaveBeenCalledTimes(1);
    const [, selection, appliedSettings, targets, controlTrackId] = mocks.autoDuck.mock.calls[0];
    expect(selection).toEqual({ start: 0, end: 0.15 });
    expect(appliedSettings).toEqual(settings);
    expect(targets).toHaveLength(3);
    expect(controlTrackId).toBe('control');
    expect(mocks.push).toHaveBeenCalledTimes(1);
    expect(mocks.push.mock.calls[0][0].label).toBe('Auto Duck');
    const restored = mocks.push.mock.calls[0][0].undo() as IProject;
    expect(restored.tracks[0].clips[0].audioBufferId).toBe('buffer-one');
    expect(restored.tracks[2].clips[0].audioBufferId).toBe('buffer-control');
    expect(restored.selection).toEqual({ start: 0, end: 0.15 });
    const reapplied = mocks.push.mock.calls[0][0].execute() as IProject;
    expect(reapplied.tracks[0].clips[0].audioBufferId).toBe('auto-duck-one');
    expect(reapplied.tracks[1].clips[0].audioBufferId).toBe('auto-duck-two');
    expect(reapplied.tracks[2].clips[0].audioBufferId).toBe('buffer-control');
    expect(reapplied.selection).toEqual({ start: 0, end: 0.15 });
  });

  it('keeps the dialog open and records no history when the atomic service fails', async () => {
    mocks.autoDuck.mockRejectedValueOnce(new Error('injected auto duck failure'));
    render(<AudioEditorPage />);
    expect(await screen.findByText('Auto Duck integration')).toBeInTheDocument();
    await openAutoDuckDialog();
    fireEvent.click(screen.getByRole('button', { name: '应用 Auto Duck' }));
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith('应用 Auto Duck 失败：injected auto duck failure'));
    expect(screen.getByRole('heading', { name: 'Auto Duck' })).toBeInTheDocument();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('records no history when the control track produces no duck regions', async () => {
    mocks.autoDuck.mockResolvedValueOnce(0);
    render(<AudioEditorPage />);
    expect(await screen.findByText('Auto Duck integration')).toBeInTheDocument();
    await openAutoDuckDialog();
    fireEvent.click(screen.getByRole('button', { name: '应用 Auto Duck' }));
    await waitFor(() => expect(mocks.info).toHaveBeenCalledWith('控制轨未超过阈值，未修改任何音频'));
    expect(screen.getByRole('heading', { name: 'Auto Duck' })).toBeInTheDocument();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('requires a real selection and at least two audio tracks', async () => {
    mockProject.selection = null;
    render(<AudioEditorPage />);
    expect(await screen.findByText('Auto Duck integration')).toBeInTheDocument();
    fireEvent.pointerDown(screen.getByRole('button', { name: '效果' }));
    expect(await screen.findByText('Auto Duck…')).toHaveAttribute('aria-disabled', 'true');
  });

  it('disables Auto Duck with only a control track', async () => {
    mockProject = makeProject(1);
    render(<AudioEditorPage />);
    expect(await screen.findByText('Auto Duck integration')).toBeInTheDocument();
    fireEvent.pointerDown(screen.getByRole('button', { name: '效果' }));
    expect(await screen.findByText('Auto Duck…')).toHaveAttribute('aria-disabled', 'true');
  });
});
