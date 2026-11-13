import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AudioEditorPage from '@/pages/AudioEditorPage/AudioEditorPage';
import { historyManager } from '@/services/historyService';
import { projectService } from '@/services/projectService';
import { audioEngine } from '@/engine/audioEngine';
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
    setCursorChangeCallback: vi.fn(), setStateChangeCallback: vi.fn(),
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
    crossfadeSelectionOnTracks: vi.fn(), delaySelectionOnTracks: vi.fn(),
    adjustableFadeSelectionOnTracks: vi.fn(),
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
    vi.mocked(historyManager.undo).mockReturnValue({ project, command: { label: '重复选区 ×2' } } as never);
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
    expect(historyManager.undo).toHaveBeenCalledWith(updated);
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
});
