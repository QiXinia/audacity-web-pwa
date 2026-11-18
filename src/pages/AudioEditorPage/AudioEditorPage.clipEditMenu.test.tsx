// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IClip, IProject } from '@/types/project';
import { parseAudioClipboard } from '@/services/clipboardService';

const mocks = vi.hoisted(() => ({
  loadChannels: vi.fn(),
  saveProject: vi.fn(async () => undefined),
  clipboardPut: vi.fn(async () => undefined),
  clipboardGet: vi.fn(),
  duplicateSelectionToTracks: vi.fn(async () => [{ id: 'duplicated-track' }]),
  drawWaveform: vi.fn(),
}));

const left = new Float32Array(500).fill(0.4);
const right = new Float32Array(500).fill(-0.3);
const clip = (id: string, name: string, startTime: number, duration: number): IClip => ({
  id, audioBufferId: `buffer-${id}`, startTime, offset: 0, duration,
  originalDuration: duration, stretchRatio: 1, gain: 0, fadeIn: 0, fadeOut: 0, name,
});
const clipA = clip('clip-a', 'Voice take', 1, 2);
const clipB = clip('clip-b', 'Second clip', 4, 1);
const clipC = clip('clip-c', 'Other track clip', 1, 2);

const project: IProject = {
  id: 'clip-edit-project', name: 'Clip edit integration', sampleRate: 100,
  tracks: [
    {
      id: 'track-a', name: 'Narration', type: 'audio', gain: 0, pan: 0,
      muted: false, solo: false, armed: false, color: '#7aa2f7', clips: [clipA, clipB], effects: [],
    },
    {
      id: 'track-b', name: 'Other track', type: 'audio', gain: 0, pan: 0,
      muted: false, solo: false, armed: false, color: '#f7768e', clips: [clipC], effects: [],
    },
  ],
  cursorPosition: 1.5, selection: null, spectralSelection: null,
  viewState: { horizontalZoom: 100, verticalZoom: 1, scrollX: 0, viewMode: 'waveform' },
  updatedAt: 100, createdAt: 50, timeSignature: { numerator: 4, denominator: 4 }, tempo: 120,
};

vi.mock('@/services/projectService', () => ({
  projectService: {
    getProject: vi.fn(async () => project), openProject: vi.fn(async () => project),
    saveProject: mocks.saveProject, loadAudioChannels: mocks.loadChannels,
    loadAudioBufferMetadata: vi.fn(async () => null), loadAudioBuffer: vi.fn(async () => null),
    duplicateSelectionToTracks: mocks.duplicateSelectionToTracks,
  },
}));
vi.mock('@/services/historyService', () => ({
  historyManager: {
    push: vi.fn(), pushCommand: vi.fn(), canUndo: vi.fn(() => false), canRedo: vi.fn(() => false),
    loadForProject: vi.fn(async () => 0), flush: vi.fn(async () => undefined), undo: vi.fn(), redo: vi.fn(),
    getUndoStack: vi.fn(() => []), getRedoStack: vi.fn(() => []),
    getHistoryState: vi.fn(() => ({ canUndo: false, canRedo: false, undoLabel: '', redoLabel: '' })),
    clearHistory: vi.fn(), flushPersistence: vi.fn(), getUndoLabel: vi.fn(() => null), getRedoLabel: vi.fn(() => null),
  },
}));
vi.mock('@/db/audioDb', () => ({
  audioDb: {
    audioBuffers: { get: vi.fn(), put: vi.fn(), delete: vi.fn() },
    clipboard: { get: mocks.clipboardGet, put: mocks.clipboardPut }, historySnapshots: {},
  },
  serializeTracks: (tracks: unknown) => JSON.stringify(tracks), deserializeTracks: (data: string) => JSON.parse(data),
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
    setTracksEndCallback: vi.fn(), getPlaybackLevels: vi.fn(() => ({ left: -Infinity, right: -Infinity })),
    getRecordingLevels: vi.fn(() => ({ left: -Infinity, right: -Infinity })),
    processClipChannels: vi.fn((_clip: unknown, source: Float32Array[]) => source.map((channel) => new Float32Array(channel))),
  },
}));
vi.mock('@/wasm/processor', () => ({
  isWasmAvailable: vi.fn(() => false),
  wasmProcessor: {
    spectrogram: vi.fn((_data: Float32Array, windowSize: number) => new Float32Array(windowSize / 2 + 1)),
    sliceBuffer: vi.fn(),
  },
}));
vi.mock('@/lib/waveformDrawing', () => ({ drawWaveform: mocks.drawWaveform }));
vi.mock('react-router-dom', () => ({
  useParams: () => ({ projectId: 'clip-edit-project' }), useNavigate: () => vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), log: vi.fn() } }));

import AudioEditorPage from './AudioEditorPage';

async function renderProject() {
  const { container } = render(<AudioEditorPage />);
  expect(await screen.findByText('Clip edit integration')).toBeInTheDocument();
  await screen.findByText('Voice take');
  await waitFor(() => expect(mocks.loadChannels).toHaveBeenCalled());
  return Array.from(container.querySelectorAll<HTMLElement>('.au-clip'));
}

function lastSavedProject(): IProject {
  const calls = mocks.saveProject.mock.calls as unknown as Array<[IProject]>;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1]![0];
}

function clipboardData(): ReturnType<typeof parseAudioClipboard> {
  const calls = mocks.clipboardPut.mock.calls as unknown as Array<[{ data: string }]>;
  expect(calls.length).toBeGreaterThan(0);
  return parseAudioClipboard(calls[0]![0].data);
}

describe('AudioEditorPage single Clip edit menu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    window.localStorage.setItem('audacity-web:delete-preferences:v1', JSON.stringify({
      deleteBehavior: 'leave-gap', closeGapBehavior: 'per-track',
    }));
    mocks.loadChannels.mockResolvedValue([left, right]);
    mocks.saveProject.mockResolvedValue(undefined);
    mocks.clipboardPut.mockResolvedValue(undefined);
    mocks.clipboardGet.mockImplementation(async () => {
      const calls = mocks.clipboardPut.mock.calls as unknown as Array<[{ data: string }]>;
      return calls[0]?.[0];
    });
    mocks.duplicateSelectionToTracks.mockResolvedValue([{ id: 'duplicated-track' }]);
    Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
    const context = {
      scale: vi.fn(), clearRect: vi.fn(), save: vi.fn(), translate: vi.fn(),
      beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn(), restore: vi.fn(), fillRect: vi.fn(),
    };
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', { configurable: true, value: vi.fn(() => context) });
  });

  afterEach(() => cleanup());

  it('places single Clip commands correctly and switches to the dedicated multi Clip menu', async () => {
    const clips = await renderProject();
    fireEvent.contextMenu(clips[0]!);
    for (const id of [
      'clip-cut-menu', 'clip-copy-menu', 'clip-duplicate-menu', 'clip-delete-menu',
      'clip-cut-options-menu', 'clip-delete-options-menu', 'clip-split-menu',
    ]) {
      expect(await screen.findByTestId(id)).not.toHaveAttribute('aria-disabled', 'true');
    }
    const content = screen.getByTestId('clip-cut-menu').parentElement!;
    const order = Array.from(content.children).map((element) => element.getAttribute('data-testid'));
    expect(order.indexOf('clip-cut-menu')).toBeGreaterThan(order.indexOf('clip-color-menu'));
    expect(order.indexOf('clip-split-menu')).toBeLessThan(order.indexOf('clip-split-silences-menu'));

    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(clips[0]!);
    fireEvent.click(clips[1]!, { shiftKey: true });
    fireEvent.contextMenu(clips[0]!);
    for (const id of [
      'multi-clip-cut-menu', 'multi-clip-copy-menu', 'multi-clip-delete-menu',
      'multi-clip-cut-options-menu', 'multi-clip-delete-options-menu', 'multi-clip-join-menu',
    ]) {
      expect(await screen.findByTestId(id)).not.toHaveAttribute('aria-disabled', 'true');
    }
    expect(screen.queryByTestId('clip-cut-menu')).not.toBeInTheDocument();
    expect(screen.queryByTestId('clip-properties-menu')).not.toBeInTheDocument();
    expect(mocks.saveProject).not.toHaveBeenCalled();
  });

  it('copies only the right-clicked Clip track into the audio clipboard', async () => {
    const clips = await renderProject();
    fireEvent.contextMenu(clips[0]!);
    fireEvent.click(await screen.findByTestId('clip-copy-menu'));
    await waitFor(() => expect(mocks.clipboardPut).toHaveBeenCalledTimes(1));
    const copied = clipboardData();
    expect(copied.tracks.map((track) => track.trackId)).toEqual(['track-a']);
    expect(mocks.saveProject).not.toHaveBeenCalled();
  });

  it('cuts the target Clip without touching an overlapping Clip on another track', async () => {
    const clips = await renderProject();
    fireEvent.contextMenu(clips[0]!);
    fireEvent.keyDown(await screen.findByTestId('clip-cut-options-menu'), { key: 'ArrowRight' });
    fireEvent.click(await screen.findByTestId('clip-cut-leave-gap'));
    await waitFor(() => expect(mocks.saveProject).toHaveBeenCalledTimes(1));
    const saved = lastSavedProject();
    expect(saved.tracks[0]!.clips.map((item) => item.id)).toEqual(['clip-b']);
    expect(saved.tracks[1]!.clips.map((item) => item.id)).toEqual(['clip-c']);
    expect(clipboardData().tracks.map((track) => track.trackId)).toEqual(['track-a']);
  });

  it('deletes the target Clip without touching an overlapping Clip on another track', async () => {
    const clips = await renderProject();
    fireEvent.contextMenu(clips[0]!);
    fireEvent.click(await screen.findByTestId('clip-delete-menu'));
    await waitFor(() => expect(mocks.saveProject).toHaveBeenCalledTimes(1));
    const saved = lastSavedProject();
    expect(saved.tracks[0]!.clips.map((item) => item.id)).toEqual(['clip-b']);
    expect(saved.tracks[1]!.clips.map((item) => item.id)).toEqual(['clip-c']);
  });

  it('duplicates only the target track', async () => {
    const clips = await renderProject();
    fireEvent.contextMenu(clips[0]!);
    fireEvent.click(await screen.findByTestId('clip-duplicate-menu'));
    await waitFor(() => expect(mocks.duplicateSelectionToTracks).toHaveBeenCalledTimes(1));
    const duplicateCalls = mocks.duplicateSelectionToTracks.mock.calls as unknown as Array<[
      string,
      { start: number; end: number },
      Array<{ trackId: string }>,
    ]>;
    const [, selection, tracks] = duplicateCalls[0]!;
    expect(selection).toEqual({ start: 1, end: 3 });
    expect(tracks.map((track: { trackId: string }) => track.trackId)).toEqual(['track-a']);
  });

  it('splits at the playback cursor without letting the portal menu click move it', async () => {
    const clips = await renderProject();
    fireEvent.contextMenu(clips[0]!);
    const splitItem = await screen.findByTestId('clip-split-menu');
    fireEvent.mouseDown(splitItem, { button: 0, clientX: 605, clientY: 565 });
    fireEvent.click(splitItem);
    await waitFor(() => expect(mocks.saveProject).toHaveBeenCalled());
    const saved = lastSavedProject();
    expect(saved.tracks[0]!.clips.filter((item) => item.id !== 'clip-b')).toHaveLength(2);
    expect(saved.tracks[0]!.clips.filter((item) => item.id !== 'clip-b').map((item) => item.duration)).toEqual([0.5, 1.5]);
    expect(saved.tracks[1]!.clips.map((item) => item.id)).toEqual(['clip-c']);
  });

  it('copies sparse multi Clips as non-contiguous segments relative to the leftmost Clip', async () => {
    const clips = await renderProject();
    fireEvent.click(clips[0]!);
    fireEvent.click(clips[1]!, { shiftKey: true });
    fireEvent.contextMenu(clips[0]!);
    fireEvent.click(await screen.findByTestId('multi-clip-copy-menu'));
    await waitFor(() => expect(mocks.clipboardPut).toHaveBeenCalledTimes(1));
    const copied = clipboardData();
    expect(copied.duration).toBe(4);
    expect(copied.tracks.map((track) => track.trackId)).toEqual(['track-a']);
    expect(copied.tracks[0]?.channels).toEqual([]);
    expect(copied.tracks[0]?.segments?.map((segment) => [segment.startTime, segment.duration, segment.name])).toEqual([
      [0, 2, 'Voice take'], [3, 1, 'Second clip'],
    ]);
    expect(mocks.saveProject).not.toHaveBeenCalled();
  });

  it('cuts only the selected Clips across their own tracks and leaves gaps', async () => {
    const clips = await renderProject();
    fireEvent.click(clips[0]!);
    fireEvent.click(clips[2]!, { shiftKey: true });
    fireEvent.contextMenu(clips[0]!);
    fireEvent.keyDown(await screen.findByTestId('multi-clip-cut-options-menu'), { key: 'ArrowRight' });
    fireEvent.click(await screen.findByTestId('multi-clip-cut-leave-gap'));
    await waitFor(() => expect(mocks.saveProject).toHaveBeenCalledTimes(1));
    const saved = lastSavedProject();
    expect(saved.tracks[0]!.clips.map((item) => [item.id, item.startTime])).toEqual([['clip-b', 4]]);
    expect(saved.tracks[1]!.clips).toEqual([]);
    expect(clipboardData().tracks.map((track) => track.trackId)).toEqual(['track-a', 'track-b']);
  });

  it('per-track multi Delete moves only following Clips on the selected tracks', async () => {
    const clips = await renderProject();
    fireEvent.click(clips[0]!);
    fireEvent.click(clips[2]!, { shiftKey: true });
    fireEvent.contextMenu(clips[0]!);
    fireEvent.keyDown(await screen.findByTestId('multi-clip-delete-options-menu'), { key: 'ArrowRight' });
    fireEvent.click(await screen.findByTestId('multi-clip-delete-per-track'));
    await waitFor(() => expect(mocks.saveProject).toHaveBeenCalledTimes(1));
    const saved = lastSavedProject();
    expect(saved.tracks[0]!.clips.map((item) => [item.id, item.startTime])).toEqual([['clip-b', 2]]);
    expect(saved.tracks[1]!.clips).toEqual([]);
    expect(mocks.clipboardPut).not.toHaveBeenCalled();
  });

  it('uses the configured leave-gap behavior for the ordinary multi Delete command', async () => {
    const clips = await renderProject();
    fireEvent.click(clips[0]!);
    fireEvent.click(clips[2]!, { shiftKey: true });
    fireEvent.contextMenu(clips[0]!);
    fireEvent.click(await screen.findByTestId('multi-clip-delete-menu'));
    await waitFor(() => expect(mocks.saveProject).toHaveBeenCalledTimes(1));
    const saved = lastSavedProject();
    expect(saved.tracks[0]!.clips.map((item) => [item.id, item.startTime])).toEqual([['clip-b', 4]]);
    expect(saved.tracks[1]!.clips).toEqual([]);
    expect(mocks.clipboardPut).not.toHaveBeenCalled();
  });

  it('joins eligible same-track multi Clips and disables Join for cross-track selection', async () => {
    const clips = await renderProject();
    fireEvent.click(clips[0]!);
    fireEvent.click(clips[2]!, { shiftKey: true });
    fireEvent.contextMenu(clips[0]!);
    expect(await screen.findByTestId('multi-clip-join-menu')).toHaveAttribute('aria-disabled', 'true');
    fireEvent.keyDown(document, { key: 'Escape' });

    fireEvent.click(clips[0]!);
    fireEvent.click(clips[1]!, { shiftKey: true });
    fireEvent.contextMenu(clips[0]!);
    fireEvent.click(await screen.findByTestId('multi-clip-join-menu'));
    await waitFor(() => expect(mocks.saveProject).toHaveBeenCalledTimes(1));
    const saved = lastSavedProject();
    expect(saved.tracks[0]!.clips).toHaveLength(1);
    expect(saved.tracks[0]!.clips[0]).toMatchObject({ startTime: 1, duration: 4 });
    expect(saved.tracks[1]!.clips.map((item) => item.id)).toEqual(['clip-c']);
  });

  it('groups and ungroups selected Clips with official whole-group selection behavior', async () => {
    const clips = await renderProject();
    fireEvent.click(clips[0]!);
    fireEvent.click(clips[2]!, { ctrlKey: true });
    fireEvent.contextMenu(clips[0]!);
    const group = await screen.findByTestId('multi-clip-group-menu');
    const ungroup = await screen.findByTestId('multi-clip-ungroup-menu');
    expect(group).not.toHaveAttribute('aria-disabled', 'true');
    expect(ungroup).toHaveAttribute('aria-disabled', 'true');
    const content = group.parentElement!;
    const order = Array.from(content.children).map((element) => element.getAttribute('data-testid'));
    expect(order.indexOf('multi-clip-group-menu')).toBeGreaterThan(order.indexOf('multi-clip-join-menu'));
    expect(order.indexOf('multi-clip-ungroup-menu')).toBeGreaterThan(order.indexOf('multi-clip-group-menu'));
    fireEvent.click(group);
    await waitFor(() => expect(mocks.saveProject).toHaveBeenCalledTimes(1));
    const grouped = lastSavedProject();
    expect(grouped.tracks[0]!.clips.map((item) => item.groupId)).toEqual([1, undefined]);
    expect(grouped.tracks[1]!.clips[0]!.groupId).toBe(1);
    expect(screen.getAllByText('1', { selector: '[data-testid^="clip-group-"]' })).toHaveLength(2);
    fireEvent.keyDown(document, { key: 'Escape' });

    fireEvent.click(clips[1]!);
    fireEvent.click(clips[0]!);
    expect(clips[0]).toHaveAttribute('data-selected', 'true');
    expect(clips[1]).toHaveAttribute('data-selected', 'false');
    expect(clips[2]).toHaveAttribute('data-selected', 'true');
    fireEvent.click(clips[0]!, { ctrlKey: true });
    expect(clips[0]).toHaveAttribute('data-selected', 'false');
    expect(clips[2]).toHaveAttribute('data-selected', 'false');

    fireEvent.click(clips[0]!);
    fireEvent.contextMenu(clips[0]!);
    expect(await screen.findByTestId('multi-clip-group-menu')).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(await screen.findByTestId('multi-clip-ungroup-menu'));
    await waitFor(() => expect(mocks.saveProject).toHaveBeenCalledTimes(2));
    const ungrouped = lastSavedProject();
    expect(ungrouped.tracks.flatMap((track) => track.clips).every((item) => item.groupId === undefined)).toBe(true);
  });

  it('pastes multi Clip segments at their relative offsets instead of one continuous block', async () => {
    const clips = await renderProject();
    fireEvent.click(clips[0]!);
    fireEvent.click(clips[1]!, { shiftKey: true });
    fireEvent.contextMenu(clips[0]!);
    fireEvent.click(await screen.findByTestId('multi-clip-copy-menu'));
    await waitFor(() => expect(mocks.clipboardPut).toHaveBeenCalledTimes(1));
    fireEvent.keyDown(window, { key: 'v', ctrlKey: true });
    await waitFor(() => expect(mocks.saveProject).toHaveBeenCalledTimes(1));
    const pasted = lastSavedProject().tracks[0]!.clips.filter((item) => item.startTime === 1.5 || item.startTime === 4.5);
    expect(pasted.map((item) => [item.startTime, item.duration, item.name])).toEqual([
      [1.5, 2, 'Voice take'], [4.5, 1, 'Second clip'],
    ]);
  });
});
