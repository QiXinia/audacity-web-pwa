import { describe, expect, it } from 'vitest';
import {
  CLIP_SILENCE_MIN_SECONDS,
  findExactSilenceRegions,
  splitClipAtSilences,
} from '@/lib/clipSilence';
import type { IClip, IProject } from '@/types/project';

const key = { trackId: 'track-a', clipId: 'clip-a' };

function makeClip(overrides: Partial<IClip> = {}): IClip {
  return {
    id: key.clipId,
    audioBufferId: 'shared-pcm',
    startTime: 1,
    offset: 0,
    duration: 0.47,
    originalDuration: 0.47,
    stretchRatio: 1,
    gain: 0.25,
    fadeIn: 0.01,
    fadeOut: 0.02,
    name: 'Official disjoin',
    colorIndex: 4,
    pitchCents: 125,
    clipTempo: 120,
    rawAudioTempo: 100,
    ...overrides,
  };
}

function makeProject(clip = makeClip(), sampleRate = 1000): IProject {
  const untouched = { ...clip, id: 'other', startTime: 8 };
  return {
    id: 'project',
    name: 'test',
    createdAt: 0,
    updatedAt: 0,
    sampleRate,
    timeSignature: { numerator: 4, denominator: 4 },
    tempo: 120,
    cursorPosition: 0,
    selection: null,
    viewState: { horizontalZoom: 100, verticalZoom: 1, scrollX: 0, viewMode: 'waveform' },
    tracks: [
      {
        id: key.trackId, name: 'A', type: 'audio', gain: 0, pan: 0, muted: false,
        solo: false, armed: false, color: '#fff', effects: [], clips: [clip, untouched],
      },
      {
        id: 'track-b', name: 'B', type: 'audio', gain: 0, pan: 0, muted: false,
        solo: false, armed: false, color: '#000', effects: [], clips: [],
      },
    ],
  };
}

function ids() {
  let next = 0;
  return () => `segment-${++next}`;
}

describe('Audacity 4 Split at silences', () => {
  it('matches the official valid interval and removes the exact silence gap', () => {
    const pcm = new Float32Array(470);
    pcm.fill(0.5, 0, 10);
    pcm.fill(-0.5, 460);
    const source = makeProject();
    const result = splitClipAtSilences(source, key, [pcm], ids());

    expect(result.didChange).toBe(true);
    expect(result.regions).toEqual([{ startFrame: 10, endFrame: 460 }]);
    expect(result.project.tracks[0].clips).toHaveLength(3);
    const [first, second, untouched] = result.project.tracks[0].clips;
    expect(first).toMatchObject({
      id: 'segment-1', audioBufferId: 'shared-pcm', startTime: 1, offset: 0,
      duration: 0.01, originalDuration: 0.47, fadeIn: 0.01, fadeOut: 0,
    });
    expect(second).toMatchObject({
      id: 'segment-2', audioBufferId: 'shared-pcm', startTime: 1.46, offset: 0.46,
      duration: 0.01, originalDuration: 0.47, fadeIn: 0, fadeOut: 0.02,
    });
    expect(second.startTime - (first.startTime + first.duration)).toBeCloseTo(0.45, 10);
    expect(untouched.id).toBe('other');
    expect(source.tracks[0].clips[0].id).toBe(key.clipId);
    expect(Array.from(pcm.slice(10, 460)).every((value) => value === 0)).toBe(true);
  });

  it('rejects a short silence but accepts the exact 0.01 second boundary', () => {
    const short = new Float32Array(30);
    short.fill(1, 0, 10);
    short.fill(1, 19);
    const shortResult = splitClipAtSilences(makeProject(makeClip({ duration: 0.03, originalDuration: 0.03 })), key, [short], ids());
    expect(shortResult).toEqual({ project: expect.any(Object), didChange: false, regions: [] });
    expect(shortResult.project.tracks[0].clips[0].id).toBe(key.clipId);

    const exact = new Float32Array(30);
    exact.fill(1, 0, 10);
    exact.fill(1, 20);
    const exactResult = splitClipAtSilences(makeProject(makeClip({ duration: 0.03, originalDuration: 0.03 })), key, [exact], ids());
    expect(exactResult.regions).toEqual([{ startFrame: 10, endFrame: 20 }]);
    expect(exactResult.project.tracks[0].clips.slice(0, 2).map((clip) => clip.duration)).toEqual([0.01, 0.01]);
    expect(CLIP_SILENCE_MIN_SECONDS).toBe(0.01);
  });

  it('removes leading silence without fabricating an empty first clip', () => {
    const pcm = new Float32Array(460);
    pcm.fill(1, 450);
    const result = splitClipAtSilences(makeProject(makeClip({ duration: 0.46, originalDuration: 0.46 })), key, [pcm], ids());
    expect(result.project.tracks[0].clips).toHaveLength(2);
    expect(result.project.tracks[0].clips[0]).toMatchObject({
      startTime: 1.45, offset: 0.45, duration: 0.01, fadeIn: 0, fadeOut: 0.02,
    });
  });

  it('removes trailing silence without fabricating an empty last clip', () => {
    const pcm = new Float32Array(460);
    pcm.fill(1, 0, 10);
    const result = splitClipAtSilences(makeProject(makeClip({ duration: 0.46, originalDuration: 0.46 })), key, [pcm], ids());
    expect(result.project.tracks[0].clips).toHaveLength(2);
    expect(result.project.tracks[0].clips[0]).toMatchObject({
      startTime: 1, offset: 0, duration: 0.01, fadeIn: 0.01, fadeOut: 0,
    });
  });

  it('requires zeroes in every stereo channel at the same source frame', () => {
    const left = new Float32Array(470);
    const right = new Float32Array(470);
    left.fill(0.5, 0, 10);
    left.fill(0.5, 460);
    right.fill(0.25);
    const source = makeProject();
    expect(splitClipAtSilences(source, key, [left, right], ids())).toEqual({ project: source, didChange: false, regions: [] });
  });

  it('splits multiple silence regions and preserves all non-timing clip metadata', () => {
    const pcm = new Float32Array(90);
    pcm.fill(0.5, 0, 20);
    pcm.fill(0.5, 40, 60);
    pcm.fill(0.5, 70);
    const result = splitClipAtSilences(makeProject(makeClip({ duration: 0.09, originalDuration: 0.09 })), key, [pcm], ids());
    expect(result.regions).toEqual([
      { startFrame: 20, endFrame: 40 },
      { startFrame: 60, endFrame: 70 },
    ]);
    const segments = result.project.tracks[0].clips.slice(0, 3);
    expect(segments.map((clip) => [clip.offset, clip.duration])).toEqual([
      [0, 0.02], [0.04, 0.02], [0.07, 0.02],
    ]);
    for (const clip of segments) {
      expect(clip).toMatchObject({
        audioBufferId: 'shared-pcm', name: 'Official disjoin', colorIndex: 4,
        pitchCents: 125, clipTempo: 120, rawAudioTempo: 100, gain: 0.25,
      });
    }
  });

  it('maps trimmed and stretched source windows to timeline positions', () => {
    const pcm = new Float32Array(200);
    pcm.fill(0.5);
    pcm.fill(0, 60, 120);
    const clip = makeClip({
      startTime: 2, offset: 0.02, duration: 0.08, originalDuration: 0.2, stretchRatio: 2,
    });
    const result = splitClipAtSilences(makeProject(clip), key, [pcm], ids());
    const [first, second] = result.project.tracks[0].clips;
    expect(first.startTime).toBeCloseTo(2, 10);
    expect(first.offset).toBeCloseTo(0.02, 10);
    expect(first.duration).toBeCloseTo(0.02, 10);
    expect(second.startTime).toBeCloseTo(2.05, 10);
    expect(second.offset).toBeCloseTo(0.12, 10);
    expect(second.duration).toBeCloseTo(0.03, 10);
    expect(first.stretchRatio).toBe(2);
    expect(second.stretchRatio).toBe(2);
    expect(first.originalDuration).toBe(0.2);
    expect(second.originalDuration).toBe(0.2);
  });

  it('deletes a wholly silent visible clip like official SplitDelete', () => {
    const pcm = new Float32Array(470);
    const result = splitClipAtSilences(makeProject(), key, [pcm], ids());
    expect(result.didChange).toBe(true);
    expect(result.regions).toEqual([{ startFrame: 0, endFrame: 470 }]);
    expect(result.project.tracks[0].clips.map((clip) => clip.id)).toEqual(['other']);
  });

  it('does not treat near-zero samples, missing audio, or missing targets as silence', () => {
    const pcm = new Float32Array(470);
    pcm.fill(1e-40);
    const source = makeProject();
    expect(splitClipAtSilences(source, key, [pcm], ids())).toEqual({ project: source, didChange: false, regions: [] });
    expect(splitClipAtSilences(source, key, [], ids())).toEqual({ project: source, didChange: false, regions: [] });
    expect(splitClipAtSilences(source, { trackId: 'missing', clipId: key.clipId }, [pcm], ids())).toEqual({ project: source, didChange: false, regions: [] });
  });

  it('limits range Disjoin to the selection and preserves audio and silence outside it', () => {
    const pcm = new Float32Array(470);
    pcm.fill(0.5, 0, 10);
    pcm.fill(-0.5, 460);
    const source = makeProject();
    const result = splitClipAtSilences(source, key, [pcm], ids(), { start: 1.1, end: 1.3 });
    expect(result.didChange).toBe(true);
    expect(result.regions).toEqual([{ startFrame: 100, endFrame: 300 }]);
    const [left, right, untouched] = result.project.tracks[0].clips;
    expect(left).toMatchObject({ startTime: 1, offset: 0, duration: 0.1, fadeIn: 0.01, fadeOut: 0 });
    expect(right).toMatchObject({ startTime: 1.3, offset: 0.3, duration: 0.17, fadeIn: 0, fadeOut: 0.02 });
    expect(untouched.id).toBe('other');
    expect(source.tracks[0].clips[0]).toMatchObject({ startTime: 1, offset: 0, duration: 0.47 });
  });

  it('maps a stretched range in raw source frames and preserves unselected silence', () => {
    const pcm = new Float32Array(200);
    pcm.fill(0.5);
    pcm.fill(0, 60, 120);
    const clip = makeClip({
      startTime: 2, offset: 0.02, duration: 0.08, originalDuration: 0.2, stretchRatio: 2,
    });
    const result = splitClipAtSilences(
      makeProject(clip),
      key,
      [pcm],
      ids(),
      { start: 2.025, end: 2.045 },
    );
    expect(result.regions).toEqual([{ startFrame: 70, endFrame: 110 }]);
    const [left, right] = result.project.tracks[0].clips;
    expect(left).toMatchObject({ startTime: 2, offset: 0.02, duration: 0.025, stretchRatio: 2 });
    expect(right.startTime).toBeCloseTo(2.045, 10);
    expect(right).toMatchObject({ offset: 0.11, duration: 0.035, stretchRatio: 2 });
  });

  it('returns a no-op when the requested range contains no long exact silence', () => {
    const pcm = new Float32Array(470);
    pcm.fill(0.5, 0, 10);
    pcm.fill(-0.5, 460);
    const source = makeProject();
    expect(splitClipAtSilences(source, key, [pcm], ids(), { start: 1, end: 1.005 }))
      .toEqual({ project: source, didChange: false, regions: [] });
    expect(splitClipAtSilences(source, key, [pcm], ids(), { start: 2, end: 3 }))
      .toEqual({ project: source, didChange: false, regions: [] });
  });

  it('exposes exact frame boundaries independently of project editing', () => {
    const pcm = new Float32Array(25);
    pcm.fill(1, 0, 5);
    pcm.fill(1, 15);
    expect(findExactSilenceRegions([pcm], 0, pcm.length, 10)).toEqual([{ startFrame: 5, endFrame: 15 }]);
    expect(findExactSilenceRegions([pcm], 0, pcm.length, 11)).toEqual([]);
  });
});
