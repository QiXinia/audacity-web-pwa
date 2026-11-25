import type { IClip, IProject } from '@/types/project';
import {
  applyClipPitchAndSpeed,
  composeClipPitchCents,
  getClipSpeedPercentage,
  getAudacityTimeAndPitchFftSize,
  getClipPitchTimeStretchOptions,
  hasClipPitchOrSpeed,
  normalizeClipSpeedPercentage,
  processClipPitchAndSpeedChannels,
  renderClipPitchAndSpeedChannels,
  replaceClipWithRenderedPitchAndSpeed,
  splitClipPitchCents,
} from './clipPitchSpeed';
import { processStaffPadTimeAndPitchChannels } from './staffPadTimeAndPitch';

function clip(overrides: Partial<IClip> = {}): IClip {
  return {
    id: 'clip-a', audioBufferId: 'buffer-a', startTime: 1, offset: 0.5,
    duration: 3, originalDuration: 10, stretchRatio: 1.5,
    gain: 0, fadeIn: 0, fadeOut: 0, name: 'Voice', ...overrides,
  };
}

function project(value: IClip = clip()): IProject {
  return {
    id: 'project', name: 'Project', createdAt: 0, updatedAt: 0, sampleRate: 8000,
    timeSignature: { numerator: 4, denominator: 4 }, tempo: 120, cursorPosition: 0,
    selection: null,
    viewState: { horizontalZoom: 100, verticalZoom: 1, scrollX: 0, viewMode: 'waveform' },
    tracks: [{
      id: 'track-a', name: 'Track', type: 'audio', gain: 0, pan: 0,
      muted: false, solo: false, armed: false, color: '', effects: [], clips: [value],
    }],
  };
}

describe('Audacity 4 clip pitch and speed model', () => {
  it('splits and clamps semitones/cents at the official total ±1200 cent limits', () => {
    expect(splitClipPitchCents(-125)).toEqual({ semitones: -1, cents: -25 });
    expect(composeClipPitchCents(1, -25)).toBe(75);
    expect(composeClipPitchCents(12, 100)).toBe(1200);
    expect(composeClipPitchCents(-12, -99)).toBe(-1200);
    expect(composeClipPitchCents(99, 99)).toBe(1200);
  });

  it('supports 1…1000% with three decimals and preserves the visible source window', () => {
    expect(normalizeClipSpeedPercentage(150.12349)).toBe(150.123);
    expect(normalizeClipSpeedPercentage(0.1)).toBe(1);
    expect(normalizeClipSpeedPercentage(0)).toBe(1);
    expect(normalizeClipSpeedPercentage(-25)).toBe(1);
    expect(normalizeClipSpeedPercentage(Number.NaN)).toBe(100);
    expect(normalizeClipSpeedPercentage(1001)).toBe(1000);
    const source = project();
    const faster = applyClipPitchAndSpeed(source, { trackId: 'track-a', clipId: 'clip-a' }, {
      pitchCents: 125, speedPercentage: 150, optimizeForVoice: true,
    });
    const edited = faster.tracks[0].clips[0];
    expect(edited.startTime).toBe(1);
    expect(edited.offset).toBe(0.5);
    expect(edited.duration * (edited.stretchRatio ?? 1)).toBeCloseTo(4.5, 10);
    expect(edited.duration).toBeCloseTo(3, 10);
    expect(edited.pitchCents).toBe(125);
    expect(edited.optimizeForVoice).toBe(true);
    expect(getClipSpeedPercentage(edited)).toBe(150);

    const slowest = applyClipPitchAndSpeed(source, { trackId: 'track-a', clipId: 'clip-a' }, {
      pitchCents: 0, speedPercentage: 1, optimizeForVoice: false,
    }).tracks[0].clips[0];
    expect(slowest.stretchRatio).toBe(0.01);
    expect(slowest.duration).toBeCloseTo(450, 10);
    const nonPositive = applyClipPitchAndSpeed(source, { trackId: 'track-a', clipId: 'clip-a' }, {
      pitchCents: 0, speedPercentage: 0, optimizeForVoice: false,
    }).tracks[0].clips[0];
    expect(nonPositive.stretchRatio).toBe(0.01);
    expect(nonPositive.duration).toBeCloseTo(450, 10);
    const fastest = applyClipPitchAndSpeed(source, { trackId: 'track-a', clipId: 'clip-a' }, {
      pitchCents: 0, speedPercentage: 1000, optimizeForVoice: false,
    }).tracks[0].clips[0];
    expect(fastest.stretchRatio).toBe(10);
    expect(fastest.duration).toBe(0.45);
  });

  it('round-trips persisted fields and normalizes malformed legacy values', async () => {
    const { deserializeTracks } = await vi.importActual<typeof import('@/db/audioDb')>('@/db/audioDb');
    const serialized = JSON.stringify(project(clip({ pitchCents: 125, optimizeForVoice: true })).tracks);
    const restored = deserializeTracks(serialized)[0].clips[0];
    expect(restored.pitchCents).toBe(125);
    expect(restored.optimizeForVoice).toBe(true);
    const malformed = deserializeTracks(JSON.stringify([{
      ...project().tracks[0],
      clips: [{ ...clip(), pitchCents: 5000, optimizeForVoice: 'yes', stretchRatio: -1 }],
    }]))[0].clips[0];
    expect(malformed.pitchCents).toBe(1200);
    expect(malformed.optimizeForVoice).toBe(false);
    expect(malformed.stretchRatio).toBe(1);
  });
});

describe('Audacity StaffPad analysis-window mapping', () => {
  it('matches the official sample-rate table and shortens the voice window', () => {
    for (const [sampleRate, normal, voice] of [
      [8000, 1024, 512],
      [11025, 1024, 512],
      [22050, 2048, 1024],
      [44100, 4096, 2048],
      [48000, 4096, 2048],
      [88200, 8192, 4096],
      [96000, 8192, 4096],
      [192000, 16384, 8192],
    ] as const) {
      expect(getAudacityTimeAndPitchFftSize(sampleRate, false)).toBe(normal);
      expect(getAudacityTimeAndPitchFftSize(sampleRate, true)).toBe(voice);
    }
    expect(getClipPitchTimeStretchOptions(44100, false)).toEqual({ windowSize: 4096 });
    expect(getClipPitchTimeStretchOptions(44100, true)).toEqual({ windowSize: 2048, searchRadius: 512 });
  });

  it('uses C++ halfway rounding and rejects invalid sample rates', () => {
    const negativeHalfway = 44100 * 2 ** -2.5;
    const positiveHalfway = 44100 * 2 ** 2.5;
    expect(getAudacityTimeAndPitchFftSize(negativeHalfway, false)).toBe(512);
    expect(getAudacityTimeAndPitchFftSize(negativeHalfway, true)).toBe(256);
    expect(getAudacityTimeAndPitchFftSize(positiveHalfway, false)).toBe(32768);
    expect(getAudacityTimeAndPitchFftSize(positiveHalfway, true)).toBe(16384);
    for (const sampleRate of [0, -44100, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => getAudacityTimeAndPitchFftSize(sampleRate, true)).toThrow('采样率');
    }
  });
});

describe('Audacity 4 non-destructive clip PCM rendering', () => {
  it('changes pitch without changing sample count or mutating the source', () => {
    const sampleRate = 8000;
    const source = new Float32Array(4000);
    for (let index = 0; index < source.length; index += 1) {
      source[index] = 0.5 * Math.sin(2 * Math.PI * 440 * index / sampleRate);
    }
    const original = source.slice();
    const neutral = processClipPitchAndSpeedChannels(clip({ pitchCents: 0, stretchRatio: 1 }), [source], sampleRate)[0];
    const shifted = processClipPitchAndSpeedChannels(clip({ pitchCents: 1200, stretchRatio: 1 }), [source], sampleRate)[0];
    expect(shifted).toHaveLength(source.length);
    expect(source).toEqual(original);
    expect(shifted).not.toEqual(neutral);
    expect(Math.max(...shifted.map(Math.abs))).toBeGreaterThan(0.05);
  });

  it('makes Optimize for voice affect real processing while preserving stereo alignment', () => {
    const sampleRate = 8000;
    const left = new Float32Array(4000);
    let state = 123456789;
    for (let index = 0; index < left.length; index += 1) {
      state = (1103515245 * state + 12345) >>> 0;
      left[index] = ((state / 0xffffffff) * 2 - 1) * 0.4;
    }
    const right = left.map((value) => value * 0.5);
    const normal = processClipPitchAndSpeedChannels(
      clip({ pitchCents: 300, stretchRatio: 1.25, optimizeForVoice: false }), [left, right], sampleRate,
    );
    const voice = processClipPitchAndSpeedChannels(
      clip({ pitchCents: 300, stretchRatio: 1.25, optimizeForVoice: true }), [left, right], sampleRate,
    );
    expect(voice).toHaveLength(2);
    expect(voice[0]).toHaveLength(normal[0].length);
    expect(voice[1]).toHaveLength(voice[0].length);
    expect(voice[0]).not.toEqual(normal[0]);
    expect(Math.max(...voice[0].map(Math.abs))).toBeGreaterThan(0.01);
    // IClip stretchRatio is source/timeline; official StaffPad timeRatio is its reciprocal.
    expect(voice).toEqual(processStaffPadTimeAndPitchChannels([left, right], {
      sampleRate,
      timeRatio: 0.8,
      pitchRatio: 2 ** (300 / 1200),
      preserveFormants: true,
      fftSize: 512,
    }));
  });

  it('matches native zero-filled output at the UI-limit voice settings', () => {
    const sampleRate = 8000;
    const source = Array.from({ length: 2 }, (_, channel) => (
      Float32Array.from({ length: 17 }, (_, index) => (
        0.3 * Math.sin(index * 0.41 + channel * 0.7) + 0.1 * Math.cos(index * 0.13)
      ))
    ));
    const adjusted = applyClipPitchAndSpeed(
      project(clip({ stretchRatio: 1 })),
      { trackId: 'track-a', clipId: 'clip-a' },
      { pitchCents: 1200, speedPercentage: 1, optimizeForVoice: true },
    ).tracks[0].clips[0];
    expect(adjusted.stretchRatio).toBe(0.01);
    expect(getAudacityTimeAndPitchFftSize(sampleRate, true)).toBe(512);
    const output = processClipPitchAndSpeedChannels(adjusted, source, sampleRate);
    expect(output).toHaveLength(2);
    for (const channel of output) {
      expect(channel).toHaveLength(1700);
      expect(channel.every((sample) => Number.isFinite(sample))).toBe(true);
      // This is the native subsample-analysis-hop-stereo oracle case.
      expect(channel.every((sample) => sample === 0)).toBe(true);
    }
  });

  it('keeps the sub-sample synthesis hop productive at the lowest analysis window', () => {
    const sampleRate = 1000;
    const source = Array.from({ length: 2 }, (_, channel) => (
      Float32Array.from({ length: 1025 }, (_, index) => (
        0.3 * Math.sin(index * 0.41 + channel * 0.7) + 0.1 * Math.cos(index * 0.13)
      ))
    ));
    const adjusted = applyClipPitchAndSpeed(
      project(clip({ stretchRatio: 1 })),
      { trackId: 'track-a', clipId: 'clip-a' },
      { pitchCents: -1200, speedPercentage: 1000, optimizeForVoice: true },
    ).tracks[0].clips[0];
    expect(adjusted.stretchRatio).toBe(10);
    expect(getAudacityTimeAndPitchFftSize(sampleRate, true)).toBe(64);
    const output = processClipPitchAndSpeedChannels(adjusted, source, sampleRate);
    expect(output).toHaveLength(2);
    for (const channel of output) {
      expect(channel).toHaveLength(103);
      expect(channel.every((sample) => Number.isFinite(sample))).toBe(true);
      expect(channel.some((sample) => sample !== 0)).toBe(true);
    }
  }, 30_000);
});

describe('Audacity 4 Render pitch and speed', () => {
  it('bakes only the visible region into stereo PCM and resets just the target clip', () => {
    const sampleRate = 8000;
    const left = new Float32Array(sampleRate * 2);
    for (let index = 0; index < left.length; index += 1) {
      left[index] = 0.4 * Math.sin(2 * Math.PI * 500 * index / sampleRate);
    }
    const right = left.map((value) => value * 0.5);
    const untouched = left.slice();
    const target = clip({
      offset: 0.25,
      duration: 0.4,
      originalDuration: 2,
      stretchRatio: 1.25,
      pitchCents: 300,
      optimizeForVoice: true,
      gain: -3,
      fadeIn: 0.05,
      fadeOut: 0.04,
    });
    const rendered = renderClipPitchAndSpeedChannels(target, [left, right], sampleRate);
    expect(rendered).toHaveLength(2);
    expect(rendered[0]).toHaveLength(3200);
    expect(rendered[1]).toHaveLength(3200);
    expect(left).toEqual(untouched);
    expect(rendered[0].some((value) => Math.abs(value) > 0.01)).toBe(true);

    const sourceProject = project(target);
    const neighbor = clip({ id: 'clip-b', startTime: 8, stretchRatio: 1, pitchCents: 0 });
    sourceProject.tracks[0].clips.push(neighbor);
    const updated = replaceClipWithRenderedPitchAndSpeed(
      sourceProject,
      { trackId: 'track-a', clipId: 'clip-a' },
      'buffer-rendered',
      rendered[0].length / sampleRate,
      target,
    );
    const baked = updated.tracks[0].clips[0];
    expect(baked).toMatchObject({
      audioBufferId: 'buffer-rendered',
      startTime: 1,
      offset: 0,
      duration: 0.4,
      originalDuration: 0.4,
      stretchRatio: 1,
      pitchCents: 0,
      optimizeForVoice: false,
      gain: -3,
      fadeIn: 0.05,
      fadeOut: 0.04,
      name: 'Voice',
    });
    expect(updated.tracks[0].clips[1]).toBe(neighbor);
    expect(sourceProject.tracks[0].clips[0].audioBufferId).toBe('buffer-a');
  });

  it('rejects stale PCM after any render input changes but preserves independent metadata edits', () => {
    const expected = clip({
      stretchRatio: 1.5,
      pitchCents: 300,
      optimizeForVoice: true,
    });
    const original = project(expected);
    const key = { trackId: 'track-a', clipId: 'clip-a' };
    const changes: Partial<IClip>[] = [
      { audioBufferId: 'buffer-replaced' },
      { offset: 0.75 },
      { duration: 2.5 },
      { stretchRatio: 1.25 },
      { pitchCents: 600 },
      { optimizeForVoice: false },
    ];
    for (const change of changes) {
      const latest = structuredClone(original);
      Object.assign(latest.tracks[0].clips[0], change);
      expect(() => replaceClipWithRenderedPitchAndSpeed(
        latest,
        key,
        'buffer-rendered',
        expected.duration,
        expected,
      )).toThrow('片段在渲染期间已被修改，请重试');
    }

    const latest = structuredClone(original);
    latest.tracks[0].clips[0] = {
      ...latest.tracks[0].clips[0],
      name: 'Renamed while rendering',
      startTime: 4,
      gain: -6,
    };
    const updated = replaceClipWithRenderedPitchAndSpeed(
      latest,
      key,
      'buffer-rendered',
      expected.duration,
      expected,
    );
    expect(updated.tracks[0].clips[0]).toMatchObject({
      name: 'Renamed while rendering',
      startTime: 4,
      gain: -6,
      audioBufferId: 'buffer-rendered',
      pitchCents: 0,
      stretchRatio: 1,
    });
  });

  it('uses exactly one second of raw source context at the 1000% speed limit', () => {
    const sampleRate = 8000;
    const source = new Float32Array(sampleRate * 5);
    let state = 0x12345678;
    for (let index = 0; index < source.length; index += 1) {
      state = (Math.imul(1664525, state) + 1013904223) >>> 0;
      source[index] = (state / 0x100000000 * 2 - 1) * 0.4;
    }
    const target = clip({
      offset: 1.2,
      duration: 0.2,
      originalDuration: 5,
      stretchRatio: 10,
      pitchCents: 300,
      optimizeForVoice: true,
    });

    // WaveTrack.cpp GetRenderedCopy leaves one second of raw, unstretched audio
    // on either side. The web stretchRatio is source/timeline, so multiplying
    // the context by it would incorrectly retain ten seconds at 1000% speed.
    const contextStart = Math.round((target.offset - 1) * sampleRate);
    const visibleEnd = Math.round((target.offset + target.duration * 10) * sampleRate);
    const contextEnd = Math.round(visibleEnd + sampleRate);
    const processed = processStaffPadTimeAndPitchChannels(
      [source.slice(contextStart, contextEnd)],
      {
        sampleRate,
        timeRatio: 0.1,
        pitchRatio: 2 ** (300 / 1200),
        preserveFormants: true,
        fftSize: 512,
      },
    )[0];
    const leadingOutputFrames = Math.round(sampleRate / 10);
    const outputFrames = Math.round(target.duration * sampleRate);
    const expected = processed.slice(
      leadingOutputFrames,
      leadingOutputFrames + outputFrames,
    );

    const actual = renderClipPitchAndSpeedChannels(target, [source], sampleRate)[0];
    expect(actual).toHaveLength(outputFrames);
    expect(actual).toEqual(expected);
  }, 30_000);

  it('handles visible regions touching either source boundary', () => {
    const sampleRate = 8000;
    const source = new Float32Array(1600).map((_, index) => (
      0.25 * Math.sin(2 * Math.PI * 440 * index / sampleRate)
    ));
    for (const offset of [0, 0.1]) {
      const rendered = renderClipPitchAndSpeedChannels(
        clip({ offset, duration: 0.1, originalDuration: 0.2, stretchRatio: 1, pitchCents: 1200 }),
        [source],
        sampleRate,
      )[0];
      expect(rendered).toHaveLength(800);
      expect(rendered.some((value) => value !== 0)).toBe(true);
    }
  });

  it('disables no-op rendering even when a voice preset is the only changed field', () => {
    const neutral = clip({ stretchRatio: 1, pitchCents: 0, optimizeForVoice: true });
    expect(hasClipPitchOrSpeed(neutral)).toBe(false);
    expect(() => renderClipPitchAndSpeedChannels(neutral, [new Float32Array(100)], 8000))
      .toThrow('没有可渲染');
    expect(hasClipPitchOrSpeed(clip({ stretchRatio: 1.001, pitchCents: 0 }))).toBe(true);
    expect(hasClipPitchOrSpeed(clip({ stretchRatio: 1, pitchCents: -1 }))).toBe(true);
  });
});
