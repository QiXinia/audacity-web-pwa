import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IProject } from '@/types/project';
import type { GraphicEqTrackAudio } from '@/services/projectService';
import {
  GRAPHIC_EQ_BAND_COUNT,
  processGraphicEqChannels,
  type GraphicEqSettings,
} from '@/lib/graphicEqEffect';

const mocks = vi.hoisted(() => ({
  push: vi.fn(), success: vi.fn(), error: vi.fn(), info: vi.fn(), saveProject: vi.fn(),
  graphicEq: vi.fn(), loadChannels: vi.fn(),
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
    id: 'graphic-eq-project', name: 'Graphic EQ integration', tracks: [track('one'), track('two')],
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
    graphicEqSelectionOnTracks: mocks.graphicEq,
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
vi.mock('react-router-dom', () => ({ useParams: () => ({ projectId: 'graphic-eq-project' }), useNavigate: () => vi.fn() }));
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
  fireEvent.click(await screen.findByText('Graphic EQ 图示均衡…'));
  return screen.findByRole('heading', { name: 'Graphic EQ' });
}

function setBand(frequency: number, value: string) {
  fireEvent.change(screen.getByLabelText(`${frequency} Hz Graphic EQ 增益（dB）`), { target: { value } });
}

const expectedSettings = (): GraphicEqSettings => {
  const gainsDb = Array(GRAPHIC_EQ_BAND_COUNT).fill(0) as number[];
  gainsDb[7] = 6; gainsDb[17] = -3;
  return { gainsDb };
};

describe('AudioEditorPage Graphic EQ', () => {
  beforeEach(() => {
    vi.clearAllMocks(); mocks.previewBuffers.length = 0; mockProject = makeProject();
    vi.stubGlobal('AudioContext', MockAudioContext);
    mocks.loadChannels.mockImplementation(async (id: string) => (
      id === 'buffer-one'
        ? [noise(0x12345678, 0.16), noise(0x87654321, 0.08)]
        : [noise(0x10203040, 0.12)]
    ));
    mocks.saveProject.mockImplementation(async (project: IProject) => { mockProject = project; });
    mocks.graphicEq.mockImplementation(async (
      _id: string, _selection: { start: number; end: number }, _settings: GraphicEqSettings,
      targets: GraphicEqTrackAudio[],
    ) => {
      if (_settings.gainsDb.every((gain) => gain === 0)) return 0;
      mockProject = structuredClone(mockProject);
      mockProject.tracks.forEach((track) => { track.clips[0].audioBufferId = `graphic-eq-${track.id}`; });
      return targets.reduce((total, target) => total + target.clips.length, 0);
    });
    mocks.push.mockImplementation(() => undefined);
  });

  it('renders 31 faders, previews exact FIR PCM, then applies both tracks with one undo', async () => {
    render(<AudioEditorPage />);
    expect(await screen.findByText('Graphic EQ integration')).toBeInTheDocument();
    await openDialog();
    expect(screen.getAllByRole('slider')).toHaveLength(31);
    expect(screen.getByText(/8191 taps/)).toBeInTheDocument();
    setBand(100, '6'); setBand(1000, '-3');
    fireEvent.click(screen.getByRole('button', { name: '试听' }));
    await waitFor(() => expect(mocks.previewBuffers).toHaveLength(1));
    const preview = mocks.previewBuffers[0];
    const source = [noise(0x12345678, 0.16), noise(0x87654321, 0.08)];
    expect(preview).toMatchObject({ channels: 2, length: 16_000, sampleRate: 8000 });
    expect(preview.data).toEqual(processGraphicEqChannels(source, expectedSettings(), 8000));
    expect(mocks.graphicEq).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.saveProject).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '停止试听' }));
    fireEvent.click(screen.getByRole('button', { name: '应用' }));
    await waitFor(() => expect(mocks.success).toHaveBeenCalledWith('已对 2 个片段应用 Graphic EQ'));
    expect(mocks.graphicEq).toHaveBeenCalledTimes(1);
    const [, selection, appliedSettings, targets] = mocks.graphicEq.mock.calls[0];
    expect(selection).toEqual({ start: 0, end: 2 });
    expect(appliedSettings).toEqual(expectedSettings());
    expect(targets).toHaveLength(2);
    expect(mocks.push).toHaveBeenCalledTimes(1);
    expect(mocks.push.mock.calls[0][0].label).toBe('Graphic EQ 图示均衡');
    const restored = mocks.push.mock.calls[0][0].undo() as IProject;
    expect(restored.tracks[0].clips[0].audioBufferId).toBe('buffer-one');
  });

  it('supports Invert, double-click zeroing and Reset without hard-coded presets', async () => {
    render(<AudioEditorPage />);
    expect(await screen.findByText('Graphic EQ integration')).toBeInTheDocument();
    await openDialog();
    setBand(100, '6'); setBand(1000, '-3');
    fireEvent.click(screen.getByRole('button', { name: 'Invert' }));
    expect(screen.getByLabelText('100 Hz Graphic EQ 增益（dB）')).toHaveValue('-6');
    expect(screen.getByLabelText('1000 Hz Graphic EQ 增益（dB）')).toHaveValue('3');
    fireEvent.doubleClick(screen.getByLabelText('100 Hz Graphic EQ 增益（dB）'));
    expect(screen.getByLabelText('100 Hz Graphic EQ 增益（dB）')).toHaveValue('0');
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(screen.getByLabelText('1000 Hz Graphic EQ 增益（dB）')).toHaveValue('0');
    setBand(2000, '4');
    fireEvent.click(screen.getByRole('button', { name: '应用' }));
    await waitFor(() => expect(mocks.graphicEq).toHaveBeenCalledTimes(1));
    const applied = mocks.graphicEq.mock.calls[0][2] as GraphicEqSettings;
    expect(applied.gainsDb).toHaveLength(31);
    expect(applied.gainsDb[20]).toBe(4);
    expect(applied.gainsDb.filter((gain) => gain !== 0)).toEqual([4]);
  });

  it('keeps the dialog open and records no history when the atomic service fails', async () => {
    mocks.graphicEq.mockRejectedValueOnce(new Error('injected graphic failure'));
    render(<AudioEditorPage />);
    expect(await screen.findByText('Graphic EQ integration')).toBeInTheDocument();
    await openDialog();
    setBand(1000, '6');
    fireEvent.click(screen.getByRole('button', { name: '应用' }));
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith('应用 Graphic EQ 失败：injected graphic failure'));
    expect(screen.getByRole('heading', { name: 'Graphic EQ' })).toBeInTheDocument();
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.saveProject).not.toHaveBeenCalled();
  });

  it('treats flat apply as a no-op and disables the menu without a real selection', async () => {
    const { unmount } = render(<AudioEditorPage />);
    expect(await screen.findByText('Graphic EQ integration')).toBeInTheDocument();
    await openDialog();
    fireEvent.click(screen.getByRole('button', { name: '应用' }));
    await waitFor(() => expect(mocks.info).toHaveBeenCalledWith('Graphic EQ 各频段为平直，未修改音频'));
    expect(mocks.graphicEq).toHaveBeenCalledTimes(1);
    expect(mocks.graphicEq.mock.calls[0][2].gainsDb.every((gain: number) => gain === 0)).toBe(true);
    expect(mocks.push).not.toHaveBeenCalled();
    unmount();
    mockProject.selection = null;
    render(<AudioEditorPage />);
    expect(await screen.findByText('Graphic EQ integration')).toBeInTheDocument();
    fireEvent.pointerDown(screen.getByRole('button', { name: '效果' }));
    expect(await screen.findByText('Graphic EQ 图示均衡…')).toHaveAttribute('aria-disabled', 'true');
  });
});
