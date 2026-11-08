// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { toast } from 'sonner';
import AudioEditorPage from '@/pages/AudioEditorPage/AudioEditorPage';
import { projectService } from '@/services/projectService';
import { historyManager } from '@/services/historyService';
import { WORKSPACE_STORAGE_KEY } from '@/services/workspaceService';
import { DEFAULT_HORIZONTAL_ZOOM } from '@/lib/horizontalZoom';
import type { IProject } from '@/types/project';

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
  Toaster: () => null,
}));

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

const project: IProject = {
  id: 'project-workspace-storage',
  name: 'Workspace storage integration',
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
  selection: null,
  loopRegion: null,
  loopEnabled: false,
};

const audioProject: IProject = {
  ...project,
  tracks: [{
    ...project.tracks[0],
    clips: [{
      id: 'clip-1',
      audioBufferId: 'buffer-1',
      startTime: 2,
      offset: 0,
      duration: 8,
      originalDuration: 8,
      gain: 1,
      fadeIn: 0,
      fadeOut: 0,
      name: 'Eight seconds',
    }],
  }],
  selection: { start: 3, end: 7 },
};

function renderEditor() {
  return render(
    <MemoryRouter initialEntries={[`/editor/${project.id}`]}>
      <Routes>
        <Route path="/editor/:projectId" element={<AudioEditorPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

async function openWorkspaceMenu() {
  const trigger = await screen.findByRole('button', { name: 'Workspace 工作区' });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  return screen.findByText('将当前布局另存为…');
}

async function openViewMenu() {
  const trigger = await screen.findByRole('button', { name: '视图' });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  return screen.findByRole('menuitem', { name: '纵向放大' });
}

async function clickViewItem(name: string) {
  await openViewMenu();
  fireEvent.click(screen.getByRole('menuitem', { name }));
}

beforeEach(() => {
  vi.mocked(projectService.openProject).mockResolvedValue(project);
  vi.mocked(projectService.getProject).mockResolvedValue(project);
  vi.mocked(projectService.loadAudioBuffer).mockResolvedValue(null);
  vi.mocked(projectService.saveProject).mockResolvedValue(undefined);
  vi.mocked(historyManager.loadForProject).mockResolvedValue(0);
  vi.mocked(historyManager.canUndo).mockReturnValue(false);
  vi.mocked(historyManager.canRedo).mockReturnValue(false);
  vi.mocked(historyManager.getUndoLabel).mockReturnValue(null);
  vi.mocked(historyManager.getRedoLabel).mockReturnValue(null);
  vi.mocked(historyManager.flush).mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('AudioEditorPage Workspace storage integration', () => {
  it('keeps a failed save editable and persists it after storage recovers', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Injected storage quota failure', 'QuotaExceededError');
    });
    renderEditor();
    await screen.findByText(project.name);

    fireEvent.click(await openWorkspaceMenu());
    expect(await screen.findByRole('dialog')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Workspace 名称'), {
      target: { value: 'Storage failure recovery' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存 Workspace' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(
      '浏览器存储不可用，Workspace 更改仅在本次会话保留',
    ));
    expect(toast.success).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect((screen.getByLabelText('Workspace 名称') as HTMLInputElement).value)
      .toBe('Storage failure recovery');
    expect(setItem).toHaveBeenCalledWith(WORKSPACE_STORAGE_KEY, expect.any(String));
    expect(window.localStorage.getItem(WORKSPACE_STORAGE_KEY)).toBeNull();

    setItem.mockImplementation(() => {});
    fireEvent.click(screen.getByRole('button', { name: '保存 Workspace' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(toast.success).toHaveBeenCalledWith('Workspace 已保存到当前浏览器');
    const lastWrite = setItem.mock.calls.at(-1);
    expect(lastWrite?.[0]).toBe(WORKSPACE_STORAGE_KEY);
    const persisted = JSON.parse(lastWrite?.[1] ?? '{}');
    expect(persisted.presets.some((preset: { name: string }) =>
      preset.name === 'Storage failure recovery')).toBe(true);
    expect(persisted.activeId).not.toBe('classic');

    await openWorkspaceMenu();
    expect(await screen.findAllByText('Storage failure recovery')).not.toHaveLength(0);
  });
});

describe('AudioEditorPage vertical zoom controls', () => {
  it('zooms in and out in Audacity steps, persists the state, and resets to 100%', async () => {
    window.localStorage.removeItem(WORKSPACE_STORAGE_KEY);
    renderEditor();
    await screen.findByText(project.name);

    await clickViewItem('纵向放大');
    await openViewMenu();
    expect(screen.getByText('纵向缩放 200%')).toBeTruthy();
    fireEvent.click(screen.getByRole('menuitem', { name: '纵向缩小' }));

    await clickViewItem('纵向放大');
    await waitFor(() => {
      const persisted = JSON.parse(window.localStorage.getItem(WORKSPACE_STORAGE_KEY) ?? '{}');
      const active = persisted.presets?.find((preset: { id: string }) => preset.id === persisted.activeId);
      expect(active?.layout.verticalZoom).toBe(2);
    });

    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(projectService.saveProject).toHaveBeenCalled());
    const saved = vi.mocked(projectService.saveProject).mock.calls.at(-1)?.[0];
    expect(saved?.viewState.verticalZoom).toBe(2);

    await clickViewItem('重置纵向缩放');
    await openViewMenu();
    expect(screen.getByText('纵向缩放 100%')).toBeTruthy();
  });
});

describe('AudioEditorPage horizontal zoom controls', () => {
  it('uses Audacity 2x steps, normal zoom and keyboard shortcuts', async () => {
    window.localStorage.removeItem(WORKSPACE_STORAGE_KEY);
    renderEditor();
    await screen.findByText(project.name);

    await clickViewItem('水平放大 (Ctrl+1)');
    await openViewMenu();
    expect(screen.getByText('水平缩放 200%')).toBeTruthy();
    fireEvent.click(screen.getByRole('menuitem', { name: '正常大小 (Ctrl+2)' }));

    await openViewMenu();
    expect(screen.getByText(`水平缩放 ${Math.round(DEFAULT_HORIZONTAL_ZOOM)}%`)).toBeTruthy();
    fireEvent.click(screen.getByRole('menuitem', { name: '正常大小 (Ctrl+2)' }));
    fireEvent.keyDown(document.body, { key: '1', ctrlKey: true });
    await openViewMenu();
    expect(screen.getByText(`水平缩放 ${Math.round(DEFAULT_HORIZONTAL_ZOOM * 2)}%`)).toBeTruthy();
  });

  it('zooms to the selection, scrolls to its start, fits the project and persists both scales', async () => {
    window.localStorage.removeItem(WORKSPACE_STORAGE_KEY);
    vi.mocked(projectService.openProject).mockResolvedValue(audioProject);
    vi.mocked(projectService.getProject).mockResolvedValue(audioProject);
    renderEditor();
    await screen.findByText(audioProject.name);
    const viewport = await screen.findByTestId('timeline-viewport');
    Object.defineProperty(viewport, 'clientWidth', { configurable: true, value: 800 });

    await clickViewItem('缩放至选区 (Ctrl+E)');
    await waitFor(() => expect(viewport.scrollLeft).toBeCloseTo(3 * 199.75));
    await openViewMenu();
    expect(screen.getByText('水平缩放 200%')).toBeTruthy();
    await waitFor(() => {
      const persisted = JSON.parse(window.localStorage.getItem(WORKSPACE_STORAGE_KEY) ?? '{}');
      const active = persisted.presets?.find((preset: { id: string }) => preset.id === persisted.activeId);
      expect(active?.layout.horizontalZoom).toBeCloseTo(199.75);
    });

    fireEvent.click(screen.getByRole('menuitem', { name: '适应宽度 (Ctrl+F)' }));
    await waitFor(() => expect(viewport.scrollLeft).toBe(0));
    await openViewMenu();
    expect(screen.getByText('水平缩放 80%')).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    fireEvent.click(await screen.findByRole('button', { name: '保存' }));
    await waitFor(() => expect(projectService.saveProject).toHaveBeenCalled());
    const saved = vi.mocked(projectService.saveProject).mock.calls.at(-1)?.[0];
    expect(saved?.viewState.horizontalZoom).toBeCloseTo(79.9);
    expect(saved?.selection).toEqual({ start: 3, end: 7 });
  });
});
