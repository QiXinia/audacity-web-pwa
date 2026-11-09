import { describe, expect, it, vi } from 'vitest';
import {
  GENERATOR_DEFAULT_DURATION,
  formatGeneratorDuration,
  loadGeneratorDuration,
  saveGeneratorDuration,
} from '@/lib/generatorDuration';

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => values.set(key, value)),
    values,
  };
}

describe('Audacity generator duration persistence', () => {
  it('formats exact sample durations without binary floating-point noise', () => {
    expect(formatGeneratorDuration(0.30000000000000004)).toBe('0.3');
    expect(formatGeneratorDuration(2.375)).toBe('2.375');
    expect(formatGeneratorDuration(Number.NaN)).toBe('');
  });

  it('uses the documented 30-second default independently for Tone, Chirp, Noise, and Silence', () => {
    const storage = memoryStorage();
    for (const kind of ['tone', 'chirp', 'noise', 'silence'] as const) {
      expect(loadGeneratorDuration(kind, storage)).toBe(GENERATOR_DEFAULT_DURATION);
    }
    expect(storage.getItem).toHaveBeenCalledTimes(4);
  });

  it.each(['dtmf', 'pluck'] as const)('uses the official 1-second default and remembers %s independently', (kind) => {
    const storage = memoryStorage();
    expect(loadGeneratorDuration(kind, storage)).toBe(1);
    expect(loadGeneratorDuration('tone', storage)).toBe(GENERATOR_DEFAULT_DURATION);
    expect(saveGeneratorDuration(kind, 0.75, storage)).toBe(true);
    expect(loadGeneratorDuration(kind, storage)).toBe(0.75);
    expect(loadGeneratorDuration('tone', storage)).toBe(GENERATOR_DEFAULT_DURATION);
  });

  it('round-trips fractional durations and keeps generator memories independent', () => {
    const storage = memoryStorage();
    expect(saveGeneratorDuration('tone', 2.375, storage)).toBe(true);
    expect(saveGeneratorDuration('chirp', 1.75, storage)).toBe(true);
    expect(saveGeneratorDuration('noise', 4.5, storage)).toBe(true);
    expect(saveGeneratorDuration('silence', 0.125, storage)).toBe(true);

    expect(loadGeneratorDuration('tone', storage)).toBe(2.375);
    expect(loadGeneratorDuration('chirp', storage)).toBe(1.75);
    expect(loadGeneratorDuration('noise', storage)).toBe(4.5);
    expect(loadGeneratorDuration('silence', storage)).toBe(0.125);
  });

  it.each(['', 'not-a-number', '0', '-2', 'Infinity'])(
    'falls back to 30 seconds for corrupt stored value %j',
    (value) => {
      const storage = memoryStorage({ 'audacity-web:generator-duration:v1:tone': value });
      expect(loadGeneratorDuration('tone', storage)).toBe(30);
    },
  );

  it('survives localStorage read and write denial without breaking generation', () => {
    const denied = {
      getItem: () => { throw new DOMException('denied'); },
      setItem: () => { throw new DOMException('denied'); },
    };
    expect(loadGeneratorDuration('noise', denied)).toBe(30);
    expect(saveGeneratorDuration('noise', 3, denied)).toBe(false);
  });

  it('rejects invalid new durations without overwriting the last valid value', () => {
    const storage = memoryStorage();
    saveGeneratorDuration('silence', 7, storage);
    expect(() => saveGeneratorDuration('silence', 0, storage)).toThrow(RangeError);
    expect(() => saveGeneratorDuration('silence', Number.NaN, storage)).toThrow(RangeError);
    expect(loadGeneratorDuration('silence', storage)).toBe(7);
  });
});
