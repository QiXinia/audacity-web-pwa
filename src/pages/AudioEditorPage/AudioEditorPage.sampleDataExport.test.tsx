// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import AudioEditorPage from './AudioEditorPage';
import { projectService } from '@/services/projectService';
import { historyManager } from '@/services/historyService';
import type { IClip, IProject } from '@/types/project';

const mocks = vi.hoisted(() => ({ processClip: vi.fn() }));

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
    cacheBuffer: vi.fn(), processClipChannels: mocks.processClip, seek: vi.fn(),
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
    id: 'project-sample-data-export', name: 'Sample Data Export integration', createdAt: 1, updatedAt: 1,
    sampleRate: 1000, tempo: 120, timeSignature: { numerator: 4, denominator: 4 }, cursorPosition: 0,
    tracks: [
      { id: 'track-a', name: 'Track A', type: 'audio', clips: [makeClip('a')], muted: false, solo: false, armed: false, gain: 0, pan: 0, effects: [], color: '#7aa2f7' },
      { id: 'track-b', name: 'Track B', type: 'audio', clips: [makeClip('b')], muted: false, solo: false, armed: false, gain: 0, pan: 0, effects: [], color: '#7aa2f7' },
    ],
    viewState: { horizontalZoom: 100, verticalZoom: 1, scrollX: 0, viewMode: 'waveform', snapEnabled: false, snapMode: 'clips' },
    selection: { start: 0, end: 0.2 }, loopRegion: null, loopEnabled: false,
  };
}

function renderEditor(): void {
  render(<MemoryRouter initialEntries={['/editor/project-sample-data-export']}><Routes><Route path="/editor/:projectId" element={<AudioEditorPage />} /></Routes></MemoryRouter>);
}

async function openSampleDataExport(): Promise<HTMLElement> {
  const trigger = await screen.findByRole('button', { name: '分析' });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  return screen.findByRole('menuitem', { name: 'Sample Data Export… 采样数据导出…' });
}

let capturedBlob: Blob | null;
let downloadedName: string;
const createObjectURL = vi.fn((_blob: Blob) => 'blob:sample-data');
const revokeObjectURL = vi.fn();

beforeEach(() => {
  window.localStorage.clear();
  capturedBlob = null;
  downloadedName = '';
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn((blob: Blob) => { capturedBlob = blob; return createObjectURL(blob); }),
  });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () { downloadedName = this.download; });

  const project = makeProject();
  vi.mocked(projectService.openProject).mockResolvedValue(project);
  vi.mocked(projectService.getProject).mockResolvedValue(project);
  vi.mocked(projectService.saveProject).mockResolvedValue(undefined);
  vi.mocked(projectService.loadAudioBuffer).mockResolvedValue(null);
  vi.mocked(projectService.loadAudioChannels).mockImplementation(async (id: string) => {
    if (id === 'buffer-a') return [new Float32Array(200).fill(0.5)];
    return [new Float32Array(200).fill(0.25)];
  });
  mocks.processClip.mockImplementation((_clip: IClip, channels: Float32Array[]) => channels);
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

describe('AudioEditorPage Sample Data Export integration', () => {
  it('opens all official controls and exports the default 100 mono dB samples without writes', async () => {
    renderEditor();
    await screen.findByText('Sample Data Export integration');
    fireEvent.click(await screen.findByRole('button', { name: /^Clip A/ }));
    fireEvent.click(await openSampleDataExport());

    expect(await screen.findByRole('dialog', { name: 'Sample Data Export' })).toBeInTheDocument();
    expect(screen.getByLabelText('Limit output to first (samples)')).toHaveValue(100);
    expect(screen.getByLabelText('Measurement scale')).toHaveValue('db');
    expect(screen.getByLabelText('Export data to (filename)')).toHaveValue('sample-data.txt');
    expect(screen.getByLabelText('Index (text files only)')).toHaveValue('none');
    expect(screen.getByLabelText('Include header information')).toHaveValue('none');
    expect(screen.getByLabelText('Channel layout for stereo')).toHaveValue('same-line');
    expect(screen.getByLabelText('Show messages')).toHaveValue('yes');

    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    await waitFor(() => expect(capturedBlob).not.toBeNull());
    expect(downloadedName).toBe('sample-data.txt');
    const text = await (capturedBlob as unknown as Blob).text();
    expect(text.split('\n')).toHaveLength(101);
    expect(text.startsWith('-6.02060\n')).toBe(true);
    expect(await screen.findByRole('status')).toHaveTextContent('100 samples');
    expect(projectService.loadAudioChannels).toHaveBeenCalledWith('buffer-a', 1000);
    expect(projectService.loadAudioChannels).not.toHaveBeenCalledWith('buffer-b');
    expect(projectService.saveProject).not.toHaveBeenCalled();
    expect(historyManager.push).not.toHaveBeenCalled();
    expect(historyManager.push).not.toHaveBeenCalled();
    expect(projectService.addGeneratedAudioToTracks).not.toHaveBeenCalled();
  });

  it('exports effective stereo PCM as left-channel-first CSV', async () => {
    vi.mocked(projectService.loadAudioChannels).mockResolvedValue([
      new Float32Array(200).fill(0.5), new Float32Array(200).fill(-0.25),
    ]);
    renderEditor();
    await screen.findByText('Sample Data Export integration');
    fireEvent.click(await openSampleDataExport());
    fireEvent.change(await screen.findByLabelText('Limit output to first (samples)'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Measurement scale'), { target: { value: 'linear' } });
    fireEvent.change(screen.getByLabelText('Export data to (filename)'), { target: { value: 'samples.csv' } });
    fireEvent.change(screen.getByLabelText('Channel layout for stereo'), { target: { value: 'left-first' } });
    expect(screen.getByLabelText('Index (text files only)')).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    await waitFor(() => expect(capturedBlob).not.toBeNull());
    expect(downloadedName).toBe('samples.csv');
    expect((capturedBlob as unknown as Blob).type).toBe('text/csv;charset=utf-8');
    expect(await (capturedBlob as unknown as Blob).text()).toBe('0.50000,0.50000,\n-0.25000,-0.25000,');
    expect(projectService.saveProject).not.toHaveBeenCalled();
    expect(historyManager.push).not.toHaveBeenCalled();
  });

  it('exports escaped HTML with both measurement scales', async () => {
    renderEditor();
    await screen.findByText('Sample Data Export integration');
    fireEvent.click(await openSampleDataExport());
    fireEvent.change(await screen.findByLabelText('Limit output to first (samples)'), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText('Export data to (filename)'), { target: { value: 'samples.html' } });
    fireEvent.change(screen.getByLabelText('Optional header text'), { target: { value: '<script>alert(1)</script>' } });
    expect(screen.getByLabelText('Measurement scale')).toBeDisabled();
    expect(screen.getByLabelText('Include header information')).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    await waitFor(() => expect(capturedBlob).not.toBeNull());
    const html = await (capturedBlob as unknown as Blob).text();
    expect(html).toContain('<th>Value (linear)</th><th>Value (dB)</th>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('<td>0.50000</td><td>-6.02060</td>');
  });

  it('rejects ambiguous multi-track export before creating a download', async () => {
    renderEditor();
    await screen.findByText('Sample Data Export integration');
    fireEvent.click(await screen.findByRole('button', { name: /^Clip A/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Clip B/ }), { shiftKey: true });
    fireEvent.click(await openSampleDataExport());
    fireEvent.click(await screen.findByRole('button', { name: 'Export' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('一次仅支持一条目标音轨');
    expect(capturedBlob).toBeNull();
    expect(projectService.saveProject).not.toHaveBeenCalled();
    expect(historyManager.push).not.toHaveBeenCalled();
  });

  it('disables the command without a real time selection', async () => {
    const withoutSelection: IProject = { ...makeProject(), selection: null };
    vi.mocked(projectService.openProject).mockResolvedValue(withoutSelection);
    vi.mocked(projectService.getProject).mockResolvedValue(withoutSelection);
    renderEditor();
    await screen.findByText('Sample Data Export integration');

    expect(await openSampleDataExport()).toHaveAttribute('aria-disabled', 'true');
    expect(screen.queryByRole('dialog', { name: 'Sample Data Export' })).not.toBeInTheDocument();
  });

  it('blocks invalid sample limits in the dialog', async () => {
    renderEditor();
    await screen.findByText('Sample Data Export integration');
    fireEvent.click(await openSampleDataExport());
    fireEvent.change(await screen.findByLabelText('Limit output to first (samples)'), { target: { value: '0' } });

    expect(screen.getByRole('alert')).toHaveTextContent('1–1000000');
    expect(screen.getByRole('button', { name: 'Export' })).toBeDisabled();
    expect(capturedBlob).toBeNull();
  });
});
