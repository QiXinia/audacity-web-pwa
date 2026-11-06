import { AudioEngine } from './audioEngine';

function makeMediaStream(channelCount = 2) {
  const stop = vi.fn();
  const track = { stop, getSettings: () => ({ channelCount }) };
  return {
    stream: {
      getAudioTracks: () => [track],
      getTracks: () => [track],
    },
    stop,
  };
}

function makeContext(options: { worklet?: boolean; workletError?: boolean } = {}) {
  const source = { connect: vi.fn(), disconnect: vi.fn() };
  const sink = {
    gain: { value: 1 },
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
  const processor = {
    onaudioprocess: null as ((event: unknown) => void) | null,
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
  const createScriptProcessor = vi.fn(() => processor);
  const context = {
    destination: {},
    createMediaStreamSource: vi.fn(() => source),
    createGain: vi.fn(() => sink),
    createScriptProcessor,
    audioWorklet: options.worklet === false ? undefined : {
      addModule: options.workletError
        ? vi.fn().mockRejectedValue(new Error('worklet unavailable'))
        : vi.fn().mockResolvedValue(undefined),
    },
  };
  return { context, source, sink, processor, createScriptProcessor };
}

class MockMediaRecorder {
  state = 'inactive';
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  constructor(_stream: unknown) {}
  start() { this.state = 'recording'; }
  stop() { this.state = 'inactive'; }
}

describe('AudioEngine recording boundaries', () => {
  const originalMediaDevices = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');
  const originalWorkletNode = globalThis.AudioWorkletNode;
  const originalMediaRecorder = globalThis.MediaRecorder;

  beforeEach(() => {
    vi.stubGlobal('MediaRecorder', MockMediaRecorder);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    if (originalMediaDevices) Object.defineProperty(navigator, 'mediaDevices', originalMediaDevices);
    else Reflect.deleteProperty(navigator, 'mediaDevices');
    if (originalWorkletNode) vi.stubGlobal('AudioWorkletNode', originalWorkletNode);
    if (originalMediaRecorder) vi.stubGlobal('MediaRecorder', originalMediaRecorder);
  });

  it('deinterleaves stereo frames and waits for the worklet tail acknowledgement', async () => {
    const engine = new AudioEngine();
    const { stream, stop } = makeMediaStream(2);
    const { context, source, sink } = makeContext();
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue(stream) },
    });
    vi.spyOn(engine as any, 'ensureContext' as any).mockResolvedValue(context as never);

    let node: {
      port: {
        onmessage: ((event: { data: Record<string, unknown> }) => void) | null;
        postMessage: ReturnType<typeof vi.fn>;
        close: ReturnType<typeof vi.fn>;
      };
      connect: ReturnType<typeof vi.fn>;
      disconnect: ReturnType<typeof vi.fn>;
    };
    class MockWorkletNode {
      port = {
        onmessage: null as ((event: { data: Record<string, unknown> }) => void) | null,
        postMessage: vi.fn(),
        close: vi.fn(),
      };
      connect = vi.fn();
      disconnect = vi.fn();
      constructor() {
        node = {
          port: this.port,
          connect: this.connect,
          disconnect: this.disconnect,
        };
        this.port.postMessage.mockImplementation((message: { type: string }) => {
          if (message.type !== 'stop') return;
          queueMicrotask(() => {
            this.port.onmessage?.({
              data: {
                type: 'recording',
                audioData: new Float32Array([0.3, 0.7]),
                numChannels: 2,
              },
            });
            this.port.onmessage?.({ data: { type: 'stopped' } });
          });
        });
      }
    }
    vi.stubGlobal('AudioWorkletNode', MockWorkletNode);

    await engine.startRecording({ stereo: true });
    node!.port.onmessage?.({
      data: {
        type: 'recording',
        audioData: new Float32Array([0.1, 0.9, 0.2, 0.8]),
        numChannels: 2,
      },
    });
    const result = await engine.stopRecording();

    expect(result).toHaveLength(2);
    expect(Array.from(result?.[0] ?? [])).toEqual([
      0.10000000149011612,
      0.20000000298023224,
      0.30000001192092896,
    ]);
    expect(Array.from(result?.[1] ?? [])).toEqual([
      0.8999999761581421,
      0.800000011920929,
      0.699999988079071,
    ]);
    expect(stop).toHaveBeenCalledOnce();
    expect(source.disconnect).toHaveBeenCalledOnce();
    expect(sink.disconnect).toHaveBeenCalledOnce();
    expect(node!.disconnect).toHaveBeenCalledOnce();
    expect(node!.port.close).toHaveBeenCalledOnce();
  });

  it('uses the device channel count for stereo ScriptProcessor fallback', async () => {
    const engine = new AudioEngine();
    const { stream, stop } = makeMediaStream(2);
    const { context, processor, createScriptProcessor } = makeContext({ workletError: true });
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue(stream) },
    });
    vi.spyOn(engine as any, 'ensureContext' as any).mockResolvedValue(context as never);

    await engine.startRecording({ stereo: true });
    expect(createScriptProcessor).toHaveBeenCalledWith(4096, 2, 1);
    processor.onaudioprocess?.({
      inputBuffer: {
        numberOfChannels: 2,
        length: 2,
        getChannelData: (channel: number) => channel === 0
          ? new Float32Array([0.1, 0.2])
          : new Float32Array([0.8, 0.9]),
      },
    });
    const result = await engine.stopRecording();

    expect(Array.from(result?.[0] ?? [])).toHaveLength(2);
    expect(result?.[1]?.[0]).toBeCloseTo(0.8, 6);
    expect(result?.[1]?.[1]).toBeCloseTo(0.9, 6);
    expect(stop).toHaveBeenCalledOnce();
    expect(processor.disconnect).toHaveBeenCalledOnce();
    expect(processor.onaudioprocess).toBeNull();
  });

  it('disconnects a partially initialized worklet before ScriptProcessor fallback', async () => {
    const engine = new AudioEngine();
    const { stream, stop } = makeMediaStream(1);
    const { context, source, processor } = makeContext();
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue(stream) },
    });
    vi.spyOn(engine as any, 'ensureContext' as any).mockResolvedValue(context as never);

    const nodes: MockWorkletNode[] = [];
    class MockWorkletNode {
      port = {
        onmessage: null as ((event: { data: Record<string, unknown> }) => void) | null,
        postMessage: vi.fn(),
        close: vi.fn(),
      };
      connect = vi.fn(() => { throw new Error('worklet output connection failed'); });
      disconnect = vi.fn();
      constructor() {
        nodes.push(this);
      }
    }
    vi.stubGlobal('AudioWorkletNode', MockWorkletNode);

    await engine.startRecording();

    const node = nodes[0]!;
    expect(engine.getRecordingMode()).toBe('scriptprocessor');
    expect(node.port.onmessage).toBeNull();
    expect(node.disconnect).toHaveBeenCalledOnce();
    expect(node.port.close).toHaveBeenCalledOnce();
    expect(source.disconnect).toHaveBeenCalledWith(node);

    processor.onaudioprocess?.({
      inputBuffer: {
        numberOfChannels: 1,
        length: 2,
        getChannelData: () => new Float32Array([0.1, 0.2]),
      },
    });
    const result = await engine.stopRecording();

    expect(Array.from(result?.[0] ?? [])).toEqual([
      0.10000000149011612,
      0.20000000298023224,
    ]);
    expect(stop).toHaveBeenCalledOnce();
  });

  it('times out safely when a worklet never acknowledges stop', async () => {
    vi.useFakeTimers();
    const engine = new AudioEngine();
    const { stream, stop } = makeMediaStream(1);
    const { context } = makeContext();
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue(stream) },
    });
    vi.spyOn(engine as any, 'ensureContext' as any).mockResolvedValue(context as never);
    class MockWorkletNode {
      port = {
        onmessage: null as ((event: { data: Record<string, unknown> }) => void) | null,
        postMessage: vi.fn(),
        close: vi.fn(),
      };
      connect = vi.fn();
      disconnect = vi.fn();
    }
    vi.stubGlobal('AudioWorkletNode', MockWorkletNode);

    await engine.startRecording();
    const pending = engine.stopRecording();
    await vi.advanceTimersByTimeAsync(500);
    const result = await pending;

    expect(result).toBeNull();
    expect(stop).toHaveBeenCalledOnce();
    expect(engine.recordingState).toBe('idle');
  });

  it('stops the acquired stream when audio graph initialization fails', async () => {
    const engine = new AudioEngine();
    const { stream, stop } = makeMediaStream(2);
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue(stream) },
    });
    vi.spyOn(engine as any, 'ensureContext' as any).mockRejectedValue(new Error('context failed'));

    await expect(engine.startRecording({ stereo: true })).rejects.toThrow('context failed');
    expect(stop).toHaveBeenCalledOnce();
    expect(engine.recordingState).toBe('idle');
  });
});
