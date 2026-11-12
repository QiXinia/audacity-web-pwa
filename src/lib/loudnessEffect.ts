import type { GeneratorSelection } from '@/lib/generatorEditing';
import type { IClip, ITrack } from '@/types/project';

/**
 * Audacity 4.0.2 Loudness Normalization, including the official EBUR128
 * histogram/gating implementation and RMS stereo rules.
 *
 * References: normalizeloudnesseffect.cpp, EBUR128.cpp and Biquad.h from the
 * Audacity-4.0.2 tag. The effect analyses the complete selected track before
 * applying one gain; stereo-independent mono processing follows the official
 * dual-mono / non-mono-channel -3 LU rule.
 */

export const MIN_LOUDNESS_TARGET_DB = -145;
export const MAX_LOUDNESS_TARGET_DB = 0;
export const MAX_LOUDNESS_TOTAL_SAMPLES = 20_000_000;

const HIST_BIN_COUNT = 65_536;
const GAMMA_A = (-70 + 0.691) / 10;
const EBU_SCALE = 0.8529037031;
const fround = Math.fround;

export type LoudnessAlgorithm = 'loudness' | 'rms';

export interface LoudnessSettings {
  algorithm: LoudnessAlgorithm;
  lufsLevel: number;
  rmsLevel: number;
  stereoIndependent: boolean;
  dualMono: boolean;
}

export const DEFAULT_LOUDNESS_SETTINGS: Readonly<LoudnessSettings> = Object.freeze({
  algorithm: 'loudness',
  lufsLevel: -23,
  rmsLevel: -20,
  stereoIndependent: false,
  dualMono: true,
});

export interface LoudnessTrackPlan {
  sampleRate: number;
  /** Linear power mean-square for LUFS, linear amplitude for RMS. */
  extents: number[];
  /** One gain per channel; linked stereo repeats the shared gain. */
  gains: number[];
}

export interface LoudnessClipInput {
  clipId: string;
  sampleData: Float32Array[];
  sourceOffset: number;
}

export interface LoudnessTrackInput {
  trackId: string;
  clips: LoudnessClipInput[];
}

export interface LoudnessClipResult {
  clipId: string;
  sampleData: Float32Array[];
}

export interface LoudnessTrackResult {
  trackId: string;
  selectionChannels: Float32Array[];
  clips: LoudnessClipResult[];
  plan: LoudnessTrackPlan;
}

export function validateLoudnessSettings(settings: LoudnessSettings): void {
  if (settings.algorithm !== 'loudness' && settings.algorithm !== 'rms') {
    throw new RangeError('Loudness 算法必须是 perceived loudness 或 RMS');
  }
  if (typeof settings.stereoIndependent !== 'boolean' || typeof settings.dualMono !== 'boolean') {
    throw new TypeError('立体声独立与 dual-mono 开关必须是布尔值');
  }
  const target = settings.algorithm === 'loudness' ? settings.lufsLevel : settings.rmsLevel;
  if (
    !Number.isFinite(target)
    || target < MIN_LOUDNESS_TARGET_DB
    || target > MAX_LOUDNESS_TARGET_DB
  ) {
    throw new RangeError('Loudness 目标必须在 -145–0 dB/LUFS 之间');
  }
}

function validateSampleRate(sampleRate: number): void {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new RangeError('Loudness 采样率必须是有限正数');
  }
}

function validateChannels(channels: readonly Float32Array[]): number {
  if (channels.length < 1 || channels.length > 2) {
    throw new RangeError('Audacity Loudness 仅支持单声道或立体声轨道');
  }
  const length = channels[0]?.length ?? 0;
  if (channels.some((channel) => channel.length !== length)) {
    throw new RangeError('Loudness 输入声道必须等长');
  }
  for (const channel of channels) {
    for (let index = 0; index < channel.length; index += 1) {
      if (!Number.isFinite(channel[index])) {
        throw new RangeError(`Loudness 输入在第 ${index} 个采样包含非有限数值`);
      }
    }
  }
  return length;
}

interface BiquadCoefficients {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

/** Biquad::ProcessOne: double state and arithmetic, float return at each stage. */
class Biquad {
  private previousIn = 0;
  private previousPreviousIn = 0;
  private previousOut = 0;
  private previousPreviousOut = 0;

  constructor(private readonly coefficients: BiquadCoefficients) {}

  process(input: number): number {
    const c = this.coefficients;
    const output = input * c.b0
      + this.previousIn * c.b1
      + this.previousPreviousIn * c.b2
      - this.previousOut * c.a1
      - this.previousPreviousOut * c.a2;
    this.previousPreviousIn = this.previousIn;
    this.previousIn = input;
    this.previousPreviousOut = this.previousOut;
    this.previousOut = output;
    return fround(output);
  }
}

function calcWeightingFilter(sampleRate: number): [Biquad, Biquad] {
  // Official order: high-shelf pre-filter, then high-pass weighting filter.
  const db = 3.999843853973347;
  const f0 = 1681.974450955533;
  const q = 0.7071752369554196;
  const k = Math.tan(Math.PI * f0 / sampleRate);
  const vh = 10 ** (db / 20);
  const vb = vh ** 0.4996667741545416;
  const a0 = 1 + k / q + k * k;
  const shelf = new Biquad({
    b0: (vh + vb * k / q + k * k) / a0,
    b1: 2 * (k * k - vh) / a0,
    b2: (vh - vb * k / q + k * k) / a0,
    a1: 2 * (k * k - 1) / a0,
    a2: (1 - k / q + k * k) / a0,
  });

  const highF0 = 38.13547087602444;
  const highQ = 0.5003270373238773;
  const highK = Math.tan(Math.PI * highF0 / sampleRate);
  const highPass = new Biquad({
    b0: 1,
    b1: -2,
    b2: 1,
    a1: 2 * (highK * highK - 1) / (1 + highK / highQ + highK * highK),
    a2: (1 - highK / highQ + highK * highK) / (1 + highK / highQ + highK * highK),
  });
  return [shelf, highPass];
}

function cppRound(value: number): number {
  return value >= 0 ? Math.floor(value + 0.5) : Math.ceil(value - 0.5);
}

class EbuR128 {
  private readonly blockSize: number;
  private readonly blockStep: number;
  private readonly ring: Float64Array;
  private readonly histogram = new Uint32Array(HIST_BIN_COUNT);
  private readonly filters: [Biquad, Biquad][];
  private ringPosition = 0;
  private ringSize = 0;

  constructor(sampleRate: number, channelCount: number) {
    this.blockSize = Math.ceil(0.4 * sampleRate);
    this.blockStep = Math.ceil(0.1 * sampleRate);
    this.ring = new Float64Array(this.blockSize);
    this.filters = Array.from({ length: channelCount }, () => calcWeightingFilter(sampleRate));
  }

  processSample(samples: readonly number[]): void {
    for (let channel = 0; channel < samples.length; channel += 1) {
      const shelf = this.filters[channel][0].process(samples[channel]);
      const weighted = this.filters[channel][1].process(shelf);
      const power = weighted * weighted;
      if (channel === 0) this.ring[this.ringPosition] = power;
      else this.ring[this.ringPosition] += power;
    }
    this.nextSample();
  }

  private nextSample(): void {
    this.ringPosition += 1;
    this.ringSize += 1;
    if (this.ringPosition % this.blockStep === 0 && this.ringSize >= this.blockSize) {
      this.addBlockToHistogram(this.blockSize);
    }
    if (this.ringPosition === this.blockSize) this.ringPosition = 0;
  }

  private addBlockToHistogram(validLength: number): void {
    this.ringSize = this.blockSize;
    if (validLength <= 0) return;
    let blockValue = 0;
    for (let index = 0; index < validLength; index += 1) blockValue += this.ring[index];
    const logarithmic = Math.log10(blockValue / validLength);
    const index = cppRound((logarithmic - GAMMA_A) * HIST_BIN_COUNT / -GAMMA_A - 1);
    if (Number.isFinite(index) && index >= 0 && index < HIST_BIN_COUNT) {
      this.histogram[index] += 1;
    }
  }

  private histogramSums(startIndex: number): { sum: number; count: number } {
    let sum = 0;
    let count = 0;
    const start = Math.max(0, Math.min(HIST_BIN_COUNT, startIndex));
    for (let index = start; index < HIST_BIN_COUNT; index += 1) {
      const occurrences = this.histogram[index];
      if (!occurrences) continue;
      const value = -GAMMA_A / HIST_BIN_COUNT * (index + 1) + GAMMA_A;
      sum += 10 ** value * occurrences;
      count += occurrences;
    }
    return { sum, count };
  }

  integrativeLoudness(): number {
    let { sum, count } = this.histogramSums(0);
    if (count === 0) {
      this.addBlockToHistogram(this.ringSize);
      ({ sum, count } = this.histogramSums(0));
    }
    if (count === 0) return 0;
    const gammaR = Math.log10(sum / count) - 1;
    const indexR = cppRound((gammaR - GAMMA_A) * HIST_BIN_COUNT / -GAMMA_A - 1);
    ({ sum, count } = this.histogramSums(indexR + 1));
    return count === 0 ? 0 : EBU_SCALE * sum / count;
  }
}

export function measureEbuR128(channels: readonly Float32Array[], sampleRate: number): number {
  validateSampleRate(sampleRate);
  if (validateChannels(channels) === 0) return 0;
  const processor = new EbuR128(sampleRate, channels.length);
  for (let index = 0; index < channels[0].length; index += 1) {
    processor.processSample(channels.map((channel) => channel[index]));
  }
  return fround(processor.integrativeLoudness());
}

export function loudnessExtentToLufs(extent: number): number {
  return extent > 0 ? 10 * Math.log10(extent) : -Infinity;
}

function measureRms(channel: Float32Array): number {
  if (channel.length === 0) return 0;
  let sum = 0;
  for (let index = 0; index < channel.length; index += 1) sum += channel[index] * channel[index];
  return fround(Math.sqrt(sum / channel.length));
}

/** Analyse one continuous selected track and calculate all gains before mutation. */
export function createLoudnessPlan(
  channels: readonly Float32Array[],
  sampleRate: number,
  settings: LoudnessSettings,
): LoudnessTrackPlan {
  validateSampleRate(sampleRate);
  validateLoudnessSettings(settings);
  if (validateChannels(channels) === 0) throw new RangeError('Loudness 需要非空音频选区');
  const monoTrack = channels.length === 1;

  if (settings.algorithm === 'rms') {
    const target = fround(10 ** (settings.rmsLevel / 20));
    if (settings.stereoIndependent) {
      const extents = channels.map((channel) => measureRms(channel));
      const gains = extents.map((extent) => {
        if (extent === 0) throw new RangeError('静音选区无法应用 Loudness Normalization');
        return fround(target / extent);
      });
      return { sampleRate, extents, gains };
    }
    const rms = channels.map((channel) => measureRms(channel));
    const extent = rms.length === 2
      ? fround(Math.sqrt((rms[0] * rms[0] + rms[1] * rms[1]) / 2))
      : rms[0];
    if (extent === 0) throw new RangeError('静音选区无法应用 Loudness Normalization');
    const gain = fround(target / extent);
    return { sampleRate, extents: [extent], gains: channels.map(() => gain) };
  }

  const target = fround(10 ** (settings.lufsLevel / 10));
  const gainFor = (extent: number): number => {
    if (extent === 0) throw new RangeError('静音或低于门限的选区无法应用 Loudness Normalization');
    let multiplier = fround(target / extent);
    // Official condition: one analysed channel AND (dualMono OR non-mono track).
    if (settings.dualMono || !monoTrack) multiplier = fround(multiplier / 2);
    return fround(Math.sqrt(multiplier));
  };

  if (settings.stereoIndependent) {
    const extents = channels.map((channel) => measureEbuR128([channel], sampleRate));
    return { sampleRate, extents, gains: extents.map(gainFor) };
  }
  const extent = measureEbuR128(channels, sampleRate);
  if (extent === 0) throw new RangeError('静音或低于门限的选区无法应用 Loudness Normalization');
  let multiplier = fround(target / extent);
  if (monoTrack && settings.dualMono) multiplier = fround(multiplier / 2);
  const gain = fround(Math.sqrt(multiplier));
  return { sampleRate, extents: [extent], gains: channels.map(() => gain) };
}

/** Apply a previously analysed track plan exactly once, without source mutation. */
export function processLoudnessChannels(
  channels: readonly Float32Array[],
  sampleRate: number,
  settings: LoudnessSettings,
  plan?: LoudnessTrackPlan,
): Float32Array[] {
  validateLoudnessSettings(settings);
  validateChannels(channels);
  const effective = plan ?? createLoudnessPlan(channels, sampleRate, settings);
  if (effective.sampleRate !== sampleRate || effective.gains.length !== channels.length) {
    throw new RangeError('Loudness 分析计划与输入采样率或声道数不一致');
  }
  return channels.map((channel, channelIndex) => {
    const gain = effective.gains[channelIndex];
    if (!Number.isFinite(gain)) throw new RangeError('Loudness 增益必须是有限数值');
    const output = new Float32Array(channel.length);
    for (let index = 0; index < channel.length; index += 1) {
      output[index] = fround(channel[index] * gain);
      if (!Number.isFinite(output[index])) {
        throw new RangeError(`Loudness 在第 ${index} 个采样产生非有限输出`);
      }
    }
    return output;
  });
}

interface AffectedClip {
  clip: IClip;
  input: LoudnessClipInput;
  clipStart: number;
  sourceStart: number;
  overlapStart: number;
  overlapEnd: number;
}

/** Assemble the complete selected track, preserving timeline gaps as digital silence. */
function assembleTrack(
  track: ITrack,
  target: LoudnessTrackInput,
  selection: GeneratorSelection,
  sampleRate: number,
): { selectedStart: number; selectedChannels: Float32Array[]; affected: AffectedClip[] } {
  validateSampleRate(sampleRate);
  if (
    !Number.isFinite(selection.start) || !Number.isFinite(selection.end)
    || selection.start < 0 || selection.end <= selection.start
  ) throw new RangeError('Loudness 需要有效的正时长选区');
  if (track.id !== target.trackId || track.clips.length === 0) {
    throw new Error('Loudness 目标轨道不可用');
  }
  const inputs = new Map<string, LoudnessClipInput>();
  for (const input of target.clips) {
    if (inputs.has(input.clipId) || !track.clips.some(({ id }) => id === input.clipId)) {
      throw new Error('Loudness 目标片段不可用或重复');
    }
    inputs.set(input.clipId, input);
  }
  if (inputs.size !== track.clips.length || track.clips.some(({ id }) => !inputs.has(id))) {
    throw new Error('Loudness 需要完整轨道音频以保持选区连续');
  }
  const ordered = [...track.clips].sort((left, right) => left.startTime - right.startTime);
  const channelCount = inputs.get(ordered[0].id)?.sampleData.length ?? 0;
  if (channelCount < 1 || channelCount > 2) throw new Error('Loudness 仅支持单声道或立体声轨道');
  for (const clip of ordered) {
    const input = inputs.get(clip.id)!;
    if (!Number.isFinite(input.sourceOffset) || input.sourceOffset < 0) {
      throw new Error('Loudness 片段源偏移无效');
    }
    if (
      input.sampleData.length !== channelCount
      || input.sampleData.some((channel) => channel.length !== input.sampleData[0]?.length)
    ) throw new Error('Loudness 轨道的片段声道布局不一致');
  }

  const trackStart = Math.min(...ordered.map(({ startTime }) => startTime));
  const trackEnd = Math.max(...ordered.map((clip) => clip.startTime + clip.duration));
  const selectedStart = Math.round(Math.max(trackStart, selection.start) * sampleRate);
  const selectedEnd = Math.round(Math.min(trackEnd, selection.end) * sampleRate);
  const selectedLength = selectedEnd - selectedStart;
  if (selectedLength <= 0) throw new Error('Loudness 选区与轨道没有有效重叠');
  const selectedChannels = Array.from({ length: channelCount }, () => new Float32Array(selectedLength));
  const affected: AffectedClip[] = [];
  for (const clip of ordered) {
    const input = inputs.get(clip.id)!;
    const clipStart = Math.round(clip.startTime * sampleRate);
    const clipEnd = Math.round((clip.startTime + clip.duration) * sampleRate);
    const sourceStart = Math.round(input.sourceOffset * sampleRate);
    const overlapStart = Math.max(selectedStart, clipStart);
    const overlapEnd = Math.min(selectedEnd, clipEnd);
    if (overlapEnd <= overlapStart) continue;
    for (let position = overlapStart; position < overlapEnd; position += 1) {
      const sourceIndex = sourceStart + position - clipStart;
      if (sourceIndex < 0 || sourceIndex >= input.sampleData[0].length) continue;
      for (let channel = 0; channel < channelCount; channel += 1) {
        selectedChannels[channel][position - selectedStart] = input.sampleData[channel][sourceIndex];
      }
    }
    affected.push({ clip, input, clipStart, sourceStart, overlapStart, overlapEnd });
  }
  if (affected.length === 0) throw new Error('Loudness 选区内没有可处理的片段');
  validateChannels(selectedChannels);
  return { selectedStart, selectedChannels, affected };
}

/** Shared preview/apply mapping across clip boundaries and timeline gaps. */
export function processLoudnessTrack(
  track: ITrack,
  target: LoudnessTrackInput,
  selection: GeneratorSelection,
  settings: LoudnessSettings,
  sampleRate: number,
): LoudnessTrackResult {
  const { selectedStart, selectedChannels, affected } = assembleTrack(track, target, selection, sampleRate);
  const plan = createLoudnessPlan(selectedChannels, sampleRate, settings);
  const processed = processLoudnessChannels(selectedChannels, sampleRate, settings, plan);
  const clips = affected.map(({ clip, input, clipStart, sourceStart, overlapStart, overlapEnd }) => {
    const sampleData = input.sampleData.map((channel) => new Float32Array(channel));
    for (let position = overlapStart; position < overlapEnd; position += 1) {
      const sourceIndex = sourceStart + position - clipStart;
      if (sourceIndex < 0 || sourceIndex >= sampleData[0].length) continue;
      for (let channel = 0; channel < sampleData.length; channel += 1) {
        sampleData[channel][sourceIndex] = processed[channel][position - selectedStart];
      }
    }
    return { clipId: clip.id, sampleData };
  });
  return { trackId: track.id, selectionChannels: processed, clips, plan };
}
