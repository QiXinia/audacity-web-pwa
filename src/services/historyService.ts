// EXPORTS: historyManager

import { logger } from '@/lib/logger';
import {
  audioDb,
  serializeHistorySnapshot,
  deserializeHistorySnapshot,
} from '@/db/audioDb';
import type { IProject } from '@/types/project';

export interface HistoryCommand {
  id: string;
  label: string;
  execute: () => IProject;
  undo: () => IProject;
}

interface PersistedCommandSnapshot {
  before: IProject;
  after: IProject;
}

const MAX_UNDO_STEPS = 50;
const MAX_PERSISTED_SNAPSHOTS = 20;

/**
 * Command-based in-memory history with serialisable before/after snapshots.
 *
 * The original commands cannot be restored after a reload, so each persisted
 * entry stores both states. Restored commands behave exactly like ordinary
 * undo/redo commands without rerunning audio operations.
 */
class HistoryManager {
  private undoStack: HistoryCommand[] = [];
  private redoStack: HistoryCommand[] = [];
  private readonly maxUndoSteps = MAX_UNDO_STEPS;
  private projectId: string | null = null;
  private persistEnabled = true;
  private persistChain: Promise<void> = Promise.resolve();

  async loadForProject(projectId: string): Promise<number> {
    // Finish writes belonging to the previously open project before switching.
    await this.persistChain.catch(() => undefined);
    this.projectId = projectId;
    this.undoStack = [];
    this.redoStack = [];

    if (!this.persistEnabled) return 0;

    try {
      const snapshots = await audioDb.historySnapshots
        .where('projectId')
        .equals(projectId)
        .sortBy('index');

      for (const snapshot of snapshots) {
        const states = deserializeHistorySnapshot<PersistedCommandSnapshot>(snapshot.snapshotData);
        if (!states?.before || !states?.after) continue;

        const command: HistoryCommand = {
          id: `snapshot-${snapshot.id ?? snapshot.timestamp}`,
          label: snapshot.label,
          execute: () => states.after,
          undo: () => states.before,
        };
        if (snapshot.stackType === 'redo') {
          this.redoStack.push(command);
        } else {
          this.undoStack.push(command);
        }
      }

      // redoStack is stored in execution order; its top must be the next redo.
      this.redoStack.reverse();
      logger.info(
        `历史快照加载完成: undo=${this.undoStack.length}, redo=${this.redoStack.length}`,
      );
      return this.undoStack.length + this.redoStack.length;
    } catch (error) {
      logger.warn('加载历史快照失败:', String(error));
      return 0;
    }
  }

  push(command: HistoryCommand, projectBefore?: IProject): void {
    this.undoStack.push(command);
    if (this.undoStack.length > this.maxUndoSteps) {
      this.undoStack.shift();
    }
    this.redoStack = [];

    // Commands in this application are pure state transitions. Evaluating them
    // here only captures state; it does not rerun audio or database operations.
    if (projectBefore) {
      command.undo = () => projectBefore;
    }
    this.schedulePersist();
  }

  undo(_project: IProject): { project: IProject; command: HistoryCommand } | null {
    const command = this.undoStack.pop();
    if (!command) return null;

    const project = command.undo();
    this.redoStack.push(command);
    this.schedulePersist();
    return { project, command };
  }

  redo(_project: IProject): { project: IProject; command: HistoryCommand } | null {
    const command = this.redoStack.pop();
    if (!command) return null;

    const project = command.execute();
    this.undoStack.push(command);
    this.schedulePersist();
    return { project, command };
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  getUndoLabel(): string | null {
    return this.undoStack[this.undoStack.length - 1]?.label ?? null;
  }

  getRedoLabel(): string | null {
    return this.redoStack[this.redoStack.length - 1]?.label ?? null;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.schedulePersist();
  }

  getUndoCount(): number {
    return this.undoStack.length;
  }

  getRedoCount(): number {
    return this.redoStack.length;
  }

  setPersistEnabled(enabled: boolean): void {
    this.persistEnabled = enabled;
  }

  async flush(): Promise<void> {
    await this.persistChain.catch(() => undefined);
  }

  private schedulePersist(): void {
    if (!this.persistEnabled || !this.projectId) return;
    const projectId = this.projectId;
    const undoCommands = [...this.undoStack];
    // Store redo in bottom-to-top order so load can reverse it deterministically.
    const redoCommands = [...this.redoStack].reverse();

    this.persistChain = this.persistChain
      .then(() => this.persistStacks(projectId, undoCommands, redoCommands))
      .catch((error) => {
        logger.warn('持久化历史快照异常:', String(error));
      });
  }

  private async persistStacks(
    projectId: string,
    undoCommands: HistoryCommand[],
    redoCommands: HistoryCommand[],
  ): Promise<void> {
    if (this.projectId !== projectId) return;

    const records: {
      projectId: string;
      stackType: 'undo' | 'redo';
      index: number;
      label: string;
      snapshotData: string;
      timestamp: number;
    }[] = [];
    const now = Date.now();

    const append = (commands: HistoryCommand[], stackType: 'undo' | 'redo') => {
      const retained = commands.slice(-MAX_PERSISTED_SNAPSHOTS);
      retained.forEach((command, index) => {
        const states: PersistedCommandSnapshot = {
          before: command.undo(),
          after: command.execute(),
        };
        records.push({
          projectId,
          stackType,
          index,
          label: command.label,
          snapshotData: serializeHistorySnapshot(states),
          timestamp: now + index,
        });
      });
    };

    append(undoCommands, 'undo');
    append(redoCommands, 'redo');

    await audioDb.historySnapshots.where('projectId').equals(projectId).delete();
    if (records.length > 0) {
      await audioDb.historySnapshots.bulkAdd(records);
    }
  }
}

export const historyManager = new HistoryManager();
