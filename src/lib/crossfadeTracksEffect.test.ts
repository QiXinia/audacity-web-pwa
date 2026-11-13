import {
  DEFAULT_CROSSFADE_SETTINGS,
  processCrossfadeChannels,
  resolveCrossfadeFade,
  validateCrossfadeSettings,
  type CrossfadeSettings,
} from './crossfadeTracksEffect';

describe('crossfade tracks DSP', () => {
  const settings = { ...DEFAULT_CROSSFADE_SETTINGS };

  test('linear gain fades in and out with exact endpoints and middle', () => {
    const source = [new Float32Array([1, 1, 1, 1, 1])];
    const fadeIn = processCrossfadeChannels(source, 'in', settings)[0];
    const fadeOut = processCrossfadeChannels(source, 'out', settings)[0];

    expect(Array.from(fadeIn)).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(Array.from(fadeOut)).toEqual([1, 0.75, 0.5, 0.25, 0]);
  });

  test('constant power 1 uses sine and cosine gains', () => {
    const source = [new Float32Array([1, 1, 1])];
    const powerSettings: CrossfadeSettings = { ...settings, type: 'power1' };
    const fadeIn = processCrossfadeChannels(source, 'in', powerSettings)[0];
    const fadeOut = processCrossfadeChannels(source, 'out', powerSettings)[0];

    expect(fadeIn[0]).toBeCloseTo(0, 10);
    expect(fadeIn[1]).toBeCloseTo(Math.SQRT1_2, 6);
    expect(fadeIn[2]).toBeCloseTo(1, 6);
    expect(fadeOut[1]).toBeCloseTo(Math.SQRT1_2, 6);
    expect(fadeOut[2]).toBeCloseTo(0, 10);
  });

  test('constant power 2 fades more rapidly than power 1 near endpoints', () => {
    const source = [new Float32Array([1, 1, 1, 1, 1])];
    const power2: CrossfadeSettings = { ...settings, type: 'power2' };
    const fadeIn = processCrossfadeChannels(source, 'in', power2)[0];

    expect(fadeIn[1]).toBeCloseTo(0.5, 10);
    expect(fadeIn[1]).toBeGreaterThan(Math.sin(Math.PI / 8));
  });

  test('custom curve at zero matches linear gain and half is approximately equal power', () => {
    const source = [new Float32Array([1, 1, 1, 1, 1])];
    const linear = processCrossfadeChannels(source, 'in', {
      ...settings,
      type: 'custom',
      customCurve: 0,
    })[0];
    const half = processCrossfadeChannels(source, 'in', {
      ...settings,
      type: 'custom',
      customCurve: 0.5,
    })[0];

    expect(Array.from(linear)).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(half[2]).toBeCloseTo(Math.SQRT1_2, 6);
  });

  test('processes every channel independently and preserves unrelated samples', () => {
    const left = new Float32Array([0.4, 0.8]);
    const right = new Float32Array([-0.2, 0.6]);
    const [nextLeft, nextRight] = processCrossfadeChannels([left, right], 'in', settings);

    expect(nextLeft[1]).toBeCloseTo(0.8, 6);
    expect(nextRight[0]).toBeCloseTo(0, 6);
    expect(nextRight[1]).toBeCloseTo(0.6, 6);
    expect(left[1]).toBeCloseTo(0.8, 6);
  });

  test.each([
    { type: 'unknown' },
    { customCurve: -0.1 },
    { customCurve: 1.1 },
    { direction: 'sideways' },
  ] as Partial<CrossfadeSettings>[])('rejects invalid settings %#', (override) => {
    expect(() => validateCrossfadeSettings({ ...settings, ...override } as CrossfadeSettings))
      .toThrow();
  });

  test('rejects empty channels and mismatched channel lengths', () => {
    expect(() => processCrossfadeChannels([], 'in', settings)).toThrow();
    expect(() => processCrossfadeChannels(
      [new Float32Array(2), new Float32Array(3)],
      'in',
      settings,
    )).toThrow();
  });

  test('resolves alternating and automatic directions deterministically', () => {
    expect(resolveCrossfadeFade(0, 'out-in', 4, 2)).toBe('out');
    expect(resolveCrossfadeFade(1, 'out-in', 4, 2)).toBe('in');
    expect(resolveCrossfadeFade(0, 'in-out', 4, 2)).toBe('in');
    expect(resolveCrossfadeFade(1, 'in-out', 4, 2)).toBe('out');
    expect(resolveCrossfadeFade(0, 'automatic', 1, 2)).toBe('in');
    expect(resolveCrossfadeFade(0, 'automatic', 2, 2)).toBe('out');
  });
});
