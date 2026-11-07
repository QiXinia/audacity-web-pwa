import { describe, expect, it } from 'vitest';
import { DEFAULT_APP_BASE, resolveAppBase } from './appBase';

describe('resolveAppBase', () => {
  it('uses the Pages base by default for production builds and previews', () => {
    expect(resolveAppBase()).toBe('/audacity-web-pwa/');
    expect(resolveAppBase('')).toBe(DEFAULT_APP_BASE);
  });

  it('honours explicit root and custom deployments', () => {
    expect(resolveAppBase('/')).toBe('/');
    expect(resolveAppBase('/custom/')).toBe('/custom/');
  });
});
