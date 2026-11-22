import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { RenderResult } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IProject, ITrack } from '@/types/project';

const OLD_PROJECT_ID = 'track-isolation-old-project';
const NEXT_PROJECT_ID = 'track-isolation-next-project';

const mocks = vi.hoisted(() => ({
  projectId: 'track-isolation-old-project',
  getProject: vi.fn(),
  openProject: vi.fn(),
  addTrack: vi.fn(),
  removeTrack: vi.fn(),
  duplicateTrack: vi.fn(),
  push: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
  navigate: vi.fn(),
}));

let projects: Record<string, IProject>;

function makeTrack(id: string, name: string): ITrack {
  return {
    id, name, type: 'audio', gain: 0, pan: 0,
    muted: false, solo: false, armed: false, color: '', clips: [], effects: [],
  };
}

function makeProject(id: string, name: string, trackId: string, trackName: string): IProject {
  return {
    id,
    name,
    tracks: [makeTrack(trackId, trackName)],
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

vi.mock('@/services/projectService', () => ({
  projectService: {
    getProject: mocks.getProject,
    openProject: mocks.openProject,
    addTrack: mocks.addTrack,
    removeTrack: mocks.removeTrack,
    duplicateTrack: mocks.duplicateTrack,
    loadAudioChannels: vi.fn(async () => [new Float32Array(0)]),
    loadAudioBuffer: vi.fn(async () => new Float32Array(0)),
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
  audioDb: { audioBuffers: { get: vi.fn() }, clipboard: {}, historySnapshots: {} },
  serializeTracks: (tracks: unknown) => JSON.stringify(tracks),
  deserializeTracks: (data: string) => JSON.parse(data),
  serializeSelection: vi.fn(),
  deserializeSelection: vi.fn(),
}));
vi.mock('@/engine/audioEngine', () => ({
  audioEngine: {
    subscribe: vi.fn(() => () => {}),
    getPlaybackState: vi.fn(() => 'stopped'),
    getRecordingState: vi.fn(() => 'inactive'),
    getCurrentTime: vi.fn(() => 0),
    playTracks: vi.fn(),
    stopPlayback: vi.fn(),
    pausePlayback: vi.fn(),
    resumePlayback: vi.fn(),
    seek: vi.fn(),
    startRecording: vi.fn(),
    stopRecording: vi.fn(),
    cancelRecording: vi.fn(),
    initialize: vi.fn(),
    getLevel: vi.fn(() => 0),
    cacheBuffer: vi.fn(),
    evictBuffer: vi.fn(),
    getPlaybackLevels: vi.fn(() => ({ left: -Infinity, right: -Infinity })),
    getRecordingLevels: vi.fn(() => ({ left: -Infinity, right: -Infinity })),
    setCursorChangeCallback: vi.fn(),
    setStateChangeCallback: vi.fn(),
    setPlaybackCompleteCallback: vi.fn(),
    setTracksEndCallback: vi.fn(),
    processClipChannels: vi.fn((_clip: unknown, source: Float32Array[]) => source),
  },
}));
vi.mock('@/wasm/processor', () => ({ isWasmAvailable: vi.fn(() => false), wasmProcessor: {} }));
vi.mock('react-router-dom', () => ({
  useParams: () => ({ projectId: mocks.projectId }),
  useNavigate: () => mocks.navigate,
}));
vi.mock('sonner', () => ({
  toast: {
    success: mocks.success,
    error: mocks.error,
    warning: mocks.warning,
    info: mocks.info,
  },
}));
vi.mock('@/utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), log: vi.fn() },
}));

import AudioEditorPage from './AudioEditorPage';

async function renderOldProject(): Promise<RenderResult> {
  const view = render(<AudioEditorPage />);
  expect(await screen.findByText('Old project')).toBeInTheDocument();
  expect(await screen.findByTestId('track-panel-row-old-track')).toBeInTheDocument();
  return view;
}

async function switchToNextProject(rerender: RenderResult['rerender']): Promise<void> {
  mocks.projectId = NEXT_PROJECT_ID;
  rerender(<AudioEditorPage />);
  expect(await screen.findByText('Next project')).toBeInTheDocument();
  expect(await screen.findByTestId('track-panel-row-next-track')).toBeInTheDocument();
  mocks.push.mockClear();
  mocks.success.mockClear();
  mocks.error.mockClear();
}

async function settleDeferred(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
}

describe('AudioEditorPage track mutation project isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.projectId = OLD_PROJECT_ID;
    projects = {
      [OLD_PROJECT_ID]: makeProject(OLD_PROJECT_ID, 'Old project', 'old-track', 'Old Alpha'),
      [NEXT_PROJECT_ID]: makeProject(NEXT_PROJECT_ID, 'Next project', 'next-track', 'Next Alpha'),
    };
    mocks.getProject.mockImplementation(async (projectId: string) => projects[projectId] ?? null);
    mocks.openProject.mockImplementation(async (projectId: string) => projects[projectId] ?? null);
  });

  afterEach(() => cleanup());

  it('discards a late track addition after projectId changes', async () => {
    const pending = deferred<ITrack | null>();
    mocks.addTrack.mockReturnValue(pending.promise);
    const { rerender } = await renderOldProject();

    fireEvent.click(screen.getByRole('button', { name: '添加轨道' }));
    await waitFor(() => expect(mocks.addTrack).toHaveBeenCalledWith(OLD_PROJECT_ID));
    await switchToNextProject(rerender);

    const added = makeTrack('added-track', 'Late addition');
    projects[OLD_PROJECT_ID] = {
      ...projects[OLD_PROJECT_ID]!,
      tracks: [...projects[OLD_PROJECT_ID]!.tracks, added],
    };
    await act(async () => {
      pending.resolve(added);
      await pending.promise;
      await settleDeferred();
    });

    expect(screen.getByText('Next project')).toBeInTheDocument();
    expect(screen.getByTestId('track-panel-row-next-track')).toBeInTheDocument();
    expect(screen.queryByText('Old project')).not.toBeInTheDocument();
    expect(screen.queryByTestId('track-panel-row-added-track')).not.toBeInTheDocument();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('discards a late track deletion after projectId changes', async () => {
    const pending = deferred<void>();
    mocks.removeTrack.mockReturnValue(pending.promise);
    const { rerender } = await renderOldProject();

    fireEvent.contextMenu(screen.getByTestId('track-panel-row-old-track'));
    fireEvent.click(await screen.findByTestId('track-delete-menu'));
    await waitFor(() => expect(mocks.removeTrack).toHaveBeenCalledWith(OLD_PROJECT_ID, 'old-track'));
    await switchToNextProject(rerender);

    projects[OLD_PROJECT_ID] = { ...projects[OLD_PROJECT_ID]!, tracks: [] };
    await act(async () => {
      pending.resolve();
      await pending.promise;
      await settleDeferred();
    });

    expect(screen.getByText('Next project')).toBeInTheDocument();
    expect(screen.getByTestId('track-panel-row-next-track')).toBeInTheDocument();
    expect(screen.queryByText('Old project')).not.toBeInTheDocument();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('discards a late track duplication and its success toast after projectId changes', async () => {
    const pending = deferred<ITrack | null>();
    mocks.duplicateTrack.mockReturnValue(pending.promise);
    const { rerender } = await renderOldProject();

    fireEvent.contextMenu(screen.getByTestId('track-panel-row-old-track'));
    fireEvent.click(await screen.findByTestId('track-duplicate-menu'));
    await waitFor(() => expect(mocks.duplicateTrack).toHaveBeenCalledWith(OLD_PROJECT_ID, 'old-track'));
    await switchToNextProject(rerender);

    const copy = makeTrack('old-track-copy', 'Old Alpha copy');
    projects[OLD_PROJECT_ID] = {
      ...projects[OLD_PROJECT_ID]!,
      tracks: [...projects[OLD_PROJECT_ID]!.tracks, copy],
    };
    await act(async () => {
      pending.resolve(copy);
      await pending.promise;
      await settleDeferred();
    });

    expect(screen.getByText('Next project')).toBeInTheDocument();
    expect(screen.getByTestId('track-panel-row-next-track')).toBeInTheDocument();
    expect(screen.queryByText('Old project')).not.toBeInTheDocument();
    expect(screen.queryByTestId('track-panel-row-old-track-copy')).not.toBeInTheDocument();
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.success).not.toHaveBeenCalled();

    fireEvent.contextMenu(screen.getByTestId('track-panel-row-next-track'));
    await waitFor(() => expect(screen.getByTestId('track-duplicate-menu')).not.toHaveAttribute('aria-disabled', 'true'));
  });

  it('discards a late project reload after duplication when projectId changes', async () => {
    const copy = makeTrack('old-track-copy', 'Old Alpha copy');
    mocks.duplicateTrack.mockResolvedValue(copy);
    const pendingReload = deferred<IProject | null>();
    mocks.getProject.mockImplementation(async (projectId: string) => {
      if (projectId === OLD_PROJECT_ID) return pendingReload.promise;
      return projects[projectId] ?? null;
    });
    const { rerender } = await renderOldProject();

    fireEvent.contextMenu(screen.getByTestId('track-panel-row-old-track'));
    fireEvent.click(await screen.findByTestId('track-duplicate-menu'));
    await waitFor(() => expect(mocks.getProject).toHaveBeenCalledWith(OLD_PROJECT_ID));
    await switchToNextProject(rerender);

    const oldWithCopy = {
      ...projects[OLD_PROJECT_ID]!,
      tracks: [...projects[OLD_PROJECT_ID]!.tracks, copy],
    };
    projects[OLD_PROJECT_ID] = oldWithCopy;
    await act(async () => {
      pendingReload.resolve(oldWithCopy);
      await pendingReload.promise;
      await settleDeferred();
    });

    expect(screen.getByText('Next project')).toBeInTheDocument();
    expect(screen.getByTestId('track-panel-row-next-track')).toBeInTheDocument();
    expect(screen.queryByText('Old project')).not.toBeInTheDocument();
    expect(screen.queryByTestId('track-panel-row-old-track-copy')).not.toBeInTheDocument();
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.success).not.toHaveBeenCalled();

    fireEvent.contextMenu(screen.getByTestId('track-panel-row-next-track'));
    await waitFor(() => expect(screen.getByTestId('track-duplicate-menu')).not.toHaveAttribute('aria-disabled', 'true'));
  });

  it('suppresses a late track addition failure after projectId changes', async () => {
    const pending = deferred<ITrack | null>();
    mocks.addTrack.mockReturnValue(pending.promise);
    const { rerender } = await renderOldProject();

    fireEvent.click(screen.getByRole('button', { name: '添加轨道' }));
    await waitFor(() => expect(mocks.addTrack).toHaveBeenCalledWith(OLD_PROJECT_ID));
    await switchToNextProject(rerender);

    await act(async () => {
      pending.reject(new Error('late old failure'));
      await settleDeferred();
    });

    expect(screen.getByText('Next project')).toBeInTheDocument();
    expect(screen.getByTestId('track-panel-row-next-track')).toBeInTheDocument();
    expect(mocks.error).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
  });
});
