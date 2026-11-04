// EXPORTS: audioEngine, AudioEngine, PlaybackState, RecordingState

import { logger } from '@/lib/logger';
import { wasmProcessor } from '@/wasm/processor';
import { clamp, interleaveChannels } from '@/lib/audioUtils';
import { encodeMp3, getMp3SampleRate } from '@/engine/mp3Encoder';
import type { ITrack, IClip, IEffect } from '@/types/project';

export type PlaybackState = 'stopped' | 'playing' | 'paused';
export type RecordingState = 'idle' | 'recording';

interface AudioBufferCacheEntry {
  bufferId: string;
  channelData: Float32Array[];
  sampleRate: number;
  lastUsed: number;
}

export class AudioEngine {
  private audioContext: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private _playbackState: PlaybackState = 'stopped';
  private _recordingState: RecordingState = 'idle';
  private startTime = 0;
  private pausePosition = 0;
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

  private bufferCache = new Map<string, AudioBufferCacheEntry>();
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const Ctx = (window.AudioContext || (window as any).webkitAudioContext);
      this.audioContext = new Ctx();
      this.sampleRate = this.audioContext.sampleRate;
      this.masterGain = this.audioContext.createGain();
      this.masterGain.gain.value = 1;
      this.masterGain.connect(this.audioContext.destination);
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
  }

  clearCache(): void {
    this.bufferCache.clear();
  }

  // Simple Web Audio playback using scheduled buffers
  async play(tracks: ITrack[], startPosition: number, isSoloActive: boolean): Promise<void> {
    // Stop and dispose the previous context before creating a fresh one.
    // Calling stopPlayback after ensureContext would close the context we are about to use.
    this.stopPlayback();
    const ctx = await this.ensureContext();

    this._playbackState = 'playing';
    this._cursorPosition = startPosition;
    this.onStateChange?.(this._playbackState);

    // For each track, schedule buffer playback
    const now = ctx.currentTime;
    this.startTime = now - startPosition;

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
      let chainInput: AudioNode = panNode;
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

        const { channelData, sampleRate: bufferSampleRate } = cachedEntry;
        const channelCount = Math.min(2, channelData.length);
        const frameLength = Math.min(...channelData.slice(0, channelCount).map((channel) => channel.length));
        if (!Number.isFinite(frameLength) || frameLength <= 0) continue;

        const buffer = ctx.createBuffer(channelCount, frameLength, bufferSampleRate);
        for (let channelIndex = 0; channelIndex < channelCount; channelIndex++) {
          buffer.getChannelData(channelIndex).set(channelData[channelIndex].subarray(0, frameLength));
        }

        const source = ctx.createBufferSource();
        source.buffer = buffer;

        const clipGain = ctx.createGain();
        clipGain.gain.value = Math.pow(10, clip.gain / 20);

        // Apply fade in/out via gain automation
        const clipStart = clip.startTime;
        const clipEnd = clip.startTime + clip.duration;

        if (clipStart >= startPosition) {
          // Clip starts after current position
          const when = now + (clipStart - startPosition);
          source.connect(clipGain);
          clipGain.connect(trackGain);
          source.start(when, clip.offset, clip.duration);

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
        } else if (clipEnd > startPosition) {
          // Clip already started, resume from middle
          const offsetInClip = startPosition - clipStart + clip.offset;
          const remaining = clip.duration - (startPosition - clipStart);
          source.connect(clipGain);
          clipGain.connect(trackGain);
          source.start(now, offsetInClip, remaining);

          // Fade out
          if (clip.fadeOut > 0) {
            const timeToEnd = clipEnd - startPosition;
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

  private createEffectNode(
    ctx: AudioContext,
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
          filter.frequency.value = effect.params.frequency ?? 80;
          filter.Q.value = effect.params.q ?? 1;
          return { input: filter, output: filter };
        }
        case 'lowPass': {
          const filter = ctx.createBiquadFilter();
          filter.type = 'lowpass';
          filter.frequency.value = effect.params.frequency ?? 8000;
          filter.Q.value = effect.params.q ?? 1;
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
    const ctx = this.audioContext;
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
        const pos = ctx.currentTime - this.startTime;
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
    try {
      const audioConstraints: MediaTrackConstraints = {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      };
      if (options?.stereo) {
        (audioConstraints as MediaTrackConstraints & { channelCount: number }).channelCount = 2;
      }
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints,
      });
    } catch (e) {
      logger.error('麦克风权限被拒绝或不可用:', String(e));
      throw e;
    }

    const ctx = await this.ensureContext();
    const source = ctx.createMediaStreamSource(this.mediaStream);
    const isStereo = options?.stereo ?? false;
    const recordingSink = ctx.createGain();
    recordingSink.gain.value = 0;
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
        workletNode = new AudioWorkletNode(ctx, 'recording-processor', {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [isStereo ? 2 : 1],
        });
        workletNode.port.onmessage = (event) => {
          if (event.data?.type === 'data') {
            if (event.data.left) {
              this._recordedChunksL!.push(event.data.left);
            }
            if (event.data.right) {
              this._recordedChunksR!.push(event.data.right);
            }
          }
        };
        workletNode.port.postMessage({ type: 'init', stereo: isStereo });
        source.connect(workletNode);
        workletNode.connect(recordingSink);
        workletLoaded = true;
        logger.info('录音模式: AudioWorklet');
      } catch (e) {
        logger.warn('AudioWorklet 加载失败，降级到 ScriptProcessor:', String(e));
        workletNode = null;
      }
    }

    // 降级: ScriptProcessorNode（已废弃但所有浏览器都支持）
    if (!workletLoaded) {
      this._recordingMode = 'scriptprocessor';
      const bufferSize = 4096;
      const processor = ctx.createScriptProcessor(bufferSize, 1, 1);

      processor.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);
        const chunk = new Float32Array(inputData.length);
        chunk.set(inputData);
        this._recordedChunksL!.push(chunk);
      };

      source.connect(processor);
      processor.connect(recordingSink);
      this._scriptProcessor = processor;
      logger.info('录音模式: ScriptProcessor (降级)');
    }

    this._recordSource = source;
    this._workletNode = workletNode;

    // MediaRecorder 作为备份（用于显示编码格式等）
    try {
      this.mediaRecorder = new MediaRecorder(this.mediaStream);
      this.mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) this.recordingChunks.push(e.data);
      };
      this.mediaRecorder.start();
    } catch {
      this.mediaRecorder = null;
    }
  }

  stopRecording(): Float32Array[] | null {
    if (this._recordingState !== 'recording') return null;

    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
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
    if (this._workletNode) {
      try {
        this._workletNode.disconnect();
        this._workletNode.port.close();
      } catch {
        // ignore
      }
      this._workletNode = null;
    }
    if (this._scriptProcessor) {
      this._scriptProcessor.disconnect();
      this._scriptProcessor = null;
    }
    if (this._recordingSink) {
      this._recordingSink.disconnect();
      this._recordingSink = null;
    }
    if (this._recordSource) {
      this._recordSource.disconnect();
      this._recordSource = null;
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((t) => t.stop());
      this.mediaStream = null;
    }
    this.mediaRecorder = null;
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
      // Constant-power pan law
      const pan = Math.max(-1, Math.min(1, track.pan));
      const panAngle = ((pan + 1) / 2) * (Math.PI / 2);
      const panL = Math.cos(panAngle);
      const panR = Math.sin(panAngle);

      for (const clip of track.clips) {
        const cached = this.getCachedBuffer(clip.audioBufferId);
        if (!cached || cached.length === 0) continue;
        const numCh = cached.length;
        const startSample = Math.floor(clip.startTime * sampleRate);
        const offsetSample = Math.floor(clip.offset * sampleRate);
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
          const sL = numCh === 1 ? cached[0][j] : cached[0][j];
          const sR = numCh === 1 ? cached[0][j] : (cached[1]?.[j] ?? cached[0][j]);
          left[i] += sL * g * panL;
          right[i] += sR * g * panR;
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
    this.stopRecording();
    this.clearCache();
    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }
  }
}

export const audioEngine = new AudioEngine();
