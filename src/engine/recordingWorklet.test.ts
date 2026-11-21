import workletSource from '../../public/worklets/recording-processor.js?raw';

type WorkletMessage = {
  type: string;
  audioData?: Float32Array;
  numChannels?: number;
  sampleRate?: number;
  stereo?: boolean;
};

type Processor = {
  port: {
    onmessage: ((event: { data: WorkletMessage }) => void) | null;
  };
  process: (inputs: Float32Array[][], outputs: unknown[], parameters: object) => boolean;
};

function loadRecordingProcessor() {
  const messages: WorkletMessage[] = [];
  const port = {
    onmessage: null as ((event: { data: WorkletMessage }) => void) | null,
    postMessage: (message: WorkletMessage) => messages.push(message),
  };
  let ProcessorClass: (new () => Processor) | undefined;
  class MockAudioWorkletProcessor {
    port = port;
  }
  const registerProcessor = (_name: string, processor: new () => Processor) => {
    ProcessorClass = processor;
  };
  const executeWorklet = new Function(
    'AudioWorkletProcessor',
    'registerProcessor',
    'sampleRate',
    workletSource,
  ) as (
    base: typeof MockAudioWorkletProcessor,
    register: typeof registerProcessor,
    rate: number,
  ) => void;
  executeWorklet(MockAudioWorkletProcessor, registerProcessor, 48000);
  if (!ProcessorClass) throw new Error('recording-processor was not registered');
  return { processor: new ProcessorClass(), messages, port };
}

describe('recording AudioWorklet', () => {
  it('flushes an arbitrary stereo tail before acknowledging stop', () => {
    const { processor, messages, port } = loadRecordingProcessor();
    const left = new Float32Array([0.1, 0.2, 0.3]);
    const right = new Float32Array([0.9, 0.8, 0.7]);

    expect(processor.process([[left, right]], [], {})).toBe(true);
    expect(messages).toHaveLength(0);
    port.onmessage?.({ data: { type: 'stop' } });

    expect(messages.map((message) => message.type)).toEqual(['recording', 'stopped']);
    expect(messages[0].numChannels).toBe(2);
    expect(messages[0].sampleRate).toBe(48000);
    expect(Array.from(messages[0].audioData ?? [])).toEqual([
      0.10000000149011612,
      0.8999999761581421,
      0.20000000298023224,
      0.800000011920929,
      0.30000001192092896,
      0.699999988079071,
    ]);
    expect(processor.process([[left, right]], [], {})).toBe(false);
  });

  it('does not duplicate a full buffer when stop follows an automatic flush', () => {
    const { processor, messages, port } = loadRecordingProcessor();
    const mono = new Float32Array(4096).fill(0.25);

    processor.process([[mono]], [], {});
    expect(messages.map((message) => message.type)).toEqual(['recording']);
    port.onmessage?.({ data: { type: 'stop' } });

    expect(messages.map((message) => message.type)).toEqual(['recording', 'stopped']);
    expect(messages[0].audioData).toHaveLength(4096);
  });

  it('duplicates mono blocks without changing stereo interleaving', () => {
    const { processor, messages, port } = loadRecordingProcessor();
    port.onmessage?.({ data: { type: 'init', stereo: true } });

    expect(processor.process([[
      new Float32Array([0.1, 0.2]),
      new Float32Array([0.9, 0.8]),
    ]], [], {})).toBe(true);
    expect(processor.process([[new Float32Array([0.3, 0.4])]], [], {})).toBe(true);
    port.onmessage?.({ data: { type: 'stop' } });

    expect(messages.map((message) => message.type)).toEqual(['recording', 'stopped']);
    expect(messages[0].numChannels).toBe(2);
    expect(Array.from(messages[0].audioData ?? [])).toEqual([
      0.10000000149011612,
      0.8999999761581421,
      0.20000000298023224,
      0.800000011920929,
      0.30000001192092896,
      0.30000001192092896,
      0.4000000059604645,
      0.4000000059604645,
    ]);
  });

  it('mixes stereo blocks to mono when mono recording is configured', () => {
    const { processor, messages, port } = loadRecordingProcessor();
    port.onmessage?.({ data: { type: 'init', stereo: false } });

    expect(processor.process([[
      new Float32Array([1, 0.25]),
      new Float32Array([0.5, 0.75]),
    ]], [], {})).toBe(true);
    port.onmessage?.({ data: { type: 'stop' } });

    expect(messages.map((message) => message.type)).toEqual(['recording', 'stopped']);
    expect(messages[0].numChannels).toBe(1);
    expect(Array.from(messages[0].audioData ?? [])).toEqual([0.75, 0.5]);
  });
});
