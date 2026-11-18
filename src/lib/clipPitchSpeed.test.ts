import type { IClip, IProject } from '@/types/project';
import {
  applyClipPitchAndSpeed,
  composeClipPitchCents,
  getClipSpeedPercentage,
  normalizeClipSpeedPercentage,
  processClipPitchAndSpeedChannels,
  splitClipPitchCents,
} from './clipPitchSpeed';

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
  });
});
