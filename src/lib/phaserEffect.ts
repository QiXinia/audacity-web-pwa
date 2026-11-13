export const PHASER_MAX_STAGES = 24;
export const PHASER_LFO_SKIP_SAMPLES = 20;

export interface PhaserSettings {
  stages: number;
  dryWet: number;
  frequencyHz: number;
  phaseDegrees: number;
  depth: number;
  feedbackPercent: number;
  outputGainDb: number;
}

export const DEFAULT_PHASER_SETTINGS: Readonly<PhaserSettings> = Object.freeze({
  stages: 2,
  dryWet: 128,
  frequencyHz: 0.4,
  phaseDegrees: 0,
  depth: 100,
  feedbackPercent: 0,
  outputGainDb: -6,
});

export interface PhaserChannelState {
  readonly old: Float64Array;
  skipCount: number;
  gain: number;
  feedbackOut: number;
  lastStages: number;
}

function assertRange(value: number, minimum: number, maximum: number, label: string): void {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new RangeError(`${label}必须在 ${minimum}–${maximum} 之间`);
  }
}

function assertSampleRate(sampleRate: number): void {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new RangeError('采样率必须是大于零的有限数值');
  }
}

export function validatePhaserSettings(settings: PhaserSettings): void {
  if (!Number.isSafeInteger(settings.stages) || settings.stages < 2 || settings.stages > PHASER_MAX_STAGES) {
    throw new RangeError(`Stages 必须是 ${2}–${PHASER_MAX_STAGES} 的整数`);
  }
  if (!Number.isSafeInteger(settings.dryWet) || settings.dryWet < 0 || settings.dryWet > 255) {
    throw new RangeError('Dry/Wet 必须是 0–255 的整数');
  }
  assertRange(settings.frequencyHz, 0.001, 4, 'LFO 频率');
  assertRange(settings.phaseDegrees, 0, 360, 'LFO 起始相位');
  if (!Number.isSafeInteger(settings.depth) || settings.depth < 0 || settings.depth > 255) {
    throw new RangeError('Depth 必须是 0–255 的整数');
  }
  if (!Number.isSafeInteger(settings.feedbackPercent) || settings.feedbackPercent < -100 || settings.feedbackPercent > 100) {
    throw new RangeError('Feedback 必须是 −100–100 的整数');
  }
  assertRange(settings.outputGainDb, -30, 30, '输出增益');
}

/** Audacity's parameter-update hook truncates odd stage counts to the previous even value. */
export function normalizePhaserSettings(settings: PhaserSettings): PhaserSettings {
  validatePhaserSettings(settings);
  return { ...settings, stages: settings.stages & ~1 };
}

export function createPhaserState(settings: PhaserSettings, sampleRate: number): PhaserChannelState {
  normalizePhaserSettings(settings);
  assertSampleRate(sampleRate);
  return {
    old: new Float64Array(PHASER_MAX_STAGES),
    skipCount: 0,
    gain: 0,
    feedbackOut: 0,
    lastStages: 0,
  };
}

/**
 * Audacity 4.0.2 PhaserBase::InstanceProcess. One state is retained per channel
 * so LFO phase, all-pass history and feedback survive selected clip boundaries.
 */
export function processPhaser(
  input: Float32Array,
  settings: PhaserSettings,
  sampleRate: number,
  state = createPhaserState(settings, sampleRate),
): Float32Array {
  const normalized = normalizePhaserSettings(settings);
  assertSampleRate(sampleRate);
  const output = new Float32Array(input.length);
  const upstreamSampleRate = Math.fround(sampleRate);
  const lfoSkip = normalized.frequencyHz * 2 * Math.PI / upstreamSampleRate;
  const phase = normalized.phaseDegrees * Math.PI / 180;
  const outputGain = 10 ** (normalized.outputGainDb / 20);
  const shapedLfoScale = Math.expm1(4);

  for (let stage = state.lastStages; stage < normalized.stages; stage += 1) {
    state.old[stage] = 0;
  }
  state.lastStages = normalized.stages;

  for (let index = 0; index < input.length; index += 1) {
    const dry = input[index];
    let wet = dry + state.feedbackOut * normalized.feedbackPercent / 101;
    if (state.skipCount % PHASER_LFO_SKIP_SAMPLES === 0) {
      state.skipCount += 1;
      let gain = (1 + Math.cos(state.skipCount * lfoSkip + phase)) / 2;
      gain = Math.expm1(gain * 4) / shapedLfoScale;
      state.gain = 1 - gain / 255 * normalized.depth;
    } else {
      state.skipCount += 1;
    }
    for (let stage = 0; stage < normalized.stages; stage += 1) {
      const previous = state.old[stage];
      state.old[stage] = state.gain * previous + wet;
      wet = previous - state.gain * state.old[stage];
    }
    state.feedbackOut = wet;
    output[index] = outputGain * (
      wet * normalized.dryWet + dry * (255 - normalized.dryWet)
    ) / 255;
    if (!Number.isFinite(output[index])) {
      throw new RangeError(`Phaser 在第 ${index} 个采样产生非有限输出`);
    }
  }
  return output;
}

export function processPhaserChannels(
  channels: readonly Float32Array[],
  settings: PhaserSettings,
  sampleRate: number,
  states?: PhaserChannelState[],
): Float32Array[] {
  if (channels.length === 0) throw new RangeError('至少需要一个音频声道');
  const length = channels[0].length;
  if (channels.some((channel) => channel.length !== length)) {
    throw new RangeError('Phaser 输入声道必须等长');
  }
  if (states && states.length !== channels.length) {
    throw new RangeError('每个输入声道必须有一个 Phaser 状态');
  }
  return channels.map((channel, index) => processPhaser(
    channel,
    settings,
    sampleRate,
    states?.[index] ?? createPhaserState(settings, sampleRate),
  ));
}
