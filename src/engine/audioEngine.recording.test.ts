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

function makeContext(options: { worklet?: boolean; workletError?: boolean; meterPairs?: number } = {}) {
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
  const splitter = { connect: vi.fn(), disconnect: vi.fn() };
  const analysers = Array.from({ length: 2 * (options.meterPairs ?? 1) }, () => ({
    fftSize: 0,
    smoothingTimeConstant: 1,
    disconnect: vi.fn(),
    getFloatTimeDomainData: vi.fn((buffer: Float32Array) => { buffer.fill(0); }),
  }));
  let analyserIndex = 0;
  const context = {
    destination: {},
    createMediaStreamSource: vi.fn(() => source),
    createGain: vi.fn(() => sink),
    createChannelSplitter: vi.fn(() => splitter),
    createAnalyser: vi.fn(() => analysers[analyserIndex++]),
    createScriptProcessor,
    audioWorklet: options.worklet === false ? undefined : {
      addModule: options.workletError
        ? vi.fn().mockRejectedValue(new Error('worklet unavailable'))
        : vi.fn().mockResolvedValue(undefined),
    },
  };
  return { context, source, sink, processor, createScriptProcessor, splitter, analysers };
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

  it('coalesces reentrant stops while the worklet tail is pending', async () => {
    const engine = new AudioEngine();
    const { stream, stop } = makeMediaStream(1);
    const { context, source } = makeContext();
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
      }
    }
    vi.stubGlobal('AudioWorkletNode', MockWorkletNode);
    const onRecordingData = vi.fn();
    engine.setRecordingDataCallback(onRecordingData);

    await engine.startRecording();
    node!.port.onmessage?.({
      data: {
        type: 'recording',
        audioData: new Float32Array([0.25, 0.75]),
        numChannels: 1,
      },
    });
    const firstStop = engine.stopRecording();
    const secondStop = engine.stopRecording();
    const stopMessageCount = node!.port.postMessage.mock.calls
      .filter(([message]) => (message as { type?: string }).type === 'stop').length;
    node!.port.onmessage?.({ data: { type: 'stopped' } });
    const secondResult = await secondStop;
    const firstResult = await firstStop;

    expect(stopMessageCount).toBe(1);
    expect(firstResult).toBe(secondResult);
    expect(Array.from(firstResult?.[0] ?? [])).toHaveLength(2);
    expect(onRecordingData).toHaveBeenCalledOnce();
    expect(stop).toHaveBeenCalledOnce();
    expect(source.disconnect).toHaveBeenCalledOnce();
    expect(node!.disconnect).toHaveBeenCalledOnce();
    expect(node!.port.close).toHaveBeenCalledOnce();
  });

  it('waits for a pending stop before coalescing rapid recording restarts', async () => {
    const engine = new AudioEngine();
    const first = makeMediaStream(1);
    const second = makeMediaStream(1);
    const { context } = makeContext({ meterPairs: 2 });
    const getUserMedia = vi.fn()
      .mockResolvedValueOnce(first.stream)
      .mockResolvedValueOnce(second.stream);
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia },
    });
    vi.spyOn(engine as any, 'ensureContext' as any).mockResolvedValue(context as never);

    const nodes: MockWorkletNode[] = [];
    class MockWorkletNode {
      port = {
        onmessage: null as ((event: { data: Record<string, unknown> }) => void) | null,
        postMessage: vi.fn(),
        close: vi.fn(),
      };
      connect = vi.fn();
      disconnect = vi.fn();
      constructor() {
        nodes.push(this);
      }
    }
    vi.stubGlobal('AudioWorkletNode', MockWorkletNode);

    await engine.startRecording();
    nodes[0]!.port.onmessage?.({
      data: {
        type: 'recording',
        audioData: new Float32Array([0.125]),
        numChannels: 1,
      },
    });
    const firstStop = engine.stopRecording();
    const firstRestart = engine.startRecording();
    const secondRestart = engine.startRecording();

    // The old stream must finish its tail and cleanup before a replacement opens.
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    nodes[0]!.port.onmessage?.({ data: { type: 'stopped' } });
    const firstResult = await firstStop;
    await Promise.all([firstRestart, secondRestart]);

    expect(Array.from(firstResult?.[0] ?? [])).toHaveLength(1);
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(nodes).toHaveLength(2);
    expect(first.stop).toHaveBeenCalledOnce();
    expect(second.stop).not.toHaveBeenCalled();
    expect(engine.recordingState).toBe('recording');

    nodes[1]!.port.onmessage?.({
      data: {
        type: 'recording',
        audioData: new Float32Array([0.875]),
        numChannels: 1,
      },
    });
    const secondStop = engine.stopRecording();
    nodes[1]!.port.onmessage?.({ data: { type: 'stopped' } });
    const secondResult = await secondStop;

    expect(Array.from(secondResult?.[0] ?? [])).toHaveLength(1);
    expect(secondResult?.[0]?.[0]).toBeCloseTo(0.875, 6);
    expect(secondResult).not.toBe(firstResult);
    expect(first.stop).toHaveBeenCalledOnce();
    expect(second.stop).toHaveBeenCalledOnce();
    expect(engine.recordingState).toBe('idle');
  });

  it('cancels a restart waiting for stop when recording is stopped again', async () => {
    const engine = new AudioEngine();
    const first = makeMediaStream(1);
    const second = makeMediaStream(1);
    const { context } = makeContext({ meterPairs: 2 });
    const getUserMedia = vi.fn()
      .mockResolvedValueOnce(first.stream)
      .mockResolvedValueOnce(second.stream);
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia },
    });
    vi.spyOn(engine as any, 'ensureContext' as any).mockResolvedValue(context as never);

    const nodes: MockWorkletNode[] = [];
    class MockWorkletNode {
      port = {
        onmessage: null as ((event: { data: Record<string, unknown> }) => void) | null,
        postMessage: vi.fn(),
        close: vi.fn(),
      };
      connect = vi.fn();
      disconnect = vi.fn();
      constructor() {
        nodes.push(this);
      }
    }
    vi.stubGlobal('AudioWorkletNode', MockWorkletNode);

    await engine.startRecording();
    nodes[0]!.port.onmessage?.({
      data: {
        type: 'recording',
        audioData: new Float32Array([0.25]),
        numChannels: 1,
      },
    });
    const firstStop = engine.stopRecording();
    const pendingRestart = engine.startRecording();
    expect(getUserMedia).toHaveBeenCalledTimes(1);

    // A second Stop must cancel the deferred restart too. Otherwise leaving the
    // editor while the old Worklet tail drains can open a brand-new microphone.
    const repeatedStop = engine.stopRecording();
    nodes[0]!.port.onmessage?.({ data: { type: 'stopped' } });
    const [firstResult, repeatedResult] = await Promise.all([
      firstStop,
      repeatedStop,
      pendingRestart,
    ]);

    expect(repeatedResult).toBe(firstResult);
    expect(Array.from(firstResult?.[0] ?? [])).toHaveLength(1);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(first.stop).toHaveBeenCalledOnce();
    expect(second.stop).not.toHaveBeenCalled();
    expect(nodes).toHaveLength(1);
    expect(engine.recordingState).toBe('idle');
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

  it('keeps ScriptProcessor stereo blocks aligned when a right channel is temporarily missing', async () => {
    const engine = new AudioEngine();
    const { stream, stop } = makeMediaStream(2);
    const { context, processor } = makeContext({ worklet: false });
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue(stream) },
    });
    vi.spyOn(engine as any, 'ensureContext' as any).mockResolvedValue(context as never);

    await engine.startRecording({ stereo: true });
    processor.onaudioprocess?.({
      inputBuffer: {
        numberOfChannels: 1,
        length: 2,
        getChannelData: () => new Float32Array([0.1, 0.2]),
      },
    });
    processor.onaudioprocess?.({
      inputBuffer: {
        numberOfChannels: 2,
        length: 1,
        getChannelData: (channel: number) => channel === 0
          ? new Float32Array([0.3])
          : new Float32Array([0.7]),
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
      0.10000000149011612,
      0.20000000298023224,
      0.699999988079071,
    ]);
    expect(stop).toHaveBeenCalledOnce();
  });

  it('forces mono worklet input on a stereo device', async () => {
    const engine = new AudioEngine();
    const { stream, stop } = makeMediaStream(2);
    const { context } = makeContext();
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue(stream) },
    });
    vi.spyOn(engine as any, 'ensureContext' as any).mockResolvedValue(context as never);

    let receivedOptions: {
      channelCount?: number;
      channelCountMode?: string;
      outputChannelCount?: number[];
    } | undefined;
    class MockWorkletNode {
      port = {
        onmessage: null as ((event: { data: Record<string, unknown> }) => void) | null,
        postMessage: vi.fn(),
        close: vi.fn(),
      };
      connect = vi.fn();
      disconnect = vi.fn();
      constructor(
        _context: unknown,
        _name: string,
        options: {
          channelCount?: number;
          channelCountMode?: string;
          outputChannelCount?: number[];
        },
      ) {
        receivedOptions = options;
        this.port.postMessage.mockImplementation((message: { type: string }) => {
          if (message.type === 'stop') {
            queueMicrotask(() => this.port.onmessage?.({ data: { type: 'stopped' } }));
          }
        });
      }
    }
    vi.stubGlobal('AudioWorkletNode', MockWorkletNode);

    await engine.startRecording();
    await engine.stopRecording();

    expect(receivedOptions).toMatchObject({
      channelCount: 1,
      channelCountMode: 'explicit',
      outputChannelCount: [1],
    });
    expect(stop).toHaveBeenCalledOnce();
  });

  it('keeps mono recording mono during ScriptProcessor fallback on a stereo device', async () => {
    const engine = new AudioEngine();
    const { stream, stop } = makeMediaStream(2);
    const { context, processor, createScriptProcessor } = makeContext({ worklet: false });
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue(stream) },
    });
    vi.spyOn(engine as any, 'ensureContext' as any).mockResolvedValue(context as never);

    await engine.startRecording();
    expect(createScriptProcessor).toHaveBeenCalledWith(4096, 1, 1);
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

    expect(result).toHaveLength(1);
    expect(Array.from(result?.[0] ?? [])).toEqual([
      0.10000000149011612,
      0.20000000298023224,
    ]);
    expect(stop).toHaveBeenCalledOnce();
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

  it('cleans up a partially connected ScriptProcessor when startup fails', async () => {
    const engine = new AudioEngine();
    const { stream, stop } = makeMediaStream(1);
    const { context, source, processor } = makeContext({ worklet: false });
    processor.connect.mockImplementation(() => { throw new Error('processor output connection failed'); });
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue(stream) },
    });
    vi.spyOn(engine as any, 'ensureContext' as any).mockResolvedValue(context as never);

    await expect(engine.startRecording()).rejects.toThrow('processor output connection failed');

    expect(processor.onaudioprocess).toBeNull();
    expect(processor.disconnect).toHaveBeenCalledOnce();
    expect(source.disconnect).toHaveBeenCalledOnce();
    expect(stop).toHaveBeenCalledOnce();
    expect(engine.recordingState).toBe('idle');
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

  it('monitors recording input independently and clears the analyser branch on stop', async () => {
    const engine = new AudioEngine();
    const { stream } = makeMediaStream(2);
    const { context, source, sink, processor, splitter, analysers } = makeContext({ worklet: false });
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue(stream) },
    });
    vi.spyOn(engine as any, 'ensureContext' as any).mockResolvedValue(context as never);

    await engine.startRecording({ stereo: true });
    expect(source.connect).toHaveBeenCalledWith(splitter);
    expect(source.connect).toHaveBeenCalledWith(processor);
    expect(splitter.connect).toHaveBeenCalledWith(analysers[0], 0);
    expect(splitter.connect).toHaveBeenCalledWith(analysers[1], 1);
    expect(processor.connect).toHaveBeenCalledWith(sink);
    expect(sink.gain.value).toBe(0);

    analysers[0].getFloatTimeDomainData.mockImplementation((buffer: Float32Array) => {
      buffer.fill(0);
      buffer[0] = -0.5;
    });
    analysers[1].getFloatTimeDomainData.mockImplementation((buffer: Float32Array) => {
      buffer.fill(0);
      buffer[0] = 0.25;
    });
    const levels = engine.getRecordingLevels();
    expect(levels.left).toBeCloseTo(-6.0206, 3);
    expect(levels.right).toBeCloseTo(-12.0412, 3);

    await engine.stopRecording();
    expect(splitter.disconnect).toHaveBeenCalledOnce();
    expect(analysers[0].disconnect).toHaveBeenCalledOnce();
    expect(analysers[1].disconnect).toHaveBeenCalledOnce();
    expect(source.disconnect).toHaveBeenCalledOnce();
    expect(engine.recordingState).toBe('idle');
    expect(engine.getRecordingLevels()).toEqual({ left: -60, right: -60 });
  });

  it('keeps stopped-state mic metering silent unless input monitoring is enabled', async () => {
    const engine = new AudioEngine();
    const { stream, stop } = makeMediaStream(2);
    const { context, source, sink, splitter, analysers } = makeContext({ worklet: false });
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue(stream) },
    });
    vi.spyOn(engine as any, 'ensureContext' as any).mockResolvedValue(context as never);

    await engine.startMicrophoneMonitoring({ audible: false });

    expect(engine.recordingState).toBe('idle');
    expect(engine.isMicrophoneMonitoringActive()).toBe(true);
    expect(source.connect).toHaveBeenCalledWith(splitter);
    expect(source.connect).toHaveBeenCalledWith(sink);
    expect(sink.connect).toHaveBeenCalledWith(context.destination);
    expect(sink.gain.value).toBe(0);

    analysers[0].getFloatTimeDomainData.mockImplementation((buffer: Float32Array) => {
      buffer.fill(0);
      buffer[0] = 0.5;
    });
    expect(engine.getRecordingLevels().left).toBeCloseTo(-6.0206, 3);
    engine.setMonitoringEnabled(true);
    expect(sink.gain.value).toBe(1);
    engine.setMonitoringEnabled(false);
    expect(sink.gain.value).toBe(0);

    engine.stopMicrophoneMonitoring();
    expect(stop).toHaveBeenCalledOnce();
    expect(source.disconnect).toHaveBeenCalledOnce();
    expect(sink.disconnect).toHaveBeenCalledOnce();
    expect(splitter.disconnect).toHaveBeenCalledOnce();
    expect(engine.isMicrophoneMonitoringActive()).toBe(false);
    expect(engine.getRecordingLevels()).toEqual({ left: -60, right: -60 });
  });

  it('stops a stale pending microphone stream instead of activating it after cancellation', async () => {
    const engine = new AudioEngine();
    const { stream, stop } = makeMediaStream(1);
    let resolveStream: ((value: unknown) => void) | undefined;
    const getUserMedia = vi.fn(() => new Promise((resolve) => { resolveStream = resolve; }));
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia },
    });
    const ensureContext = vi.spyOn(engine as any, 'ensureContext' as any);

    const pending = engine.startMicrophoneMonitoring();
    engine.stopMicrophoneMonitoring();
    resolveStream?.(stream);
    await pending;

    expect(stop).toHaveBeenCalledOnce();
    expect(ensureContext).not.toHaveBeenCalled();
    expect(engine.isMicrophoneMonitoringActive()).toBe(false);
  });

  it('does not revive duplicate monitoring callers cancelled by a stop', async () => {
    const engine = new AudioEngine();
    const first = makeMediaStream(1);
    const unexpected = makeMediaStream(1);
    const { context } = makeContext({ worklet: false });
    let resolveFirstStream: ((value: unknown) => void) | undefined;
    const getUserMedia = vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirstStream = resolve; }))
      .mockResolvedValue(unexpected.stream);
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia },
    });
    vi.spyOn(engine as any, 'ensureContext' as any).mockResolvedValue(context as never);

    const initialStart = engine.startMicrophoneMonitoring();
    const cancelledDuplicate = engine.startMicrophoneMonitoring();
    engine.stopMicrophoneMonitoring();
    resolveFirstStream?.(first.stream);
    await Promise.all([initialStart, cancelledDuplicate]);

    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(first.stop).toHaveBeenCalledOnce();
    expect(unexpected.stop).not.toHaveBeenCalled();
    expect(engine.isMicrophoneMonitoringActive()).toBe(false);
  });

  it('allows a new post-stop monitoring request without reviving cancelled callers', async () => {
    const engine = new AudioEngine();
    const first = makeMediaStream(1);
    const second = makeMediaStream(1);
    const { context } = makeContext({ worklet: false });
    let resolveFirstStream: ((value: unknown) => void) | undefined;
    const getUserMedia = vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirstStream = resolve; }))
      .mockResolvedValue(second.stream);
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia },
    });
    vi.spyOn(engine as any, 'ensureContext' as any).mockResolvedValue(context as never);

    const initialStart = engine.startMicrophoneMonitoring();
    const cancelledDuplicate = engine.startMicrophoneMonitoring();
    engine.stopMicrophoneMonitoring();
    const restart = engine.startMicrophoneMonitoring();
    resolveFirstStream?.(first.stream);
    await Promise.all([initialStart, cancelledDuplicate]);
    await restart;

    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(first.stop).toHaveBeenCalledOnce();
    expect(second.stop).not.toHaveBeenCalled();
    expect(engine.isMicrophoneMonitoringActive()).toBe(true);

    engine.stopMicrophoneMonitoring();
    expect(second.stop).toHaveBeenCalledOnce();
  });

  it('cancels a pending recording start instead of activating the stream after stop', async () => {
    const engine = new AudioEngine();
    const { stream, stop } = makeMediaStream(1);
    const { context, createScriptProcessor } = makeContext({ worklet: false });
    let resolveStream: ((value: unknown) => void) | undefined;
    const getUserMedia = vi.fn(() => new Promise((resolve) => { resolveStream = resolve; }));
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia },
    });
    const ensureContext = vi.spyOn(engine as any, 'ensureContext' as any).mockResolvedValue(context as never);

    const pendingStart = engine.startRecording();
    const stopped = await engine.stopRecording();
    resolveStream?.(stream);
    await pendingStart;

    expect(stopped).toBeNull();
    expect(stop).toHaveBeenCalledOnce();
    expect(ensureContext).not.toHaveBeenCalled();
    expect(createScriptProcessor).not.toHaveBeenCalled();
    expect(engine.recordingState).toBe('idle');
  });

  it('does not fall back to ScriptProcessor when a pending worklet start was stopped', async () => {
    const engine = new AudioEngine();
    const { stream, stop } = makeMediaStream(1);
    const { context, createScriptProcessor } = makeContext();
    let rejectWorklet: ((reason?: unknown) => void) | undefined;
    const addModule = vi.fn(() => new Promise<void>((_resolve, reject) => {
      rejectWorklet = reject;
    }));
    context.audioWorklet = { addModule };
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue(stream) },
    });
    vi.spyOn(engine as any, 'ensureContext' as any).mockResolvedValue(context as never);

    const pendingStart = engine.startRecording();
    await vi.waitFor(() => expect(addModule).toHaveBeenCalledOnce());
    const stopped = await engine.stopRecording();
    rejectWorklet?.(new Error('stale worklet failure'));
    await pendingStart;

    expect(stopped).toBeNull();
    expect(stop).toHaveBeenCalledOnce();
    expect(createScriptProcessor).not.toHaveBeenCalled();
    expect(engine.recordingState).toBe('idle');
  });

  it('allows a post-stop restart without reviving callers cancelled before the stop', async () => {
    const engine = new AudioEngine();
    const first = makeMediaStream(1);
    const second = makeMediaStream(1);
    const { context, createScriptProcessor } = makeContext({ worklet: false });
    let resolveFirstStream: ((value: unknown) => void) | undefined;
    const getUserMedia = vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirstStream = resolve; }))
      .mockResolvedValue(second.stream);
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia },
    });
    vi.spyOn(engine as any, 'ensureContext' as any).mockResolvedValue(context as never);

    const initialStart = engine.startRecording();
    const cancelledDuplicate = engine.startRecording();
    expect(await engine.stopRecording()).toBeNull();
    const restart = engine.startRecording();
    resolveFirstStream?.(first.stream);
    await Promise.all([initialStart, cancelledDuplicate]);
    await restart;

    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(createScriptProcessor).toHaveBeenCalledOnce();
    expect(first.stop).toHaveBeenCalledOnce();
    expect(second.stop).not.toHaveBeenCalled();
    expect(engine.recordingState).toBe('recording');

    await engine.stopRecording();
    expect(second.stop).toHaveBeenCalledOnce();
  });

  it('coalesces concurrent starts and ignores reentry without replacing the active fallback session', async () => {
    const engine = new AudioEngine();
    const first = makeMediaStream(1);
    const unexpected = makeMediaStream(1);
    const { context, processor, createScriptProcessor } = makeContext({ worklet: false, meterPairs: 3 });
    let resolveFirstStream: ((value: unknown) => void) | undefined;
    const getUserMedia = vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirstStream = resolve; }))
      .mockResolvedValue(unexpected.stream);
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia },
    });
    vi.spyOn(engine as any, 'ensureContext' as any).mockResolvedValue(context as never);

    const initialStart = engine.startRecording();
    const concurrentStart = engine.startRecording();
    resolveFirstStream?.(first.stream);
    await Promise.all([initialStart, concurrentStart]);
    await engine.startRecording();

    processor.onaudioprocess?.({
      inputBuffer: {
        numberOfChannels: 1,
        length: 2,
        getChannelData: () => new Float32Array([0.1, 0.2]),
      },
    });
    const result = await engine.stopRecording();

    expect(getUserMedia).toHaveBeenCalledOnce();
    expect(createScriptProcessor).toHaveBeenCalledOnce();
    expect(Array.from(result?.[0] ?? [])).toEqual([
      0.10000000149011612,
      0.20000000298023224,
    ]);
    expect(first.stop).toHaveBeenCalledOnce();
    expect(unexpected.stop).not.toHaveBeenCalled();
  });

  it('applies input monitoring to the recording sink without changing capture', async () => {
    const engine = new AudioEngine();
    const { stream } = makeMediaStream(1);
    const { context, sink } = makeContext({ worklet: false });
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue(stream) },
    });
    vi.spyOn(engine as any, 'ensureContext' as any).mockResolvedValue(context as never);

    engine.setMonitoringEnabled(true);
    await engine.startRecording();
    expect(sink.gain.value).toBe(1);
    engine.setMonitoringEnabled(false);
    expect(sink.gain.value).toBe(0);
    expect(engine.recordingState).toBe('recording');
    await engine.stopRecording();
    expect(engine.isMicrophoneMonitoringActive()).toBe(false);
  });

  it('finishes primary PCM cleanup when the optional MediaRecorder backup fails to stop', async () => {
    const engine = new AudioEngine();
    const { stream, stop } = makeMediaStream(1);
    const { context, source, processor } = makeContext({ worklet: false });
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue(stream) },
    });
    vi.spyOn(engine as any, 'ensureContext' as any).mockResolvedValue(context as never);
    vi.stubGlobal('MediaRecorder', class {
      state = 'inactive';
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      constructor(_stream: unknown) {}
      start() { this.state = 'recording'; }
      stop() { throw new Error('backup recorder stop failed'); }
    });
    const onRecordingData = vi.fn();
    engine.setRecordingDataCallback(onRecordingData);

    await engine.startRecording();
    processor.onaudioprocess?.({
      inputBuffer: {
        numberOfChannels: 1,
        length: 2,
        getChannelData: () => new Float32Array([0.125, -0.25]),
      },
    });
    const result = await engine.stopRecording();

    expect(Array.from(result?.[0] ?? [])).toEqual([0.125, -0.25]);
    expect(onRecordingData).toHaveBeenCalledOnce();
    expect(stop).toHaveBeenCalledOnce();
    expect(source.disconnect).toHaveBeenCalledOnce();
    expect(processor.disconnect).toHaveBeenCalledOnce();
    expect(processor.onaudioprocess).toBeNull();
    expect(engine.recordingState).toBe('idle');
  });

  it('continues PCM and microphone cleanup when ScriptProcessor disconnect fails', async () => {
    const engine = new AudioEngine();
    const { stream, stop } = makeMediaStream(1);
    const { context, source, sink, processor } = makeContext({ worklet: false });
    processor.disconnect.mockImplementation(() => { throw new Error('processor disconnect failed'); });
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue(stream) },
    });
    vi.spyOn(engine as any, 'ensureContext' as any).mockResolvedValue(context as never);
    const onRecordingData = vi.fn();
    engine.setRecordingDataCallback(onRecordingData);

    await engine.startRecording();
    processor.onaudioprocess?.({
      inputBuffer: {
        numberOfChannels: 1,
        length: 2,
        getChannelData: () => new Float32Array([0.375, -0.5]),
      },
    });
    const result = await engine.stopRecording();

    expect(Array.from(result?.[0] ?? [])).toEqual([0.375, -0.5]);
    expect(onRecordingData).toHaveBeenCalledOnce();
    expect(processor.onaudioprocess).toBeNull();
    expect(sink.disconnect).toHaveBeenCalledOnce();
    expect(source.disconnect).toHaveBeenCalledOnce();
    expect(stop).toHaveBeenCalledOnce();
    expect(engine.recordingState).toBe('idle');
  });

  it('closes the worklet port and remaining graph when worklet disconnect fails', async () => {
    const engine = new AudioEngine();
    const { stream, stop } = makeMediaStream(1);
    const { context, source, sink } = makeContext();
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
      connect = vi.fn();
      disconnect = vi.fn(() => { throw new Error('worklet disconnect failed'); });
      constructor() {
        nodes.push(this);
        this.port.postMessage.mockImplementation((message: { type: string }) => {
          if (message.type === 'stop') {
            queueMicrotask(() => this.port.onmessage?.({ data: { type: 'stopped' } }));
          }
        });
      }
    }
    vi.stubGlobal('AudioWorkletNode', MockWorkletNode);

    await engine.startRecording();
    nodes[0]!.port.onmessage?.({
      data: {
        type: 'recording',
        audioData: new Float32Array([0.625]),
        numChannels: 1,
      },
    });
    const result = await engine.stopRecording();

    expect(Array.from(result?.[0] ?? [])).toEqual([0.625]);
    expect(nodes[0]!.disconnect).toHaveBeenCalledOnce();
    expect(nodes[0]!.port.close).toHaveBeenCalledOnce();
    expect(nodes[0]!.port.onmessage).toBeNull();
    expect(sink.disconnect).toHaveBeenCalledOnce();
    expect(source.disconnect).toHaveBeenCalledOnce();
    expect(stop).toHaveBeenCalledOnce();
    expect(engine.recordingState).toBe('idle');
  });

  it('releases encoded backup chunks and detaches the recorder callback on stop', async () => {
    class ControllableMediaRecorder {
      static instances: ControllableMediaRecorder[] = [];
      state = 'inactive';
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      constructor(_stream: unknown) { ControllableMediaRecorder.instances.push(this); }
      start() { this.state = 'recording'; }
      stop() { this.state = 'inactive'; }
    }
    vi.stubGlobal('MediaRecorder', ControllableMediaRecorder);
    const engine = new AudioEngine();
    const { stream, stop } = makeMediaStream(1);
    const { context } = makeContext({ worklet: false });
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue(stream) },
    });
    vi.spyOn(engine as any, 'ensureContext' as any).mockResolvedValue(context as never);

    await engine.startRecording();
    const recorder = ControllableMediaRecorder.instances[0]!;
    recorder.ondataavailable?.({ data: new Blob(['encoded-audio']) });
    await engine.stopRecording();

    expect((engine as unknown as { recordingChunks: Blob[] }).recordingChunks).toEqual([]);
    expect(recorder.ondataavailable).toBeNull();
    expect(stop).toHaveBeenCalledOnce();
    expect(engine.recordingState).toBe('idle');
  });

  it('keeps a previous recorder final event out of a restarted session', async () => {
    class ControllableMediaRecorder {
      static instances: ControllableMediaRecorder[] = [];
      state = 'inactive';
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      constructor(_stream: unknown) { ControllableMediaRecorder.instances.push(this); }
      start() { this.state = 'recording'; }
      stop() { this.state = 'inactive'; }
    }
    vi.stubGlobal('MediaRecorder', ControllableMediaRecorder);
    const engine = new AudioEngine();
    const first = makeMediaStream(1);
    const second = makeMediaStream(1);
    const { context } = makeContext({ worklet: false, meterPairs: 2 });
    const getUserMedia = vi.fn()
      .mockResolvedValueOnce(first.stream)
      .mockResolvedValueOnce(second.stream);
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia },
    });
    vi.spyOn(engine as any, 'ensureContext' as any).mockResolvedValue(context as never);

    await engine.startRecording();
    const firstRecorder = ControllableMediaRecorder.instances[0]!;
    await engine.stopRecording();
    await engine.startRecording();
    const secondRecorder = ControllableMediaRecorder.instances[1]!;
    const oldBlob = new Blob(['old-session']);
    const newBlob = new Blob(['new-session']);

    // MediaRecorder dispatches its final dataavailable event asynchronously
    // after stop(). It must not append to the replacement session's backup.
    firstRecorder.ondataavailable?.({ data: oldBlob });
    secondRecorder.ondataavailable?.({ data: newBlob });

    expect((engine as unknown as { recordingChunks: Blob[] }).recordingChunks).toEqual([newBlob]);
    expect(ControllableMediaRecorder.instances).toHaveLength(2);
    await engine.stopRecording();
    expect(first.stop).toHaveBeenCalledOnce();
    expect(second.stop).toHaveBeenCalledOnce();
  });
});
