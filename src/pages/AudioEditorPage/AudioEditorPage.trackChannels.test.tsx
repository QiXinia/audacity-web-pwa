import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IProject, ITrack } from '@/types/project';

const mocks = vi.hoisted(() => ({
  push: vi.fn(), success: vi.fn(), warning: vi.fn(), error: vi.fn(),
  swap: vi.fn(), split: vi.fn(), makeStereo: vi.fn(), loadChannels: vi.fn(), loadMetadata: vi.fn(),
}));
let mockProject: IProject;

function makeTrack(id: string, channelCount: 1 | 2 | undefined, startTime = 0): ITrack {
  return {
    id,
    name: `Track ${id}`,
    type: 'audio',
    gain: 0,
    pan: 0,
    muted: false,
    solo: false,
    armed: false,
    color: '#66A3FF',
    channelCount,
    clips: [{
      id: `clip-${id}`,
      audioBufferId: `buffer-${id}`,
      startTime,
      offset: 0,
      duration: 1,
      originalDuration: 1,
      stretchRatio: 1,
      gain: 0,
      fadeIn: 0,
      fadeOut: 0,
      name: `Clip ${id}`,
    }],
    effects: [],
  };
}

function makeProject(tracks: ITrack[]): IProject {
  return {
    id: 'track-channel-project',
    name: 'Track channel integration',
    tracks,
    cursorPosition: 0,
    selection: null,
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
    saveProject: vi.fn(async (project: IProject) => { mockProject = project; }),
    swapStereoChannelsOnTrack: mocks.swap,
    splitStereoTrackOnTrack: mocks.split,
    makeStereoTrackFromMono: mocks.makeStereo,
    loadAudioChannels: mocks.loadChannels,
    loadAudioBufferMetadata: mocks.loadMetadata,
    loadAudioBuffer: vi.fn(async () => new Float32Array(10)),
  },
}));
vi.mock('@/services/historyService', () => ({
  historyManager: {
    push: mocks.push, pushCommand: mocks.push,
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
    processClipChannels: vi.fn((_clip: unknown, source: Float32Array[]) => source.map((channel) => new Float32Array(channel))),
  },
}));
vi.mock('@/wasm/processor', () => ({ isWasmAvailable: vi.fn(() => false), wasmProcessor: {} }));
vi.mock('react-router-dom', () => ({ useParams: () => ({ projectId: 'track-channel-project' }), useNavigate: () => vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: mocks.success, warning: mocks.warning, error: mocks.error } }));
vi.mock('@/utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), log: vi.fn() } }));

import AudioEditorPage from './AudioEditorPage';

async function renderEditor(): Promise<void> {
  render(<AudioEditorPage />);
  expect(await screen.findByText('Track channel integration')).toBeInTheDocument();
}

async function openTrackMenu(trackId: string): Promise<void> {
  fireEvent.contextMenu(screen.getByTestId(`track-panel-row-${trackId}`));
  await screen.findByTestId(`track-context-menu-${trackId}`);
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  mockProject = makeProject([makeTrack('stereo', 2), makeTrack('mono', 1)]);
  mocks.swap.mockImplementation(async (_projectId: string, trackId: string) => {
    const track = mockProject.tracks.find((candidate) => candidate.id === trackId)!;
    mockProject = {
      ...mockProject,
      tracks: mockProject.tracks.map((candidate) => candidate.id === trackId ? {
        ...candidate,
        clips: candidate.clips.map((clip) => ({ ...clip, audioBufferId: `${clip.audioBufferId}-swapped` })),
      } : candidate),
    };
    return track.clips.length;
  });
  mocks.split.mockImplementation(async (_projectId: string, trackId: string, mode: 'lr' | 'center') => {
    const index = mockProject.tracks.findIndex((track) => track.id === trackId);
    const source = mockProject.tracks[index]!;
    const leftId = `${trackId}-left`;
    const rightId = `${trackId}-right`;
    const leftClipIds: Record<string, string> = {};
    const rightClipIds: Record<string, string> = {};
    const makeSide = (id: string, pan: number, clipIds: Record<string, string>): ITrack => ({
      ...structuredClone(source),
      id,
      pan,
      channelCount: 1,
      effects: [],
      clips: source.clips.map((clip) => {
        clipIds[clip.id] = `${clip.id}-${id}`;
        return { ...clip, id: clipIds[clip.id]!, audioBufferId: `${clip.audioBufferId}-${id}` };
      }),
    });
    const left = makeSide(leftId, mode === 'lr' ? -1 : source.pan, leftClipIds);
    const right = makeSide(rightId, mode === 'lr' ? 1 : source.pan, rightClipIds);
    const tracks = [...mockProject.tracks];
    tracks.splice(index, 1, left, right);
    mockProject = { ...mockProject, tracks };
    return { leftTrackId: leftId, rightTrackId: rightId, leftClipIds, rightClipIds };
  });
  mocks.makeStereo.mockImplementation(async (_projectId: string, leftId: string, rightId: string) => {
    const leftIndex = mockProject.tracks.findIndex((track) => track.id === leftId);
    const left = mockProject.tracks[leftIndex]!;
    const output: ITrack = {
      ...structuredClone(left),
      id: 'joined',
      channelCount: 2,
      clips: left.clips.length + mockProject.tracks[leftIndex + 1]!.clips.length > 0 ? [{
        ...left.clips[0]!, id: 'joined-clip', audioBufferId: 'joined-buffer', startTime: 0, duration: 1,
      }] : [],
    };
    const tracks = [...mockProject.tracks];
    tracks.splice(leftIndex, 2, output);
    mockProject = { ...mockProject, tracks };
    return { trackId: 'joined', clipId: output.clips[0]?.id ?? null };
  });
  mocks.loadChannels.mockImplementation(async (id: string) => [Float32Array.from(id.includes('b') ? [0, 0, 2, 2] : [1, 1, 0, 0])]);
  mocks.loadMetadata.mockImplementation(async (id: string) => ({
    id,
    sampleRate: 1000,
    channels: id === 'buffer-stereo' || id === 'buffer-s' ? 2 : 1,
    length: 4,
  }));
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('AudioEditorPage Audacity 4 track channel context menu', () => {
  it('uses PCM metadata to correct a stale mono field, then places and records Swap after Meters', async () => {
    mockProject.tracks[0]!.channelCount = 1;
    await renderEditor();
    await openTrackMenu('stereo');
    const meters = screen.getByTestId('track-meters-monitoring-submenu');
    const swap = await screen.findByTestId('track-swap-stereo-channels');
    expect(meters.compareDocumentPosition(swap) & 4).toBeTruthy();
    expect(screen.getByTestId('track-split-stereo-lr')).toBeInTheDocument();
    expect(screen.getByTestId('track-split-stereo-center')).toBeInTheDocument();
    expect(screen.queryByTestId('track-make-stereo')).not.toBeInTheDocument();

    await act(async () => { fireEvent.click(swap); });
    await waitFor(() => expect(mocks.swap).toHaveBeenCalledWith('track-channel-project', 'stereo'));
    await waitFor(() => expect(mockProject.tracks[0]!.clips[0]!.audioBufferId).toBe('buffer-stereo-swapped'));
    expect(mocks.push).toHaveBeenCalledTimes(1);
    expect(mocks.push.mock.calls[0]![0].label).toBe('Swap stereo channels');
  });

  it.each([
    ['lr', 'Split stereo to L/R mono', 'track-split-stereo-lr'],
    ['center', 'Split stereo to center mono', 'track-split-stereo-center'],
  ] as const)('commits %s split, selects the left output, and clears stale clip selection', async (mode, label, testId) => {
    await renderEditor();
    await openTrackMenu('stereo');
    await act(async () => { fireEvent.click(await screen.findByTestId(testId)); });

    await screen.findByTestId('track-panel-row-stereo-left');
    expect(screen.getByTestId('track-panel-row-stereo-right')).toBeInTheDocument();
    expect(mocks.split).toHaveBeenCalledWith('track-channel-project', 'stereo', mode);
    expect(mocks.push).toHaveBeenCalledTimes(1);
    expect(mocks.push.mock.calls[0]![0].label).toBe(label);
    expect(mockProject.tracks[0]!.pan).toBe(mode === 'lr' ? -1 : 0);
    expect(mockProject.tracks[1]!.pan).toBe(mode === 'lr' ? 1 : 0);
  });

  it('enables Make stereo only for a selected mono track followed by another mono track', async () => {
    mockProject = makeProject([makeTrack('a', 1), makeTrack('s', 2), makeTrack('b', 1)]);
    await renderEditor();
    await openTrackMenu('a');
    expect(screen.getByTestId('track-make-stereo')).toHaveAttribute('aria-disabled', 'true');
    fireEvent.keyDown(document, { key: 'Escape' });
    await openTrackMenu('b');
    expect(screen.getByTestId('track-make-stereo')).toHaveAttribute('aria-disabled', 'true');
    expect(mocks.makeStereo).not.toHaveBeenCalled();
  });

  it('detects legacy mono tracks from real metadata before enabling Make stereo', async () => {
    mockProject = makeProject([makeTrack('a', undefined), makeTrack('b', undefined)]);
    await renderEditor();
    await openTrackMenu('a');
    await waitFor(() => expect(screen.getByTestId('track-make-stereo')).not.toHaveAttribute('aria-disabled', 'true'));
    expect(mocks.loadMetadata).toHaveBeenCalledWith('buffer-a');
    expect(mocks.loadMetadata).toHaveBeenCalledWith('buffer-b');
  });

  it('combines aligned mono tracks without a warning and creates one history step', async () => {
    mockProject = makeProject([makeTrack('a', 1), makeTrack('b', 1)]);
    await renderEditor();
    await openTrackMenu('a');
    await act(async () => { fireEvent.click(await screen.findByTestId('track-make-stereo')); });

    await screen.findByTestId('track-panel-row-joined');
    expect(screen.queryByTestId('make-stereo-confirmation')).not.toBeInTheDocument();
    expect(mocks.makeStereo).toHaveBeenCalledWith('track-channel-project', 'a', 'b', [
      { trackId: 'a', clips: [{ clipId: 'clip-a', sampleData: [expect.any(Float32Array)], sourceOffset: 0 }] },
      { trackId: 'b', clips: [{ clipId: 'clip-b', sampleData: [expect.any(Float32Array)], sourceOffset: 0 }] },
    ]);
    expect(mocks.push).toHaveBeenCalledTimes(1);
    expect(mocks.push.mock.calls[0]![0].label).toBe('Make stereo track');
  });

  it('shows the official render warning for mismatched clips and supports Cancel then Yes', async () => {
    mockProject = makeProject([makeTrack('a', 1), makeTrack('b', 1, 0.5)]);
    await renderEditor();
    await openTrackMenu('a');
    fireEvent.click(await screen.findByTestId('track-make-stereo'));
    expect(await screen.findByTestId('make-stereo-confirmation')).toBeInTheDocument();
    expect(screen.getByText('Combine mono tracks to stereo')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('make-stereo-cancel'));
    await waitFor(() => expect(screen.queryByTestId('make-stereo-confirmation')).not.toBeInTheDocument());
    expect(mocks.makeStereo).not.toHaveBeenCalled();

    await openTrackMenu('a');
    fireEvent.click(await screen.findByTestId('track-make-stereo'));
    fireEvent.click(await screen.findByTestId('make-stereo-confirm'));
    await screen.findByTestId('track-panel-row-joined');
    expect(mocks.makeStereo).toHaveBeenCalledTimes(1);
    expect(mocks.push).toHaveBeenCalledTimes(1);
  });

  it('warns for realtime effects and renders only after Yes', async () => {
    const left = makeTrack('a', 1);
    left.effects = [{ id: 'echo', type: 'delay', bypassed: false, params: {} }];
    mockProject = makeProject([left, makeTrack('b', 1)]);
    await renderEditor();
    await openTrackMenu('a');
    fireEvent.click(await screen.findByTestId('track-make-stereo'));

    expect(await screen.findByTestId('make-stereo-confirmation')).toBeInTheDocument();
    expect(mocks.makeStereo).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('make-stereo-confirm'));
    await screen.findByTestId('track-panel-row-joined');
    expect(mocks.makeStereo).toHaveBeenCalledTimes(1);
    expect(mocks.push).toHaveBeenCalledTimes(1);
    expect(mocks.error).not.toHaveBeenCalled();
  });
});
