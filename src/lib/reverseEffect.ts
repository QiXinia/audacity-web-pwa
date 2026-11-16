/**
 * Audacity Reverse: reverse time order inside the exact selected sample range.
 * Official 3.7.5 contract: TimeToLongSamples(mT0/mT1), then
 * WaveTrackUtilities::Reverse(track, start, len), independently per channel.
 */
export function processReverseSelection(
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
    throw new RangeError('时间反转需要等长的非空声道');
  }
  if (
    !Number.isSafeInteger(startSample)
    || !Number.isSafeInteger(endSample)
    || startSample < 0
    || endSample > length
    || endSample <= startSample
  ) {
    throw new RangeError('时间反转选区必须是声道范围内的非空整数采样区间');
  }

  return channels.map((channel) => {
    const output = new Float32Array(channel);
    for (let offset = 0; offset < endSample - startSample; offset += 1) {
      output[startSample + offset] = channel[endSample - 1 - offset];
    }
    return output;
  });
}
