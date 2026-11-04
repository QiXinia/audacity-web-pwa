import { afterEach, beforeEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';

// Mock Dexie / IndexedDB（jsdom 没有真实 IndexedDB）
vi.mock('@/db/audioDb', () => {
  const mockWhere = () => ({
    equals: () => ({
      sortBy: async () => [],
      reverse: () => ({ sortBy: async () => [] }),
    }),
  });
  return {
    audioDb: {
      projects: { toArray: async () => [] },
      deletedProjects: { toArray: async () => [] },
      audioClips: { get: async () => undefined },
      historySnapshots: {
        where: mockWhere,
        bulkAdd: async () => {},
      },
    },
    serializeHistorySnapshot: <T>(data: T) => JSON.stringify(data),
    deserializeHistorySnapshot: <T>(str: string): T | null => {
      try { return JSON.parse(str) as T; } catch { return null; }
    },
  };
});

// Dexie 和 IndexedDB 在 jsdom 中不可用，用 mock 跳过
beforeEach(() => {
  // mock window.matchMedia
  if (typeof window !== 'undefined' && !window.matchMedia) {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    });
  }

  // mock ResizeObserver
  if (typeof window !== 'undefined' && !globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
});

afterEach(() => {
  // 清理
});
