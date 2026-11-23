import { AudioEngine } from './audioEngine';
import type { IClip, IEffect, ITrack } from '@/types/project';
import { METER_PREFERENCES_STORAGE_KEY } from '@/lib/meterPreferences';

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

describe('loop playback scheduling', () => {
  function makePlaybackContext(currentTime = 10) {
    const sources: Array<Record<string, any>> = [];
    const buffers: Array<{ data: Float32Array[]; duration: number }> = [];
    const context = {
      currentTime,
      state: 'running',
      sampleRate: 48000,
      destination: {},
      close: vi.fn(() => Promise.resolve()),
      createGain: vi.fn(() => ({
        gain: { value: 0, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() },
        connect: vi.fn(),
      })),
      createStereoPanner: vi.fn(() => ({ pan: { value: 0 }, connect: vi.fn() })),
      createBuffer: vi.fn((channelCount: number, frameLength: number, sampleRate: number) => {
        const data = Array.from({ length: channelCount }, () => new Float32Array(frameLength));
        const buffer = { data, duration: frameLength / sampleRate };
        buffers.push(buffer);
        return { getChannelData: (index: number) => data[index] };
      }),
      createBufferSource: vi.fn(() => {
        const source: Record<string, any> = { connect: vi.fn(), start: vi.fn() };
        sources.push(source);
        return source;
      }),
    } as unknown as AudioContext;
    return { context, sources, buffers };
  }

  it('uses one region period for every clip and wraps the engine playhead', async () => {
    const engine = new AudioEngine();
    engine.cacheBuffer('loop-pcm', [new Float32Array([1, 2])], 2);
    const { context, sources, buffers } = makePlaybackContext();
    const masterGain = { connect: vi.fn() };
    vi.spyOn(engine, 'ensureContext').mockImplementation(async () => {
      (engine as any).audioContext = context;
      (engine as any).masterGain = masterGain;
      return context;
    });
    let frame: FrameRequestCallback | undefined;
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      frame = callback;
      return 1;
    }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const cursor = vi.fn();
    engine.setCursorChangeCallback(cursor);

    try {
      await engine.play([
        makeTrack(0, {
          clips: [
            makeClip({ id: 'first', audioBufferId: 'loop-pcm', startTime: 1, duration: 1 }),
            makeClip({ id: 'second', audioBufferId: 'loop-pcm', startTime: 2, duration: 1 }),
          ],
        }),
      ], 0, false, { loop: { start: 1, end: 3 } });

      expect(sources).toHaveLength(2);
      expect(sources.map((source) => source.loop)).toEqual([true, true]);
      expect(sources.map((source) => source.loopEnd)).toEqual([2, 2]);
      expect(sources.map((source) => source.start.mock.calls[0])).toEqual([[10, 0], [10, 0]]);
      expect(Array.from(buffers[0].data[0])).toEqual([1, 2, 0, 0]);
      expect(Array.from(buffers[1].data[0])).toEqual([0, 0, 1, 2]);

      (context as any).currentTime = 14;
      frame?.(14);
      expect(engine.cursorPosition).toBe(1);
      expect(cursor).toHaveBeenLastCalledWith(1);
    } finally {
      engine.stopPlayback();
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }
  });

  it('does not restart a cancelled play after its AudioContext wait resolves', async () => {
    const engine = new AudioEngine();
    engine.cacheBuffer('stereo', [new Float32Array([1, 2])], 2);
    const { context, sources } = makePlaybackContext();
    let resolveContext!: (value: AudioContext) => void;
    const pendingContext = new Promise<AudioContext>((resolve) => { resolveContext = resolve; });
    vi.spyOn(engine, 'ensureContext').mockReturnValue(pendingContext);
    const animationFrame = vi.fn(() => 1);
    vi.stubGlobal('requestAnimationFrame', animationFrame);
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const stateChange = vi.fn();
    engine.setStateChangeCallback(stateChange);

    try {
      const pendingPlay = engine.play([makeTrack()], 0, false);
      expect(engine.ensureContext).toHaveBeenCalledTimes(1);
      engine.stopPlayback();

      resolveContext(context);
      await pendingPlay;

      expect(engine.playbackState).toBe('stopped');
      expect(sources).toHaveLength(0);
      expect(animationFrame).not.toHaveBeenCalled();
      expect(stateChange).not.toHaveBeenCalledWith('playing');
    } finally {
      engine.stopPlayback();
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }
  });

  it('keeps only the newest play when an older AudioContext wait resolves last', async () => {
    const engine = new AudioEngine();
    engine.cacheBuffer('stereo', [new Float32Array([1, 2])], 2);
    const oldContext = makePlaybackContext();
    const newContext = makePlaybackContext(20);
    let resolveOld!: (value: AudioContext) => void;
    let resolveNew!: (value: AudioContext) => void;
    vi.spyOn(engine, 'ensureContext')
      .mockImplementationOnce(() => new Promise<AudioContext>((resolve) => { resolveOld = resolve; }))
      .mockImplementationOnce(() => new Promise<AudioContext>((resolve) => { resolveNew = resolve; }));
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    try {
      const oldPlay = engine.play([makeTrack()], 0, false);
      const newPlay = engine.play([makeTrack()], 0.5, false);
      resolveNew(newContext.context);
      await newPlay;
      expect(newContext.sources).toHaveLength(1);

      resolveOld(oldContext.context);
      await oldPlay;

      expect(oldContext.sources).toHaveLength(0);
      expect(newContext.sources).toHaveLength(1);
      expect(engine.playbackState).toBe('playing');
      expect(engine.cursorPosition).toBe(0.5);
    } finally {
      engine.stopPlayback();
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }
  });

  it('skips the whole realtime chain when track effects are powered off', async () => {
    const engine = new AudioEngine();
    engine.cacheBuffer('stereo', [new Float32Array([1, 2])], 2);
    const { context, sources } = makePlaybackContext();
    const masterGain = { connect: vi.fn() };
    vi.spyOn(engine, 'ensureContext').mockImplementation(async () => {
      (engine as any).audioContext = context;
      (engine as any).masterGain = masterGain;
      return context;
    });
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const effect: IEffect = { id: 'gain', type: 'gain', bypassed: false, params: { gain: 20 } };
    const track = makeTrack(0, { effectsActive: false, effects: [effect] });

    try {
      await engine.play([track], 0, false);
      expect(sources).toHaveLength(1);
      expect(context.createGain).toHaveBeenCalledTimes(2);
      expect(track.effectsActive).toBe(false);
      expect(track.effects[0]?.bypassed).toBe(false);
    } finally {
      engine.stopPlayback();
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }
  });

  it('rejects an invalid loop before opening an AudioContext', async () => {
    const engine = new AudioEngine();
    const ensure = vi.spyOn(engine, 'ensureContext');
    await expect(engine.play([], 0, false, { loop: { start: 2, end: 2 } }))
      .rejects.toThrow('循环区域');
    expect(ensure).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});

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

  it('includes clip pitch and voice preset in export processing and cache identity', async () => {
    const engine = new AudioEngine();
    const sampleRate = 8000;
    const source = new Float32Array(4000);
    for (let index = 0; index < source.length; index += 1) {
      source[index] = 0.4 * Math.sin(2 * Math.PI * 440 * index / sampleRate);
    }
    const original = source.slice();
    engine.cacheBuffer('pitched', [source], sampleRate);
    const base = { audioBufferId: 'pitched', duration: 0.4, originalDuration: 0.5, stretchRatio: 1.25 };
    const [neutral] = await engine.renderMixdownStereo([
      makeTrack(0, { clips: [makeClip({ ...base, pitchCents: 0 })] }),
    ], 0.5, sampleRate);
    const [shifted] = await engine.renderMixdownStereo([
      makeTrack(0, { clips: [makeClip({ ...base, pitchCents: 1200 })] }),
    ], 0.5, sampleRate);
    const [voice] = await engine.renderMixdownStereo([
      makeTrack(0, { clips: [makeClip({ ...base, pitchCents: 1200, optimizeForVoice: true })] }),
    ], 0.5, sampleRate);
    expect(shifted).not.toEqual(neutral);
    expect(voice).not.toEqual(shifted);
    expect(source).toEqual(original);
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

      for (const analyser of analysers) {
        analyser.getFloatTimeDomainData.mockImplementation((buffer: Float32Array) => {
          buffer.fill(0);
          buffer[0] = 0.0001;
        });
      }
      expect(engine.getPlaybackLevels()).toEqual({ left: -60, right: -60 });
      window.localStorage.setItem(METER_PREFERENCES_STORAGE_KEY, JSON.stringify({ dbRange: -96 }));
      const lowLevels = engine.getPlaybackLevels();
      expect(lowLevels.left).toBeCloseTo(-80, 6);
      expect(lowLevels.right).toBeCloseTo(-80, 6);
      window.localStorage.removeItem(METER_PREFERENCES_STORAGE_KEY);

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

describe('realtime effect offline rendering boundaries', () => {
  it('copies bypassed PCM without requiring an OfflineAudioContext', async () => {
    const engine = new AudioEngine();
    const input = [Float32Array.from([0.25, -0.5])];
    const output = await engine.renderRealtimeEffects(input, 48000, [{
      id: 'gain', type: 'gain', bypassed: true, params: { gain: 20 },
    }]);
    expect(output).toHaveLength(1);
    expect(Array.from(output[0]!)).toEqual([0.25, -0.5]);
    expect(output[0]).not.toBe(input[0]);
  });

  it('connects enabled realtime nodes in the persisted chain order', async () => {
    const engine = new AudioEngine();
    const input = [Float32Array.from([0.25, -0.5])];
    const destination = {};
    const gains: Array<{ gain: { value: number }; connect: ReturnType<typeof vi.fn> }> = [];
    const buffer = {
      numberOfChannels: 1,
      getChannelData: vi.fn(() => Float32Array.from([0.25, -0.5])),
    };
    const source = { connect: vi.fn(), start: vi.fn(), buffer: null };
    const context = {
      destination,
      createBuffer: vi.fn(() => buffer),
      createBufferSource: vi.fn(() => source),
      createGain: vi.fn(() => {
        const node = { gain: { value: 0 }, connect: vi.fn() };
        gains.push(node);
        return node;
      }),
      startRendering: vi.fn(async () => buffer),
    };
    vi.stubGlobal('OfflineAudioContext', vi.fn(function OfflineAudioContext() { return context; }));

    try {
      await engine.renderRealtimeEffects(input, 48000, [
        { id: 'first', type: 'gain', bypassed: false, params: { gain: 0 } },
        { id: 'second', type: 'gain', bypassed: false, params: { gain: -6 } },
      ]);
      expect(gains).toHaveLength(2);
      expect(gains[0]!.gain.value).toBe(1);
      expect(gains[1]!.gain.value).toBeCloseTo(10 ** (-6 / 20), 8);
      expect(source.connect).toHaveBeenCalledWith(gains[0]);
      expect(gains[0]!.connect).toHaveBeenCalledWith(gains[1]);
      expect(gains[1]!.connect).toHaveBeenCalledWith(destination);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('rejects invalid channel layouts and rates before allocation', async () => {
    const engine = new AudioEngine();
    await expect(engine.renderRealtimeEffects([], 48000, [])).rejects.toThrow(/单声道或立体声/);
    await expect(engine.renderRealtimeEffects([
      new Float32Array(2), new Float32Array(1),
    ], 48000, [])).rejects.toThrow(/等长声道/);
    await expect(engine.renderRealtimeEffects([new Float32Array(2)], 0, [])).rejects.toThrow(/采样率/);
  });
});
