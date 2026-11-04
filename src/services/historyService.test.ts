import { describe, it, expect, beforeEach, vi } from 'vitest';
import { historyManager } from '@/services/historyService';
import type { IProject } from '@/types/project';

// 关闭持久化，纯内存测试
beforeEach(() => {
  historyManager.setPersistEnabled(false);
  historyManager.clear();
});

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
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

describe('historyManager - 撤销/重做基础', () => {
  it('初始状态无法撤销和重做', () => {
    expect(historyManager.canUndo()).toBe(false);
    expect(historyManager.canRedo()).toBe(false);
    expect(historyManager.getUndoCount()).toBe(0);
    expect(historyManager.getRedoCount()).toBe(0);
  });

  it('push 后可以撤销', () => {
    const proj = makeProject('test');
    historyManager.push({
      id: 'cmd-1',
      label: '添加轨道',
      execute: () => proj,
      undo: () => ({ ...proj, name: 'undone' }),
    }, proj);

    expect(historyManager.canUndo()).toBe(true);
    expect(historyManager.getUndoCount()).toBe(1);
    expect(historyManager.getUndoLabel()).toBe('添加轨道');
  });

  it('undo 返回正确的项目状态', () => {
    const before = makeProject('before');
    const after = makeProject('after');
    historyManager.push({
      id: 'cmd-1',
      label: '修改',
      execute: () => after,
      undo: () => before,
    }, before);

    const result = historyManager.undo(after);
    expect(result).not.toBeNull();
    expect(result!.project.id).toBe(before.id);
    expect(result!.project.name).toBe('before');
    expect(result!.command.label).toBe('修改');
  });

  it('undo 后可以 redo', () => {
    const before = makeProject('before');
    const after = makeProject('after');
    historyManager.push({
      id: 'cmd-1',
      label: '修改',
      execute: () => after,
      undo: () => before,
    }, before);

    historyManager.undo(after);
    expect(historyManager.canRedo()).toBe(true);
    expect(historyManager.getRedoLabel()).toBe('修改');

    const result = historyManager.redo(before);
    expect(result).not.toBeNull();
    expect(result!.project.id).toBe(after.id);
  });

  it('新操作清空 redo 栈', () => {
    const p1 = makeProject('p1');
    const p2 = makeProject('p2');
    historyManager.push({
      id: 'cmd-1',
      label: '操作1',
      execute: () => makeProject('p1'),
      undo: () => makeProject('p1'),
    }, p1);

    historyManager.undo(p1);
    expect(historyManager.canRedo()).toBe(true);

    // 新操作
    historyManager.push({
      id: 'cmd-2',
      label: '操作2',
      execute: () => makeProject('p2'),
      undo: () => makeProject('p2'),
    }, p2);

    expect(historyManager.canRedo()).toBe(false);
    expect(historyManager.getRedoCount()).toBe(0);
  });

  it('多次 push 形成撤销栈', () => {
    for (let i = 0; i < 5; i++) {
      historyManager.push({
        id: `cmd-${i}`,
        label: `操作${i}`,
        execute: () => makeProject(`p${i}`),
        undo: () => makeProject(`p${i}`),
      }, makeProject(`p${i}`));
    }
    expect(historyManager.getUndoCount()).toBe(5);
    expect(historyManager.getUndoLabel()).toBe('操作4');
  });

  it('clear 清空两个栈', () => {
    historyManager.push({
      id: 'cmd-1',
      label: '操作',
      execute: () => makeProject('p'),
      undo: () => makeProject('p'),
    }, makeProject('p'));

    historyManager.clear();
    expect(historyManager.canUndo()).toBe(false);
    expect(historyManager.canRedo()).toBe(false);
  });

  it('空栈 undo 返回 null', () => {
    const result = historyManager.undo(makeProject('p'));
    expect(result).toBeNull();
  });

  it('空栈 redo 返回 null', () => {
    const result = historyManager.redo(makeProject('p'));
    expect(result).toBeNull();
  });
});
