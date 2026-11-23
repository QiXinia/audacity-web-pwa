import { describe, expect, it } from 'vitest';
import { moveEffectInList } from '@/lib/realtimeEffectOrder';
import type { IEffect } from '@/types/project';

function effect(id: string): IEffect {
  return { id, type: 'gain', bypassed: false, params: { gain: 0 } };
}

describe('Audacity realtime effect ordering', () => {
  it.each([
    { from: 0, to: 3, expected: ['b', 'c', 'd', 'a'] },
    { from: 3, to: 0, expected: ['d', 'a', 'b', 'c'] },
    { from: 1, to: 2, expected: ['a', 'c', 'b', 'd'] },
    { from: 2, to: 1, expected: ['a', 'c', 'b', 'd'] },
  ])('moves $from to $to with native rotate semantics', ({ from, to, expected }) => {
    const input = ['a', 'b', 'c', 'd'].map(effect);
    const snapshot = input.map((item) => item.id);
    const output = moveEffectInList(input, from, to);

    expect(output?.map((item) => item.id)).toEqual(expected);
    expect(output).not.toBe(input);
    expect(output?.[to]).toBe(input[from]);
    expect(input.map((item) => item.id)).toEqual(snapshot);
  });

  it.each([
    [0, 0], [2, 2], [-1, 0], [0, -1], [4, 0], [0, 4],
    [0.5, 1], [0, 1.5], [Number.NaN, 1], [0, Number.POSITIVE_INFINITY],
  ])('rejects no-op or invalid move %s → %s without allocating', (from, to) => {
    const input = ['a', 'b', 'c', 'd'].map(effect);
    expect(moveEffectInList(input, from, to)).toBeNull();
  });
});
