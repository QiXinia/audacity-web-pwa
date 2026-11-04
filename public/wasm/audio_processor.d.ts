/* tslint:disable */
/* eslint-disable */

/**
 * Decode a WAV file into f32 samples.
 * Returns interleaved f32 samples.
 * Sets num_channels and sample_rate via JS side by reading returned metadata.
 * On error returns empty vec.
 */
export class WavDecodeResult {
    free(): void;
    [Symbol.dispose](): void;
    constructor(samples: Float32Array | number[], num_channels: number, sample_rate: number);
    num_channels: number;
    sample_rate: number;
    get samples(): Float32Array;
    set samples(value: Float32Array | number[]);
}

/**
 * Apply a simple hard knee compressor to a mono buffer.
 * threshold_db: threshold in dB
 * ratio: compression ratio (e.g. 4.0 for 4:1)
 * attack_ms: attack time in ms
 * release_ms: release time in ms
 * sample_rate: sample rate in Hz
 */
export function apply_compressor(buffer: Float32Array, threshold_db: number, ratio: number, attack_ms: number, release_ms: number, sample_rate: number): void;

/**
 * Apply fade in to the beginning of a buffer.
 * duration_samples: number of samples over which to fade
 */
export function apply_fade_in(buffer: Float32Array, duration_samples: number): void;

/**
 * Apply fade out to the end of a buffer.
 * duration_samples: number of samples over which to fade
 */
export function apply_fade_out(buffer: Float32Array, duration_samples: number): void;

/**
 * Apply gain to a mono audio buffer.
 * gain_linear: linear gain multiplier (use db_to_linear helper on JS side)
 */
export function apply_gain(buffer: Float32Array, gain_linear: number): void;

/**
 * Compute peak amplitude of a buffer.
 */
export function compute_peak(buffer: Float32Array | number[]): number;

/**
 * Compute RMS level of a buffer.
 * Returns RMS value as linear amplitude.
 */
export function compute_rms(buffer: Float32Array | number[]): number;

/**
 * Concatenate two audio buffers (mono).
 */
export function concat_buffers(a: Float32Array | number[], b: Float32Array | number[]): Float32Array;

/**
 * Decode WAV bytes.
 */
export function decode_wav(data: Uint8Array | number[]): WavDecodeResult | undefined;

/**
 * Encode audio to 32-bit float WAV.
 */
export function encode_wav_float32(samples: Float32Array | number[], num_channels: number, sample_rate: number): Uint8Array;

/**
 * Encode a mono or interleaved stereo audio buffer to WAV format (PCM 16-bit).
 * samples: interleaved samples for multi-channel
 * num_channels: 1 = mono, 2 = stereo
 * sample_rate: sample rate in Hz
 * Returns WAV file bytes.
 */
export function encode_wav_pcm16(samples: Float32Array | number[], num_channels: number, sample_rate: number): Uint8Array;

/**
 * Simple FFT implementation (Cooley-Tukey, power-of-two).
 * input: real-valued input samples
 * output: magnitude spectrum (half length + 1), each value is magnitude
 */
export function fft_magnitude(input: Float32Array | number[]): Float32Array;

/**
 * Invert the phase of the audio buffer in place.
 */
export function invert_phase(buffer: Float32Array): void;

/**
 * Mix two mono buffers with equal gain.
 */
export function mix_buffers(a: Float32Array | number[], b: Float32Array | number[]): Float32Array;

/**
 * Normalize audio to a target peak level.
 * target_db: target peak in dB (e.g. -1.0 for -1dB headroom)
 * Returns the applied gain in linear units.
 */
export function normalize(buffer: Float32Array, target_db: number): number;

/**
 * Remove DC offset from audio buffer.
 */
export function remove_dc_offset(buffer: Float32Array): number;

/**
 * Reverse the audio buffer in place.
 */
export function reverse(buffer: Float32Array): void;

/**
 * Slice a mono buffer from start to end sample index.
 */
export function slice_buffer(buffer: Float32Array | number[], start: number, end: number): Float32Array;

/**
 * Generate spectrogram data from a buffer.
 * window_size: FFT window size (must be power of 2)
 * hop_size: step between windows in samples
 * Returns flat vector of magnitude values, row-major: [num_frames * (window_size/2 + 1)]
 */
export function spectrogram(input: Float32Array | number[], window_size: number, hop_size: number): Float32Array;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_get_wavdecoderesult_num_channels: (a: number) => number;
    readonly __wbg_get_wavdecoderesult_sample_rate: (a: number) => number;
    readonly __wbg_get_wavdecoderesult_samples: (a: number) => [number, number];
    readonly __wbg_set_wavdecoderesult_num_channels: (a: number, b: number) => void;
    readonly __wbg_set_wavdecoderesult_sample_rate: (a: number, b: number) => void;
    readonly __wbg_set_wavdecoderesult_samples: (a: number, b: number, c: number) => void;
    readonly __wbg_wavdecoderesult_free: (a: number, b: number) => void;
    readonly apply_compressor: (a: number, b: number, c: any, d: number, e: number, f: number, g: number, h: number) => void;
    readonly apply_fade_in: (a: number, b: number, c: any, d: number) => void;
    readonly apply_fade_out: (a: number, b: number, c: any, d: number) => void;
    readonly apply_gain: (a: number, b: number, c: any, d: number) => void;
    readonly compute_peak: (a: number, b: number) => number;
    readonly compute_rms: (a: number, b: number) => number;
    readonly concat_buffers: (a: number, b: number, c: number, d: number) => [number, number];
    readonly decode_wav: (a: number, b: number) => number;
    readonly encode_wav_float32: (a: number, b: number, c: number, d: number) => [number, number];
    readonly encode_wav_pcm16: (a: number, b: number, c: number, d: number) => [number, number];
    readonly fft_magnitude: (a: number, b: number) => [number, number];
    readonly invert_phase: (a: number, b: number, c: any) => void;
    readonly mix_buffers: (a: number, b: number, c: number, d: number) => [number, number];
    readonly normalize: (a: number, b: number, c: any, d: number) => number;
    readonly remove_dc_offset: (a: number, b: number, c: any) => number;
    readonly reverse: (a: number, b: number, c: any) => void;
    readonly slice_buffer: (a: number, b: number, c: number, d: number) => [number, number];
    readonly spectrogram: (a: number, b: number, c: number, d: number) => [number, number];
    readonly wavdecoderesult_new: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
