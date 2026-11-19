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
  showClipping: true,
  showRMS: true,
  showVerticalRulers: false,
  viewMode: 'spectrum',
  halfWave: true,
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

  it('persists ruler formats, half-wave, RMS and vertical rulers, and normalizes unknown legacy values', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    };
    const custom = createWorkspace(defaultWorkspaceStore(), 'db-workspace', 'dB editing', {
      ...layout,
      viewMode: 'waveformDbLinear',
      halfWave: true,
    });
    expect(saveWorkspaceStore(custom, storage)).toBe(true);
    const restored = loadWorkspaceStore(storage).presets.find((preset) => preset.id === 'db-workspace')?.layout;
    expect(restored?.viewMode).toBe('waveformDbLinear');
    expect(restored?.halfWave).toBe(true);
    expect(restored?.showRMS).toBe(true);
    expect(restored?.showVerticalRulers).toBe(false);

    values.set(WORKSPACE_STORAGE_KEY, JSON.stringify({
      activeId: 'classic',
      presets: [{ id: 'classic', name: 'Classic', layout: { viewMode: 'logarithmic', halfWave: 'invalid', showRMS: 'invalid', showVerticalRulers: 'invalid' } }],
    }));
    const fallback = loadWorkspaceStore(storage).presets.find((preset) => preset.id === 'classic')?.layout;
    expect(fallback?.viewMode).toBe('waveform');
    expect(fallback?.halfWave).toBe(false);
    expect(fallback?.showRMS).toBe(false);
    expect(fallback?.showVerticalRulers).toBe(true);
  });

  it('rejects duplicate, empty and truncation-colliding ids at creation', () => {
    const custom = createWorkspace(defaultWorkspaceStore(), 'custom-1', 'Podcast', layout);
    expect(() => createWorkspace(custom, 'custom-1', 'Another', layout)).toThrow('Workspace id already exists');
    expect(() => createWorkspace(custom, 'classic', 'Classic copy', layout)).toThrow('Workspace id already exists');
    expect(() => createWorkspace(custom, '   ', 'Blank id', layout)).toThrow('Workspace id cannot be empty');

    const longId = 'x'.repeat(81);
    const withLongId = createWorkspace(custom, longId, 'Long id', layout);
    expect(withLongId.activeId).toBe('x'.repeat(80));
    expect(withLongId.presets.at(-1)?.id).toBe('x'.repeat(80));
    expect(() => createWorkspace(withLongId, `${'x'.repeat(80)}y`, 'Collision', layout))
      .toThrow('Workspace id already exists');
  });

  it('deduplicates truncated and built-in ids when restoring damaged storage', () => {
    const longPrefix = 'a'.repeat(80);
    const stored = JSON.stringify({
      activeId: 'classic',
      presets: [
        { id: ' classic ', name: 'Preferred Classic', layout: { ...layout, horizontalZoom: 200 } },
        { id: 'classic', name: 'Duplicate Classic', layout: { ...layout, horizontalZoom: 900 } },
        { id: '', name: 'Empty id', layout },
        { id: '   ', name: 'Blank id', layout },
        { id: `${longPrefix}x`, name: 'Long A', layout },
        { id: `${longPrefix}y`, name: 'Long B', layout },
      ],
    });
    const restored = loadWorkspaceStore({ getItem: () => stored });
    const ids = restored.presets.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain('');
    expect(ids).not.toContain('   ');
    expect(ids.filter((id) => id === 'classic')).toHaveLength(1);
    expect(ids.filter((id) => id === longPrefix)).toHaveLength(1);
    expect(restored.activeId).toBe('classic');
    expect(restored.presets.find((preset) => preset.id === 'classic')?.layout.horizontalZoom).toBe(200);
  });

  it('restores the active workspace after trimming and truncating its persisted id', () => {
    const longPrefix = 'b'.repeat(80);
    const stored = JSON.stringify({
      activeId: `  ${longPrefix}legacy  `,
      presets: [
        { id: 'classic', name: 'Classic', layout: defaultWorkspaceStore().presets[0].layout },
        { id: ` ${longPrefix}legacy `, name: 'Active custom', layout: { ...layout, horizontalZoom: 333 } },
      ],
    });
    const restored = loadWorkspaceStore({ getItem: () => stored });
    expect(restored.activeId).toBe(longPrefix);
    expect(restored.presets.find((preset) => preset.id === restored.activeId)?.layout.horizontalZoom).toBe(333);
  });

  it('rejects names that collide after the 60 character persistence limit', () => {
    const sharedPrefix = 'n'.repeat(60);
    const custom = createWorkspace(defaultWorkspaceStore(), 'first', `${sharedPrefix} A`, layout);
    expect(custom.presets.at(-1)?.name).toBe(sharedPrefix);
    expect(() => createWorkspace(custom, 'second', `${sharedPrefix} B`, layout))
      .toThrow('Workspace name already exists');
  });

  it('deduplicates normalized names and reserves built-in names when restoring storage', () => {
    const sharedPrefix = 'm'.repeat(60);
    const stored = JSON.stringify({
      activeId: 'second',
      presets: [
        { id: 'classic', name: 'Classic', layout: defaultWorkspaceStore().presets[0].layout },
        { id: 'first', name: `${sharedPrefix} A`, layout },
        { id: 'second', name: `${sharedPrefix} B`, layout },
        { id: 'custom-classic', name: ' classic ', layout },
      ],
    });
    const restored = loadWorkspaceStore({ getItem: () => stored });
    const names = restored.presets.map((preset) => preset.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
    expect(restored.presets.some((preset) => preset.id === 'first')).toBe(true);
    expect(restored.presets.some((preset) => preset.id === 'second')).toBe(false);
    expect(restored.presets.some((preset) => preset.id === 'custom-classic')).toBe(false);
    expect(restored.presets.filter((preset) => preset.id === 'classic')).toHaveLength(1);
    expect(restored.activeId).toBe('classic');
  });

  it('reports browser storage write failures without throwing', () => {
    const storage = {
      setItem: () => { throw new DOMException('Storage is full', 'QuotaExceededError'); },
    };
    expect(() => saveWorkspaceStore(defaultWorkspaceStore(), storage)).not.toThrow();
    expect(saveWorkspaceStore(defaultWorkspaceStore(), storage)).toBe(false);
  });
});
