export const MIN_HORIZONTAL_ZOOM = 10;
export const MAX_HORIZONTAL_ZOOM = 500;
export const DEFAULT_HORIZONTAL_ZOOM = 44100 / 512;

export type HorizontalZoomDirection = 'in' | 'out';

function clampHorizontalZoom(value: number): number {
  return Math.min(MAX_HORIZONTAL_ZOOM, Math.max(MIN_HORIZONTAL_ZOOM, value));
}

/** Keep restored timeline zoom finite and inside the Web editor's safe canvas bounds. */
export function normalizeHorizontalZoom(
  value: number,
  fallback = DEFAULT_HORIZONTAL_ZOOM,
): number {
  const safeFallback = Number.isFinite(fallback) && fallback > 0
    ? clampHorizontalZoom(fallback)
    : DEFAULT_HORIZONTAL_ZOOM;
  if (!Number.isFinite(value) || value <= 0) return safeFallback;
  return clampHorizontalZoom(value);
}

/** Audacity doubles the timeline scale to zoom in and halves it to zoom out. */
export function stepHorizontalZoom(value: number, direction: HorizontalZoomDirection): number {
  const current = normalizeHorizontalZoom(value);
  return normalizeHorizontalZoom(current * (direction === 'in' ? 2 : 0.5));
}

/** Match Audacity's (usable width - 1) / duration zoom-to-fit calculation. */
export function horizontalZoomForDuration(duration: number, usableWidth: number): number | null {
  if (!Number.isFinite(duration) || duration <= 0) return null;
  if (!Number.isFinite(usableWidth) || usableWidth <= 1) return null;
  return normalizeHorizontalZoom((usableWidth - 1) / duration);
}
