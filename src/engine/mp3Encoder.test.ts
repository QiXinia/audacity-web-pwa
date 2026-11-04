import { describe, expect, it } from 'vitest';
import { encodeMp3, getMp3SampleRate } from '@/engine/mp3Encoder';

describe('MP3 encoder', () => {
  it('encodes real MPEG audio instead of renaming WAV data', async () => {
    const left = new Float32Array(44100);
    const right = new Float32Array(22050);
    for (let i = 0; i < left.length; i++) {
      left[i] = Math.sin((2 * Math.PI * 440 * i) / 44100) * 0.4;
    }
    for (let i = 0; i < right.length; i++) {
      right[i] = Math.sin((2 * Math.PI * 660 * i) / 44100) * 0.25;
    }

    const blob = await encodeMp3([left, right], 44100, 128);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const hasId3 = bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33;
    const hasFrameSync = bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0;

    expect(blob.type).toBe('audio/mpeg');
    expect(bytes.length).toBeGreaterThan(1000);
    expect(hasId3 || hasFrameSync).toBe(true);
    expect(bytes[0]).not.toBe(0x52); // not a RIFF/WAV header
  });

  it('selects a supported sample rate for high-resolution projects', () => {
    expect(getMp3SampleRate(44100)).toBe(44100);
    expect(getMp3SampleRate(96000)).toBe(48000);
    expect(getMp3SampleRate(192000)).toBe(48000);
    expect(getMp3SampleRate(11000)).toBe(11025);
  });

  it('rejects empty audio', async () => {
    await expect(encodeMp3([], 44100)).rejects.toThrow('No audio data');
  });
});
