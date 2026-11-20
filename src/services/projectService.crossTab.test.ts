import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Dexie from 'dexie';
import { audioDb, type ProjectRecord } from '@/db/audioDb';
import { projectService } from '@/services/projectService';
import type { IProject } from '@/types/project';

vi.mock('@/db/audioDb', () => ({
  audioDb: {
    projects: { get: vi.fn(), put: vi.fn(), delete: vi.fn() },
    audioBuffers: {},
    clipboard: {},
    historySnapshots: {},
    transaction: vi.fn(),
  },
  serializeTracks: (tracks: unknown) => JSON.stringify(tracks),
  deserializeTracks: (data: string) => JSON.parse(data),
  serializeSelection: (selection: unknown) => selection ? JSON.stringify(selection) : null,
  deserializeSelection: (data: string | null) => data ? JSON.parse(data) : null,
}));

const mutableService = projectService as unknown as {
  currentProject: IProject | null;
  currentProjectId: string | null;
  saveQueue: Promise<void>;
};

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function makeProject(name: string, id = 'cross-tab-project'): IProject {
  return {
    id,
    name,
    sampleRate: 44100,
    timeSignature: { numerator: 4, denominator: 4 },
    tempo: 120,
    tracks: [],
    cursorPosition: 0,
    selection: null,
    viewState: {
      horizontalZoom: 100,
      verticalZoom: 1,
      scrollX: 0,
      viewMode: 'waveform',
    },
    updatedAt: 100,
    createdAt: 50,
  };
}

function makeRecord(
  name: string,
  status: ProjectRecord['status'] = 'active',
  id = 'cross-tab-project',
): ProjectRecord {
  return {
    id,
    name,
    sampleRate: 44100,
    duration: 0,
    trackCount: 0,
    status,
    updatedAt: 100,
    createdAt: 50,
    deletedAt: status === 'deleted' ? 90 : undefined,
    tracksData: '[]',
    viewStateData: '{}',
    tempo: 120,
    timeSignature: { numerator: 4, denominator: 4 },
    cursorPosition: 0,
    selectionData: null,
  };
}

let records: Map<string, ProjectRecord>;
let transactionTail: Promise<void>;

beforeEach(() => {
  records = new Map();
  transactionTail = Promise.resolve();
  vi.mocked(audioDb.projects.get).mockImplementation(((id: string) => {
    const record = records.get(id);
    return Dexie.Promise.resolve(record ? { ...record } : undefined);
  }) as never);
  vi.mocked(audioDb.projects.put).mockImplementation(((record: ProjectRecord) => {
    records.set(record.id, { ...record });
    return Dexie.Promise.resolve(record.id);
  }) as never);
  vi.mocked(audioDb.projects.delete).mockImplementation(((id: string) => {
    records.delete(id);
    return Dexie.Promise.resolve();
  }) as never);

  // Model IndexedDB read-write serialization: an overlapping transaction from
  // another tab cannot interleave with an active transaction's get/put pair.
  vi.mocked(audioDb.transaction).mockImplementation(((...args: unknown[]) => {
    const operation = args[args.length - 1];
    if (typeof operation !== 'function') throw new TypeError('Missing transaction callback');
    const result = transactionTail.then(() => (operation as () => Promise<unknown>)());
    transactionTail = result.then(() => undefined, () => undefined);
    return result;
  }) as never);
});

afterEach(() => {
  vi.clearAllMocks();
  mutableService.currentProject = null;
  mutableService.currentProjectId = null;
  mutableService.saveQueue = Promise.resolve();
});

describe('ProjectService cross-tab permanent deletion', () => {
  it('does not resurrect a project when another tab deletes between save read and write', async () => {
    records.set('cross-tab-project', makeRecord('before'));
    const putReached = deferred();
    const releasePut = deferred();
    let delayFirstPut = true;
    vi.mocked(audioDb.projects.put).mockImplementation(((record: ProjectRecord) => {
      if (delayFirstPut) {
        delayFirstPut = false;
        putReached.resolve();
        return releasePut.promise.then(() => {
          records.set(record.id, { ...record });
          return record.id;
        });
      }
      records.set(record.id, { ...record });
      return Dexie.Promise.resolve(record.id);
    }) as never);

    const save = projectService.saveProject(makeProject('stale-editor'));
    await putReached.promise;

    // This independent transaction represents permanent deletion in another
    // tab; it deliberately does not share this ProjectService's saveQueue.
    const otherTabDelete = audioDb.transaction('rw', audioDb.projects, async () => {
      await audioDb.projects.delete('cross-tab-project');
    });
    await Promise.resolve();
    await Promise.resolve();
    releasePut.resolve();
    await Promise.all([save, otherTabDelete]);

    expect(records.has('cross-tab-project')).toBe(false);
  });

  it('skips an editor save when permanent deletion committed before the save starts', async () => {
    await projectService.saveProject(makeProject('already-deleted'));

    expect(records.has('cross-tab-project')).toBe(false);
    expect(audioDb.projects.put).not.toHaveBeenCalled();
  });

  it('keeps explicit new-project creation and its first subsequent save working', async () => {
    const created = await projectService.createProject('new-project');
    expect(records.get(created.id)?.name).toBe('new-project');

    created.name = 'new-project-edited';
    await projectService.saveProject(created);

    expect(records.get(created.id)?.name).toBe('new-project-edited');
  });

  it('preserves soft-deletion metadata when saving an existing trashed project', async () => {
    const trashed = makeRecord('trashed', 'deleted');
    records.set(trashed.id, trashed);

    await projectService.saveProject(makeProject('stale-trash-edit'));

    expect(records.get(trashed.id)).toMatchObject({
      name: 'stale-trash-edit',
      status: 'deleted',
      deletedAt: 90,
    });
  });
});
