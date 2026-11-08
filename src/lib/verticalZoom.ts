export const MIN_VERTICAL_ZOOM = 0.5;
export const MAX_VERTICAL_ZOOM = 512;
export const DEFAULT_VERTICAL_ZOOM = 1;

export type VerticalZoomDirection = 'in' | 'out';

/** Keep restored view state inside Audacity's vertical display bounds. */
export function normalizeVerticalZoom(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_VERTICAL_ZOOM;
  return Math.min(MAX_VERTICAL_ZOOM, Math.max(MIN_VERTICAL_ZOOM, value));
}

/** Audacity halves the display bounds to zoom in and doubles them to zoom out. */
export function stepVerticalZoom(value: number, direction: VerticalZoomDirection): number {
  const current = normalizeVerticalZoom(value);
  return normalizeVerticalZoom(current * (direction === 'in' ? 2 : 0.5));
}
