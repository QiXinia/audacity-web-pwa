import { GeneratorPreviewPlayer } from './generatorPreview';

function makeContext(state: AudioContextState = 'running') {
  const destination = {};
  const data = new Float32Array(3);
  const source = {
    buffer: null as AudioBuffer | null,
    onended: null as (() => void) | null,
    connect: vi.fn(),
    disconnect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  };
  const context = {
    state,
    destination,
    resume: vi.fn(() => Promise.resolve()),
    close: vi.fn(() => Promise.resolve()),
    createBuffer: vi.fn((_channels: number, _length: number, _sampleRate: number) => ({
      getChannelData: () => data,
    })),
    createBufferSource: vi.fn(() => source),
  } as unknown as AudioContext;
  return { context, source, data, destination };
}

describe('GeneratorPreviewPlayer', () => {
  it('plays the exact mono samples and cleans up after natural completion', async () => {
    const { context, source, data, destination } = makeContext('suspended');
    const player = new GeneratorPreviewPlayer(() => context);
    const onEnded = vi.fn();
    const samples = new Float32Array([0.25, -0.5, 0.75]);

    await player.play(samples, 48000, onEnded);

    expect(context.resume).toHaveBeenCalledOnce();
    expect(context.createBuffer).toHaveBeenCalledWith(1, 3, 48000);
    expect(Array.from(data)).toEqual([0.25, -0.5, 0.75]);
    expect(source.connect).toHaveBeenCalledWith(destination);
    expect(source.start).toHaveBeenCalledOnce();
    expect(context.close).not.toHaveBeenCalled();

    source.onended?.();
    expect(onEnded).toHaveBeenCalledOnce();
    expect(source.disconnect).toHaveBeenCalledOnce();
    expect(context.close).toHaveBeenCalledOnce();
  });

  it('plays stereo channels without downmixing the real selection', async () => {
    const { context, source } = makeContext();
    const left = new Float32Array(3);
    const right = new Float32Array(3);
    context.createBuffer = vi.fn((_channels: number, _length: number, _sampleRate: number) => ({
      getChannelData: (index: number) => index === 0 ? left : right,
    })) as unknown as AudioContext['createBuffer'];
    const player = new GeneratorPreviewPlayer(() => context);

    await player.playChannels([
      Float32Array.from([0.1, 0.2, 0.3]),
      Float32Array.from([-0.1, -0.2, -0.3]),
    ], 44100, vi.fn());

    expect(context.createBuffer).toHaveBeenCalledWith(2, 3, 44100);
    expect(Array.from(left)).toEqual([0.1, 0.2, 0.3].map(Math.fround));
    expect(Array.from(right)).toEqual([-0.1, -0.2, -0.3].map(Math.fround));
    expect(source.start).toHaveBeenCalledOnce();
  });

  it('stops and disconnects an active preview without firing a stale completion', async () => {
    const { context, source } = makeContext();
    const player = new GeneratorPreviewPlayer(() => context);
    const onEnded = vi.fn();
    await player.play(new Float32Array([1, 0, -1]), 44100, onEnded);

    player.stop();
    source.onended?.();

    expect(source.stop).toHaveBeenCalledOnce();
    expect(source.disconnect).toHaveBeenCalledOnce();
    expect(context.close).toHaveBeenCalledOnce();
    expect(onEnded).not.toHaveBeenCalled();
  });

  it('cancels a pending resume instead of starting after stop', async () => {
    let resolveResume!: () => void;
    const { context, source } = makeContext('suspended');
    context.resume = vi.fn(() => new Promise<void>((resolve) => { resolveResume = resolve; }));
    const player = new GeneratorPreviewPlayer(() => context);
    const onEnded = vi.fn();

    const pending = player.play(new Float32Array([1, 0, -1]), 44100, onEnded);
    player.stop();
    resolveResume();
    await pending;

    expect(source.start).not.toHaveBeenCalled();
    expect(onEnded).not.toHaveBeenCalled();
    expect(context.close).toHaveBeenCalled();
  });
});
