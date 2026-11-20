import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Dexie from 'dexie';
import {
  audioDb,
  type HistorySnapshotRecord,
  type ProjectRecord,
} from '@/db/audioDb';
import { historyManager } from '@/services/historyService';
import type { IProject } from '@/types/project';

vi.mock('@/db/audioDb', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/db/audioDb')>();
  return {
    ...actual,
    audioDb: {
      projects: { get: vi.fn() },
      historySnapshots: {
        where: vi.fn(),
        bulkAdd: vi.fn(),
      },
      transaction: vi.fn(),
    },
  };
});

function makeProject(name: string, id = 'history-project'): IProject {
  return {
    id,
    name,
    sampleRate: 44100,
    timeSignature: { numerator: 4, denominator: 4 },
    tempo: 120,
    tracks: [],
    cursorPosition: 0,
    selection: null,
    viewState: { horizontalZoom: 1, verticalZoom: 1, scrollX: 0, viewMode: 'waveform' },
    createdAt: 1,
    updatedAt: 1,
  };
}

function makeProjectRecord(id: string): ProjectRecord {
  const project = makeProject(id, id);
  return {
    ...project,
    duration: 0,
    trackCount: 0,
    status: 'active',
    tracksData: '[]',
    viewStateData: '{}',
    selectionData: null,
  };
}

function makeHistory(
  id: number,
  projectId: string,
  label: string,
): HistorySnapshotRecord {
  return {
    id,
    projectId,
    stackType: 'undo',
    index: 0,
    label,
    snapshotData: JSON.stringify({
      before: makeProject(`${label}-before`, projectId),
      after: makeProject(`${label}-after`, projectId),
    }),
    timestamp: id,
  };
}

function pushCommand(label = 'new-command') {
  const before = makeProject(`${label}-before`);
  const after = makeProject(`${label}-after`);
  historyManager.push({
    id: label,
    label,
    execute: () => after,
    undo: () => before,
  }, before);
}

function mockPersistence(
  initialProjects: ProjectRecord[],
  initialSnapshots: HistorySnapshotRecord[],
  options: { bulkAddError?: Error } = {},
) {
  const projects = new Map(initialProjects.map((record) => [record.id, { ...record }]));
  const snapshots = new Map(initialSnapshots.map((record) => [record.id, { ...record }]));
  let nextId = Math.max(0, ...initialSnapshots.map(({ id }) => id ?? 0)) + 1;

  vi.mocked(audioDb.projects.get).mockImplementation(((id: string) => {
    const record = projects.get(id);
    return Dexie.Promise.resolve(record ? { ...record } : undefined);
  }) as never);

  vi.mocked(audioDb.historySnapshots.where).mockImplementation((() => ({
    equals: (projectId: string) => ({
      sortBy: () => Promise.resolve(
        [...snapshots.values()]
          .filter((record) => record.projectId === projectId)
          .sort((a, b) => a.index - b.index)
          .map((record) => ({ ...record })),
      ),
      delete: () => {
        let deleted = 0;
        for (const [id, record] of snapshots) {
          if (record.projectId === projectId) {
            snapshots.delete(id);
            deleted += 1;
          }
        }
        return Promise.resolve(deleted);
      },
    }),
  })) as never);

  vi.mocked(audioDb.historySnapshots.bulkAdd).mockImplementation(((records: HistorySnapshotRecord[]) => {
    if (options.bulkAddError) return Promise.reject(options.bulkAddError);
    let lastId = 0;
    for (const record of records) {
      const id = record.id ?? nextId++;
      snapshots.set(id, { ...record, id });
      lastId = id;
    }
    return Promise.resolve(lastId);
  }) as never);

  // Model IndexedDB rollback so the tests distinguish an atomic replacement
  // from the old delete-then-bulkAdd sequence.
  vi.mocked(audioDb.transaction).mockImplementation((async (...args: unknown[]) => {
    const operation = args[args.length - 1];
    if (typeof operation !== 'function') throw new TypeError('Missing transaction callback');
    const projectBackup = new Map(projects);
    const snapshotBackup = new Map(snapshots);
    try {
      return await (operation as () => Promise<unknown>)();
    } catch (error) {
      projects.clear();
      for (const [id, record] of projectBackup) projects.set(id, record);
      snapshots.clear();
      for (const [id, record] of snapshotBackup) snapshots.set(id, record);
      throw error;
    }
  }) as never);

  return { projects, snapshots };
}

beforeEach(async () => {
  historyManager.setPersistEnabled(false);
  historyManager.clear();
  await historyManager.flush();
  historyManager.setPersistEnabled(true);
});

afterEach(async () => {
  historyManager.setPersistEnabled(false);
  historyManager.clear();
  await historyManager.flush();
  vi.clearAllMocks();
});

describe('historyManager - persistent history transaction boundaries', () => {
  it('does not recreate snapshots when permanent deletion wins before a queued write', async () => {
    const state = mockPersistence([makeProjectRecord('history-project')], []);
    await historyManager.loadForProject('history-project');

    pushCommand('queued-before-delete');
    // The history write is queued behind a promise. Permanent deletion commits
    // before that write starts, as can happen when the editor is being closed.
    state.projects.delete('history-project');
    await historyManager.flush();

    expect(state.projects.has('history-project')).toBe(false);
    expect(state.snapshots.size).toBe(0);
    expect(audioDb.historySnapshots.bulkAdd).not.toHaveBeenCalled();
  });

  it('restores the previous history when bulkAdd fails after deletion', async () => {
    const original = makeHistory(1, 'history-project', 'original-command');
    const state = mockPersistence(
      [makeProjectRecord('history-project')],
      [original],
      { bulkAddError: new Error('history bulkAdd failed') },
    );
    await historyManager.loadForProject('history-project');

    pushCommand('replacement-that-fails');
    await historyManager.flush();

    expect([...state.snapshots.values()]).toEqual([original]);
  });

  it('replaces active-project history in one transaction without touching other projects', async () => {
    const original = makeHistory(1, 'history-project', 'original-command');
    const other = makeHistory(2, 'other-project', 'other-command');
    const state = mockPersistence(
      [makeProjectRecord('history-project'), makeProjectRecord('other-project')],
      [original, other],
    );
    await historyManager.loadForProject('history-project');

    pushCommand();
    await historyManager.flush();

    expect([...state.snapshots.values()].filter(({ projectId }) => projectId === 'other-project'))
      .toEqual([other]);
    expect([...state.snapshots.values()]
      .filter(({ projectId }) => projectId === 'history-project')
      .map(({ label }) => label))
      .toEqual(['original-command', 'new-command']);
    expect(audioDb.transaction).toHaveBeenCalledWith(
      'rw',
      audioDb.projects,
      audioDb.historySnapshots,
      expect.any(Function),
    );
  });
});
