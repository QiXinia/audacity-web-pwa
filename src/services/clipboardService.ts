export interface AudioClipboardTrack {
  trackId: string;
  channels: Float32Array[];
  startTime: number;
}

export interface AudioClipboardData {
  tracks: AudioClipboardTrack[];
  sampleRate: number;
  duration: number;
}

export function serializeAudioClipboard(data: AudioClipboardData): string {
  return JSON.stringify({
    sampleRate: data.sampleRate,
    duration: data.duration,
    tracks: data.tracks.map((track) => ({
      trackId: track.trackId,
      startTime: track.startTime,
      channels: track.channels.map((channel) => Array.from(channel)),
    })),
  });
}

export function parseAudioClipboard(serialized: string): AudioClipboardData {
  const parsed = JSON.parse(serialized) as {
    sampleRate?: unknown;
    duration?: unknown;
    tracks?: unknown;
  };
  if (
    typeof parsed.sampleRate !== 'number' ||
    !Number.isFinite(parsed.sampleRate) ||
    parsed.sampleRate <= 0 ||
    typeof parsed.duration !== 'number' ||
    !Number.isFinite(parsed.duration) ||
    parsed.duration <= 0 ||
    !Array.isArray(parsed.tracks)
  ) {
    throw new Error('Invalid audio clipboard data');
  }

  const tracks = parsed.tracks.map((rawTrack): AudioClipboardTrack => {
    if (!rawTrack || typeof rawTrack !== 'object') throw new Error('Invalid clipboard track');
    const track = rawTrack as {
      trackId?: unknown;
      startTime?: unknown;
      channels?: unknown;
      data?: unknown;
    };
    const rawChannels = Array.isArray(track.channels)
      ? track.channels
      : track.data !== undefined
        ? [track.data]
        : null;
    if (typeof track.trackId !== 'string' || !rawChannels || rawChannels.length === 0) {
      throw new Error('Invalid clipboard track');
    }

    const channels = rawChannels.map((rawChannel) => {
      if (Array.isArray(rawChannel)) return Float32Array.from(rawChannel);
      // Backward compatibility: JSON.stringify(Float32Array) produced numeric-key objects.
      if (rawChannel && typeof rawChannel === 'object') {
        const values = Object.values(rawChannel as Record<string, unknown>);
        if (values.every((value) => typeof value === 'number' && Number.isFinite(value))) {
          return Float32Array.from(values as number[]);
        }
      }
      throw new Error('Invalid clipboard channel');
    });
    const length = channels[0].length;
    if (channels.some((channel) => channel.length !== length)) {
      throw new Error('Clipboard channels must have equal lengths');
    }

    return {
      trackId: track.trackId,
      channels,
      startTime: typeof track.startTime === 'number' && Number.isFinite(track.startTime) ? track.startTime : 0,
    };
  });

  return { tracks, sampleRate: parsed.sampleRate, duration: parsed.duration };
}
