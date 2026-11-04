import { AudioEngine } from './audioEngine';
import type { IClip, ITrack } from '@/types/project';

function makeClip(overrides: Partial<IClip> = {}): IClip {
  return {
    id: 'clip-1',
    audioBufferId: 'stereo',
    startTime: 0,
    offset: 0,
    duration: 1,
    originalDuration: 1,
    gain: 0,
    fadeIn: 0,
    fadeOut: 0,
    ...overrides,
  };
}

function makeTrack(pan = 0, overrides: Partial<ITrack> = {}): ITrack {
  return {
    id: 'track-1',
    name: 'Track 1',
    type: 'audio',
    gain: 0,
    pan,
    muted: false,
    solo: false,
    armed: false,
    color: '#84b5ff',
    clips: [makeClip()],
    effects: [],
    ...overrides,
  };
}

describe('AudioEngine stereo mixdown', () => {
  it('preserves stereo channel levels at centre pan and applies gain to both channels', async () => {
    const engine = new AudioEngine();
    engine.cacheBuffer('stereo', [new Float32Array([0.25, -0.5]), new Float32Array([0.125, -0.25])], 2);
    const track = makeTrack();

    const [left, right] = await engine.renderMixdownStereo([track], 1, 2);
    expect(Array.from(left)).toEqual([0.25, -0.5]);
    expect(Array.from(right)).toEqual([0.125, -0.25]);

    track.gain = 3;
    const gain = Math.pow(10, 3 / 20);
    const [gainedLeft, gainedRight] = await engine.renderMixdownStereo([track], 1, 2);
    expect(gainedLeft[0]).toBeCloseTo(0.25 * gain, 6);
    expect(gainedLeft[1]).toBeCloseTo(-0.5 * gain, 6);
    expect(gainedRight[0]).toBeCloseTo(0.125 * gain, 6);
    expect(gainedRight[1]).toBeCloseTo(-0.25 * gain, 6);
  });

  it('uses stereo balance panning without attenuating the favoured channel', async () => {
    const engine = new AudioEngine();
    engine.cacheBuffer('stereo', [new Float32Array([0.5]), new Float32Array([-0.25])], 1);

    const [rightLeft, rightRight] = await engine.renderMixdownStereo([makeTrack(1)], 1, 1);
    expect(rightLeft[0]).toBeCloseTo(0, 6);
    expect(rightRight[0]).toBeCloseTo(-0.25, 6);

    const [leftLeft, leftRight] = await engine.renderMixdownStereo([makeTrack(-1)], 1, 1);
    expect(leftLeft[0]).toBeCloseTo(0.5, 6);
    expect(leftRight[0]).toBeCloseTo(0, 6);
  });

  it('keeps constant-power panning for mono clips', async () => {
    const engine = new AudioEngine();
    engine.cacheBuffer('mono', [new Float32Array([0.5])], 1);
    const track = makeTrack(0, { clips: [makeClip({ audioBufferId: 'mono' })] });

    const [left, right] = await engine.renderMixdownStereo([track], 1, 1);
    expect(left[0]).toBeCloseTo(0.5 * Math.SQRT1_2, 6);
    expect(right[0]).toBeCloseTo(0.5 * Math.SQRT1_2, 6);

    track.pan = 1;
    const [pannedLeft, pannedRight] = await engine.renderMixdownStereo([track], 1, 1);
    expect(pannedLeft[0]).toBeCloseTo(0, 6);
    expect(pannedRight[0]).toBeCloseTo(0.5, 6);
  });

  it('honours clip start, source offset and trimmed duration', async () => {
    const engine = new AudioEngine();
    engine.cacheBuffer('stereo', [new Float32Array([1, 2, 3, 4]), new Float32Array([10, 20, 30, 40])], 1);
    const track = makeTrack(0, {
      clips: [makeClip({ startTime: 1, offset: 1, duration: 2, originalDuration: 4 })],
    });

    const [left, right] = await engine.renderMixdownStereo([track], 4, 1);
    expect(Array.from(left)).toEqual([0, 2, 3, 0]);
    expect(Array.from(right)).toEqual([0, 20, 30, 0]);
  });

  it('exports a stretched clip on its shortened timeline without mutating source PCM', async () => {
    const engine = new AudioEngine();
    const sampleRate = 8000;
    const sourceLeft = new Float32Array(2000).fill(0.5);
    const sourceRight = new Float32Array(2000).fill(0.25);
    const clip = makeClip({
      audioBufferId: 'stretched',
      duration: 0.125,
      originalDuration: 0.25,
      stretchRatio: 2,
    });
    const processed = engine.processClipChannels(clip, [sourceLeft, sourceRight], sampleRate);
    expect(processed[0]).toHaveLength(1000);
    expect(processed[1]).toHaveLength(1000);
    expect(sourceLeft).toHaveLength(2000);
    expect(sourceRight).toHaveLength(2000);

    engine.cacheBuffer('stretched', [sourceLeft, sourceRight], sampleRate);
    const track = makeTrack(0, { clips: [clip] });
    const [left, right] = await engine.renderMixdownStereo([track], 0.25, sampleRate);

    expect(left[100]).toBeCloseTo(0.5, 3);
    expect(right[100]).toBeCloseTo(0.25, 3);
    expect(left[1000]).toBe(0);
    expect(right[1000]).toBe(0);
    expect(left[1999]).toBe(0);
    expect(right[1999]).toBe(0);
  });
});
