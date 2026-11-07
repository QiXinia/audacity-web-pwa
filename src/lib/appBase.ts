export const DEFAULT_APP_BASE = '/audacity-web-pwa/';

/** Production preview and Pages use the same base unless explicitly overridden. */
export function resolveAppBase(configuredBase?: string): string {
  return configuredBase || DEFAULT_APP_BASE;
}
