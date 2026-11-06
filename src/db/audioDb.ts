// EXPORTS: AudioDatabase, audioDb, serializeTracks, deserializeTracks, serializeSelection, deserializeSelection, serializeHistorySnapshot, deserializeHistorySnapshot

import Dexie, { type Table } from 'dexie';
import type { IProjectSummary, ITrack, IClip } from '@/types/project';

export interface ProjectRecord extends IProjectSummary {
  tracksData: string; // JSON serialized ITrack[]
  viewStateData: string; // JSON serialized IViewState
  tempo: number;
  timeSignature: { numerator: number; denominator: number };
  cursorPosition: number;
  selectionData: string | null; // JSON serialized selection
  loopRegionData?: string | null; // JSON serialized independent loop region
  loopEnabled?: boolean;
}

export interface AudioBufferRecord {
  id: string;
  projectId: string;
  sampleRate: number;
  channels: number;
  length: number;
  duration: number;
  channelData: ArrayBuffer[]; // Float32Array as ArrayBuffer for storage
  createdAt: number;
}

export interface ClipboardState {
  id: string;
  data: string; // JSON serialized
  createdAt: number;
}

export interface HistorySnapshotRecord {
  id?: number; // auto-increment
  projectId: string;
  stackType: 'undo' | 'redo';
  index: number; // position in stack
  label: string;
  snapshotData: string; // JSON serialized IProject state at this point
  timestamp: number;
}

class AudioDatabase extends Dexie {
  projects!: Table<ProjectRecord, string>;
  audioBuffers!: Table<AudioBufferRecord, string>;
  clipboard!: Table<ClipboardState, string>;
  historySnapshots!: Table<HistorySnapshotRecord, number>;

  constructor() {
    super('audacity_web_db');

    this.version(2).stores({
      projects: 'id, name, status, updatedAt, createdAt, deletedAt',
      audioBuffers: 'id, projectId, createdAt',
      clipboard: 'id, createdAt',
      historySnapshots: '++id, projectId, stackType, index, timestamp',
    });

    // v1 migration (no-op, v2 creates new table)
  }
}

export const audioDb = new AudioDatabase();

// Serialization helpers
export function serializeTracks(tracks: ITrack[]): string {
  return JSON.stringify(tracks);
}

export function deserializeTracks(data: string): ITrack[] {
  try {
    const tracks = JSON.parse(data) as ITrack[];
    return tracks.map((track) => ({
      ...track,
      clips: track.clips.map((clip) => ({
        ...clip,
        stretchRatio: Number.isFinite(clip.stretchRatio) && (clip.stretchRatio ?? 0) > 0
          ? clip.stretchRatio
          : 1,
      })),
    }));
  } catch {
    return [];
  }
}

export function serializeSelection(selection: { start: number; end: number } | null): string | null {
  return selection ? JSON.stringify(selection) : null;
}

export function deserializeSelection(data: string | null): { start: number; end: number } | null {
  if (!data) return null;
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

export function serializeHistorySnapshot(project: unknown): string {
  return JSON.stringify(project);
}

export function deserializeHistorySnapshot<T>(data: string): T | null {
  try {
    return JSON.parse(data) as T;
  } catch {
    return null;
  }
}
