import { AudioEngine } from './audioEngine';
import type { IClip, IEffect, ITrack } from '@/types/project';

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

describe('AudioEngine effect parameter wiring', () => {
  function makeBiquadContext() {
    const filter = {
      type: '',
      frequency: { value: 0 },
      Q: { value: 0 },
      connect: vi.fn(),
    };
    const context = { createBiquadFilter: () => filter } as unknown as AudioContext;
    return { context, filter };
  }

  it.each([
    ['highPass', 'highpass', 240],
    ['lowPass', 'lowpass', 6400],
  ] as const)('uses the EffectPanel cutoff and Q values for %s', (type, filterType, cutoff) => {
    const engine = new AudioEngine();
    const { context, filter } = makeBiquadContext();
    const effect: IEffect = {
      id: 'filter',
      type,
      bypassed: false,
      params: { cutoff, q: 0.9 },
    };

    const pair = (engine as any).createEffectNode(context, effect);

    expect(pair?.input).toBe(filter);
    expect(filter.type).toBe(filterType);
    expect(filter.frequency.value).toBe(cutoff);
    expect(filter.Q.value).toBe(0.9);
  });

  it.each([
    ['highPass', 80],
    ['lowPass', 8000],
  ] as const)('keeps legacy frequency projects compatible for %s', (type, fallback) => {
    const engine = new AudioEngine();
    const { context, filter } = makeBiquadContext();
    const legacy: IEffect = {
      id: 'legacy-filter',
      type,
      bypassed: false,
      params: { frequency: 1234 },
    };

    (engine as any).createEffectNode(context, legacy);
    expect(filter.frequency.value).toBe(1234);
    expect(filter.Q.value).toBe(0.707);

    (engine as any).createEffectNode(context, { ...legacy, params: {} });
    expect(filter.frequency.value).toBe(fallback);
  });
});

describe('playback level meter', () => {
  it('taps the master output without replacing audio and disconnects on stop', async () => {
    const engine = new AudioEngine();
    const masterGain = { gain: { value: 0 }, connect: vi.fn() };
    const splitter = { connect: vi.fn(), disconnect: vi.fn() };
    const analysers = Array.from({ length: 2 }, () => ({
      fftSize: 0,
      smoothingTimeConstant: 1,
      disconnect: vi.fn(),
      getFloatTimeDomainData: vi.fn((buffer: Float32Array) => { buffer.fill(0); }),
    }));
    let analyserIndex = 0;
    const context = {
      state: 'running',
      sampleRate: 48000,
      destination: { name: 'destination' },
      createGain: vi.fn(() => masterGain),
      createChannelSplitter: vi.fn(() => splitter),
      createAnalyser: vi.fn(() => analysers[analyserIndex++]),
      close: vi.fn(() => Promise.resolve()),
    };
    const originalDescriptor = Object.getOwnPropertyDescriptor(window, 'AudioContext');
    Object.defineProperty(window, 'AudioContext', {
      configurable: true,
      writable: true,
      value: vi.fn(function () { return context; }),
    });

    try {
      await engine.ensureContext();
      expect(masterGain.gain.value).toBe(1);
      expect(masterGain.connect).toHaveBeenCalledWith(context.destination);
      expect(masterGain.connect).toHaveBeenCalledWith(splitter);
      expect(splitter.connect).toHaveBeenCalledWith(analysers[0], 0);
      expect(splitter.connect).toHaveBeenCalledWith(analysers[1], 1);
      expect(analysers.map((analyser) => analyser.fftSize)).toEqual([256, 256]);

      analysers[0].getFloatTimeDomainData.mockImplementation((buffer: Float32Array) => {
        buffer.fill(0);
        buffer[0] = -0.5;
      });
      analysers[1].getFloatTimeDomainData.mockImplementation((buffer: Float32Array) => {
        buffer.fill(0);
        buffer[0] = 0.25;
      });
      (engine as any)._playbackState = 'playing';
      const levels = engine.getPlaybackLevels();
      expect(levels.left).toBeCloseTo(-6.0206, 3);
      expect(levels.right).toBeCloseTo(-12.0412, 3);

      engine.stopPlayback();
      expect(splitter.disconnect).toHaveBeenCalledOnce();
      expect(analysers[0].disconnect).toHaveBeenCalledOnce();
      expect(analysers[1].disconnect).toHaveBeenCalledOnce();
      expect(context.close).toHaveBeenCalledOnce();
      expect(engine.getPlaybackLevels()).toEqual({ left: -60, right: -60 });
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(window, 'AudioContext', originalDescriptor);
      } else {
        delete (window as unknown as { AudioContext?: unknown }).AudioContext;
      }
    }
  });
});
