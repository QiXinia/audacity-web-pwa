import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { audioDb, type AudioBufferRecord, type ProjectRecord } from '@/db/audioDb';
import { audioEngine } from '@/engine/audioEngine';
import { historyManager } from '@/services/historyService';
import { projectService } from '@/services/projectService';
import type { IClip, IProject, ITrack } from '@/types/project';

vi.mock('@/db/audioDb', () => ({
  audioDb: {
    projects: { get: vi.fn(), put: vi.fn() },
    audioBuffers: { put: vi.fn(), delete: vi.fn() },
    clipboard: {},
    historySnapshots: {},
    transaction: vi.fn(),
  },
  serializeTracks: (tracks: unknown) => JSON.stringify(tracks),
  deserializeTracks: (data: string) => JSON.parse(data),
  serializeSelection: (selection: unknown) => selection ? JSON.stringify(selection) : null,
  deserializeSelection: (data: string | null) => data ? JSON.parse(data) : null,
  serializeHistorySnapshot: (project: unknown) => JSON.stringify(project),
  deserializeHistorySnapshot: (data: string) => JSON.parse(data),
}));

vi.mock('@/engine/audioEngine', () => ({
  audioEngine: { cacheBuffer: vi.fn(), evictBuffer: vi.fn() },
}));

const mutableService = projectService as unknown as {
  currentProject: IProject | null;
  currentProjectId: string | null;
  saveQueue: Promise<void>;
  projectToRecord(project: IProject): ProjectRecord;
};

function makeClip(id: string, audioBufferId: string): IClip {
  return {
    id,
    audioBufferId,
    startTime: 0,
    offset: 0,
    duration: 1,
    originalDuration: 1,
    stretchRatio: 1,
    gain: 0,
    fadeIn: 0,
    fadeOut: 0,
  };
}

function makeTrack(id: string, clips: IClip[]): ITrack {
  return {
    id,
    name: id,
    type: 'audio',
    gain: 0,
    pan: 0,
    muted: false,
    solo: false,
    armed: false,
    color: '',
    clips,
    effects: [],
  };
}

function makeProject(): IProject {
  return {
    id: 'track-removal-project',
    name: 'Track removal',
    sampleRate: 44100,
    timeSignature: { numerator: 4, denominator: 4 },
    tempo: 120,
    tracks: [
      makeTrack('track-remove', [
        makeClip('removed-shared', 'buffer-shared'),
        makeClip('removed-unique-a', 'buffer-unique'),
        makeClip('removed-unique-b', 'buffer-unique'),
      ]),
      makeTrack('track-keep', [
        makeClip('kept-shared', 'buffer-shared'),
        makeClip('kept-unique', 'buffer-keep'),
      ]),
    ],
    analysisLabels: [
      { id: 'label-remove', kind: 'manual', trackId: 'track-remove', start: 0, end: 1, text: 'Remove' },
      { id: 'label-keep', kind: 'manual', trackId: 'track-keep', start: 1, end: 2, text: 'Keep' },
    ],
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

function makeBuffer(id: string): AudioBufferRecord {
  return {
    id,
    projectId: 'track-removal-project',
    sampleRate: 44100,
    channels: 1,
    length: 1,
    duration: 1 / 44100,
    channelData: [Float32Array.from([0.25]).buffer],
    createdAt: 1,
  };
}

let records: Map<string, ProjectRecord>;
let buffers: Map<string, AudioBufferRecord>;

function persistedTrackIds(): string[] {
  const record = records.get('track-removal-project');
  return record ? (JSON.parse(record.tracksData) as ITrack[]).map((track) => track.id) : [];
}

function delayNextProjectPut(): () => void {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let delayed = false;
  vi.mocked(audioDb.projects.put).mockImplementation((async (record: ProjectRecord) => {
    if (!delayed) {
      delayed = true;
      await gate;
    }
    records.set(record.id, { ...record });
    return record.id;
  }) as never);
  return release;
}

function installProject(): IProject {
  const project = makeProject();
  records.set(project.id, mutableService.projectToRecord(project));
  mutableService.currentProject = project;
  mutableService.currentProjectId = project.id;
  return project;
}

beforeEach(() => {
  records = new Map();
  buffers = new Map([
    ['buffer-shared', makeBuffer('buffer-shared')],
    ['buffer-unique', makeBuffer('buffer-unique')],
    ['buffer-keep', makeBuffer('buffer-keep')],
  ]);
  vi.mocked(audioDb.projects.get).mockImplementation(((id: string) => {
    const record = records.get(id);
    return Promise.resolve(record ? { ...record } : undefined);
  }) as never);
  vi.mocked(audioDb.projects.put).mockImplementation(((record: ProjectRecord) => {
    records.set(record.id, { ...record });
    return Promise.resolve(record.id);
  }) as never);
  vi.mocked(audioDb.audioBuffers.delete).mockImplementation(((id: string) => {
    buffers.delete(id);
    return Promise.resolve();
  }) as never);
  vi.mocked(audioDb.transaction).mockImplementation((async (...args: unknown[]) => {
    const operation = args[args.length - 1];
    if (typeof operation !== 'function') throw new TypeError('Missing transaction callback');
    const recordSnapshot = new Map(records);
    const bufferSnapshot = new Map(buffers);
    try {
      return await (operation as () => Promise<unknown>)();
    } catch (error) {
      records.clear();
      for (const [id, record] of recordSnapshot) records.set(id, record);
      buffers.clear();
      for (const [id, buffer] of bufferSnapshot) buffers.set(id, buffer);
      throw error;
    }
  }) as never);
  historyManager.setPersistEnabled(false);
  historyManager.clear();
});

afterEach(() => {
  historyManager.clear();
  historyManager.setPersistEnabled(true);
  vi.restoreAllMocks();
  vi.clearAllMocks();
  mutableService.currentProject = null;
  mutableService.currentProjectId = null;
  mutableService.saveQueue = Promise.resolve();
});

describe('ProjectService safe track removal', () => {
  it('persists an immutable track removal without destroying audio needed by undo', async () => {
    const before = installProject();

    await projectService.removeTrack(before.id, 'track-remove');

    expect(before.tracks.map((track) => track.id)).toEqual(['track-remove', 'track-keep']);
    expect(mutableService.currentProject).not.toBe(before);
    expect(mutableService.currentProject?.tracks.map((track) => track.id)).toEqual(['track-keep']);
    expect(persistedTrackIds()).toEqual(['track-keep']);
    expect([...buffers.keys()]).toEqual(['buffer-shared', 'buffer-unique', 'buffer-keep']);
    expect(audioDb.audioBuffers.delete).not.toHaveBeenCalled();
    expect(audioEngine.evictBuffer).not.toHaveBeenCalled();
  });

  it('keeps a shared buffer referenced by a remaining track and split clips on the removed track', async () => {
    const before = installProject();

    await projectService.removeTrack(before.id, 'track-remove');

    expect(buffers.has('buffer-shared')).toBe(true);
    expect(buffers.has('buffer-unique')).toBe(true);
    expect(buffers.has('buffer-keep')).toBe(true);
    expect(audioDb.audioBuffers.delete).not.toHaveBeenCalled();
    expect(audioEngine.evictBuffer).not.toHaveBeenCalled();
  });

  it('restores the removed track and its readable buffers through the real undo path', async () => {
    const before = installProject();
    await projectService.removeTrack(before.id, 'track-remove');
    const after = mutableService.currentProject!;
    historyManager.push({
      id: 'remove-track',
      label: '删除轨道',
      execute: () => after,
      undo: () => before,
    }, before);

    const undone = historyManager.undo(after);
    expect(undone).not.toBeNull();
    await projectService.saveProject(undone!.project);

    expect(persistedTrackIds()).toEqual(['track-remove', 'track-keep']);
    expect(undone!.project.tracks[0]!.clips.map((clip) => clip.audioBufferId)).toEqual([
      'buffer-shared', 'buffer-unique', 'buffer-unique',
    ]);
    for (const clip of undone!.project.tracks[0]!.clips) {
      expect(buffers.has(clip.audioBufferId)).toBe(true);
    }
    expect(audioDb.audioBuffers.delete).not.toHaveBeenCalled();
  });

  it('leaves persistent and in-memory state intact when the project save fails', async () => {
    const before = installProject();
    const originalRecord = records.get(before.id)!;
    vi.mocked(audioDb.projects.put).mockRejectedValue(new Error('quota exceeded') as never);

    await expect(projectService.removeTrack(before.id, 'track-remove')).rejects.toThrow('quota exceeded');

    expect(records.get(before.id)).toEqual(originalRecord);
    expect(persistedTrackIds()).toEqual(['track-remove', 'track-keep']);
    expect(before.tracks.map((track) => track.id)).toEqual(['track-remove', 'track-keep']);
    expect(mutableService.currentProject).toBe(before);
    expect([...buffers.keys()]).toEqual(['buffer-shared', 'buffer-unique', 'buffer-keep']);
    expect(audioDb.audioBuffers.delete).not.toHaveBeenCalled();
    expect(audioEngine.evictBuffer).not.toHaveBeenCalled();
  });

  it('does not remove audio or replace the editor snapshot when permanent deletion wins', async () => {
    const before = installProject();
    records.clear();

    await projectService.removeTrack(before.id, 'track-remove');

    expect(records.has(before.id)).toBe(false);
    expect(before.tracks.map((track) => track.id)).toEqual(['track-remove', 'track-keep']);
    expect(mutableService.currentProject).toBe(before);
    expect([...buffers.keys()]).toEqual(['buffer-shared', 'buffer-unique', 'buffer-keep']);
    expect(audioDb.audioBuffers.delete).not.toHaveBeenCalled();
    expect(audioEngine.evictBuffer).not.toHaveBeenCalled();
  });

  it('does not save or delete audio for an unknown track', async () => {
    const before = installProject();

    await projectService.removeTrack(before.id, 'missing-track');

    expect(audioDb.projects.put).not.toHaveBeenCalled();
    expect(audioDb.audioBuffers.delete).not.toHaveBeenCalled();
    expect(mutableService.currentProject).toBe(before);
    expect(persistedTrackIds()).toEqual(['track-remove', 'track-keep']);
  });

  it('keeps the last track and its audio untouched', async () => {
    const before = installProject();
    before.tracks = [before.tracks[0]!];
    records.set(before.id, mutableService.projectToRecord(before));

    await projectService.removeTrack(before.id, 'track-remove');

    expect(audioDb.projects.put).not.toHaveBeenCalled();
    expect(audioDb.audioBuffers.delete).not.toHaveBeenCalled();
    expect(before.tracks).toHaveLength(1);
    expect(buffers.size).toBe(3);
  });

  it('bulk-removes every selected track and label with independent undo snapshots', async () => {
    const before = installProject();

    const result = await projectService.removeTracks(before.id, ['track-remove', 'track-keep']);

    expect(result?.before.tracks.map((track) => track.id)).toEqual(['track-remove', 'track-keep']);
    expect(result?.after.tracks).toEqual([]);
    expect(result?.after.analysisLabels).toEqual([]);
    expect(result?.before).not.toBe(before);
    expect(before.tracks).toHaveLength(2);
    expect(persistedTrackIds()).toEqual([]);
    expect(records.get(before.id)?.analysisLabelsData).toBe('[]');
    expect(audioDb.audioBuffers.delete).not.toHaveBeenCalled();
    expect(audioEngine.evictBuffer).not.toHaveBeenCalled();

    result!.before.tracks[0]!.name = 'changed snapshot';
    expect(before.tracks[0]!.name).toBe('track-remove');
  });

  it('preserves a rename and addition queued behind an in-flight bulk removal', async () => {
    const before = installProject();
    const release = delayNextProjectPut();

    const removing = projectService.removeTracks(before.id, ['track-remove']);
    await vi.waitFor(() => expect(audioDb.projects.put).toHaveBeenCalledTimes(1));
    const renaming = projectService.updateTrack(before.id, 'track-keep', { name: 'Renamed keep' });
    const adding = projectService.addTrack(before.id);
    release();

    const removed = await removing;
    await renaming;
    const added = await adding;
    expect(added).not.toBeNull();
    expect(removed?.before.tracks.map((track) => track.id)).toEqual(['track-remove', 'track-keep']);
    expect(removed?.after.tracks.map((track) => track.id)).toEqual(['track-keep']);
    expect(persistedTrackIds()).toEqual(['track-keep', added!.id]);
    const persisted = JSON.parse(records.get(before.id)!.tracksData) as ITrack[];
    expect(persisted[0]?.name).toBe('Renamed keep');
    expect(mutableService.currentProject?.tracks.map((track) => track.id))
      .toEqual(persistedTrackIds());
  });

  it('keeps bulk-removal state intact when saving fails', async () => {
    const before = installProject();
    const originalRecord = records.get(before.id)!;
    vi.mocked(audioDb.projects.put).mockRejectedValue(new Error('quota exceeded') as never);

    await expect(projectService.removeTracks(before.id, ['track-remove']))
      .rejects.toThrow('quota exceeded');

    expect(records.get(before.id)).toEqual(originalRecord);
    expect(mutableService.currentProject).toBe(before);
    expect(before.analysisLabels).toHaveLength(2);
    expect(buffers.size).toBe(3);
  });

  it('does not recreate a project when permanent deletion wins over bulk removal', async () => {
    const before = installProject();
    records.clear();

    await expect(projectService.removeTracks(before.id, ['track-remove'])).resolves.toBeNull();

    expect(records.has(before.id)).toBe(false);
    expect(mutableService.currentProject).toBe(before);
    expect(audioDb.projects.put).not.toHaveBeenCalled();
    expect(audioDb.audioBuffers.delete).not.toHaveBeenCalled();
  });

  it('keeps unknown and empty bulk removals write-free', async () => {
    const before = installProject();

    await expect(projectService.removeTracks(before.id, [])).resolves.toBeNull();
    await expect(projectService.removeTracks(before.id, ['missing'])).resolves.toBeNull();

    expect(audioDb.projects.put).not.toHaveBeenCalled();
    expect(mutableService.currentProject).toBe(before);
    expect(persistedTrackIds()).toEqual(['track-remove', 'track-keep']);
  });

  it('does not lose a concurrent track addition while duplicate reads source PCM', async () => {
    const before = installProject();
    let releaseChannels: ((channels: Float32Array[]) => void) | undefined;
    const channels = new Promise<Float32Array[]>((resolve) => {
      releaseChannels = resolve;
    });
    vi.spyOn(projectService, 'loadAudioChannels').mockReturnValue(channels);
    vi.spyOn(projectService, 'loadAudioBufferMetadata').mockImplementation(async (id) => makeBuffer(id));

    const duplicate = projectService.duplicateTrack(before.id, 'track-remove');
    const addition = projectService.addTrack(before.id);
    // Let the old implementation commit the addition while duplication is
    // waiting for PCM. A queued implementation resumes both after this gate.
    await new Promise((resolve) => setTimeout(resolve, 25));
    releaseChannels!([Float32Array.from([0.25])]);
    const [copied, added] = await Promise.all([duplicate, addition]);

    expect(copied).not.toBeNull();
    expect(added).not.toBeNull();
    const expectedIds = ['track-remove', 'track-keep', copied!.id, added!.id];
    expect(persistedTrackIds()).toHaveLength(4);
    expect(persistedTrackIds()).toEqual(expect.arrayContaining(expectedIds));
    expect(mutableService.currentProject?.tracks.map((track) => track.id))
      .toEqual(persistedTrackIds());
    expect(before.tracks.map((track) => track.id)).toEqual(['track-remove', 'track-keep']);
  });

  it('serializes consecutive removals so neither deleted track reappears', async () => {
    const before = installProject();
    before.tracks.push(makeTrack('track-third', [makeClip('third-clip', 'buffer-third')]));
    records.set(before.id, mutableService.projectToRecord(before));
    let writes = 0;
    vi.mocked(audioDb.projects.put).mockImplementation(((record: ProjectRecord) => {
      writes += 1;
      const delay = writes === 1 ? 20 : 0;
      return new Promise<string>((resolve) => {
        setTimeout(() => {
          records.set(record.id, { ...record });
          resolve(record.id);
        }, delay);
      });
    }) as never);

    await Promise.all([
      projectService.removeTrack(before.id, 'track-remove'),
      projectService.removeTrack(before.id, 'track-keep'),
    ]);

    expect(persistedTrackIds()).toEqual(['track-third']);
    expect(mutableService.currentProject?.tracks.map((track) => track.id)).toEqual(['track-third']);
    expect(before.tracks.map((track) => track.id)).toEqual([
      'track-remove', 'track-keep', 'track-third',
    ]);
  });
});
