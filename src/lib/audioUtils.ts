// EXPORTS: formatTime, formatDuration, clamp, generateId, dbToGain, gainToDb, linearToDb, dbToLinear, getTrackColor, formatFileSize, resampleBuffer, interleaveChannels, deinterleaveChannels

import { nanoid } from 'nanoid';

export function formatTime(seconds: number): string {
  if (seconds < 0) seconds = 0;
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds - Math.floor(seconds)) * 1000);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${seconds.toFixed(1)} 秒`;
  }
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  if (mins < 60) {
    return `${mins} 分 ${secs} 秒`;
  }
  const hours = Math.floor(mins / 60);
  const rmins = mins % 60;
  return `${hours} 小时 ${rmins} 分 ${secs} 秒`;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function generateId(): string {
  return nanoid(12);
}

export function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

export function gainToDb(gain: number): number {
  if (gain <= 0) return -Infinity;
  return 20 * Math.log10(gain);
}

export function linearToDb(value: number): number {
  return gainToDb(value);
}

export function dbToLinear(db: number): number {
  return dbToGain(db);
}

const TRACK_COLORS = [
  '#f472b6', // pink / 粉 - Audacity 4 风格 1 轨
  '#fb923c', // coral / 珊瑚橙 - 2 轨
  '#facc15', // yellow / 金黄 - 3 轨
  '#4ade80', // green / 草绿 - 4 轨
  '#38bdf8', // sky / 天蓝 - 5 轨
  '#a78bfa', // violet / 紫 - 6 轨
  '#f87171', // red / 红 - 7 轨
  '#94a3b8', // slate / 灰 - 8 轨
];

export function getTrackColor(index: number): string {
  return TRACK_COLORS[index % TRACK_COLORS.length];
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function resampleBuffer(
  input: Float32Array,
  fromRate: number,
  toRate: number,
): Float32Array {
  if (fromRate === toRate || input.length === 0) return input.slice();
  const ratio = fromRate / toRate;
  const outLength = Math.max(1, Math.floor(input.length / ratio));
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const pos = i * ratio;
    const idx = Math.floor(pos);
    const frac = pos - idx;
    const s0 = input[idx];
    const s1 = input[Math.min(idx + 1, input.length - 1)];
    out[i] = s0 + (s1 - s0) * frac;
  }
  return out;
}

export function interleaveChannels(channels: Float32Array[]): Float32Array {
  const num = Math.max(1, channels.length);
  const len = channels[0]?.length ?? 0;
  const out = new Float32Array(len * num);
  for (let c = 0; c < num; c++) {
    const ch = channels[c];
    for (let i = 0; i < len; i++) {
      out[i * num + c] = ch ? ch[i] : 0;
    }
  }
  return out;
}

export function deinterleaveChannels(
  interleaved: Float32Array,
  numChannels: number,
): Float32Array[] {
  const num = Math.max(1, numChannels);
  const samplesPerChannel = Math.floor(interleaved.length / num);
  const channels: Float32Array[] = [];
  for (let c = 0; c < num; c++) {
    const ch = new Float32Array(samplesPerChannel);
    for (let i = 0; i < samplesPerChannel; i++) {
      ch[i] = interleaved[i * num + c];
    }
    channels.push(ch);
  }
  return channels;
}
