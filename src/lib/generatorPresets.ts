import type { NoiseType } from './noiseGenerator';
import type { ToneWaveform } from './toneGenerator';

export const GENERATOR_PRESET_FACTORY_ID = 'factory';
export const GENERATOR_PRESETS_STORAGE_PREFIX = 'audacity-web:generator-presets:v1:';

export interface TonePresetSettings {
  waveform: ToneWaveform;
  frequency: number;
  amplitude: number;
}

export interface NoisePresetSettings {
  type: NoiseType;
  amplitude: number;
}

export interface GeneratorPresetSettingsByKind {
  tone: TonePresetSettings;
  noise: NoisePresetSettings;
}

export type GeneratorPresetKind = keyof GeneratorPresetSettingsByKind;

// Mirrors Audacity's EffectPresetsBar select/save/reset/delete subset.
// Duration stays independent so a preset cannot break a sample-locked selection.
// Sources: src/effects/effects_base/qml/Audacity/Effects/EffectPresetsBar.qml,
// PresetNameDialog.qml and internal/effectpresetsscenario.cpp.

export interface GeneratorPreset<K extends GeneratorPresetKind> {
  id: string;
  name: string;
  builtIn: boolean;
  settings: GeneratorPresetSettingsByKind[K];
}

export interface GeneratorPresetStore<K extends GeneratorPresetKind> {
  activeId: string;
  presets: GeneratorPreset<K>[];
}

type StorageReader = Pick<Storage, 'getItem'>;
type StorageWriter = Pick<Storage, 'setItem'>;

const FACTORY_PRESETS: {
  [K in GeneratorPresetKind]: GeneratorPreset<K>;
} = {
  tone: {
    id: GENERATOR_PRESET_FACTORY_ID,
    name: 'Audacity 默认',
    builtIn: true,
    settings: { waveform: 'sine', frequency: 440, amplitude: 0.8 },
  },
  noise: {
    id: GENERATOR_PRESET_FACTORY_ID,
    name: 'Audacity 默认',
    builtIn: true,
    settings: { type: 'white', amplitude: 0.8 },
  },
};

function browserStorage(): Storage | undefined {
  return typeof window === 'undefined' ? undefined : window.localStorage;
}

function clonePreset<K extends GeneratorPresetKind>(preset: GeneratorPreset<K>): GeneratorPreset<K> {
  return { ...preset, settings: { ...preset.settings } };
}

function normalizeSettings<K extends GeneratorPresetKind>(
  kind: K,
  value: unknown,
): GeneratorPresetSettingsByKind[K] | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as Record<string, unknown>;
  const amplitude = Number(candidate.amplitude);
  if (!Number.isFinite(amplitude) || amplitude < 0 || amplitude > 1) return undefined;

  if (kind === 'tone') {
    const frequency = Number(candidate.frequency);
    const waveforms: ToneWaveform[] = ['sine', 'square', 'sawtooth', 'squareNoAlias', 'triangle'];
    if (!waveforms.includes(candidate.waveform as ToneWaveform)) return undefined;
    if (!Number.isFinite(frequency) || frequency < 1 || frequency > 1_000_000) return undefined;
    return {
      waveform: candidate.waveform as ToneWaveform,
      frequency,
      amplitude,
    } as GeneratorPresetSettingsByKind[K];
  }

  const types: NoiseType[] = ['white', 'pink', 'brownian'];
  if (!types.includes(candidate.type as NoiseType)) return undefined;
  return { type: candidate.type as NoiseType, amplitude } as GeneratorPresetSettingsByKind[K];
}

export function isValidGeneratorPresetSettings<K extends GeneratorPresetKind>(
  kind: K,
  value: unknown,
): value is GeneratorPresetSettingsByKind[K] {
  return normalizeSettings(kind, value) !== undefined;
}

export function defaultGeneratorPresetStore<K extends GeneratorPresetKind>(
  kind: K,
): GeneratorPresetStore<K> {
  return {
    activeId: GENERATOR_PRESET_FACTORY_ID,
    presets: [clonePreset(FACTORY_PRESETS[kind])],
  };
}

/** Invalid or inaccessible storage always falls back to the Audacity factory settings. */
export function loadGeneratorPresetStore<K extends GeneratorPresetKind>(
  kind: K,
  storage?: StorageReader,
): GeneratorPresetStore<K> {
  const fallback = defaultGeneratorPresetStore(kind);
  try {
    const raw = (storage ?? browserStorage())?.getItem(`${GENERATOR_PRESETS_STORAGE_PREFIX}${kind}`);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<GeneratorPresetStore<K>>;
    if (!Array.isArray(parsed.presets)) return fallback;

    const ids = new Set<string>([GENERATOR_PRESET_FACTORY_ID]);
    const names = new Set<string>([FACTORY_PRESETS[kind].name.toLocaleLowerCase()]);
    const custom: GeneratorPreset<K>[] = [];
    for (const candidate of parsed.presets.slice(0, 50)) {
      if (!candidate || candidate.id === GENERATOR_PRESET_FACTORY_ID) continue;
      if (typeof candidate.id !== 'string' || typeof candidate.name !== 'string') continue;
      const id = candidate.id.trim().slice(0, 80);
      const name = candidate.name.trim();
      const normalizedName = name.toLocaleLowerCase();
      const settings = normalizeSettings(kind, candidate.settings);
      if (!id || !name || name.length > 60 || /[\\/]/.test(name) || !settings) continue;
      if (ids.has(id) || names.has(normalizedName)) continue;
      ids.add(id);
      names.add(normalizedName);
      custom.push({ id, name, builtIn: false, settings });
    }

    const presets = [...fallback.presets, ...custom];
    return {
      activeId: presets.some((preset) => preset.id === parsed.activeId)
        ? parsed.activeId!
        : GENERATOR_PRESET_FACTORY_ID,
      presets,
    };
  } catch {
    return fallback;
  }
}

export function saveGeneratorPresetStore<K extends GeneratorPresetKind>(
  kind: K,
  store: GeneratorPresetStore<K>,
  storage?: StorageWriter,
): boolean {
  try {
    const target = storage ?? browserStorage();
    if (!target) return false;
    target.setItem(`${GENERATOR_PRESETS_STORAGE_PREFIX}${kind}`, JSON.stringify(store));
    return true;
  } catch {
    return false;
  }
}

export function upsertGeneratorPreset<K extends GeneratorPresetKind>(
  store: GeneratorPresetStore<K>,
  id: string,
  name: string,
  settings: GeneratorPresetSettingsByKind[K],
): GeneratorPresetStore<K> {
  const trimmedId = id.trim();
  const trimmedName = name.trim();
  if (!trimmedId || trimmedId === GENERATOR_PRESET_FACTORY_ID) {
    throw new Error('预设标识无效');
  }
  if (!trimmedName) throw new Error('预设名称不能为空');
  if (trimmedName.length > 60) throw new Error('预设名称不能超过 60 个字符');
  if (/[\\/]/.test(trimmedName)) throw new Error('预设名称不能包含 / 或 \\');
  if (store.presets.some((preset) => preset.id !== trimmedId
    && preset.name.toLocaleLowerCase() === trimmedName.toLocaleLowerCase())) {
    throw new Error('已存在同名预设');
  }

  const existing = store.presets.find((preset) => preset.id === trimmedId);
  if (existing?.builtIn) throw new Error('内置预设不可覆盖');
  const preset: GeneratorPreset<K> = {
    id: trimmedId,
    name: trimmedName,
    builtIn: false,
    settings: { ...settings },
  };
  return {
    activeId: trimmedId,
    presets: existing
      ? store.presets.map((candidate) => candidate.id === trimmedId ? preset : candidate)
      : [...store.presets, preset],
  };
}

export function deleteGeneratorPreset<K extends GeneratorPresetKind>(
  store: GeneratorPresetStore<K>,
  id: string,
): GeneratorPresetStore<K> {
  const target = store.presets.find((preset) => preset.id === id);
  if (!target || target.builtIn) return store;
  return {
    activeId: store.activeId === id ? GENERATOR_PRESET_FACTORY_ID : store.activeId,
    presets: store.presets.filter((preset) => preset.id !== id),
  };
}
