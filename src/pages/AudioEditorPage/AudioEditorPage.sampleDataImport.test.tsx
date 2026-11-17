// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import AudioEditorPage from './AudioEditorPage';
import { projectService } from '@/services/projectService';
import { historyManager } from '@/services/historyService';
import type { IClip, IProject } from '@/types/project';

vi.mock('@/services/projectService', () => ({
  projectService: {
    openProject: vi.fn(), getProject: vi.fn(), addRecordingToTrack: vi.fn(),
    addGeneratedAudioToTracks: vi.fn(), silenceSelectionOnTracks: vi.fn(),
    loadAudioBuffer: vi.fn(), loadAudioChannels: vi.fn(), saveProject: vi.fn(),
  },
}));

vi.mock('@/services/historyService', () => ({
  historyManager: {
    loadForProject: vi.fn(), canUndo: vi.fn(), canRedo: vi.fn(),
    getUndoLabel: vi.fn(), getRedoLabel: vi.fn(), push: vi.fn(), pushCommand: vi.fn(),
    undo: vi.fn(), redo: vi.fn(), flush: vi.fn(), getHistoryState: vi.fn(() => ({ canUndo: false, canRedo: false })),
  },
}));

vi.mock('@/engine/audioEngine', () => ({
  audioEngine: {
    setCursorChangeCallback: vi.fn(), setStateChangeCallback: vi.fn(),
    getPlaybackLevels: vi.fn(() => ({ left: -Infinity, right: -Infinity })),
    getRecordingLevels: vi.fn(() => ({ left: -Infinity, right: -Infinity })),
    cacheBuffer: vi.fn(), processClipChannels: vi.fn((_clip, channels) => channels), seek: vi.fn(),
  },
}));

vi.mock('@/wasm/processor', () => ({
  isWasmAvailable: vi.fn(() => false),
  wasmProcessor: { spectrogram: vi.fn(), sliceBuffer: vi.fn() },
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
  Toaster: () => null,
}));

function makeClip(id: string): IClip {
  return {
    id, audioBufferId: `buffer-${id}`, startTime: 0, offset: 0,
    duration: 0.2, originalDuration: 0.2, stretchRatio: 1,
    gain: 0, fadeIn: 0, fadeOut: 0, name: `Clip ${id.toUpperCase()}`,
  };
}

function makeProject(): IProject {
  return {
    id: 'project-sample-data-import', name: 'Sample Data Import integration', createdAt: 1, updatedAt: 1,
    sampleRate: 1000, tempo: 120, timeSignature: { numerator: 4, denominator: 4 }, cursorPosition: 0.02,
    tracks: [
      { id: 'track-a', name: 'Track A', type: 'audio', clips: [makeClip('a')], muted: false, solo: false, armed: false, gain: 0, pan: 0, effects: [], color: '#7aa2f7' },
      { id: 'track-b', name: 'Track B', type: 'audio', clips: [makeClip('b')], muted: false, solo: false, armed: false, gain: 0, pan: 0, effects: [], color: '#7aa2f7' },
    ],
    viewState: { horizontalZoom: 100, verticalZoom: 1, scrollX: 0, viewMode: 'waveform', snapEnabled: false, snapMode: 'clips' },
    selection: { start: 0.05, end: 0.1 }, loopRegion: null, loopEnabled: false,
  };
}

let currentProject: IProject;

function renderEditor(): void {
  render(<MemoryRouter initialEntries={['/editor/project-sample-data-import']}><Routes><Route path="/editor/:projectId" element={<AudioEditorPage />} /></Routes></MemoryRouter>);
}

async function openSampleDataImport(): Promise<HTMLElement> {
  const trigger = await screen.findByRole('button', { name: '生成' });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  return screen.findByRole('menuitem', { name: 'Sample Data Import… 采样数据导入…' });
}

function chooseFile(content: string | Uint8Array, name = 'samples.txt'): void {
  const file = new File([content as BlobPart], name, { type: 'text/plain' });
  fireEvent.change(screen.getByLabelText('Select file'), { target: { files: [file] } });
}

beforeEach(() => {
  window.localStorage.clear();
  currentProject = makeProject();
  vi.mocked(projectService.openProject).mockImplementation(async () => currentProject);
  vi.mocked(projectService.getProject).mockImplementation(async () => currentProject);
  vi.mocked(projectService.saveProject).mockResolvedValue(undefined);
  vi.mocked(projectService.loadAudioBuffer).mockResolvedValue(null);
  vi.mocked(projectService.loadAudioChannels).mockResolvedValue([new Float32Array(200).fill(0.5)]);
  vi.mocked(projectService.addGeneratedAudioToTracks).mockImplementation(async (_projectId, targets, sampleRate, startTime, clipName) => {
    const clips = targets.map((target): IClip => ({
      id: `imported-${target.trackId}`, audioBufferId: `imported-buffer-${target.trackId}`,
      startTime, offset: 0, duration: target.sampleData[0].length / sampleRate,
      originalDuration: target.sampleData[0].length / sampleRate, stretchRatio: 1,
      gain: 0, fadeIn: 0, fadeOut: 0, name: clipName,
    }));
    currentProject = {
      ...currentProject,
      tracks: currentProject.tracks.map((track) => {
        const index = targets.findIndex((target) => target.trackId === track.id);
        return index < 0 ? track : { ...track, clips: [...track.clips, clips[index]!] };
      }),
    };
    return clips;
  });
  vi.mocked(historyManager.loadForProject).mockResolvedValue(0);
  vi.mocked(historyManager.canUndo).mockReturnValue(false);
  vi.mocked(historyManager.canRedo).mockReturnValue(false);
  vi.mocked(historyManager.getUndoLabel).mockReturnValue(null);
  vi.mocked(historyManager.getRedoLabel).mockReturnValue(null);
  vi.mocked(historyManager.flush).mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('AudioEditorPage Sample Data Import integration', () => {
  it('opens the two official controls and imports mono audio with selection replacement and history', async () => {
    renderEditor();
    await screen.findByText('Sample Data Import integration');
    fireEvent.click(await openSampleDataImport());
    expect(await screen.findByRole('dialog', { name: 'Sample Data Import' })).toBeInTheDocument();
    expect(screen.getByLabelText('Select file')).toHaveAttribute('type', 'file');
    expect(screen.getByLabelText('Invalid data handling')).toHaveValue('throw-error');
    expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled();

    chooseFile('0\n0.5\n-0.25\n1');
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    await waitFor(() => expect(projectService.addGeneratedAudioToTracks).toHaveBeenCalledTimes(1));
    const call = vi.mocked(projectService.addGeneratedAudioToTracks).mock.calls[0];
    expect(call[1][0].trackId).toBe('track-a');
    expect(Array.from(call[1][0].sampleData[0])).toEqual([0, 0.5, -0.25, 1]);
    expect(call[2]).toBe(1000);
    expect(call[3]).toBe(0.05);
    expect(call[4]).toBe('samples');
    expect(call[5]).toEqual({ start: 0.05, end: 0.1, allowDurationChange: true });
    expect(historyManager.push).toHaveBeenCalledWith(expect.objectContaining({ label: 'Sample Data Import' }), expect.anything());
    expect(await screen.findByRole('status')).toHaveTextContent('Imported 1 track.');
  });

  it('detects a stereo target and deinterleaves pairs with a final silent right sample', async () => {
    vi.mocked(projectService.loadAudioChannels).mockResolvedValue([
      new Float32Array(200).fill(0.5), new Float32Array(200).fill(-0.5),
    ]);
    renderEditor();
    await screen.findByText('Sample Data Import integration');
    fireEvent.click(await openSampleDataImport());
    chooseFile('0.1 -0.1 0.2 -0.2 0.3');
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));

    await waitFor(() => expect(projectService.addGeneratedAudioToTracks).toHaveBeenCalledTimes(1));
    const target = vi.mocked(projectService.addGeneratedAudioToTracks).mock.calls[0][1][0];
    expect(target.sampleData).toHaveLength(2);
    expect(Array.from(target.sampleData[0])).toEqual([0.10000000149011612, 0.20000000298023224, 0.30000001192092896]);
    expect(Array.from(target.sampleData[1])).toEqual([-0.10000000149011612, -0.20000000298023224, 0]);
    expect(await screen.findByRole('status')).toHaveTextContent('Final unpaired right sample padded with zero.');
  });

  it('reads invalid values as zero only when explicitly selected', async () => {
    renderEditor();
    await screen.findByText('Sample Data Import integration');
    fireEvent.click(await openSampleDataImport());
    chooseFile('0 bad [-inf] 0.5');
    fireEvent.change(screen.getByLabelText('Invalid data handling'), { target: { value: 'read-as-zero' } });
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));

    await waitFor(() => expect(projectService.addGeneratedAudioToTracks).toHaveBeenCalledTimes(1));
    const target = vi.mocked(projectService.addGeneratedAudioToTracks).mock.calls[0][1][0];
    expect(Array.from(target.sampleData[0])).toEqual([0, 0, 0, 0.5]);
    expect(await screen.findByRole('status')).toHaveTextContent('2 invalid values read as zero.');
  });

  it('rejects invalid data and non-ASCII bytes without writing audio or history', async () => {
    renderEditor();
    await screen.findByText('Sample Data Import integration');
    fireEvent.click(await openSampleDataImport());
    chooseFile('0 bad');
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('not a numeric value');
    expect(projectService.addGeneratedAudioToTracks).not.toHaveBeenCalled();
    expect(historyManager.push).not.toHaveBeenCalled();

    chooseFile(Uint8Array.from([48, 10, 195, 169]));
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('plain ASCII text');
    expect(projectService.addGeneratedAudioToTracks).not.toHaveBeenCalled();
    expect(historyManager.push).not.toHaveBeenCalled();
  });

  it('rejects inconsistent channel layouts before any project write', async () => {
    currentProject.tracks[0]!.clips.push(makeClip('a2'));
    vi.mocked(projectService.loadAudioChannels).mockImplementation(async (id: string) => (
      id === 'buffer-a' ? [new Float32Array(200)] : [new Float32Array(200), new Float32Array(200)]
    ));
    renderEditor();
    await screen.findByText('Sample Data Import integration');
    fireEvent.click(await openSampleDataImport());
    chooseFile('0 1');
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('不一致的声道布局');
    expect(projectService.addGeneratedAudioToTracks).not.toHaveBeenCalled();
    expect(historyManager.push).not.toHaveBeenCalled();
  });

  it('imports to every explicitly selected track with one history entry', async () => {
    renderEditor();
    await screen.findByText('Sample Data Import integration');
    fireEvent.click(await screen.findByRole('button', { name: /^Clip A/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Clip B/ }), { shiftKey: true });
    fireEvent.click(await openSampleDataImport());
    chooseFile('0 1');
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));

    await waitFor(() => expect(projectService.addGeneratedAudioToTracks).toHaveBeenCalledTimes(1));
    const targets = vi.mocked(projectService.addGeneratedAudioToTracks).mock.calls[0][1];
    expect(targets.map((target) => target.trackId)).toEqual(['track-a', 'track-b']);
    expect(targets.every((target) => Array.from(target.sampleData[0]).join(',') === '0,1')).toBe(true);
    expect(historyManager.push).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('status')).toHaveTextContent('Imported 2 tracks.');
  });
});
