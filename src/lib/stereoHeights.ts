export type AsymmetricStereoHeightsMode = 'always' | 'workspace-dependent' | 'never';

export interface AsymmetricStereoHeightsPreferences {
  mode: AsymmetricStereoHeightsMode;
  /** Audacity stores workspace names, rather than workspace-specific layout copies. */
  workspaceNames: string[];
}

export const STEREO_HEIGHTS_PREFERENCES_STORAGE_KEY = 'audacity-web:stereo-heights-preferences:v1';
export const CHANNEL_HEIGHT_RATIO_STORAGE_PREFIX = 'audacity-web:channel-height-ratios:v1:';

const MODES: AsymmetricStereoHeightsMode[] = ['always', 'workspace-dependent', 'never'];

export function defaultStereoHeightsPreferences(): AsymmetricStereoHeightsPreferences {
  return { mode: 'never', workspaceNames: [] };
}

function normalizeWorkspaceNames(value: unknown, validWorkspaceNames?: readonly string[]): string[] {
  if (!Array.isArray(value)) return [];
  const valid = validWorkspaceNames ? new Set(validWorkspaceNames) : null;
  const result: string[] = [];
  for (const candidate of value) {
    if (typeof candidate !== 'string') continue;
    const name = candidate.trim().slice(0, 60);
    if (!name || result.includes(name) || (valid && !valid.has(name))) continue;
    result.push(name);
  }
  return result;
}

export function loadStereoHeightsPreferences(
  storage?: Pick<Storage, 'getItem'>,
  validWorkspaceNames?: readonly string[],
): AsymmetricStereoHeightsPreferences {
  const fallback = defaultStereoHeightsPreferences();
  try {
    const target = storage ?? (typeof window !== 'undefined' ? window.localStorage : undefined);
    const raw = target?.getItem(STEREO_HEIGHTS_PREFERENCES_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<AsymmetricStereoHeightsPreferences>;
    return {
      mode: MODES.includes(parsed.mode as AsymmetricStereoHeightsMode)
        ? parsed.mode as AsymmetricStereoHeightsMode
        : fallback.mode,
      workspaceNames: normalizeWorkspaceNames(parsed.workspaceNames, validWorkspaceNames),
    };
  } catch {
    return fallback;
  }
}

export function saveStereoHeightsPreferences(
  preferences: AsymmetricStereoHeightsPreferences,
  storage?: Pick<Storage, 'setItem'>,
): boolean {
  try {
    const target = storage ?? (typeof window !== 'undefined' ? window.localStorage : undefined);
    if (!target) return false;
    const normalized: AsymmetricStereoHeightsPreferences = {
      mode: MODES.includes(preferences.mode) ? preferences.mode : 'never',
      workspaceNames: normalizeWorkspaceNames(preferences.workspaceNames),
    };
    target.setItem(STEREO_HEIGHTS_PREFERENCES_STORAGE_KEY, JSON.stringify(normalized));
    return true;
  } catch {
    return false;
  }
}

export function setStereoHeightsWorkspaceEnabled(
  preferences: AsymmetricStereoHeightsPreferences,
  workspaceName: string,
  enabled: boolean,
): AsymmetricStereoHeightsPreferences {
  const name = workspaceName.trim().slice(0, 60);
  if (!name) return preferences;
  const workspaceNames = enabled
    ? normalizeWorkspaceNames([...preferences.workspaceNames, name])
    : preferences.workspaceNames.filter((candidate) => candidate !== name);
  return { ...preferences, workspaceNames };
}

export function isAsymmetricStereoHeightsEnabled(
  preferences: AsymmetricStereoHeightsPreferences,
  activeWorkspaceName: string,
): boolean {
  if (preferences.mode === 'always') return true;
  if (preferences.mode === 'never') return false;
  return preferences.workspaceNames.includes(activeWorkspaceName);
}

/**
 * Match TrackClipsContainer.qml: each channel gets at least 20px when space
 * permits; short views stay equally split instead of collapsing a channel.
 */
export function normalizeChannelHeightRatio(ratio: number, viewHeight: number): number {
  if (!Number.isFinite(viewHeight) || viewHeight <= 0) return 0.5;
  const safeRatio = Number.isFinite(ratio) ? ratio : 0.5;
  const minY = Math.min(viewHeight / 2, 20);
  const maxY = Math.max(viewHeight / 2, viewHeight - 20);
  const y = Math.min(maxY, Math.max(minY, safeRatio * viewHeight));
  return y / viewHeight;
}

function ratioStorageKey(projectId: string): string {
  return `${CHANNEL_HEIGHT_RATIO_STORAGE_PREFIX}${encodeURIComponent(projectId)}`;
}

export function loadChannelHeightRatios(
  projectId: string,
  storage?: Pick<Storage, 'getItem'>,
): Record<string, number> {
  const result: Record<string, number> = {};
  if (!projectId) return result;
  try {
    const target = storage ?? (typeof window !== 'undefined' ? window.localStorage : undefined);
    const raw = target?.getItem(ratioStorageKey(projectId));
    if (!raw) return result;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return result;
    for (const [trackId, ratio] of Object.entries(parsed)) {
      if (!trackId || trackId === '__proto__' || typeof ratio !== 'number' || !Number.isFinite(ratio)) continue;
      result[trackId] = Math.min(1, Math.max(0, ratio));
    }
    return result;
  } catch {
    return result;
  }
}

export function saveChannelHeightRatio(
  projectId: string,
  trackId: string,
  ratio: number,
  storage?: Pick<Storage, 'getItem' | 'setItem'>,
): boolean {
  if (!projectId || !trackId || !Number.isFinite(ratio)) return false;
  try {
    const target = storage ?? (typeof window !== 'undefined' ? window.localStorage : undefined);
    if (!target) return false;
    const updated = loadChannelHeightRatios(projectId, target);
    updated[trackId] = Math.min(1, Math.max(0, ratio));
    target.setItem(ratioStorageKey(projectId), JSON.stringify(updated));
    return true;
  } catch {
    return false;
  }
}

export function resetChannelHeightRatios(
  projectId: string,
  storage?: Pick<Storage, 'removeItem'>,
): boolean {
  if (!projectId) return false;
  try {
    const target = storage ?? (typeof window !== 'undefined' ? window.localStorage : undefined);
    if (!target) return false;
    target.removeItem(ratioStorageKey(projectId));
    return true;
  } catch {
    return false;
  }
}
