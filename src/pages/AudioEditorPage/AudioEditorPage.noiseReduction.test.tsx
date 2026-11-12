import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IProject } from '@/types/project';
import type { NoiseReductionTrackAudio } from '@/services/projectService';
import {
  learnNoiseProfile,
  processNoiseReductionChannels,
  type NoiseReductionSettings,
} from '@/lib/noiseReductionEffect';

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  saveProject: vi.fn(),
  learn: vi.fn(),
  apply: vi.fn(),
  loadChannels: vi.fn(),
  previewBuffers: [] as { channels: number; length: number; sampleRate: number; data: Float32Array[] }[],
}));
let mockProject: IProject;

function noise(): Float32Array {
  let state = 0x12345678;
  const result = new Float32Array(4096);
  for (let index = 0; index < result.length; index += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    result[index] = Math.fround((state / 0x100000000 - 0.5) * 0.06);
  }
  return result;
}

function makeProject(): IProject {
  const clip = (id: string) => ({
    id,
    audioBufferId: `buffer-${id}`,
    startTime: 0,
    offset: 0,
    duration: 4.096,
    originalDuration: 4.096,
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
    id: 'noise-reduction-project',
    name: 'Noise Reduction integration',
    tracks: [track('one'), track('two')],
    cursorPosition: 0,
    selection: { start: 0, end: 4.096 },
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
    loadAudioBuffer: vi.fn(async () => new Float32Array(4096)),
    learnNoiseReductionProfile: mocks.learn,
    noiseReductionSelectionOnTracks: mocks.apply,
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
  useParams: () => ({ projectId: 'noise-reduction-project' }),
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
    return { buffer: null, onended: null, connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn() };
  }
}

import AudioEditorPage from './AudioEditorPage';

async function openDialog() {
  fireEvent.pointerDown(screen.getByRole('button', { name: '效果' }));
  fireEvent.click(await screen.findByText('Noise Reduction 降噪…'));
  return screen.findByRole('heading', { name: 'Noise Reduction 降噪' });
}

describe('AudioEditorPage Noise Reduction effect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.previewBuffers.length = 0;
    mockProject = makeProject();
    vi.stubGlobal('AudioContext', MockAudioContext);
    mocks.loadChannels.mockImplementation(async (id: string) => id === 'buffer-one' ? [noise(), noise()] : [noise()]);
    mocks.saveProject.mockImplementation(async (project: IProject) => { mockProject = project; });
    mocks.learn.mockImplementation(async (_id: string, _selection: unknown, targets: NoiseReductionTrackAudio[]) =>
      learnNoiseProfile(targets[0].clips[0].sampleData, 1000));
    mocks.apply.mockImplementation(async (
      _id: string,
      _selection: unknown,
      _settings: NoiseReductionSettings,
      _profile: unknown,
      targets: NoiseReductionTrackAudio[],
    ) => {
      mockProject = structuredClone(mockProject);
      mockProject.tracks.forEach((track) => { track.clips[0].audioBufferId = `noise-${track.id}`; });
      return targets.reduce((total, target) => total + target.clips.length, 0);
    });
    mocks.push.mockImplementation(() => undefined);
  });

  it('requires Step 1, then previews exact stereo PCM and applies both tracks with one undo', async () => {
    render(<AudioEditorPage />);
    expect(await screen.findByText('Noise Reduction integration')).toBeInTheDocument();
    await openDialog();
    expect(screen.getByRole('button', { name: '应用 Noise Reduction' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '试听' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Get Noise Profile' }));
    await waitFor(() => expect(mocks.learn).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByTestId('noise-reduction-dialog')).not.toBeInTheDocument());
    const profile = await mocks.learn.mock.results[0].value;

    await openDialog();
    expect(screen.getByTestId('noise-profile-status')).toHaveTextContent('1025 个频谱 bin');
    fireEvent.change(screen.getByLabelText('Noise reduction (dB)'), { target: { value: '12' } });
    fireEvent.change(screen.getByLabelText('Frequency smoothing (bands)'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: '试听' }));
    await waitFor(() => expect(mocks.previewBuffers).toHaveLength(1));
    const preview = mocks.previewBuffers[0];
    expect(preview).toMatchObject({ channels: 2, length: 4096, sampleRate: 1000 });
    const settings: NoiseReductionSettings = { noiseGain: 12, sensitivity: 6, frequencySmoothingBands: 3, mode: 'reduce' };
    const expected = processNoiseReductionChannels([noise(), noise()], profile, settings);
    expect(preview.data[0]).toEqual(expected[0]);
    expect(preview.data[1]).toEqual(expected[1]);

    fireEvent.click(screen.getByRole('button', { name: '应用 Noise Reduction' }));
    await waitFor(() => expect(mocks.success).toHaveBeenCalledWith('已对 2 个片段应用 Noise Reduction 降噪'));
    const [, selection, appliedSettings, appliedProfile, targets] = mocks.apply.mock.calls[0];
    expect(selection).toEqual({ start: 0, end: 4.096 });
    expect(appliedSettings).toEqual(settings);
    expect(appliedProfile).toBe(profile);
    expect(targets).toHaveLength(2);
    expect(mocks.push).toHaveBeenCalledTimes(1);
    expect(mocks.push.mock.calls[0][0].label).toBe('Noise Reduction 降噪');
    expect(mocks.push.mock.calls[0][0].undo().tracks[0].clips[0].audioBufferId).toBe('buffer-one');
  });

  it('keeps the dialog open and records no history when the atomic service fails', async () => {
    mocks.apply.mockRejectedValueOnce(new Error('quota exceeded'));
    render(<AudioEditorPage />);
    expect(await screen.findByText('Noise Reduction integration')).toBeInTheDocument();
    await openDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Get Noise Profile' }));
    await waitFor(() => expect(mocks.learn).toHaveBeenCalled());
    await openDialog();
    fireEvent.click(screen.getByRole('button', { name: '应用 Noise Reduction' }));
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith('应用 Noise Reduction 失败：quota exceeded'));
    expect(screen.getByRole('heading', { name: 'Noise Reduction 降噪' })).toBeInTheDocument();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('disables the menu item when there is no real selection', async () => {
    mockProject.selection = null;
    render(<AudioEditorPage />);
    expect(await screen.findByText('Noise Reduction integration')).toBeInTheDocument();
    fireEvent.pointerDown(screen.getByRole('button', { name: '效果' }));
    expect(await screen.findByText('Noise Reduction 降噪…')).toHaveAttribute('aria-disabled', 'true');
  });
});
