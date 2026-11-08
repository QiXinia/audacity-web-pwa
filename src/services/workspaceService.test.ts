import { describe, expect, it } from 'vitest';
import {
  createWorkspace,
  defaultWorkspaceStore,
  loadWorkspaceStore,
  removeWorkspace,
  resetWorkspace,
  saveWorkspaceStore,
  updateWorkspaceLayout,
  WORKSPACE_STORAGE_KEY,
  type WorkspaceLayout,
} from '@/services/workspaceService';

const layout: WorkspaceLayout = {
  showTrackPanel: false,
  showMixer: true,
  viewMode: 'spectrum',
  horizontalZoom: 240,
  verticalZoom: 2,
};

describe('Workspace persistence', () => {
  it('ships the official Classic, Modern and Music entry points', () => {
    expect(defaultWorkspaceStore().presets.map((preset) => preset.name)).toEqual(['Classic', 'Modern', 'Music']);
  });

  it('round-trips a custom workspace through storage', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    };
    const custom = createWorkspace(defaultWorkspaceStore(), 'custom-1', 'Podcast', layout);
    expect(saveWorkspaceStore(custom, storage)).toBe(true);
    expect(values.has(WORKSPACE_STORAGE_KEY)).toBe(true);
    const restored = loadWorkspaceStore(storage);
    expect(restored.activeId).toBe('custom-1');
    expect(restored.presets.find((preset) => preset.id === 'custom-1')?.layout).toEqual(layout);
  });

  it('recovers from corrupt storage without losing built-ins', () => {
    const restored = loadWorkspaceStore({ getItem: () => '{broken' });
    expect(restored.activeId).toBe('classic');
    expect(restored.presets).toHaveLength(3);
  });

  it('auto-updates only the active workspace layout', () => {
    const custom = createWorkspace(defaultWorkspaceStore(), 'custom-1', 'Podcast', layout);
    const updated = updateWorkspaceLayout(custom, { ...layout, horizontalZoom: 300 });
    expect(updated.presets.find((preset) => preset.id === 'custom-1')?.layout.horizontalZoom).toBe(300);
    expect(updated.presets.find((preset) => preset.id === 'classic')?.layout.horizontalZoom).toBe(100);
  });

  it('rejects duplicate names and safely removes custom presets', () => {
    const custom = createWorkspace(defaultWorkspaceStore(), 'custom-1', 'Podcast', layout);
    expect(() => createWorkspace(custom, 'custom-2', 'podcast', layout)).toThrow();
    const removed = removeWorkspace(custom, 'custom-1');
    expect(removed.activeId).toBe('classic');
    expect(removed.presets.some((preset) => preset.id === 'custom-1')).toBe(false);
    expect(removeWorkspace(custom, 'classic')).toEqual(custom);
  });

  it('restores a built-in layout after automatic customization', () => {
    const changed = updateWorkspaceLayout(defaultWorkspaceStore(), layout);
    const restored = resetWorkspace(changed, 'classic');
    expect(restored.presets[0].layout).toEqual(defaultWorkspaceStore().presets[0].layout);
  });

  it('round-trips the full vertical zoom range and normalizes invalid legacy values', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    };
    const custom = createWorkspace(defaultWorkspaceStore(), 'zoomed', 'Zoomed', {
      ...layout,
      verticalZoom: 512,
    });
    expect(saveWorkspaceStore(custom, storage)).toBe(true);
    expect(loadWorkspaceStore(storage).presets.find((preset) => preset.id === 'zoomed')?.layout.verticalZoom)
      .toBe(512);

    values.set(WORKSPACE_STORAGE_KEY, JSON.stringify({
      activeId: 'classic',
      presets: [{ id: 'classic', name: 'Classic', layout: { verticalZoom: -2 } }],
    }));
    expect(loadWorkspaceStore(storage).presets.find((preset) => preset.id === 'classic')?.layout.verticalZoom)
      .toBe(1);
  });

  it('normalizes invalid legacy horizontal zoom without changing the active preset fallback', () => {
    const values = new Map<string, string>();
    values.set(WORKSPACE_STORAGE_KEY, JSON.stringify({
      activeId: 'classic',
      presets: [{ id: 'classic', name: 'Classic', layout: { horizontalZoom: -20 } }],
    }));
    const restored = loadWorkspaceStore({ getItem: (key: string) => values.get(key) ?? null });
    expect(restored.presets.find((preset) => preset.id === 'classic')?.layout.horizontalZoom).toBe(100);
  });

  it('reports browser storage write failures without throwing', () => {
    const storage = {
      setItem: () => { throw new DOMException('Storage is full', 'QuotaExceededError'); },
    };
    expect(() => saveWorkspaceStore(defaultWorkspaceStore(), storage)).not.toThrow();
    expect(saveWorkspaceStore(defaultWorkspaceStore(), storage)).toBe(false);
  });
});
