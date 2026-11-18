import type { IClip } from '@/types/project';
import { getClipStretchRatio } from '@/lib/clipEditing';
import { findClippedSampleRanges } from '@/lib/clippingDetection';
import { sampleToDbWaveY, sampleToLinearWaveY } from '@/lib/dbWaveform';

/** Audacity's colorful style blends the sample pen 25% toward white for RMS. */
export function waveformRmsColor(color: string): string {
  const match = /^#([\da-f]{6})$/i.exec(color);
  if (!match) return color;
  const value = Number.parseInt(match[1], 16);
  const channel = (shift: number) => Math.round(((value >> shift) & 0xff) * 0.75 + 255 * 0.25);
  return `#${[channel(16), channel(8), channel(0)]
    .map((component) => component.toString(16).padStart(2, '0'))
    .join('')}`;
}

/** Draw a linear waveform, or Audacity's logarithmic waveform when dbRange is supplied. */
export function drawWaveform(
  ctx: CanvasRenderingContext2D,
  data: Float32Array,
  width: number,
  height: number,
  color: string,
  clip: IClip,
  sampleRate: number,
  verticalZoom: number,
  alpha: number,
  showClipping = false,
  dbRange?: number,
  halfWave = false,
  showRMS = false,
) {
  const ratio = getClipStretchRatio(clip);
  const sourceStart = Math.max(0, clip.offset * sampleRate);
  const sourceEnd = Math.min(data.length, (clip.offset + clip.duration * ratio) * sampleRate);
  const samplesPerPixel = Math.max(1, (sourceEnd - sourceStart) / width);
  const centerY = height / 2;
  const amplitude = height / 2 - 4;
  const zeroY = halfWave
    ? dbRange !== undefined
      ? sampleToDbWaveY(0, height, dbRange, verticalZoom, true)
      : sampleToLinearWaveY(0, height, verticalZoom, true)
    : centerY;

  const rmsSegments: Array<[x: number, top: number, bottom: number] | null> | null = showRMS
    ? Array.from({ length: width }, () => null)
    : null;

  ctx.fillStyle = color;
  ctx.globalAlpha = alpha;

  ctx.beginPath();
  ctx.moveTo(0, zeroY);

  for (let x = 0; x < width; x++) {
    const startSample = Math.floor(sourceStart + x * samplesPerPixel);
    const endSample = Math.min(Math.ceil(sourceStart + (x + 1) * samplesPerPixel), data.length, sourceEnd);

    let min = 1;
    let max = -1;
    let squaresSum = 0;
    let sampleCount = 0;

    for (let i = startSample; i < endSample; i++) {
      const v = data[i] ?? 0;
      if (v < min) min = v;
      if (v > max) max = v;
      if (rmsSegments) {
        squaresSum += v * v;
        sampleCount += 1;
      }
    }

    let yMin: number;
    let yMax: number;
    if (halfWave) {
      const firstY = dbRange !== undefined
        ? sampleToDbWaveY(max, height, dbRange, verticalZoom, true)
        : sampleToLinearWaveY(max, height, verticalZoom, true);
      const secondY = dbRange !== undefined
        ? sampleToDbWaveY(min, height, dbRange, verticalZoom, true)
        : sampleToLinearWaveY(min, height, verticalZoom, true);
      yMin = Math.min(firstY, secondY);
      yMax = Math.max(firstY, secondY);
    } else if (dbRange !== undefined) {
      const firstY = sampleToDbWaveY(max, height, dbRange, verticalZoom);
      const secondY = sampleToDbWaveY(min, height, dbRange, verticalZoom);
      yMin = Math.min(firstY, secondY);
      yMax = Math.max(firstY, secondY);
    } else {
      yMin = centerY - Math.min(1, Math.abs(max * verticalZoom)) * amplitude;
      yMax = centerY + Math.min(1, Math.abs(min * verticalZoom)) * amplitude;
    }

    ctx.moveTo(x, yMin);
    ctx.lineTo(x, yMax);

    if (rmsSegments && sampleCount > 0) {
      // WaveDataCache.cpp uses the mean square of every sample in the column.
      // WaveBitmapCache.cpp then limits the RMS envelope to the actual extrema.
      const rms = Math.sqrt(squaresSum / sampleCount);
      const positive = Math.min(rms, max);
      const negative = Math.max(-rms, min);
      const mapValue = (value: number) => {
        if (halfWave) {
          return dbRange !== undefined
            ? sampleToDbWaveY(value, height, dbRange, verticalZoom, true)
            : sampleToLinearWaveY(value, height, verticalZoom, true);
        }
        if (dbRange !== undefined) return sampleToDbWaveY(value, height, dbRange, verticalZoom);
        return centerY - Math.sign(value) * Math.min(1, Math.abs(value * verticalZoom)) * amplitude;
      };
      const positiveY = mapValue(positive);
      const negativeY = mapValue(negative);
      rmsSegments[x] = [x, Math.min(positiveY, negativeY), Math.max(positiveY, negativeY)];
    }
  }

  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.stroke();

  if (rmsSegments) {
    ctx.beginPath();
    for (const segment of rmsSegments) {
      if (!segment) continue;
      ctx.moveTo(segment[0], segment[1]);
      ctx.lineTo(segment[0], segment[2]);
    }
    ctx.strokeStyle = waveformRmsColor(color);
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  ctx.globalAlpha = alpha * 0.3;
  ctx.beginPath();
  ctx.moveTo(0, zeroY);
  ctx.lineTo(width, zeroY);
  ctx.strokeStyle = color;
  ctx.lineWidth = 0.5;
  ctx.stroke();

  if (showClipping) {
    const clippedRanges = findClippedSampleRanges(data, Math.floor(sourceStart), Math.ceil(sourceEnd));
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#d93a34';
    for (const range of clippedRanges) {
      const startX = Math.floor(((range.startSample - sourceStart) / samplesPerPixel));
      const endX = Math.ceil(((range.endSample - sourceStart) / samplesPerPixel));
      ctx.fillRect(startX, 0, Math.max(1, endX - startX), height);
    }
  }

  ctx.globalAlpha = 1;
}
