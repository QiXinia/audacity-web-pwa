/* @ts-self-types="./audio_processor.d.ts" */

/**
 * Decode a WAV file into f32 samples.
 * Returns interleaved f32 samples.
 * Sets num_channels and sample_rate via JS side by reading returned metadata.
 * On error returns empty vec.
 */
export class WavDecodeResult {
    static __wrap(ptr) {
        const obj = Object.create(WavDecodeResult.prototype);
        obj.__wbg_ptr = ptr;
        WavDecodeResultFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WavDecodeResultFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wavdecoderesult_free(ptr, 0);
    }
    /**
     * @returns {number}
     */
    get num_channels() {
        const ret = wasm.__wbg_get_wavdecoderesult_num_channels(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    get sample_rate() {
        const ret = wasm.__wbg_get_wavdecoderesult_sample_rate(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {Float32Array}
     */
    get samples() {
        const ret = wasm.__wbg_get_wavdecoderesult_samples(this.__wbg_ptr);
        var v1 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @param {number} arg0
     */
    set num_channels(arg0) {
        wasm.__wbg_set_wavdecoderesult_num_channels(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} arg0
     */
    set sample_rate(arg0) {
        wasm.__wbg_set_wavdecoderesult_sample_rate(this.__wbg_ptr, arg0);
    }
    /**
     * @param {Float32Array | number[]} arg0
     */
    set samples(arg0) {
        const ptr0 = passArrayF32ToWasm0(arg0, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.__wbg_set_wavdecoderesult_samples(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * @param {Float32Array | number[]} samples
     * @param {number} num_channels
     * @param {number} sample_rate
     */
    constructor(samples, num_channels, sample_rate) {
        const val2 = +num_channels;
        const val3 = +sample_rate;
        const ptr0 = passArrayF32ToWasm0(samples, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wavdecoderesult_new(ptr0, len0, val2, val3);
        this.__wbg_ptr = ret;
        WavDecodeResultFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
}
if (Symbol.dispose) WavDecodeResult.prototype[Symbol.dispose] = WavDecodeResult.prototype.free;

/**
 * Apply a simple hard knee compressor to a mono buffer.
 * threshold_db: threshold in dB
 * ratio: compression ratio (e.g. 4.0 for 4:1)
 * attack_ms: attack time in ms
 * release_ms: release time in ms
 * sample_rate: sample rate in Hz
 * @param {Float32Array} buffer
 * @param {number} threshold_db
 * @param {number} ratio
 * @param {number} attack_ms
 * @param {number} release_ms
 * @param {number} sample_rate
 */
export function apply_compressor(buffer, threshold_db, ratio, attack_ms, release_ms, sample_rate) {
    const val2 = +threshold_db;
    const val3 = +ratio;
    const val4 = +attack_ms;
    const val5 = +release_ms;
    const val6 = +sample_rate;
    var ptr0 = passArrayF32ToWasm0(buffer, wasm.__wbindgen_malloc);
    var len0 = WASM_VECTOR_LEN;
    wasm.apply_compressor(ptr0, len0, buffer, val2, val3, val4, val5, val6);
}

/**
 * Apply fade in to the beginning of a buffer.
 * duration_samples: number of samples over which to fade
 * @param {Float32Array} buffer
 * @param {number} duration_samples
 */
export function apply_fade_in(buffer, duration_samples) {
    const val2 = +duration_samples;
    var ptr0 = passArrayF32ToWasm0(buffer, wasm.__wbindgen_malloc);
    var len0 = WASM_VECTOR_LEN;
    wasm.apply_fade_in(ptr0, len0, buffer, val2);
}

/**
 * Apply fade out to the end of a buffer.
 * duration_samples: number of samples over which to fade
 * @param {Float32Array} buffer
 * @param {number} duration_samples
 */
export function apply_fade_out(buffer, duration_samples) {
    const val2 = +duration_samples;
    var ptr0 = passArrayF32ToWasm0(buffer, wasm.__wbindgen_malloc);
    var len0 = WASM_VECTOR_LEN;
    wasm.apply_fade_out(ptr0, len0, buffer, val2);
}

/**
 * Apply gain to a mono audio buffer.
 * gain_linear: linear gain multiplier (use db_to_linear helper on JS side)
 * @param {Float32Array} buffer
 * @param {number} gain_linear
 */
export function apply_gain(buffer, gain_linear) {
    const val2 = +gain_linear;
    var ptr0 = passArrayF32ToWasm0(buffer, wasm.__wbindgen_malloc);
    var len0 = WASM_VECTOR_LEN;
    wasm.apply_gain(ptr0, len0, buffer, val2);
}

/**
 * Compute peak amplitude of a buffer.
 * @param {Float32Array | number[]} buffer
 * @returns {number}
 */
export function compute_peak(buffer) {
    const ptr0 = passArrayF32ToWasm0(buffer, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.compute_peak(ptr0, len0);
    return ret;
}

/**
 * Compute RMS level of a buffer.
 * Returns RMS value as linear amplitude.
 * @param {Float32Array | number[]} buffer
 * @returns {number}
 */
export function compute_rms(buffer) {
    const ptr0 = passArrayF32ToWasm0(buffer, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.compute_rms(ptr0, len0);
    return ret;
}

/**
 * Concatenate two audio buffers (mono).
 * @param {Float32Array | number[]} a
 * @param {Float32Array | number[]} b
 * @returns {Float32Array}
 */
export function concat_buffers(a, b) {
    let ptr0, len0, ptr1, len1;
    try {
        ptr0 = passArrayF32ToWasm0(a, wasm.__wbindgen_malloc);
        len0 = WASM_VECTOR_LEN;
        ptr1 = passArrayF32ToWasm0(b, wasm.__wbindgen_malloc);
        len1 = WASM_VECTOR_LEN;
    } catch (e) {
        if (ptr1) { wasm.__wbindgen_free(ptr1, len1 * 4, 4); }
        if (ptr0) { wasm.__wbindgen_free(ptr0, len0 * 4, 4); }
        throw e;
    }
    const ret = wasm.concat_buffers(ptr0, len0, ptr1, len1);
    var v3 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
    return v3;
}

/**
 * Decode WAV bytes.
 * @param {Uint8Array | number[]} data
 * @returns {WavDecodeResult | undefined}
 */
export function decode_wav(data) {
    const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.decode_wav(ptr0, len0);
    return ret === 0 ? undefined : WavDecodeResult.__wrap(ret);
}

/**
 * Encode audio to 32-bit float WAV.
 * @param {Float32Array | number[]} samples
 * @param {number} num_channels
 * @param {number} sample_rate
 * @returns {Uint8Array}
 */
export function encode_wav_float32(samples, num_channels, sample_rate) {
    const val2 = +num_channels;
    const val3 = +sample_rate;
    const ptr0 = passArrayF32ToWasm0(samples, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.encode_wav_float32(ptr0, len0, val2, val3);
    var v4 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v4;
}

/**
 * Encode a mono or interleaved stereo audio buffer to WAV format (PCM 16-bit).
 * samples: interleaved samples for multi-channel
 * num_channels: 1 = mono, 2 = stereo
 * sample_rate: sample rate in Hz
 * Returns WAV file bytes.
 * @param {Float32Array | number[]} samples
 * @param {number} num_channels
 * @param {number} sample_rate
 * @returns {Uint8Array}
 */
export function encode_wav_pcm16(samples, num_channels, sample_rate) {
    const val2 = +num_channels;
    const val3 = +sample_rate;
    const ptr0 = passArrayF32ToWasm0(samples, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.encode_wav_pcm16(ptr0, len0, val2, val3);
    var v4 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v4;
}

/**
 * Simple FFT implementation (Cooley-Tukey, power-of-two).
 * input: real-valued input samples
 * output: magnitude spectrum (half length + 1), each value is magnitude
 * @param {Float32Array | number[]} input
 * @returns {Float32Array}
 */
export function fft_magnitude(input) {
    const ptr0 = passArrayF32ToWasm0(input, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.fft_magnitude(ptr0, len0);
    var v2 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
    return v2;
}

/**
 * Invert the phase of the audio buffer in place.
 * @param {Float32Array} buffer
 */
export function invert_phase(buffer) {
    var ptr0 = passArrayF32ToWasm0(buffer, wasm.__wbindgen_malloc);
    var len0 = WASM_VECTOR_LEN;
    wasm.invert_phase(ptr0, len0, buffer);
}

/**
 * Mix two mono buffers with equal gain.
 * @param {Float32Array | number[]} a
 * @param {Float32Array | number[]} b
 * @returns {Float32Array}
 */
export function mix_buffers(a, b) {
    let ptr0, len0, ptr1, len1;
    try {
        ptr0 = passArrayF32ToWasm0(a, wasm.__wbindgen_malloc);
        len0 = WASM_VECTOR_LEN;
        ptr1 = passArrayF32ToWasm0(b, wasm.__wbindgen_malloc);
        len1 = WASM_VECTOR_LEN;
    } catch (e) {
        if (ptr1) { wasm.__wbindgen_free(ptr1, len1 * 4, 4); }
        if (ptr0) { wasm.__wbindgen_free(ptr0, len0 * 4, 4); }
        throw e;
    }
    const ret = wasm.mix_buffers(ptr0, len0, ptr1, len1);
    var v3 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
    return v3;
}

/**
 * Normalize audio to a target peak level.
 * target_db: target peak in dB (e.g. -1.0 for -1dB headroom)
 * Returns the applied gain in linear units.
 * @param {Float32Array} buffer
 * @param {number} target_db
 * @returns {number}
 */
export function normalize(buffer, target_db) {
    const val2 = +target_db;
    var ptr0 = passArrayF32ToWasm0(buffer, wasm.__wbindgen_malloc);
    var len0 = WASM_VECTOR_LEN;
    const ret = wasm.normalize(ptr0, len0, buffer, val2);
    return ret;
}

/**
 * Remove DC offset from audio buffer.
 * @param {Float32Array} buffer
 * @returns {number}
 */
export function remove_dc_offset(buffer) {
    var ptr0 = passArrayF32ToWasm0(buffer, wasm.__wbindgen_malloc);
    var len0 = WASM_VECTOR_LEN;
    const ret = wasm.remove_dc_offset(ptr0, len0, buffer);
    return ret;
}

/**
 * Reverse the audio buffer in place.
 * @param {Float32Array} buffer
 */
export function reverse(buffer) {
    var ptr0 = passArrayF32ToWasm0(buffer, wasm.__wbindgen_malloc);
    var len0 = WASM_VECTOR_LEN;
    wasm.reverse(ptr0, len0, buffer);
}

/**
 * Slice a mono buffer from start to end sample index.
 * @param {Float32Array | number[]} buffer
 * @param {number} start
 * @param {number} end
 * @returns {Float32Array}
 */
export function slice_buffer(buffer, start, end) {
    const val2 = +start;
    const val3 = +end;
    const ptr0 = passArrayF32ToWasm0(buffer, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.slice_buffer(ptr0, len0, val2, val3);
    var v4 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
    return v4;
}

/**
 * Generate spectrogram data from a buffer.
 * window_size: FFT window size (must be power of 2)
 * hop_size: step between windows in samples
 * Returns flat vector of magnitude values, row-major: [num_frames * (window_size/2 + 1)]
 * @param {Float32Array | number[]} input
 * @param {number} window_size
 * @param {number} hop_size
 * @returns {Float32Array}
 */
export function spectrogram(input, window_size, hop_size) {
    const val2 = +window_size;
    const val3 = +hop_size;
    const ptr0 = passArrayF32ToWasm0(input, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.spectrogram(ptr0, len0, val2, val3);
    var v4 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
    return v4;
}
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg___wbindgen_copy_to_typed_array_680b191e71920dc1: function(arg0, arg1, arg2) {
            new Uint8Array(arg2.buffer, arg2.byteOffset, arg2.byteLength).set(getArrayU8FromWasm0(arg0, arg1));
        },
        __wbg___wbindgen_throw_4c88d8bf264fd984: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            table.set(0, undefined);
            table.set(1024, undefined);
            table.set(1025, null);
            table.set(1026, true);
            table.set(1027, false);
        },
    };
    return {
        __proto__: null,
        "./audio_processor_bg.js": import0,
    };
}

const WavDecodeResultFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wavdecoderesult_free(ptr, 1));

function getArrayF32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getFloat32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

let cachedFloat32ArrayMemory0 = null;
function getFloat32ArrayMemory0() {
    if (cachedFloat32ArrayMemory0 === null || cachedFloat32ArrayMemory0.byteLength === 0) {
        cachedFloat32ArrayMemory0 = new Float32Array(wasm.memory.buffer);
    }
    return cachedFloat32ArrayMemory0;
}

function getStringFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return decodeText(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passArrayF32ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 4, 4) >>> 0;
    getFloat32ArrayMemory0().set(arg, ptr / 4);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(bytes) {
    numBytesDecoded += bytes.length;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true });
        cachedTextDecoder.decode();
        numBytesDecoded = bytes.length;
    }
    return cachedTextDecoder.decode(bytes);
}

let WASM_VECTOR_LEN = 0;

let wasmModule, wasmInstance, wasm;
function __wbg_finalize_init(instance, module) {
    wasmInstance = instance;
    wasm = instance.exports;
    wasmModule = module;
    cachedFloat32ArrayMemory0 = null;
    cachedUint8ArrayMemory0 = null;
    wasm.__wbindgen_start();
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (!module.ok) {
            throw new Error(`failed to fetch Wasm: ${module.status} ${module.statusText} fetching '${module.url}'`);
        }

        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

let __wbg_init_promise;
async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;
    if (__wbg_init_promise === undefined) {
        __wbg_init_promise = __wbg_init_once(module_or_path);
        __wbg_init_promise.catch(() => { __wbg_init_promise = undefined; });
    }
    return __wbg_init_promise;
}

async function __wbg_init_once(module_or_path) {

    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL('audio_processor_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
