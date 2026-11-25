// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { audioDb } from '@/db/audioDb';
import { audioEngine } from '@/engine/audioEngine';
import { historyManager } from '@/services/historyService';
import type { IClip, IProject } from '@/types/project';

const mocks = vi.hoisted(() => ({
  projectId: 'clip-properties-project',
  loadChannels: vi.fn(),
  loadMetadata: vi.fn(),
  editLatestProject: vi.fn(),
  addGeneratedAudio: vi.fn(),
  silenceSelection: vi.fn(),
  saveProject: vi.fn(async () => undefined),
  drawWaveform: vi.fn(),
}));

const left = new Float32Array(2000).fill(0.4);
const right = new Float32Array(2000).fill(-0.3);

const clipA: IClip = {
  id: 'clip-a', audioBufferId: 'buffer-a', startTime: 1.25, offset: 0.5,
  duration: 2, originalDuration: 8, stretchRatio: 1.5, pitchCents: 125,
  optimizeForVoice: true, gain: -3, fadeIn: 0.1, fadeOut: 0.2,
  name: 'Voice take', colorIndex: 2, stretchToMatchTempo: true,
  clipTempo: 120, rawAudioTempo: 90,
};
const clipB: IClip = {
  id: 'clip-b', audioBufferId: 'buffer-b', startTime: 5, offset: 0,
  duration: 1, originalDuration: 1, gain: 0, fadeIn: 0, fadeOut: 0, name: 'Second clip',
};

const project: IProject = {
  id: 'clip-properties-project', name: 'Clip properties integration', sampleRate: 44100,
  tracks: [{
    id: 'track-a', name: 'Narration', type: 'audio', gain: 0, pan: 0,
    muted: false, solo: false, armed: false, color: '#7aa2f7', clips: [clipA, clipB], effects: [],
  }],
  cursorPosition: 0, selection: null, spectralSelection: null,
  viewState: { horizontalZoom: 100, verticalZoom: 1, scrollX: 0, viewMode: 'waveform' },
  updatedAt: 100, createdAt: 50, timeSignature: { numerator: 4, denominator: 4 }, tempo: 120,
};

const nextProject: IProject = {
  ...project,
  id: 'clip-properties-next-project',
  name: 'Next project after old render',
  tracks: [{ ...project.tracks[0]!, id: 'next-track', clips: [] }],
};

vi.mock('@/services/projectService', () => ({
  projectService: {
    getProject: vi.fn(async (id: string) => id === nextProject.id ? nextProject : project),
    openProject: vi.fn(async (id: string) => id === nextProject.id ? nextProject : project),
    saveProject: mocks.saveProject, loadAudioChannels: mocks.loadChannels,
    editLatestProject: mocks.editLatestProject,
    addGeneratedAudioToTracks: mocks.addGeneratedAudio,
    silenceSelectionOnTracks: mocks.silenceSelection,
    loadAudioBufferMetadata: mocks.loadMetadata, loadAudioBuffer: vi.fn(async () => null),
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
    clipboard: { get: vi.fn(), put: vi.fn() }, historySnapshots: {},
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
  useParams: () => ({ projectId: mocks.projectId }), useNavigate: () => vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), log: vi.fn() } }));

import AudioEditorPage from './AudioEditorPage';

async function renderProject() {
  const { container } = render(<AudioEditorPage />);
  expect(await screen.findByText('Clip properties integration')).toBeInTheDocument();
  await screen.findByText('Voice take');
  await waitFor(() => expect(mocks.loadChannels).toHaveBeenCalled());
  return Array.from(container.querySelectorAll<HTMLElement>('.au-clip'));
}

describe('AudioEditorPage Clip properties integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.projectId = project.id;
    project.sampleRate = 44100;
    project.selection = null;
    window.localStorage.clear();
    mocks.loadChannels.mockResolvedValue([left, right]);
    mocks.loadMetadata.mockResolvedValue({
      id: 'buffer-a', sampleRate: 48000, channels: 2, length: 384000, duration: 8,
    });
    Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
    const context = {
      scale: vi.fn(), clearRect: vi.fn(), save: vi.fn(), translate: vi.fn(),
      beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn(), restore: vi.fn(), fillRect: vi.fn(),
    };
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', { configurable: true, value: vi.fn(() => context) });
  });

  afterEach(() => cleanup());

  it('opens the first official menu item with real metadata and performs no project edit', async () => {
    const clips = await renderProject();
    fireEvent.contextMenu(clips[0]!);
    const menuItem = await screen.findByTestId('clip-properties-menu');
    expect(menuItem.parentElement?.firstElementChild).toBe(menuItem);
    expect(menuItem).not.toHaveAttribute('aria-disabled', 'true');

    fireEvent.click(menuItem);
    expect(await screen.findByTestId('clip-properties-dialog')).toBeInTheDocument();
    expect(await screen.findByTestId('clip-property-sample-rate')).toHaveTextContent('48000 Hz');
    expect(screen.getByTestId('clip-property-timeline-end')).toHaveTextContent('3.250000 s');
    expect(screen.getByTestId('clip-property-source-end')).toHaveTextContent('3.500000 s');
    expect(screen.getByTestId('clip-property-source-duration')).toHaveTextContent('3.000000 s');
    expect(within(screen.getByTestId('clip-properties-dialog')).getByText('Narration')).toBeInTheDocument();
    expect(mocks.saveProject).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('clip-properties-close'));
    await waitFor(() => expect(screen.queryByTestId('clip-properties-dialog')).not.toBeInTheDocument());
  });

  it('uses the dedicated multi Clip menu instead of exposing single Clip properties', async () => {
    const clips = await renderProject();
    fireEvent.click(clips[0]!);
    fireEvent.click(clips[1]!, { shiftKey: true });
    fireEvent.contextMenu(clips[0]!);
    expect(await screen.findByTestId('multi-clip-copy-menu')).toBeInTheDocument();
    expect(screen.queryByTestId('clip-properties-menu')).not.toBeInTheDocument();
    expect(screen.queryByTestId('clip-properties-dialog')).not.toBeInTheDocument();
  });

  it('rejects stale rendered PCM when the Clip changes while its audio is loading', async () => {
    project.sampleRate = 1000;
    const clips = await renderProject();
    let resolveRenderChannels!: (channels: Float32Array[]) => void;
    const renderChannels = new Promise<Float32Array[]>((resolve) => {
      resolveRenderChannels = resolve;
    });
    const pendingRenderLoad = vi.fn(() => renderChannels);
    mocks.loadChannels.mockImplementationOnce(pendingRenderLoad);

    const latestProject = structuredClone(project);
    let committedAfter: IProject | null = null;
    mocks.editLatestProject.mockImplementationOnce(async (
      _projectId: string,
      edit: (value: IProject) => IProject | Promise<IProject>,
    ) => {
      const before = structuredClone(latestProject);
      const after = await edit(latestProject);
      committedAfter = after;
      return { before, after };
    });

    fireEvent.contextMenu(clips[0]!);
    fireEvent.click(await screen.findByText('Render pitch and speed'));
    await waitFor(() => expect(pendingRenderLoad).toHaveBeenCalledTimes(1));

    const externallyEdited = latestProject.tracks[0]!.clips[0]!;
    latestProject.tracks[0]!.clips[0] = {
      ...externallyEdited,
      pitchCents: 600,
      stretchRatio: 1.25,
    };
    resolveRenderChannels([new Float32Array(8000).fill(0.1)]);

    await waitFor(() => expect(mocks.editLatestProject).toHaveBeenCalledTimes(1));
    await waitFor(() => {
      expect(committedAfter !== null || vi.mocked(toast.error).mock.calls.length > 0).toBe(true);
    });
    expect(committedAfter).toBeNull();
    expect(toast.error).toHaveBeenCalledWith('片段在渲染期间已被修改，请重试');
    expect(latestProject.tracks[0]!.clips[0]).toMatchObject({
      audioBufferId: 'buffer-a',
      pitchCents: 600,
      stretchRatio: 1.25,
    });
    const renderedBufferId = vi.mocked(audioDb.audioBuffers.put).mock.calls[0]![0].id;
    await waitFor(() => expect(audioDb.audioBuffers.delete).toHaveBeenCalledWith(renderedBufferId));
    expect(audioEngine.evictBuffer).toHaveBeenCalledWith(renderedBufferId);
  });

  it('cleans the preallocated buffer id when staging reports a failure', async () => {
    project.sampleRate = 1000;
    const clips = await renderProject();
    mocks.loadChannels.mockResolvedValueOnce([new Float32Array(8000).fill(0.1)]);
    vi.mocked(audioDb.audioBuffers.put).mockRejectedValueOnce(new Error('put failed'));

    fireEvent.contextMenu(clips[0]!);
    fireEvent.click(await screen.findByText('Render pitch and speed'));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(
      'Render pitch and speed 失败：put failed',
    ));
    await waitFor(() => expect(audioDb.audioBuffers.delete).toHaveBeenCalledTimes(1));

    const renderedBufferId = vi.mocked(audioDb.audioBuffers.delete).mock.calls[0]![0];
    expect(renderedBufferId).toEqual(expect.any(String));
    expect(renderedBufferId).not.toBe('');
    expect(audioEngine.evictBuffer).toHaveBeenCalledWith(renderedBufferId);
    expect(mocks.editLatestProject).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalledWith('Rendered time-stretched audio');
  });

  it('retains the rendered buffer after a successful project commit', async () => {
    project.sampleRate = 1000;
    const clips = await renderProject();
    mocks.loadChannels.mockResolvedValueOnce([new Float32Array(8000).fill(0.1)]);
    const latestProject = structuredClone(project);
    const committedProjects: IProject[] = [];
    mocks.editLatestProject.mockImplementationOnce(async (
      _projectId: string,
      edit: (value: IProject) => IProject | Promise<IProject>,
    ) => {
      const before = structuredClone(latestProject);
      const after = await edit(latestProject);
      committedProjects.push(after);
      return { before, after };
    });

    fireEvent.contextMenu(clips[0]!);
    fireEvent.click(await screen.findByText('Render pitch and speed'));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Rendered time-stretched audio'));

    const renderedBufferId = vi.mocked(audioDb.audioBuffers.put).mock.calls[0]![0].id;
    expect(committedProjects).toHaveLength(1);
    expect(committedProjects[0]!.tracks[0]!.clips[0]).toMatchObject({
      audioBufferId: renderedBufferId,
      offset: 0,
      duration: 2,
      originalDuration: 2,
      stretchRatio: 1,
      pitchCents: 0,
      optimizeForVoice: false,
    });
    expect(audioEngine.cacheBuffer).toHaveBeenCalledWith(renderedBufferId, expect.any(Array), 1000);
    expect(audioDb.audioBuffers.delete).not.toHaveBeenCalled();
    expect(audioEngine.evictBuffer).not.toHaveBeenCalledWith(renderedBufferId);
  });

  it('evicts the cache and reports cleanup failure when a rejected render cannot be deleted', async () => {
    project.sampleRate = 1000;
    const clips = await renderProject();
    mocks.loadChannels.mockResolvedValueOnce([new Float32Array(8000).fill(0.1)]);
    mocks.editLatestProject.mockRejectedValueOnce(new Error('save failed'));
    vi.mocked(audioDb.audioBuffers.delete).mockRejectedValueOnce(new Error('delete failed'));

    fireEvent.contextMenu(clips[0]!);
    fireEvent.click(await screen.findByText('Render pitch and speed'));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(
      'Render pitch and speed 的临时音频清理失败，请检查浏览器存储',
    ));

    const renderedBufferId = vi.mocked(audioDb.audioBuffers.put).mock.calls[0]![0].id;
    expect(toast.error).toHaveBeenCalledWith('save failed');
    expect(audioDb.audioBuffers.delete).toHaveBeenCalledWith(renderedBufferId);
    expect(audioEngine.evictBuffer).toHaveBeenCalledWith(renderedBufferId);
    expect(toast.success).not.toHaveBeenCalledWith('Rendered time-stretched audio');
  });

  it('does not replace a newly opened project when the previous render commits late', async () => {
    project.sampleRate = 1000;
    const { container, rerender } = render(<AudioEditorPage />);
    expect(await screen.findByText('Clip properties integration')).toBeInTheDocument();
    const clips = Array.from(container.querySelectorAll<HTMLElement>('.au-clip'));
    mocks.loadChannels.mockResolvedValueOnce([new Float32Array(8000).fill(0.1)]);

    const latestProject = structuredClone(project);
    let releaseCommit!: () => void;
    const commitGate = new Promise<void>((resolve) => { releaseCommit = resolve; });
    let editApplied = false;
    mocks.editLatestProject.mockImplementationOnce(async (
      projectId: string,
      edit: (value: IProject) => IProject | Promise<IProject>,
    ) => {
      expect(projectId).toBe(project.id);
      const before = structuredClone(latestProject);
      const after = await edit(latestProject);
      editApplied = true;
      await commitGate;
      return { before, after };
    });

    fireEvent.contextMenu(clips[0]!);
    fireEvent.click(await screen.findByText('Render pitch and speed'));
    await waitFor(() => expect(editApplied).toBe(true));

    mocks.projectId = nextProject.id;
    rerender(<AudioEditorPage />);
    expect(await screen.findByText('Next project after old render')).toBeInTheDocument();

    await act(async () => {
      releaseCommit();
      await commitGate;
    });

    expect(screen.getByText('Next project after old render')).toBeInTheDocument();
    expect(screen.queryByText('Clip properties integration')).not.toBeInTheDocument();
    expect(historyManager.push).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalledWith('Rendered time-stretched audio');
    expect(audioDb.audioBuffers.delete).not.toHaveBeenCalled();
  });

  it('does not replace a newly opened project when tone generation completes late', async () => {
    const { rerender } = render(<AudioEditorPage />);
    expect(await screen.findByText(project.name)).toBeInTheDocument();
    let releaseGeneration!: () => void;
    const generationGate = new Promise<void>((resolve) => { releaseGeneration = resolve; });
    mocks.addGeneratedAudio.mockImplementationOnce(async () => {
      await generationGate;
      return [{ ...clipA, id: 'generated-tone', audioBufferId: 'generated-tone-buffer', name: 'Generated tone' }];
    });

    const trigger = screen.getByRole('button', { name: '生成' });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    fireEvent.click(await screen.findByText('音调…'));
    fireEvent.change(screen.getByLabelText('时长（秒）'), { target: { value: '0.01' } });
    fireEvent.click(screen.getByRole('button', { name: '生成音调' }));
    await waitFor(() => expect(mocks.addGeneratedAudio).toHaveBeenCalledTimes(1));

    mocks.projectId = nextProject.id;
    rerender(<AudioEditorPage />);
    expect(await screen.findByText(nextProject.name)).toBeInTheDocument();

    await act(async () => {
      releaseGeneration();
      await generationGate;
    });

    expect(screen.getByText(nextProject.name)).toBeInTheDocument();
    expect(screen.queryByText(project.name)).not.toBeInTheDocument();
    expect(historyManager.push).not.toHaveBeenCalled();
    expect(vi.mocked(toast.success).mock.calls.some(([message]) => String(message).includes('音调'))).toBe(false);
  });

  it('does not report a late tone failure inside a newly opened project', async () => {
    const { rerender } = render(<AudioEditorPage />);
    expect(await screen.findByText(project.name)).toBeInTheDocument();
    let releaseGeneration!: () => void;
    const generationGate = new Promise<void>((resolve) => { releaseGeneration = resolve; });
    mocks.addGeneratedAudio.mockImplementationOnce(async () => {
      await generationGate;
      throw new Error('late old-project failure');
    });

    const trigger = screen.getByRole('button', { name: '生成' });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    fireEvent.click(await screen.findByText('音调…'));
    fireEvent.change(screen.getByLabelText('时长（秒）'), { target: { value: '0.01' } });
    fireEvent.click(screen.getByRole('button', { name: '生成音调' }));
    await waitFor(() => expect(mocks.addGeneratedAudio).toHaveBeenCalledTimes(1));

    mocks.projectId = nextProject.id;
    rerender(<AudioEditorPage />);
    expect(await screen.findByText(nextProject.name)).toBeInTheDocument();

    await act(async () => {
      releaseGeneration();
      await generationGate;
    });

    expect(screen.getByText(nextProject.name)).toBeInTheDocument();
    expect(toast.error).not.toHaveBeenCalledWith('生成音调失败：late old-project failure');
    expect(historyManager.push).not.toHaveBeenCalled();
  });

  it('does not replace a newly opened project when selection silencing completes late', async () => {
    project.selection = { start: 1.25, end: 1.5 };
    const { rerender } = render(<AudioEditorPage />);
    expect(await screen.findByText(project.name)).toBeInTheDocument();
    let releaseSilencing!: () => void;
    const silencingGate = new Promise<void>((resolve) => { releaseSilencing = resolve; });
    mocks.silenceSelection.mockImplementationOnce(async () => {
      await silencingGate;
      return 1;
    });

    const trigger = screen.getByRole('button', { name: '生成' });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    fireEvent.click(await screen.findByText('静默…'));
    fireEvent.click(screen.getByRole('button', { name: '生成静默' }));
    await waitFor(() => expect(mocks.silenceSelection).toHaveBeenCalledTimes(1));

    mocks.projectId = nextProject.id;
    rerender(<AudioEditorPage />);
    expect(await screen.findByText(nextProject.name)).toBeInTheDocument();

    await act(async () => {
      releaseSilencing();
      await silencingGate;
    });

    expect(screen.getByText(nextProject.name)).toBeInTheDocument();
    expect(screen.queryByText(project.name)).not.toBeInTheDocument();
    expect(historyManager.push).not.toHaveBeenCalled();
    expect(vi.mocked(toast.success).mock.calls.some(([message]) => String(message).includes('静默'))).toBe(false);
  });
});
