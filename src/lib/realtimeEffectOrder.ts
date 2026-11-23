import type { IEffect } from '@/types/project';

/**
 * Audacity RealtimeEffectList::MoveEffect uses std::rotate for arbitrary moves.
 * Return null for no-op/invalid input so callers can avoid an empty history
 * entry and an unnecessary IndexedDB write. Existing effect objects retain
 * their identity; only the chain order changes.
 */
export function moveEffectInList(
  effects: readonly IEffect[],
  fromIndex: number,
  toIndex: number,
): IEffect[] | null {
  if (
    !Number.isInteger(fromIndex)
    || !Number.isInteger(toIndex)
    || fromIndex < 0
    || toIndex < 0
    || fromIndex >= effects.length
    || toIndex >= effects.length
    || fromIndex === toIndex
  ) return null;

  const reordered = [...effects];
  const [moved] = reordered.splice(fromIndex, 1);
  reordered.splice(toIndex, 0, moved!);
  return reordered;
}
