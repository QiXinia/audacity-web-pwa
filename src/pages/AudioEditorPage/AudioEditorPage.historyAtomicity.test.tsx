// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import type { IProject } from '@/types/project';

const mocks = vi.hoisted(() => ({
  saveProject: vi.fn(),
  undo: vi.fn(),
  redo: vi.fn(),
  flush: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}));

let mockProject: IProject;

function makeProject(trackName: string): IProject {
  return {
    id: 'history-atomicity-page',
    name: 'History atomicity integration',
    tracks: [{
      id: 'track-a', name: trackName, type: 'audio', gain: 0, pan: 0,
      muted: false, solo: false, armed: false, color: '', clips: [], effects: [],
    }],
    cursorPosition: 0,
    selection: null,
    viewState: { horizontalZoom: 100, verticalZoom: 1, scrollX: 0, viewMode: 'waveform' },
    updatedAt: 100,
    createdAt: 50,
    sampleRate: 44100,
    timeSignature: { numerator: 4, denominator: 4 },
    tempo: 120,
  };
}

vi.mock('@/services/projectService', () => ({
  projectService: {
    getProject: vi.fn(async () => mockProject),
    openProject: vi.fn(async () => mockProject),
    saveProject: mocks.saveProject,
    loadAudioChannels: vi.fn(async () => [new Float32Array(0)]),
    loadAudioBuffer: vi.fn(async () => new Float32Array(0)),
  },
}));
vi.mock('@/services/historyService', () => ({
  historyManager: {
    push: vi.fn(), pushCommand: vi.fn(), canUndo: vi.fn(() => true), canRedo: vi.fn(() => true),
    loadForProject: vi.fn(async () => 0), flush: mocks.flush,
    undo: mocks.undo, redo: mocks.redo,
    getUndoLabel: vi.fn(() => 'Edit'), getRedoLabel: vi.fn(() => 'Edit'),
    getHistoryState: vi.fn(() => ({ canUndo: true, canRedo: true, undoLabel: 'Edit', redoLabel: 'Edit' })),
  },
}));
vi.mock('@/db/audioDb', () => ({
  audioDb: { audioBuffers: { get: vi.fn() }, clipboard: {}, historySnapshots: {} },
  serializeTracks: (tracks: unknown) => JSON.stringify(tracks),
  deserializeTracks: (data: string) => JSON.parse(data),
  serializeSelection: vi.fn(), deserializeSelection: vi.fn(),
}));
vi.mock('@/engine/audioEngine', () => ({
  audioEngine: {
    subscribe: vi.fn(() => () => {}), getPlaybackState: vi.fn(() => 'stopped'),
    getRecordingState: vi.fn(() => 'inactive'), getCurrentTime: vi.fn(() => 0),
    playTracks: vi.fn(), stopPlayback: vi.fn(), pausePlayback: vi.fn(), resumePlayback: vi.fn(),
    seek: vi.fn(), startRecording: vi.fn(), stopRecording: vi.fn(), cancelRecording: vi.fn(),
    initialize: vi.fn(), getLevel: vi.fn(() => 0), cacheBuffer: vi.fn(), evictBuffer: vi.fn(),
    getPlaybackLevels: vi.fn(() => ({ left: -Infinity, right: -Infinity })),
    getRecordingLevels: vi.fn(() => ({ left: -Infinity, right: -Infinity })),
    setCursorChangeCallback: vi.fn(), setStateChangeCallback: vi.fn(),
    setPlaybackCompleteCallback: vi.fn(), setTracksEndCallback: vi.fn(),
    processClipChannels: vi.fn((_clip: unknown, source: Float32Array[]) => source),
  },
}));
vi.mock('@/wasm/processor', () => ({ isWasmAvailable: vi.fn(() => false), wasmProcessor: {} }));
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), warning: vi.fn(), error: mocks.error, info: mocks.info },
}));
vi.mock('@/utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), log: vi.fn() } }));

import AudioEditorPage from './AudioEditorPage';

function ProjectNavigation() {
  const navigate = useNavigate();
  return <button type="button" onClick={() => navigate('/editor/other-project')}>Open other project</button>;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

function renderEditor() {
  return render(
    <MemoryRouter initialEntries={['/editor/history-atomicity-page']}>
      <ProjectNavigation />
      <Routes>
        <Route path="/editor/:projectId" element={<AudioEditorPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

function mockTransition(mock: typeof mocks.undo, restoredProject: IProject, label: string) {
  mock.mockImplementation((_project: IProject, commit?: (project: IProject) => Promise<boolean | void>) => {
    const result = { project: restoredProject, command: { label } };
    if (!commit) return result;
    return Promise.resolve(commit(restoredProject)).then((saved) => {
      if (saved === false) throw new Error('历史恢复保存失败');
      return result;
    });
  });
}

describe('AudioEditorPage undo/redo save atomicity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProject = makeProject('After edit');
    mocks.saveProject.mockRejectedValue(new Error('IndexedDB write failed'));
    mocks.flush.mockResolvedValue(undefined);
  });

  afterEach(() => cleanup());

  it('does not render an undone snapshot or show success when its save rejects', async () => {
    mockTransition(mocks.undo, makeProject('Before edit'), 'Rename track');
    renderEditor();
    expect(await screen.findByText('After edit')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '撤销' }));

    await waitFor(() => expect(mocks.saveProject).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith('撤销失败，工程和历史未更改'));
    expect(screen.getByText('After edit')).toBeInTheDocument();
    expect(screen.queryByText('Before edit')).not.toBeInTheDocument();
    expect(mocks.info).not.toHaveBeenCalled();
  });

  it('does not render a redone snapshot or show success when its save rejects', async () => {
    mockProject = makeProject('Before edit');
    mockTransition(mocks.redo, makeProject('After edit'), 'Rename track');
    renderEditor();
    expect(await screen.findByText('Before edit')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '重做' }));

    await waitFor(() => expect(mocks.saveProject).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith('重做失败，工程和历史未更改'));
    expect(screen.getByText('Before edit')).toBeInTheDocument();
    expect(screen.queryByText('After edit')).not.toBeInTheDocument();
    expect(mocks.info).not.toHaveBeenCalled();
  });

  it.each([
    ['undo', '撤销'] as const,
    ['redo', '重做'] as const,
  ])('does not apply a late %s result after switching projects during history flush', async (operation, label) => {
    const before = makeProject('Old history result');
    mockTransition(mocks[operation], before, 'Rename track');
    mocks.saveProject.mockResolvedValue(true);
    const flushing = deferred<void>();
    mocks.flush.mockReturnValue(flushing.promise);
    renderEditor();
    expect(await screen.findByText('After edit')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: label }));
    await waitFor(() => expect(mocks.saveProject).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mocks.flush).toHaveBeenCalledTimes(1));

    mockProject = { ...makeProject('Other project'), id: 'other-project' };
    fireEvent.click(screen.getByRole('button', { name: 'Open other project' }));
    expect(await screen.findByText('Other project')).toBeInTheDocument();

    await act(async () => {
      flushing.resolve();
      await flushing.promise;
    });

    expect(screen.getByText('Other project')).toBeInTheDocument();
    expect(screen.queryByText('Old history result')).not.toBeInTheDocument();
    expect(mocks.info).not.toHaveBeenCalledWith(`${label}：Rename track`);
  });
});
