import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IProject } from '@/types/project';
import type { RepairTrackAudio } from '@/services/projectService';

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  saveProject: vi.fn(),
  repair: vi.fn(),
  loadChannels: vi.fn(),
}));
let mockProject: IProject;

function makeProject(): IProject {
  const clip = (id: string, startTime = 0) => ({
    id,
    audioBufferId: `buffer-${id}`,
    startTime,
    offset: 0,
    duration: 0.04,
    originalDuration: 0.04,
    stretchRatio: 1,
    gain: 0,
    fadeIn: 0,
    fadeOut: 0,
    name: `clip-${id}`,
  });
  const track = (id: string, withContext = false) => ({
    id,
    name: `Track ${id}`,
    type: 'audio' as const,
    gain: 0,
    pan: 0,
    muted: false,
    solo: false,
    armed: false,
    color: '',
    clips: withContext ? [clip(id), clip(`${id}-context`, 0.04)] : [clip(id)],
    effects: [],
  });
  return {
    id: 'repair-project',
    name: 'Repair integration',
    tracks: [track('one', true), track('two')],
    cursorPosition: 0,
    selection: { start: 0.008, end: 0.012 },
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
    loadAudioBuffer: vi.fn(async () => new Float32Array(40)),
    repairSelectionOnTracks: mocks.repair,
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
  useParams: () => ({ projectId: 'repair-project' }),
  useNavigate: () => vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { success: mocks.success, error: mocks.error, info: mocks.info } }));
vi.mock('@/utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), log: vi.fn() } }));

import AudioEditorPage from './AudioEditorPage';

async function clickRepair() {
  fireEvent.pointerDown(screen.getByRole('button', { name: '效果' }));
  fireEvent.click(await screen.findByText('修复（Repair）'));
}

describe('AudioEditorPage Repair effect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProject = makeProject();
    mocks.loadChannels.mockImplementation(async (id: string) => {
      if (id === 'buffer-one') {
        return [
          Float32Array.from({ length: 40 }, (_, index) => Math.sin(index * 0.17)),
          Float32Array.from({ length: 40 }, (_, index) => Math.cos(index * 0.13) * 0.4),
        ];
      }
      return [Float32Array.from({ length: 40 }, (_, index) => Math.sin(index * 0.11) * 0.5)];
    });
    mocks.saveProject.mockImplementation(async (project: IProject) => { mockProject = project; });
    mocks.repair.mockImplementation(async (
      _id: string,
      _selection: { start: number; end: number },
      targets: RepairTrackAudio[],
    ) => {
      mockProject = structuredClone(mockProject);
      mockProject.tracks.forEach((track) => { track.clips[0].audioBufferId = `repair-${track.id}`; });
      return targets.length;
    });
    mocks.push.mockImplementation(() => undefined);
  });

  it('collects complete track context, applies both tracks and records one undo snapshot', async () => {
    render(<AudioEditorPage />);
    expect(await screen.findByText('Repair integration')).toBeInTheDocument();
    await clickRepair();

    await waitFor(() => expect(mocks.success).toHaveBeenCalledWith('已对 2 个片段应用 Repair 修复'));
    expect(mocks.repair).toHaveBeenCalledTimes(1);
    const [id, selection, targets] = mocks.repair.mock.calls[0];
    expect(id).toBe('repair-project');
    expect(selection).toEqual({ start: 0.008, end: 0.012 });
    expect(targets).toHaveLength(2);
    expect(targets[0].clips).toHaveLength(2);
    expect(targets[0].clips[0].sampleData).toHaveLength(2);
    expect(targets[1].clips).toHaveLength(1);
    expect(mocks.push).toHaveBeenCalledTimes(1);
    expect(mocks.push.mock.calls[0][0].label).toBe('Repair 修复');
    expect(mocks.saveProject).not.toHaveBeenCalled();
    const restored = mocks.push.mock.calls[0][0].undo() as IProject;
    expect(restored.tracks[0].clips[0].audioBufferId).toBe('buffer-one');
    expect(restored.tracks[1].clips[0].audioBufferId).toBe('buffer-two');
    expect(restored.selection).toEqual({ start: 0.008, end: 0.012 });
    const executed = mocks.push.mock.calls[0][0].execute() as IProject;
    expect(executed.tracks[0].clips[0].audioBufferId).toBe('repair-one');
  });

  it('shows the atomic service error and records no history', async () => {
    mocks.repair.mockRejectedValueOnce(new Error('injected repair failure'));
    render(<AudioEditorPage />);
    expect(await screen.findByText('Repair integration')).toBeInTheDocument();
    await clickRepair();

    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith('应用 Repair 修复失败：injected repair failure'));
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.saveProject).not.toHaveBeenCalled();
  });

  it('disables Repair when there is no real selection', async () => {
    mockProject.selection = null;
    render(<AudioEditorPage />);
    expect(await screen.findByText('Repair integration')).toBeInTheDocument();
    fireEvent.pointerDown(screen.getByRole('button', { name: '效果' }));
    expect(await screen.findByText('修复（Repair）')).toHaveAttribute('aria-disabled', 'true');
  });
});
