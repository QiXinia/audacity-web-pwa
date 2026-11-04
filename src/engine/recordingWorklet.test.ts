import workletSource from '../../public/worklets/recording-processor.js?raw';

type WorkletMessage = {
  type: string;
  audioData?: Float32Array;
  numChannels?: number;
  sampleRate?: number;
};

type Processor = {
  port: {
    onmessage: ((event: { data: { type: string } }) => void) | null;
  };
  process: (inputs: Float32Array[][], outputs: unknown[], parameters: object) => boolean;
};

function loadRecordingProcessor() {
  const messages: WorkletMessage[] = [];
  const port = {
    onmessage: null as ((event: { data: { type: string } }) => void) | null,
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
});
