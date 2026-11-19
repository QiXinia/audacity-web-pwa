// EXPORTS: MixAndRenderClipInput, MixAndRenderTrackInput, MixAndRenderRenderResult,
// MAX_MIX_AND_RENDER_TOTAL_OUTPUT_SAMPLES, renderMixAndRenderTracks,
// resolveMixAndRenderTrackIds

export interface MixAndRenderClipInput {
  clipId: string;
  startTime: number;
  duration: number;
  sourceOffset: number;
  gain: number;
  fadeIn: number;
  fadeOut: number;
  sampleData: readonly Float32Array[];
}

export interface MixAndRenderTrackInput {
  trackId: string;
  gain: number;
  pan: number;
  clips: readonly MixAndRenderClipInput[];
}

export interface MixAndRenderRenderResult {
  channels: Float32Array[];
  startTime: number;
  duration: number;
}

export interface MixAndRenderRange {
  startTime: number;
  endTime: number;
}

/** Bound staged output memory before allocating a whole-project render. */
export const MAX_MIX_AND_RENDER_TOTAL_OUTPUT_SAMPLES = 20_000_000;

function finite(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new RangeError(`${label}必须是有限数值`);
  return value;
}

function dbToGain(db: number): number {
  return 10 ** (finite(db, '增益') / 20);
}

/**
 * Resolve explicitly selected wave tracks in project order. Clip selections may
 * span several tracks; selectedTrackId alone represents one selected track.
 */
export function resolveMixAndRenderTrackIds(
  allTrackIds: readonly string[],
  selectedTrackId: string | null,
  selectedClipTrackIds: readonly string[],
): string[] {
  const available = new Set(allTrackIds);
  const selected = new Set<string>();
  if (selectedTrackId && available.has(selectedTrackId)) selected.add(selectedTrackId);
  for (const trackId of selectedClipTrackIds) {
    if (available.has(trackId)) selected.add(trackId);
  }
  return allTrackIds.filter((trackId) => selected.has(trackId));
}

/**
 * Audacity 4.0.2 MixAndRender-compatible whole-track PCM rendering.
 *
 * - Occupied range: earliest clip start through latest clip end, including gaps.
 * - Mono output only when every input clip is mono and every track is centre-panned.
 * - Official linear balance: L = 1-max(pan,0), R = 1+min(pan,0).
 * - Track/clip gain and clip fades are baked in; samples are summed without clipping.
 *
 * Realtime effect rendering is represented by the already-effective clip PCM supplied
 * by the caller. No input array is modified and every input is validated before output
 * allocation, so a bad later track cannot produce a partial render.
 */
export function renderMixAndRenderTracks(
  tracks: readonly MixAndRenderTrackInput[],
  sampleRate: number,
  range?: MixAndRenderRange,
): MixAndRenderRenderResult {
  if (tracks.length === 0) throw new Error('没有可混音渲染的选中轨道');
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new RangeError('采样率必须大于零');
  }
  if (range) {
    finite(range.startTime, '混音开始时间');
    finite(range.endTime, '混音结束时间');
    if (range.startTime < 0 || range.endTime <= range.startTime) {
      throw new RangeError('混音时间范围必须非负且时长为正');
    }
  }

  const seenTracks = new Set<string>();
  let startTime = Number.POSITIVE_INFINITY;
  let endTime = Number.NEGATIVE_INFINITY;
  let mono = true;

  for (const track of tracks) {
    if (seenTracks.has(track.trackId)) throw new Error(`轨道 ${track.trackId} 被重复指定`);
    seenTracks.add(track.trackId);
    finite(track.gain, `轨道 ${track.trackId} 增益`);
    finite(track.pan, `轨道 ${track.trackId} 声像`);
    if (track.pan < -1 || track.pan > 1) throw new RangeError('轨道声像必须在 -1 到 1 之间');
    if (track.pan !== 0) mono = false;

    const seenClips = new Set<string>();
    for (const clip of track.clips) {
      if (seenClips.has(clip.clipId)) throw new Error(`片段 ${clip.clipId} 被重复指定`);
      seenClips.add(clip.clipId);
      finite(clip.startTime, `片段 ${clip.clipId} 开始时间`);
      finite(clip.duration, `片段 ${clip.clipId} 时长`);
      finite(clip.sourceOffset, `片段 ${clip.clipId} 源偏移`);
      if (clip.startTime < 0 || clip.duration <= 0 || clip.sourceOffset < 0) {
        throw new RangeError('混音片段的开始时间和源偏移必须非负，时长必须大于零');
      }
      finite(clip.gain, `片段 ${clip.clipId} 增益`);
      finite(clip.fadeIn, `片段 ${clip.clipId} 淡入`);
      finite(clip.fadeOut, `片段 ${clip.clipId} 淡出`);
      if (clip.fadeIn < 0 || clip.fadeOut < 0) throw new RangeError('片段淡入淡出不能为负数');
      if (clip.sampleData.length < 1 || clip.sampleData.length > 2) {
        throw new RangeError('Mix and Render 仅支持单声道或立体声片段');
      }
      const length = clip.sampleData[0]?.length ?? 0;
      if (length < 1 || clip.sampleData.some((channel) => channel.length !== length)) {
        throw new RangeError('混音片段必须包含等长的非空声道');
      }
      for (const channel of clip.sampleData) {
        for (let index = 0; index < channel.length; index += 1) {
          if (!Number.isFinite(channel[index])) {
            throw new RangeError(`片段 ${clip.clipId} 在第 ${index} 个采样包含非有限数值`);
          }
        }
      }
      if (clip.sampleData.length !== 1) mono = false;
      startTime = Math.min(startTime, clip.startTime);
      endTime = Math.max(endTime, clip.startTime + clip.duration);
    }
  }

  if (range) {
    startTime = range.startTime;
    endTime = range.endTime;
  }
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime <= startTime) {
    throw new Error('选中轨道没有可渲染的音频');
  }
  const outputLength = Math.round((endTime - startTime) * sampleRate);
  const channelCount = mono ? 1 : 2;
  if (outputLength < 1) throw new Error('选中轨道的音频不足一个采样');
  if (outputLength * channelCount > MAX_MIX_AND_RENDER_TOTAL_OUTPUT_SAMPLES) {
    throw new RangeError('Mix and Render 输出过大，请分批渲染');
  }
  const channels = Array.from({ length: channelCount }, () => new Float32Array(outputLength));
  const duration = outputLength / sampleRate;

  for (const track of tracks) {
    const trackVolume = dbToGain(track.gain);
    const leftVolume = trackVolume * (track.pan > 0 ? 1 - track.pan : 1);
    const rightVolume = trackVolume * (track.pan < 0 ? 1 + track.pan : 1);

    for (const clip of track.clips) {
      const clipGain = dbToGain(clip.gain);
      const clipDurationSamples = Math.round(clip.duration * sampleRate);
      const sourceStart = Math.round(clip.sourceOffset * sampleRate);
      const destinationStart = Math.round((clip.startTime - startTime) * sampleRate);
      const fadeInSamples = clip.fadeIn * sampleRate;
      const fadeOutSamples = clip.fadeOut * sampleRate;

      for (let index = 0; index < clipDurationSamples; index += 1) {
        const sourceIndex = sourceStart + index;
        const destinationIndex = destinationStart + index;
        if (destinationIndex < 0 || destinationIndex >= outputLength) continue;
        const first = clip.sampleData[0]?.[sourceIndex];
        if (first === undefined) break;

        let fadeGain = 1;
        if (clip.fadeIn > 0 && index < fadeInSamples) fadeGain = index / fadeInSamples;
        if (clip.fadeOut > 0 && index > clipDurationSamples - fadeOutSamples) {
          fadeGain = 1 - (index - (clipDurationSamples - fadeOutSamples)) / fadeOutSamples;
        }
        const envelope = clipGain * Math.max(0, Math.min(1, fadeGain));

        if (mono) {
          channels[0]![destinationIndex] += first * trackVolume * envelope;
        } else {
          channels[0]![destinationIndex] += first * leftVolume * envelope;
          const right = clip.sampleData.length === 1
            ? first
            : clip.sampleData[1]?.[sourceIndex] ?? first;
          channels[1]![destinationIndex] += right * rightVolume * envelope;
        }
      }
    }
  }

  return { channels, startTime, duration };
}
