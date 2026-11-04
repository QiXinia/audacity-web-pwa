// EXPORTS: wasmProcessor, WasmModule, isWasmAvailable, initWasm

import { logger } from '@/lib/logger';
import { timeStretchChannelsJs } from '@/engine/timeStretch';

// JS fallback implementations (always available)
const JS_IMPL = {
  applyGain(buffer: Float32Array, gainLinear: number): void {
    for (let i = 0; i < buffer.length; i++) {
      buffer[i] *= gainLinear;
    }
  },

  applyFadeIn(buffer: Float32Array, durationSamples: number): void {
    const n = Math.min(durationSamples, buffer.length);
    if (n === 0) return;
    const step = 1 / n;
    for (let i = 0; i < n; i++) {
      buffer[i] *= i * step;
    }
  },

  applyFadeOut(buffer: Float32Array, durationSamples: number): void {
    const n = Math.min(durationSamples, buffer.length);
    if (n === 0) return;
    const step = 1 / n;
    const start = buffer.length - n;
    for (let i = 0; i < n; i++) {
      buffer[start + i] *= (n - i) * step;
    }
  },

  normalize(buffer: Float32Array, targetDb: number): number {
    let peak = 0;
    for (let i = 0; i < buffer.length; i++) {
      const abs = Math.abs(buffer[i]);
      if (abs > peak) peak = abs;
    }
    if (peak === 0) return 1;
    const targetLinear = Math.pow(10, targetDb / 20);
    const gain = targetLinear / peak;
    for (let i = 0; i < buffer.length; i++) {
      buffer[i] *= gain;
    }
    return gain;
  },

  removeDcOffset(buffer: Float32Array): number {
    if (buffer.length === 0) return 0;
    let sum = 0;
    for (let i = 0; i < buffer.length; i++) {
      sum += buffer[i];
    }
    const dc = sum / buffer.length;
    for (let i = 0; i < buffer.length; i++) {
      buffer[i] -= dc;
    }
    return dc;
  },

  reverse(buffer: Float32Array): void {
    buffer.reverse();
  },

  invertPhase(buffer: Float32Array): void {
    for (let i = 0; i < buffer.length; i++) {
      buffer[i] = -buffer[i];
    }
  },

  computeRms(buffer: Float32Array): number {
    if (buffer.length === 0) return 0;
    let sumSq = 0;
    for (let i = 0; i < buffer.length; i++) {
      sumSq += buffer[i] * buffer[i];
    }
    return Math.sqrt(sumSq / buffer.length);
  },

  computePeak(buffer: Float32Array): number {
    let peak = 0;
    for (let i = 0; i < buffer.length; i++) {
      const abs = Math.abs(buffer[i]);
      if (abs > peak) peak = abs;
    }
    return peak;
  },

  fftMagnitude(input: Float32Array): Float32Array {
    const n = input.length;
    if (n === 0) return new Float32Array();

    // Round up to power of 2
    let size = 1;
    while (size < n) size <<= 1;

    const real = new Float32Array(size);
    const imag = new Float32Array(size);
    real.set(input.subarray(0, Math.min(n, size)));

    // Bit-reversal permutation
    let j = 0;
    for (let i = 1; i < size; i++) {
      let bit = size >> 1;
      while (j >= bit) {
        j -= bit;
        bit >>= 1;
      }
      j += bit;
      if (i < j) {
        [real[i], real[j]] = [real[j], real[i]];
        [imag[i], imag[j]] = [imag[j], imag[i]];
      }
    }

    // FFT
    let len = 2;
    while (len <= size) {
      const half = len >> 1;
      const angle = (Math.PI * 2) / len;
      const wR = Math.cos(angle);
      const wI = -Math.sin(angle);

      for (let i = 0; i < size; i += len) {
        let wr = 1;
        let wi = 0;
        for (let k = 0; k < half; k++) {
          const tr = real[i + k + half] * wr - imag[i + k + half] * wi;
          const ti = real[i + k + half] * wi + imag[i + k + half] * wr;
          real[i + k + half] = real[i + k] - tr;
          imag[i + k + half] = imag[i + k] - ti;
          real[i + k] += tr;
          imag[i + k] += ti;
          const newWr = wr * wR - wi * wI;
          wi = wr * wI + wi * wR;
          wr = newWr;
        }
      }
      len <<= 1;
    }

    const outLen = size / 2 + 1;
    const result = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) {
      result[i] = Math.sqrt(real[i] * real[i] + imag[i] * imag[i]);
    }
    return result;
  },

  spectrogram(
    input: Float32Array,
    windowSize: number,
    hopSize: number,
  ): Float32Array {
    if (hopSize === 0 || windowSize === 0 || input.length === 0) {
      return new Float32Array();
    }
    const numFrames =
      input.length <= windowSize
        ? 1
        : Math.floor((input.length - windowSize) / hopSize) + 1;
    const specLen = Math.floor(windowSize / 2) + 1;
    const result = new Float32Array(numFrames * specLen);

    // Hann window
    const window = new Float32Array(windowSize);
    for (let i = 0; i < windowSize; i++) {
      const t = i / (windowSize - 1);
      window[i] = 0.5 * (1 - Math.cos(2 * Math.PI * t));
    }

    const frame = new Float32Array(windowSize);
    for (let f = 0; f < numFrames; f++) {
      const start = f * hopSize;
      const end = Math.min(start + windowSize, input.length);
      const actualLen = end - start;

      for (let i = 0; i < actualLen; i++) {
        frame[i] = input[start + i] * window[i];
      }
      frame.fill(0, actualLen);

      const mag = this.fftMagnitude(frame);
      result.set(mag, f * specLen);
    }
    return result;
  },

  applyCompressor(
    buffer: Float32Array,
    thresholdDb: number,
    ratio: number,
    attackMs: number,
    releaseMs: number,
    sampleRate: number,
  ): void {
    if (buffer.length === 0 || ratio <= 1) return;

    const thresholdLin = Math.pow(10, thresholdDb / 20);
    const attackCoeff =
      attackMs > 0 ? Math.exp(-1 / (sampleRate * (attackMs / 1000))) : 0;
    const releaseCoeff =
      releaseMs > 0 ? Math.exp(-1 / (sampleRate * (releaseMs / 1000))) : 0;

    let envelope = 0;
    for (let i = 0; i < buffer.length; i++) {
      const inputAbs = Math.abs(buffer[i]);
      const coeff = inputAbs > envelope ? attackCoeff : releaseCoeff;
      envelope = coeff * envelope + (1 - coeff) * inputAbs;

      if (envelope > thresholdLin) {
        const inputDb = 20 * Math.log10(envelope);
        const excess = inputDb - thresholdDb;
        const outputDb = thresholdDb + excess / ratio;
        const gainReductionDb = outputDb - inputDb;
        const gain = Math.pow(10, gainReductionDb / 20);
        buffer[i] *= gain;
      }
    }
  },

  concatBuffers(a: Float32Array, b: Float32Array): Float32Array {
    const result = new Float32Array(a.length + b.length);
    result.set(a, 0);
    result.set(b, a.length);
    return result;
  },

  sliceBuffer(buffer: Float32Array, start: number, end: number): Float32Array {
    const s = Math.max(0, Math.min(start, buffer.length));
    const e = Math.max(s, Math.min(end, buffer.length));
    return buffer.slice(s, e);
  },

  mixBuffers(a: Float32Array, b: Float32Array): Float32Array {
    const len = Math.max(a.length, b.length);
    const result = new Float32Array(len);
    for (let i = 0; i < a.length; i++) result[i] += a[i];
    for (let i = 0; i < b.length; i++) result[i] += b[i];
    return result;
  },

  // WAV encode/decode via pure JS
  encodeWavPcm16(samples: Float32Array, numChannels: number, sampleRate: number): Uint8Array {
    const numSamples = samples.length;
    const bytesPerSample = 2;
    const dataSize = numSamples * bytesPerSample;
    const fileSize = 44 + dataSize;

    const buffer = new ArrayBuffer(fileSize);
    const view = new DataView(buffer);
    let offset = 0;

    // RIFF
    writeString(view, offset, 'RIFF'); offset += 4;
    view.setUint32(offset, fileSize - 8, true); offset += 4;
    writeString(view, offset, 'WAVE'); offset += 4;

    // fmt
    writeString(view, offset, 'fmt '); offset += 4;
    view.setUint32(offset, 16, true); offset += 4;
    view.setUint16(offset, 1, true); offset += 2; // PCM
    view.setUint16(offset, numChannels, true); offset += 2;
    view.setUint32(offset, sampleRate, true); offset += 4;
    view.setUint32(offset, sampleRate * numChannels * bytesPerSample, true); offset += 4;
    view.setUint16(offset, numChannels * bytesPerSample, true); offset += 2;
    view.setUint16(offset, 16, true); offset += 2;

    // data
    writeString(view, offset, 'data'); offset += 4;
    view.setUint32(offset, dataSize, true); offset += 4;

    for (let i = 0; i < numSamples; i++) {
      const clamped = Math.max(-1, Math.min(1, samples[i]));
      const intVal = Math.round(clamped * 32767);
      view.setInt16(offset, intVal, true);
      offset += 2;
    }

    return new Uint8Array(buffer);
  },

  encodeWavFloat32(samples: Float32Array, numChannels: number, sampleRate: number): Uint8Array {
    const numSamples = samples.length;
    const bytesPerSample = 4;
    const dataSize = numSamples * bytesPerSample;
    const fileSize = 44 + dataSize;

    const buffer = new ArrayBuffer(fileSize);
    const view = new DataView(buffer);
    let offset = 0;

    writeString(view, offset, 'RIFF'); offset += 4;
    view.setUint32(offset, fileSize - 8, true); offset += 4;
    writeString(view, offset, 'WAVE'); offset += 4;

    writeString(view, offset, 'fmt '); offset += 4;
    view.setUint32(offset, 16, true); offset += 4;
    view.setUint16(offset, 3, true); offset += 2; // float
    view.setUint16(offset, numChannels, true); offset += 2;
    view.setUint32(offset, sampleRate, true); offset += 4;
    view.setUint32(offset, sampleRate * numChannels * bytesPerSample, true); offset += 4;
    view.setUint16(offset, numChannels * bytesPerSample, true); offset += 2;
    view.setUint16(offset, 32, true); offset += 2;

    writeString(view, offset, 'data'); offset += 4;
    view.setUint32(offset, dataSize, true); offset += 4;

    for (let i = 0; i < numSamples; i++) {
      view.setFloat32(offset, samples[i], true);
      offset += 4;
    }

    return new Uint8Array(buffer);
  },

  decodeWav(data: Uint8Array): { samples: Float32Array; numChannels: number; sampleRate: number } | null {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let offset = 0;

    // RIFF header
    if (readString(view, offset, 4) !== 'RIFF') return null;
    offset += 4;
    // file size (skip)
    offset += 4;
    if (readString(view, offset, 4) !== 'WAVE') return null;
    offset += 4;

    let numChannels = 0;
    let sampleRate = 0;
    let audioFormat = 0;
    let bitsPerSample = 0;
    let dataOffset = 0;
    let dataSize = 0;

    // Parse chunks
    while (offset < data.byteLength - 8) {
      const chunkId = readString(view, offset, 4);
      offset += 4;
      const chunkSize = view.getUint32(offset, true);
      offset += 4;

      if (chunkId === 'fmt ') {
        audioFormat = view.getUint16(offset, true);
        numChannels = view.getUint16(offset + 2, true);
        sampleRate = view.getUint32(offset + 4, true);
        bitsPerSample = view.getUint16(offset + 14, true);
      } else if (chunkId === 'data') {
        dataOffset = offset;
        dataSize = chunkSize;
        break;
      }

      // Move to next chunk (chunk sizes with padding are even)
      offset += chunkSize + (chunkSize % 2);
    }

    if (numChannels === 0 || sampleRate === 0 || dataSize === 0) return null;

    const bytesPerSample = bitsPerSample / 8;
    const totalSamples = dataSize / bytesPerSample;
    const samples = new Float32Array(totalSamples);

    if (audioFormat === 1) {
      // PCM integer
      if (bitsPerSample === 16) {
        for (let i = 0; i < totalSamples; i++) {
          samples[i] = view.getInt16(dataOffset + i * 2, true) / 32768;
        }
      } else if (bitsPerSample === 24) {
        for (let i = 0; i < totalSamples; i++) {
          const b0 = view.getUint8(dataOffset + i * 3);
          const b1 = view.getUint8(dataOffset + i * 3 + 1);
          const b2 = view.getInt8(dataOffset + i * 3 + 2);
          samples[i] = (b2 * 65536 + b1 * 256 + b0) / 8388608;
        }
      } else if (bitsPerSample === 8) {
        for (let i = 0; i < totalSamples; i++) {
          samples[i] = (view.getUint8(dataOffset + i) - 128) / 128;
        }
      } else {
        return null;
      }
    } else if (audioFormat === 3 && bitsPerSample === 32) {
      // IEEE Float
      for (let i = 0; i < totalSamples; i++) {
        samples[i] = view.getFloat32(dataOffset + i * 4, true);
      }
    } else {
      return null;
    }

    return { samples, numChannels, sampleRate };
  },
};

function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

function readString(view: DataView, offset: number, length: number): string {
  let str = '';
  for (let i = 0; i < length; i++) {
    str += String.fromCharCode(view.getUint8(offset + i));
  }
  return str;
}

export interface WasmModule {
  apply_gain(buffer: Float32Array, gainLinear: number): void;
  apply_fade_in(buffer: Float32Array, durationSamples: number): void;
  apply_fade_out(buffer: Float32Array, durationSamples: number): void;
  normalize(buffer: Float32Array, targetDb: number): number;
  remove_dc_offset(buffer: Float32Array): number;
  reverse(buffer: Float32Array): void;
  invert_phase(buffer: Float32Array): void;
  compute_rms(buffer: Float32Array): number;
  compute_peak(buffer: Float32Array): number;
  fft_magnitude(input: Float32Array): Float32Array;
  spectrogram(input: Float32Array, windowSize: number, hopSize: number): Float32Array;
  apply_compressor(
    buffer: Float32Array,
    thresholdDb: number,
    ratio: number,
    attackMs: number,
    releaseMs: number,
    sampleRate: number,
  ): void;
  concat_buffers(a: Float32Array, b: Float32Array): Float32Array;
  slice_buffer(buffer: Float32Array, start: number, end: number): Float32Array;
  mix_buffers(a: Float32Array, b: Float32Array): Float32Array;
  time_stretch(input: Float32Array, channelCount: number, speed: number, sampleRate: number): Float32Array;
  encode_wav_pcm16(samples: Float32Array, numChannels: number, sampleRate: number): Uint8Array;
  encode_wav_float32(samples: Float32Array, numChannels: number, sampleRate: number): Uint8Array;
  decode_wav(data: Uint8Array): {
    samples: Float32Array;
    num_channels: number;
    sample_rate: number;
    free: () => void;
  } | null;
}

type WasmBindgenModule = WasmModule & {
  default: (input?: {
    module_or_path?: string | URL | Request | Response | BufferSource | WebAssembly.Module;
  }) => Promise<unknown>;
};

let wasmModule: WasmModule | null = null;
let initPromise: Promise<void> | null = null;
let _isAvailable = false;

export function isWasmAvailable(): boolean {
  return _isAvailable;
}

async function tryLoadWasm(): Promise<boolean> {
  try {
    // Check if WASM is supported
    if (typeof WebAssembly === 'undefined') {
      return false;
    }

    // Load the wasm-bindgen JavaScript glue generated by wasm-pack. Instantiating
    // the raw binary directly would miss the glue's imports and typed-array shims.
    try {
      const baseUrl = (import.meta.env.BASE_URL || '/').replace(/\/?$/, '/');
      const moduleUrl = `${baseUrl}wasm/audio_processor.js`;
      const wasmUrl = `${baseUrl}wasm/audio_processor_bg.wasm`;
      const module = (await import(/* @vite-ignore */ moduleUrl)) as WasmBindgenModule;
      await module.default({ module_or_path: wasmUrl });
      wasmModule = module;
      return true;
    } catch (error) {
      logger.warn('WASM module unavailable, using JS fallback:', String(error));
    }

    return false;
  } catch (e) {
    logger.warn('WASM load failed, using JS fallback:', String(e));
    return false;
  }
}

export async function initWasm(): Promise<void> {
  if (initPromise) return initPromise;

  initPromise = (async () => {
    _isAvailable = await tryLoadWasm();
    if (_isAvailable) {
      logger.info('WASM audio processor loaded successfully');
    } else {
      logger.info('WASM not available, using JS audio processor fallback');
    }
  })();

  return initPromise;
}

// Unified processor interface - uses WASM when available, JS otherwise
export const wasmProcessor = {
  applyGain(buffer: Float32Array, gainLinear: number): void {
    if (wasmModule && _isAvailable) {
      wasmModule.apply_gain(buffer, gainLinear);
    } else {
      JS_IMPL.applyGain(buffer, gainLinear);
    }
  },

  applyFadeIn(buffer: Float32Array, durationSamples: number): void {
    if (wasmModule && _isAvailable) {
      wasmModule.apply_fade_in(buffer, durationSamples);
    } else {
      JS_IMPL.applyFadeIn(buffer, durationSamples);
    }
  },

  applyFadeOut(buffer: Float32Array, durationSamples: number): void {
    if (wasmModule && _isAvailable) {
      wasmModule.apply_fade_out(buffer, durationSamples);
    } else {
      JS_IMPL.applyFadeOut(buffer, durationSamples);
    }
  },

  normalize(buffer: Float32Array, targetDb: number): number {
    if (wasmModule && _isAvailable) {
      return wasmModule.normalize(buffer, targetDb);
    }
    return JS_IMPL.normalize(buffer, targetDb);
  },

  removeDcOffset(buffer: Float32Array): number {
    if (wasmModule && _isAvailable) {
      return wasmModule.remove_dc_offset(buffer);
    }
    return JS_IMPL.removeDcOffset(buffer);
  },

  reverse(buffer: Float32Array): void {
    if (wasmModule && _isAvailable) {
      wasmModule.reverse(buffer);
    } else {
      JS_IMPL.reverse(buffer);
    }
  },

  invertPhase(buffer: Float32Array): void {
    if (wasmModule && _isAvailable) {
      wasmModule.invert_phase(buffer);
    } else {
      JS_IMPL.invertPhase(buffer);
    }
  },

  computeRms(buffer: Float32Array): number {
    if (wasmModule && _isAvailable) {
      return wasmModule.compute_rms(buffer);
    }
    return JS_IMPL.computeRms(buffer);
  },

  computePeak(buffer: Float32Array): number {
    if (wasmModule && _isAvailable) {
      return wasmModule.compute_peak(buffer);
    }
    return JS_IMPL.computePeak(buffer);
  },

  fftMagnitude(input: Float32Array): Float32Array {
    if (wasmModule && _isAvailable) {
      return wasmModule.fft_magnitude(input);
    }
    return JS_IMPL.fftMagnitude(input);
  },

  spectrogram(input: Float32Array, windowSize: number, hopSize: number): Float32Array {
    if (wasmModule && _isAvailable) {
      return wasmModule.spectrogram(input, windowSize, hopSize);
    }
    return JS_IMPL.spectrogram(input, windowSize, hopSize);
  },

  applyCompressor(
    buffer: Float32Array,
    thresholdDb: number,
    ratio: number,
    attackMs: number,
    releaseMs: number,
    sampleRate: number,
  ): void {
    if (wasmModule && _isAvailable) {
      wasmModule.apply_compressor(buffer, thresholdDb, ratio, attackMs, releaseMs, sampleRate);
    } else {
      JS_IMPL.applyCompressor(buffer, thresholdDb, ratio, attackMs, releaseMs, sampleRate);
    }
  },

  concatBuffers(a: Float32Array, b: Float32Array): Float32Array {
    if (wasmModule && _isAvailable) {
      return wasmModule.concat_buffers(a, b);
    }
    return JS_IMPL.concatBuffers(a, b);
  },

  sliceBuffer(buffer: Float32Array, start: number, end: number): Float32Array {
    if (wasmModule && _isAvailable) {
      return wasmModule.slice_buffer(buffer, start, end);
    }
    return JS_IMPL.sliceBuffer(buffer, start, end);
  },

  mixBuffers(a: Float32Array, b: Float32Array): Float32Array {
    if (wasmModule && _isAvailable) {
      return wasmModule.mix_buffers(a, b);
    }
    return JS_IMPL.mixBuffers(a, b);
  },

  timeStretch(channels: Float32Array[], speed: number, sampleRate: number): Float32Array[] {
    if (channels.length === 0) return [];
    if (Math.abs(speed - 1) < 0.000001) return channels.map((channel) => channel.slice());
    if (!wasmModule || !_isAvailable) return timeStretchChannelsJs(channels, speed, sampleRate);

    const frames = channels[0].length;
    if (channels.some((channel) => channel.length !== frames)) {
      throw new Error('Audio channels must have equal lengths');
    }
    const planar = new Float32Array(frames * channels.length);
    for (let channel = 0; channel < channels.length; channel++) {
      planar.set(channels[channel], channel * frames);
    }
    const result = wasmModule.time_stretch(planar, channels.length, speed, sampleRate);
    const outputFrames = Math.floor(result.length / channels.length);
    return channels.map((_, channel) =>
      result.slice(channel * outputFrames, (channel + 1) * outputFrames),
    );
  },

  encodeWavPcm16(samples: Float32Array, numChannels: number, sampleRate: number): Uint8Array {
    if (wasmModule && _isAvailable) {
      return wasmModule.encode_wav_pcm16(samples, numChannels, sampleRate);
    }
    return JS_IMPL.encodeWavPcm16(samples, numChannels, sampleRate);
  },

  encodeWavFloat32(samples: Float32Array, numChannels: number, sampleRate: number): Uint8Array {
    if (wasmModule && _isAvailable) {
      return wasmModule.encode_wav_float32(samples, numChannels, sampleRate);
    }
    return JS_IMPL.encodeWavFloat32(samples, numChannels, sampleRate);
  },

  decodeWav(data: Uint8Array): { samples: Float32Array; numChannels: number; sampleRate: number } | null {
    if (wasmModule && _isAvailable) {
      const result = wasmModule.decode_wav(data);
      if (result) {
        const decoded = {
          samples: result.samples,
          numChannels: result.num_channels,
          sampleRate: result.sample_rate,
        };
        result.free();
        return decoded;
      }
      return null;
    }
    return JS_IMPL.decodeWav(data);
  },
};

// Auto-initialize WASM in the background when module is imported
// First call will use JS fallback; subsequent calls may use WASM once loaded
initWasm().catch(() => {
  // Silent fail - JS fallback is always available
});
