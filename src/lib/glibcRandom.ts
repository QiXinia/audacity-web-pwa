export const GLIBC_RAND_MAX = 2147483647;

export type GlibcRandom = () => number;

/** Match glibc rand()/random() with a deterministic seed (default 1). */
export function createGlibcRandom(seed = 1): GlibcRandom {
  const state: number[] = [seed === 0 ? 1 : seed >>> 0];
  for (let index = 1; index <= 30; index += 1) {
    state[index] = (16807 * state[index - 1]!) % GLIBC_RAND_MAX;
  }
  state[31] = state[0]!;
  state[32] = state[1]!;
  state[33] = state[2]!;
  for (let index = 34; index < 344; index += 1) {
    state[index] = (state[index - 31]! + state[index - 3]!) >>> 0;
  }
  return () => {
    const value = (state[state.length - 31]! + state[state.length - 3]!) >>> 0;
    state.push(value);
    return value >>> 1;
  };
}
