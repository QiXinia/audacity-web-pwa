import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { audioDb } from '@/db/audioDb';
import { historyManager } from '@/services/historyService';
import type { IProject } from '@/types/project';

vi.mock('@/db/audioDb', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/db/audioDb')>();
  return {
    ...actual,
    audioDb: {
      projects: {
        get: vi.fn((id: string) => Promise.resolve({ id })),
      },
      historySnapshots: {
        where: vi.fn(),
        bulkAdd: vi.fn().mockResolvedValue([]),
      },
      transaction: vi.fn(async (...args: unknown[]) => {
        const operation = args[args.length - 1] as () => Promise<unknown>;
        return operation();
      }),
    },
  };
});

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function makeProject(name: string): IProject {
  return {
    id: `proj-${name}`,
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

function snapshot(projectId: string, label: string) {
  return {
    id: 1,
    projectId,
    stackType: 'undo',
    index: 0,
    label,
    snapshotData: JSON.stringify({
      before: makeProject(`${label}-before`),
      after: makeProject(`${label}-after`),
    }),
    timestamp: 1,
  };
}

function mockSnapshotReads(reads: Map<string, Promise<unknown[]>>) {
  const sortBy = vi.fn();
  vi.mocked(audioDb.historySnapshots.where).mockImplementation((() => ({
    equals: (projectId: string) => ({
      sortBy: (index: string) => {
        sortBy(projectId, index);
        return reads.get(projectId) ?? Promise.resolve([]);
      },
      delete: vi.fn().mockResolvedValue(0),
    }),
  })) as never);
  return sortBy;
}

beforeEach(() => {
  historyManager.setPersistEnabled(false);
  historyManager.clear();
  vi.mocked(audioDb.historySnapshots.where).mockReset();
  historyManager.setPersistEnabled(true);
});

afterEach(async () => {
  historyManager.setPersistEnabled(false);
  historyManager.clear();
  await historyManager.flush();
});

describe('historyManager - 历史快照并发加载隔离', () => {
  it('旧工程读取最后完成时不得覆盖较新的工程历史', async () => {
    const oldRead = deferred<unknown[]>();
    const newRead = deferred<unknown[]>();
    const sortBy = mockSnapshotReads(new Map([
      ['old-project', oldRead.promise],
      ['new-project', newRead.promise],
    ]));

    const oldLoad = historyManager.loadForProject('old-project');
    await vi.waitFor(() => expect(sortBy).toHaveBeenCalledTimes(1));
    const newLoad = historyManager.loadForProject('new-project');
    await vi.waitFor(() => expect(sortBy).toHaveBeenCalledTimes(2));

    newRead.resolve([snapshot('new-project', 'new-command')]);
    await expect(newLoad).resolves.toBe(1);
    expect(historyManager.getUndoLabel()).toBe('new-command');

    oldRead.resolve([snapshot('old-project', 'old-command')]);
    await expect(oldLoad).resolves.toBe(0);

    expect(historyManager.getUndoCount()).toBe(1);
    expect(historyManager.getUndoLabel()).toBe('new-command');
  });

  it('读取期间清空历史后不得由旧 continuation 重新填入', async () => {
    const pendingRead = deferred<unknown[]>();
    const sortBy = mockSnapshotReads(new Map([
      ['current-project', pendingRead.promise],
    ]));

    const loading = historyManager.loadForProject('current-project');
    await vi.waitFor(() => expect(sortBy).toHaveBeenCalledTimes(1));

    historyManager.clear();
    await historyManager.flush();
    pendingRead.resolve([snapshot('current-project', 'stale-command')]);

    await expect(loading).resolves.toBe(0);
    expect(historyManager.getUndoCount()).toBe(0);
    expect(historyManager.getRedoCount()).toBe(0);
  });

  it('加载期间的新命令不得被持久化快照覆盖或排到栈顶之后', async () => {
    const pendingRead = deferred<unknown[]>();
    const sortBy = mockSnapshotReads(new Map([
      ['current-project', pendingRead.promise],
    ]));

    const loading = historyManager.loadForProject('current-project');
    await vi.waitFor(() => expect(sortBy).toHaveBeenCalledTimes(1));

    const before = makeProject('live-before');
    const after = makeProject('live-after');
    historyManager.push({
      id: 'live-command',
      label: 'live-command',
      execute: () => after,
      undo: () => before,
    }, before);

    pendingRead.resolve([
      snapshot('current-project', 'persisted-command'),
      {
        ...snapshot('current-project', 'persisted-redo'),
        id: 2,
        stackType: 'redo',
      },
    ]);

    await expect(loading).resolves.toBe(2);
    expect(historyManager.getUndoCount()).toBe(2);
    expect(historyManager.getUndoLabel()).toBe('live-command');
    expect(historyManager.canRedo()).toBe(false);

    const undone = historyManager.undo(after);
    expect(undone?.command.label).toBe('live-command');
    expect(undone?.project.name).toBe('live-before');
  });

  it('并发加载合并后仍保留最新的 50 步历史', async () => {
    const pendingRead = deferred<unknown[]>();
    const sortBy = mockSnapshotReads(new Map([
      ['current-project', pendingRead.promise],
    ]));

    const loading = historyManager.loadForProject('current-project');
    await vi.waitFor(() => expect(sortBy).toHaveBeenCalledTimes(1));

    for (let index = 0; index < 49; index += 1) {
      const project = makeProject(`live-${index}`);
      historyManager.push({
        id: `live-${index}`,
        label: `live-${index}`,
        execute: () => project,
        undo: () => project,
      });
    }

    pendingRead.resolve(Array.from({ length: 20 }, (_, index) => ({
      ...snapshot('current-project', `persisted-${index}`),
      id: index + 1,
      index,
    })));

    await expect(loading).resolves.toBe(20);
    expect(historyManager.getUndoCount()).toBe(50);
    expect(historyManager.getUndoLabel()).toBe('live-48');

    const undone = historyManager.undo(makeProject('current'));
    expect(undone?.command.label).toBe('live-48');
    expect(historyManager.getUndoLabel()).toBe('live-47');
  });
});
