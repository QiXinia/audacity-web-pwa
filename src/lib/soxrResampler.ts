import * as SoxrModuleImport from 'wasm-audio-resampler/app/soxr_wasm';
import soxrWasmUrl from 'wasm-audio-resampler/app/soxr_wasm.wasm?url';
import type { HighQualitySampleRateConverter } from '@/types/project';

/**
 * Audacity Resample.cpp maps its four HQ preference indices through
 * "\0\1\4\6"[method]. The browser UI omits index 0 (Soxr QQ), exactly as
 * Audacity does, and exposes LQ/MQ/HQ/VHQ = 1/2/4/6.
 */
export const SOXR_QUALITY_RECIPES: Readonly<Record<HighQualitySampleRateConverter, number>> = {
  lowQuality: 1,
  mediumQuality: 2,
  highQuality: 4,
  bestQuality: 6,
};

const AUDACITY_RESAMPLE_BUFFER_FRAMES = 65_536;
const FLOAT32_BYTES = 4;

interface SoxrModule {
  HEAPF32: Float32Array;
  HEAPU8: Uint8Array;
  _malloc(size: number): number;
  _free(pointer: number): void;
  _soxr_create(
    inputRate: number,
    outputRate: number,
    channels: number,
    errorPointer: number,
    ioSpecPointer: number,
    qualitySpecPointer: number,
    runtimeSpecPointer: number,
  ): number;
  _soxr_delete(handle: number): void;
  _soxr_process(
    handle: number,
    inputPointer: number,
    inputLength: number,
    consumedPointer: number,
    outputPointer: number,
    outputLength: number,
    generatedPointer: number,
  ): number;
  _soxr_io_spec(pointer: number, inputType: number, outputType: number): void;
  _soxr_quality_spec(pointer: number, recipe: number, flags: number): void;
  _sizeof_soxr_io_spec_t(): number;
  _sizeof_soxr_quality_spec_t(): number;
  getValue(pointer: number, type: string): number;
  setValue(pointer: number, value: number, type: string): void;
  AsciiToString(pointer: number): string;
}

type SoxrModuleFactory = (options: { wasmBinary: Uint8Array }) => Promise<SoxrModule> | SoxrModule;

/** Emscripten's CJS factory is wrapped differently by Vitest and Rolldown. */
export function resolveSoxrModuleFactory(imported: unknown): SoxrModuleFactory {
  let candidate = imported;
  for (let depth = 0; depth < 3 && typeof candidate !== 'function'; depth += 1) {
    if (!candidate || typeof candidate !== 'object' || !('default' in candidate)) break;
    candidate = (candidate as { default: unknown }).default;
  }
  if (typeof candidate !== 'function') {
    throw new TypeError('libsoxr Emscripten 模块未导出可调用工厂');
  }
  return candidate as SoxrModuleFactory;
}

let modulePromise: Promise<SoxrModule> | null = null;

function nodeProcess(): { versions?: { node?: string } } | undefined {
  return (globalThis as unknown as {
    process?: { versions?: { node?: string } };
  }).process;
}

async function loadWasmBinary(): Promise<Uint8Array> {
  // Vitest uses jsdom (window exists) but cannot fetch an absolute filesystem
  // path through Node's undici. Read the package asset explicitly in that one
  // runtime; production always uses Vite's base-aware hashed WASM URL.
  if (nodeProcess()?.versions?.node && import.meta.env.MODE === 'test') {
    const moduleSpecifier = 'node:module';
    const fsSpecifier = 'node:fs';
    const { createRequire } = await import(/* @vite-ignore */ moduleSpecifier) as typeof import('node:module');
    const { readFileSync } = await import(/* @vite-ignore */ fsSpecifier) as typeof import('node:fs');
    const require = createRequire(import.meta.url);
    const wasmPath = require.resolve('wasm-audio-resampler/app/soxr_wasm.wasm');
    return new Uint8Array(readFileSync(wasmPath));
  }

  const response = await fetch(soxrWasmUrl);
  if (!response.ok) {
    throw new Error(`libsoxr WASM 下载失败（HTTP ${response.status}）`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

function getSoxrModule(): Promise<SoxrModule> {
  if (!modulePromise) {
    modulePromise = loadWasmBinary()
      .then((wasmBinary) => resolveSoxrModuleFactory(SoxrModuleImport)({ wasmBinary }))
      .catch((error) => {
        modulePromise = null;
        throw error;
      });
  }
  return modulePromise;
}

function errorFromPointer(module: SoxrModule, errorPointer: number, fallback: string): string {
  if (!errorPointer) return fallback;
  try {
    return module.AsciiToString(errorPointer) || fallback;
  } catch {
    return fallback;
  }
}

function ensureCapacity(
  output: Float32Array<ArrayBuffer>,
  required: number,
  maximum: number,
): Float32Array<ArrayBuffer> {
  if (required <= output.length) return output;
  if (required > maximum) {
    throw new RangeError('libsoxr 实际输出超过浏览器内存上限');
  }
  const nextLength = Math.min(maximum, Math.max(required, output.length * 2));
  const next = new Float32Array(nextLength);
  next.set(output);
  return next;
}

/** Resample one mono stream with Audacity WaveClip's exact block/lastFlag protocol. */
function resampleMono(
  module: SoxrModule,
  input: Float32Array,
  fromRate: number,
  toRate: number,
  quality: HighQualitySampleRateConverter,
  maximumOutputFrames: number,
): Float32Array {
  const ioSpecPointer = module._malloc(module._sizeof_soxr_io_spec_t());
  const qualitySpecPointer = module._malloc(module._sizeof_soxr_quality_spec_t());
  const createErrorPointer = module._malloc(4);
  let handle = 0;
  let inputPointer = 0;
  let outputPointer = 0;
  let consumedPointer = 0;
  let generatedPointer = 0;

  try {
    if (!ioSpecPointer || !qualitySpecPointer || !createErrorPointer) {
      throw new Error('无法分配 libsoxr 配置内存');
    }
    module.setValue(createErrorPointer, 0, 'i32');
    module._soxr_io_spec(ioSpecPointer, 0, 0); // SOXR_FLOAT32_I
    module._soxr_quality_spec(qualitySpecPointer, SOXR_QUALITY_RECIPES[quality], 0);
    handle = module._soxr_create(
      fromRate,
      toRate,
      1,
      createErrorPointer,
      ioSpecPointer,
      qualitySpecPointer,
      0,
    );
    const createError = module.getValue(createErrorPointer, 'i32');
    if (!handle || createError) {
      throw new Error(errorFromPointer(module, createError, 'libsoxr 初始化失败'));
    }

    inputPointer = module._malloc(AUDACITY_RESAMPLE_BUFFER_FRAMES * FLOAT32_BYTES);
    outputPointer = module._malloc(AUDACITY_RESAMPLE_BUFFER_FRAMES * FLOAT32_BYTES);
    consumedPointer = module._malloc(4);
    generatedPointer = module._malloc(4);
    if (!inputPointer || !outputPointer || !consumedPointer || !generatedPointer) {
      throw new Error('无法分配 libsoxr 音频缓冲区');
    }

    const estimated = Math.ceil(input.length * toRate / fromRate);
    let output = new Float32Array(Math.min(
      maximumOutputFrames,
      Math.max(1, estimated + AUDACITY_RESAMPLE_BUFFER_FRAMES),
    ));
    let outputLength = 0;
    let position = 0;
    let generated = 0;

    // Audacity WaveClip.cpp: while (pos < numSamples || outGenerated > 0).
    while (position < input.length || generated > 0) {
      const inputLength = Math.min(AUDACITY_RESAMPLE_BUFFER_FRAMES, input.length - position);
      const isLast = position + inputLength === input.length;
      if (inputLength > 0) {
        module.HEAPF32.set(
          input.subarray(position, position + inputLength),
          inputPointer / FLOAT32_BYTES,
        );
      }
      module.setValue(consumedPointer, 0, 'i32');
      module.setValue(generatedPointer, 0, 'i32');
      const processError = module._soxr_process(
        handle,
        inputPointer,
        // Audacity Resample.cpp: lastFlag ? ~inBufferLen : inBufferLen.
        isLast ? ~inputLength : inputLength,
        consumedPointer,
        outputPointer,
        AUDACITY_RESAMPLE_BUFFER_FRAMES,
        generatedPointer,
      );
      if (processError) {
        throw new Error(errorFromPointer(module, processError, 'libsoxr 处理失败'));
      }
      const consumed = module.getValue(consumedPointer, 'i32') >>> 0;
      generated = module.getValue(generatedPointer, 'i32') >>> 0;
      if (consumed > inputLength || generated > AUDACITY_RESAMPLE_BUFFER_FRAMES) {
        throw new Error('libsoxr 返回了无效的帧计数');
      }
      if (inputLength > 0 && consumed === 0 && generated === 0) {
        throw new Error('libsoxr 未能继续处理输入');
      }
      if (generated > 0) {
        output = ensureCapacity(output, outputLength + generated, maximumOutputFrames);
        output.set(module.HEAPF32.subarray(
          outputPointer / FLOAT32_BYTES,
          outputPointer / FLOAT32_BYTES + generated,
        ), outputLength);
        outputLength += generated;
      }
      position += consumed;
    }
    if (position !== input.length) throw new Error('libsoxr 未消费完整输入');
    return output.slice(0, outputLength);
  } finally {
    if (handle) module._soxr_delete(handle);
    for (const pointer of [
      generatedPointer,
      consumedPointer,
      outputPointer,
      inputPointer,
      createErrorPointer,
      qualitySpecPointer,
      ioSpecPointer,
    ]) {
      if (pointer) module._free(pointer);
    }
  }
}

export async function resampleChannelsWithSoxr(
  channels: readonly Float32Array[],
  fromRate: number,
  toRate: number,
  quality: HighQualitySampleRateConverter,
  maximumOutputFramesPerChannel: number,
): Promise<Float32Array[]> {
  const module = await getSoxrModule();
  // Audacity constructs one independent mono Resample per channel.
  return channels.map((channel) => resampleMono(
    module,
    channel,
    fromRate,
    toRate,
    quality,
    maximumOutputFramesPerChannel,
  ));
}
