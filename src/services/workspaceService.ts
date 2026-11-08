import type { ViewMode } from '@/types/project';

export interface WorkspaceLayout {
  showTrackPanel: boolean;
  showMixer: boolean;
  viewMode: ViewMode;
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

const DEFAULT_PRESETS: WorkspacePreset[] = [
  {
    id: 'classic',
    name: 'Classic',
    builtIn: true,
    layout: {
      showTrackPanel: true,
      showMixer: false,
      viewMode: 'waveform',
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
      viewMode: 'both',
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
      viewMode: 'both',
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
  const modes: ViewMode[] = ['waveform', 'spectrum', 'both'];
  return {
    showTrackPanel: typeof value?.showTrackPanel === 'boolean' ? value.showTrackPanel : fallback.showTrackPanel,
    showMixer: typeof value?.showMixer === 'boolean' ? value.showMixer : fallback.showMixer,
    viewMode: modes.includes(value?.viewMode as ViewMode) ? value!.viewMode as ViewMode : fallback.viewMode,
    horizontalZoom: Number.isFinite(value?.horizontalZoom)
      ? Math.max(10, Math.min(500, Number(value!.horizontalZoom)))
      : fallback.horizontalZoom,
    verticalZoom: Number.isFinite(value?.verticalZoom)
      ? Math.max(0.5, Math.min(5, Number(value!.verticalZoom)))
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
    const presets = parsed.presets.slice(0, 50).flatMap((candidate, index) => {
      if (!candidate || typeof candidate.id !== 'string' || typeof candidate.name !== 'string') return [];
      const builtIn = DEFAULT_PRESETS.find((preset) => preset.id === candidate.id);
      return [{
        id: candidate.id.slice(0, 80),
        name: candidate.name.trim().slice(0, 60) || `Workspace ${index + 1}`,
        builtIn: Boolean(builtIn),
        layout: normalizeLayout(candidate.layout, builtIn?.layout ?? fallback.presets[0].layout),
      }];
    });
    for (const preset of fallback.presets) {
      if (!presets.some((candidate) => candidate.id === preset.id)) presets.push(preset);
    }
    const activeId = presets.some((preset) => preset.id === parsed.activeId)
      ? parsed.activeId!
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
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Workspace name cannot be empty');
  if (store.presets.some((preset) => preset.name.toLowerCase() === trimmed.toLowerCase())) {
    throw new Error('Workspace name already exists');
  }
  const preset: WorkspacePreset = {
    id,
    name: trimmed.slice(0, 60),
    builtIn: false,
    layout: { ...layout },
  };
  return { activeId: id, presets: [...store.presets, preset] };
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
