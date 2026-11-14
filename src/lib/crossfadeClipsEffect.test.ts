import {
  processCrossfadeClipChannels,
  validateCrossfadeClipBoundary,
} from './crossfadeClipsEffect';

describe('crossfade clips DSP', () => {
  test('continuous selection uses equal-power cosine halves and preserves endpoints', () => {
    const source = [new Float32Array(8).fill(1)];
    const [output] = processCrossfadeClipChannels(
      source,
      { outEndSample: 4, inStartSample: 4, totalSamples: 8 },
      100,
    );

    expect(output[0]).toBeCloseTo(1, 10);
    expect(output[1]).toBeCloseTo(0.8660254037844386, 7);
    expect(output[2]).toBeCloseTo(0.5, 7);
    expect(output[3]).toBeCloseTo(0, 10);
    expect(output[4]).toBeCloseTo(0, 10);
    expect(output[5]).toBeCloseTo(0.5, 7);
    expect(output[6]).toBeCloseTo(0.8660254037844386, 7);
    expect(output[7]).toBeCloseTo(1, 10);
  });

  test('short selections use linear envelopes', () => {
    const source = [new Float32Array(8).fill(1)];
    const [output] = processCrossfadeClipChannels(
      source,
      { outEndSample: 4, inStartSample: 4, totalSamples: 8 },
      1000,
    );

    expect(output[0]).toBeCloseTo(1, 10);
    expect(output[1]).toBeCloseTo(2 / 3, 7);
    expect(output[2]).toBeCloseTo(1 / 3, 7);
    expect(output[3]).toBeCloseTo(0, 10);
    expect(output[4]).toBeCloseTo(0, 10);
    expect(output[5]).toBeCloseTo(1 / 3, 7);
    expect(output[6]).toBeCloseTo(2 / 3, 7);
    expect(output[7]).toBeCloseTo(1, 10);
  });

  test('crossfades a gap by mixing faded tail and head', () => {
    const source = [new Float32Array([1, 1, 1, 1, 0, 0, 1, 1])];
    const [output] = processCrossfadeClipChannels(
      source,
      { outEndSample: 4, inStartSample: 6, totalSamples: 8 },
      100,
    );

    expect(output[0]).toBeCloseTo(1, 10);
    expect(output[1]).toBeCloseTo(0.8660254037844386, 7);
    expect(output[2]).toBeCloseTo(0.5, 7);
    expect(output[3]).toBeCloseTo(0, 10);
    expect(output[4]).toBeCloseTo(0, 10);
    expect(output[5]).toBeCloseTo(0, 10);
    expect(output[6]).toBeCloseTo(0, 10);
    expect(output[7]).toBeCloseTo(1, 10);
  });

  test('handles unequal selected regions deterministically', () => {
    const source = [new Float32Array(8).fill(1)];
    const [output] = processCrossfadeClipChannels(
      source,
      { outEndSample: 3, inStartSample: 4, totalSamples: 8 },
      100,
    );

    expect(output[0]).toBeCloseTo(1, 10);
    expect(output[1]).toBeCloseTo(Math.SQRT1_2, 7);
    expect(output[2]).toBeCloseTo(0, 10);
    expect(output[3]).toBeCloseTo(0, 10);
    expect(output[4]).toBeCloseTo(0, 10);
    expect(output[5]).toBeCloseTo(0.5, 7);
    expect(output[6]).toBeCloseTo(0.8660254037844386, 7);
    expect(output[7]).toBeCloseTo(1, 10);
  });

  test('processes every channel independently without mutating input', () => {
    const left = new Float32Array(8).fill(1);
    const right = new Float32Array(8).fill(0.5);
    const [nextLeft, nextRight] = processCrossfadeClipChannels(
      [left, right],
      { outEndSample: 4, inStartSample: 4, totalSamples: 8 },
      100,
    );

    expect(nextLeft[2]).toBeCloseTo(0.5, 7);
    expect(nextRight[2]).toBeCloseTo(0.25, 7);
    expect(Array.from(left)).toEqual(Array(8).fill(1));
  });

  test.each([
    { outEndSample: 0, inStartSample: 2, totalSamples: 4 },
    { outEndSample: 5, inStartSample: 2, totalSamples: 4 },
    { outEndSample: 2, inStartSample: 4, totalSamples: 4 },
    { outEndSample: 3, inStartSample: 2, totalSamples: 4 },
    { outEndSample: 2, inStartSample: 2, totalSamples: 0 },
  ])('rejects invalid boundary %#', (boundary) => {
    expect(() => validateCrossfadeClipBoundary(boundary)).toThrow();
  });

  test('rejects mismatched channel length and invalid sample rate', () => {
    expect(() => processCrossfadeClipChannels(
      [new Float32Array(8), new Float32Array(3)],
      { outEndSample: 4, inStartSample: 4, totalSamples: 8 },
      100,
    )).toThrow();
    expect(() => processCrossfadeClipChannels(
      [new Float32Array(8)],
      { outEndSample: 4, inStartSample: 4, totalSamples: 8 },
      0,
    )).toThrow();
  });
});
