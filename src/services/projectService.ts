// EXPORTS: projectService, ProjectService

import { logger } from '@/lib/logger';
import {
  audioDb,
  serializeTracks,
  deserializeTracks,
  serializeSelection,
  deserializeSelection,
  type ProjectRecord,
} from '@/db/audioDb';
import { generateId, getTrackColor } from '@/lib/audioUtils';
import type { IProject, IProjectSummary, ITrack, IClip, IPreferences, IEffect } from '@/types/project';
import { validateTempo, validateTimeSignature } from '@/lib/musicalTiming';
import { audioEngine } from '@/engine/audioEngine';
import { wasmProcessor } from '@/wasm/processor';
import { silenceClipSelection } from '@/lib/silenceGenerator';
import {
  getClipSampleRange,
  replaceTrackSelectionWithClip,
  type GeneratorSelection,
} from '@/lib/generatorEditing';
import { processWahWahChannels, type WahWahSettings } from '@/lib/wahWahEffect';
import {
  createBassTrebleState,
  isBassTrebleBypassed,
  processBassTrebleChannels,
  validateBassTrebleSettings,
  type BassTrebleSettings,
} from '@/lib/bassTrebleEffect';
import {
  isAmplifyAllowed,
  measureAmplifyPeak,
  processAmplifyChannels,
  validateAmplifySettings,
  type AmplifySettings,
} from '@/lib/amplifyEffect';
import {
  createNormalizePlan,
  isNormalizeBypassed,
  processNormalizeChannels,
  validateNormalizeSettings,
  type NormalizeSettings,
} from '@/lib/normalizeEffect';
import { insertRepeatedSelectionClips, validateRepeatCount } from '@/lib/repeatEditing';
import {
  createEchoState,
  getEchoClipSampleRange,
  getEchoPlan,
  MAX_ECHO_TOTAL_HISTORY_SAMPLES,
  processEchoSelection,
} from '@/lib/echoEffect';
import {
  changeTempoRatio,
  durationAfterChangeTempo,
  isChangeTempoBypassed,
  processChangeTempoChannels,
  validateChangeTempoSettings,
  type ChangeTempoSettings,
} from '@/lib/changeTempoEffect';

type EffectType = IEffect['type'];

export interface GeneratedTrackAudio {
  trackId: string;
  sampleData: Float32Array[];
}

export interface EchoClipAudio {
  clipId: string;
  sampleData: Float32Array[];
  sourceOffset: number;
}

export interface EchoTrackAudio {
  trackId: string;
  clips: EchoClipAudio[];
}

export type WahWahClipAudio = EchoClipAudio;
export type WahWahTrackAudio = EchoTrackAudio;
export type BassTrebleClipAudio = EchoClipAudio;
export type BassTrebleTrackAudio = EchoTrackAudio;
export type AmplifyClipAudio = EchoClipAudio;
export type AmplifyTrackAudio = EchoTrackAudio;
export type NormalizeClipAudio = EchoClipAudio;
export type NormalizeTrackAudio = EchoTrackAudio;
export type ChangeTempoClipAudio = EchoClipAudio;
export type ChangeTempoTrackAudio = EchoTrackAudio;

interface PendingAudioBuffer {
  id: string;
  sampleRate: number;
  sampleData: Float32Array[];
}

const PREFS_KEY = '__audacity_web_prefs';
// Bound staged Float32 PCM across all channels before a multi-track tempo commit.
const MAX_CHANGE_TEMPO_TOTAL_OUTPUT_SAMPLES = 20_000_000;

const DEFAULT_PREFS: IPreferences = {
  theme: 'dark',
  defaultSampleRate: 44100,
  defaultFormat: 'wav',
  bufferSize: 512,
  language: 'zh-CN',
  autoSave: true,
  autoBackup: true,
  maxRecordingDuration: 600,
  useWasm: true,
};

class ProjectService {
  private currentProject: IProject | null = null;
  private currentProjectId: string | null = null;

  constructor() {
    // Load from localStorage on init if needed
  }

  getPreferences(): IPreferences {
    try {
      const stored = localStorage.getItem(PREFS_KEY);
      if (stored) {
        return { ...DEFAULT_PREFS, ...JSON.parse(stored) };
      }
    } catch (e) {
      logger.warn('Failed to load preferences:', String(e));
    }
    return { ...DEFAULT_PREFS };
  }

  savePreferences(prefs: IPreferences): void {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch (e) {
      logger.error('Failed to save preferences:', String(e));
    }
  }

  // Project list operations
  async listProjects(includeDeleted = false): Promise<IProjectSummary[]> {
    let query = audioDb.projects.orderBy('updatedAt').reverse();
    if (!includeDeleted) {
      query = query.filter((p) => p.status === 'active') as typeof query;
    }
    const records = await query.toArray();
    return records.map((r) => this.recordToSummary(r));
  }

  async listDeletedProjects(): Promise<IProjectSummary[]> {
    const records = await audioDb.projects
      .filter((p) => p.status === 'deleted')
      .sortBy('deletedAt');
    return records.reverse().map((r) => this.recordToSummary(r));
  }

  async getProject(id: string): Promise<IProject | null> {
    const record = await audioDb.projects.get(id);
    if (!record) return null;
    return this.recordToProject(record);
  }

  async createProject(name: string, sampleRate = 44100): Promise<IProject> {
    const id = generateId();
    const now = Date.now();
    const track1 = this.createDefaultTrack(0);

    const project: IProject = {
      id,
      name,
      sampleRate,
      timeSignature: { numerator: 4, denominator: 4 },
      tempo: 120,
      tracks: [track1],
      cursorPosition: 0,
      selection: null,
      viewState: {
        horizontalZoom: 50,
        verticalZoom: 1,
        scrollX: 0,
        viewMode: 'waveform',
      },
      updatedAt: now,
      createdAt: now,
    };

    const record = this.projectToRecord(project);
    await audioDb.projects.put(record);

    this.currentProject = project;
    this.currentProjectId = id;

    return project;
  }

  async saveProject(project: IProject): Promise<void> {
    project.updatedAt = Date.now();
    const record = this.projectToRecord(project);
    await audioDb.projects.put(record);
    this.currentProject = project;
  }

  async openProject(id: string): Promise<IProject | null> {
    const project = await this.getProject(id);
    if (project) {
      this.currentProject = project;
      this.currentProjectId = id;
    }
    return project;
  }

  async renameProject(id: string, name: string): Promise<void> {
    const record = await audioDb.projects.get(id);
    if (!record) return;
    record.name = name;
    record.updatedAt = Date.now();
    await audioDb.projects.put(record);
    if (this.currentProject?.id === id) {
      this.currentProject.name = name;
    }
  }

  async deleteProject(id: string): Promise<void> {
    const record = await audioDb.projects.get(id);
    if (!record) return;
    record.status = 'deleted';
    record.deletedAt = Date.now();
    record.updatedAt = Date.now();
    await audioDb.projects.put(record);
  }

  async restoreProject(id: string): Promise<void> {
    const record = await audioDb.projects.get(id);
    if (!record) return;
    record.status = 'active';
    record.deletedAt = undefined;
    record.updatedAt = Date.now();
    await audioDb.projects.put(record);
  }

  async permanentlyDeleteProject(id: string): Promise<void> {
    await audioDb.projects.delete(id);
    // Also delete all associated audio buffers
    const buffers = await audioDb.audioBuffers.where('projectId').equals(id).toArray();
    for (const buf of buffers) {
      await audioDb.audioBuffers.delete(buf.id);
      audioEngine.evictBuffer(buf.id);
    }
  }

  async clearDeletedProjects(): Promise<void> {
    const deleted = await audioDb.projects.filter((p) => p.status === 'deleted').toArray();
    for (const p of deleted) {
      await this.permanentlyDeleteProject(p.id);
    }
  }

  // Track operations
  async addTrack(projectId: string): Promise<ITrack | null> {
    const project = this.currentProject?.id === projectId
      ? this.currentProject
      : await this.getProject(projectId);
    if (!project) return null;

    const newTrack = this.createDefaultTrack(project.tracks.length);
    project.tracks.push(newTrack);
    await this.saveProject(project);
    return newTrack;
  }

  async removeTrack(projectId: string, trackId: string): Promise<void> {
    const project = this.currentProject?.id === projectId
      ? this.currentProject
      : await this.getProject(projectId);
    if (!project || project.tracks.length <= 1) return;

    // Delete associated audio buffers for clips on this track
    const track = project.tracks.find((t) => t.id === trackId);
    if (track) {
      for (const clip of track.clips) {
        await audioDb.audioBuffers.delete(clip.audioBufferId);
        audioEngine.evictBuffer(clip.audioBufferId);
      }
    }

    project.tracks = project.tracks.filter((t) => t.id !== trackId);
    await this.saveProject(project);
  }

  async updateTrack(projectId: string, trackId: string, updates: Partial<ITrack>): Promise<void> {
    const project = this.currentProject?.id === projectId
      ? this.currentProject
      : await this.getProject(projectId);
    if (!project) return;

    const track = project.tracks.find((t) => t.id === trackId);
    if (!track) return;

    Object.assign(track, updates);
    await this.saveProject(project);
  }

  // Clip operations - import audio to a track
  async importAudioToTrack(
    projectId: string,
    trackId: string,
    file: File,
    startTime: number,
    onProgress?: (progress: number) => void,
  ): Promise<IClip | null> {
    const project = this.currentProject?.id === projectId
      ? this.currentProject
      : await this.getProject(projectId);
    if (!project) return null;

    const track = project.tracks.find((t) => t.id === trackId);
    if (!track) return null;

    onProgress?.(0.1);

    // Decode
    const decoded = await audioEngine.decodeAudioFile(file);

    onProgress?.(0.5);

    // Convert to project sample rate if different
    let channelData = decoded.channelData;
    let sampleRate = decoded.sampleRate;

    if (sampleRate !== project.sampleRate) {
      // Use Web Audio for resampling
      const ctx = await audioEngine.ensureContext();
      const tempBuffer = ctx.createBuffer(
        channelData.length,
        channelData[0].length,
        sampleRate,
      );
      for (let c = 0; c < channelData.length; c++) {
        tempBuffer.getChannelData(c).set(channelData[c]);
      }

      const offlineCtx = new OfflineAudioContext(
        channelData.length,
        Math.floor(channelData[0].length * (project.sampleRate / sampleRate)),
        project.sampleRate,
      );
      const src = offlineCtx.createBufferSource();
      src.buffer = tempBuffer;
      src.connect(offlineCtx.destination);
      src.start();
      const rendered = await offlineCtx.startRendering();
      const newChannels: Float32Array[] = [];
      for (let c = 0; c < rendered.numberOfChannels; c++) {
        newChannels.push(rendered.getChannelData(c));
      }
      channelData = newChannels;
      sampleRate = project.sampleRate;
    }

    onProgress?.(0.8);

    // Preserve every decoded channel; mono is only a waveform display choice, not a storage step.
    const bufferId = generateId();
    const duration = channelData[0].length / sampleRate;
    const clip: IClip = {
      id: generateId(),
      audioBufferId: bufferId,
      startTime,
      offset: 0,
      duration,
      originalDuration: duration,
      stretchRatio: 1,
      gain: 0,
      fadeIn: 0,
      fadeOut: 0,
      name: file.name.replace(/\.[^.]+$/, ''),
    };
    const nextTrack = {
      ...track,
      clips: [...track.clips, clip].sort((a, b) => a.startTime - b.startTime),
    };
    const updatedProject: IProject = {
      ...project,
      tracks: project.tracks.map((candidate) => candidate.id === track.id ? nextTrack : candidate),
    };

    onProgress?.(0.95);

    // Store and commit the complete edit before exposing imported audio to playback.
    await this.commitPendingAudioBuffers(projectId, [
      { id: bufferId, sampleRate, sampleData: channelData },
    ], updatedProject);

    onProgress?.(1);

    return clip;
  }

  async addRecordingToTrack(
    projectId: string,
    trackId: string,
    sampleData: Float32Array[],
    sampleRate: number,
    startTime: number,
    clipName?: string,
    replaceSelection?: GeneratorSelection,
  ): Promise<IClip | null> {
    const project = this.currentProject?.id === projectId
      ? this.currentProject
      : await this.getProject(projectId);
    if (!project) return null;

    const track = project.tracks.find((t) => t.id === trackId);
    if (!track) return null;

    const bufferId = generateId();
    const length = sampleData[0]?.length ?? 0;
    const duration = length / sampleRate;
    const clip: IClip = {
      id: generateId(),
      audioBufferId: bufferId,
      startTime,
      offset: 0,
      duration,
      originalDuration: duration,
      stretchRatio: 1,
      gain: 0,
      fadeIn: 0,
      fadeOut: 0,
      name: clipName ?? `录音 ${new Date().toLocaleTimeString()}`,
    };

    // Validate and calculate the complete track edit before storing any bytes.
    const nextTrack = replaceSelection
      ? replaceTrackSelectionWithClip(track, replaceSelection, clip, generateId)
      : {
        ...track,
        clips: [...track.clips, clip].sort((a, b) => a.startTime - b.startTime),
      };

    const updatedProject: IProject = {
      ...project,
      tracks: project.tracks.map((candidate) => candidate.id === track.id ? nextTrack : candidate),
    };
    await this.commitPendingAudioBuffers(projectId, [
      { id: bufferId, sampleRate, sampleData },
    ], updatedProject);

    return clip;
  }

  private async storePendingAudioBuffers(
    projectId: string,
    buffers: readonly PendingAudioBuffer[],
  ): Promise<void> {
    for (const buffer of buffers) {
      const length = buffer.sampleData[0]?.length ?? 0;
      await audioDb.audioBuffers.put({
        id: buffer.id,
        projectId,
        sampleRate: buffer.sampleRate,
        channels: buffer.sampleData.length,
        length,
        duration: length / buffer.sampleRate,
        channelData: buffer.sampleData.map((channel) => channel.buffer as ArrayBuffer),
        createdAt: Date.now(),
      });
    }
  }

  /**
   * Commit generated audio like Audacity's temporary output tracks: expose the
   * project only after every byte is stored, or discard every staged buffer.
   */
  private async commitPendingAudioBuffers(
    projectId: string,
    buffers: readonly PendingAudioBuffer[],
    updatedProject: IProject,
  ): Promise<void> {
    try {
      await this.storePendingAudioBuffers(projectId, buffers);
      await this.saveProject(updatedProject);
    } catch (error) {
      const cleanupErrors: unknown[] = [];
      for (const buffer of buffers) {
        try {
          // Delete every pending id: a failed put may have reached storage
          // before reporting an uncertain outcome.
          await audioDb.audioBuffers.delete(buffer.id);
        } catch (cleanupError) {
          cleanupErrors.push(cleanupError);
        }
        try {
          audioEngine.evictBuffer(buffer.id);
        } catch (cleanupError) {
          cleanupErrors.push(cleanupError);
        }
      }
      if (cleanupErrors.length > 0) {
        throw new AggregateError(
          [error, ...cleanupErrors],
          `音频提交失败，且 ${cleanupErrors.length} 项临时缓冲清理失败`,
        );
      }
      throw error;
    }

    // A failed project commit must not leave playable orphan buffers behind.
    for (const buffer of buffers) {
      audioEngine.cacheBuffer(buffer.id, buffer.sampleData, buffer.sampleRate);
    }
  }

  /**
   * Generate into every selected track with one project commit. All target
   * edits are validated before bytes are stored, so an invalid track cannot
   * leave a partially edited project behind.
   */
  async addGeneratedAudioToTracks(
    projectId: string,
    targets: readonly GeneratedTrackAudio[],
    sampleRate: number,
    startTime: number,
    clipName: string,
    replaceSelection?: GeneratorSelection,
  ): Promise<IClip[]> {
    const project = this.currentProject?.id === projectId
      ? this.currentProject
      : await this.getProject(projectId);
    if (!project) throw new Error('工程不存在');
    if (targets.length === 0) return [];
    if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
      throw new RangeError('采样率必须大于零');
    }
    if (!Number.isFinite(startTime) || startTime < 0) {
      throw new RangeError('生成位置必须是非负有限时间');
    }

    const seen = new Set<string>();
    const nextTracks = new Map<string, ITrack>();
    const clips: IClip[] = [];
    const pendingBuffers: PendingAudioBuffer[] = [];

    for (const target of targets) {
      if (seen.has(target.trackId)) throw new Error(`轨道 ${target.trackId} 被重复指定`);
      seen.add(target.trackId);
      const track = project.tracks.find((candidate) => candidate.id === target.trackId);
      if (!track) throw new Error(`目标轨道不可用：${target.trackId}`);

      const sampleData = target.sampleData.map((channel) => new Float32Array(channel));
      const length = sampleData[0]?.length ?? 0;
      if (
        sampleData.length === 0
        || length < 1
        || sampleData.some((channel) => channel.length !== length)
      ) {
        throw new RangeError('生成音频必须包含等长的非空声道');
      }
      const duration = length / sampleRate;
      const bufferId = generateId();
      const clip: IClip = {
        id: generateId(),
        audioBufferId: bufferId,
        startTime,
        offset: 0,
        duration,
        originalDuration: duration,
        stretchRatio: 1,
        gain: 0,
        fadeIn: 0,
        fadeOut: 0,
        name: clipName,
      };
      const nextTrack = replaceSelection
        ? replaceTrackSelectionWithClip(track, replaceSelection, clip, generateId)
        : {
          ...track,
          clips: [...track.clips, clip].sort((a, b) => a.startTime - b.startTime),
        };
      nextTracks.set(track.id, nextTrack);
      clips.push(clip);
      pendingBuffers.push({ id: bufferId, sampleRate, sampleData });
    }

    const updatedProject: IProject = {
      ...project,
      tracks: project.tracks.map((track) => nextTracks.get(track.id) ?? track),
    };
    await this.commitPendingAudioBuffers(projectId, pendingBuffers, updatedProject);
    return clips;
  }

  /** Repeat each selected track with one atomic project commit. */
  async repeatSelectionOnTracks(
    projectId: string,
    selection: GeneratorSelection,
    repeatCount: number,
    targets: readonly GeneratedTrackAudio[],
  ): Promise<IClip[]> {
    const project = this.currentProject?.id === projectId
      ? this.currentProject
      : await this.getProject(projectId);
    if (!project) throw new Error('工程不存在');
    validateRepeatCount(repeatCount, project.sampleRate);
    if (
      !Number.isFinite(selection.start)
      || !Number.isFinite(selection.end)
      || selection.start < 0
      || selection.end <= selection.start
    ) throw new RangeError('重复选区必须是有限的正时长区间');
    if (targets.length === 0) throw new Error('选区内没有可重复的音频');

    const duration = selection.end - selection.start;
    const expectedLength = Math.round(duration * project.sampleRate);
    const seen = new Set<string>();
    const nextTracks = new Map<string, ITrack>();
    const pendingBuffers: PendingAudioBuffer[] = [];
    const insertedClips: IClip[] = [];

    for (const target of targets) {
      if (seen.has(target.trackId)) throw new Error(`轨道 ${target.trackId} 被重复指定`);
      seen.add(target.trackId);
      const track = project.tracks.find((candidate) => candidate.id === target.trackId);
      if (!track) throw new Error(`目标轨道不可用：${target.trackId}`);

      const sampleData = target.sampleData.map((channel) => new Float32Array(channel));
      if (
        sampleData.length === 0
        || expectedLength < 1
        || sampleData.some((channel) => channel.length !== expectedLength)
      ) throw new RangeError('每条轨道的重复音频必须包含与选区等长的非空声道');

      const bufferId = generateId();
      const template: IClip = {
        id: generateId(),
        audioBufferId: bufferId,
        startTime: selection.end,
        offset: 0,
        duration,
        originalDuration: duration,
        stretchRatio: 1,
        gain: 0,
        fadeIn: 0,
        fadeOut: 0,
        name: '重复选区',
      };
      const result = insertRepeatedSelectionClips(
        track,
        selection,
        repeatCount,
        template,
        generateId,
      );
      nextTracks.set(track.id, result.track);
      insertedClips.push(...result.insertedClips);
      pendingBuffers.push({ id: bufferId, sampleRate: project.sampleRate, sampleData });
    }

    const updatedProject: IProject = {
      ...project,
      // Audacity selects the original selection plus every newly inserted copy.
      selection: {
        start: selection.start,
        end: selection.end + duration * repeatCount,
      },
      tracks: project.tracks.map((track) => nextTracks.get(track.id) ?? track),
    };
    await this.commitPendingAudioBuffers(projectId, pendingBuffers, updatedProject);
    return insertedClips;
  }

  /** Apply Audacity Echo to every supplied track with one atomic project commit. */
  async echoSelectionOnTracks(
    projectId: string,
    selection: GeneratorSelection,
    delaySeconds: number,
    decay: number,
    targets: readonly EchoTrackAudio[],
  ): Promise<number> {
    if (
      !Number.isFinite(selection.start)
      || !Number.isFinite(selection.end)
      || selection.start < 0
      || selection.end <= selection.start
    ) {
      throw new RangeError('回声选区必须是有限的正时长区间');
    }
    const project = this.currentProject?.id === projectId
      ? this.currentProject
      : await this.getProject(projectId);
    if (!project) throw new Error('工程不存在');
    if (targets.length === 0) throw new Error('选区内没有可处理的音频');
    const plan = getEchoPlan(delaySeconds, decay, project.sampleRate);
    const totalHistorySamples = targets.reduce((total, target) => {
      const channels = target.clips.reduce((maximum, clip) => Math.max(maximum, clip.sampleData.length), 0);
      return total + channels * plan.delaySamples;
    }, 0);
    if (totalHistorySamples > MAX_ECHO_TOTAL_HISTORY_SAMPLES) {
      throw new RangeError('多轨回声历史超过浏览器总内存上限，请缩短延迟或减少轨道');
    }

    const seenTracks = new Set<string>();
    const nextTracks = new Map<string, ITrack>();
    const pendingBuffers: PendingAudioBuffer[] = [];
    let changedClips = 0;

    for (const target of targets) {
      if (seenTracks.has(target.trackId)) throw new Error(`轨道 ${target.trackId} 被重复指定`);
      seenTracks.add(target.trackId);
      const track = project.tracks.find((candidate) => candidate.id === target.trackId);
      if (!track) throw new Error(`目标轨道不可用：${target.trackId}`);
      const seenClips = new Set<string>();
      const ordered = target.clips.map((input) => {
        if (seenClips.has(input.clipId)) throw new Error(`片段 ${input.clipId} 被重复指定`);
        seenClips.add(input.clipId);
        const clip = track.clips.find((candidate) => candidate.id === input.clipId);
        if (!clip) throw new Error(`目标片段不可用：${input.clipId}`);
        return { input, clip };
      }).sort((left, right) => left.clip.startTime - right.clip.startTime);
      if (ordered.length === 0) throw new Error(`轨道 ${target.trackId} 没有可处理的选区音频`);

      const state = createEchoState(plan);
      const replacements = new Map<string, IClip>();
      for (const { input, clip } of ordered) {
        const channelLength = input.sampleData[0]?.length ?? 0;
        const range = getEchoClipSampleRange(
          clip,
          selection,
          input.sourceOffset,
          project.sampleRate,
          channelLength,
        );
        if (!range) throw new Error(`片段“${clip.name ?? clip.id}”不在回声选区内`);
        const processed = processEchoSelection(
          input.sampleData,
          range.startSample,
          range.endSample,
          state,
        );
        const bufferId = generateId();
        pendingBuffers.push({
          id: bufferId,
          sampleRate: project.sampleRate,
          sampleData: processed,
        });
        replacements.set(clip.id, {
          ...clip,
          audioBufferId: bufferId,
          offset: input.sourceOffset,
          originalDuration: processed[0].length / project.sampleRate,
          stretchRatio: 1,
        });
        changedClips += 1;
      }
      nextTracks.set(track.id, {
        ...track,
        clips: track.clips.map((clip) => replacements.get(clip.id) ?? clip),
      });
    }

    const updatedProject: IProject = {
      ...project,
      tracks: project.tracks.map((track) => nextTracks.get(track.id) ?? track),
    };
    await this.commitPendingAudioBuffers(projectId, pendingBuffers, updatedProject);
    return changedClips;
  }

  /** Apply pitch-preserving Change Tempo and warp the selected timeline atomically. */
  async changeTempoSelectionOnTracks(
    projectId: string,
    selection: GeneratorSelection,
    settings: ChangeTempoSettings,
    targets: readonly ChangeTempoTrackAudio[],
  ): Promise<number> {
    if (
      !Number.isFinite(selection.start)
      || !Number.isFinite(selection.end)
      || selection.start < 0
      || selection.end <= selection.start
    ) {
      throw new RangeError('Change Tempo 选区必须是有限的正时长区间');
    }
    validateChangeTempoSettings(settings);
    if (isChangeTempoBypassed(settings)) return 0;
    const project = this.currentProject?.id === projectId
      ? this.currentProject
      : await this.getProject(projectId);
    if (!project) throw new Error('工程不存在');
    if (targets.length === 0) throw new Error('选区内没有可处理的音频');
    const ratio = changeTempoRatio(settings);

    const seenTracks = new Set<string>();
    const prepared: {
      track: ITrack;
      input: ChangeTempoClipAudio;
      clip: IClip;
      range: { startSample: number; endSample: number };
      selectedChannels: Float32Array[];
    }[] = [];

    // Resolve and validate the complete multi-track plan before allocating output.
    for (const target of targets) {
      if (seenTracks.has(target.trackId)) throw new Error(`轨道 ${target.trackId} 被重复指定`);
      seenTracks.add(target.trackId);
      const track = project.tracks.find((candidate) => candidate.id === target.trackId);
      if (!track) throw new Error(`目标轨道不可用：${target.trackId}`);
      const seenClips = new Set<string>();
      const ordered = target.clips.map((input) => {
        if (seenClips.has(input.clipId)) throw new Error(`片段 ${input.clipId} 被重复指定`);
        seenClips.add(input.clipId);
        const clip = track.clips.find((candidate) => candidate.id === input.clipId);
        if (!clip) throw new Error(`目标片段不可用：${input.clipId}`);
        return { input, clip };
      }).sort((left, right) => left.clip.startTime - right.clip.startTime);
      if (ordered.length === 0) throw new Error(`轨道 ${target.trackId} 没有可处理的选区音频`);
      const selectedClipIds = track.clips.filter((clip) => (
        clip.startTime + clip.duration > selection.start && clip.startTime < selection.end
      )).map((clip) => clip.id);
      if (
        selectedClipIds.length !== ordered.length
        || selectedClipIds.some((clipId) => !seenClips.has(clipId))
      ) {
        throw new Error(`轨道 ${target.trackId} 的选区片段覆盖不完整`);
      }
      const channelCount = ordered[0]?.input.sampleData.length ?? 0;
      if (channelCount === 0) throw new Error(`轨道 ${target.trackId} 没有音频声道`);

      for (const { input, clip } of ordered) {
        if (input.sampleData.length !== channelCount) {
          throw new Error(`轨道 ${target.trackId} 的选区声道数不一致`);
        }
        const channelLength = input.sampleData[0]?.length ?? 0;
        const range = getClipSampleRange(
          clip,
          selection,
          input.sourceOffset,
          project.sampleRate,
          channelLength,
        );
        if (!range) throw new Error(`片段“${clip.name ?? clip.id}”不在 Change Tempo 选区内`);
        const selectedChannels = input.sampleData.map((channel) => (
          channel.slice(range.startSample, range.endSample)
        ));
        prepared.push({ track, input, clip, range, selectedChannels });
      }
    }

    let totalOutputSamples = 0;
    const rendered = prepared.map((item) => {
      const channelLength = item.input.sampleData[0]?.length ?? 0;
      const selectedLength = item.range.endSample - item.range.startSample;
      const stretchedLength = Math.max(1, Math.round(selectedLength / ratio));
      const fullLength = channelLength - selectedLength + stretchedLength;
      totalOutputSamples += fullLength * item.input.sampleData.length;
      if (
        !Number.isSafeInteger(fullLength)
        || fullLength < 1
        || !Number.isSafeInteger(totalOutputSamples)
        || totalOutputSamples > MAX_CHANGE_TEMPO_TOTAL_OUTPUT_SAMPLES
      ) {
        throw new RangeError('Change Tempo 输出超过浏览器内存上限，请缩短选区或减少轨道');
      }

      const stretched = processChangeTempoChannels(item.selectedChannels, settings, project.sampleRate);
      const processed = item.input.sampleData.map((channel, channelIndex) => {
        const next = new Float32Array(fullLength);
        next.set(channel.slice(0, item.range.startSample), 0);
        next.set(stretched[channelIndex], item.range.startSample);
        next.set(
          channel.slice(item.range.endSample),
          item.range.startSample + stretched[channelIndex].length,
        );
        return next;
      });
      return {
        ...item,
        bufferId: generateId(),
        processed,
        selectedLength,
        stretchedLength,
      };
    });

    const replacements = new Map<string, Map<string, IClip>>();
    const pendingBuffers: PendingAudioBuffer[] = rendered.map((item) => {
      const duration = item.clip.duration
        + (item.stretchedLength - item.selectedLength) / project.sampleRate;
      if (!Number.isFinite(duration) || duration <= 0) {
        throw new RangeError(`片段“${item.clip.name ?? item.clip.id}”的 Change Tempo 输出时长无效`);
      }
      const trackReplacements = replacements.get(item.track.id) ?? new Map<string, IClip>();
      trackReplacements.set(item.clip.id, {
        ...item.clip,
        audioBufferId: item.bufferId,
        offset: item.input.sourceOffset,
        duration,
        originalDuration: item.processed[0].length / project.sampleRate,
        stretchRatio: 1,
        fadeIn: Math.min(item.clip.fadeIn, duration),
        fadeOut: Math.min(item.clip.fadeOut, duration),
      });
      replacements.set(item.track.id, trackReplacements);
      return {
        id: item.bufferId,
        sampleRate: project.sampleRate,
        sampleData: item.processed,
      };
    });

    const oldSelectionDuration = selection.end - selection.start;
    const newSelectionDuration = durationAfterChangeTempo(oldSelectionDuration, settings);
    const timelineDelta = newSelectionDuration - oldSelectionDuration;
    const updatedProject: IProject = {
      ...project,
      selection: { start: selection.start, end: selection.start + newSelectionDuration },
      tracks: project.tracks.map((track) => {
        const trackReplacements = replacements.get(track.id);
        if (!trackReplacements) return track;
        return {
          ...track,
          clips: track.clips.map((clip) => {
            const replacement = trackReplacements.get(clip.id);
            if (replacement) {
              return {
                ...replacement,
                startTime: clip.startTime > selection.start
                  ? selection.start + (clip.startTime - selection.start) / ratio
                  : clip.startTime,
              };
            }
            if (clip.startTime >= selection.end) {
              return { ...clip, startTime: clip.startTime + timelineDelta };
            }
            return clip;
          }).sort((left, right) => left.startTime - right.startTime),
        };
      }),
    };
    await this.commitPendingAudioBuffers(projectId, pendingBuffers, updatedProject);
    return rendered.length;
  }

  /** Apply Audacity Wah Wah only inside the selection with one atomic project commit. */
  async wahWahSelectionOnTracks(
    projectId: string,
    selection: GeneratorSelection,
    settings: WahWahSettings,
    targets: readonly WahWahTrackAudio[],
  ): Promise<number> {
    if (
      !Number.isFinite(selection.start)
      || !Number.isFinite(selection.end)
      || selection.start < 0
      || selection.end <= selection.start
    ) {
      throw new RangeError('Wah Wah 选区必须是有限的正时长区间');
    }
    const project = this.currentProject?.id === projectId
      ? this.currentProject
      : await this.getProject(projectId);
    if (!project) throw new Error('工程不存在');
    if (targets.length === 0) throw new Error('选区内没有可处理的音频');

    const seenTracks = new Set<string>();
    const nextTracks = new Map<string, ITrack>();
    const pendingBuffers: PendingAudioBuffer[] = [];
    let changedClips = 0;

    for (const target of targets) {
      if (seenTracks.has(target.trackId)) throw new Error(`轨道 ${target.trackId} 被重复指定`);
      seenTracks.add(target.trackId);
      const track = project.tracks.find((candidate) => candidate.id === target.trackId);
      if (!track) throw new Error(`目标轨道不可用：${target.trackId}`);
      const seenClips = new Set<string>();
      const ordered = target.clips.map((input) => {
        if (seenClips.has(input.clipId)) throw new Error(`片段 ${input.clipId} 被重复指定`);
        seenClips.add(input.clipId);
        const clip = track.clips.find((candidate) => candidate.id === input.clipId);
        if (!clip) throw new Error(`目标片段不可用：${input.clipId}`);
        return { input, clip };
      }).sort((left, right) => left.clip.startTime - right.clip.startTime);
      if (ordered.length === 0) throw new Error(`轨道 ${target.trackId} 没有可处理的选区音频`);

      const replacements = new Map<string, IClip>();
      for (const { input, clip } of ordered) {
        const channelLength = input.sampleData[0]?.length ?? 0;
        const range = getClipSampleRange(
          clip,
          selection,
          input.sourceOffset,
          project.sampleRate,
          channelLength,
        );
        if (!range) throw new Error(`片段“${clip.name ?? clip.id}”不在 Wah Wah 选区内`);
        const selectedChannels = input.sampleData.map((channel) => (
          channel.slice(range.startSample, range.endSample)
        ));
        const filtered = processWahWahChannels(selectedChannels, settings, project.sampleRate);
        const processed = input.sampleData.map((channel, channelIndex) => {
          const next = new Float32Array(channel);
          next.set(filtered[channelIndex], range.startSample);
          return next;
        });
        const bufferId = generateId();
        pendingBuffers.push({ id: bufferId, sampleRate: project.sampleRate, sampleData: processed });
        replacements.set(clip.id, { ...clip, audioBufferId: bufferId });
        changedClips += 1;
      }
      nextTracks.set(track.id, {
        ...track,
        clips: track.clips.map((clip) => replacements.get(clip.id) ?? clip),
      });
    }

    const updatedProject: IProject = {
      ...project,
      tracks: project.tracks.map((track) => nextTracks.get(track.id) ?? track),
    };
    await this.commitPendingAudioBuffers(projectId, pendingBuffers, updatedProject);
    return changedClips;
  }

  /** Apply Audacity Bass and Treble with persistent per-channel state across selected clips. */
  async bassTrebleSelectionOnTracks(
    projectId: string,
    selection: GeneratorSelection,
    settings: BassTrebleSettings,
    targets: readonly BassTrebleTrackAudio[],
  ): Promise<number> {
    if (
      !Number.isFinite(selection.start)
      || !Number.isFinite(selection.end)
      || selection.start < 0
      || selection.end <= selection.start
    ) {
      throw new RangeError('低音和高音选区必须是有限的正时长区间');
    }
    validateBassTrebleSettings(settings);
    if (isBassTrebleBypassed(settings)) return 0;
    const project = this.currentProject?.id === projectId
      ? this.currentProject
      : await this.getProject(projectId);
    if (!project) throw new Error('工程不存在');
    if (targets.length === 0) throw new Error('选区内没有可处理的音频');

    const seenTracks = new Set<string>();
    const nextTracks = new Map<string, ITrack>();
    const pendingBuffers: PendingAudioBuffer[] = [];
    let changedClips = 0;

    for (const target of targets) {
      if (seenTracks.has(target.trackId)) throw new Error(`轨道 ${target.trackId} 被重复指定`);
      seenTracks.add(target.trackId);
      const track = project.tracks.find((candidate) => candidate.id === target.trackId);
      if (!track) throw new Error(`目标轨道不可用：${target.trackId}`);
      const seenClips = new Set<string>();
      const ordered = target.clips.map((input) => {
        if (seenClips.has(input.clipId)) throw new Error(`片段 ${input.clipId} 被重复指定`);
        seenClips.add(input.clipId);
        const clip = track.clips.find((candidate) => candidate.id === input.clipId);
        if (!clip) throw new Error(`目标片段不可用：${input.clipId}`);
        return { input, clip };
      }).sort((left, right) => left.clip.startTime - right.clip.startTime);
      if (ordered.length === 0) throw new Error(`轨道 ${target.trackId} 没有可处理的选区音频`);
      const channelCount = ordered[0]?.input.sampleData.length ?? 0;
      if (channelCount === 0) throw new Error(`轨道 ${target.trackId} 没有音频声道`);
      const states = Array.from(
        { length: channelCount },
        () => createBassTrebleState(settings, project.sampleRate),
      );

      const replacements = new Map<string, IClip>();
      for (const { input, clip } of ordered) {
        if (input.sampleData.length !== channelCount) {
          throw new Error(`轨道 ${target.trackId} 的选区声道数不一致`);
        }
        const channelLength = input.sampleData[0]?.length ?? 0;
        const range = getClipSampleRange(
          clip,
          selection,
          input.sourceOffset,
          project.sampleRate,
          channelLength,
        );
        if (!range) throw new Error(`片段“${clip.name ?? clip.id}”不在低音和高音选区内`);
        const selectedChannels = input.sampleData.map((channel) => (
          channel.slice(range.startSample, range.endSample)
        ));
        const filtered = processBassTrebleChannels(
          selectedChannels,
          settings,
          project.sampleRate,
          states,
        );
        const processed = input.sampleData.map((channel, channelIndex) => {
          const next = new Float32Array(channel);
          next.set(filtered[channelIndex], range.startSample);
          return next;
        });
        const bufferId = generateId();
        pendingBuffers.push({ id: bufferId, sampleRate: project.sampleRate, sampleData: processed });
        replacements.set(clip.id, { ...clip, audioBufferId: bufferId });
        changedClips += 1;
      }
      nextTracks.set(track.id, {
        ...track,
        clips: track.clips.map((clip) => replacements.get(clip.id) ?? clip),
      });
    }

    const updatedProject: IProject = {
      ...project,
      tracks: project.tracks.map((track) => nextTracks.get(track.id) ?? track),
    };
    await this.commitPendingAudioBuffers(projectId, pendingBuffers, updatedProject);
    return changedClips;
  }

  /** Apply Audacity Amplify with one shared peak and ratio across all targets. */
  async amplifySelectionOnTracks(
    projectId: string,
    selection: GeneratorSelection,
    settings: AmplifySettings,
    targets: readonly AmplifyTrackAudio[],
  ): Promise<number> {
    if (
      !Number.isFinite(selection.start)
      || !Number.isFinite(selection.end)
      || selection.start < 0
      || selection.end <= selection.start
    ) {
      throw new RangeError('放大选区必须是有限的正时长区间');
    }
    validateAmplifySettings(settings);
    const project = this.currentProject?.id === projectId
      ? this.currentProject
      : await this.getProject(projectId);
    if (!project) throw new Error('工程不存在');
    if (targets.length === 0) throw new Error('选区内没有可处理的音频');

    const seenTracks = new Set<string>();
    const selectedSegments: Float32Array[] = [];
    const prepared: {
      track: ITrack;
      input: AmplifyClipAudio;
      clip: IClip;
      range: { startSample: number; endSample: number };
      selectedChannels: Float32Array[];
    }[] = [];

    // Validate and analyse the complete selection before processing any clip.
    for (const target of targets) {
      if (seenTracks.has(target.trackId)) throw new Error(`轨道 ${target.trackId} 被重复指定`);
      seenTracks.add(target.trackId);
      const track = project.tracks.find((candidate) => candidate.id === target.trackId);
      if (!track) throw new Error(`目标轨道不可用：${target.trackId}`);
      const seenClips = new Set<string>();
      const ordered = target.clips.map((input) => {
        if (seenClips.has(input.clipId)) throw new Error(`片段 ${input.clipId} 被重复指定`);
        seenClips.add(input.clipId);
        const clip = track.clips.find((candidate) => candidate.id === input.clipId);
        if (!clip) throw new Error(`目标片段不可用：${input.clipId}`);
        return { input, clip };
      }).sort((left, right) => left.clip.startTime - right.clip.startTime);
      if (ordered.length === 0) throw new Error(`轨道 ${target.trackId} 没有可处理的选区音频`);
      const channelCount = ordered[0]?.input.sampleData.length ?? 0;
      if (channelCount === 0) throw new Error(`轨道 ${target.trackId} 没有音频声道`);

      for (const { input, clip } of ordered) {
        if (input.sampleData.length !== channelCount) {
          throw new Error(`轨道 ${target.trackId} 的选区声道数不一致`);
        }
        const channelLength = input.sampleData[0]?.length ?? 0;
        const range = getClipSampleRange(
          clip,
          selection,
          input.sourceOffset,
          project.sampleRate,
          channelLength,
        );
        if (!range) throw new Error(`片段“${clip.name ?? clip.id}”不在放大选区内`);
        const selectedChannels = input.sampleData.map((channel) => (
          channel.slice(range.startSample, range.endSample)
        ));
        selectedSegments.push(...selectedChannels);
        prepared.push({ track, input, clip, range, selectedChannels });
      }
    }

    const inputPeak = measureAmplifyPeak(selectedSegments);
    if (inputPeak <= 0) throw new Error('所选音频为静音，没有可放大的内容');
    if (!isAmplifyAllowed(settings, inputPeak)) {
      throw new Error('不允许削波时，放大后的峰值不能超过 0 dB');
    }

    const pendingBuffers: PendingAudioBuffer[] = [];
    const replacements = new Map<string, Map<string, IClip>>();
    let changedClips = 0;
    for (const { track, input, clip, range, selectedChannels } of prepared) {
      const amplified = processAmplifyChannels(selectedChannels, settings);
      const processed = input.sampleData.map((channel, channelIndex) => {
        const next = new Float32Array(channel);
        next.set(amplified[channelIndex], range.startSample);
        return next;
      });
      const bufferId = generateId();
      pendingBuffers.push({ id: bufferId, sampleRate: project.sampleRate, sampleData: processed });
      const trackReplacements = replacements.get(track.id) ?? new Map<string, IClip>();
      trackReplacements.set(clip.id, { ...clip, audioBufferId: bufferId });
      replacements.set(track.id, trackReplacements);
      changedClips += 1;
    }

    const updatedProject: IProject = {
      ...project,
      tracks: project.tracks.map((track) => {
        const trackReplacements = replacements.get(track.id);
        if (!trackReplacements) return track;
        return {
          ...track,
          clips: track.clips.map((clip) => trackReplacements.get(clip.id) ?? clip),
        };
      }),
    };
    await this.commitPendingAudioBuffers(projectId, pendingBuffers, updatedProject);
    return changedClips;
  }

  /** Apply Audacity Normalize after one whole-track selection analysis. */
  async normalizeSelectionOnTracks(
    projectId: string,
    selection: GeneratorSelection,
    settings: NormalizeSettings,
    targets: readonly NormalizeTrackAudio[],
  ): Promise<number> {
    if (
      !Number.isFinite(selection.start)
      || !Number.isFinite(selection.end)
      || selection.start < 0
      || selection.end <= selection.start
    ) {
      throw new RangeError('标准化选区必须是有限的正时长区间');
    }
    validateNormalizeSettings(settings);
    if (isNormalizeBypassed(settings)) return 0;
    const project = this.currentProject?.id === projectId
      ? this.currentProject
      : await this.getProject(projectId);
    if (!project) throw new Error('工程不存在');
    if (targets.length === 0) throw new Error('选区内没有可处理的音频');

    const seenTracks = new Set<string>();
    const nextTracks = new Map<string, ITrack>();
    const pendingBuffers: PendingAudioBuffer[] = [];
    let changedClips = 0;

    for (const target of targets) {
      if (seenTracks.has(target.trackId)) throw new Error(`轨道 ${target.trackId} 被重复指定`);
      seenTracks.add(target.trackId);
      const track = project.tracks.find((candidate) => candidate.id === target.trackId);
      if (!track) throw new Error(`目标轨道不可用：${target.trackId}`);
      const seenClips = new Set<string>();
      const ordered = target.clips.map((input) => {
        if (seenClips.has(input.clipId)) throw new Error(`片段 ${input.clipId} 被重复指定`);
        seenClips.add(input.clipId);
        const clip = track.clips.find((candidate) => candidate.id === input.clipId);
        if (!clip) throw new Error(`目标片段不可用：${input.clipId}`);
        return { input, clip };
      }).sort((left, right) => left.clip.startTime - right.clip.startTime);
      if (ordered.length === 0) throw new Error(`轨道 ${target.trackId} 没有可处理的选区音频`);
      const channelCount = ordered[0]?.input.sampleData.length ?? 0;
      if (channelCount === 0) throw new Error(`轨道 ${target.trackId} 没有音频声道`);

      const prepared = ordered.map(({ input, clip }) => {
        if (input.sampleData.length !== channelCount) {
          throw new Error(`轨道 ${target.trackId} 的选区声道数不一致`);
        }
        const channelLength = input.sampleData[0]?.length ?? 0;
        const range = getClipSampleRange(
          clip,
          selection,
          input.sourceOffset,
          project.sampleRate,
          channelLength,
        );
        if (!range) throw new Error(`片段“${clip.name ?? clip.id}”不在标准化选区内`);
        const selectedChannels = input.sampleData.map((channel) => (
          channel.slice(range.startSample, range.endSample)
        ));
        return { input, clip, range, selectedChannels };
      });

      // Audacity analyses every selected clip on a track before changing any sample.
      const segmentsByChannel = Array.from(
        { length: channelCount },
        () => [] as Float32Array[],
      );
      for (const item of prepared) {
        item.selectedChannels.forEach((channel, channelIndex) => {
          segmentsByChannel[channelIndex].push(channel);
        });
      }
      const plan = createNormalizePlan(segmentsByChannel, settings);
      const replacements = new Map<string, IClip>();
      for (const { input, clip, range, selectedChannels } of prepared) {
        const normalized = processNormalizeChannels(selectedChannels, settings, plan);
        const processed = input.sampleData.map((channel, channelIndex) => {
          const next = new Float32Array(channel);
          next.set(normalized[channelIndex], range.startSample);
          return next;
        });
        const bufferId = generateId();
        pendingBuffers.push({ id: bufferId, sampleRate: project.sampleRate, sampleData: processed });
        // Preserve trim and stretch metadata: only selected source samples changed.
        replacements.set(clip.id, { ...clip, audioBufferId: bufferId });
        changedClips += 1;
      }
      nextTracks.set(track.id, {
        ...track,
        clips: track.clips.map((clip) => replacements.get(clip.id) ?? clip),
      });
    }

    const updatedProject: IProject = {
      ...project,
      tracks: project.tracks.map((track) => nextTracks.get(track.id) ?? track),
    };
    await this.commitPendingAudioBuffers(projectId, pendingBuffers, updatedProject);
    return changedClips;
  }

  /** Silence matching samples on every selected track with one project commit. */
  async silenceSelectionOnTracks(
    projectId: string,
    trackIds: readonly string[],
    selection: GeneratorSelection,
  ): Promise<number> {
    if (
      !Number.isFinite(selection.start)
      || !Number.isFinite(selection.end)
      || selection.end <= selection.start
    ) {
      throw new RangeError('静默选区必须是有限的正时长区间');
    }
    const project = this.currentProject?.id === projectId
      ? this.currentProject
      : await this.getProject(projectId);
    if (!project) throw new Error('工程不存在');

    const nextTracks = new Map<string, ITrack>();
    const pendingBuffers: PendingAudioBuffer[] = [];
    let changedClips = 0;

    for (const trackId of new Set(trackIds)) {
      const track = project.tracks.find((candidate) => candidate.id === trackId);
      if (!track) throw new Error(`目标轨道不可用：${trackId}`);
      const clips: IClip[] = [];
      for (const clip of track.clips) {
        if (
          selection.end <= clip.startTime
          || selection.start >= clip.startTime + clip.duration
        ) {
          clips.push(clip);
          continue;
        }
        const channelData = await this.loadAudioChannels(clip.audioBufferId);
        if (!channelData) throw new Error(`片段“${clip.name ?? clip.id}”的音频不可用`);
        const silenced = silenceClipSelection(channelData, clip, selection, project.sampleRate);
        if (!silenced) {
          clips.push(clip);
          continue;
        }
        const bufferId = generateId();
        pendingBuffers.push({ id: bufferId, sampleRate: project.sampleRate, sampleData: silenced });
        clips.push({ ...clip, audioBufferId: bufferId });
        changedClips += 1;
      }
      nextTracks.set(trackId, { ...track, clips });
    }

    if (changedClips === 0) return 0;
    const updatedProject: IProject = {
      ...project,
      tracks: project.tracks.map((track) => nextTracks.get(track.id) ?? track),
    };
    await this.commitPendingAudioBuffers(projectId, pendingBuffers, updatedProject);
    return changedClips;
  }

  /** Replace selected samples with zeroes without changing any clip boundary. */
  async silenceSelectionOnTrack(
    projectId: string,
    trackId: string,
    selection: { start: number; end: number },
  ): Promise<number> {
    if (
      !Number.isFinite(selection.start)
      || !Number.isFinite(selection.end)
      || selection.end <= selection.start
    ) {
      throw new RangeError('静默选区必须是有限的正时长区间');
    }

    const project = this.currentProject?.id === projectId
      ? this.currentProject
      : await this.getProject(projectId);
    if (!project) throw new Error('工程不存在');
    const track = project.tracks.find((candidate) => candidate.id === trackId);
    if (!track) throw new Error('目标轨道不可用');

    let changedClips = 0;
    for (const clip of track.clips) {
      if (
        selection.end <= clip.startTime
        || selection.start >= clip.startTime + clip.duration
      ) continue;

      const channelData = await this.loadAudioChannels(clip.audioBufferId);
      if (!channelData) throw new Error(`片段“${clip.name ?? clip.id}”的音频不可用`);
      const silenced = silenceClipSelection(channelData, clip, selection, project.sampleRate);
      if (!silenced) continue;

      const bufferId = generateId();
      const length = silenced[0]?.length ?? 0;
      await audioDb.audioBuffers.put({
        id: bufferId,
        projectId,
        sampleRate: project.sampleRate,
        channels: silenced.length,
        length,
        duration: length / project.sampleRate,
        channelData: silenced.map((channel) => channel.buffer as ArrayBuffer),
        createdAt: Date.now(),
      });
      audioEngine.cacheBuffer(bufferId, silenced, project.sampleRate);
      // Copy-on-write is essential: split clips may share the original buffer.
      clip.audioBufferId = bufferId;
      changedClips += 1;
    }

    if (changedClips > 0) await this.saveProject(project);
    return changedClips;
  }

  // Audio buffer loading
  async loadAudioChannels(bufferId: string): Promise<Float32Array[] | null> {
    const cached = audioEngine.getCachedBuffer(bufferId);
    if (cached && cached.length > 0) return cached;

    const record = await audioDb.audioBuffers.get(bufferId);
    if (!record || record.channelData.length === 0) return null;

    const channels = record.channelData.map((buffer) => new Float32Array(buffer as ArrayBuffer));
    audioEngine.cacheBuffer(bufferId, channels, record.sampleRate);
    return channels;
  }

  async loadAudioBuffer(bufferId: string): Promise<Float32Array | null> {
    const channels = await this.loadAudioChannels(bufferId);
    return channels?.[0] ?? null;
  }

  // Effect operations
  async addEffectToTrack(
    projectId: string,
    trackId: string,
    type: EffectType,
  ): Promise<IEffect | null> {
    const project = this.currentProject?.id === projectId
      ? this.currentProject
      : await this.getProject(projectId);
    if (!project) return null;

    const track = project.tracks.find((t) => t.id === trackId);
    if (!track) return null;

    const defaultParams = this.getDefaultEffectParams(type);
    const effect: IEffect = {
      id: generateId(),
      type,
      bypassed: false,
      params: defaultParams,
    };

    track.effects.push(effect);
    await this.saveProject(project);
    return effect;
  }

  async updateEffect(
    projectId: string,
    trackId: string,
    effectId: string,
    updates: Partial<IEffect>,
  ): Promise<void> {
    const project = this.currentProject?.id === projectId
      ? this.currentProject
      : await this.getProject(projectId);
    if (!project) return;

    const track = project.tracks.find((t) => t.id === trackId);
    if (!track) return;

    const effect = track.effects.find((e) => e.id === effectId);
    if (!effect) return;

    Object.assign(effect, updates);
    if (updates.params) {
      effect.params = { ...effect.params, ...updates.params };
    }
    await this.saveProject(project);
  }

  async removeEffectFromTrack(
    projectId: string,
    trackId: string,
    effectId: string,
  ): Promise<void> {
    const project = this.currentProject?.id === projectId
      ? this.currentProject
      : await this.getProject(projectId);
    if (!project) return;

    const track = project.tracks.find((t) => t.id === trackId);
    if (!track) return;

    track.effects = track.effects.filter((e) => e.id !== effectId);
    await this.saveProject(project);
  }

  // Storage info
  async getStorageInfo(): Promise<{
    quota: number;
    usage: number;
    usageDetails: { projects: number; audioBuffers: number };
  }> {
    let quota = 0;
    let usage = 0;

    try {
      const estimate = await (navigator.storage as any).estimate();
      quota = estimate.quota || 0;
      usage = estimate.usage || 0;
    } catch {
      // Fallback estimate from IndexedDB
    }

    // Estimate IndexedDB usage by project
    const audioBuffers = await audioDb.audioBuffers.toArray();
    let bufferUsage = 0;
    for (const buf of audioBuffers) {
      for (const ch of buf.channelData) {
        bufferUsage += ch.byteLength;
      }
    }

    const projects = await audioDb.projects.count();

    return {
      quota,
      usage,
      usageDetails: {
        projects,
        audioBuffers: bufferUsage,
      },
    };
  }

  // Helpers
  private createDefaultTrack(index: number): ITrack {
    return {
      id: generateId(),
      name: `音轨 ${index + 1}`,
      type: 'audio',
      gain: 0,
      pan: 0,
      muted: false,
      solo: false,
      armed: false,
      color: getTrackColor(index),
      clips: [],
      effects: [],
    };
  }

  private getDefaultEffectParams(type: EffectType): Record<string, number> {
    switch (type) {
      case 'gain':
        return { gain: 0 };
      case 'highPass':
        return { frequency: 80, q: 0.7 };
      case 'lowPass':
        return { frequency: 8000, q: 0.7 };
      case 'eq':
        return { low: 0, mid: 0, high: 0 };
      case 'compressor':
        return { threshold: -24, ratio: 4, attack: 0.003, release: 0.25, knee: 30, makeup: 0 };
      case 'reverb':
        return { decay: 2, wet: 0.3, predelay: 0.02 };
      case 'delay':
        return { time: 0.3, feedback: 0.4, wet: 0.3 };
      case 'noiseGate':
        return { threshold: -40, attack: 0.005, release: 0.1, hold: 0.05 };
      default:
        return {};
    }
  }

  private recordToSummary(record: ProjectRecord): IProjectSummary {
    return {
      id: record.id,
      name: record.name,
      sampleRate: record.sampleRate,
      duration: record.duration,
      trackCount: JSON.parse(record.tracksData || '[]').length,
      updatedAt: record.updatedAt,
      createdAt: record.createdAt,
      status: record.status,
      deletedAt: record.deletedAt,
      thumbnail: undefined,
    };
  }

  private recordToProject(record: ProjectRecord): IProject {
    return {
      id: record.id,
      name: record.name,
      sampleRate: record.sampleRate,
      timeSignature: validateTimeSignature(record.timeSignature?.numerator, record.timeSignature?.denominator)
        ?? { numerator: 4, denominator: 4 },
      tempo: validateTempo(record.tempo) ?? 120,
      tracks: deserializeTracks(record.tracksData),
      cursorPosition: 0,
      selection: deserializeSelection(record.selectionData),
      loopRegion: deserializeSelection(record.loopRegionData ?? null),
      loopEnabled: record.loopEnabled ?? false,
      viewState: record.viewStateData ? JSON.parse(record.viewStateData) : {
        horizontalZoom: 50,
        verticalZoom: 1,
        scrollX: 0,
        viewMode: 'waveform',
      },
      updatedAt: record.updatedAt,
      createdAt: record.createdAt,
    };
  }

  private projectToRecord(project: IProject): ProjectRecord {
    // Calculate total duration
    let maxEnd = 0;
    for (const track of project.tracks) {
      for (const clip of track.clips) {
        const end = clip.startTime + clip.duration;
        if (end > maxEnd) maxEnd = end;
      }
    }

    return {
      id: project.id,
      name: project.name,
      sampleRate: project.sampleRate,
      duration: maxEnd,
      trackCount: project.tracks.length,
      status: 'active',
      updatedAt: project.updatedAt,
      createdAt: project.createdAt,
      tracksData: serializeTracks(project.tracks),
      viewStateData: JSON.stringify(project.viewState),
      tempo: project.tempo,
      timeSignature: project.timeSignature,
      cursorPosition: project.cursorPosition,
      selectionData: serializeSelection(project.selection),
      loopRegionData: serializeSelection(project.loopRegion ?? null),
      loopEnabled: project.loopEnabled ?? false,
      thumbnail: undefined,
      deletedAt: undefined,
    };
  }

  getCurrentProject(): IProject | null {
    return this.currentProject;
  }

  getCurrentProjectId(): string | null {
    return this.currentProjectId;
  }

  // Clear all data
  async clearAllData(): Promise<void> {
    await audioDb.projects.clear();
    await audioDb.audioBuffers.clear();
    await audioDb.clipboard.clear();
    try {
      localStorage.removeItem(PREFS_KEY);
    } catch {}
    this.currentProject = null;
    this.currentProjectId = null;
    logger.info('All data cleared');
  }
}

export const projectService = new ProjectService();
