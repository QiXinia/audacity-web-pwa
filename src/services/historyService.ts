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

export interface HistoryTransition {
  project: IProject;
  command: HistoryCommand;
}

type HistoryProjectCommit = (project: IProject) => Promise<boolean | void>;

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
  private transitionChain: Promise<void> = Promise.resolve();
  private loadGeneration = 0;
  private stackRevision = 0;

  async loadForProject(projectId: string): Promise<number> {
    const generation = ++this.loadGeneration;

    // Finish history restoration and writes belonging to the previously open
    // project before switching. A newer load may supersede this one meanwhile.
    await this.transitionChain.catch(() => undefined);
    await this.persistChain.catch(() => undefined);
    if (generation !== this.loadGeneration) return 0;

    this.projectId = projectId;
    this.undoStack = [];
    this.redoStack = [];
    const revision = ++this.stackRevision;

    if (!this.persistEnabled) return 0;

    try {
      const snapshots = await audioDb.historySnapshots
        .where('projectId')
        .equals(projectId)
        .sortBy('index');

      // Do not let an obsolete database continuation write another project's
      // stacks. This mirrors Audacity's project-attached ProjectHistory.
      if (generation !== this.loadGeneration || this.projectId !== projectId) return 0;

      const loadedUndoStack: HistoryCommand[] = [];
      const loadedRedoStack: HistoryCommand[] = [];
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
          loadedRedoStack.push(command);
        } else {
          loadedUndoStack.push(command);
        }
      }

      // redoStack is stored in execution order; its top must be the next redo.
      loadedRedoStack.reverse();

      if (this.stackRevision === revision) {
        this.undoStack = loadedUndoStack;
        this.redoStack = loadedRedoStack;
      } else {
        // Commands created while the database read was in flight are newer than
        // every restored snapshot. Keep them on top and preserve their redo
        // semantics instead of resurrecting a persisted redo branch.
        this.undoStack = [...loadedUndoStack, ...this.undoStack].slice(-this.maxUndoSteps);
        this.schedulePersist();
      }

      logger.info(
        `历史快照加载完成: undo=${loadedUndoStack.length}, redo=${loadedRedoStack.length}`,
      );
      return loadedUndoStack.length + loadedRedoStack.length;
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
    this.stackRevision += 1;

    // Commands in this application are pure state transitions. Evaluating them
    // here only captures state; it does not rerun audio or database operations.
    if (projectBefore) {
      command.undo = () => projectBefore;
    }
    this.schedulePersist();
  }

  undo(_project: IProject, commit: HistoryProjectCommit): Promise<HistoryTransition | null>;
  undo(_project: IProject): HistoryTransition | null;
  undo(
    _project: IProject,
    commit?: HistoryProjectCommit,
  ): HistoryTransition | null | Promise<HistoryTransition | null> {
    if (commit) return this.enqueueTransition('undo', commit);
    const command = this.undoStack.pop();
    if (!command) return null;

    const project = command.undo();
    this.redoStack.push(command);
    this.stackRevision += 1;
    this.schedulePersist();
    return { project, command };
  }

  redo(_project: IProject, commit: HistoryProjectCommit): Promise<HistoryTransition | null>;
  redo(_project: IProject): HistoryTransition | null;
  redo(
    _project: IProject,
    commit?: HistoryProjectCommit,
  ): HistoryTransition | null | Promise<HistoryTransition | null> {
    if (commit) return this.enqueueTransition('redo', commit);
    const command = this.redoStack.pop();
    if (!command) return null;

    const project = command.execute();
    this.undoStack.push(command);
    this.stackRevision += 1;
    this.schedulePersist();
    return { project, command };
  }

  /**
   * Serialize project-backed history transitions. The command remains on its
   * original stack and no snapshot persistence is scheduled until the exact
   * whole-project snapshot has been saved successfully.
   */
  private enqueueTransition(
    direction: 'undo' | 'redo',
    commit: HistoryProjectCommit,
  ): Promise<HistoryTransition | null> {
    const operation = async (): Promise<HistoryTransition | null> => {
      const source = direction === 'undo' ? this.undoStack : this.redoStack;
      const command = source[source.length - 1];
      if (!command) return null;

      const revision = this.stackRevision;
      const projectId = this.projectId;
      const isStale = () => revision !== this.stackRevision
        || projectId !== this.projectId;
      const project = direction === 'undo' ? command.undo() : command.execute();

      let saved: boolean | void;
      try {
        saved = await commit(project);
      } catch (error) {
        // A failed save from an obsolete editor must not surface in, or mutate,
        // the project that has since become active.
        if (isStale()) return null;
        throw error;
      }
      if (isStale()) return null;
      if (saved === false) throw new Error('历史恢复保存失败');

      // A newer stack edit or clear supersedes this pending transition. Project
      // loads instead wait for it before replacing the old project's stacks.
      // Only the exact command captured above may move stacks.
      const currentSource = direction === 'undo' ? this.undoStack : this.redoStack;
      if (currentSource[currentSource.length - 1] !== command) return null;
      currentSource.pop();
      if (direction === 'undo') this.redoStack.push(command);
      else this.undoStack.push(command);
      this.stackRevision += 1;
      this.schedulePersist();
      return { project, command };
    };

    const result = this.transitionChain.then(operation);
    // A rejected save is reported to its caller but must not poison later,
    // explicitly requested undo/redo operations.
    this.transitionChain = result.then(() => undefined, () => undefined);
    return result;
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
    this.loadGeneration += 1;
    this.stackRevision += 1;
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

    // Serialize with project lifecycle writes on the overlapping stores. If
    // permanent deletion commits first, the missing project record suppresses
    // the queued write; if this transaction commits first, deletion removes
    // these snapshots afterwards. Replacement is atomic on write failure.
    await audioDb.transaction(
      'rw',
      audioDb.projects,
      audioDb.historySnapshots,
      async () => {
        const project = await audioDb.projects.get(projectId);
        if (!project) return;

        await audioDb.historySnapshots.where('projectId').equals(projectId).delete();
        if (records.length > 0) {
          await audioDb.historySnapshots.bulkAdd(records);
        }
      },
    );
  }
}

export const historyManager = new HistoryManager();
