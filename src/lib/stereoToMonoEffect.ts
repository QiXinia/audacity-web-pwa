/**
 * Audacity Stereo To Mono mixes the two input channels with equal weight.
 * The legacy Audacity implementation uses its Mixer and then divides every
 * rendered sample by two, which is the same as averaging L and R.
 */
export function mixStereoToMono(channels: readonly Float32Array[]): Float32Array[] {
  if (channels.length !== 2) {
    throw new RangeError('Stereo To Mono 仅支持两个输入声道');
  }
  const [left, right] = channels;
  if (!left || !right || left.length !== right.length) {
    throw new RangeError('左右声道长度必须一致');
  }
  const mono = new Float32Array(left.length);
  for (let i = 0; i < left.length; i += 1) {
    mono[i] = (left[i] + right[i]) / 2;
  }
  return [mono];
}
