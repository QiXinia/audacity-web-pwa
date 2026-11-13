export interface ClippedSampleRange {
  startSample: number;
  endSample: number;
}

export function findClippedSampleRanges(
  data: Float32Array,
  startSample = 0,
  endSample = data.length,
): ClippedSampleRange[] {
  if (!Number.isInteger(startSample) || !Number.isInteger(endSample)) {
    throw new TypeError('采样边界必须是整数');
  }
  if (startSample < 0 || endSample < startSample || endSample > data.length) {
    throw new RangeError('采样范围超出可用数据');
  }

  const ranges: ClippedSampleRange[] = [];
  let rangeStart: number | null = null;

  for (let index = startSample; index < endSample; index++) {
    const isClipped = Math.abs(data[index] ?? 0) >= 1;
    if (isClipped && rangeStart === null) rangeStart = index;
    if (!isClipped && rangeStart !== null) {
      ranges.push({ startSample: rangeStart, endSample: index });
      rangeStart = null;
    }
  }

  if (rangeStart !== null) {
    ranges.push({ startSample: rangeStart, endSample });
  }

  return ranges;
}
