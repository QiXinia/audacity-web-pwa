// EXPORTS: encodeMp3

import { logger } from '@/lib/logger';

const BLOCK_SIZE = 1152; // lamejs MPEG-1 每帧样本数

function floatToInt16(input: Float32Array, targetLength = input.length): Int16Array {
  const out = new Int16Array(targetLength);
  const length = Math.min(input.length, targetLength);
  for (let i = 0; i < length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    out[i] = Math.round(s * 32767);
  }
  return out;
}

const MP3_SAMPLE_RATES = [8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000];

export function getMp3SampleRate(sampleRate: number): number {
  if (MP3_SAMPLE_RATES.includes(sampleRate)) return sampleRate;
  return MP3_SAMPLE_RATES.reduce((nearest, candidate) =>
    Math.abs(candidate - sampleRate) < Math.abs(nearest - sampleRate) ? candidate : nearest,
  );
}

export async function encodeMp3(
  channels: Float32Array[],
  sampleRate: number,
  bitrate: number = 128,
): Promise<Blob> {
  const numChannels = Math.max(1, Math.min(channels.length, 2));
  const length = channels[0]?.length ?? 0;
  if (length === 0) {
    logger.error('encodeMp3: empty channel data');
    throw new Error('No audio data to encode');
  }

  const left = floatToInt16(channels[0], length);
  const right = numChannels === 2 ? floatToInt16(channels[1], length) : undefined;

  const { Mp3Encoder } = await import('@breezystack/lamejs');
  const encoder = new Mp3Encoder(numChannels, sampleRate, bitrate);
  const chunks: Uint8Array[] = [];

  for (let i = 0; i < length; i += BLOCK_SIZE) {
    const end = Math.min(i + BLOCK_SIZE, length);
    const l = left.subarray(i, end);
    let buf: Uint8Array;
    if (numChannels === 2 && right) {
      const r = right.subarray(i, end);
      buf = encoder.encodeBuffer(l, r);
    } else {
      buf = encoder.encodeBuffer(l);
    }
    if (buf.length > 0) {
      chunks.push(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
    }
  }

  const end = encoder.flush();
  if (end.length > 0) {
    chunks.push(new Uint8Array(end.buffer, end.byteOffset, end.byteLength));
  }

  logger.info(
    `MP3 encoded: ${length} samples @ ${sampleRate}Hz, ${bitrate}kbps, ${numChannels}ch`,
  );
  return new Blob(chunks as BlobPart[], { type: 'audio/mpeg' });
}
