/**
 * Audacity Invert: reverse sample polarity without changing time order.
 * Official ProcessBlock contract: obuf[i] = -ibuf[i].
 */
export function processInvertSelection(
  channels: readonly Float32Array[],
  startSample: number,
  endSample: number,
): Float32Array[] {
  const length = channels[0]?.length ?? 0;
  if (
    channels.length === 0
    || length < 1
    || channels.some((channel) => channel.length !== length)
  ) {
    throw new RangeError('极性反转需要等长的非空声道');
  }
  if (
    !Number.isSafeInteger(startSample)
    || !Number.isSafeInteger(endSample)
    || startSample < 0
    || endSample > length
    || endSample <= startSample
  ) {
    throw new RangeError('极性反转选区必须是声道范围内的非空整数采样区间');
  }

  return channels.map((channel) => {
    const output = new Float32Array(channel);
    for (let index = startSample; index < endSample; index += 1) {
      output[index] = -channel[index];
    }
    return output;
  });
}
