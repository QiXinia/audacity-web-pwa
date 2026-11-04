/*
 * AudioWorklet 录音处理器
 * 将麦克风输入数据按块收集，通过 message 端口发回主线程
 */
class RecordingProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._bufferSize = 4096;
    this._bufferL = new Float32Array(this._bufferSize);
    this._bufferR = new Float32Array(this._bufferSize);
    this._bufferIndex = 0;
    this._isStereo = false;

    this.port.onmessage = (event) => {
      if (event.data && event.data.type === 'init') {
        this._isStereo = event.data.stereo || false;
      }
      if (event.data && event.data.type === 'clear') {
        this._bufferIndex = 0;
      }
    };
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;

    const channelCount = input.length;
    const blockSize = input[0].length;

    for (let i = 0; i < blockSize; i++) {
      if (this._bufferIndex >= this._bufferSize) {
        const payload = {
          type: 'data',
          left: new Float32Array(this._bufferL),
        };
        if (this._isStereo && channelCount >= 2) {
          payload.right = new Float32Array(this._bufferR);
        }
        const transfer = [payload.left.buffer];
        if (payload.right) transfer.push(payload.right.buffer);
        this.port.postMessage(payload, transfer);

        this._bufferL = new Float32Array(this._bufferSize);
        this._bufferR = new Float32Array(this._bufferSize);
        this._bufferIndex = 0;
      }

      this._bufferL[this._bufferIndex] = input[0][i];
      if (this._isStereo && channelCount >= 2) {
        this._bufferR[this._bufferIndex] = input[1][i];
      }
      this._bufferIndex++;
    }

    if (outputs[0] && outputs[0][0]) {
      outputs[0][0].set(input[0]);
      if (outputs[0][1] && input[1]) {
        outputs[0][1].set(input[1]);
      }
    }

    return true;
  }
}

registerProcessor('recording-processor', RecordingProcessor);
