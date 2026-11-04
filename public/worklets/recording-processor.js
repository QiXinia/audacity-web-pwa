class RecordingProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.pending = [];
    this.pendingLength = 0;
    this.stopping = false;
    this.port.onmessage = (event) => {
      if (event.data?.type === 'stop') {
        this.stopping = true;
        this.flush();
        this.port.postMessage({ type: 'stopped' });
      }
    };
  }

  flush() {
    if (this.pendingLength === 0) return;
    const audioData = new Float32Array(this.pendingLength);
    let offset = 0;
    for (const chunk of this.pending) {
      audioData.set(chunk, offset);
      offset += chunk.length;
    }
    this.pending = [];
    this.pendingLength = 0;
    this.port.postMessage({
      type: 'recording',
      audioData,
      numChannels: this.numChannels,
      sampleRate,
    });
  }

  process(inputs) {
    if (this.stopping) return false;
    const input = inputs[0];
    if (!input || input.length === 0 || !input[0] || input[0].length === 0) return true;

    this.numChannels = input.length;
    const length = input[0].length;
    const chunk = new Float32Array(length * this.numChannels);
    for (let i = 0; i < length; i++) {
      for (let channel = 0; channel < this.numChannels; channel++) {
        chunk[i * this.numChannels + channel] = input[channel]?.[i] ?? input[0][i];
      }
    }
    this.pending.push(chunk);
    this.pendingLength += chunk.length;
    if (this.pendingLength >= 4096 * this.numChannels) this.flush();
    return true;
  }
}

registerProcessor('recording-processor', RecordingProcessor);
