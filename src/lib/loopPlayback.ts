export interface LoopRegion {
  start: number;
  end: number;
}

export interface ClipLoopSource {
  channelData: Float32Array[];
  sampleRate: number;
  sourceOffset: number;
  clipStart: number;
  clipDuration: number;
  fadeIn: number;
  fadeOut: number;
}

/** Return a finite, forward-only region without changing its timeline position. */
export function normalizeLoopRegion(region: LoopRegion | null | undefined): LoopRegion | null {
  if (!region) return null;
  const { start, end } = region;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) return null;
  return { start, end };
}

/** Loop playback starts at the region edge whenever the cursor is outside it. */
export function getLoopPlaybackStart(region: LoopRegion, cursorPosition: number): number {
  return cursorPosition >= region.start && cursorPosition < region.end
    ? cursorPosition
    : region.start;
}

/**
 * Map the Web Audio clock onto the visible looping playhead. Adjusting startTime
 * (rather than restarting sources) keeps pause/resume and sample-accurate loops aligned.
 */
export function wrapLoopCursor(
  startTime: number,
  currentTime: number,
  region: LoopRegion,
): { startTime: number; position: number } {
  const duration = region.end - region.start;
  const position = currentTime - startTime;
  if (position < region.end) return { startTime, position };
  const cycles = Math.max(1, Math.floor((position - region.start) / duration));
  return {
    startTime: startTime + cycles * duration,
    position: position - cycles * duration,
  };
}

/**
 * Render one clip into a region-sized loop buffer. Silence outside the clip keeps
 * every clip on the same loop period; trimmed source offsets and fades are baked in.
 */
export function buildClipLoopChannels(
  source: ClipLoopSource,
  region: LoopRegion,
): Float32Array[] | null {
  const channelCount = Math.min(2, source.channelData.length);
  if (channelCount === 0 || !Number.isFinite(source.sampleRate) || source.sampleRate <= 0) return null;

  const overlapStart = Math.max(region.start, source.clipStart);
  const overlapEnd = Math.min(region.end, source.clipStart + source.clipDuration);
  if (overlapEnd <= overlapStart) return null;

  const loopDuration = region.end - region.start;
  const outputFrames = Math.max(1, Math.ceil(loopDuration * source.sampleRate));
  const firstFrame = Math.max(0, Math.floor((overlapStart - region.start) * source.sampleRate));
  const endFrame = Math.min(
    outputFrames,
    Math.ceil((overlapEnd - region.start) * source.sampleRate),
  );
  const sourceStartFrame = Math.max(
    0,
    Math.floor((source.sourceOffset + overlapStart - source.clipStart) * source.sampleRate),
  );
  const output = Array.from({ length: channelCount }, () => new Float32Array(outputFrames));

  for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
    const input = source.channelData[channelIndex];
    const target = output[channelIndex];
    for (let frame = firstFrame; frame < endFrame; frame += 1) {
      const inputIndex = sourceStartFrame + frame - firstFrame;
      if (inputIndex >= input.length) break;
      const clipTime = overlapStart - source.clipStart + (frame - firstFrame) / source.sampleRate;
      let fadeGain = 1;
      if (source.fadeIn > 0 && clipTime < source.fadeIn) {
        fadeGain *= Math.max(0, clipTime / source.fadeIn);
      }
      const timeToClipEnd = source.clipDuration - clipTime;
      if (source.fadeOut > 0 && timeToClipEnd < source.fadeOut) {
        fadeGain *= Math.max(0, timeToClipEnd / source.fadeOut);
      }
      target[frame] = input[inputIndex] * fadeGain;
    }
  }

  return output;
}
