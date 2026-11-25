import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, MemoryRouter, Route, RouterProvider, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AudioEditorPage from '@/pages/AudioEditorPage/AudioEditorPage';
import { historyManager } from '@/services/historyService';
import { projectService } from '@/services/projectService';
import { audioEngine } from '@/engine/audioEngine';
import { toast } from 'sonner';
import type { IClip, IProject } from '@/types/project';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('motion/react', () => ({
  motion: new Proxy({}, {
    get: (_target, tag: string) => ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => {
      const { layout: _layout, animate: _animate, initial: _initial, exit: _exit, transition: _transition, ...rest } = props;
      return <div {...rest}>{children}</div>;
    },
  }),
  AnimatePresence: ({ children }: React.PropsWithChildren) => children,
}));
vi.mock('@/engine/audioEngine', () => ({
  audioEngine: {
    setCursorChangeCallback: vi.fn(), setStateChangeCallback: vi.fn(), seek: vi.fn(),
    cacheBuffer: vi.fn(), evictBuffer: vi.fn(), play: vi.fn(), pause: vi.fn(), resume: vi.fn(), stop: vi.fn(),
    initialize: vi.fn().mockResolvedValue(undefined), loadClip: vi.fn(),
    processClipChannels: vi.fn((_clip: IClip, channels: Float32Array[]) => channels.map((channel) => new Float32Array(channel))),
    setTrackVolume: vi.fn(), setTrackPan: vi.fn(), setTrackMute: vi.fn(), setTrackSolo: vi.fn(),
    setMetronome: vi.fn(), setMetronomeVolume: vi.fn(), getMetronomeState: vi.fn().mockReturnValue({ enabled: false, volume: 0.5 }),
    startRecording: vi.fn().mockResolvedValue(undefined), stopRecording: vi.fn().mockResolvedValue(null), pauseRecording: vi.fn(), resumeRecording: vi.fn(),
    startMicrophoneMonitoring: vi.fn().mockResolvedValue(undefined), stopMicrophoneMonitoring: vi.fn(), setMonitoringEnabled: vi.fn(),
    getRecordingLevels: vi.fn().mockReturnValue([-96, -96]), getPlaybackLevels: vi.fn().mockReturnValue([-96, -96]),
  },
}));
vi.mock('@/services/projectService', () => ({
  projectService: {
    openProject: vi.fn(), getProject: vi.fn(), saveProject: vi.fn().mockResolvedValue(undefined),
    storeProjectBuffer: vi.fn(), loadAudioChannels: vi.fn(), loadAudioBuffer: vi.fn(),
    getPreferences: vi.fn().mockReturnValue({ language: 'zh-CN', theme: 'dark', defaultSampleRate: 44100 }),
    listProjects: vi.fn().mockResolvedValue([]), addTrack: vi.fn(), deleteTrack: vi.fn(),
    deleteProject: vi.fn(), permanentlyDeleteProject: vi.fn(), addRecordingToTrack: vi.fn(),
    addGeneratedAudioToTracks: vi.fn(), silenceSelectionOnTracks: vi.fn(),
    repeatSelectionOnTracks: vi.fn(), duplicateSelectionToTracks: vi.fn(),
    crossfadeSelectionOnTracks: vi.fn(), crossfadeClipsSelection: vi.fn(), delaySelectionOnTracks: vi.fn(),
    notchFilterSelectionOnTracks: vi.fn(), spectralEditSelectionOnTracks: vi.fn(), adjustableFadeSelectionOnTracks: vi.fn(),
    studioFadeOutSelectionOnTracks: vi.fn(), repairSelectionOnTracks: vi.fn(), clickRemovalSelectionOnTracks: vi.fn(),
    renameTrack: vi.fn(), updateTrackVolume: vi.fn(), updateTrackPan: vi.fn(),
  },
}));
vi.mock('@/services/historyService', () => ({
  historyManager: {
    loadForProject: vi.fn().mockResolvedValue(0), push: vi.fn().mockResolvedValue(undefined),
    undo: vi.fn(), redo: vi.fn(), canUndo: vi.fn().mockReturnValue(false),
    canRedo: vi.fn().mockReturnValue(false), getUndoLabel: vi.fn().mockReturnValue(null),
    getRedoLabel: vi.fn().mockReturnValue(null), flush: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock('@/db/audioDb', () => ({
  audioDb: { clipboard: { put: vi.fn(), get: vi.fn(), delete: vi.fn() } },
  serializeTracks: (tracks: unknown) => JSON.stringify(tracks),
  deserializeTracks: (data: string) => JSON.parse(data),
}));
vi.mock('@/wasm/processor', () => ({ wasmProcessor: { process: vi.fn() }, isWasmAvailable: vi.fn().mockReturnValue(false) }));
vi.mock('@/lib/waveformDrawing', () => ({ drawWaveform: vi.fn() }));

class MockAudioContext {
  state = 'running';
  sampleRate = 44100;
  destination = {};
  createGain() { return { gain: { value: 1, setValueAtTime: vi.fn() }, connect: vi.fn() }; }
  createBufferSource() { return { buffer: null, connect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: null }; }
  createBuffer(_channels: number, length: number) {
    const data = Array.from({ length: 2 }, () => new Float32Array(length));
    return { length, duration: length / 44100, sampleRate: 44100, numberOfChannels: 2, getChannelData: (index: number) => data[index], copyToChannel: vi.fn() };
  }
  createAnalyser() { return { fftSize: 2048, connect: vi.fn(), getFloatTimeDomainData: vi.fn() }; }
  resume() { return Promise.resolve(); }
  close() { return Promise.resolve(); }
}
Object.defineProperty(window, 'AudioContext', { value: MockAudioContext, writable: true });
Object.defineProperty(window, 'webkitAudioContext', { value: MockAudioContext, writable: true });
Object.defineProperty(navigator, 'mediaDevices', {
  value: { getUserMedia: vi.fn().mockRejectedValue(new Error('No microphone')) }, configurable: true,
});
Object.defineProperty(navigator, 'permissions', {
  value: { query: vi.fn().mockResolvedValue({ state: 'denied', addEventListener: vi.fn() }) }, configurable: true,
});
HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
  clearRect: vi.fn(), scale: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(),
  save: vi.fn(), restore: vi.fn(), translate: vi.fn(), rect: vi.fn(), clip: vi.fn(),
  fillRect: vi.fn(), set strokeStyle(_value: string) {}, set fillStyle(_value: string) {}, set lineWidth(_value: number) {},
})) as unknown as typeof HTMLCanvasElement.prototype.getContext;
Element.prototype.scrollIntoView = vi.fn();

function makeClip(id: string): IClip {
  return {
    id, audioBufferId: `buffer-${id}`, startTime: 0, offset: 0,
    duration: 0.01, originalDuration: 0.01, stretchRatio: 1, gain: 0, fadeIn: 0, fadeOut: 0,
    name: `Clip ${id}`,
  };
}

function makeProject(): IProject {
  const track = (id: string, name: string) => ({
    id, name, type: 'audio' as const, gain: 0, pan: 0, muted: false, solo: false,
    armed: false, color: '#666', effects: [], clips: [makeClip(`source-${id}`)],
  });
  return {
    id: 'repeat-project', name: 'Repeat integration', sampleRate: 1000,
    timeSignature: { numerator: 4, denominator: 4 }, tempo: 120,
    tracks: [track('track-1', '主音轨'), track('track-2', '第二音轨')],
    cursorPosition: 0, selection: { start: 0, end: 0.01 },
    viewState: { horizontalZoom: 100, verticalZoom: 1, scrollX: 0, viewMode: 'waveform' },
    updatedAt: 100, createdAt: 50,
  };
}

function renderEditor() {
  return render(<MemoryRouter initialEntries={['/editor/repeat-project']}>
    <Routes><Route path="/editor/:projectId" element={<AudioEditorPage />} /></Routes>
  </MemoryRouter>);
}

function makeNextProject(name: string): IProject {
  const project = makeProject();
  return {
    ...project,
    id: 'next-project',
    name,
    tracks: [{ ...project.tracks[0]!, id: 'next-track', name: 'Next track' }],
    selection: null,
  };
}

function renderSwitchableEditor() {
  const router = createMemoryRouter([
    { path: '/editor/:projectId', element: <AudioEditorPage /> },
  ], { initialEntries: ['/editor/repeat-project'] });
  return { ...render(<RouterProvider router={router} />), router };
}

describe('AudioEditorPage Repeat command integration', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('copies both tracks through the Effect menu and registers one undoable command', async () => {
    const project = makeProject();
    const updated: IProject = {
      ...project,
      selection: { start: 0, end: 0.03 },
      tracks: project.tracks.map((track) => ({
        ...track,
        clips: [
          track.clips[0],
          { ...track.clips[0], id: `repeat-1-${track.id}`, name: `Repeat 1 ${track.id}`, startTime: 0.01, audioBufferId: `rendered-${track.id}` },
          { ...track.clips[0], id: `repeat-2-${track.id}`, name: `Repeat 2 ${track.id}`, startTime: 0.02, audioBufferId: `rendered-${track.id}` },
        ],
      })),
    };
    vi.mocked(projectService.openProject).mockResolvedValue(project);
    vi.mocked(projectService.getProject).mockResolvedValue(updated);
    vi.mocked(projectService.loadAudioChannels).mockResolvedValue([Float32Array.from({ length: 10 }, (_, i) => i / 10)]);
    vi.mocked(projectService.loadAudioBuffer).mockResolvedValue(Float32Array.from({ length: 10 }, (_, i) => i / 10));
    vi.mocked(projectService.repeatSelectionOnTracks).mockResolvedValue(updated.tracks.flatMap((track) => track.clips.slice(1)));
    vi.mocked(historyManager.canUndo).mockReturnValue(true);
    vi.mocked(historyManager.undo).mockImplementation(((_currentProject: IProject, commit?: (project: IProject) => Promise<boolean | void>) => {
      const result = { project, command: { label: '重复选区 ×2' } };
      if (!commit) return result;
      return Promise.resolve(commit(project)).then(() => result);
    }) as never);
    renderEditor();
    await waitFor(() => expect(screen.getByText('主音轨')).toBeInTheDocument());

    const effectMenu = screen.getByRole('button', { name: '效果' });
    fireEvent.pointerDown(effectMenu);
    fireEvent.click(effectMenu);
    fireEvent.pointerDown(await screen.findByText('Repeat 重复…'));
    fireEvent.click(screen.getByText('Repeat 重复…'));
    fireEvent.change(await screen.findByLabelText('新增重复次数'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: '应用重复' }));

    await waitFor(() => expect(projectService.repeatSelectionOnTracks).toHaveBeenCalledWith(
      project.id, { start: 0, end: 0.01 }, 2, [
        { trackId: 'track-1', sampleData: [expect.any(Float32Array)] },
        { trackId: 'track-2', sampleData: [expect.any(Float32Array)] },
      ],
    ));
    await waitFor(() => expect(screen.getAllByRole('button', { name: /^Repeat [12] track-/ })).toHaveLength(4));
    expect(historyManager.push).toHaveBeenCalledTimes(1);
    expect(vi.mocked(historyManager.push).mock.calls[0][0].label).toBe('重复选区 ×2');
    expect(audioEngine.processClipChannels).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole('button', { name: '撤销' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Repeat / })).not.toBeInTheDocument());
    expect(screen.getAllByRole('button', { name: /^Clip source-track-/ })).toHaveLength(2);
    expect(historyManager.undo).toHaveBeenCalledWith(updated, expect.any(Function));
    expect(projectService.saveProject).toHaveBeenCalledWith(project);
  });

  it('duplicates the selection onto a new track and registers one undoable command', async () => {
    const project = makeProject();
    const duplicatedClip: IClip = {
      ...project.tracks[0].clips[0],
      id: 'duplicated-clip',
      audioBufferId: 'duplicated-buffer',
      name: 'Duplicate',
    };
    const updated: IProject = {
      ...project,
      tracks: [
        ...project.tracks,
        {
          id: 'duplicate-track',
          name: '主音轨 副本',
          type: 'audio',
          gain: 0,
          pan: 0,
          muted: false,
          solo: false,
          armed: false,
          color: '#888',
          clips: [duplicatedClip],
          effects: [],
        },
      ],
    };
    vi.mocked(projectService.openProject).mockResolvedValue(project);
    vi.mocked(projectService.getProject).mockResolvedValue(updated);
    vi.mocked(projectService.loadAudioChannels).mockResolvedValue([Float32Array.from({ length: 10 }, (_, index) => index / 10)]);
    vi.mocked(projectService.loadAudioBuffer).mockResolvedValue(Float32Array.from({ length: 10 }, (_, index) => index / 10));
    vi.mocked(projectService.duplicateSelectionToTracks).mockResolvedValue([duplicatedClip]);
    renderEditor();
    await waitFor(() => expect(screen.getByText('主音轨')).toBeInTheDocument());

    const effectMenu = screen.getByRole('button', { name: '效果' });
    fireEvent.pointerDown(effectMenu);
    fireEvent.click(effectMenu);
    fireEvent.pointerDown(await screen.findByText('Duplicate 复制为新轨道'));
    fireEvent.click(screen.getByText('Duplicate 复制为新轨道'));

    await waitFor(() => expect(projectService.duplicateSelectionToTracks).toHaveBeenCalledWith(
      project.id,
      { start: 0, end: 0.01 },
      expect.any(Array),
    ));
    expect(historyManager.push).toHaveBeenCalledTimes(1);
    expect(vi.mocked(historyManager.push).mock.calls[0][0].label).toBe('Duplicate 复制');
    expect(audioEngine.processClipChannels).toHaveBeenCalledTimes(2);
  });

  it('opens Crossfade Tracks and applies the default crossfade to both tracks', async () => {
    const project = makeProject();
    const updated: IProject = { ...project, selection: { start: 0, end: 0.01 } };
    vi.mocked(projectService.openProject).mockResolvedValue(project);
    vi.mocked(projectService.getProject).mockResolvedValue(updated);
    vi.mocked(projectService.loadAudioChannels).mockResolvedValue([Float32Array.from({ length: 10 }, (_, index) => index / 10)]);
    vi.mocked(projectService.loadAudioBuffer).mockResolvedValue(Float32Array.from({ length: 10 }, (_, index) => index / 10));
    vi.mocked(projectService.crossfadeSelectionOnTracks).mockResolvedValue(2);
    renderEditor();
    await waitFor(() => expect(screen.getByText('主音轨')).toBeInTheDocument());

    const effectMenu = screen.getByRole('button', { name: '效果' });
    fireEvent.pointerDown(effectMenu);
    fireEvent.click(effectMenu);
    fireEvent.click(await screen.findByText('Crossfade Tracks 交叉淡化…'));
    expect(await screen.findByRole('dialog', { name: 'Crossfade Tracks 交叉淡化' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '应用 Crossfade' }));

    await waitFor(() => expect(projectService.crossfadeSelectionOnTracks).toHaveBeenCalledWith(
      project.id,
      { start: 0, end: 0.01 },
      expect.objectContaining({
        type: 'gain',
        customCurve: 0,
        direction: 'automatic',
      }),
      expect.any(Array),
    ));
    expect(historyManager.push).toHaveBeenCalledTimes(1);
    expect(vi.mocked(historyManager.push).mock.calls[0][0].label).toBe('Crossfade Tracks 交叉淡化');
  });

  it('does not replace a newly opened project when Crossfade Tracks completes late', async () => {
    const project = makeProject();
    const nextProject = makeNextProject('Next project after Crossfade Tracks');
    const updated: IProject = { ...project, name: 'Old project after Crossfade Tracks' };
    vi.mocked(projectService.openProject).mockImplementation(async (id) => (
      id === project.id ? project : nextProject
    ));
    vi.mocked(projectService.getProject).mockResolvedValue(updated);
    vi.mocked(projectService.loadAudioChannels).mockResolvedValue([new Float32Array(10).fill(0.25)]);
    vi.mocked(projectService.loadAudioBuffer).mockResolvedValue(new Float32Array(10).fill(0.25));
    let releaseCrossfade!: () => void;
    const crossfadeGate = new Promise<void>((resolve) => { releaseCrossfade = resolve; });
    vi.mocked(projectService.crossfadeSelectionOnTracks).mockImplementationOnce(async () => {
      await crossfadeGate;
      return 2;
    });
    const { router } = renderSwitchableEditor();
    expect(await screen.findByText(project.name)).toBeInTheDocument();

    const effectMenu = screen.getByRole('button', { name: '效果' });
    fireEvent.pointerDown(effectMenu);
    fireEvent.click(effectMenu);
    fireEvent.click(await screen.findByText('Crossfade Tracks 交叉淡化…'));
    expect(await screen.findByRole('dialog', { name: 'Crossfade Tracks 交叉淡化' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '应用 Crossfade' }));
    await waitFor(() => expect(projectService.crossfadeSelectionOnTracks).toHaveBeenCalledTimes(1));

    await act(async () => { await router.navigate('/editor/next-project'); });
    expect(await screen.findByText(nextProject.name)).toBeInTheDocument();
    await act(async () => {
      releaseCrossfade();
      await crossfadeGate;
    });

    expect(screen.getByText(nextProject.name)).toBeInTheDocument();
    expect(screen.queryByText(updated.name)).not.toBeInTheDocument();
    expect(historyManager.push).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalledWith('已在 2 个片段应用交叉淡化');
  });

  it('does not replace a newly opened project when Crossfade Clips completes late', async () => {
    const baseProject = makeProject();
    const project: IProject = { ...baseProject, tracks: [baseProject.tracks[0]!] };
    const nextProject = makeNextProject('Next project after Crossfade Clips');
    const updated: IProject = { ...project, name: 'Old project after Crossfade Clips' };
    vi.mocked(projectService.openProject).mockImplementation(async (id) => (
      id === project.id ? project : nextProject
    ));
    vi.mocked(projectService.getProject).mockResolvedValue(updated);
    vi.mocked(projectService.loadAudioChannels).mockResolvedValue([new Float32Array(10).fill(0.25)]);
    vi.mocked(projectService.loadAudioBuffer).mockResolvedValue(new Float32Array(10).fill(0.25));
    let releaseCrossfadeClips!: () => void;
    const crossfadeClipsGate = new Promise<void>((resolve) => { releaseCrossfadeClips = resolve; });
    vi.mocked(projectService.crossfadeClipsSelection).mockImplementationOnce(async () => {
      await crossfadeClipsGate;
      return 1;
    });
    const { router } = renderSwitchableEditor();
    expect(await screen.findByText(project.name)).toBeInTheDocument();

    const effectMenu = screen.getByRole('button', { name: '效果' });
    fireEvent.pointerDown(effectMenu);
    fireEvent.click(effectMenu);
    fireEvent.click(await screen.findByText('Crossfade Clips 片段交叉淡化'));
    await waitFor(() => expect(projectService.crossfadeClipsSelection).toHaveBeenCalledTimes(1));

    await act(async () => { await router.navigate('/editor/next-project'); });
    expect(await screen.findByText(nextProject.name)).toBeInTheDocument();
    await act(async () => {
      releaseCrossfadeClips();
      await crossfadeClipsGate;
    });

    expect(screen.getByText(nextProject.name)).toBeInTheDocument();
    expect(screen.queryByText(updated.name)).not.toBeInTheDocument();
    expect(historyManager.push).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalledWith('已合并并交叉淡化 1 个选区');
  });

  it('opens Delay and applies the default settings with one undo entry', async () => {
    const project = makeProject();
    const updated: IProject = { ...project };
    vi.mocked(projectService.openProject).mockResolvedValue(project);
    vi.mocked(projectService.getProject).mockResolvedValue(updated);
    vi.mocked(projectService.loadAudioChannels).mockResolvedValue([Float32Array.from({ length: 10 }, (_, index) => index / 10)]);
    vi.mocked(projectService.loadAudioBuffer).mockResolvedValue(Float32Array.from({ length: 10 }, (_, index) => index / 10));
    vi.mocked(projectService.delaySelectionOnTracks).mockResolvedValue(2);
    renderEditor();
    await waitFor(() => expect(screen.getByText('主音轨')).toBeInTheDocument());

    const effectMenu = screen.getByRole('button', { name: '效果' });
    fireEvent.pointerDown(effectMenu);
    fireEvent.click(effectMenu);
    fireEvent.click(await screen.findByText('Delay 延迟…'));
    expect(await screen.findByRole('dialog', { name: 'Delay 延迟' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '应用 Delay' }));

    await waitFor(() => expect(projectService.delaySelectionOnTracks).toHaveBeenCalledWith(
      project.id,
      { start: 0, end: 0.01 },
      expect.objectContaining({ delayType: 'regular', echoCount: 5 }),
      expect.any(Array),
    ));
    expect(historyManager.push).toHaveBeenCalledTimes(1);
    expect(vi.mocked(historyManager.push).mock.calls[0][0].label).toBe('Delay 延迟');
  });

  it('does not replace a newly opened project when Delay completes late', async () => {
    const project = makeProject();
    const nextProject = makeNextProject('Next project after Delay');
    const updated: IProject = { ...project, name: 'Old project after Delay' };
    vi.mocked(projectService.openProject).mockImplementation(async (id) => (
      id === project.id ? project : nextProject
    ));
    vi.mocked(projectService.getProject).mockResolvedValue(updated);
    vi.mocked(projectService.loadAudioChannels).mockResolvedValue([new Float32Array(10).fill(0.25)]);
    vi.mocked(projectService.loadAudioBuffer).mockResolvedValue(new Float32Array(10).fill(0.25));
    let releaseDelay!: () => void;
    const delayGate = new Promise<void>((resolve) => { releaseDelay = resolve; });
    vi.mocked(projectService.delaySelectionOnTracks).mockImplementationOnce(async () => {
      await delayGate;
      return 2;
    });
    const { router } = renderSwitchableEditor();
    expect(await screen.findByText(project.name)).toBeInTheDocument();

    const effectMenu = screen.getByRole('button', { name: '效果' });
    fireEvent.pointerDown(effectMenu);
    fireEvent.click(effectMenu);
    fireEvent.click(await screen.findByText('Delay 延迟…'));
    expect(await screen.findByRole('dialog', { name: 'Delay 延迟' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '应用 Delay' }));
    await waitFor(() => expect(projectService.delaySelectionOnTracks).toHaveBeenCalledTimes(1));

    await act(async () => { await router.navigate('/editor/next-project'); });
    expect(await screen.findByText(nextProject.name)).toBeInTheDocument();
    await act(async () => {
      releaseDelay();
      await delayGate;
    });

    expect(screen.getByText(nextProject.name)).toBeInTheDocument();
    expect(screen.queryByText(updated.name)).not.toBeInTheDocument();
    expect(historyManager.push).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalledWith('已对 2 个片段应用 Delay');
  });

  it('does not replace a newly opened project when Notch Filter completes late', async () => {
    const project = makeProject();
    const nextProject = makeNextProject('Next project after Notch Filter');
    const updated: IProject = { ...project, name: 'Old project after Notch Filter' };
    vi.mocked(projectService.openProject).mockImplementation(async (id) => (
      id === project.id ? project : nextProject
    ));
    vi.mocked(projectService.getProject).mockResolvedValue(updated);
    vi.mocked(projectService.loadAudioChannels).mockResolvedValue([new Float32Array(10).fill(0.25)]);
    vi.mocked(projectService.loadAudioBuffer).mockResolvedValue(new Float32Array(10).fill(0.25));
    let releaseNotchFilter!: () => void;
    const notchFilterGate = new Promise<void>((resolve) => { releaseNotchFilter = resolve; });
    vi.mocked(projectService.notchFilterSelectionOnTracks).mockImplementationOnce(async () => {
      await notchFilterGate;
      return 2;
    });
    const { router } = renderSwitchableEditor();
    expect(await screen.findByText(project.name)).toBeInTheDocument();

    const effectMenu = screen.getByRole('button', { name: '效果' });
    fireEvent.pointerDown(effectMenu);
    fireEvent.click(effectMenu);
    fireEvent.click(await screen.findByText('Notch Filter 陷波滤波…'));
    expect(await screen.findByRole('dialog', { name: 'Notch Filter 陷波滤波' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '应用 Notch Filter' }));
    await waitFor(() => expect(projectService.notchFilterSelectionOnTracks).toHaveBeenCalledTimes(1));

    await act(async () => { await router.navigate('/editor/next-project'); });
    expect(await screen.findByText(nextProject.name)).toBeInTheDocument();
    await act(async () => {
      releaseNotchFilter();
      await notchFilterGate;
    });

    expect(screen.getByText(nextProject.name)).toBeInTheDocument();
    expect(screen.queryByText(updated.name)).not.toBeInTheDocument();
    expect(historyManager.push).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalledWith('已对 2 个片段应用 Notch Filter');
  });

  it('does not replace a newly opened project when Spectral Edit completes late', async () => {
    const project = makeProject();
    const nextProject = makeNextProject('Next project after Spectral Edit');
    const updated: IProject = { ...project, name: 'Old project after Spectral Edit' };
    vi.mocked(projectService.openProject).mockImplementation(async (id) => (
      id === project.id ? project : nextProject
    ));
    vi.mocked(projectService.getProject).mockResolvedValue(updated);
    vi.mocked(projectService.loadAudioChannels).mockResolvedValue([new Float32Array(10).fill(0.25)]);
    vi.mocked(projectService.loadAudioBuffer).mockResolvedValue(new Float32Array(10).fill(0.25));
    let releaseSpectralEdit!: () => void;
    const spectralEditGate = new Promise<void>((resolve) => { releaseSpectralEdit = resolve; });
    vi.mocked(projectService.spectralEditSelectionOnTracks).mockImplementationOnce(async () => {
      await spectralEditGate;
      return 2;
    });
    const { router } = renderSwitchableEditor();
    expect(await screen.findByText(project.name)).toBeInTheDocument();

    const effectMenu = screen.getByRole('button', { name: '效果' });
    fireEvent.pointerDown(effectMenu);
    fireEvent.click(effectMenu);
    fireEvent.click(await screen.findByText('Delete selection center frequency…'));
    expect(await screen.findByRole('dialog', { name: 'Spectral Edit: Delete center frequency' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '删除中心频率' }));
    await waitFor(() => expect(projectService.spectralEditSelectionOnTracks).toHaveBeenCalledTimes(1));

    await act(async () => { await router.navigate('/editor/next-project'); });
    expect(await screen.findByText(nextProject.name)).toBeInTheDocument();
    await act(async () => {
      releaseSpectralEdit();
      await spectralEditGate;
    });

    expect(screen.getByText(nextProject.name)).toBeInTheDocument();
    expect(screen.queryByText(updated.name)).not.toBeInTheDocument();
    expect(historyManager.push).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalledWith('已对 2 个片段应用 Spectral Edit Delete center frequency');
  });

  it('opens Adjustable Fade and applies the default fade with one undo entry', async () => {
    const project = makeProject();
    const updated: IProject = { ...project };
    vi.mocked(projectService.openProject).mockResolvedValue(project);
    vi.mocked(projectService.getProject).mockResolvedValue(updated);
    vi.mocked(projectService.loadAudioChannels).mockResolvedValue([Float32Array.from({ length: 10 }, (_, index) => index / 10)]);
    vi.mocked(projectService.loadAudioBuffer).mockResolvedValue(Float32Array.from({ length: 10 }, (_, index) => index / 10));
    vi.mocked(projectService.adjustableFadeSelectionOnTracks).mockResolvedValue(2);
    renderEditor();
    await waitFor(() => expect(screen.getByText('主音轨')).toBeInTheDocument());

    const effectMenu = screen.getByRole('button', { name: '效果' });
    fireEvent.pointerDown(effectMenu);
    fireEvent.click(effectMenu);
    fireEvent.click(await screen.findByText('Adjustable Fade 可调淡化…'));
    expect(await screen.findByRole('dialog', { name: 'Adjustable Fade 可调淡化' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '应用 Adjustable Fade' }));

    await waitFor(() => expect(projectService.adjustableFadeSelectionOnTracks).toHaveBeenCalledWith(
      project.id,
      { start: 0, end: 0.01 },
      expect.objectContaining({ fadeType: 'up', preset: 'none', endGain: 100 }),
      expect.any(Array),
    ));
    expect(historyManager.push).toHaveBeenCalledTimes(1);
    expect(vi.mocked(historyManager.push).mock.calls[0][0].label).toBe('Adjustable Fade 可调淡化');
  });

  it('does not replace a newly opened project when Adjustable Fade completes late', async () => {
    const project = makeProject();
    const nextProject = makeNextProject('Next project after Adjustable Fade');
    const updated: IProject = { ...project, name: 'Old project after Adjustable Fade' };
    vi.mocked(projectService.openProject).mockImplementation(async (id) => (
      id === project.id ? project : nextProject
    ));
    vi.mocked(projectService.getProject).mockResolvedValue(updated);
    vi.mocked(projectService.loadAudioChannels).mockResolvedValue([new Float32Array(10).fill(0.25)]);
    vi.mocked(projectService.loadAudioBuffer).mockResolvedValue(new Float32Array(10).fill(0.25));
    let releaseAdjustableFade!: () => void;
    const adjustableFadeGate = new Promise<void>((resolve) => { releaseAdjustableFade = resolve; });
    vi.mocked(projectService.adjustableFadeSelectionOnTracks).mockImplementationOnce(async () => {
      await adjustableFadeGate;
      return 2;
    });
    const { router } = renderSwitchableEditor();
    expect(await screen.findByText(project.name)).toBeInTheDocument();

    const effectMenu = screen.getByRole('button', { name: '效果' });
    fireEvent.pointerDown(effectMenu);
    fireEvent.click(effectMenu);
    fireEvent.click(await screen.findByText('Adjustable Fade 可调淡化…'));
    expect(await screen.findByRole('dialog', { name: 'Adjustable Fade 可调淡化' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '应用 Adjustable Fade' }));
    await waitFor(() => expect(projectService.adjustableFadeSelectionOnTracks).toHaveBeenCalledTimes(1));

    await act(async () => { await router.navigate('/editor/next-project'); });
    expect(await screen.findByText(nextProject.name)).toBeInTheDocument();
    await act(async () => {
      releaseAdjustableFade();
      await adjustableFadeGate;
    });

    expect(screen.getByText(nextProject.name)).toBeInTheDocument();
    expect(screen.queryByText(updated.name)).not.toBeInTheDocument();
    expect(historyManager.push).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalledWith('已对 2 个片段应用 Adjustable Fade');
  });

  it('does not replace a newly opened project when Studio Fade Out completes late', async () => {
    const project = makeProject();
    const nextProject = makeNextProject('Next project after Studio Fade Out');
    const updated: IProject = { ...project, name: 'Old project after Studio Fade Out' };
    vi.mocked(projectService.openProject).mockImplementation(async (id) => (
      id === project.id ? project : nextProject
    ));
    vi.mocked(projectService.getProject).mockResolvedValue(updated);
    vi.mocked(projectService.loadAudioChannels).mockResolvedValue([new Float32Array(10).fill(0.25)]);
    vi.mocked(projectService.loadAudioBuffer).mockResolvedValue(new Float32Array(10).fill(0.25));
    let releaseStudioFadeOut!: () => void;
    const studioFadeOutGate = new Promise<void>((resolve) => { releaseStudioFadeOut = resolve; });
    vi.mocked(projectService.studioFadeOutSelectionOnTracks).mockImplementationOnce(async () => {
      await studioFadeOutGate;
      return 2;
    });
    const { router } = renderSwitchableEditor();
    expect(await screen.findByText(project.name)).toBeInTheDocument();

    const effectMenu = screen.getByRole('button', { name: '效果' });
    fireEvent.pointerDown(effectMenu);
    fireEvent.click(effectMenu);
    fireEvent.click(await screen.findByText('Studio Fade Out 工作室淡出'));
    await waitFor(() => expect(projectService.studioFadeOutSelectionOnTracks).toHaveBeenCalledTimes(1));

    await act(async () => { await router.navigate('/editor/next-project'); });
    expect(await screen.findByText(nextProject.name)).toBeInTheDocument();
    await act(async () => {
      releaseStudioFadeOut();
      await studioFadeOutGate;
    });

    expect(screen.getByText(nextProject.name)).toBeInTheDocument();
    expect(screen.queryByText(updated.name)).not.toBeInTheDocument();
    expect(historyManager.push).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalledWith('已对 2 个片段应用 Studio Fade Out');
  });

  it('does not replace a newly opened project when Repair completes late', async () => {
    const project = makeProject();
    const nextProject = makeNextProject('Next project after Repair');
    const updated: IProject = { ...project, name: 'Old project after Repair' };
    vi.mocked(projectService.openProject).mockImplementation(async (id) => (
      id === project.id ? project : nextProject
    ));
    vi.mocked(projectService.getProject).mockResolvedValue(updated);
    vi.mocked(projectService.loadAudioChannels).mockResolvedValue([new Float32Array(10).fill(0.25)]);
    vi.mocked(projectService.loadAudioBuffer).mockResolvedValue(new Float32Array(10).fill(0.25));
    let releaseRepair!: () => void;
    const repairGate = new Promise<void>((resolve) => { releaseRepair = resolve; });
    vi.mocked(projectService.repairSelectionOnTracks).mockImplementationOnce(async () => {
      await repairGate;
      return 2;
    });
    const { router } = renderSwitchableEditor();
    expect(await screen.findByText(project.name)).toBeInTheDocument();

    const effectMenu = screen.getByRole('button', { name: '效果' });
    fireEvent.pointerDown(effectMenu);
    fireEvent.click(effectMenu);
    fireEvent.click(await screen.findByText('修复（Repair）'));
    await waitFor(() => expect(projectService.repairSelectionOnTracks).toHaveBeenCalledTimes(1));

    await act(async () => { await router.navigate('/editor/next-project'); });
    expect(await screen.findByText(nextProject.name)).toBeInTheDocument();
    await act(async () => {
      releaseRepair();
      await repairGate;
    });

    expect(screen.getByText(nextProject.name)).toBeInTheDocument();
    expect(screen.queryByText(updated.name)).not.toBeInTheDocument();
    expect(historyManager.push).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalledWith('已对 2 个片段应用 Repair 修复');
  });

  it('does not replace a newly opened project when Click Removal completes late', async () => {
    const baseProject = makeProject();
    const project: IProject = {
      ...baseProject,
      selection: { start: 0, end: 8.192 },
      tracks: baseProject.tracks.map((track) => ({
        ...track,
        clips: track.clips.map((clip) => ({ ...clip, duration: 8.192, originalDuration: 8.192 })),
      })),
    };
    const nextProject = makeNextProject('Next project after Click Removal');
    const updated: IProject = { ...project, name: 'Old project after Click Removal' };
    vi.mocked(projectService.openProject).mockImplementation(async (id) => (
      id === project.id ? project : nextProject
    ));
    vi.mocked(projectService.getProject).mockResolvedValue(updated);
    vi.mocked(projectService.loadAudioChannels).mockResolvedValue([new Float32Array(8192).fill(0.25)]);
    vi.mocked(projectService.loadAudioBuffer).mockResolvedValue(new Float32Array(8192).fill(0.25));
    let releaseClickRemoval!: () => void;
    const clickRemovalGate = new Promise<void>((resolve) => { releaseClickRemoval = resolve; });
    vi.mocked(projectService.clickRemovalSelectionOnTracks).mockImplementationOnce(async () => {
      await clickRemovalGate;
      return 2;
    });
    const { router } = renderSwitchableEditor();
    expect(await screen.findByText(project.name)).toBeInTheDocument();

    const effectMenu = screen.getByRole('button', { name: '效果' });
    fireEvent.pointerDown(effectMenu);
    fireEvent.click(effectMenu);
    fireEvent.click(await screen.findByText('Click Removal 咔哒声消除…'));
    expect(await screen.findByRole('dialog', { name: 'Click Removal 咔哒声消除' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '应用 Click Removal' }));
    await waitFor(() => expect(projectService.clickRemovalSelectionOnTracks).toHaveBeenCalledTimes(1));

    await act(async () => { await router.navigate('/editor/next-project'); });
    expect(await screen.findByText(nextProject.name)).toBeInTheDocument();
    await act(async () => {
      releaseClickRemoval();
      await clickRemovalGate;
    });

    expect(screen.getByText(nextProject.name)).toBeInTheDocument();
    expect(screen.queryByText(updated.name)).not.toBeInTheDocument();
    expect(historyManager.push).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalledWith('已对 2 个片段应用 Click Removal 咔哒声消除');
  });

  it('does not replace a newly opened project when Repeat completes late', async () => {
    const project = makeProject();
    const nextProject = makeNextProject('Next project after Repeat');
    const updated: IProject = { ...project, name: 'Old project after Repeat' };
    vi.mocked(projectService.openProject).mockImplementation(async (id) => (
      id === project.id ? project : nextProject
    ));
    vi.mocked(projectService.getProject).mockResolvedValue(updated);
    vi.mocked(projectService.loadAudioChannels).mockResolvedValue([new Float32Array(10).fill(0.25)]);
    vi.mocked(projectService.loadAudioBuffer).mockResolvedValue(new Float32Array(10).fill(0.25));
    let releaseRepeat!: () => void;
    const repeatGate = new Promise<void>((resolve) => { releaseRepeat = resolve; });
    vi.mocked(projectService.repeatSelectionOnTracks).mockImplementationOnce(async () => {
      await repeatGate;
      return [{ ...project.tracks[0]!.clips[0]!, id: 'late-repeat', name: 'Late Repeat' }];
    });
    const { router } = renderSwitchableEditor();
    expect(await screen.findByText(project.name)).toBeInTheDocument();

    const effectMenu = screen.getByRole('button', { name: '效果' });
    fireEvent.pointerDown(effectMenu);
    fireEvent.click(effectMenu);
    fireEvent.pointerDown(await screen.findByText('Repeat 重复…'));
    fireEvent.click(screen.getByText('Repeat 重复…'));
    fireEvent.change(await screen.findByLabelText('新增重复次数'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: '应用重复' }));
    await waitFor(() => expect(projectService.repeatSelectionOnTracks).toHaveBeenCalledTimes(1));

    await act(async () => { await router.navigate('/editor/next-project'); });
    expect(await screen.findByText(nextProject.name)).toBeInTheDocument();
    await act(async () => {
      releaseRepeat();
      await repeatGate;
    });

    expect(screen.getByText(nextProject.name)).toBeInTheDocument();
    expect(screen.queryByText(updated.name)).not.toBeInTheDocument();
    expect(historyManager.push).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalledWith('已插入 1 个重复片段');
  });

  it('does not replace a newly opened project when Duplicate completes late', async () => {
    const project = makeProject();
    const nextProject = makeNextProject('Next project after Duplicate');
    const updated: IProject = { ...project, name: 'Old project after Duplicate' };
    vi.mocked(projectService.openProject).mockImplementation(async (id) => (
      id === project.id ? project : nextProject
    ));
    vi.mocked(projectService.getProject).mockResolvedValue(updated);
    vi.mocked(projectService.loadAudioChannels).mockResolvedValue([new Float32Array(10).fill(0.25)]);
    vi.mocked(projectService.loadAudioBuffer).mockResolvedValue(new Float32Array(10).fill(0.25));
    let releaseDuplicate!: () => void;
    const duplicateGate = new Promise<void>((resolve) => { releaseDuplicate = resolve; });
    vi.mocked(projectService.duplicateSelectionToTracks).mockImplementationOnce(async () => {
      await duplicateGate;
      return [{ ...project.tracks[0]!.clips[0]!, id: 'late-duplicate', name: 'Late Duplicate' }];
    });
    const { router } = renderSwitchableEditor();
    expect(await screen.findByText(project.name)).toBeInTheDocument();

    const effectMenu = screen.getByRole('button', { name: '效果' });
    fireEvent.pointerDown(effectMenu);
    fireEvent.click(effectMenu);
    fireEvent.pointerDown(await screen.findByText('Duplicate 复制为新轨道'));
    fireEvent.click(screen.getByText('Duplicate 复制为新轨道'));
    await waitFor(() => expect(projectService.duplicateSelectionToTracks).toHaveBeenCalledTimes(1));

    await act(async () => { await router.navigate('/editor/next-project'); });
    expect(await screen.findByText(nextProject.name)).toBeInTheDocument();
    await act(async () => {
      releaseDuplicate();
      await duplicateGate;
    });

    expect(screen.getByText(nextProject.name)).toBeInTheDocument();
    expect(screen.queryByText(updated.name)).not.toBeInTheDocument();
    expect(historyManager.push).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalledWith('已在 1 条新轨道复制选区');
  });
});
