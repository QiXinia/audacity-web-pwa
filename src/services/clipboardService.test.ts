import { describe, expect, it } from 'vitest';
import { parseAudioClipboard, serializeAudioClipboard, type AudioClipboardData } from './clipboardService';

describe('audio clipboard serialization', () => {
  it('round-trips independent stereo channels', () => {
    const source: AudioClipboardData = {
      sampleRate: 44100,
      duration: 0.25,
      tracks: [{
        trackId: 'track-stereo',
        startTime: 0,
        channels: [
          Float32Array.from([0, 0.5, -0.5, 1]),
          Float32Array.from([1, 0.25, -0.25, 0]),
        ],
      }],
    };

    const restored = parseAudioClipboard(serializeAudioClipboard(source));
    expect(restored.sampleRate).toBe(44100);
    expect(restored.duration).toBe(0.25);
    expect(restored.tracks).toHaveLength(1);
    expect(restored.tracks[0].channels).toHaveLength(2);
    expect(Array.from(restored.tracks[0].channels[0])).toEqual(Array.from(source.tracks[0].channels[0]));
    expect(Array.from(restored.tracks[0].channels[1])).toEqual(Array.from(source.tracks[0].channels[1]));
  });

  it('restores the legacy numeric-key mono representation', () => {
    const legacy = JSON.stringify({
      sampleRate: 48000,
      duration: 1,
      tracks: [{ trackId: 'legacy', startTime: 0, data: Float32Array.from([0.1, 0.2, 0.3]) }],
    });
    const restored = parseAudioClipboard(legacy);
    expect(restored.tracks[0].channels).toHaveLength(1);
    expect(Array.from(restored.tracks[0].channels[0]).map((v) => Number(v.toFixed(1)))).toEqual([0.1, 0.2, 0.3]);
  });

  it('rejects channels with inconsistent lengths', () => {
    const serialized = JSON.stringify({
      sampleRate: 44100,
      duration: 1,
      tracks: [{ trackId: 'bad', channels: [[1, 2], [1]], startTime: 0 }],
    });
    expect(() => parseAudioClipboard(serialized)).toThrow('equal lengths');
  });

  it('rejects malformed or empty clipboard records', () => {
    expect(() => parseAudioClipboard('{')).toThrow();
    expect(() => parseAudioClipboard(JSON.stringify({ sampleRate: 44100, duration: 1, tracks: [{}] }))).toThrow('Invalid clipboard track');
  });
});
