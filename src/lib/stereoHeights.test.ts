import { describe, expect, it } from 'vitest';
import {
  defaultStereoHeightsPreferences,
  isAsymmetricStereoHeightsEnabled,
  loadChannelHeightRatios,
  loadStereoHeightsPreferences,
  normalizeChannelHeightRatio,
  resetChannelHeightRatios,
  saveChannelHeightRatio,
  saveStereoHeightsPreferences,
  setStereoHeightsWorkspaceEnabled,
  STEREO_HEIGHTS_PREFERENCES_STORAGE_KEY,
} from '@/lib/stereoHeights';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

describe('Audacity asymmetric stereo heights preferences', () => {
  it('defaults to Never and implements Always / Workspace dependent / Never', () => {
    const fallback = defaultStereoHeightsPreferences();
    expect(fallback).toEqual({ mode: 'never', workspaceNames: [] });
    expect(isAsymmetricStereoHeightsEnabled(fallback, 'Classic')).toBe(false);
    expect(isAsymmetricStereoHeightsEnabled({ ...fallback, mode: 'always' }, 'Classic')).toBe(true);
    expect(isAsymmetricStereoHeightsEnabled({
      mode: 'workspace-dependent',
      workspaceNames: ['Music'],
    }, 'Classic')).toBe(false);
    expect(isAsymmetricStereoHeightsEnabled({
      mode: 'workspace-dependent',
      workspaceNames: ['Music'],
    }, 'Music')).toBe(true);
  });

  it('adds and removes workspaces without duplicates', () => {
    const original = { mode: 'workspace-dependent' as const, workspaceNames: ['Classic'] };
    const added = setStereoHeightsWorkspaceEnabled(original, 'Music', true);
    expect(added.workspaceNames).toEqual(['Classic', 'Music']);
    expect(setStereoHeightsWorkspaceEnabled(added, 'Music', true).workspaceNames).toEqual(['Classic', 'Music']);
    expect(setStereoHeightsWorkspaceEnabled(added, 'Classic', false).workspaceNames).toEqual(['Music']);
    expect(original.workspaceNames).toEqual(['Classic']);
  });

  it('round-trips preferences and cleans deleted or corrupt workspace names', () => {
    const storage = memoryStorage();
    expect(saveStereoHeightsPreferences({
      mode: 'workspace-dependent',
      workspaceNames: ['Classic', 'Classic', 'Deleted'],
    }, storage)).toBe(true);
    expect(loadStereoHeightsPreferences(storage, ['Classic', 'Music'])).toEqual({
      mode: 'workspace-dependent',
      workspaceNames: ['Classic'],
    });

    storage.values.set(STEREO_HEIGHTS_PREFERENCES_STORAGE_KEY, '{broken');
    expect(loadStereoHeightsPreferences(storage)).toEqual(defaultStereoHeightsPreferences());
  });

  it('reports storage failures without throwing', () => {
    const storage = { setItem: () => { throw new DOMException('full', 'QuotaExceededError'); } };
    expect(() => saveStereoHeightsPreferences(defaultStereoHeightsPreferences(), storage)).not.toThrow();
    expect(saveStereoHeightsPreferences(defaultStereoHeightsPreferences(), storage)).toBe(false);
  });
});

describe('stereo channel height ratios', () => {
  it('uses Audacity 20px per-channel limits and keeps short views equal', () => {
    expect(normalizeChannelHeightRatio(0, 100)).toBe(0.2);
    expect(normalizeChannelHeightRatio(1, 100)).toBe(0.8);
    expect(normalizeChannelHeightRatio(0.65, 100)).toBe(0.65);
    expect(normalizeChannelHeightRatio(0, 30)).toBe(0.5);
    expect(normalizeChannelHeightRatio(1, 30)).toBe(0.5);
    expect(normalizeChannelHeightRatio(Number.NaN, 100)).toBe(0.5);
    expect(normalizeChannelHeightRatio(0.7, 0)).toBe(0.5);
  });

  it('persists ratios independently per project and resets a project view state', () => {
    const storage = memoryStorage();
    expect(saveChannelHeightRatio('project-a', 'track-1', 0.7, storage)).toBe(true);
    expect(saveChannelHeightRatio('project-a', 'track-2', 0.3, storage)).toBe(true);
    expect(saveChannelHeightRatio('project-b', 'track-1', 0.4, storage)).toBe(true);
    expect(loadChannelHeightRatios('project-a', storage)).toEqual({ 'track-1': 0.7, 'track-2': 0.3 });
    expect(loadChannelHeightRatios('project-b', storage)).toEqual({ 'track-1': 0.4 });
    expect(resetChannelHeightRatios('project-a', storage)).toBe(true);
    expect(loadChannelHeightRatios('project-a', storage)).toEqual({});
    expect(loadChannelHeightRatios('project-b', storage)).toEqual({ 'track-1': 0.4 });
  });

  it('sanitizes corrupt ratios and rejects invalid writes', () => {
    const storage = memoryStorage();
    const key = 'audacity-web:channel-height-ratios:v1:project-a';
    storage.values.set(key, JSON.stringify({ valid: 0.6, low: -1, high: 2, bad: 'x', nan: null }));
    expect(loadChannelHeightRatios('project-a', storage)).toEqual({ valid: 0.6, low: 0, high: 1 });
    storage.values.set(key, '{broken');
    expect(loadChannelHeightRatios('project-a', storage)).toEqual({});
    expect(saveChannelHeightRatio('', 'track', 0.5, storage)).toBe(false);
    expect(saveChannelHeightRatio('project', 'track', Number.NaN, storage)).toBe(false);
  });
});
