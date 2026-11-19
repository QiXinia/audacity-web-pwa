import type { ViewMode } from '@/types/project';
import { normalizeHorizontalZoom } from '@/lib/horizontalZoom';
import { normalizeVerticalZoom } from '@/lib/verticalZoom';

export interface WorkspaceLayout {
  showTrackPanel: boolean;
  showMixer: boolean;
  showClipping: boolean;
  showRMS: boolean;
  showVerticalRulers: boolean;
  viewMode: ViewMode;
  halfWave: boolean;
  horizontalZoom: number;
  verticalZoom: number;
}

export interface WorkspacePreset {
  id: string;
  name: string;
  builtIn: boolean;
  layout: WorkspaceLayout;
}

export interface WorkspaceStore {
  activeId: string;
  presets: WorkspacePreset[];
}

export const WORKSPACE_STORAGE_KEY = 'audacity-web:workspaces:v1';

function normalizeWorkspaceId(id: string): string {
  return id.trim().slice(0, 80);
}

function normalizeWorkspaceName(name: string): string {
  return name.trim().slice(0, 60);
}

function workspaceNameKey(name: string): string {
  return normalizeWorkspaceName(name).toLowerCase();
}

const DEFAULT_PRESETS: WorkspacePreset[] = [
  {
    id: 'classic',
    name: 'Classic',
    builtIn: true,
    layout: {
      showTrackPanel: true,
      showMixer: false,
      showClipping: false,
      showRMS: false,
      showVerticalRulers: true,
      viewMode: 'waveform',
      halfWave: false,
      horizontalZoom: 100,
      verticalZoom: 1,
    },
  },
  {
    id: 'modern',
    name: 'Modern',
    builtIn: true,
    layout: {
      showTrackPanel: true,
      showMixer: false,
      showClipping: false,
      showRMS: false,
      showVerticalRulers: true,
      viewMode: 'both',
      halfWave: false,
      horizontalZoom: 100,
      verticalZoom: 1,
    },
  },
  {
    id: 'music',
    name: 'Music',
    builtIn: true,
    layout: {
      showTrackPanel: true,
      showMixer: true,
      showClipping: false,
      showRMS: false,
      showVerticalRulers: true,
      viewMode: 'both',
      halfWave: false,
      horizontalZoom: 100,
      verticalZoom: 1.25,
    },
  },
];

export function defaultWorkspaceStore(): WorkspaceStore {
  return {
    activeId: 'classic',
    presets: DEFAULT_PRESETS.map((preset) => ({
      ...preset,
      layout: { ...preset.layout },
    })),
  };
}

function normalizeLayout(value: Partial<WorkspaceLayout> | undefined, fallback: WorkspaceLayout): WorkspaceLayout {
  const modes: ViewMode[] = ['waveform', 'waveformDb', 'waveformDbLinear', 'spectrum', 'both'];
  return {
    showTrackPanel: typeof value?.showTrackPanel === 'boolean' ? value.showTrackPanel : fallback.showTrackPanel,
    showMixer: typeof value?.showMixer === 'boolean' ? value.showMixer : fallback.showMixer,
    showClipping: typeof value?.showClipping === 'boolean' ? value.showClipping : fallback.showClipping,
    showRMS: typeof value?.showRMS === 'boolean' ? value.showRMS : fallback.showRMS,
    showVerticalRulers: typeof value?.showVerticalRulers === 'boolean'
      ? value.showVerticalRulers
      : fallback.showVerticalRulers,
    viewMode: modes.includes(value?.viewMode as ViewMode) ? value!.viewMode as ViewMode : fallback.viewMode,
    halfWave: typeof value?.halfWave === 'boolean' ? value.halfWave : fallback.halfWave,
    horizontalZoom: Number.isFinite(value?.horizontalZoom)
      ? normalizeHorizontalZoom(Number(value!.horizontalZoom), fallback.horizontalZoom)
      : fallback.horizontalZoom,
    verticalZoom: Number.isFinite(value?.verticalZoom)
      ? normalizeVerticalZoom(Number(value!.verticalZoom))
      : fallback.verticalZoom,
  };
}

export function loadWorkspaceStore(storage?: Pick<Storage, 'getItem'>): WorkspaceStore {
  const fallback = defaultWorkspaceStore();
  try {
    const target = storage ?? (typeof window !== 'undefined' ? window.localStorage : undefined);
    const raw = target?.getItem(WORKSPACE_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<WorkspaceStore>;
    if (!Array.isArray(parsed.presets)) return fallback;
    const seenIds = new Set<string>();
    const seenNames = new Set<string>();
    const presets = parsed.presets.slice(0, 50).flatMap((candidate, index) => {
      if (!candidate || typeof candidate.id !== 'string' || typeof candidate.name !== 'string') return [];
      const id = normalizeWorkspaceId(candidate.id);
      if (!id || seenIds.has(id)) return [];
      const name = normalizeWorkspaceName(candidate.name) || `Workspace ${index + 1}`;
      const nameKey = workspaceNameKey(name);
      const builtIn = DEFAULT_PRESETS.find((preset) => preset.id === id);
      const reservedNameOwner = DEFAULT_PRESETS.find((preset) => workspaceNameKey(preset.name) === nameKey);
      if (seenNames.has(nameKey) || (reservedNameOwner && reservedNameOwner.id !== id)) return [];
      seenIds.add(id);
      seenNames.add(nameKey);
      return [{
        id,
        name,
        builtIn: Boolean(builtIn),
        layout: normalizeLayout(candidate.layout, builtIn?.layout ?? fallback.presets[0].layout),
      }];
    });
    for (const preset of fallback.presets) {
      if (!presets.some((candidate) => candidate.id === preset.id)) presets.push(preset);
    }
    const normalizedActiveId = typeof parsed.activeId === 'string' ? normalizeWorkspaceId(parsed.activeId) : '';
    const activeId = presets.some((preset) => preset.id === normalizedActiveId)
      ? normalizedActiveId
      : fallback.activeId;
    return { activeId, presets };
  } catch {
    return fallback;
  }
}

export function saveWorkspaceStore(
  store: WorkspaceStore,
  storage?: Pick<Storage, 'setItem'>,
): boolean {
  try {
    const target = storage ?? (typeof window !== 'undefined' ? window.localStorage : undefined);
    if (!target) return false;
    target.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(store));
    return true;
  } catch {
    // Privacy mode, quota and security failures must not break layout updates.
    return false;
  }
}

export function createWorkspace(
  store: WorkspaceStore,
  id: string,
  name: string,
  layout: WorkspaceLayout,
): WorkspaceStore {
  const normalizedName = normalizeWorkspaceName(name);
  if (!normalizedName) throw new Error('Workspace name cannot be empty');
  const normalizedId = normalizeWorkspaceId(id);
  if (!normalizedId) throw new Error('Workspace id cannot be empty');
  if (store.presets.some((preset) => normalizeWorkspaceId(preset.id) === normalizedId)) {
    throw new Error('Workspace id already exists');
  }
  if (store.presets.some((preset) => workspaceNameKey(preset.name) === workspaceNameKey(normalizedName))) {
    throw new Error('Workspace name already exists');
  }
  const preset: WorkspacePreset = {
    id: normalizedId,
    name: normalizedName,
    builtIn: false,
    layout: { ...layout },
  };
  return { activeId: normalizedId, presets: [...store.presets, preset] };
}

export function updateWorkspaceLayout(
  store: WorkspaceStore,
  layout: WorkspaceLayout,
): WorkspaceStore {
  return {
    ...store,
    presets: store.presets.map((preset) =>
      preset.id === store.activeId ? { ...preset, layout: { ...layout } } : preset,
    ),
  };
}

export function removeWorkspace(store: WorkspaceStore, id: string): WorkspaceStore {
  const target = store.presets.find((preset) => preset.id === id);
  if (!target || target.builtIn) return store;
  const presets = store.presets.filter((preset) => preset.id !== id);
  return { activeId: store.activeId === id ? 'classic' : store.activeId, presets };
}

export function resetWorkspace(store: WorkspaceStore, id: string): WorkspaceStore {
  const original = DEFAULT_PRESETS.find((preset) => preset.id === id);
  if (!original) return store;
  return {
    ...store,
    presets: store.presets.map((preset) =>
      preset.id === id ? { ...original, layout: { ...original.layout } } : preset,
    ),
  };
}
