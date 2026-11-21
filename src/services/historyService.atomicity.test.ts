import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { historyManager } from '@/services/historyService';
import type { IProject } from '@/types/project';

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
    id: 'history-atomicity-project',
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

function makeCommand(id: string, before: IProject, after: IProject) {
  return {
    id,
    label: id,
    execute: () => after,
    undo: () => before,
  };
}

beforeEach(() => {
  historyManager.setPersistEnabled(false);
  historyManager.clear();
});

afterEach(async () => {
  historyManager.setPersistEnabled(false);
  historyManager.clear();
  await historyManager.flush();
});

describe('historyManager transactional undo/redo', () => {
  it('keeps the undo and redo stacks unchanged when the project save rejects', async () => {
    const before = makeProject('before');
    const after = makeProject('after');
    historyManager.push(makeCommand('edit-track', before, after), before);
    const commit = vi.fn(async (_project: IProject): Promise<boolean> => {
      throw new Error('IndexedDB quota exceeded');
    });

    await expect(historyManager.undo(after, commit)).rejects.toThrow('IndexedDB quota exceeded');

    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith(before);
    expect(historyManager.getUndoCount()).toBe(1);
    expect(historyManager.getRedoCount()).toBe(0);
    expect(historyManager.getUndoLabel()).toBe('edit-track');
  });

  it('treats a false project save as a failed redo without moving either stack', async () => {
    const before = makeProject('before');
    const after = makeProject('after');
    historyManager.push(makeCommand('edit-track', before, after), before);
    historyManager.undo(after);
    expect(historyManager.getRedoCount()).toBe(1);
    const commit = vi.fn(async (_project: IProject): Promise<boolean> => false);

    await expect(historyManager.redo(before, commit)).rejects.toThrow('历史恢复保存失败');

    expect(commit).toHaveBeenCalledWith(after);
    expect(historyManager.getUndoCount()).toBe(0);
    expect(historyManager.getRedoCount()).toBe(1);
    expect(historyManager.getRedoLabel()).toBe('edit-track');
  });

  it('serializes consecutive undo/redo commits and restores exact whole snapshots in order', async () => {
    const zero = makeProject('zero');
    const one = makeProject('one');
    const two = makeProject('two');
    historyManager.push(makeCommand('edit-1', zero, one), zero);
    historyManager.push(makeCommand('edit-2', one, two), one);

    const gates = [
      deferred<boolean>(),
      deferred<boolean>(),
      deferred<boolean>(),
      deferred<boolean>(),
    ];
    const saves: IProject[] = [];
    const commit = vi.fn((project: IProject): Promise<boolean> => {
      const index = saves.length;
      saves.push(project);
      return gates[index]!.promise;
    });

    const firstUndo = historyManager.undo(two, commit);
    const secondUndo = historyManager.undo(two, commit);
    await vi.waitFor(() => expect(commit).toHaveBeenCalledTimes(1));
    expect(saves[0]).toBe(one);
    expect(historyManager.getUndoCount()).toBe(2);
    expect(historyManager.getRedoCount()).toBe(0);

    gates[0]!.resolve(true);
    await expect(firstUndo).resolves.toMatchObject({ project: one });
    await vi.waitFor(() => expect(commit).toHaveBeenCalledTimes(2));
    expect(saves[1]).toBe(zero);
    expect(historyManager.getUndoCount()).toBe(1);
    expect(historyManager.getRedoCount()).toBe(1);

    gates[1]!.resolve(true);
    await expect(secondUndo).resolves.toMatchObject({ project: zero });
    expect(historyManager.getUndoCount()).toBe(0);
    expect(historyManager.getRedoCount()).toBe(2);

    const firstRedo = historyManager.redo(zero, commit);
    const secondRedo = historyManager.redo(zero, commit);
    await vi.waitFor(() => expect(commit).toHaveBeenCalledTimes(3));
    expect(saves[2]).toBe(one);
    expect(historyManager.getUndoCount()).toBe(0);
    expect(historyManager.getRedoCount()).toBe(2);

    gates[2]!.resolve(true);
    await expect(firstRedo).resolves.toMatchObject({ project: one });
    await vi.waitFor(() => expect(commit).toHaveBeenCalledTimes(4));
    expect(saves[3]).toBe(two);
    expect(historyManager.getUndoCount()).toBe(1);
    expect(historyManager.getRedoCount()).toBe(1);

    gates[3]!.resolve(true);
    await expect(secondRedo).resolves.toMatchObject({ project: two });
    expect(saves.map((project) => project.name)).toEqual(['one', 'zero', 'one', 'two']);
    expect(historyManager.getUndoCount()).toBe(2);
    expect(historyManager.getRedoCount()).toBe(0);
    expect(historyManager.getUndoLabel()).toBe('edit-2');
  });
});
