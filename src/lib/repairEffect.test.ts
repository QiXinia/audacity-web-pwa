import { describe, expect, it } from 'vitest';
import { createRepairRandom, interpolateRepairAudio } from './repairEffect';

function oracleInput(right = false): Float32Array {
  return Float32Array.from({ length: 40 }, (_, index) => {
    const phase = 2 * Math.PI * index / 44100;
    return right
      ? 0.4 * Math.cos(440 * phase) - 0.05 * Math.sin(1000 * phase)
      : 0.6 * Math.sin(440 * phase) + 0.1 * Math.cos(1000 * phase);
  });
}

describe('Audacity Repair interpolation', () => {
  it('matches the official glibc random sequence used for LSAR dither', () => {
    const random = createRepairRandom();
    expect(Array.from({ length: 5 }, () => random())).toEqual([
      1804289383, 846930886, 1681692777, 1714636915, 1957747793,
    ]);
  });

  it('uses the official linear fallback without changing surrounding samples', () => {
    const input = Float32Array.from([1, 99, 99, 3, 4]);
    const output = interpolateRepairAudio(input, 1, 2);
    expect(Array.from(output)).toEqual([
      1, 1.6666667461395264, 2.3333334922790527, 3, 4,
    ]);
    expect(Array.from(input)).toEqual([1, 99, 99, 3, 4]);
  });

  it('matches Audacity 4.0.2 C++ LSAR for stereo and left-edge repairs', () => {
    const random = createRepairRandom();
    const leftInput = oracleInput();
    const rightInput = oracleInput(true);
    const beginningInput = oracleInput();
    const left = interpolateRepairAudio(leftInput, 12, 4, random);
    const right = interpolateRepairAudio(rightInput, 12, 4, random);
    const beginning = interpolateRepairAudio(beginningInput, 0, 4, random);

    const expectedLeft = [0.3961299658, 0.4088106751, 0.420414567, 0.4309467077];
    const expectedRight = [0.242496714, 0.2263080925, 0.2100389153, 0.1936018169];
    const expectedBeginning = [0.1000778303, 0.1366101801, 0.1709677279, 0.2031486183];
    for (let index = 0; index < 4; index += 1) {
      expect(left[12 + index]).toBeCloseTo(expectedLeft[index], 8);
      expect(right[12 + index]).toBeCloseTo(expectedRight[index], 8);
      expect(beginning[index]).toBeCloseTo(expectedBeginning[index], 6);
    }
    expect(left.slice(0, 12)).toEqual(leftInput.slice(0, 12));
    expect(left.slice(16)).toEqual(leftInput.slice(16));
    expect(right.slice(0, 12)).toEqual(rightInput.slice(0, 12));
    expect(right.slice(16)).toEqual(rightInput.slice(16));
    expect(beginning.slice(4)).toEqual(beginningInput.slice(4));
  });

  it('rejects invalid ranges and returns an unchanged copy for empty damage', () => {
    const input = Float32Array.from([1, 2, 3]);
    expect(interpolateRepairAudio(input, 1, 0)).toEqual(input);
    expect(interpolateRepairAudio(input, 1, 0)).not.toBe(input);
    expect(() => interpolateRepairAudio(input, -1, 1)).toThrow('Repair 插值范围无效');
    expect(() => interpolateRepairAudio(input, 1, 3)).toThrow('Repair 插值范围无效');
  });
});
