export interface CrossfadeClipBoundary {
  outEndSample: number;
  inStartSample: number;
  totalSamples: number;
}

export function validateCrossfadeClipBoundary(
  boundary: CrossfadeClipBoundary,
): void {
  if (
    !Number.isInteger(boundary.outEndSample)
    || !Number.isInteger(boundary.inStartSample)
    || !Number.isInteger(boundary.totalSamples)
  ) {
    throw new RangeError('Crossfade Clips 边界必须是整数采样');
  }
  if (boundary.totalSamples <= 0) {
    throw new RangeError('Crossfade Clips 选区不能为空');
  }
  if (boundary.outEndSample <= 0 || boundary.outEndSample > boundary.totalSamples) {
    throw new RangeError('Crossfade Clips 淡出边界必须位于选区内');
  }
  if (boundary.inStartSample < 0 || boundary.inStartSample >= boundary.totalSamples) {
    throw new RangeError('Crossfade Clips 淡入边界必须位于选区内');
  }
  if (boundary.outEndSample > boundary.inStartSample) {
    throw new RangeError('Crossfade Clips 片段边界顺序无效');
  }
}

function fadeOutGain(position: number, duration: number, sampleRate: number): number {
  if (duration === 1) return 1;
  if (duration / sampleRate < 0.01) return 1 - position / (duration - 1);
  return Math.cos((Math.PI / 2) * (position / (duration - 1)));
}

function fadeInGain(position: number, duration: number, sampleRate: number): number {
  if (duration === 1) return 1;
  if (duration / sampleRate < 0.01) return position / (duration - 1);
  return Math.sin((Math.PI / 2) * (position / (duration - 1)));
}

export function processCrossfadeClipChannels(
  channels: readonly Float32Array[],
  boundary: CrossfadeClipBoundary,
  sampleRate: number,
): Float32Array[] {
  validateCrossfadeClipBoundary(boundary);
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new RangeError('采样率无效');
  }
  if (channels.length === 0) throw new RangeError('Crossfade Clips 必须包含至少一个声道');
  const { outEndSample, inStartSample, totalSamples } = boundary;
  if (channels.some((channel) => channel.length !== totalSamples)) {
    throw new RangeError('Crossfade Clips 声道长度必须与选区一致');
  }

  const headLength = totalSamples - inStartSample;
  const fadeLength = Math.max(outEndSample, headLength);
  const fadeInOffset = Math.max(outEndSample - headLength, 0);
  const fadeInStart = totalSamples - fadeLength;
  const fadeInRampLength = fadeLength - fadeInOffset;

  return channels.map((channel) => {
    const output = new Float32Array(totalSamples);

    for (let sample = 0; sample < outEndSample; sample += 1) {
      output[sample] += channel[sample] * fadeOutGain(sample, outEndSample, sampleRate);
    }

    for (let sample = 0; sample < fadeLength; sample += 1) {
      const sourceSample = fadeInStart + sample;
      if (sample < fadeInOffset) continue;
      const gain = fadeInGain(sample - fadeInOffset, fadeInRampLength, sampleRate);
      output[sourceSample] += channel[sourceSample] * gain;
    }

    for (const value of output) {
      if (!Number.isFinite(value)) throw new RangeError('Crossfade Clips 计算结果无效');
    }
    return output;
  });
}
