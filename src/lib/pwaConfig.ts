export const pwaUpdateWorkboxConfig = {
  // updateSW(true) still controls when a waiting worker activates. Once it does,
  // claim open clients so Workbox emits `controlling` and reloads stale pages.
  clientsClaim: true,
} as const;
