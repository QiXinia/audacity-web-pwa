// SPDX-License-Identifier: LicenseRef-FFTPACK
// Synchronous PFFFT calls for Audacity StaffPad's existing processing pipeline.
// PFFFT's FFTPACK license is preserved in licenses/pffft-FFTPACK.txt.
import { PFFFT_WASM_BASE64 } from './pffftWasmBase64.ts';
import {
  PFFFT_SETUP_CORRECTIONS,
  PFFFT_SETUP_DATA_POINTER_OFFSET,
} from './pffftSetupCorrections.ts';
import type { ComplexSpectrum } from './staffPadTimeAndPitch';

interface PffftExports {
  d: WebAssembly.Memory;
  e: () => void;
  f: (bytes: number) => number;
  h: (pointer: number) => void;
  j: () => number;
  k: (size: number, transform: number) => number;
  l: (setup: number) => void;
  p: (setup: number, input: number, output: number, work: number, direction: number) => void;
}

interface PffftContext {
  setup: number;
  input: number;
  spectrum: number;
  work: number;
}

const binary = Uint8Array.from(atob(PFFFT_WASM_BASE64), (character) => character.charCodeAt(0));
const instance = new WebAssembly.Instance(
  new WebAssembly.Module(binary),
  {
    a: {
      a: (_condition: number, _filename: number, line: number, _function: number) => {
        throw new Error(`PFFFT assertion failed at line ${line}`);
      },
      b: (requestedSize: number) => {
        const oldSize = memory.buffer.byteLength;
        const pages = Math.ceil((requestedSize - oldSize) / 65536);
        if (pages <= 0) return 1;
        try {
          memory.grow(pages);
          return 1;
        } catch {
          return 0;
        }
      },
      c: (destination: number, source: number, count: number) => {
        new Uint8Array(memory.buffer).copyWithin(destination, source, source + count);
      },
    },
  },
);
const pffft = instance.exports as unknown as PffftExports;
const memory = pffft.d;
pffft.e();

export const PFFFT_SIMD_SIZE = pffft.j();
const contexts = new Map<number, PffftContext>();

function getContext(size: number): PffftContext {
  const cached = contexts.get(size);
  if (cached) return cached;
  const setup = pffft.k(size, 0);
  if (!setup) throw new RangeError(`PFFFT 不支持 FFT 尺寸 ${size}`);
  // Emscripten's musl cosf/sinf and native glibc differ by one ULP for a small
  // subset of twiddles. Restore the native glibc bits before any transform;
  // the pinned 32-bit PFFFT_Setup layout stores `data` at this fixed offset.
  const corrections = PFFFT_SETUP_CORRECTIONS[size];
  if (corrections) {
    const words = new Uint32Array(memory.buffer);
    const data = words[(setup + PFFFT_SETUP_DATA_POINTER_OFFSET) / 4];
    for (const [index, bits] of corrections) words[data / 4 + index] = bits;
  }
  const context = {
    setup,
    input: pffft.f(size * 4),
    spectrum: pffft.f(size * 4),
    work: pffft.f(size * 4),
  };
  if (!context.input || !context.spectrum || !context.work) {
    pffft.l(setup);
    pffft.h(context.input);
    pffft.h(context.spectrum);
    pffft.h(context.work);
    throw new Error('PFFFT 内存分配失败');
  }
  contexts.set(size, context);
  return context;
}

export function forwardPffftReal(input: Float32Array): ComplexSpectrum {
  const size = input.length;
  const context = getContext(size);
  const heap = new Float32Array(memory.buffer);
  heap.set(input, context.input / 4);
  pffft.p(context.setup, context.input, context.spectrum, context.work, 0);
  const packedOffset = context.spectrum / 4;
  const bins = size / 2 + 1;
  const real = new Float32Array(bins);
  const imaginary = new Float32Array(bins);
  real[0] = heap[packedOffset];
  real[bins - 1] = heap[packedOffset + 1];
  for (let index = 1; index < bins - 1; index += 1) {
    real[index] = heap[packedOffset + index * 2];
    imaginary[index] = heap[packedOffset + index * 2 + 1];
  }
  return { real, imaginary };
}

/** Inverse real PFFFT without 1/N scaling, matching StaffPad's native wrapper. */
export function inversePffftReal(spectrum: ComplexSpectrum): Float32Array {
  const bins = spectrum.real.length;
  const size = (bins - 1) * 2;
  if (spectrum.imaginary.length !== bins) throw new RangeError('PFFFT 频谱尺寸不一致');
  const context = getContext(size);
  const heap = new Float32Array(memory.buffer);
  const packedOffset = context.spectrum / 4;
  heap.fill(0, packedOffset, packedOffset + size);
  heap[packedOffset] = spectrum.real[0];
  heap[packedOffset + 1] = spectrum.real[bins - 1];
  for (let index = 1; index < bins - 1; index += 1) {
    heap[packedOffset + index * 2] = spectrum.real[index];
    heap[packedOffset + index * 2 + 1] = spectrum.imaginary[index];
  }
  pffft.p(context.setup, context.spectrum, context.spectrum, context.work, 1);
  return heap.slice(packedOffset, packedOffset + size);
}
