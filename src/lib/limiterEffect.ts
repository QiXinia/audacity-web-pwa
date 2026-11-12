import {
  createCompressorState,
  evaluateCompressorTransferFunction,
  processCompressorChannels,
  processCompressorStream,
  type CompressorSettings,
  type CompressorState,
} from '@/lib/compressorEffect';

/** Audacity 4.0.2 LimiterSettings (the UI calls makeupTargetDb "Output"). */
export interface LimiterSettings {
  thresholdDb: number;
  makeupTargetDb: number;
  kneeWidthDb: number;
  lookaheadMs: number;
  releaseMs: number;
}

export const DEFAULT_LIMITER_SETTINGS: Readonly<LimiterSettings> = Object.freeze({
  thresholdDb: -6,
  makeupTargetDb: -1,
  kneeWidthDb: 2,
  lookaheadMs: 1,
  releaseMs: 20,
});

function assertLimiterRange(value: number, minimum: number, maximum: number, label: string): void {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new RangeError(`${label}必须在 ${minimum}–${maximum} 之间`);
  }
}

export function validateLimiterSettings(settings: LimiterSettings): void {
  assertLimiterRange(settings.thresholdDb, -30, 0, '阈值');
  assertLimiterRange(settings.makeupTargetDb, -30, 0, '输出目标');
  assertLimiterRange(settings.kneeWidthDb, 0, 10, '拐点宽度');
  assertLimiterRange(settings.lookaheadMs, 0, 50, 'Lookahead');
  assertLimiterRange(settings.releaseMs, 0, 1000, 'Release');
}

/** DynamicRangeProcessorSettings(LimiterSettings) from the official source. */
export function toLimiterCompressorSettings(settings: LimiterSettings): CompressorSettings {
  validateLimiterSettings(settings);
  return {
    thresholdDb: settings.thresholdDb,
    makeupGainDb: settings.makeupTargetDb - settings.thresholdDb,
    kneeWidthDb: settings.kneeWidthDb,
    compressionRatio: Infinity,
    lookaheadMs: settings.lookaheadMs,
    attackMs: 0,
    releaseMs: settings.releaseMs,
  };
}

export function createLimiterState(
  settings: LimiterSettings,
  sampleRate: number,
  channelCount: number,
): CompressorState {
  return createCompressorState(
    toLimiterCompressorSettings(settings),
    sampleRate,
    channelCount,
    { allowInfiniteRatio: true },
  );
}

/** Streaming form used by the project service to preserve state across clips. */
export function processLimiterStream(
  channels: readonly Float32Array[],
  state: CompressorState,
): Float32Array[] {
  return processCompressorStream(channels, state);
}

/** Offline EffectStage semantics: compensate look-ahead once for the whole selection. */
export function processLimiterChannels(
  channels: readonly Float32Array[],
  settings: LimiterSettings,
  sampleRate: number,
): Float32Array[] {
  return processCompressorChannels(
    channels,
    toLimiterCompressorSettings(settings),
    sampleRate,
    { allowInfiniteRatio: true },
  );
}

export function evaluateLimiterTransferFunction(settings: LimiterSettings, inputDb: number): number {
  return evaluateCompressorTransferFunction(
    toLimiterCompressorSettings(settings),
    inputDb,
    { allowInfiniteRatio: true },
  );
}

/** LimiterEffect::CheckWhetherSkipEffect always returns false. */
export function isLimiterBypassed(_settings: LimiterSettings): boolean {
  return false;
}
