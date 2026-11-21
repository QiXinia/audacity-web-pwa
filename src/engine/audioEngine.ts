// EXPORTS: audioEngine, AudioEngine, PlaybackState, RecordingState

import { logger } from '@/lib/logger';
import { wasmProcessor } from '@/wasm/processor';
import { clamp, interleaveChannels } from '@/lib/audioUtils';
import { getClipStretchRatio } from '@/lib/clipEditing';
import { processClipPitchAndSpeedChannels } from '@/lib/clipPitchSpeed';
import {
  buildClipLoopChannels,
  getLoopPlaybackStart,
  normalizeLoopRegion,
  wrapLoopCursor,
  type LoopRegion,
} from '@/lib/loopPlayback';
import { encodeMp3, getMp3SampleRate } from '@/engine/mp3Encoder';
import {
  readAnalyserPeakDbfs,
  silentStereoLevels,
  type StereoLevels,
} from '@/lib/levelMeter';
import { getMeterDbRange } from '@/lib/meterPreferences';
import type { ITrack, IClip, IEffect } from '@/types/project';

export type PlaybackState = 'stopped' | 'playing' | 'paused';
export type RecordingState = 'idle' | 'recording';

interface AudioBufferCacheEntry {
  bufferId: string;
  channelData: Float32Array[];
  sampleRate: number;
  lastUsed: number;
}

interface StereoMeterNodes {
  splitter: ChannelSplitterNode;
  analysers: [AnalyserNode, AnalyserNode];
  buffers: [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>];
}

export class AudioEngine {
  private audioContext: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private playbackMeter: StereoMeterNodes | null = null;
  private recordingMeter: StereoMeterNodes | null = null;
  private _playbackState: PlaybackState = 'stopped';
  private _recordingState: RecordingState = 'idle';
  private startTime = 0;
  private pausePosition = 0;
  private playbackLoop: LoopRegion | null = null;
  private _cursorPosition = 0;
  private sampleRate = 44100;
  private animationFrameId: number | null = null;
  private onCursorChange: ((position: number) => void) | null = null;
  private onStateChange: ((state: PlaybackState) => void) | null = null;
  private onRecordingData: ((data: Float32Array[]) => void) | null = null;

  private mediaStream: MediaStream | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private recordingChunks: Blob[] = [];
  private _recordingMode: 'worklet' | 'scriptprocessor' = 'scriptprocessor';
  private _recordedChunksL: Float32Array[] | null = null;
  private _recordedChunksR: Float32Array[] | null = null;
  private _scriptProcessor: ScriptProcessorNode | null = null;
  private _recordSource: MediaStreamAudioSourceNode | null = null;
  private _workletNode: AudioWorkletNode | null = null;
  private _workletUrl: string | null = null;
  private _recordingSink: GainNode | null = null;
  private recordingStopResolver: (() => void) | null = null;
  private recordingStartPromise: Promise<void> | null = null;
  private recordingStopPromise: Promise<Float32Array[] | null> | null = null;
  private recordingStartWaiters = 0;
  private recordingGeneration = 0;

  // Stopped-state microphone monitoring is independent from recording. The
  // analyser branch feeds the meter; only inputMonitoring opens the audible gain.
  private monitoringStream: MediaStream | null = null;
  private monitoringSource: MediaStreamAudioSourceNode | null = null;
  private monitoringGain: GainNode | null = null;
  private monitoringMeter: StereoMeterNodes | null = null;
  private monitoringStartPromise: Promise<void> | null = null;
  private monitoringGeneration = 0;
  private inputMonitoringEnabled = false;

  private bufferCache = new Map<string, AudioBufferCacheEntry>();
  private stretchedBufferCache = new Map<string, { channelData: Float32Array[]; sampleRate: number }>();
  private maxCacheSize = 50;

  constructor() {
    // nothing to bind
  }

  get playbackState(): PlaybackState {
    return this._playbackState;
  }

  get recordingState(): RecordingState {
    return this._recordingState;
  }

  get cursorPosition(): number {
    return this._cursorPosition;
  }

  getSampleRate(): number {
    return this.sampleRate;
  }

  setCursorChangeCallback(cb: (position: number) => void): void {
    this.onCursorChange = cb;
  }

  setStateChangeCallback(cb: (state: PlaybackState) => void): void {
    this.onStateChange = cb;
  }

  setRecordingDataCallback(cb: (data: Float32Array[]) => void): void {
    this.onRecordingData = cb;
  }

  private createStereoMeter(ctx: AudioContext, input: AudioNode): StereoMeterNodes {
    const splitter = ctx.createChannelSplitter(2);
    const left = ctx.createAnalyser();
    const right = ctx.createAnalyser();
    for (const analyser of [left, right]) {
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0;
    }
    input.connect(splitter);
    splitter.connect(left, 0);
    splitter.connect(right, 1);
    return {
      splitter,
      analysers: [left, right],
      buffers: [new Float32Array(left.fftSize), new Float32Array(right.fftSize)],
    };
  }

  private disposeStereoMeter(meter: StereoMeterNodes | null): void {
    if (!meter) return;
    try { meter.splitter.disconnect(); } catch { /* already disconnected */ }
    for (const analyser of meter.analysers) {
      try { analyser.disconnect(); } catch { /* already disconnected */ }
    }
  }

  private readMeterLevels(meter: StereoMeterNodes | null): StereoLevels {
    const minDb = getMeterDbRange();
    if (!meter) return silentStereoLevels(minDb);
    return {
      left: readAnalyserPeakDbfs(meter.analysers[0], meter.buffers[0], minDb),
      right: readAnalyserPeakDbfs(meter.analysers[1], meter.buffers[1], minDb),
    };
  }

  getPlaybackLevels(): StereoLevels {
    if (this._playbackState !== 'playing') return silentStereoLevels();
    return this.readMeterLevels(this.playbackMeter);
  }

  getRecordingLevels(): StereoLevels {
    if (this._recordingState === 'recording') return this.readMeterLevels(this.recordingMeter);
    if (this.monitoringStream) return this.readMeterLevels(this.monitoringMeter);
    return silentStereoLevels();
  }

  isMicrophoneMonitoringActive(): boolean {
    return this.monitoringStream !== null;
  }

  /** Toggle the audible input branch without changing recording or meter capture. */
  setMonitoringEnabled(enabled: boolean): void {
    this.inputMonitoringEnabled = enabled;
    if (this.monitoringGain) this.monitoringGain.gain.value = enabled ? 1 : 0;
    if (this._recordingSink) this._recordingSink.gain.value = enabled ? 1 : 0;
  }

  async startMicrophoneMonitoring(options?: { audible?: boolean }): Promise<void> {
    if (options?.audible !== undefined) this.setMonitoringEnabled(options.audible);
    if (this._recordingState === 'recording' || this._playbackState !== 'stopped') return;
    if (this.monitoringStream) {
      try {
        await this.ensureContext();
      } catch (error) {
        this.stopMicrophoneMonitoring();
        throw error;
      }
      this.setMonitoringEnabled(this.inputMonitoringEnabled);
      return;
    }
    if (this.monitoringStartPromise) {
      const pending = this.monitoringStartPromise;
      const joinedGeneration = this.monitoringGeneration;
      await pending;
      // Callers that joined before Stop must stay cancelled. A genuinely new
      // caller may still restart monitoring after the stale request settles.
      if (joinedGeneration !== this.monitoringGeneration) return;
      if (this.monitoringStream || this._recordingState !== 'idle' || this._playbackState !== 'stopped') {
        this.setMonitoringEnabled(this.inputMonitoringEnabled);
        return;
      }
      // A stop during the previous pending start invalidated that request. A
      // newer caller must create its own stream instead of returning inactive.
      return this.startMicrophoneMonitoring();
    }

    const generation = ++this.monitoringGeneration;
    const pending = this.initializeMicrophoneMonitoring(generation);
    this.monitoringStartPromise = pending;
    try {
      await pending;
    } finally {
      if (this.monitoringStartPromise === pending) this.monitoringStartPromise = null;
    }
  }

  private canUseMicrophoneMonitoring(generation: number): boolean {
    return generation === this.monitoringGeneration
      && this._recordingState === 'idle'
      && this._playbackState === 'stopped';
  }

  private async initializeMicrophoneMonitoring(generation: number): Promise<void> {
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      if (!this.canUseMicrophoneMonitoring(generation)) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const ctx = await this.ensureContext();
      if (!this.canUseMicrophoneMonitoring(generation)) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      this.monitoringStream = stream;
      this.monitoringSource = ctx.createMediaStreamSource(stream);
      this.monitoringMeter = this.createStereoMeter(ctx, this.monitoringSource);
      this.monitoringGain = ctx.createGain();
      this.monitoringGain.gain.value = this.inputMonitoringEnabled ? 1 : 0;
      // Keep a zero-gain destination branch for metering so analyser nodes are
      // pulled even when the user must not hear the microphone.
      this.monitoringSource.connect(this.monitoringGain);
      this.monitoringGain.connect(ctx.destination);
    } catch (error) {
      if (generation !== this.monitoringGeneration) {
        stream?.getTracks().forEach((track) => track.stop());
        return;
      }
      if (this.monitoringStream && this.monitoringStream === stream) {
        this.cleanupMicrophoneMonitoring();
      } else {
        stream?.getTracks().forEach((track) => track.stop());
      }
      throw error;
    }
  }

  stopMicrophoneMonitoring(): void {
    this.monitoringGeneration += 1;
    this.cleanupMicrophoneMonitoring();
  }

  private cleanupMicrophoneMonitoring(): void {
    this.disposeStereoMeter(this.monitoringMeter);
    this.monitoringMeter = null;
    if (this.monitoringGain) {
      try { this.monitoringGain.disconnect(); } catch { /* already disconnected */ }
      this.monitoringGain = null;
    }
    if (this.monitoringSource) {
      try { this.monitoringSource.disconnect(); } catch { /* already disconnected */ }
      this.monitoringSource = null;
    }
    if (this.monitoringStream) {
      this.monitoringStream.getTracks().forEach((track) => track.stop());
      this.monitoringStream = null;
    }
  }

  private _resolveWorkletUrl(): string {
    // vite 开发模式下，public 目录可以直接通过根路径访问
    // 发布态也用相对路径，配合 basePath 正常工作
    const base = import.meta.env.BASE_URL || '/';
    const cleaned = base.endsWith('/') ? base.slice(0, -1) : base;
    return `${cleaned}/worklets/recording-processor.js`;
  }

  getRecordingMode(): 'worklet' | 'scriptprocessor' {
    return this._recordingMode;
  }

  async ensureContext(): Promise<AudioContext> {
    if (this.audioContext && this.audioContext.state !== 'closed') {
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }
      return this.audioContext;
    }

    try {
      const Ctx = (window.AudioContext || (window as any).webkitAudioContext);
      this.audioContext = new Ctx();
      this.sampleRate = this.audioContext.sampleRate;
      this.masterGain = this.audioContext.createGain();
      this.masterGain.gain.value = 1;
      this.masterGain.connect(this.audioContext.destination);
      // Metering is a read-only branch: the audible master path is unchanged.
      this.playbackMeter = this.createStereoMeter(this.audioContext, this.masterGain);
      return this.audioContext;
    } catch (e) {
      logger.error('Failed to create AudioContext:', String(e));
      throw e;
    }
  }

  async decodeAudioFile(file: File): Promise<{
    channelData: Float32Array[];
    sampleRate: number;
    duration: number;
  }> {
    const ctx = await this.ensureContext();
    const arrayBuffer = await file.arrayBuffer();

    try {
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
      const channelData: Float32Array[] = [];
      for (let i = 0; i < audioBuffer.numberOfChannels; i++) {
        channelData.push(audioBuffer.getChannelData(i));
      }
      return {
        channelData,
        sampleRate: audioBuffer.sampleRate,
        duration: audioBuffer.duration,
      };
    } catch (e) {
      logger.warn('Browser decode failed, trying WASM WAV decoder:', String(e));
      // Try WASM WAV decoder for WAV files
      const bytes = new Uint8Array(arrayBuffer);
      const result = wasmProcessor.decodeWav(bytes);
      if (result) {
        // De-interleave if stereo
        const numCh = result.numChannels;
        const totalSamples = result.samples.length;
        const samplesPerChannel = Math.floor(totalSamples / numCh);
        const channels: Float32Array[] = [];
        for (let c = 0; c < numCh; c++) {
          const ch = new Float32Array(samplesPerChannel);
          for (let i = 0; i < samplesPerChannel; i++) {
            ch[i] = result.samples[i * numCh + c];
          }
          channels.push(ch);
        }
        return {
          channelData: channels,
          sampleRate: result.sampleRate,
          duration: samplesPerChannel / result.sampleRate,
        };
      }
      throw e;
    }
  }

  cacheBuffer(bufferId: string, channelData: Float32Array[], sampleRate: number): void {
    // LRU cache eviction
    if (this.bufferCache.size >= this.maxCacheSize) {
      let oldestKey = '';
      let oldestTime = Infinity;
      for (const [key, entry] of this.bufferCache) {
        if (entry.lastUsed < oldestTime) {
          oldestTime = entry.lastUsed;
          oldestKey = key;
        }
      }
      if (oldestKey) this.bufferCache.delete(oldestKey);
    }
    this.bufferCache.set(bufferId, {
      bufferId,
      channelData,
      sampleRate,
      lastUsed: Date.now(),
    });
    for (const key of this.stretchedBufferCache.keys()) {
      if (key.startsWith(`${bufferId}:`)) this.stretchedBufferCache.delete(key);
    }
  }

  /** Process a clip without altering its original source buffer. */
  processClipChannels(
    clip: IClip,
    channelData: Float32Array[],
    sampleRate: number,
  ): Float32Array[] {
    return processClipPitchAndSpeedChannels(clip, channelData, sampleRate);
  }

  private getClipPlaybackBuffer(clip: IClip, cachedEntry: AudioBufferCacheEntry): {
    channelData: Float32Array[];
    sampleRate: number;
    sourceOffset: number;
  } {
    const ratio = getClipStretchRatio(clip);
    const pitchCents = clip.pitchCents ?? 0;
    const optimizeForVoice = clip.optimizeForVoice === true;
    if (Math.abs(ratio - 1) < 0.000001 && pitchCents === 0 && !optimizeForVoice) {
      return {
        channelData: cachedEntry.channelData,
        sampleRate: cachedEntry.sampleRate,
        sourceOffset: clip.offset,
      };
    }
    const key = `${clip.audioBufferId}:${ratio.toFixed(6)}:${pitchCents}:${optimizeForVoice}:${cachedEntry.sampleRate}`;
    let processed = this.stretchedBufferCache.get(key);
    if (!processed) {
      processed = {
        channelData: this.processClipChannels(clip, cachedEntry.channelData, cachedEntry.sampleRate),
        sampleRate: cachedEntry.sampleRate,
      };
      if (this.stretchedBufferCache.size >= 20) {
        const oldest = this.stretchedBufferCache.keys().next().value as string | undefined;
        if (oldest) this.stretchedBufferCache.delete(oldest);
      }
      this.stretchedBufferCache.set(key, processed);
    }
    return { ...processed, sourceOffset: clip.offset / ratio };
  }

  getCachedBuffer(bufferId: string): Float32Array[] | null {
    const entry = this.bufferCache.get(bufferId);
    if (entry) {
      entry.lastUsed = Date.now();
      return entry.channelData;
    }
    return null;
  }

  evictBuffer(bufferId: string): void {
    this.bufferCache.delete(bufferId);
    for (const key of this.stretchedBufferCache.keys()) {
      if (key.startsWith(`${bufferId}:`)) this.stretchedBufferCache.delete(key);
    }
  }

  clearCache(): void {
    this.bufferCache.clear();
    this.stretchedBufferCache.clear();
  }

  // Simple Web Audio playback using scheduled buffers
  async play(
    tracks: ITrack[],
    startPosition: number,
    isSoloActive: boolean,
    options?: { loop?: LoopRegion | null },
  ): Promise<void> {
    const loop = options?.loop === undefined ? null : normalizeLoopRegion(options.loop);
    if (options?.loop && !loop) throw new Error('循环区域必须是有限的正时长区间');
    const playbackStart = loop ? getLoopPlaybackStart(loop, startPosition) : startPosition;

    // Stop and dispose the previous context before creating a fresh one.
    // Calling stopPlayback after ensureContext would close the context we are about to use.
    this.stopPlayback();
    this.playbackLoop = loop;
    const ctx = await this.ensureContext();

    this._playbackState = 'playing';
    this._cursorPosition = playbackStart;
    this.onStateChange?.(this._playbackState);

    // For each track, schedule buffer playback
    const now = ctx.currentTime;
    this.startTime = now - playbackStart;

    for (const track of tracks) {
      if (track.muted) continue;
      if (isSoloActive && !track.solo) continue;

      const trackGain = ctx.createGain();
      trackGain.gain.value = Math.pow(10, track.gain / 20);

      // Pan (simplified stereo)
      const panNode = ctx.createStereoPanner();
      panNode.pan.value = clamp(track.pan, -1, 1);
      trackGain.connect(panNode);

      // Apply effects chain (Web Audio nodes)
      const chainInput: AudioNode = panNode;
      let chainOutput: AudioNode = panNode;

      for (const effect of track.effects) {
        if (effect.bypassed) continue;
        const pair = this.createEffectNode(ctx, effect);
        if (pair) {
          chainOutput.connect(pair.input);
          chainOutput = pair.output;
        }
      }

      // Connect end of effect chain to master
      chainOutput.connect(this.masterGain!);

      // Schedule each clip
      for (const clip of track.clips) {
        const cachedEntry = this.bufferCache.get(clip.audioBufferId);
        if (!cachedEntry || cachedEntry.channelData.length === 0) continue;
        cachedEntry.lastUsed = Date.now();

        const playback = this.getClipPlaybackBuffer(clip, cachedEntry);
        const { channelData, sampleRate: bufferSampleRate, sourceOffset } = playback;
        const channelCount = Math.min(2, channelData.length);
        const loopChannels = loop ? buildClipLoopChannels({
          channelData,
          sampleRate: bufferSampleRate,
          sourceOffset,
          clipStart: clip.startTime,
          clipDuration: clip.duration,
          fadeIn: clip.fadeIn,
          fadeOut: clip.fadeOut,
        }, loop) : null;
        if (loop && !loopChannels) continue;

        const scheduledChannels = loopChannels ?? channelData;
        const frameLength = loopChannels?.[0]?.length ?? Math.min(
          ...channelData.slice(0, channelCount).map((channel) => channel.length),
        );
        if (!Number.isFinite(frameLength) || frameLength <= 0) continue;

        const buffer = ctx.createBuffer(channelCount, frameLength, bufferSampleRate);
        for (let channelIndex = 0; channelIndex < channelCount; channelIndex++) {
          buffer.getChannelData(channelIndex).set(scheduledChannels[channelIndex].subarray(0, frameLength));
        }

        const source = ctx.createBufferSource();
        source.buffer = buffer;

        const clipGain = ctx.createGain();
        clipGain.gain.value = Math.pow(10, clip.gain / 20);
        source.connect(clipGain);
        clipGain.connect(trackGain);

        if (loop) {
          // Every clip occupies a full region-sized buffer, so all clips repeat
          // on the same period even when their audible segments have gaps.
          source.loop = true;
          source.loopStart = 0;
          source.loopEnd = loop.end - loop.start;
          source.start(now, playbackStart - loop.start);
          continue;
        }

        // Apply fade in/out via gain automation
        const clipStart = clip.startTime;
        const clipEnd = clip.startTime + clip.duration;

        if (clipStart >= playbackStart) {
          // Clip starts after current position
          const when = now + (clipStart - playbackStart);
          source.start(when, sourceOffset, clip.duration);

          // Fade in
          if (clip.fadeIn > 0) {
            clipGain.gain.setValueAtTime(0, when);
            clipGain.gain.linearRampToValueAtTime(
              Math.pow(10, clip.gain / 20),
              when + clip.fadeIn,
            );
          }

          // Fade out
          if (clip.fadeOut > 0) {
            const fadeStart = when + clip.duration - clip.fadeOut;
            if (fadeStart > when) {
              clipGain.gain.setValueAtTime(
                Math.pow(10, clip.gain / 20),
                fadeStart,
              );
              clipGain.gain.linearRampToValueAtTime(0, when + clip.duration);
            }
          }
        } else if (clipEnd > playbackStart) {
          // Clip already started, resume from middle
          const offsetInClip = playbackStart - clipStart + sourceOffset;
          const remaining = clip.duration - (playbackStart - clipStart);
          source.start(now, offsetInClip, remaining);

          // Fade out
          if (clip.fadeOut > 0) {
            const timeToEnd = clipEnd - playbackStart;
            if (clip.fadeOut < timeToEnd) {
              const fadeStart = timeToEnd - clip.fadeOut;
              clipGain.gain.setValueAtTime(
                Math.pow(10, clip.gain / 20),
                now + fadeStart,
              );
              clipGain.gain.linearRampToValueAtTime(0, now + timeToEnd);
            }
          }
        }
      }
    }

    // Start animation frame for cursor updates
    this.startAnimationFrame();
  }

  /**
   * Render the same enabled Web Audio realtime-effect chain used by playback.
   * Audacity MixAndRender keeps the requested time range, so the offline context
   * deliberately has the input length and does not append an effect tail.
   */
  async renderRealtimeEffects(
    channelData: readonly Float32Array[],
    sampleRate: number,
    effects: readonly IEffect[],
  ): Promise<Float32Array[]> {
    if (channelData.length < 1 || channelData.length > 2) {
      throw new RangeError('实时效果渲染仅支持单声道或立体声');
    }
    const length = channelData[0]?.length ?? 0;
    if (channelData.some((channel) => channel.length !== length)) {
      throw new RangeError('实时效果渲染要求等长声道');
    }
    if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
      throw new RangeError('实时效果渲染采样率必须大于零');
    }
    const enabledEffects = effects.filter((effect) => !effect.bypassed);
    if (enabledEffects.length === 0 || length === 0) {
      return channelData.map((channel) => new Float32Array(channel));
    }
    if (typeof OfflineAudioContext === 'undefined') {
      throw new Error('当前浏览器不支持实时效果离线渲染；未修改工程');
    }

    const context = new OfflineAudioContext(channelData.length, length, sampleRate);
    const buffer = context.createBuffer(channelData.length, length, sampleRate);
    channelData.forEach((channel, index) => buffer.getChannelData(index).set(channel));
    const source = context.createBufferSource();
    source.buffer = buffer;
    let chainOutput: AudioNode = source;
    for (const effect of enabledEffects) {
      const pair = this.createEffectNode(context, effect);
      if (!pair) throw new Error(`无法离线渲染实时效果 ${effect.type}；未修改工程`);
      chainOutput.connect(pair.input);
      chainOutput = pair.output;
    }
    chainOutput.connect(context.destination);
    source.start(0);
    const rendered = await context.startRendering();
    return Array.from({ length: rendered.numberOfChannels }, (_, index) => (
      new Float32Array(rendered.getChannelData(index))
    ));
  }

  private createEffectNode(
    ctx: BaseAudioContext,
    effect: IEffect,
  ): { input: AudioNode; output: AudioNode } | null {
    try {
      switch (effect.type) {
        case 'gain': {
          const gain = ctx.createGain();
          gain.gain.value = Math.pow(10, (effect.params.gain ?? 0) / 20);
          return { input: gain, output: gain };
        }
        case 'highPass': {
          const filter = ctx.createBiquadFilter();
          filter.type = 'highpass';
          filter.frequency.value = effect.params.cutoff ?? effect.params.frequency ?? 80;
          filter.Q.value = effect.params.q ?? 0.707;
          return { input: filter, output: filter };
        }
        case 'lowPass': {
          const filter = ctx.createBiquadFilter();
          filter.type = 'lowpass';
          filter.frequency.value = effect.params.cutoff ?? effect.params.frequency ?? 8000;
          filter.Q.value = effect.params.q ?? 0.707;
          return { input: filter, output: filter };
        }
        case 'eq': {
          // 3-band EQ: low shelf + peaking mid + high shelf
          const low = ctx.createBiquadFilter();
          low.type = 'lowshelf';
          low.frequency.value = 200;
          low.gain.value = effect.params.low ?? 0;

          const mid = ctx.createBiquadFilter();
          mid.type = 'peaking';
          mid.frequency.value = 1000;
          mid.Q.value = 1;
          mid.gain.value = effect.params.mid ?? 0;

          const high = ctx.createBiquadFilter();
          high.type = 'highshelf';
          high.frequency.value = 4000;
          high.gain.value = effect.params.high ?? 0;

          low.connect(mid);
          mid.connect(high);
          return { input: low, output: high };
        }
        case 'compressor': {
          const comp = ctx.createDynamicsCompressor();
          comp.threshold.value = effect.params.threshold ?? -24;
          comp.knee.value = effect.params.knee ?? 30;
          comp.ratio.value = effect.params.ratio ?? 12;
          comp.attack.value = effect.params.attack ?? 0.003;
          comp.release.value = effect.params.release ?? 0.25;
          return { input: comp, output: comp };
        }
        case 'reverb': {
          const convolver = ctx.createConvolver();
          const decay = effect.params.decay ?? 2;
          const impulseLength = Math.max(1, Math.floor(ctx.sampleRate * decay));
          const impulse = ctx.createBuffer(2, impulseLength, ctx.sampleRate);
          for (let c = 0; c < 2; c++) {
            const data = impulse.getChannelData(c);
            for (let i = 0; i < impulseLength; i++) {
              data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.3 * decay));
            }
          }
          convolver.buffer = impulse;

          const dry = ctx.createGain();
          const wet = ctx.createGain();
          const input = ctx.createGain();
          const output = ctx.createGain();

          const wetAmount = effect.params.wet ?? 0.3;
          dry.gain.value = 1 - wetAmount;
          wet.gain.value = wetAmount;

          input.connect(dry);
          input.connect(convolver);
          convolver.connect(wet);
          dry.connect(output);
          wet.connect(output);

          return { input, output };
        }
        case 'delay': {
          const delay = ctx.createDelay(5.0);
          delay.delayTime.value = effect.params.time ?? 0.3;
          const feedback = ctx.createGain();
          feedback.gain.value = effect.params.feedback ?? 0.3;
          delay.connect(feedback);
          feedback.connect(delay);

          const dry = ctx.createGain();
          const wet = ctx.createGain();
          const input = ctx.createGain();
          const output = ctx.createGain();

          const wetAmount = effect.params.wet ?? 0.3;
          dry.gain.value = 1 - wetAmount;
          wet.gain.value = wetAmount;

          input.connect(dry);
          input.connect(delay);
          delay.connect(wet);
          dry.connect(output);
          wet.connect(output);

          return { input, output };
        }
        case 'noiseGate': {
          // Simple noise gate using a waveshaper-style approach via gain automation
          // Web Audio has no native noise gate; we approximate with a DynamicsCompressor
          // used in a "gate" configuration (high ratio + threshold controls)
          const gate = ctx.createDynamicsCompressor();
          gate.threshold.value = effect.params.threshold ?? -40;
          gate.knee.value = 0;
          gate.ratio.value = 20; // High ratio = gate-like behavior
          gate.attack.value = effect.params.attack ?? 0.005;
          gate.release.value = effect.params.release ?? 0.1;
          return { input: gate, output: gate };
        }
        default:
          return null;
      }
    } catch (e) {
      logger.warn(`Failed to create effect node ${effect.type}:`, String(e));
      return null;
    }
  }

  pause(): void {
    if (this._playbackState !== 'playing') return;

    const ctx = this.audioContext;
    if (ctx) {
      if (this.playbackLoop) {
        const wrapped = wrapLoopCursor(this.startTime, ctx.currentTime, this.playbackLoop);
        this.startTime = wrapped.startTime;
      }
      this.pausePosition = ctx.currentTime - this.startTime;
      this._cursorPosition = this.pausePosition;
      // Suspend context to pause all scheduled sources
      ctx.suspend();
    }

    this._playbackState = 'paused';
    this.onStateChange?.(this._playbackState);
    this.stopAnimationFrame();
  }

  resume(): void {
    if (this._playbackState !== 'paused') return;

    const ctx = this.audioContext;
    if (ctx) {
      this.startTime = ctx.currentTime - this.pausePosition;
      ctx.resume();
    }

    this._playbackState = 'playing';
    this.onStateChange?.(this._playbackState);
    this.startAnimationFrame();
  }

  stopPlayback(): void {
    this.stopMicrophoneMonitoring();
    const ctx = this.audioContext;
    this.playbackLoop = null;
    this.disposeStereoMeter(this.playbackMeter);
    this.playbackMeter = null;
    if (ctx) {
      // Close and recreate for clean stop (simpler than tracking all sources)
      ctx.close().catch(() => {});
      this.audioContext = null;
      this.masterGain = null;
    }

    if (this._playbackState !== 'stopped') {
      this._playbackState = 'stopped';
      this.onStateChange?.(this._playbackState);
    }
    this.stopAnimationFrame();
  }

  seek(position: number): void {
    this._cursorPosition = position;
    this.pausePosition = position;
    if (this._playbackState === 'playing') {
      // Restart playback from new position - handled by caller with tracks
    }
    this.onCursorChange?.(position);
  }

  private startAnimationFrame(): void {
    if (this.animationFrameId !== null) return;
    const tick = () => {
      const ctx = this.audioContext;
      if (ctx && this._playbackState === 'playing') {
        let pos = ctx.currentTime - this.startTime;
        if (this.playbackLoop) {
          const wrapped = wrapLoopCursor(this.startTime, ctx.currentTime, this.playbackLoop);
          this.startTime = wrapped.startTime;
          pos = wrapped.position;
        }
        this._cursorPosition = pos;
        this.onCursorChange?.(pos);
      }
      this.animationFrameId = requestAnimationFrame(tick);
    };
    this.animationFrameId = requestAnimationFrame(tick);
  }

  private stopAnimationFrame(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  // Recording — AudioWorklet 优先，不支持时降级为 ScriptProcessorNode
  async startRecording(options?: { stereo?: boolean }): Promise<void> {
    // Audacity AudioIO::StartStream and ProjectAudioManager::DoRecord reject
    // busy reentry. A Worklet stop remains busy through its tail flush and
    // cleanup, so wait for that shared stop instead of silently treating a
    // rapid restart as an already-active session. Concurrent callers then
    // coalesce through recordingStartPromise below.
    const pendingStop = this.recordingStopPromise;
    if (pendingStop) {
      // The start is already requested while it waits for the old Worklet tail.
      // Track that waiter before awaiting so a repeated Stop or editor teardown
      // can invalidate it instead of opening a new microphone after the wait.
      const waitingGeneration = this.recordingGeneration;
      this.recordingStartWaiters += 1;
      try {
        await pendingStop;
      } finally {
        this.recordingStartWaiters -= 1;
      }
      if (waitingGeneration !== this.recordingGeneration) return;
    }
    if (this._recordingState === 'recording') return;
    if (this.recordingStartPromise) {
      const pending = this.recordingStartPromise;
      const joinedGeneration = this.recordingGeneration;
      await pending;
      // Callers that joined before a stop must stay cancelled. A caller that
      // arrives after that stop may start a fresh session once the stale
      // permission request has settled and released its stream.
      if (joinedGeneration !== this.recordingGeneration) return;
      if (this.recordingStartPromise) return;
      return this.startRecording(options);
    }
    const generation = ++this.recordingGeneration;
    const pending = this.startRecordingInternal(options, generation);
    this.recordingStartPromise = pending;
    try {
      await pending;
    } finally {
      if (this.recordingStartPromise === pending) this.recordingStartPromise = null;
    }
  }

  private async startRecordingInternal(
    options: { stereo?: boolean } | undefined,
    generation: number,
  ): Promise<void> {
    // Audacity uses one input graph: recording takes over any stopped-state
    // meter/monitor stream, and inputMonitoring controls its audible sink.
    this.stopMicrophoneMonitoring();
    let stream: MediaStream;
    try {
      const audioConstraints: MediaTrackConstraints = {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      };
      if (options?.stereo) {
        (audioConstraints as MediaTrackConstraints & { channelCount: number }).channelCount = 2;
      }
      stream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints,
      });
      if (generation !== this.recordingGeneration) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      this.mediaStream = stream;
    } catch (e) {
      if (generation !== this.recordingGeneration) return;
      logger.error('麦克风权限被拒绝或不可用:', String(e));
      throw e;
    }

    try {
      const ctx = await this.ensureContext();
      if (generation !== this.recordingGeneration) return;
      const source = ctx.createMediaStreamSource(stream);
      // Register partial graph nodes immediately so startup failures cannot leak them.
      this._recordSource = source;
      // A separate analyser branch never feeds back into the captured samples.
      this.recordingMeter = this.createStereoMeter(ctx, source);
      const isStereo = options?.stereo ?? false;
      const deviceChannels = stream.getAudioTracks()[0]?.getSettings().channelCount;
      const inputChannels = isStereo
        ? Math.min(2, Math.max(1, deviceChannels ?? 2))
        : 1;
      const recordingSink = ctx.createGain();
      recordingSink.gain.value = this.inputMonitoringEnabled ? 1 : 0;
      recordingSink.connect(ctx.destination);
      this._recordingSink = recordingSink;

    this._recordingState = 'recording';
    this._recordingMode = 'worklet';
    this._recordedChunksL = [];
    this._recordedChunksR = [];
    this.recordingChunks = [];

    // 优先尝试 AudioWorklet
    let workletNode: AudioWorkletNode | null = null;
    let workletLoaded = false;

    if (
      ctx.audioWorklet &&
      typeof ctx.audioWorklet.addModule === 'function'
    ) {
      try {
        const workletUrl = this._workletUrl || this._resolveWorkletUrl();
        this._workletUrl = workletUrl;
        await ctx.audioWorklet.addModule(workletUrl);
        if (generation !== this.recordingGeneration) return;
        workletNode = new AudioWorkletNode(ctx, 'recording-processor', {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          channelCount: inputChannels,
          channelCountMode: 'explicit',
          outputChannelCount: [inputChannels],
        });
        workletNode.port.onmessage = (event) => {
          if (event.data?.type === 'recording') {
            const interleaved = event.data.audioData as Float32Array;
            const channels = Math.max(1, event.data.numChannels as number);
            const frames = Math.floor(interleaved.length / channels);
            const left = new Float32Array(frames);
            const right = channels > 1 ? new Float32Array(frames) : null;
            for (let i = 0; i < frames; i++) {
              left[i] = interleaved[i * channels];
              if (right) right[i] = interleaved[i * channels + 1];
            }
            this._recordedChunksL?.push(left);
            if (right) this._recordedChunksR?.push(right);
          } else if (event.data?.type === 'stopped') {
            this.recordingStopResolver?.();
          }
        };
        workletNode.port.postMessage({ type: 'init', stereo: isStereo });
        source.connect(workletNode);
        workletNode.connect(recordingSink);
        workletLoaded = true;
        logger.info('录音模式: AudioWorklet');
      } catch (e) {
        if (generation !== this.recordingGeneration) return;
        logger.warn('AudioWorklet 加载失败，降级到 ScriptProcessor:', String(e));
        if (workletNode) {
          // A partially connected worklet must not keep recording alongside the
          // ScriptProcessor fallback or deliver stale chunks after cleanup.
          workletNode.port.onmessage = null;
          try { source.disconnect(workletNode); } catch { /* already disconnected */ }
          try { workletNode.disconnect(); } catch { /* already disconnected */ }
          try { workletNode.port.close(); } catch { /* already closed */ }
          workletNode = null;
        }
        this._recordedChunksL = [];
        this._recordedChunksR = [];
      }
    }

    // 降级: ScriptProcessorNode（已废弃但所有浏览器都支持）
    if (!workletLoaded) {
      this._recordingMode = 'scriptprocessor';
      const bufferSize = 4096;
      const processor = ctx.createScriptProcessor(bufferSize, inputChannels, 1);
      this._scriptProcessor = processor;

      processor.onaudioprocess = (e) => {
        const channels = Math.min(inputChannels, e.inputBuffer.numberOfChannels);
        const left = new Float32Array(e.inputBuffer.length);
        left.set(e.inputBuffer.getChannelData(0));
        this._recordedChunksL?.push(left);
        if (isStereo) {
          // Audacity ConfigureCaptureRouting duplicates mono input into both
          // channels of a stereo track. Do the same for a temporarily missing
          // right block so later stereo frames cannot shift left in the output.
          const right = new Float32Array(e.inputBuffer.length);
          right.set(channels > 1 ? e.inputBuffer.getChannelData(1) : left);
          this._recordedChunksR?.push(right);
        }
      };

      source.connect(processor);
      processor.connect(recordingSink);
      logger.info('录音模式: ScriptProcessor (降级)');
    }

    this._workletNode = workletNode;

    // MediaRecorder 作为备份（用于显示编码格式等）
    try {
      this.mediaRecorder = new MediaRecorder(stream);
      this.mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) this.recordingChunks.push(e.data);
      };
      this.mediaRecorder.start();
    } catch {
      this.mediaRecorder = null;
    }
    } catch (error) {
      // Stop owns cleanup after cancellation; a stale startup must not tear
      // down a newer recording session or surface a cancelled request error.
      if (generation !== this.recordingGeneration) return;
      this._cleanupRecording();
      this._recordingState = 'idle';
      throw error;
    }
  }

  async stopRecording(): Promise<Float32Array[] | null> {
    // Audacity ProjectAudioManager::Stop marks the project as stopping before
    // AudioIO::StopStream performs its one-shot stream cleanup. Coalesce the
    // asynchronous Worklet tail wait too, so every caller observes the same
    // result and only one stop message/cleanup path can run.
    if (this.recordingStopPromise) {
      if (this.recordingStartWaiters > 0) this.recordingGeneration += 1;
      return this.recordingStopPromise;
    }
    const pending = this.stopRecordingInternal();
    this.recordingStopPromise = pending;
    try {
      return await pending;
    } finally {
      if (this.recordingStopPromise === pending) this.recordingStopPromise = null;
    }
  }

  private async stopRecordingInternal(): Promise<Float32Array[] | null> {
    if (this.recordingStartPromise || this.recordingStartWaiters > 0) {
      // Invalidate every await boundary in pending startups, including restarts
      // still waiting for an earlier stop. If permission has not resolved yet,
      // the local stream is stopped as soon as it arrives.
      this.recordingGeneration += 1;
    }
    if (this._recordingState !== 'recording') {
      if (this.recordingStartPromise) {
        this._cleanupRecording();
        this._recordingState = 'idle';
      }
      return null;
    }

    // Let the Worklet flush its final partial 4096-frame block before stopping
    // the microphone stream and disconnecting the graph.
    if (this._workletNode) {
      const node = this._workletNode;
      await new Promise<void>((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          this.recordingStopResolver = null;
          resolve();
        };
        const timer = setTimeout(finish, 500);
        this.recordingStopResolver = finish;
        try {
          node.port.postMessage({ type: 'stop' });
        } catch {
          finish();
        }
      });
    }

    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      try {
        this.mediaRecorder.stop();
      } catch (error) {
        // MediaRecorder is only an optional encoded backup. Its failure must
        // not abort primary PCM finalization or leave the microphone graph alive.
        logger.warn('MediaRecorder 备份停止失败，继续保存 PCM 录音:', String(error));
      }
    }

    // 合并录音块（左声道一定有，右声道只有立体声模式才有）
    const chunksL = this._recordedChunksL ?? [];
    const chunksR = this._recordedChunksR ?? [];

    let totalLength = 0;
    for (const c of chunksL) totalLength += c.length;

    if (totalLength === 0) {
      this._cleanupRecording();
      this._recordingState = 'idle';
      return null;
    }

    const left = new Float32Array(totalLength);
    let offset = 0;
    for (const c of chunksL) {
      left.set(c, offset);
      offset += c.length;
    }

    let result: Float32Array[];
    if (chunksR.length > 0) {
      // 立体声
      let totalR = 0;
      for (const c of chunksR) totalR += c.length;
      const right = new Float32Array(totalLength);
      let rOff = 0;
      for (const c of chunksR) {
        const copyLength = Math.min(c.length, totalLength - rOff);
        if (copyLength <= 0) break;
        right.set(c.subarray(0, copyLength), rOff);
        rOff += copyLength;
      }
      // 如果右声道长度和左声道不一致，用左声道长度为准
      result = [left, right];
    } else {
      result = [left];
    }

    this._cleanupRecording();
    this._recordingState = 'idle';

    if (this.onRecordingData) {
      this.onRecordingData(result);
    }

    return result;
  }

  private _cleanupRecording(): void {
    // Match Audacity's guarded stop semantics: one broken graph node must not
    // prevent the remaining nodes, microphone tracks and PCM state from being
    // released. Clearing each reference before its operation also makes a
    // repeated stop idempotent after a partial browser failure.
    const cleanupStep = (label: string, operation: () => void): void => {
      try {
        operation();
      } catch (error) {
        logger.warn(`录音清理 ${label} 失败，继续释放剩余资源:`, String(error));
      }
    };

    this.recordingStopResolver = null;
    const mediaRecorder = this.mediaRecorder;
    this.mediaRecorder = null;
    if (mediaRecorder) {
      // The final dataavailable event is asynchronous and can arrive after a
      // new session has started. Detach it before releasing the input graph so
      // an old encoded blob cannot contaminate the replacement recording.
      cleanupStep('清除 MediaRecorder 回调', () => { mediaRecorder.ondataavailable = null; });
    }
    this.recordingChunks = [];
    this.disposeStereoMeter(this.recordingMeter);
    this.recordingMeter = null;

    const workletNode = this._workletNode;
    this._workletNode = null;
    if (workletNode) {
      cleanupStep('清除 AudioWorklet 回调', () => { workletNode.port.onmessage = null; });
      cleanupStep('断开 AudioWorklet', () => { workletNode.disconnect(); });
      cleanupStep('关闭 AudioWorklet 端口', () => { workletNode.port.close(); });
    }

    const processor = this._scriptProcessor;
    this._scriptProcessor = null;
    if (processor) {
      cleanupStep('清除 ScriptProcessor 回调', () => { processor.onaudioprocess = null; });
      cleanupStep('断开 ScriptProcessor', () => { processor.disconnect(); });
    }

    const recordingSink = this._recordingSink;
    this._recordingSink = null;
    if (recordingSink) {
      cleanupStep('断开录音输出', () => { recordingSink.disconnect(); });
    }

    const recordSource = this._recordSource;
    this._recordSource = null;
    if (recordSource) {
      cleanupStep('断开录音输入', () => { recordSource.disconnect(); });
    }

    const mediaStream = this.mediaStream;
    this.mediaStream = null;
    if (mediaStream) {
      for (const track of mediaStream.getTracks()) {
        cleanupStep('停止麦克风轨道', () => { track.stop(); });
      }
    }
    this._recordedChunksL = null;
    this._recordedChunksR = null;
  }

  // Offline stereo mixdown for export (supports pan, multi-channel clips, fade in/out)
  async renderMixdownStereo(
    tracks: ITrack[],
    duration: number,
    sampleRate: number,
  ): Promise<[Float32Array, Float32Array]> {
    const totalSamples = Math.floor(duration * sampleRate);
    const left = new Float32Array(totalSamples);
    const right = new Float32Array(totalSamples);

    for (const track of tracks) {
      if (track.muted) continue;
      const trackGainLin = Math.pow(10, track.gain / 20);
      const pan = Math.max(-1, Math.min(1, track.pan));
      // Mono uses constant-power panning. Stereo clips instead use balance
      // panning so centre position preserves both original channel levels.
      const panAngle = ((pan + 1) / 2) * (Math.PI / 2);
      const monoPanL = Math.cos(panAngle);
      const monoPanR = Math.sin(panAngle);
      const stereoPanL = pan > 0 ? Math.cos((pan * Math.PI) / 2) : 1;
      const stereoPanR = pan < 0 ? Math.cos((-pan * Math.PI) / 2) : 1;

      for (const clip of track.clips) {
        const cachedEntry = this.bufferCache.get(clip.audioBufferId);
        if (!cachedEntry || cachedEntry.channelData.length === 0) continue;
        cachedEntry.lastUsed = Date.now();
        const playback = this.getClipPlaybackBuffer(clip, cachedEntry);
        const cached = playback.channelData;
        const numCh = cached.length;
        const startSample = Math.floor(clip.startTime * sampleRate);
        const offsetSample = Math.floor(playback.sourceOffset * sampleRate);
        const durationSamples = Math.floor(clip.duration * sampleRate);
        const clipGainLin = trackGainLin * Math.pow(10, clip.gain / 20);
        const endSample = Math.min(startSample + durationSamples, totalSamples);

        for (let i = startSample, j = offsetSample; i < endSample && j < offsetSample + durationSamples; i++, j++) {
          if (j >= (cached[0]?.length ?? 0)) break;
          let fadeGain = 1;
          const posInClip = j - offsetSample;

          if (clip.fadeIn > 0 && posInClip < clip.fadeIn * sampleRate) {
            fadeGain = posInClip / (clip.fadeIn * sampleRate);
          }
          if (
            clip.fadeOut > 0 &&
            posInClip > durationSamples - clip.fadeOut * sampleRate
          ) {
            const fadePos = posInClip - (durationSamples - clip.fadeOut * sampleRate);
            fadeGain = 1 - fadePos / (clip.fadeOut * sampleRate);
          }

          const g = clipGainLin * Math.max(0, fadeGain);
          const firstChannel = cached[0][j];
          if (numCh === 1) {
            left[i] += firstChannel * g * monoPanL;
            right[i] += firstChannel * g * monoPanR;
          } else {
            left[i] += firstChannel * g * stereoPanL;
            right[i] += (cached[1]?.[j] ?? firstChannel) * g * stereoPanR;
          }
        }
      }
    }

    return [left, right];
  }

  // Export to WAV (stereo)
  async exportWav(
    tracks: ITrack[],
    duration: number,
    sampleRate: number,
    bitDepth: 16 | 32 = 16,
  ): Promise<Blob> {
    const [left, right] = await this.renderMixdownStereo(tracks, duration, sampleRate);
    const interleaved = interleaveChannels([left, right]);

    let wavBytes: Uint8Array;
    if (bitDepth === 32) {
      wavBytes = wasmProcessor.encodeWavFloat32(interleaved, 2, sampleRate);
    } else {
      wavBytes = wasmProcessor.encodeWavPcm16(interleaved, 2, sampleRate);
    }

    return new Blob([wavBytes.buffer as ArrayBuffer], { type: 'audio/wav' });
  }

  // Export to MP3 (stereo, real lamejs encoder)
  async exportMp3(
    tracks: ITrack[],
    duration: number,
    sampleRate: number,
    bitrate: number = 128,
  ): Promise<Blob> {
    const outputSampleRate = getMp3SampleRate(sampleRate);
    const [left, right] = await this.renderMixdownStereo(tracks, duration, outputSampleRate);
    return encodeMp3([left, right], outputSampleRate, bitrate);
  }

  destroy(): void {
    this.stopPlayback();
    void this.stopRecording();
    this.clearCache();
    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }
  }
}

export const audioEngine = new AudioEngine();
