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

// Audacity's BasicEffectUIServices writes "<EffectId>:<Key=\"value\" ...>" .txt
// files. Only the built-in Tone/Noise parameters are accepted here; duration is
// deliberately excluded, as it is in Audacity's automation parameter lists.
export const GENERATOR_PRESET_FILE_MAX_BYTES = 64 * 1024;

export class GeneratorPresetFileError extends Error {
  constructor(
    public readonly code: 'invalid' | 'mismatch',
    message: string,
  ) {
    super(message);
    this.name = 'GeneratorPresetFileError';
  }
}

const FILE_IDENTIFIERS: Record<GeneratorPresetKind, string> = {
  tone: 'Tone',
  noise: 'Noise',
};

const TONE_FILE_WAVEFORMS: Record<ToneWaveform, string> = {
  sine: 'Sine',
  square: 'Square',
  sawtooth: 'Sawtooth',
  squareNoAlias: 'Square, no alias',
  triangle: 'Triangle',
};

const NOISE_FILE_TYPES: Record<NoiseType, string> = {
  white: 'White',
  pink: 'Pink',
  brownian: 'Brownian',
};

function formatFileNumber(value: number): string {
  return Number(Object.is(value, -0) ? 0 : value).toString();
}

function quoteFileValue(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
}

export function serializeGeneratorPreset<K extends GeneratorPresetKind>(
  kind: K,
  settings: GeneratorPresetSettingsByKind[K],
): string {
  if (!isValidGeneratorPresetSettings(kind, settings)) {
    throw new GeneratorPresetFileError('invalid', '当前参数无效，无法导出预设。');
  }

  const entries: [string, string][] = kind === 'tone'
    ? (() => {
      const tone = settings as TonePresetSettings;
      return [
        ['Amplitude', formatFileNumber(tone.amplitude)],
        ['Frequency', formatFileNumber(tone.frequency)],
        ['Interpolation', 'Linear'],
        ['Waveform', TONE_FILE_WAVEFORMS[tone.waveform]],
      ];
    })()
    : (() => {
      const noise = settings as NoisePresetSettings;
      return [
        ['Amplitude', formatFileNumber(noise.amplitude)],
        ['Type', NOISE_FILE_TYPES[noise.type]],
      ];
    })();

  return `${FILE_IDENTIFIERS[kind]}:${entries
    .map(([key, value]) => `${key}=${quoteFileValue(value)}`)
    .join(' ')}`;
}

function invalidPresetFile(message = '不是有效的 Audacity 预设文件。'): never {
  throw new GeneratorPresetFileError('invalid', message);
}

function parseFileParameters(source: string): Map<string, string> {
  const parameters = new Map<string, string>();
  let index = 0;

  while (index < source.length) {
    while (index < source.length && /\s/.test(source[index])) index += 1;
    if (index === source.length) break;

    const keyMatch = /^[A-Za-z][A-Za-z0-9_]*/.exec(source.slice(index));
    if (!keyMatch) invalidPresetFile();
    const key = keyMatch[0];
    index += key.length;
    while (index < source.length && /[ \t]/.test(source[index])) index += 1;
    if (source[index] !== '=') invalidPresetFile();
    index += 1;
    while (index < source.length && /[ \t]/.test(source[index])) index += 1;
    if (source[index] !== '"') invalidPresetFile();
    index += 1;

    let value = '';
    let closed = false;
    while (index < source.length) {
      const character = source[index];
      index += 1;
      if (character === '"') {
        closed = true;
        break;
      }
      if (character === '\\') {
        const escaped = source[index];
        index += 1;
        if (escaped === 'n') value += '\n';
        else if (escaped === '"' || escaped === '\\') value += escaped;
        else invalidPresetFile('预设文件包含不支持的转义字符。');
      } else {
        value += character;
      }
    }
    if (!closed || (index < source.length && !/\s/.test(source[index]))) invalidPresetFile();
    if (parameters.has(key)) invalidPresetFile('预设文件包含重复参数。');
    parameters.set(key, value);
  }

  return parameters;
}

function parseFileNumber(value: string | undefined): number {
  if (value === undefined
    || !/^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim())) {
    invalidPresetFile('预设文件包含无效数值。');
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) invalidPresetFile('预设文件包含无效数值。');
  return parsed;
}

function requireExactParameters(
  parameters: Map<string, string>,
  expected: readonly string[],
): void {
  if (parameters.size !== expected.length
    || expected.some((key) => !parameters.has(key))) {
    invalidPresetFile('预设参数不完整，或包含当前版本不支持的参数。');
  }
}

export function parseGeneratorPresetFile<K extends GeneratorPresetKind>(
  kind: K,
  source: string,
): GeneratorPresetSettingsByKind[K] {
  if (typeof source !== 'string' || source.length === 0
    || source.length > GENERATOR_PRESET_FILE_MAX_BYTES) {
    invalidPresetFile();
  }
  const text = source.trim();
  if (!text || /[\0\r\n]/.test(text)) invalidPresetFile();
  const separator = text.indexOf(':');
  if (separator < 0) invalidPresetFile();

  const identifier = text.slice(0, separator);
  const body = text.slice(separator + 1);
  if (identifier !== FILE_IDENTIFIERS[kind]) {
    if (identifier.length < 2 || identifier.length > 30 || body.trim().length < 2) {
      invalidPresetFile();
    }
    throw new GeneratorPresetFileError(
      'mismatch',
      '该预设属于其他效果、生成器或分析器，未应用。',
    );
  }

  const parameters = parseFileParameters(body);
  let settings: TonePresetSettings | NoisePresetSettings;
  if (kind === 'tone') {
    requireExactParameters(parameters, ['Amplitude', 'Frequency', 'Interpolation', 'Waveform']);
    if (parameters.get('Interpolation') !== 'Linear') {
      invalidPresetFile('仅支持 Tone 的 Linear 插值预设。');
    }
    const waveform = (Object.entries(TONE_FILE_WAVEFORMS) as [ToneWaveform, string][])
      .find(([, value]) => value === parameters.get('Waveform'))?.[0];
    if (!waveform) invalidPresetFile('预设文件包含未知波形。');
    settings = {
      waveform,
      frequency: parseFileNumber(parameters.get('Frequency')),
      amplitude: parseFileNumber(parameters.get('Amplitude')),
    };
  } else {
    requireExactParameters(parameters, ['Amplitude', 'Type']);
    const type = (Object.entries(NOISE_FILE_TYPES) as [NoiseType, string][])
      .find(([, value]) => value === parameters.get('Type'))?.[0];
    if (!type) invalidPresetFile('预设文件包含未知噪声类型。');
    settings = {
      type,
      amplitude: parseFileNumber(parameters.get('Amplitude')),
    };
  }

  const normalized = normalizeSettings(kind, settings);
  if (!normalized) invalidPresetFile('预设参数超出支持范围。');
  return normalized;
}

export function downloadGeneratorPreset<K extends GeneratorPresetKind>(
  kind: K,
  settings: GeneratorPresetSettingsByKind[K],
): void {
  const blob = new Blob([serializeGeneratorPreset(kind, settings)], {
    type: 'text/plain;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `audacity-${kind}-preset.txt`;
  document.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
