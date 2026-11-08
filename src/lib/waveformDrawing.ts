import type { IClip } from '@/types/project';
import { getClipStretchRatio } from '@/lib/clipEditing';

/** Draw one linearly scaled waveform, matching Audacity's vertical display bounds. */
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
) {
  const ratio = getClipStretchRatio(clip);
  const sourceStart = Math.max(0, clip.offset * sampleRate);
  const sourceEnd = Math.min(data.length, (clip.offset + clip.duration * ratio) * sampleRate);
  const samplesPerPixel = Math.max(1, (sourceEnd - sourceStart) / width);
  const centerY = height / 2;
  const amplitude = height / 2 - 4;

  ctx.fillStyle = color;
  ctx.globalAlpha = alpha;

  ctx.beginPath();
  ctx.moveTo(0, centerY);

  for (let x = 0; x < width; x++) {
    const startSample = Math.floor(sourceStart + x * samplesPerPixel);
    const endSample = Math.min(Math.ceil(sourceStart + (x + 1) * samplesPerPixel), data.length, sourceEnd);

    let min = 1;
    let max = -1;

    for (let i = startSample; i < endSample; i++) {
      const v = data[i] ?? 0;
      if (v < min) min = v;
      if (v > max) max = v;
    }

    const yMin = centerY - Math.min(1, Math.abs(max * verticalZoom)) * amplitude;
    const yMax = centerY + Math.min(1, Math.abs(min * verticalZoom)) * amplitude;

    ctx.moveTo(x, yMin);
    ctx.lineTo(x, yMax);
  }

  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.globalAlpha = alpha * 0.3;
  ctx.beginPath();
  ctx.moveTo(0, centerY);
  ctx.lineTo(width, centerY);
  ctx.strokeStyle = color;
  ctx.lineWidth = 0.5;
  ctx.stroke();

  ctx.globalAlpha = 1;
}
