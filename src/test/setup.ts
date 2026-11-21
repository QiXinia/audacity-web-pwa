import { afterEach, beforeEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import type { IProject } from '@/types/project';

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
beforeEach(async () => {
  // Older page test doubles predate editLatestProject. Adapt only those mocks
  // to the real contract so their existing saveProject assertions still inspect
  // the edited snapshot; production code has no whole-snapshot fallback.
  const { projectService } = await import('@/services/projectService');
  const service = projectService as unknown as Record<string, unknown>;
  if (vi.isMockFunction(service.getProject)
    && vi.isMockFunction(service.saveProject)
    && (typeof service.editLatestProject !== 'function' || service.__testLatestProjectAdapter === true)) {
    let queuedLatest: IProject | null | undefined;
    Object.assign(service, {
      __testLatestProjectAdapter: true,
      editLatestProject: vi.fn(async (
        projectId: string,
        edit: (latest: IProject) => IProject,
      ) => {
        const getProject = service.getProject as (id: string) => Promise<IProject | null>;
        const openProject = service.openProject as (id: string) => Promise<IProject | null>;
        const latest = queuedLatest ?? await getProject(projectId) ?? await openProject(projectId);
        if (!latest) return null;
        const before = structuredClone(latest);
        const after = edit(latest);
        if (after === latest) return null;
        const saveProject = service.saveProject as (project: IProject) => Promise<unknown>;
        await saveProject(after);
        queuedLatest = after;
        return { before, after };
      }),
    });
  }

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
