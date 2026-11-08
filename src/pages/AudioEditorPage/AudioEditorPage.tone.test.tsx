// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import AudioEditorPage from '@/pages/AudioEditorPage/AudioEditorPage';
import { projectService } from '@/services/projectService';
import { historyManager } from '@/services/historyService';
import type { IClip, IProject } from '@/types/project';

vi.mock('@/services/projectService', () => ({
  projectService: {
    openProject: vi.fn(),
    getProject: vi.fn(),
    addRecordingToTrack: vi.fn(),
    addGeneratedAudioToTracks: vi.fn(),
    silenceSelectionOnTracks: vi.fn(),
    loadAudioBuffer: vi.fn(),
    saveProject: vi.fn(),
  },
}));

vi.mock('@/services/historyService', () => ({
  historyManager: {
    loadForProject: vi.fn(),
    canUndo: vi.fn(),
    canRedo: vi.fn(),
    getUndoLabel: vi.fn(),
    getRedoLabel: vi.fn(),
    push: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    flush: vi.fn(),
  },
}));

vi.mock('@/engine/audioEngine', () => ({
  audioEngine: {
    setCursorChangeCallback: vi.fn(),
    setStateChangeCallback: vi.fn(),
    getPlaybackLevels: vi.fn(() => ({ left: -Infinity, right: -Infinity })),
    getRecordingLevels: vi.fn(() => ({ left: -Infinity, right: -Infinity })),
    cacheBuffer: vi.fn(),
    processClipChannels: vi.fn(),
  },
}));

vi.mock('@/wasm/processor', () => ({
  isWasmAvailable: vi.fn(() => false),
  wasmProcessor: {
    spectrogram: vi.fn(),
    sliceBuffer: vi.fn(),
  },
}));

function createProject(selection: IProject['selection'] = null): IProject {
  return {
    id: 'project-tone-command',
    name: 'Tone command integration',
    createdAt: 1,
    updatedAt: 1,
    sampleRate: 1000,
    tempo: 120,
    timeSignature: { numerator: 4, denominator: 4 },
    cursorPosition: 0,
    tracks: [{
      id: 'track-1',
      name: 'Track 1',
      type: 'audio',
      clips: [],
      muted: false,
      solo: false,
      armed: false,
      gain: 0,
      pan: 0,
      effects: [],
      color: '#7aa2f7',
    }],
    viewState: {
      horizontalZoom: 100,
      verticalZoom: 1,
      scrollX: 0,
      viewMode: 'waveform',
      snapEnabled: false,
      snapMode: 'clips',
    },
    selection,
    loopRegion: null,
    loopEnabled: false,
  };
}

function renderEditor() {
  return render(
    <MemoryRouter initialEntries={['/editor/project-tone-command']}>
      <Routes>
        <Route path="/editor/:projectId" element={<AudioEditorPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

async function openGeneratorDialog(itemName: string) {
  await screen.findByText('Tone command integration');
  const trigger = screen.getByRole('button', { name: '生成' });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  fireEvent.click(await screen.findByText(itemName));
  return screen.findByRole('dialog');
}

function openToneDialog() {
  return openGeneratorDialog('音调…');
}

function openChirpDialog() {
  return openGeneratorDialog('扫频（Chirp）…');
}

function createTwoTrackProject(selection: IProject['selection'] = null): IProject {
  const project = createProject(selection);
  project.tracks[0].clips = [{
    id: 'clip-a', audioBufferId: 'buffer-a', startTime: 0, offset: 0,
    duration: 0.01, originalDuration: 0.01, stretchRatio: 1, gain: 0,
    fadeIn: 0, fadeOut: 0, name: 'Clip A',
  }];
  project.tracks.push({
    ...project.tracks[0],
    id: 'track-2',
    name: 'Track 2',
    clips: [{
      id: 'clip-b', audioBufferId: 'buffer-b', startTime: 0, offset: 0,
      duration: 0.01, originalDuration: 0.01, stretchRatio: 1, gain: 0,
      fadeIn: 0, fadeOut: 0, name: 'Clip B',
    }],
  });
  return project;
}

function renderTwoTrackProject(project: IProject) {
  vi.mocked(projectService.openProject).mockResolvedValue(project);
  vi.mocked(projectService.getProject).mockResolvedValue(project);
  renderEditor();
}

async function selectBothClips() {
  fireEvent.click(await screen.findByRole('button', { name: /^Clip A/ }));
  fireEvent.click(await screen.findByRole('button', { name: /^Clip B/ }), { shiftKey: true });
}

beforeEach(() => {
  vi.mocked(historyManager.loadForProject).mockResolvedValue(0);
  vi.mocked(historyManager.canUndo).mockReturnValue(false);
  vi.mocked(historyManager.canRedo).mockReturnValue(false);
  vi.mocked(historyManager.getUndoLabel).mockReturnValue(null);
  vi.mocked(historyManager.getRedoLabel).mockReturnValue(null);
  vi.mocked(historyManager.flush).mockResolvedValue(undefined);
  vi.mocked(projectService.saveProject).mockResolvedValue(undefined);
  vi.mocked(projectService.addGeneratedAudioToTracks).mockImplementation(async (_projectId, targets) =>
    targets.map(({ trackId }, index) => ({
      id: `generated-clip-${index}`,
      audioBufferId: `generated-buffer-${index}`,
      startTime: 0,
      offset: 0,
      duration: 0.01,
      originalDuration: 0.01,
      stretchRatio: 1,
      gain: 0,
      fadeIn: 0,
      fadeOut: 0,
      name: `音调 ${trackId}`,
    } satisfies IClip)));
  vi.mocked(projectService.loadAudioBuffer).mockResolvedValue(null);
  vi.mocked(projectService.silenceSelectionOnTracks).mockResolvedValue(2);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('AudioEditorPage tone command integration', () => {
  it('passes dialog parameters through the Generate menu to projectService', async () => {
    const project = createProject();
    vi.mocked(projectService.openProject).mockResolvedValue(project);
    vi.mocked(projectService.getProject).mockResolvedValue(project);
    renderEditor();
    await openToneDialog();

    fireEvent.change(screen.getByLabelText('频率 (Hz)'), { target: { value: '220' } });
    fireEvent.change(screen.getByLabelText('振幅 (0–1)'), { target: { value: '0.25' } });
    fireEvent.change(screen.getByLabelText('时长（秒）'), { target: { value: '0.01' } });
    fireEvent.click(screen.getByRole('button', { name: '生成音调' }));

    await waitFor(() => expect(projectService.addGeneratedAudioToTracks).toHaveBeenCalledTimes(1));
    const [projectId, targets, sampleRate, startTime, clipName, replacement] =
      vi.mocked(projectService.addGeneratedAudioToTracks).mock.calls[0];
    expect(projectId).toBe(project.id);
    expect(targets).toHaveLength(1);
    expect(targets[0].trackId).toBe('track-1');
    expect(sampleRate).toBe(1000);
    expect(startTime).toBe(0);
    expect(clipName).toBe('音调 220 Hz');
    expect(replacement).toBeUndefined();
    const channels = targets[0].sampleData;
    expect(channels).toHaveLength(1);
    expect(channels[0]).toHaveLength(10);
    expect(Math.max(...channels[0])).toBeLessThanOrEqual(0.25);
    await waitFor(() => expect(projectService.getProject).toHaveBeenCalledWith(project.id));
    expect(historyManager.push).toHaveBeenCalled();
  });

  it('locks the dialog to a sample-quantized selection and replaces that exact range', async () => {
    const project = createProject({ start: 0.1004, end: 0.2996 });
    vi.mocked(projectService.openProject).mockResolvedValue(project);
    vi.mocked(projectService.getProject).mockResolvedValue(project);
    renderEditor();
    await openToneDialog();

    const duration = screen.getByLabelText('时长（秒）') as HTMLInputElement;
    await waitFor(() => expect(duration.value).toBe('0.2'));
    expect(duration.readOnly).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '生成音调' }));

    await waitFor(() => expect(projectService.addGeneratedAudioToTracks).toHaveBeenCalledTimes(1));
    const [, targets, sampleRate, startTime, , replacement] =
      vi.mocked(projectService.addGeneratedAudioToTracks).mock.calls[0];
    expect(sampleRate).toBe(1000);
    expect(startTime).toBe(0.1);
    expect(replacement).toEqual({ start: 0.1, end: 0.3 });
    expect(targets[0].sampleData[0]).toHaveLength(200);
    await waitFor(() => expect(projectService.getProject).toHaveBeenCalledWith(project.id));
  });

  it('generates into every Shift-selected clip track with one history command', async () => {
    const project = createTwoTrackProject();
    renderTwoTrackProject(project);
    await selectBothClips();
    await openToneDialog();
    fireEvent.change(screen.getByLabelText('时长（秒）'), { target: { value: '0.01' } });
    fireEvent.click(screen.getByRole('button', { name: '生成音调' }));

    await waitFor(() => expect(projectService.addGeneratedAudioToTracks).toHaveBeenCalledTimes(1));
    const [, targets, sampleRate, startTime, , replacement] =
      vi.mocked(projectService.addGeneratedAudioToTracks).mock.calls[0];
    expect(targets.map(({ trackId }) => trackId)).toEqual(['track-1', 'track-2']);
    expect(targets.map(({ sampleData }) => sampleData[0].length)).toEqual([10, 10]);
    expect(sampleRate).toBe(1000);
    expect(startTime).toBe(0);
    expect(replacement).toBeUndefined();
    expect(historyManager.push).toHaveBeenCalledTimes(1);
  });

  it('generates distinct noise samples on every selected track', async () => {
    const project = createTwoTrackProject();
    renderTwoTrackProject(project);
    await selectBothClips();
    await openGeneratorDialog('噪声…');
    fireEvent.change(screen.getByLabelText('时长（秒）'), { target: { value: '0.01' } });
    fireEvent.click(screen.getByRole('button', { name: '生成噪声' }));

    await waitFor(() => expect(projectService.addGeneratedAudioToTracks).toHaveBeenCalledTimes(1));
    const [, targets] = vi.mocked(projectService.addGeneratedAudioToTracks).mock.calls[0];
    expect(targets.map(({ trackId }) => trackId)).toEqual(['track-1', 'track-2']);
    expect(targets[0].sampleData[0]).toHaveLength(10);
    expect(targets[0].sampleData[0]).not.toEqual(targets[1].sampleData[0]);
    expect(historyManager.push).toHaveBeenCalledTimes(1);
  });

  it('inserts silence into every selected track with one history command', async () => {
    const project = createTwoTrackProject();
    renderTwoTrackProject(project);
    await selectBothClips();
    await openGeneratorDialog('静默…');
    fireEvent.change(screen.getByLabelText('时长（秒）'), { target: { value: '0.01' } });
    fireEvent.click(screen.getByRole('button', { name: '生成静默' }));

    await waitFor(() => expect(projectService.addGeneratedAudioToTracks).toHaveBeenCalledTimes(1));
    const [, targets] = vi.mocked(projectService.addGeneratedAudioToTracks).mock.calls[0];
    expect(targets.map(({ trackId }) => trackId)).toEqual(['track-1', 'track-2']);
    expect(targets[0].sampleData[0]).toHaveLength(10);
    expect(Array.from(targets[0].sampleData[0])).toEqual(new Array(10).fill(0));
    expect(projectService.silenceSelectionOnTracks).not.toHaveBeenCalled();
    expect(historyManager.push).toHaveBeenCalledTimes(1);
  });

  it('silences the same quantized selection on every selected track', async () => {
    const project = createTwoTrackProject({ start: 0.002, end: 0.008 });
    renderTwoTrackProject(project);
    await selectBothClips();
    await openGeneratorDialog('静默…');
    fireEvent.click(screen.getByRole('button', { name: '生成静默' }));

    await waitFor(() => expect(projectService.silenceSelectionOnTracks).toHaveBeenCalledTimes(1));
    expect(projectService.silenceSelectionOnTracks).toHaveBeenCalledWith(
      project.id,
      ['track-1', 'track-2'],
      { start: 0.002, end: 0.008 },
    );
    expect(projectService.addGeneratedAudioToTracks).not.toHaveBeenCalled();
    expect(historyManager.push).toHaveBeenCalledTimes(1);
  });

  it('prunes generated clip selections after a multi-track undo', async () => {
    const project = createTwoTrackProject();
    const generatedClips = project.tracks.map((track, index) => ({
      id: `generated-clip-${index}`,
      audioBufferId: `generated-buffer-${index}`,
      startTime: 0,
      offset: 0,
      duration: 0.01,
      originalDuration: 0.01,
      stretchRatio: 1,
      gain: 0,
      fadeIn: 0,
      fadeOut: 0,
      name: `音调 ${track.id}`,
    } satisfies IClip));
    const updatedProject: IProject = {
      ...project,
      tracks: project.tracks.map((track, index) => ({
        ...track,
        clips: [...track.clips, generatedClips[index]],
      })),
    };
    vi.mocked(projectService.openProject).mockResolvedValue(project);
    vi.mocked(projectService.getProject).mockResolvedValue(updatedProject);
    vi.mocked(historyManager.canUndo).mockReturnValue(true);
    vi.mocked(historyManager.undo).mockReturnValue({
      project,
      command: {
        id: 'multi-track-tone',
        label: '生成音调',
        execute: () => updatedProject,
        undo: () => project,
      },
    });
    renderEditor();
    await selectBothClips();
    await openToneDialog();
    fireEvent.change(screen.getByLabelText('时长（秒）'), { target: { value: '0.01' } });
    fireEvent.click(screen.getByRole('button', { name: '生成音调' }));

    await screen.findByRole('button', { name: /^音调 track-1/ });
    expect(document.querySelectorAll('.au-clip')).toHaveLength(4);
    expect(screen.getByText('2 个片段')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '撤销' }));

    await waitFor(() => expect(projectService.saveProject).toHaveBeenCalledWith(project));
    expect(document.querySelectorAll('.au-clip')).toHaveLength(2);
    expect(document.querySelectorAll('.au-clip[data-selected="true"]')).toHaveLength(0);
    expect(screen.queryByText('2 个片段')).toBeNull();
  });
});

describe('AudioEditorPage Chirp command integration', () => {
  it('passes logarithmic sweep parameters through the Generate menu to real sample generation', async () => {
    const project = createProject();
    vi.mocked(projectService.openProject).mockResolvedValue(project);
    vi.mocked(projectService.getProject).mockResolvedValue(project);
    renderEditor();
    await openChirpDialog();

    fireEvent.click(screen.getByRole('radio', { name: '对数 (Logarithmic)' }));
    fireEvent.change(screen.getByLabelText('起始频率 (Hz)'), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText('结束频率 (Hz)'), { target: { value: '200' } });
    fireEvent.change(screen.getByLabelText('起始振幅 (0–1)'), { target: { value: '0.2' } });
    fireEvent.change(screen.getByLabelText('结束振幅 (0–1)'), { target: { value: '0.4' } });
    fireEvent.change(screen.getByLabelText('时长（秒）'), { target: { value: '0.01' } });
    fireEvent.click(screen.getByRole('button', { name: '生成扫频' }));

    await waitFor(() => expect(projectService.addGeneratedAudioToTracks).toHaveBeenCalledTimes(1));
    const [projectId, targets, sampleRate, startTime, clipName, replacement] =
      vi.mocked(projectService.addGeneratedAudioToTracks).mock.calls[0];
    expect(projectId).toBe(project.id);
    expect(targets.map(({ trackId }) => trackId)).toEqual(['track-1']);
    expect(sampleRate).toBe(1000);
    expect(startTime).toBe(0);
    expect(clipName).toBe('扫频 100–200 Hz');
    expect(replacement).toBeUndefined();
    expect(targets[0].sampleData[0]).toHaveLength(10);

    const secondFrequency = 10 ** (Math.log10(100) + (Math.log10(200) - Math.log10(100)) / 10);
    const thirdPhase = (100 + secondFrequency) / 1000;
    expect(targets[0].sampleData[0][2]).toBeCloseTo(
      0.24 * Math.sin(2 * Math.PI * thirdPhase),
      6,
    );
    expect(historyManager.push).toHaveBeenCalledTimes(1);
  });

  it('locks Chirp duration to the quantized selection and replaces that exact range', async () => {
    const project = createProject({ start: 0.1004, end: 0.2996 });
    vi.mocked(projectService.openProject).mockResolvedValue(project);
    vi.mocked(projectService.getProject).mockResolvedValue(project);
    renderEditor();
    await openChirpDialog();

    fireEvent.change(screen.getByLabelText('起始频率 (Hz)'), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText('结束频率 (Hz)'), { target: { value: '200' } });
    const duration = screen.getByLabelText('时长（秒）') as HTMLInputElement;
    await waitFor(() => expect(duration.value).toBe('0.2'));
    expect(duration.readOnly).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '生成扫频' }));

    await waitFor(() => expect(projectService.addGeneratedAudioToTracks).toHaveBeenCalledTimes(1));
    const [, targets, sampleRate, startTime, , replacement] =
      vi.mocked(projectService.addGeneratedAudioToTracks).mock.calls[0];
    expect(sampleRate).toBe(1000);
    expect(startTime).toBe(0.1);
    expect(replacement).toEqual({ start: 0.1, end: 0.3 });
    expect(targets[0].sampleData[0]).toHaveLength(200);
    expect(historyManager.push).toHaveBeenCalledTimes(1);
  });

  it('generates the same deterministic Chirp into every selected track with one history command', async () => {
    const project = createTwoTrackProject();
    renderTwoTrackProject(project);
    await selectBothClips();
    await openChirpDialog();
    fireEvent.change(screen.getByLabelText('起始频率 (Hz)'), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText('结束频率 (Hz)'), { target: { value: '200' } });
    fireEvent.change(screen.getByLabelText('时长（秒）'), { target: { value: '0.01' } });
    fireEvent.click(screen.getByRole('button', { name: '生成扫频' }));

    await waitFor(() => expect(projectService.addGeneratedAudioToTracks).toHaveBeenCalledTimes(1));
    const [, targets] = vi.mocked(projectService.addGeneratedAudioToTracks).mock.calls[0];
    expect(targets.map(({ trackId }) => trackId)).toEqual(['track-1', 'track-2']);
    expect(targets.map(({ sampleData }) => sampleData[0].length)).toEqual([10, 10]);
    expect(targets[0].sampleData[0]).toEqual(targets[1].sampleData[0]);
    expect(historyManager.push).toHaveBeenCalledTimes(1);
  });
});
