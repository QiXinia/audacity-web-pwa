export interface AudioClipboardSegment {
  /** Timeline offset relative to the leftmost selected Clip. */
  startTime: number;
  duration: number;
  channels: Float32Array[];
  name?: string;
}

export interface AudioClipboardTrack {
  trackId: string;
  channels: Float32Array[];
  startTime: number;
  /** Present for Audacity multi-Clip copies; an empty channels array is then valid. */
  segments?: AudioClipboardSegment[];
}

export interface AudioClipboardData {
  tracks: AudioClipboardTrack[];
  sampleRate: number;
  duration: number;
}

/**
 * Audacity pastes a multi-track clipboard into the selected track and its
 * following tracks. Return an existing destination index for each source
 * track, or -1 when the destination project needs a new track.
 */
export function planClipboardPasteTrackIndices(
  trackIds: readonly string[],
  selectedTrackId: string | null,
  clipboardTrackCount: number,
): number[] {
  if (!Number.isInteger(clipboardTrackCount) || clipboardTrackCount < 0) {
    throw new Error('Clipboard track count must be a non-negative integer');
  }

  const selectedIndex = selectedTrackId === null ? -1 : trackIds.indexOf(selectedTrackId);
  return Array.from({ length: clipboardTrackCount }, (_, sourceIndex) => {
    if (selectedIndex < 0) return -1;
    const destinationIndex = selectedIndex + sourceIndex;
    return destinationIndex < trackIds.length ? destinationIndex : -1;
  });
}

export function serializeAudioClipboard(data: AudioClipboardData): string {
  return JSON.stringify({
    sampleRate: data.sampleRate,
    duration: data.duration,
    tracks: data.tracks.map((track) => ({
      trackId: track.trackId,
      startTime: track.startTime,
      channels: track.channels.map((channel) => Array.from(channel)),
      ...(track.segments ? {
        segments: track.segments.map((segment) => ({
          startTime: segment.startTime,
          duration: segment.duration,
          ...(segment.name !== undefined ? { name: segment.name } : {}),
          channels: segment.channels.map((channel) => Array.from(channel)),
        })),
      } : {}),
    })),
  });
}

function parseChannels(rawChannels: unknown): Float32Array[] {
  if (!Array.isArray(rawChannels)) throw new Error('Invalid clipboard channels');
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
  if (channels.length > 0) {
    const length = channels[0].length;
    if (channels.some((channel) => channel.length !== length)) {
      throw new Error('Clipboard channels must have equal lengths');
    }
  }
  return channels;
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
      segments?: unknown;
    };
    if (typeof track.trackId !== 'string') throw new Error('Invalid clipboard track');

    const rawChannels = track.channels !== undefined
      ? track.channels
      : track.data !== undefined
        ? [track.data]
        : [];
    const channels = parseChannels(rawChannels);
    const segments = track.segments === undefined ? undefined : (() => {
      if (!Array.isArray(track.segments)) throw new Error('Invalid clipboard segments');
      return track.segments.map((rawSegment): AudioClipboardSegment => {
        if (!rawSegment || typeof rawSegment !== 'object') throw new Error('Invalid clipboard segment');
        const segment = rawSegment as {
          startTime?: unknown;
          duration?: unknown;
          channels?: unknown;
          name?: unknown;
        };
        if (
          typeof segment.startTime !== 'number' || !Number.isFinite(segment.startTime) || segment.startTime < 0
          || typeof segment.duration !== 'number' || !Number.isFinite(segment.duration) || segment.duration <= 0
          || (segment.name !== undefined && typeof segment.name !== 'string')
        ) throw new Error('Invalid clipboard segment');
        const segmentChannels = parseChannels(segment.channels);
        if (segmentChannels.length === 0 || segmentChannels[0].length === 0) {
          throw new Error('Invalid clipboard segment channels');
        }
        return {
          startTime: segment.startTime,
          duration: segment.duration,
          channels: segmentChannels,
          ...(typeof segment.name === 'string' ? { name: segment.name } : {}),
        };
      });
    })();

    if (channels.length === 0 && (!segments || segments.length === 0)) {
      throw new Error('Invalid clipboard track');
    }
    return {
      trackId: track.trackId,
      channels,
      startTime: typeof track.startTime === 'number' && Number.isFinite(track.startTime) ? track.startTime : 0,
      ...(segments ? { segments } : {}),
    };
  });

  return { tracks, sampleRate: parsed.sampleRate, duration: parsed.duration };
}
