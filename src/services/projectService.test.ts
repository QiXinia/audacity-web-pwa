import { describe, expect, it, vi } from 'vitest';
import type { ProjectRecord } from '@/db/audioDb';
import type { IProject } from '@/types/project';
import { projectService } from '@/services/projectService';

vi.mock('@/db/audioDb', () => ({
  audioDb: {
    projects: {},
    audioBuffers: {},
    clipboard: {},
    historySnapshots: {},
  },
  serializeTracks: (tracks: unknown) => JSON.stringify(tracks),
  deserializeTracks: (data: string) => JSON.parse(data),
  serializeSelection: (selection: unknown) => selection ? JSON.stringify(selection) : null,
  deserializeSelection: (data: string | null) => data ? JSON.parse(data) : null,
}));

type ProjectRecordConverter = {
  projectToRecord(project: IProject): ProjectRecord;
  recordToProject(record: ProjectRecord): IProject;
};

const converter = projectService as unknown as ProjectRecordConverter;

function makeProject(loopEnabled = true): IProject {
  return {
    id: 'loop-project',
    name: 'Loop persistence',
    sampleRate: 44100,
    timeSignature: { numerator: 4, denominator: 4 },
    tempo: 120,
    tracks: [],
    cursorPosition: 0,
    selection: { start: 0.5, end: 1.5 },
    loopRegion: { start: 2.5, end: 3 },
    loopEnabled,
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

describe('Project loop persistence', () => {
  it('round-trips an independent enabled loop through the IndexedDB record', () => {
    const record = converter.projectToRecord(makeProject(true));
    expect(record.loopRegionData).toBe('{"start":2.5,"end":3}');
    expect(record.loopEnabled).toBe(true);

    const restored = converter.recordToProject(record);
    expect(restored.loopRegion).toEqual({ start: 2.5, end: 3 });
    expect(restored.loopEnabled).toBe(true);
    expect(restored.selection).toEqual({ start: 0.5, end: 1.5 });
  });

  it('keeps a disabled loop region independent from its enabled state', () => {
    const restored = converter.recordToProject(converter.projectToRecord(makeProject(false)));
    expect(restored.loopRegion).toEqual({ start: 2.5, end: 3 });
    expect(restored.loopEnabled).toBe(false);
  });

  it('restores legacy records without loop fields as a disabled empty loop', () => {
    const record = converter.projectToRecord(makeProject(true));
    delete record.loopRegionData;
    delete record.loopEnabled;

    const restored = converter.recordToProject(record);
    expect(restored.loopRegion).toBeNull();
    expect(restored.loopEnabled).toBe(false);
  });

  it('round-trips BPM and time signature and normalizes invalid legacy timing', () => {
    const project = { ...makeProject(), tempo: 90.5, timeSignature: { numerator: 6, denominator: 8 } };
    const record = converter.projectToRecord(project);
    const restored = converter.recordToProject(record);
    expect(restored.tempo).toBe(90.5);
    expect(restored.timeSignature).toEqual({ numerator: 6, denominator: 8 });

    record.tempo = 0;
    record.timeSignature = { numerator: 4, denominator: 3 };
    const legacy = converter.recordToProject(record);
    expect(legacy.tempo).toBe(120);
    expect(legacy.timeSignature).toEqual({ numerator: 4, denominator: 4 });
  });
});
