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
  setTracksMute: vi.fn(),
  setTracksPan: vi.fn(),
  removeTracks: vi.fn(),
  sortTracks: vi.fn(),
  moveTrack: vi.fn(),
  alignTracks: vi.fn(),
  updateTrack: vi.fn(),
  updateTrackAppearance: vi.fn(),
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
    setTracksMute: mocks.setTracksMute,
    setTracksPan: mocks.setTracksPan,
    removeTracks: mocks.removeTracks,
    sortTracks: mocks.sortTracks,
    moveTrack: mocks.moveTrack,
    alignTracks: mocks.alignTracks,
    updateTrack: mocks.updateTrack,
    updateTrackAppearance: mocks.updateTrackAppearance,
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

function mutationResult(afterTracks: ITrack[]): { before: IProject; after: IProject } {
  const before = projects[OLD_PROJECT_ID]!;
  const after = { ...before, tracks: afterTracks };
  projects[OLD_PROJECT_ID] = after;
  return { before, after };
}

function expectNextProjectIsolated(): void {
  expect(screen.getByText('Next project')).toBeInTheDocument();
  expect(screen.getByTestId('track-panel-row-next-track')).toBeInTheDocument();
  expect(screen.queryByText('Old project')).not.toBeInTheDocument();
  expect(screen.queryByTestId('track-panel-row-old-track')).not.toBeInTheDocument();
  expect(mocks.push).not.toHaveBeenCalled();
  expect(mocks.success).not.toHaveBeenCalled();
  expect(mocks.error).not.toHaveBeenCalled();
}

async function openTracksSubmenu(name: string): Promise<void> {
  fireEvent.pointerDown(screen.getByRole('button', { name: '轨道' }));
  const trigger = await screen.findByText(name);
  fireEvent.pointerMove(trigger);
  fireEvent.keyDown(trigger, { key: 'ArrowRight' });
}

async function openMoveMenu(trackId: string): Promise<void> {
  fireEvent.contextMenu(screen.getByTestId(`track-panel-row-${trackId}`));
  fireEvent.keyDown(await screen.findByTestId('track-move-submenu'), { key: 'ArrowRight' });
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

  it('discards a late track move after projectId changes', async () => {
    const oldA = projects[OLD_PROJECT_ID]!.tracks[0]!;
    const oldB = makeTrack('old-track-b', 'Old Beta');
    projects[OLD_PROJECT_ID] = { ...projects[OLD_PROJECT_ID]!, tracks: [oldA, oldB] };
    const pending = deferred<{ before: IProject; after: IProject } | null>();
    mocks.moveTrack.mockReturnValue(pending.promise);
    const { rerender } = await renderOldProject();

    await openMoveMenu('old-track');
    fireEvent.click(await screen.findByTestId('track-move-down-menu'));
    await waitFor(() => expect(mocks.moveTrack).toHaveBeenCalledWith(OLD_PROJECT_ID, 'old-track', 'down'));
    await switchToNextProject(rerender);

    const result = mutationResult([oldB, oldA]);
    await act(async () => {
      pending.resolve(result);
      await pending.promise;
      await settleDeferred();
    });
    expectNextProjectIsolated();
  });

  it('discards a late track sort after projectId changes', async () => {
    const oldA = projects[OLD_PROJECT_ID]!.tracks[0]!;
    const oldB = makeTrack('old-track-b', 'Old Beta');
    projects[OLD_PROJECT_ID] = { ...projects[OLD_PROJECT_ID]!, tracks: [oldA, oldB] };
    const pending = deferred<{ before: IProject; after: IProject } | null>();
    mocks.sortTracks.mockReturnValue(pending.promise);
    const { rerender } = await renderOldProject();

    await openTracksSubmenu('Sort Tracks 轨道排序');
    fireEvent.click(await screen.findByText('By Name 按名称'));
    await waitFor(() => expect(mocks.sortTracks).toHaveBeenCalledWith(OLD_PROJECT_ID, 'name'));
    await switchToNextProject(rerender);

    const result = mutationResult([oldB, oldA]);
    await act(async () => {
      pending.resolve(result);
      await pending.promise;
      await settleDeferred();
    });
    expectNextProjectIsolated();
  });

  it('discards a late track alignment after projectId changes', async () => {
    const pending = deferred<{ before: IProject; after: IProject } | null>();
    mocks.alignTracks.mockReturnValue(pending.promise);
    const { rerender } = await renderOldProject();

    await openTracksSubmenu('Align Tracks 对齐轨道');
    fireEvent.click(await screen.findByText('Align Together 对齐到一起'));
    await waitFor(() => expect(mocks.alignTracks).toHaveBeenCalledWith(
      OLD_PROJECT_ID, ['old-track'], 'together', expect.any(Object),
    ));
    await switchToNextProject(rerender);

    const result = mutationResult(projects[OLD_PROJECT_ID]!.tracks);
    await act(async () => {
      pending.resolve(result);
      await pending.promise;
      await settleDeferred();
    });
    expectNextProjectIsolated();
  });

  it('discards a late selected-track removal after projectId changes', async () => {
    const pending = deferred<{ before: IProject; after: IProject } | null>();
    mocks.removeTracks.mockReturnValue(pending.promise);
    const { rerender } = await renderOldProject();

    fireEvent.pointerDown(screen.getByRole('button', { name: '轨道' }));
    fireEvent.click(await screen.findByText('Remove Tracks 移除轨道'));
    await waitFor(() => expect(mocks.removeTracks).toHaveBeenCalledWith(OLD_PROJECT_ID, ['old-track']));
    await switchToNextProject(rerender);

    const result = mutationResult([]);
    await act(async () => {
      pending.resolve(result);
      await pending.promise;
      await settleDeferred();
    });
    expectNextProjectIsolated();
  });

  it('discards a late bulk mute after projectId changes', async () => {
    const pending = deferred<{ before: IProject; after: IProject } | null>();
    mocks.setTracksMute.mockReturnValue(pending.promise);
    const { rerender } = await renderOldProject();

    fireEvent.keyDown(window, { key: 'u', ctrlKey: true });
    await waitFor(() => expect(mocks.setTracksMute).toHaveBeenCalledWith(OLD_PROJECT_ID, ['old-track'], true));
    await switchToNextProject(rerender);

    const result = mutationResult([{ ...projects[OLD_PROJECT_ID]!.tracks[0]!, muted: true }]);
    await act(async () => {
      pending.resolve(result);
      await pending.promise;
      await settleDeferred();
    });
    expectNextProjectIsolated();
  });

  it('discards a late bulk pan after projectId changes', async () => {
    const pending = deferred<{ before: IProject; after: IProject } | null>();
    mocks.setTracksPan.mockReturnValue(pending.promise);
    const { rerender } = await renderOldProject();

    await openTracksSubmenu('Pan 声像');
    fireEvent.click(await screen.findByText('Left 左侧'));
    await waitFor(() => expect(mocks.setTracksPan).toHaveBeenCalledWith(OLD_PROJECT_ID, ['old-track'], -1));
    await switchToNextProject(rerender);

    const result = mutationResult([{ ...projects[OLD_PROJECT_ID]!.tracks[0]!, pan: -1 }]);
    await act(async () => {
      pending.resolve(result);
      await pending.promise;
      await settleDeferred();
    });
    expectNextProjectIsolated();
  });

  it('discards a late track rename after projectId changes', async () => {
    const pending = deferred<IProject | null>();
    mocks.updateTrack.mockReturnValue(pending.promise);
    const { rerender } = await renderOldProject();

    fireEvent.contextMenu(screen.getByTestId('track-panel-row-old-track'));
    fireEvent.click(await screen.findByTestId('track-rename-menu'));
    const input = await screen.findByLabelText('轨道名称');
    fireEvent.change(input, { target: { value: 'Late old rename' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(mocks.updateTrack).toHaveBeenCalledWith(
      OLD_PROJECT_ID, 'old-track', { name: 'Late old rename' },
    ));
    await switchToNextProject(rerender);

    const updated = {
      ...projects[OLD_PROJECT_ID]!,
      tracks: [{ ...projects[OLD_PROJECT_ID]!.tracks[0]!, name: 'Late old rename' }],
    };
    projects[OLD_PROJECT_ID] = updated;
    await act(async () => {
      pending.resolve(updated);
      await pending.promise;
      await settleDeferred();
    });
    expectNextProjectIsolated();
  });

  it('discards a late track color update after projectId changes', async () => {
    const pending = deferred<IProject | null>();
    mocks.updateTrackAppearance.mockReturnValue(pending.promise);
    const { rerender } = await renderOldProject();

    fireEvent.contextMenu(screen.getByTestId('track-panel-row-old-track'));
    fireEvent.keyDown(await screen.findByTestId('track-color-submenu'), { key: 'ArrowRight' });
    fireEvent.click(await screen.findByTestId('track-color-1'));
    await waitFor(() => expect(mocks.updateTrackAppearance).toHaveBeenCalledWith(
      OLD_PROJECT_ID, 'old-track', { type: 'color', colorIndex: 1 },
    ));
    await switchToNextProject(rerender);

    const updated = {
      ...projects[OLD_PROJECT_ID]!,
      tracks: [{ ...projects[OLD_PROJECT_ID]!.tracks[0]!, color: '#66A3FF' }],
    };
    projects[OLD_PROJECT_ID] = updated;
    await act(async () => {
      pending.resolve(updated);
      await pending.promise;
      await settleDeferred();
    });
    expectNextProjectIsolated();
  });

  it('discards a late track visualization update after projectId changes', async () => {
    const pending = deferred<IProject | null>();
    mocks.updateTrackAppearance.mockReturnValue(pending.promise);
    const { rerender } = await renderOldProject();

    fireEvent.contextMenu(screen.getByTestId('track-panel-row-old-track'));
    fireEvent.keyDown(await screen.findByTestId('track-visualization-submenu'), { key: 'ArrowRight' });
    fireEvent.click(await screen.findByTestId('track-view-spectrogram'));
    await waitFor(() => expect(mocks.updateTrackAppearance).toHaveBeenCalledWith(
      OLD_PROJECT_ID, 'old-track', { type: 'viewMode', viewMode: 'spectrum' },
    ));
    await switchToNextProject(rerender);

    const updated = {
      ...projects[OLD_PROJECT_ID]!,
      tracks: [{ ...projects[OLD_PROJECT_ID]!.tracks[0]!, viewMode: 'spectrum' as const }],
    };
    projects[OLD_PROJECT_ID] = updated;
    await act(async () => {
      pending.resolve(updated);
      await pending.promise;
      await settleDeferred();
    });
    expectNextProjectIsolated();
  });

  it('discards a late bulk-mute reload after projectId changes', async () => {
    const before = projects[OLD_PROJECT_ID]!;
    const after = { ...before, tracks: [{ ...before.tracks[0]!, muted: true }] };
    mocks.setTracksMute.mockResolvedValue({ before, after });
    const pendingReload = deferred<IProject | null>();
    mocks.getProject.mockImplementation(async (projectId: string) => {
      if (projectId === OLD_PROJECT_ID) return pendingReload.promise;
      return projects[projectId] ?? null;
    });
    const { rerender } = await renderOldProject();

    fireEvent.keyDown(window, { key: 'u', ctrlKey: true });
    await waitFor(() => expect(mocks.getProject).toHaveBeenCalledWith(OLD_PROJECT_ID));
    await switchToNextProject(rerender);

    projects[OLD_PROJECT_ID] = after;
    await act(async () => {
      pendingReload.resolve(after);
      await pendingReload.promise;
      await settleDeferred();
    });
    expectNextProjectIsolated();
  });

  it('suppresses a late track-command failure after projectId changes', async () => {
    const oldA = projects[OLD_PROJECT_ID]!.tracks[0]!;
    const oldB = makeTrack('old-track-b', 'Old Beta');
    projects[OLD_PROJECT_ID] = { ...projects[OLD_PROJECT_ID]!, tracks: [oldA, oldB] };
    const pending = deferred<{ before: IProject; after: IProject } | null>();
    mocks.moveTrack.mockReturnValue(pending.promise);
    const { rerender } = await renderOldProject();

    await openMoveMenu('old-track');
    fireEvent.click(await screen.findByTestId('track-move-down-menu'));
    await waitFor(() => expect(mocks.moveTrack).toHaveBeenCalledTimes(1));
    await switchToNextProject(rerender);

    await act(async () => {
      pending.reject(new Error('late old move failure'));
      await settleDeferred();
    });
    expectNextProjectIsolated();
  });
});
