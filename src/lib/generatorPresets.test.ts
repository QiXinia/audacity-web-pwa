import { describe, expect, it } from 'vitest';
import {
  defaultGeneratorPresetStore,
  deleteGeneratorPreset,
  GENERATOR_PRESET_FACTORY_ID,
  GENERATOR_PRESETS_STORAGE_PREFIX,
  loadGeneratorPresetStore,
  saveGeneratorPresetStore,
  upsertGeneratorPreset,
} from './generatorPresets';

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
}

describe('generatorPresets', () => {
  it('starts from independent Audacity factory settings', () => {
    const tone = defaultGeneratorPresetStore('tone');
    const noise = defaultGeneratorPresetStore('noise');
    expect(tone.presets[0]).toMatchObject({
      id: GENERATOR_PRESET_FACTORY_ID,
      builtIn: true,
      settings: { waveform: 'sine', frequency: 440, amplitude: 0.8 },
    });
    expect(noise.presets[0].settings).toEqual({ type: 'white', amplitude: 0.8 });

    tone.presets[0].settings.amplitude = 0.1;
    expect(defaultGeneratorPresetStore('tone').presets[0].settings.amplitude).toBe(0.8);
  });

  it('round-trips tone and noise presets without cross-kind contamination', () => {
    const storage = memoryStorage();
    const tone = upsertGeneratorPreset(
      defaultGeneratorPresetStore('tone'),
      'lead',
      'Lead tone',
      { waveform: 'triangle', frequency: 880, amplitude: 0.25 },
    );
    const noise = upsertGeneratorPreset(
      defaultGeneratorPresetStore('noise'),
      'soft-noise',
      'Soft noise',
      { type: 'brownian', amplitude: 0.15 },
    );
    expect(saveGeneratorPresetStore('tone', tone, storage)).toBe(true);
    expect(saveGeneratorPresetStore('noise', noise, storage)).toBe(true);

    expect(loadGeneratorPresetStore('tone', storage)).toEqual(tone);
    expect(loadGeneratorPresetStore('noise', storage)).toEqual(noise);
  });

  it('drops corrupt settings, unsafe names, duplicates and stale active ids', () => {
    const key = `${GENERATOR_PRESETS_STORAGE_PREFIX}tone`;
    const storage = memoryStorage({
      [key]: JSON.stringify({
        activeId: 'missing',
        presets: [
          { id: 'factory', name: 'fake', builtIn: false, settings: { waveform: 'square', frequency: 100, amplitude: 1 } },
          { id: 'bad-wave', name: 'Bad wave', settings: { waveform: 'noise', frequency: 100, amplitude: 0.5 } },
          { id: 'bad-amp', name: 'Bad amplitude', settings: { waveform: 'sine', frequency: 100, amplitude: 2 } },
          { id: 'bad-name', name: 'a/b', settings: { waveform: 'sine', frequency: 100, amplitude: 0.5 } },
          { id: 'valid', name: 'Valid', settings: { waveform: 'sawtooth', frequency: 220, amplitude: 0.4 } },
          { id: 'duplicate', name: 'valid', settings: { waveform: 'sine', frequency: 440, amplitude: 0.8 } },
        ],
      }),
    });
    const loaded = loadGeneratorPresetStore('tone', storage);
    expect(loaded.activeId).toBe(GENERATOR_PRESET_FACTORY_ID);
    expect(loaded.presets).toHaveLength(2);
    expect(loaded.presets[0]).toMatchObject({ id: 'factory', name: 'Audacity 默认', builtIn: true });
    expect(loaded.presets[0].settings).toEqual({ waveform: 'sine', frequency: 440, amplitude: 0.8 });
    expect(loaded.presets[1]).toMatchObject({ id: 'valid', name: 'Valid' });
  });

  it('fails closed when browser storage reads or writes are denied', () => {
    const denied = {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('denied'); },
    };
    expect(loadGeneratorPresetStore('tone', denied)).toEqual(defaultGeneratorPresetStore('tone'));
    expect(saveGeneratorPresetStore('noise', defaultGeneratorPresetStore('noise'), denied)).toBe(false);
  });

  it('rejects invalid names and built-in overwrites', () => {
    const store = defaultGeneratorPresetStore('noise');
    expect(() => upsertGeneratorPreset(store, 'x', '  ', { type: 'white', amplitude: 0.8 }))
      .toThrow('预设名称不能为空');
    expect(() => upsertGeneratorPreset(store, 'x', 'a\\b', { type: 'white', amplitude: 0.8 }))
      .toThrow('预设名称不能包含');
    expect(() => upsertGeneratorPreset(store, 'factory', 'Other', { type: 'white', amplitude: 0.8 }))
      .toThrow('预设标识无效');
    const custom = upsertGeneratorPreset(store, 'x', 'Custom', { type: 'pink', amplitude: 0.3 });
    expect(() => upsertGeneratorPreset(custom, 'y', 'custom', { type: 'white', amplitude: 0.8 }))
      .toThrow('已存在同名预设');
    expect(upsertGeneratorPreset(custom, 'x', 'Custom', { type: 'brownian', amplitude: 0.2 })
      .presets[1].settings).toEqual({ type: 'brownian', amplitude: 0.2 });
  });

  it('deletes only custom presets and restores the factory selection', () => {
    const store = upsertGeneratorPreset(
      defaultGeneratorPresetStore('tone'),
      'custom',
      'Custom',
      { waveform: 'squareNoAlias', frequency: 1000, amplitude: 0.5 },
    );
    const deleted = deleteGeneratorPreset(store, 'custom');
    expect(deleted).toEqual(defaultGeneratorPresetStore('tone'));
    expect(deleteGeneratorPreset(store, GENERATOR_PRESET_FACTORY_ID)).toBe(store);
  });
});
