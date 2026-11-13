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
import { getClipStretchRatio } from '@/lib/clipEditing';
import { createRepairRandom, interpolateRepairAudio, MAX_REPAIR_SAMPLES } from '@/lib/repairEffect';
import {
  CLICK_REMOVAL_INEFFECTIVE_ERROR,
  isClickRemovalBypassed,
  processClickRemovalTrack,
  validateClickRemovalSettings,
  type ClickRemovalSettings,
} from '@/lib/clickRemovalEffect';
import {
  MAX_NOISE_REDUCTION_TOTAL_SAMPLES,
  learnNoiseProfileFromTracks,
  processNoiseReductionTrack,
  validateNoiseReductionSettings,
  type NoiseReductionProfile,
  type NoiseReductionSettings,
} from '@/lib/noiseReductionEffect';
import {
  MAX_LOUDNESS_TOTAL_SAMPLES,
  processLoudnessTrack,
  validateLoudnessSettings,
  type LoudnessSettings,
  type LoudnessTrackInput,
} from '@/lib/loudnessEffect';
import {
  MAX_FILTER_CURVE_EQ_TOTAL_SAMPLES,
  createFilterCurveEqPlan,
  isFilterCurveEqBypassed,
  processFilterCurveEqTrack,
  validateFilterCurveEqSettings,
  type FilterCurveEqSettings,
} from '@/lib/filterCurveEffect';
import {
  MAX_GRAPHIC_EQ_TOTAL_SAMPLES,
  createGraphicEqPlan,
  isGraphicEqBypassed,
  processGraphicEqTrack,
  validateGraphicEqSettings,
  type GraphicEqSettings,
} from '@/lib/graphicEqEffect';
import {
  processTruncateSilenceTracks,
  type TruncateSilenceSettings,
  type TruncateSilenceTrackInput,
} from '@/lib/truncateSilenceEffect';
import {
  getClipSampleRange,
  quantizeSelectionToSamples,
  replaceTrackSelectionWithClip,
  type GeneratorSelection,
} from '@/lib/generatorEditing';
import { processWahWahChannels, type WahWahSettings } from '@/lib/wahWahEffect';
import {
  createPhaserState,
  processPhaserChannels,
  validatePhaserSettings,
  type PhaserSettings,
} from '@/lib/phaserEffect';
import {
  createClassicFilterState,
  processClassicFilterChannels,
  validateClassicFilterSettings,
  type ClassicFilterSettings,
} from '@/lib/classicFilterEffect';
import {
  createTremoloState,
  processTremoloChannels,
  validateTremoloSettings,
  type TremoloSettings,
} from '@/lib/tremoloEffect';
import {
  MAX_AUTO_DUCK_TOTAL_SAMPLES,
  applyAutoDuckPlanToChannels,
  createAutoDuckPlan,
  getAutoDuckTimelinePlacement,
  renderAutoDuckSelectionChannels,
  validateAutoDuckSettings,
  type AutoDuckSettings,
} from '@/lib/autoDuckEffect';
import {
  createBassTrebleState,
  isBassTrebleBypassed,
  processBassTrebleChannels,
  validateBassTrebleSettings,
  type BassTrebleSettings,
} from '@/lib/bassTrebleEffect';
import {
  createReverbState,
  processReverbSelection,
  validateReverbSettings,
  type ReverbSettings,
} from '@/lib/reverbEffect';
import {
  createDistortionState,
  processDistortionSelection,
  validateDistortionSettings,
  type DistortionSettings,
} from '@/lib/distortionEffect';
import {
  isCompressorBypassed,
  processCompressorChannels,
  validateCompressorSettings,
  type CompressorSettings,
} from '@/lib/compressorEffect';
import {
  processLegacyCompressorChannels,
  validateLegacyCompressorSettings,
  type LegacyCompressorSettings,
} from '@/lib/legacyCompressorEffect';
import {
  processNoiseGateChannels,
  validateNoiseGateSettings,
  type NoiseGateSettings,
} from '@/lib/noiseGateEffect';
import {
  processLimiterChannels,
  validateLimiterSettings,
  type LimiterSettings,
} from '@/lib/limiterEffect';
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
import { processInvertSelection } from '@/lib/invertEffect';
import { mixStereoToMono } from '@/lib/stereoToMonoEffect';
import {
  changeTempoRatio,
  durationAfterChangeTempo,
  isChangeTempoBypassed,
  processChangeTempoChannels,
  validateChangeTempoSettings,
  type ChangeTempoSettings,
} from '@/lib/changeTempoEffect';
import {
  isChangeSpeedBypassed,
  processChangeSpeedChannels,
  validateChangeSpeedSettings,
  MAX_CHANGE_SPEED_TOTAL_OUTPUT_SAMPLES,
  type ChangeSpeedSettings,
} from '@/lib/changeSpeedEffect';
import {
  isChangePitchBypassed,
  MAX_CHANGE_PITCH_TOTAL_OUTPUT_SAMPLES,
  processChangePitchChannels,
  validateChangePitchSettings,
  type ChangePitchSettings,
} from '@/lib/changePitchEffect';
import {
  MAX_PAULSTRETCH_TOTAL_OUTPUT_SAMPLES,
  paulstretchOutputLength,
  processPaulstretchChannels,
  validatePaulstretchSettings,
  type PaulstretchSettings,
} from '@/lib/paulstretchEffect';
import {
  processCrossfadeChannels,
  resolveCrossfadeFade,
  validateCrossfadeSettings,
  type CrossfadeFade,
  type CrossfadeSettings,
} from '@/lib/crossfadeTracksEffect';

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
export type PhaserClipAudio = EchoClipAudio;
export type PhaserTrackAudio = EchoTrackAudio;
export type ClassicFilterClipAudio = EchoClipAudio;
export type ClassicFilterTrackAudio = EchoTrackAudio;
export type TremoloClipAudio = EchoClipAudio;
export type TremoloTrackAudio = EchoTrackAudio;
export type AutoDuckClipAudio = EchoClipAudio;
export type AutoDuckTrackAudio = EchoTrackAudio;
export type BassTrebleClipAudio = EchoClipAudio;
export type BassTrebleTrackAudio = EchoTrackAudio;
export type ReverbClipAudio = EchoClipAudio;
export type ReverbTrackAudio = EchoTrackAudio;

export type RepairClipAudio = EchoClipAudio;
export type RepairTrackAudio = EchoTrackAudio;
export type ClickRemovalClipAudio = EchoClipAudio;
export type ClickRemovalTrackAudio = EchoTrackAudio;
export type NoiseReductionClipAudio = EchoClipAudio;
export type NoiseReductionTrackAudio = EchoTrackAudio;
export type LoudnessClipAudio = EchoClipAudio;
export type LoudnessTrackAudio = EchoTrackAudio;
export type FilterCurveEqClipAudio = EchoClipAudio;
export type FilterCurveEqTrackAudio = EchoTrackAudio;
export type GraphicEqClipAudio = EchoClipAudio;
export type GraphicEqTrackAudio = EchoTrackAudio;
export type DistortionClipAudio = EchoClipAudio;
export type DistortionTrackAudio = EchoTrackAudio;
export type CompressorClipAudio = EchoClipAudio;
export type CompressorTrackAudio = EchoTrackAudio;
export type LimiterClipAudio = EchoClipAudio;
export type LimiterTrackAudio = EchoTrackAudio;
export type AmplifyClipAudio = EchoClipAudio;
export type AmplifyTrackAudio = EchoTrackAudio;
export type NormalizeClipAudio = EchoClipAudio;
export type NormalizeTrackAudio = EchoTrackAudio;
export type ChangeTempoClipAudio = EchoClipAudio;
export type ChangeTempoTrackAudio = EchoTrackAudio;
export type ChangeSpeedClipAudio = EchoClipAudio;
export type ChangeSpeedTrackAudio = EchoTrackAudio;
export type ChangePitchClipAudio = EchoClipAudio;
export type ChangePitchTrackAudio = EchoTrackAudio;
export type PaulstretchClipAudio = EchoClipAudio;
export type PaulstretchTrackAudio = EchoTrackAudio;

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

  /** Atomic Audacity Filter Curve EQ transaction; no partial writes or orphan buffers. */
  async filterCurveEqSelectionOnTracks(
    projectId: string,
    selection: GeneratorSelection,
    settings: FilterCurveEqSettings,
    targets: readonly FilterCurveEqTrackAudio[],
  ): Promise<number> {
    if (
      !Number.isFinite(selection.start) || !Number.isFinite(selection.end)
      || selection.start < 0 || selection.end <= selection.start
    ) throw new RangeError('Filter Curve EQ 需要有效的正时长选区');
    validateFilterCurveEqSettings(settings);
    if (isFilterCurveEqBypassed(settings)) return 0;
    if (targets.length === 0) throw new Error('选区内没有可处理的音频');
    if (new Set(targets.map(({ trackId }) => trackId)).size !== targets.length) {
      throw new Error('Filter Curve EQ 目标包含重复轨道');
    }
    const project = this.currentProject?.id === projectId
      ? this.currentProject
      : await this.getProject(projectId);
    if (!project) throw new Error('Project not found');
    const plan = createFilterCurveEqPlan(settings, project.sampleRate);

    // Every selected track is fully processed before the first persistent write.
    const processed = targets.map((target) => {
      const track = project.tracks.find(({ id }) => id === target.trackId);
      if (!track) throw new Error(`Track not found: ${target.trackId}`);
      return processFilterCurveEqTrack(
        track, target, selection, settings, project.sampleRate, plan,
      );
    });
    const totalSamples = processed.reduce(
      (sum, result) => sum + result.selectionChannels.reduce(
        (trackSum, channel) => trackSum + channel.length, 0,
      ), 0,
    );
    if (totalSamples > MAX_FILTER_CURVE_EQ_TOTAL_SAMPLES) {
      throw new RangeError('Filter Curve EQ 选区过大，请分段处理');
    }

    const pendingBuffers: PendingAudioBuffer[] = [];
    const replacements = new Map<string, Map<string, string>>();
    for (const result of processed) {
      const trackReplacements = new Map<string, string>();
      for (const clip of result.clips) {
        const id = generateId();
        pendingBuffers.push({ id, sampleRate: project.sampleRate, sampleData: clip.sampleData });
        trackReplacements.set(clip.clipId, id);
      }
      replacements.set(result.trackId, trackReplacements);
    }
    const updatedProject: IProject = {
      ...project,
      selection,
      tracks: project.tracks.map((track) => {
        const trackReplacements = replacements.get(track.id);
        if (!trackReplacements) return track;
        return {
          ...track,
          clips: track.clips.map((clip) => {
            const audioBufferId = trackReplacements.get(clip.id);
            return audioBufferId ? { ...clip, audioBufferId } : clip;
          }),
        };
      }),
    };
    await this.commitPendingAudioBuffers(projectId, pendingBuffers, updatedProject);
    return pendingBuffers.length;
  }

  /** Atomic Audacity Graphic EQ transaction over complete continuous track selections. */
  async graphicEqSelectionOnTracks(
    projectId: string,
    selection: GeneratorSelection,
    settings: GraphicEqSettings,
    targets: readonly GraphicEqTrackAudio[],
  ): Promise<number> {
    if (
      !Number.isFinite(selection.start) || !Number.isFinite(selection.end)
      || selection.start < 0 || selection.end <= selection.start
    ) throw new RangeError('Graphic EQ 需要有效的正时长选区');
    validateGraphicEqSettings(settings);
    if (isGraphicEqBypassed(settings)) return 0;
    if (targets.length === 0) throw new Error('选区内没有可处理的音频');
    if (new Set(targets.map(({ trackId }) => trackId)).size !== targets.length) {
      throw new Error('Graphic EQ 目标包含重复轨道');
    }
    const project = this.currentProject?.id === projectId
      ? this.currentProject
      : await this.getProject(projectId);
    if (!project) throw new Error('Project not found');
    const plan = createGraphicEqPlan(settings, project.sampleRate);

    // Validate and render every target before the first persistent write.
    const processed = targets.map((target) => {
      const track = project.tracks.find(({ id }) => id === target.trackId);
      if (!track) throw new Error(`Track not found: ${target.trackId}`);
      return processGraphicEqTrack(track, target, selection, settings, project.sampleRate, plan);
    });
    const totalSamples = processed.reduce(
      (sum, result) => sum + result.selectionChannels.reduce(
        (trackSum, channel) => trackSum + channel.length, 0,
      ), 0,
    );
    if (totalSamples > MAX_GRAPHIC_EQ_TOTAL_SAMPLES) {
      throw new RangeError('Graphic EQ 选区过大，请分段处理');
    }

    const pendingBuffers: PendingAudioBuffer[] = [];
    const replacements = new Map<string, Map<string, string>>();
    for (const result of processed) {
      const trackReplacements = new Map<string, string>();
      for (const clip of result.clips) {
        const id = generateId();
        pendingBuffers.push({ id, sampleRate: project.sampleRate, sampleData: clip.sampleData });
        trackReplacements.set(clip.clipId, id);
      }
      replacements.set(result.trackId, trackReplacements);
    }
    const updatedProject: IProject = {
      ...project,
      selection,
      tracks: project.tracks.map((track) => {
        const trackReplacements = replacements.get(track.id);
        if (!trackReplacements) return track;
        return {
          ...track,
          clips: track.clips.map((clip) => {
            const audioBufferId = trackReplacements.get(clip.id);
            return audioBufferId ? { ...clip, audioBufferId } : clip;
          }),
        };
      }),
    };
    await this.commitPendingAudioBuffers(projectId, pendingBuffers, updatedProject);
    return pendingBuffers.length;
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

  /** Copy each selected range directly onto a new track with one atomic commit. */
  async duplicateSelectionToTracks(
    projectId: string,
    selection: GeneratorSelection,
    targets: readonly GeneratedTrackAudio[],
  ): Promise<IClip[]> {
    const project = this.currentProject?.id === projectId
      ? this.currentProject
      : await this.getProject(projectId);
    if (!project) throw new Error('工程不存在');
    if (
      !Number.isFinite(selection.start)
      || !Number.isFinite(selection.end)
      || selection.start < 0
      || selection.end <= selection.start
    ) throw new RangeError('复制选区必须是有限的正时长区间');
    if (targets.length === 0) throw new Error('选区内没有可复制的音频');

    const duration = selection.end - selection.start;
    const expectedLength = Math.round(duration * project.sampleRate);
    const seen = new Set<string>();
    const pendingBuffers: PendingAudioBuffer[] = [];
    const insertedClips: IClip[] = [];
    const duplicatedTracks: ITrack[] = [];

    for (const target of targets) {
      if (seen.has(target.trackId)) throw new Error(`轨道 ${target.trackId} 被重复指定`);
      seen.add(target.trackId);
      const sourceTrack = project.tracks.find((candidate) => candidate.id === target.trackId);
      if (!sourceTrack) throw new Error(`目标轨道不可用：${target.trackId}`);

      const sampleData = target.sampleData.map((channel) => new Float32Array(channel));
      if (
        sampleData.length === 0
        || expectedLength < 1
        || sampleData.some((channel) => channel.length !== expectedLength)
      ) throw new RangeError('每条轨道的复制音频必须包含与选区等长的非空声道');

      const bufferId = generateId();
      const clip: IClip = {
        id: generateId(),
        audioBufferId: bufferId,
        startTime: selection.start,
        offset: 0,
        duration,
        originalDuration: duration,
        stretchRatio: 1,
        gain: 0,
        fadeIn: 0,
        fadeOut: 0,
        name: 'Duplicate',
      };
      duplicatedTracks.push({
        id: generateId(),
        name: `${sourceTrack.name} 副本`,
        type: 'audio',
        gain: sourceTrack.gain,
        pan: sourceTrack.pan,
        muted: false,
        solo: false,
        armed: false,
        color: getTrackColor(project.tracks.length + duplicatedTracks.length),
        clips: [clip],
        effects: [],
      });
      insertedClips.push(clip);
      pendingBuffers.push({ id: bufferId, sampleRate: project.sampleRate, sampleData });
    }

    const updatedProject: IProject = {
      ...project,
      selection: { start: selection.start, end: selection.end },
      tracks: [...project.tracks, ...duplicatedTracks],
    };
    await this.commitPendingAudioBuffers(projectId, pendingBuffers, updatedProject);
    return insertedClips;
  }

  /** Apply Audacity Crossfade Tracks to overlapping selected tracks with one atomic commit. */
  async crossfadeSelectionOnTracks(
    projectId: string,
    selection: GeneratorSelection,
    crossfadeSettings: CrossfadeSettings,
    targets: readonly EchoTrackAudio[],
  ): Promise<number> {
    if (
      !Number.isFinite(selection.start)
      || !Number.isFinite(selection.end)
      || selection.start < 0
      || selection.end <= selection.start
    ) {
      throw new RangeError('Crossfade 选区必须是有限的正时长区间');
    }
    validateCrossfadeSettings(crossfadeSettings);
    const project = this.currentProject?.id === projectId
      ? this.currentProject
      : await this.getProject(projectId);
    if (!project) throw new Error('工程不存在');
    if (targets.length < 2) throw new Error('Crossfade Tracks 至少需要两条选区内轨道');

    const seenTracks = new Set<string>();
    const prepared: {
      track: ITrack;
      ordered: {
        input: EchoClipAudio;
        clip: IClip;
        range: { startSample: number; endSample: number };
      }[];
      selectedChannels: Float32Array[];
      fade: CrossfadeFade;
    }[] = [];

    for (const [trackIndex, target] of targets.entries()) {
      if (seenTracks.has(target.trackId)) throw new Error(`轨道 ${target.trackId} 被重复指定`);
      seenTracks.add(target.trackId);
      const track = project.tracks.find((candidate) => candidate.id === target.trackId);
      if (!track) throw new Error(`目标轨道不可用：${target.trackId}`);
      const seenClips = new Set<string>();
      const mapped = target.clips.map((input) => {
        if (seenClips.has(input.clipId)) throw new Error(`片段 ${input.clipId} 被重复指定`);
        seenClips.add(input.clipId);
        const clip = track.clips.find((candidate) => candidate.id === input.clipId);
        if (!clip) throw new Error(`目标片段不可用：${input.clipId}`);
        return { input, clip };
      }).sort((left, right) => left.clip.startTime - right.clip.startTime);
      if (mapped.length === 0) throw new Error(`轨道 ${target.trackId} 没有可处理的选区音频`);
      const expectedClipIds = track.clips.filter((clip) => (
        clip.startTime + clip.duration > selection.start && clip.startTime < selection.end
      )).map((clip) => clip.id);
      if (
        expectedClipIds.length !== mapped.length
        || expectedClipIds.some((clipId) => !seenClips.has(clipId))
      ) throw new Error(`轨道 ${target.trackId} 的选区片段覆盖不完整`);

      const channelCount = mapped[0]?.input.sampleData.length ?? 0;
      if (channelCount === 0) throw new Error(`轨道 ${target.trackId} 没有音频声道`);
      let totalSelectedSamples = 0;
      const ordered = mapped.map(({ input, clip }) => {
        if (input.sampleData.length !== channelCount) {
          throw new Error(`轨道 ${target.trackId} 的选区声道数不一致`);
        }
        const channelLength = input.sampleData[0]?.length ?? 0;
        if (input.sampleData.some((channel) => channel.length !== channelLength)) {
          throw new Error(`轨道“${clip.name ?? clip.id}”的声道长度不一致`);
        }
        const range = getClipSampleRange(
          clip,
          selection,
          input.sourceOffset,
          project.sampleRate,
          channelLength,
        );
        if (!range) throw new Error(`片段“${clip.name ?? clip.id}”不在 Crossfade 选区内`);
        totalSelectedSamples += range.endSample - range.startSample;
        return { input, clip, range };
      });
      const selectedChannels = Array.from(
        { length: channelCount },
        () => new Float32Array(totalSelectedSamples),
      );
      let cursor = 0;
      for (const { input, range } of ordered) {
        const selectedLength = range.endSample - range.startSample;
        for (let channel = 0; channel < channelCount; channel += 1) {
          selectedChannels[channel].set(
            input.sampleData[channel].subarray(range.startSample, range.endSample),
            cursor,
          );
        }
        cursor += selectedLength;
      }

      const firstClip = ordered[0]?.clip;
      const lastClip = ordered[ordered.length - 1]?.clip;
      const startDistance = selection.start - (firstClip?.startTime ?? selection.start);
      const endDistance = (lastClip
        ? lastClip.startTime + lastClip.duration
        : selection.end) - selection.end;
      const fade = resolveCrossfadeFade(
        trackIndex,
        crossfadeSettings.direction,
        startDistance,
        endDistance,
      );
      prepared.push({ track, ordered, selectedChannels, fade });
    }

    const nextTracks = new Map<string, ITrack>();
    const pendingBuffers: PendingAudioBuffer[] = [];
    let changedClips = 0;
    for (const { track, ordered, selectedChannels, fade } of prepared) {
      const processed = processCrossfadeChannels(selectedChannels, fade, crossfadeSettings);
      const replacements = new Map<string, IClip>();
      let cursor = 0;
      for (const { input, clip, range } of ordered) {
        const selectedLength = range.endSample - range.startSample;
        const sampleData = input.sampleData.map((source, channel) => {
          const next = new Float32Array(source);
          next.set(processed[channel].subarray(cursor, cursor + selectedLength), range.startSample);
          return next;
        });
        const bufferId = generateId();
        pendingBuffers.push({ id: bufferId, sampleRate: project.sampleRate, sampleData });
        replacements.set(clip.id, { ...clip, audioBufferId: bufferId });
        changedClips += 1;
        cursor += selectedLength;
      }
      nextTracks.set(track.id, {
        ...track,
        clips: track.clips.map((clip) => replacements.get(clip.id) ?? clip),
      });
    }

    const updatedProject: IProject = {
      ...project,
      selection,
      tracks: project.tracks.map((track) => nextTracks.get(track.id) ?? track),
    };
    await this.commitPendingAudioBuffers(projectId, pendingBuffers, updatedProject);
    return changedClips;
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
      selection,
      tracks: project.tracks.map((track) => nextTracks.get(track.id) ?? track),
    };
    await this.commitPendingAudioBuffers(projectId, pendingBuffers, updatedProject);
    return changedClips;
  }

  /** Apply Audacity Invert to every supplied track with one atomic project commit. */
  async invertSelectionOnTracks(
    projectId: string,
    selection: GeneratorSelection,
    targets: readonly EchoTrackAudio[],
  ): Promise<number> {
    if (
      !Number.isFinite(selection.start)
      || !Number.isFinite(selection.end)
      || selection.start < 0
      || selection.end <= selection.start
    ) {
      throw new RangeError('极性反转选区必须是有限的正时长区间');
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
        if (!range) throw new Error(`片段“${clip.name ?? clip.id}”不在极性反转选区内`);
        const processed = processInvertSelection(
          input.sampleData,
          range.startSample,
          range.endSample,
        );
        const bufferId = generateId();
        pendingBuffers.push({ id: bufferId, sampleRate: project.sampleRate, sampleData: processed });
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
      selection,
      tracks: project.tracks.map((track) => nextTracks.get(track.id) ?? track),
    };
    await this.commitPendingAudioBuffers(projectId, pendingBuffers, updatedProject);
    return changedClips;
  }

  /** Convert complete stereo tracks to mono in one atomic project commit. */
  async stereoToMonoOnTracks(
    projectId: string,
    targets: readonly EchoTrackAudio[],
  ): Promise<number> {
    const project = this.currentProject?.id === projectId
      ? this.currentProject
      : await this.getProject(projectId);
    if (!project) throw new Error('工程不存在');
    if (targets.length === 0) throw new Error('没有可转换的立体声轨道');

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
      if (track.clips.length !== ordered.length || track.clips.some((clip) => !seenClips.has(clip.id))) {
        throw new Error(`轨道 ${track.id} 的片段覆盖不完整`);
      }

      const replacements = new Map<string, IClip>();
      for (const { input, clip } of ordered) {
        if (input.sampleData.length === 1) continue;
        if (input.sampleData.length !== 2) throw new Error(`轨道 ${track.id} 包含无法转换的 ${input.sampleData.length} 声道片段`);
        const mono = mixStereoToMono(input.sampleData);
        const bufferId = generateId();
        pendingBuffers.push({ id: bufferId, sampleRate: project.sampleRate, sampleData: mono });
        replacements.set(clip.id, {
          ...clip,
          audioBufferId: bufferId,
          offset: 0,
          originalDuration: mono[0].length / project.sampleRate,
          stretchRatio: 1,
        });
        changedClips += 1;
      }
      if (replacements.size > 0) {
        nextTracks.set(track.id, {
          ...track,
          clips: track.clips.map((clip) => replacements.get(clip.id) ?? clip),
        });
      }
    }

    if (pendingBuffers.length === 0) throw new Error('选区内没有立体声片段');
    const updatedProject: IProject = {
      ...project,
      tracks: project.tracks.map((track) => nextTracks.get(track.id) ?? track),
    };
    await this.commitPendingAudioBuffers(projectId, pendingBuffers, updatedProject);
    return changedClips;
  }

  /** Split complete stereo tracks into independent left/right mono tracks. */
  async splitStereoToMonoTracks(
    projectId: string,
    targets: readonly EchoTrackAudio[],
  ): Promise<number> {
    const project = this.currentProject?.id === projectId
      ? this.currentProject
      : await this.getProject(projectId);
    if (!project) throw new Error('工程不存在');
    if (targets.length === 0) throw new Error('没有可拆分的立体声轨道');

    const seenTracks = new Set<string>();
    const pendingBuffers: PendingAudioBuffer[] = [];
    const replacements = new Map<string, ITrack[]>();
    let createdTracks = 0;

    for (const target of targets) {
      if (seenTracks.has(target.trackId)) throw new Error(`轨道 ${target.trackId} 被重复指定`);
      seenTracks.add(target.trackId);
      const sourceTrack = project.tracks.find((candidate) => candidate.id === target.trackId);
      if (!sourceTrack) throw new Error(`目标轨道不可用：${target.trackId}`);

      const seenClips = new Set<string>();
      const ordered = target.clips.map((input) => {
        if (seenClips.has(input.clipId)) throw new Error(`片段 ${input.clipId} 被重复指定`);
        seenClips.add(input.clipId);
        const clip = sourceTrack.clips.find((candidate) => candidate.id === input.clipId);
        if (!clip) throw new Error(`目标片段不可用：${input.clipId}`);
        return { input, clip };
      }).sort((left, right) => left.clip.startTime - right.clip.startTime);

      if (sourceTrack.clips.length !== ordered.length || sourceTrack.clips.some((clip) => !seenClips.has(clip.id))) {
        throw new Error(`轨道 ${sourceTrack.id} 的片段覆盖不完整`);
      }

      const leftClips: IClip[] = [];
      const rightClips: IClip[] = [];
      for (const { input, clip } of ordered) {
        const channels = input.sampleData;
        if (channels.length !== 2) throw new Error(`轨道 ${sourceTrack.id} 包含无法拆分的 ${channels.length} 声道片段`);
        const [leftData, rightData] = channels;
        if (!leftData || !rightData || leftData.length !== rightData.length) {
          throw new Error('左右声道长度必须一致');
        }

        const leftBufferId = generateId();
        const rightBufferId = generateId();
        const originalDuration = leftData.length / project.sampleRate;
        const baseClip = {
          startTime: clip.startTime,
          offset: input.sourceOffset,
          duration: clip.duration,
          originalDuration,
          stretchRatio: 1,
          gain: clip.gain,
          fadeIn: clip.fadeIn,
          fadeOut: clip.fadeOut,
        };
        leftClips.push({ ...baseClip, id: generateId(), audioBufferId: leftBufferId, name: `${clip.name ?? 'Clip'} L` });
        rightClips.push({ ...baseClip, id: generateId(), audioBufferId: rightBufferId, name: `${clip.name ?? 'Clip'} R` });
        pendingBuffers.push(
          { id: leftBufferId, sampleRate: project.sampleRate, sampleData: [new Float32Array(leftData)] },
          { id: rightBufferId, sampleRate: project.sampleRate, sampleData: [new Float32Array(rightData)] },
        );
      }

      const colorOffset = project.tracks.length + createdTracks;
      const leftTrack: ITrack = {
        id: generateId(),
        name: `${sourceTrack.name} L`,
        type: 'audio',
        gain: sourceTrack.gain,
        pan: -1,
        muted: false,
        solo: false,
        armed: false,
        color: getTrackColor(colorOffset),
        clips: leftClips,
        effects: [],
      };
      const rightTrack: ITrack = {
        id: generateId(),
        name: `${sourceTrack.name} R`,
        type: 'audio',
        gain: sourceTrack.gain,
        pan: 1,
        muted: false,
        solo: false,
        armed: false,
        color: getTrackColor(colorOffset + 1),
        clips: rightClips,
        effects: [],
      };
      replacements.set(sourceTrack.id, [leftTrack, rightTrack]);
      createdTracks += 2;
    }

    const nextTracks = project.tracks.flatMap((track) => replacements.get(track.id) ?? track);
    const updatedProject: IProject = {
      ...project,
      tracks: nextTracks,
    };
    await this.commitPendingAudioBuffers(projectId, pendingBuffers, updatedProject);
    return createdTracks;
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

  /**
   * Apply deterministic Paulstretch and warp the selected timeline atomically.
   * The spectral algorithm is shared with Preview; all targets and output sizes
   * are validated before any IndexedDB write, with rollback on later failures.
   */
  async paulstretchSelectionOnTracks(
    projectId: string,
    selection: GeneratorSelection,
    settings: PaulstretchSettings,
    targets: readonly PaulstretchTrackAudio[],
  ): Promise<number> {
    if (
      !Number.isFinite(selection.start)
      || !Number.isFinite(selection.end)
      || selection.start < 0
      || selection.end <= selection.start
    ) {
      throw new RangeError('Paulstretch 选区必须是有限的正时长区间');
    }
    validatePaulstretchSettings(settings);
    const project = this.currentProject?.id === projectId
      ? this.currentProject
      : await this.getProject(projectId);
    if (!project) throw new Error('工程不存在');
    if (targets.length === 0) throw new Error('选区内没有可处理的音频');

    const seenTracks = new Set<string>();
    const prepared: {
      track: ITrack;
      input: PaulstretchClipAudio;
      clip: IClip;
      range: { startSample: number; endSample: number };
      selectedChannels: Float32Array[];
    }[] = [];

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
        if (!range) throw new Error(`片段“${clip.name ?? clip.id}”不在 Paulstretch 选区内`);
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
      const stretchedLength = paulstretchOutputLength(
        selectedLength,
        settings,
        project.sampleRate,
      );
      const fullLength = channelLength - selectedLength + stretchedLength;
      totalOutputSamples += fullLength * item.input.sampleData.length;
      if (
        !Number.isSafeInteger(fullLength)
        || fullLength < 1
        || !Number.isSafeInteger(totalOutputSamples)
        || totalOutputSamples > MAX_PAULSTRETCH_TOTAL_OUTPUT_SAMPLES
      ) {
        throw new RangeError('Paulstretch 输出超过浏览器内存上限，请缩短选区或减少轨道');
      }

      const stretched = processPaulstretchChannels(
        item.selectedChannels,
        settings,
        project.sampleRate,
      );
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
      return { ...item, bufferId: generateId(), processed, selectedLength, stretchedLength };
    });

    const replacements = new Map<string, Map<string, IClip>>();
    const pendingBuffers: PendingAudioBuffer[] = rendered.map((item) => {
      const duration = item.clip.duration
        + (item.stretchedLength - item.selectedLength) / project.sampleRate;
      if (!Number.isFinite(duration) || duration <= 0) {
        throw new RangeError(`片段“${item.clip.name ?? item.clip.id}”的 Paulstretch 输出时长无效`);
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
    const newSelectionDuration = oldSelectionDuration * settings.stretchFactor;
    if (!Number.isFinite(newSelectionDuration) || newSelectionDuration <= 0) {
      throw new RangeError('Paulstretch 选区输出时长无效');
    }
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
                  ? selection.start + (clip.startTime - selection.start) * settings.stretchFactor
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

  /** Apply Audacity Change Speed by constant-rate resampling with one atomic project commit. */
  async changeSpeedSelectionOnTracks(
    projectId: string,
    selection: GeneratorSelection,
    settings: ChangeSpeedSettings,
    targets: readonly ChangeSpeedTrackAudio[],
  ): Promise<number> {
    if (
      !Number.isFinite(selection.start)
      || !Number.isFinite(selection.end)
      || selection.start < 0
      || selection.end <= selection.start
    ) {
      throw new RangeError('Change Speed 选区必须是有限的正时长区间');
    }
    validateChangeSpeedSettings(settings);
    if (isChangeSpeedBypassed(settings)) return 0;
    const project = this.currentProject?.id === projectId
      ? this.currentProject
      : await this.getProject(projectId);
    if (!project) throw new Error('工程不存在');
    if (targets.length === 0) throw new Error('选区内没有可处理的音频');
    const ratio = 1 + settings.percentChange / 100;

    const seenTracks = new Set<string>();
    const prepared: {
      track: ITrack;
      input: ChangeSpeedClipAudio;
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
        if (!range) throw new Error(`片段“${clip.name ?? clip.id}”不在 Change Speed 选区内`);
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
      const resampledLength = Math.max(1, Math.round(selectedLength / ratio));
      const fullLength = channelLength - selectedLength + resampledLength;
      totalOutputSamples += fullLength * item.input.sampleData.length;
      if (
        !Number.isSafeInteger(fullLength)
        || fullLength < 1
        || !Number.isSafeInteger(totalOutputSamples)
        || totalOutputSamples > MAX_CHANGE_SPEED_TOTAL_OUTPUT_SAMPLES
      ) {
        throw new RangeError('Change Speed 输出超过浏览器内存上限，请缩短选区或减少轨道');
      }

      const resampled = processChangeSpeedChannels(item.selectedChannels, settings, project.sampleRate);
      const processed = item.input.sampleData.map((channel, channelIndex) => {
        const next = new Float32Array(fullLength);
        next.set(channel.slice(0, item.range.startSample), 0);
        next.set(resampled[channelIndex], item.range.startSample);
        next.set(
          channel.slice(item.range.endSample),
          item.range.startSample + resampled[channelIndex].length,
        );
        return next;
      });
      return {
        ...item,
        bufferId: generateId(),
        processed,
        selectedLength,
        resampledLength,
      };
    });

    const replacements = new Map<string, Map<string, IClip>>();
    const pendingBuffers: PendingAudioBuffer[] = rendered.map((item) => {
      const duration = item.clip.duration
        + (item.resampledLength - item.selectedLength) / project.sampleRate;
      if (!Number.isFinite(duration) || duration <= 0) {
        throw new RangeError(`片段“${item.clip.name ?? item.clip.id}”的 Change Speed 输出时长无效`);
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
    const newSelectionDuration = oldSelectionDuration / ratio;
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
      selection,
      tracks: project.tracks.map((track) => nextTracks.get(track.id) ?? track),
    };
    await this.commitPendingAudioBuffers(projectId, pendingBuffers, updatedProject);
    return changedClips;
  }

  /** Apply Audacity 4.0.2 Nyquist Tremolo with one shared LFO per track. */
  async tremoloSelectionOnTracks(
    projectId: string,
    selection: GeneratorSelection,
    settings: TremoloSettings,
    targets: readonly TremoloTrackAudio[],
  ): Promise<number> {
    if (
      !Number.isFinite(selection.start)
      || !Number.isFinite(selection.end)
      || selection.start < 0
      || selection.end <= selection.start
    ) {
      throw new RangeError('Tremolo 选区必须是有限的正时长区间');
    }
    validateTremoloSettings(settings);
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
      const state = createTremoloState();
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
        if (!range) throw new Error(`片段“${clip.name ?? clip.id}”不在 Tremolo 选区内`);
        const selectedChannels = input.sampleData.map((channel) => (
          channel.slice(range.startSample, range.endSample)
        ));
        const modulated = processTremoloChannels(
          selectedChannels,
          settings,
          project.sampleRate,
          state,
        );
        const processed = input.sampleData.map((channel, channelIndex) => {
          const next = new Float32Array(channel);
          next.set(modulated[channelIndex], range.startSample);
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
      // Persist the exact processed range so redo and a later reload restore it.
      selection,
      tracks: project.tracks.map((track) => nextTracks.get(track.id) ?? track),
    };
    await this.commitPendingAudioBuffers(projectId, pendingBuffers, updatedProject);
    return changedClips;
  }

  /** Apply Audacity 4.0.2 Auto Duck from one explicit control track to all other targets. */
  async autoDuckSelectionOnTracks(
    projectId: string,
    selection: GeneratorSelection,
    settings: AutoDuckSettings,
    targets: readonly AutoDuckTrackAudio[],
    controlTrackId: string,
  ): Promise<number> {
    if (
      !Number.isFinite(selection.start)
      || !Number.isFinite(selection.end)
      || selection.start < 0
      || selection.end <= selection.start
    ) {
      throw new RangeError('Auto Duck 选区必须是有限的正时长区间');
    }
    validateAutoDuckSettings(settings);
    const project = this.currentProject?.id === projectId
      ? this.currentProject
      : await this.getProject(projectId);
    if (!project) throw new Error('工程不存在');
    if (!controlTrackId) throw new Error('请选择 Auto Duck 控制轨');
    if (targets.length < 2) throw new Error('Auto Duck 至少需要一条目标轨和一条控制轨');

    const seenTracks = new Set<string>();
    const resolvedTargets = targets.map((target) => {
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
      for (const { input } of ordered) {
        if (input.sampleData.length !== channelCount) {
          throw new Error(`轨道 ${target.trackId} 的选区声道数不一致`);
        }
      }
      return { target, track, ordered };
    });
    const control = resolvedTargets.find(({ target }) => target.trackId === controlTrackId);
    if (!control) throw new Error('Auto Duck 控制轨不在选区音频中');
    const controlChannels = renderAutoDuckSelectionChannels(
      control.ordered.map(({ input, clip }) => ({
        startTime: clip.startTime,
        duration: clip.duration,
        sourceOffset: input.sourceOffset,
        sampleData: input.sampleData,
      })),
      selection,
      project.sampleRate,
    );
    const plan = createAutoDuckPlan(controlChannels[0], settings, project.sampleRate);
    if (plan.length === 0) return 0;

    const nextTracks = new Map<string, ITrack>();
    const pendingBuffers: PendingAudioBuffer[] = [];
    let changedClips = 0;
    let selectedSamples = 0;
    for (const resolved of resolvedTargets) {
      if (resolved.target.trackId === controlTrackId) continue;
      const replacements = new Map<string, IClip>();
      for (const { input, clip } of resolved.ordered) {
        const channelLength = input.sampleData[0]?.length ?? 0;
        const placement = getAutoDuckTimelinePlacement(
          clip,
          selection,
          input.sourceOffset,
          project.sampleRate,
          channelLength,
        );
        if (!placement) throw new Error(`片段“${clip.name ?? clip.id}”不在 Auto Duck 选区内`);
        const selectedChannels = input.sampleData.map((channel) => (
          channel.slice(placement.startSample, placement.endSample)
        ));
        selectedSamples += (selectedChannels[0]?.length ?? 0) * selectedChannels.length;
        if (selectedSamples > MAX_AUTO_DUCK_TOTAL_SAMPLES) {
          throw new RangeError('Auto Duck 目标选区超过 2000 万采样上限，请缩短选区或减少轨道');
        }
        const ducked = applyAutoDuckPlanToChannels(
          selectedChannels,
          plan,
          settings,
          project.sampleRate,
          placement.timelineSample,
        );
        const processed = input.sampleData.map((channel, channelIndex) => {
          const next = new Float32Array(channel);
          next.set(ducked[channelIndex], placement.startSample);
          return next;
        });
        const bufferId = generateId();
        pendingBuffers.push({ id: bufferId, sampleRate: project.sampleRate, sampleData: processed });
        replacements.set(clip.id, { ...clip, audioBufferId: bufferId });
        changedClips += 1;
      }
      nextTracks.set(resolved.track.id, {
        ...resolved.track,
        clips: resolved.track.clips.map((clip) => replacements.get(clip.id) ?? clip),
      });
    }

    const updatedProject: IProject = {
      ...project,
      selection,
      tracks: project.tracks.map((track) => nextTracks.get(track.id) ?? track),
    };
    await this.commitPendingAudioBuffers(projectId, pendingBuffers, updatedProject);
    return changedClips;
  }

  /** Apply Audacity Phaser with persistent per-channel state and one atomic project commit. */
  async phaserSelectionOnTracks(
    projectId: string,
    selection: GeneratorSelection,
    settings: PhaserSettings,
    targets: readonly PhaserTrackAudio[],
  ): Promise<number> {
    if (
      !Number.isFinite(selection.start)
      || !Number.isFinite(selection.end)
      || selection.start < 0
      || selection.end <= selection.start
    ) {
      throw new RangeError('Phaser 选区必须是有限的正时长区间');
    }
    validatePhaserSettings(settings);
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
        () => createPhaserState(settings, project.sampleRate),
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
        if (!range) throw new Error(`片段“${clip.name ?? clip.id}”不在 Phaser 选区内`);
        const selectedChannels = input.sampleData.map((channel) => (
          channel.slice(range.startSample, range.endSample)
        ));
        const filtered = processPhaserChannels(
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
      selection,
      tracks: project.tracks.map((track) => nextTracks.get(track.id) ?? track),
    };
    await this.commitPendingAudioBuffers(projectId, pendingBuffers, updatedProject);
    return changedClips;
  }

  /** Apply Audacity Classic Filters with per-channel biquad history across selected clips. */
  async classicFilterSelectionOnTracks(
    projectId: string,
    selection: GeneratorSelection,
    settings: ClassicFilterSettings,
    targets: readonly ClassicFilterTrackAudio[],
  ): Promise<number> {
    if (
      !Number.isFinite(selection.start)
      || !Number.isFinite(selection.end)
      || selection.start < 0
      || selection.end <= selection.start
    ) {
      throw new RangeError('Classic Filters 选区必须是有限的正时长区间');
    }
    validateClassicFilterSettings(settings);
    const project = this.currentProject?.id === projectId
      ? this.currentProject
      : await this.getProject(projectId);
    if (!project) throw new Error('工程不存在');
    validateClassicFilterSettings(settings, project.sampleRate);
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
        () => createClassicFilterState(settings, project.sampleRate),
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
        if (!range) throw new Error(`片段“${clip.name ?? clip.id}”不在 Classic Filters 选区内`);
        const selectedChannels = input.sampleData.map((channel) => (
          channel.slice(range.startSample, range.endSample)
        ));
        const filtered = processClassicFilterChannels(
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
      selection,
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
      selection,
      tracks: project.tracks.map((track) => nextTracks.get(track.id) ?? track),
    };
    await this.commitPendingAudioBuffers(projectId, pendingBuffers, updatedProject);
    return changedClips;
  }

  /**
   * Apply Audacity's libSoX/Freeverb Reverb to selected clips without changing
   * timeline geometry. One state per track preserves pre-delay and filter tails
   * across adjacent selected clips; the shared commit rolls back every target on
   * any processing, storage, or project-save failure.
   */
  async reverbSelectionOnTracks(
    projectId: string,
    selection: GeneratorSelection,
    settings: ReverbSettings,
    targets: readonly ReverbTrackAudio[],
  ): Promise<number> {
    if (
      !Number.isFinite(selection.start)
      || !Number.isFinite(selection.end)
      || selection.start < 0
      || selection.end <= selection.start
    ) {
      throw new RangeError('Reverb 选区必须是有限的正时长区间');
    }
    validateReverbSettings(settings);
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
      const state = createReverbState(settings, project.sampleRate, channelCount);

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
        if (!range) throw new Error(`片段“${clip.name ?? clip.id}”不在 Reverb 选区内`);
        const processed = processReverbSelection(
          input.sampleData,
          range.startSample,
          range.endSample,
          state,
        );
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
      selection,
      tracks: project.tracks.map((track) => nextTracks.get(track.id) ?? track),
    };
    await this.commitPendingAudioBuffers(projectId, pendingBuffers, updatedProject);
    return changedClips;
  }

  /**
   * Apply Audacity DistortionBase to complete selected clip ranges. DC filter
   * history remains independent per track/channel and continuous across clips.
   */
  async distortionSelectionOnTracks(
    projectId: string,
    selection: GeneratorSelection,
    settings: DistortionSettings,
    targets: readonly DistortionTrackAudio[],
  ): Promise<number> {
    if (
      !Number.isFinite(selection.start)
      || !Number.isFinite(selection.end)
      || selection.start < 0
      || selection.end <= selection.start
    ) {
      throw new RangeError('Distortion 选区必须是有限的正时长区间');
    }
    validateDistortionSettings(settings);
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
      const state = createDistortionState(settings, project.sampleRate, channelCount);

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
        if (!range) throw new Error(`片段“${clip.name ?? clip.id}”不在 Distortion 选区内`);
        const processed = processDistortionSelection(
          input.sampleData,
          range.startSample,
          range.endSample,
          state,
        );
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
      selection,
      tracks: project.tracks.map((track) => nextTracks.get(track.id) ?? track),
    };
    await this.commitPendingAudioBuffers(projectId, pendingBuffers, updatedProject);
    return changedClips;
  }

  /**
   * Apply Audacity 4's CompressorProcessor to complete selected ranges. The
   * selected clips are concatenated in timeline order per track so sidechain,
   * ballistics and look-ahead survive clip boundaries. EffectStage latency is
   * compensated once for that stream, then each clip receives its original
   * time-aligned samples. Every output is staged before the single commit.
   */
  async compressorSelectionOnTracks(
    projectId: string,
    selection: GeneratorSelection,
    settings: CompressorSettings,
    targets: readonly CompressorTrackAudio[],
  ): Promise<number> {
    if (
      !Number.isFinite(selection.start)
      || !Number.isFinite(selection.end)
      || selection.start < 0
      || selection.end <= selection.start
    ) {
      throw new RangeError('Compressor 选区必须是有限的正时长区间');
    }
    validateCompressorSettings(settings);
    if (isCompressorBypassed(settings)) return 0;
    const project = this.currentProject?.id === projectId
      ? this.currentProject
      : await this.getProject(projectId);
    if (!project) throw new Error('工程不存在');
    if (targets.length === 0) throw new Error('选区内没有可处理的音频');

    const seenTracks = new Set<string>();
    const prepared: {
      track: ITrack;
      ordered: {
        input: CompressorClipAudio;
        clip: IClip;
        range: { startSample: number; endSample: number };
      }[];
      selectedChannels: Float32Array[];
    }[] = [];

    // Validate every owner, range and channel layout before processing or writes.
    for (const target of targets) {
      if (seenTracks.has(target.trackId)) throw new Error(`轨道 ${target.trackId} 被重复指定`);
      seenTracks.add(target.trackId);
      const track = project.tracks.find((candidate) => candidate.id === target.trackId);
      if (!track) throw new Error(`目标轨道不可用：${target.trackId}`);
      const seenClips = new Set<string>();
      const mapped = target.clips.map((input) => {
        if (seenClips.has(input.clipId)) throw new Error(`片段 ${input.clipId} 被重复指定`);
        seenClips.add(input.clipId);
        const clip = track.clips.find((candidate) => candidate.id === input.clipId);
        if (!clip) throw new Error(`目标片段不可用：${input.clipId}`);
        return { input, clip };
      }).sort((left, right) => left.clip.startTime - right.clip.startTime);
      if (mapped.length === 0) throw new Error(`轨道 ${target.trackId} 没有可处理的选区音频`);
      const selectedClipIds = track.clips.filter((clip) => (
        clip.startTime + clip.duration > selection.start && clip.startTime < selection.end
      )).map((clip) => clip.id);
      if (
        selectedClipIds.length !== mapped.length
        || selectedClipIds.some((clipId) => !seenClips.has(clipId))
      ) {
        throw new Error(`轨道 ${target.trackId} 的选区片段覆盖不完整`);
      }

      const channelCount = mapped[0]?.input.sampleData.length ?? 0;
      if (channelCount === 0) throw new Error(`轨道 ${target.trackId} 没有音频声道`);
      let totalSelectedSamples = 0;
      const ordered = mapped.map(({ input, clip }) => {
        if (input.sampleData.length !== channelCount) {
          throw new Error(`轨道 ${target.trackId} 的选区声道数不一致`);
        }
        const channelLength = input.sampleData[0]?.length ?? 0;
        if (input.sampleData.some((channel) => channel.length !== channelLength)) {
          throw new Error(`片段“${clip.name ?? clip.id}”的声道长度不一致`);
        }
        const range = getClipSampleRange(
          clip,
          selection,
          input.sourceOffset,
          project.sampleRate,
          channelLength,
        );
        if (!range) throw new Error(`片段“${clip.name ?? clip.id}”不在 Compressor 选区内`);
        totalSelectedSamples += range.endSample - range.startSample;
        return { input, clip, range };
      });
      if (!Number.isSafeInteger(totalSelectedSamples) || totalSelectedSamples < 1) {
        throw new RangeError(`轨道 ${target.trackId} 的 Compressor 选区采样数无效`);
      }
      const selectedChannels = Array.from(
        { length: channelCount },
        () => new Float32Array(totalSelectedSamples),
      );
      let cursor = 0;
      for (const { input, range } of ordered) {
        const selectedLength = range.endSample - range.startSample;
        for (let channel = 0; channel < channelCount; channel += 1) {
          selectedChannels[channel].set(
            input.sampleData[channel].subarray(range.startSample, range.endSample),
            cursor,
          );
        }
        cursor += selectedLength;
      }
      prepared.push({ track, ordered, selectedChannels });
    }

    const nextTracks = new Map<string, ITrack>();
    const pendingBuffers: PendingAudioBuffer[] = [];
    let changedClips = 0;
    for (const { track, ordered, selectedChannels } of prepared) {
      const processed = processCompressorChannels(selectedChannels, settings, project.sampleRate);
      const replacements = new Map<string, IClip>();
      let cursor = 0;
      for (const { input, clip, range } of ordered) {
        const selectedLength = range.endSample - range.startSample;
        const sampleData = input.sampleData.map((source, channel) => {
          const next = new Float32Array(source);
          next.set(processed[channel].subarray(cursor, cursor + selectedLength), range.startSample);
          return next;
        });
        const bufferId = generateId();
        pendingBuffers.push({ id: bufferId, sampleRate: project.sampleRate, sampleData });
        replacements.set(clip.id, { ...clip, audioBufferId: bufferId });
        changedClips += 1;
        cursor += selectedLength;
      }
      nextTracks.set(track.id, {
        ...track,
        clips: track.clips.map((clip) => replacements.get(clip.id) ?? clip),
      });
    }

    const updatedProject: IProject = {
      ...project,
      selection,
      tracks: project.tracks.map((track) => nextTracks.get(track.id) ?? track),
    };
    await this.commitPendingAudioBuffers(projectId, pendingBuffers, updatedProject);
    return changedClips;
  }

  /**
   * Apply the legacy Audacity two-pass compressor to complete selected ranges.
   * Clips are concatenated per track so attack and release survive boundaries,
   * and all buffers and project changes are committed in one atomic transaction.
   */
  async legacyCompressorSelectionOnTracks(
    projectId: string,
    selection: GeneratorSelection,
    legacySettings: LegacyCompressorSettings,
    targets: readonly CompressorTrackAudio[],
  ): Promise<number> {
    if (
      !Number.isFinite(selection.start)
      || !Number.isFinite(selection.end)
      || selection.start < 0
      || selection.end <= selection.start
    ) {
      throw new RangeError('Legacy Compressor 选区必须是有限的正时长区间');
    }
    validateLegacyCompressorSettings(legacySettings);
    const project = this.currentProject?.id === projectId
      ? this.currentProject
      : await this.getProject(projectId);
    if (!project) throw new Error('工程不存在');
    if (targets.length === 0) throw new Error('选区内没有可处理的音频');

    const seenTracks = new Set<string>();
    const prepared: {
      track: ITrack;
      ordered: {
        input: CompressorClipAudio;
        clip: IClip;
        range: { startSample: number; endSample: number };
      }[];
      selectedChannels: Float32Array[];
    }[] = [];

    for (const target of targets) {
      if (seenTracks.has(target.trackId)) throw new Error(`轨道 ${target.trackId} 被重复指定`);
      seenTracks.add(target.trackId);
      const track = project.tracks.find((candidate) => candidate.id === target.trackId);
      if (!track) throw new Error(`目标轨道不可用：${target.trackId}`);
      const seenClips = new Set<string>();
      const mapped = target.clips.map((input) => {
        if (seenClips.has(input.clipId)) throw new Error(`片段 ${input.clipId} 被重复指定`);
        seenClips.add(input.clipId);
        const clip = track.clips.find((candidate) => candidate.id === input.clipId);
        if (!clip) throw new Error(`目标片段不可用：${input.clipId}`);
        return { input, clip };
      }).sort((left, right) => left.clip.startTime - right.clip.startTime);
      if (mapped.length === 0) throw new Error(`轨道 ${target.trackId} 没有可处理的选区音频`);
      const selectedClipIds = track.clips.filter((clip) => (
        clip.startTime + clip.duration > selection.start && clip.startTime < selection.end
      )).map((clip) => clip.id);
      if (
        selectedClipIds.length !== mapped.length
        || selectedClipIds.some((clipId) => !seenClips.has(clipId))
      ) {
        throw new Error(`轨道 ${target.trackId} 的选区片段覆盖不完整`);
      }

      const channelCount = mapped[0]?.input.sampleData.length ?? 0;
      if (channelCount === 0) throw new Error(`轨道 ${target.trackId} 没有音频声道`);
      let totalSelectedSamples = 0;
      const ordered = mapped.map(({ input, clip }) => {
        if (input.sampleData.length !== channelCount) {
          throw new Error(`轨道 ${target.trackId} 的选区声道数不一致`);
        }
        const channelLength = input.sampleData[0]?.length ?? 0;
        if (input.sampleData.some((channel) => channel.length !== channelLength)) {
          throw new Error(`片段“${clip.name ?? clip.id}”的声道长度不一致`);
        }
        const range = getClipSampleRange(
          clip,
          selection,
          input.sourceOffset,
          project.sampleRate,
          channelLength,
        );
        if (!range) throw new Error(`片段“${clip.name ?? clip.id}”不在 Legacy Compressor 选区内`);
        totalSelectedSamples += range.endSample - range.startSample;
        return { input, clip, range };
      });
      if (!Number.isSafeInteger(totalSelectedSamples) || totalSelectedSamples < 1) {
        throw new RangeError(`轨道 ${target.trackId} 的 Legacy Compressor 选区采样数无效`);
      }
      const selectedChannels = Array.from(
        { length: channelCount },
        () => new Float32Array(totalSelectedSamples),
      );
      let cursor = 0;
      for (const { input, range } of ordered) {
        const selectedLength = range.endSample - range.startSample;
        for (let channel = 0; channel < channelCount; channel += 1) {
          selectedChannels[channel].set(
            input.sampleData[channel].subarray(range.startSample, range.endSample),
            cursor,
          );
        }
        cursor += selectedLength;
      }
      prepared.push({ track, ordered, selectedChannels });
    }

    const nextTracks = new Map<string, ITrack>();
    const pendingBuffers: PendingAudioBuffer[] = [];
    let changedClips = 0;
    for (const { track, ordered, selectedChannels } of prepared) {
      const processed = processLegacyCompressorChannels(
        selectedChannels,
        legacySettings,
        project.sampleRate,
      );
      const replacements = new Map<string, IClip>();
      let cursor = 0;
      for (const { input, clip, range } of ordered) {
        const selectedLength = range.endSample - range.startSample;
        const sampleData = input.sampleData.map((source, channel) => {
          const next = new Float32Array(source);
          next.set(processed[channel].subarray(cursor, cursor + selectedLength), range.startSample);
          return next;
        });
        const bufferId = generateId();
        pendingBuffers.push({ id: bufferId, sampleRate: project.sampleRate, sampleData });
        replacements.set(clip.id, { ...clip, audioBufferId: bufferId });
        changedClips += 1;
        cursor += selectedLength;
      }
      nextTracks.set(track.id, {
        ...track,
        clips: track.clips.map((clip) => replacements.get(clip.id) ?? clip),
      });
    }

    const updatedProject: IProject = {
      ...project,
      selection,
      tracks: project.tracks.map((track) => nextTracks.get(track.id) ?? track),
    };
    await this.commitPendingAudioBuffers(projectId, pendingBuffers, updatedProject);
    return changedClips;
  }

  /** Apply the Audacity Nyquist Noise Gate while preserving clip and timeline geometry. */
  async noiseGateSelectionOnTracks(
    projectId: string,
    selection: GeneratorSelection,
    gateSettings: NoiseGateSettings,
    targets: readonly CompressorTrackAudio[],
  ): Promise<number> {
    if (
      !Number.isFinite(selection.start)
      || !Number.isFinite(selection.end)
      || selection.start < 0
      || selection.end <= selection.start
    ) {
      throw new RangeError('Noise Gate 选区必须是有限的正时长区间');
    }
    validateNoiseGateSettings(gateSettings);
    const project = this.currentProject?.id === projectId
      ? this.currentProject
      : await this.getProject(projectId);
    if (!project) throw new Error('工程不存在');
    if (targets.length === 0) throw new Error('选区内没有可处理的音频');

    const seenTracks = new Set<string>();
    const prepared: {
      track: ITrack;
      ordered: {
        input: CompressorClipAudio;
        clip: IClip;
        range: { startSample: number; endSample: number };
      }[];
      selectedChannels: Float32Array[];
    }[] = [];

    for (const target of targets) {
      if (seenTracks.has(target.trackId)) throw new Error(`轨道 ${target.trackId} 被重复指定`);
      seenTracks.add(target.trackId);
      const track = project.tracks.find((candidate) => candidate.id === target.trackId);
      if (!track) throw new Error(`目标轨道不可用：${target.trackId}`);
      const seenClips = new Set<string>();
      const mapped = target.clips.map((input) => {
        if (seenClips.has(input.clipId)) throw new Error(`片段 ${input.clipId} 被重复指定`);
        seenClips.add(input.clipId);
        const clip = track.clips.find((candidate) => candidate.id === input.clipId);
        if (!clip) throw new Error(`目标片段不可用：${input.clipId}`);
        return { input, clip };
      }).sort((left, right) => left.clip.startTime - right.clip.startTime);
      if (mapped.length === 0) throw new Error(`轨道 ${target.trackId} 没有可处理的选区音频`);
      const selectedClipIds = track.clips.filter((clip) => (
        clip.startTime + clip.duration > selection.start && clip.startTime < selection.end
      )).map((clip) => clip.id);
      if (
        selectedClipIds.length !== mapped.length
        || selectedClipIds.some((clipId) => !seenClips.has(clipId))
      ) throw new Error(`轨道 ${target.trackId} 的选区片段覆盖不完整`);

      const channelCount = mapped[0]?.input.sampleData.length ?? 0;
      if (channelCount === 0) throw new Error(`轨道 ${target.trackId} 没有音频声道`);
      let totalSelectedSamples = 0;
      const ordered = mapped.map(({ input, clip }) => {
        if (input.sampleData.length !== channelCount) {
          throw new Error(`轨道 ${target.trackId} 的选区声道数不一致`);
        }
        const channelLength = input.sampleData[0]?.length ?? 0;
        if (input.sampleData.some((channel) => channel.length !== channelLength)) {
          throw new Error(`片段“${clip.name ?? clip.id}”的声道长度不一致`);
        }
        const range = getClipSampleRange(
          clip,
          selection,
          input.sourceOffset,
          project.sampleRate,
          channelLength,
        );
        if (!range) throw new Error(`片段“${clip.name ?? clip.id}”不在 Noise Gate 选区内`);
        totalSelectedSamples += range.endSample - range.startSample;
        return { input, clip, range };
      });
      const selectedChannels = Array.from(
        { length: channelCount },
        () => new Float32Array(totalSelectedSamples),
      );
      let cursor = 0;
      for (const { input, range } of ordered) {
        const selectedLength = range.endSample - range.startSample;
        for (let channel = 0; channel < channelCount; channel += 1) {
          selectedChannels[channel].set(
            input.sampleData[channel].subarray(range.startSample, range.endSample),
            cursor,
          );
        }
        cursor += selectedLength;
      }
      prepared.push({ track, ordered, selectedChannels });
    }

    const nextTracks = new Map<string, ITrack>();
    const pendingBuffers: PendingAudioBuffer[] = [];
    let changedClips = 0;
    for (const { track, ordered, selectedChannels } of prepared) {
      const processed = processNoiseGateChannels(
        selectedChannels,
        gateSettings,
        project.sampleRate,
      );
      const replacements = new Map<string, IClip>();
      let cursor = 0;
      for (const { input, clip, range } of ordered) {
        const selectedLength = range.endSample - range.startSample;
        const sampleData = input.sampleData.map((source, channel) => {
          const next = new Float32Array(source);
          next.set(processed[channel].subarray(cursor, cursor + selectedLength), range.startSample);
          return next;
        });
        const bufferId = generateId();
        pendingBuffers.push({ id: bufferId, sampleRate: project.sampleRate, sampleData });
        replacements.set(clip.id, { ...clip, audioBufferId: bufferId });
        changedClips += 1;
        cursor += selectedLength;
      }
      nextTracks.set(track.id, {
        ...track,
        clips: track.clips.map((clip) => replacements.get(clip.id) ?? clip),
      });
    }

    const updatedProject: IProject = {
      ...project,
      selection,
      tracks: project.tracks.map((track) => nextTracks.get(track.id) ?? track),
    };
    await this.commitPendingAudioBuffers(projectId, pendingBuffers, updatedProject);
    return changedClips;
  }

  /**
   * Apply Change Pitch to every selected clip without changing timeline geometry.
   * All targets and samples are validated before staging; commitPendingAudioBuffers
   * rolls back every buffer if any storage or project write fails.
   */
  async changePitchSelectionOnTracks(
    projectId: string,
    selection: GeneratorSelection,
    settings: ChangePitchSettings,
    targets: readonly ChangePitchTrackAudio[],
  ): Promise<number> {
    if (
      !Number.isFinite(selection.start)
      || !Number.isFinite(selection.end)
      || selection.start < 0
      || selection.end <= selection.start
    ) {
      throw new RangeError('变调选区必须是有限的正时长区间');
    }
    validateChangePitchSettings(settings);
    if (isChangePitchBypassed(settings)) return 0;
    const project = this.currentProject?.id === projectId
      ? this.currentProject
      : await this.getProject(projectId);
    if (!project) throw new Error('工程不存在');
    if (targets.length === 0) throw new Error('选区内没有可处理的音频');

    const seenTracks = new Set<string>();
    const prepared: {
      track: ITrack;
      input: ChangePitchClipAudio;
      clip: IClip;
      range: { startSample: number; endSample: number };
      selectedChannels: Float32Array[];
    }[] = [];
    let totalOutputSamples = 0;

    // Complete all ownership, geometry and source validation before processing.
    for (const target of targets) {
      if (seenTracks.has(target.trackId)) throw new Error(`轨道 ${target.trackId} 被重复指定`);
      seenTracks.add(target.trackId);
      const track = project.tracks.find((candidate) => candidate.id === target.trackId);
      if (!track) throw new Error(`目标轨道不可用：${target.trackId}`);
      const expectedClipIds = track.clips
        .filter((clip) => (
          selection.end > clip.startTime
          && selection.start < clip.startTime + clip.duration
        ))
        .map((clip) => clip.id)
        .sort();
      const suppliedClipIds = target.clips.map((input) => input.clipId).sort();
      if (
        expectedClipIds.length !== suppliedClipIds.length
        || expectedClipIds.some((clipId, index) => clipId !== suppliedClipIds[index])
      ) {
        throw new Error(`轨道 ${target.trackId} 的选区片段覆盖不完整`);
      }
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
        if (!range) throw new Error(`片段“${clip.name ?? clip.id}”不在变调选区内`);
        const selectedChannels = input.sampleData.map((channel) => (
          channel.slice(range.startSample, range.endSample)
        ));
        totalOutputSamples += channelLength * channelCount;
        if (!Number.isSafeInteger(totalOutputSamples)
          || totalOutputSamples > MAX_CHANGE_PITCH_TOTAL_OUTPUT_SAMPLES) {
          throw new RangeError('Change Pitch 总输出超过浏览器内存上限');
        }
        prepared.push({ track, input, clip, range, selectedChannels });
      }
    }

    const pendingBuffers: PendingAudioBuffer[] = [];
    const replacements = new Map<string, Map<string, IClip>>();
    for (const { track, input, clip, range, selectedChannels } of prepared) {
      const shifted = processChangePitchChannels(selectedChannels, settings, project.sampleRate);
      const processed = input.sampleData.map((channel, channelIndex) => {
        const next = new Float32Array(channel);
        next.set(shifted[channelIndex], range.startSample);
        return next;
      });
      const bufferId = generateId();
      pendingBuffers.push({ id: bufferId, sampleRate: project.sampleRate, sampleData: processed });
      const trackReplacements = replacements.get(track.id) ?? new Map<string, IClip>();
      // Preserve selection, clip boundaries, trim, gain, fades and stretch metadata.
      trackReplacements.set(clip.id, { ...clip, audioBufferId: bufferId });
      replacements.set(track.id, trackReplacements);
    }

    const updatedProject: IProject = {
      ...project,
      selection,
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
    return prepared.length;
  }

  /** Apply Audacity Click Removal as one all-or-nothing multi-track transaction. */
  async clickRemovalSelectionOnTracks(
    projectId: string,
    selection: GeneratorSelection,
    settings: ClickRemovalSettings,
    targets: ClickRemovalTrackAudio[],
  ): Promise<number> {
    if (
      !Number.isFinite(selection.start) || !Number.isFinite(selection.end)
      || selection.start < 0 || selection.end <= selection.start
    ) {
      throw new RangeError('Click Removal 需要有效的正时长选区');
    }
    validateClickRemovalSettings(settings);
    if (targets.length === 0) throw new Error('没有可应用 Click Removal 的音频选区');
    if (new Set(targets.map(({ trackId }) => trackId)).size !== targets.length) {
      throw new Error('Click Removal 目标包含重复轨道');
    }
    const project = this.currentProject?.id === projectId
      ? this.currentProject
      : await this.getProject(projectId);
    if (!project) throw new Error('Project not found');
    if (isClickRemovalBypassed(settings)) return 0;

    // No I/O occurs until every track has passed ownership, layout and DSP checks.
    const processed = targets.map((target) => {
      const track = project.tracks.find(({ id }) => id === target.trackId);
      if (!track) throw new Error(`Track not found: ${target.trackId}`);
      return {
        track,
        result: processClickRemovalTrack(track, target, selection, settings, project.sampleRate),
      };
    });
    const changedTracks = processed.filter(({ result }) => result.changed);
    if (changedTracks.length === 0) throw new Error(CLICK_REMOVAL_INEFFECTIVE_ERROR);

    const pendingBuffers: PendingAudioBuffer[] = [];
    const replacements = new Map<string, Map<string, string>>();
    for (const { track, result } of changedTracks) {
      const trackReplacements = new Map<string, string>();
      for (const clip of result.clips) {
        const id = generateId();
        pendingBuffers.push({ id, sampleRate: project.sampleRate, sampleData: clip.sampleData });
        trackReplacements.set(clip.clipId, id);
      }
      replacements.set(track.id, trackReplacements);
    }
    const updatedProject: IProject = {
      ...project,
      selection,
      tracks: project.tracks.map((track) => {
        const trackReplacements = replacements.get(track.id);
        if (!trackReplacements) return track;
        return {
          ...track,
          clips: track.clips.map((clip) => {
            const audioBufferId = trackReplacements.get(clip.id);
            return audioBufferId ? { ...clip, audioBufferId } : clip;
          }),
        };
      }),
    };
    await this.commitPendingAudioBuffers(projectId, pendingBuffers, updatedProject);
    return pendingBuffers.length;
  }

  /** Learn the official 1025-bin noise profile without changing project audio. */
  async learnNoiseReductionProfile(
    projectId: string,
    selection: GeneratorSelection,
    targets: NoiseReductionTrackAudio[],
  ): Promise<NoiseReductionProfile> {
    if (
      !Number.isFinite(selection.start) || !Number.isFinite(selection.end)
      || selection.start < 0 || selection.end <= selection.start
    ) throw new RangeError('Noise Profile 需要有效的正时长选区');
    const project = this.currentProject?.id === projectId
      ? this.currentProject
      : await this.getProject(projectId);
    if (!project) throw new Error('Project not found');
    return learnNoiseProfileFromTracks(project.tracks, targets, selection, project.sampleRate);
  }

  /** Apply Audacity Noise Reduction as one all-or-nothing multi-track transaction. */
  async noiseReductionSelectionOnTracks(
    projectId: string,
    selection: GeneratorSelection,
    settings: NoiseReductionSettings,
    profile: NoiseReductionProfile,
    targets: NoiseReductionTrackAudio[],
  ): Promise<number> {
    if (
      !Number.isFinite(selection.start) || !Number.isFinite(selection.end)
      || selection.start < 0 || selection.end <= selection.start
    ) throw new RangeError('Noise Reduction 需要有效的正时长选区');
    validateNoiseReductionSettings(settings);
    if (targets.length === 0) throw new Error('没有可应用 Noise Reduction 的音频选区');
    if (new Set(targets.map(({ trackId }) => trackId)).size !== targets.length) {
      throw new Error('Noise Reduction 目标包含重复轨道');
    }
    const project = this.currentProject?.id === projectId
      ? this.currentProject
      : await this.getProject(projectId);
    if (!project) throw new Error('Project not found');

    // All ownership, selection, profile and DSP checks finish before the first write.
    const processed = targets.map((target) => {
      const track = project.tracks.find(({ id }) => id === target.trackId);
      if (!track) throw new Error(`Track not found: ${target.trackId}`);
      return processNoiseReductionTrack(
        track,
        target,
        selection,
        profile,
        settings,
        project.sampleRate,
      );
    });
    const totalSamples = processed.reduce(
      (sum, result) => sum + result.selectionChannels.reduce((trackSum, channel) => trackSum + channel.length, 0),
      0,
    );
    if (totalSamples > MAX_NOISE_REDUCTION_TOTAL_SAMPLES) {
      throw new RangeError('Noise Reduction 选区过大，请分段处理');
    }

    const pendingBuffers: PendingAudioBuffer[] = [];
    const replacements = new Map<string, Map<string, string>>();
    for (const result of processed) {
      const trackReplacements = new Map<string, string>();
      for (const clip of result.clips) {
        const id = generateId();
        pendingBuffers.push({ id, sampleRate: project.sampleRate, sampleData: clip.sampleData });
        trackReplacements.set(clip.clipId, id);
      }
      replacements.set(result.trackId, trackReplacements);
    }
    const updatedProject: IProject = {
      ...project,
      selection,
      tracks: project.tracks.map((track) => {
        const trackReplacements = replacements.get(track.id);
        if (!trackReplacements) return track;
        return {
          ...track,
          clips: track.clips.map((clip) => {
            const audioBufferId = trackReplacements.get(clip.id);
            return audioBufferId ? { ...clip, audioBufferId } : clip;
          }),
        };
      }),
    };
    await this.commitPendingAudioBuffers(projectId, pendingBuffers, updatedProject);
    return pendingBuffers.length;
  }

  /**
   * Apply Audacity 4.0.2 Truncate Silence with one multi-track project commit.
   * The affected timeline range is rendered into a new clip; untouched edges
   * remain non-destructive and all following clips ripple by the exact delta.
   */
  async truncateSilenceSelectionOnTracks(
    projectId: string,
    selection: GeneratorSelection,
    settings: TruncateSilenceSettings,
    targets: readonly TruncateSilenceTrackInput[],
  ): Promise<{ project: IProject; selectionEnd: number; changedTracks: number }> {
    const project = this.currentProject?.id === projectId
      ? this.currentProject
      : await this.getProject(projectId);
    if (!project) throw new Error('Project not found');
    const quantized = quantizeSelectionToSamples(selection, project.sampleRate);
    if (!quantized) throw new RangeError('Truncate Silence 需要有效的正时长选区');

    // Every owner, layout, finite sample and DSP result exists before any I/O.
    const processed = processTruncateSilenceTracks(
      project.tracks,
      targets,
      quantized,
      settings,
      project.sampleRate,
    );
    const changed = processed.tracks.filter(({ changed: hasCuts }) => hasCuts);
    if (changed.length === 0) {
      return { project, selectionEnd: quantized.end, changedTracks: 0 };
    }

    const pendingBuffers: PendingAudioBuffer[] = [];
    const replacements = new Map<string, ITrack>();
    for (const result of changed) {
      const track = project.tracks.find(({ id }) => id === result.trackId);
      if (!track) throw new Error(`Track not found: ${result.trackId}`);
      const audioBufferId = generateId();
      const duration = result.sampleData[0].length / project.sampleRate;
      pendingBuffers.push({
        id: audioBufferId,
        sampleRate: project.sampleRate,
        sampleData: result.sampleData,
      });
      const generatedClip: IClip = {
        id: generateId(),
        audioBufferId,
        startTime: result.editStart,
        offset: 0,
        duration,
        originalDuration: duration,
        stretchRatio: 1,
        gain: 0,
        fadeIn: 0,
        fadeOut: 0,
        name: `${track.name ?? '音轨'} · Truncate Silence`,
      };
      replacements.set(track.id, replaceTrackSelectionWithClip(
        track,
        {
          start: result.editStart,
          end: result.editStart + result.originalEditDuration,
          allowDurationChange: true,
        },
        generatedClip,
        generateId,
      ));
    }
    const updatedProject: IProject = {
      ...project,
      selection: { start: quantized.start, end: processed.selectionEnd },
      tracks: project.tracks.map((track) => replacements.get(track.id) ?? track),
    };
    await this.commitPendingAudioBuffers(projectId, pendingBuffers, updatedProject);
    return {
      project: updatedProject,
      selectionEnd: processed.selectionEnd,
      changedTracks: changed.length,
    };
  }

  /**
   * Apply Audacity 4.0.2 Repair to each selected track. Every target supplies
   * all clips on its track so context can cross adjacent clip boundaries.
   * Stretched selected clips, >128-sample selections and missing context are
   * rejected before any interpolation or IndexedDB write takes place.
   */
  async repairSelectionOnTracks(
    projectId: string,
    selection: GeneratorSelection,
    targets: RepairTrackAudio[],
  ): Promise<number> {
    if (
      !Number.isFinite(selection.start) || !Number.isFinite(selection.end)
      || selection.start < 0 || selection.end <= selection.start
    ) throw new RangeError('Repair 需要有效的正时长选区');
    if (targets.length === 0) throw new Error('选区内没有可修复的音频');
    const project = this.currentProject?.id === projectId
      ? this.currentProject
      : await this.getProject(projectId);
    if (!project) throw new Error('工程不存在');
    const rate = project.sampleRate;
    const seenTracks = new Set<string>();

    type RepairAffected = {
      clip: IClip;
      input: RepairClipAudio;
      clipStart: number;
      sourceStart: number;
      overlapStart: number;
      overlapEnd: number;
    };
    const prepared: Array<{
      track: ITrack;
      contextStart: number;
      firstBad: number;
      repairLength: number;
      contextChannels: Float32Array[];
      affected: RepairAffected[];
    }> = [];

    for (const target of targets) {
      if (seenTracks.has(target.trackId)) throw new Error('Repair 目标轨道重复');
      seenTracks.add(target.trackId);
      const track = project.tracks.find(({ id }) => id === target.trackId);
      if (!track) throw new Error('目标轨道不可用');
      if (track.clips.length === 0) continue;
      const inputs = new Map<string, RepairClipAudio>();
      for (const input of target.clips) {
        if (inputs.has(input.clipId) || !track.clips.some(({ id }) => id === input.clipId)) {
          throw new Error('Repair 目标片段不可用');
        }
        inputs.set(input.clipId, input);
      }
      if (inputs.size !== track.clips.length || track.clips.some(({ id }) => !inputs.has(id))) {
        throw new Error('Repair 需要完整轨道音频以读取上下文');
      }

      const selectedClips = track.clips.filter((clip) => (
        selection.end > clip.startTime && selection.start < clip.startTime + clip.duration
      ));
      if (selectedClips.length === 0) throw new Error('Repair 选区内没有可处理的片段');
      for (const clip of selectedClips) {
        if (Math.abs(getClipStretchRatio(clip) - 1) >= 0.000001) {
          throw new Error('Repair 不能用于包含时间拉伸或变调剪辑的选区');
        }
      }

      const trackStart = Math.min(...track.clips.map(({ startTime }) => startTime));
      const trackEnd = Math.max(...track.clips.map((clip) => clip.startTime + clip.duration));
      const repairTimeStart = Math.max(trackStart, selection.start);
      const repairTimeEnd = Math.min(trackEnd, selection.end);
      if (repairTimeEnd <= repairTimeStart) throw new Error('Repair 选区与轨道没有有效重叠');
      const repairStart = Math.round(repairTimeStart * rate);
      const repairEnd = Math.round(repairTimeEnd * rate);
      const repairLength = repairEnd - repairStart;
      if (repairLength <= 0) throw new Error('Repair 选区内没有采样');
      if (repairLength > MAX_REPAIR_SAMPLES) {
        throw new RangeError(`Repair 每条轨道每次最多修复 ${MAX_REPAIR_SAMPLES} 个采样`);
      }

      const spacing = Math.max((repairTimeEnd - repairTimeStart) * 2, MAX_REPAIR_SAMPLES / rate);
      const contextStart = Math.round(Math.max(trackStart, repairTimeStart - spacing) * rate);
      const contextEnd = Math.round(Math.min(trackEnd, repairTimeEnd + spacing) * rate);
      if (contextStart === repairStart && contextEnd === repairEnd) {
        throw new Error('Repair 需要选区至少一侧有音频上下文');
      }
      const contextLength = contextEnd - contextStart;
      const channelCount = inputs.get(track.clips[0].id)?.sampleData.length ?? 0;
      if (channelCount === 0) throw new Error('Repair 音频没有可用声道');
      for (const clip of track.clips) {
        const input = inputs.get(clip.id)!;
        if (input.sampleData.length !== channelCount
          || input.sampleData.some((channel) => channel.length !== input.sampleData[0].length)) {
          throw new Error('Repair 轨道的片段声道布局不一致');
        }
      }
      const contextChannels = Array.from(
        { length: channelCount },
        () => new Float32Array(contextLength),
      );
      const affected: RepairAffected[] = [];

      for (const clip of track.clips) {
        const input = inputs.get(clip.id)!;
        if (!Number.isFinite(input.sourceOffset) || input.sourceOffset < 0) {
          throw new Error('Repair 片段源偏移无效');
        }
        const clipStart = Math.round(clip.startTime * rate);
        const clipEnd = Math.round((clip.startTime + clip.duration) * rate);
        const sourceStart = Math.round(input.sourceOffset * rate);
        const copyStart = Math.max(contextStart, clipStart);
        const copyEnd = Math.min(contextEnd, clipEnd);
        for (let position = copyStart; position < copyEnd; position += 1) {
          const sourceIndex = sourceStart + position - clipStart;
          if (sourceIndex < 0 || sourceIndex >= input.sampleData[0].length) continue;
          for (let channel = 0; channel < channelCount; channel += 1) {
            contextChannels[channel][position - contextStart] = input.sampleData[channel][sourceIndex];
          }
        }
        if (selectedClips.some(({ id }) => id === clip.id)) {
          affected.push({
            clip,
            input,
            clipStart,
            sourceStart,
            overlapStart: Math.max(repairStart, clipStart),
            overlapEnd: Math.min(repairEnd, clipEnd),
          });
        }
      }
      prepared.push({
        track,
        contextStart,
        firstBad: repairStart - contextStart,
        repairLength,
        contextChannels,
        affected,
      });
    }

    const random = createRepairRandom();
    const pendingBuffers: PendingAudioBuffer[] = [];
    const replacements = new Map<string, Map<string, IClip>>();
    for (const item of prepared) {
      const repaired = item.contextChannels.map((channel) => (
        interpolateRepairAudio(channel, item.firstBad, item.repairLength, random)
      ));
      for (const affected of item.affected) {
        if (affected.overlapEnd <= affected.overlapStart) continue;
        const processed = affected.input.sampleData.map((channel) => new Float32Array(channel));
        for (let position = affected.overlapStart; position < affected.overlapEnd; position += 1) {
          const sourceIndex = affected.sourceStart + position - affected.clipStart;
          if (sourceIndex < 0 || sourceIndex >= processed[0].length) continue;
          for (let channel = 0; channel < processed.length; channel += 1) {
            processed[channel][sourceIndex] = repaired[channel][position - item.contextStart];
          }
        }
        const bufferId = generateId();
        pendingBuffers.push({ id: bufferId, sampleRate: rate, sampleData: processed });
        const trackReplacements = replacements.get(item.track.id) ?? new Map<string, IClip>();
        trackReplacements.set(affected.clip.id, { ...affected.clip, audioBufferId: bufferId });
        replacements.set(item.track.id, trackReplacements);
      }
    }
    if (pendingBuffers.length === 0) throw new Error('Repair 没有可写入的选区采样');
    const updatedProject: IProject = {
      ...project,
      selection,
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
    return pendingBuffers.length;
  }

  /**
   * Apply Audacity 4.0.2 Limiter to complete selected ranges. LimiterSettings
   * always process audio (there is no neutral-parameter bypass); concatenating
   * clips per track preserves the shared sidechain, release and look-ahead
   * state, with one latency compensation before the single atomic commit.
   */
  async limiterSelectionOnTracks(
    projectId: string,
    selection: GeneratorSelection,
    settings: LimiterSettings,
    targets: readonly LimiterTrackAudio[],
  ): Promise<number> {
    if (
      !Number.isFinite(selection.start)
      || !Number.isFinite(selection.end)
      || selection.start < 0
      || selection.end <= selection.start
    ) {
      throw new RangeError('Limiter 选区必须是有限的正时长区间');
    }
    validateLimiterSettings(settings);
    const project = this.currentProject?.id === projectId
      ? this.currentProject
      : await this.getProject(projectId);
    if (!project) throw new Error('工程不存在');
    if (targets.length === 0) throw new Error('选区内没有可处理的音频');

    const seenTracks = new Set<string>();
    const prepared: {
      track: ITrack;
      ordered: {
        input: LimiterClipAudio;
        clip: IClip;
        range: { startSample: number; endSample: number };
      }[];
      selectedChannels: Float32Array[];
    }[] = [];

    // Validate every owner, range and channel layout before processing or writes.
    for (const target of targets) {
      if (seenTracks.has(target.trackId)) throw new Error(`轨道 ${target.trackId} 被重复指定`);
      seenTracks.add(target.trackId);
      const track = project.tracks.find((candidate) => candidate.id === target.trackId);
      if (!track) throw new Error(`目标轨道不可用：${target.trackId}`);
      const seenClips = new Set<string>();
      const mapped = target.clips.map((input) => {
        if (seenClips.has(input.clipId)) throw new Error(`片段 ${input.clipId} 被重复指定`);
        seenClips.add(input.clipId);
        const clip = track.clips.find((candidate) => candidate.id === input.clipId);
        if (!clip) throw new Error(`目标片段不可用：${input.clipId}`);
        return { input, clip };
      }).sort((left, right) => left.clip.startTime - right.clip.startTime);
      if (mapped.length === 0) throw new Error(`轨道 ${target.trackId} 没有可处理的选区音频`);
      const selectedClipIds = track.clips.filter((clip) => (
        clip.startTime + clip.duration > selection.start && clip.startTime < selection.end
      )).map((clip) => clip.id);
      if (
        selectedClipIds.length !== mapped.length
        || selectedClipIds.some((clipId) => !seenClips.has(clipId))
      ) {
        throw new Error(`轨道 ${target.trackId} 的选区片段覆盖不完整`);
      }

      const channelCount = mapped[0]?.input.sampleData.length ?? 0;
      if (channelCount === 0) throw new Error(`轨道 ${target.trackId} 没有音频声道`);
      let totalSelectedSamples = 0;
      const ordered = mapped.map(({ input, clip }) => {
        if (input.sampleData.length !== channelCount) {
          throw new Error(`轨道 ${target.trackId} 的选区声道数不一致`);
        }
        const channelLength = input.sampleData[0]?.length ?? 0;
        if (input.sampleData.some((channel) => channel.length !== channelLength)) {
          throw new Error(`片段“${clip.name ?? clip.id}”的声道长度不一致`);
        }
        const range = getClipSampleRange(
          clip,
          selection,
          input.sourceOffset,
          project.sampleRate,
          channelLength,
        );
        if (!range) throw new Error(`片段“${clip.name ?? clip.id}”不在 Limiter 选区内`);
        totalSelectedSamples += range.endSample - range.startSample;
        return { input, clip, range };
      });
      if (!Number.isSafeInteger(totalSelectedSamples) || totalSelectedSamples < 1) {
        throw new RangeError(`轨道 ${target.trackId} 的 Limiter 选区采样数无效`);
      }
      const selectedChannels = Array.from(
        { length: channelCount },
        () => new Float32Array(totalSelectedSamples),
      );
      let cursor = 0;
      for (const { input, range } of ordered) {
        const length = range.endSample - range.startSample;
        input.sampleData.forEach((channel, index) => {
          selectedChannels[index].set(channel.subarray(range.startSample, range.endSample), cursor);
        });
        cursor += length;
      }
      prepared.push({ track, ordered, selectedChannels });
    }

    // No project write happens until every selected track has processed successfully.
    const pendingBuffers: { id: string; sampleRate: number; sampleData: Float32Array[] }[] = [];
    const nextTracks = new Map<string, ITrack>();
    let changedClips = 0;
    try {
      for (const { track, ordered, selectedChannels } of prepared) {
        const processed = processLimiterChannels(selectedChannels, settings, project.sampleRate);
        const replacements = new Map<string, IClip>();
        let cursor = 0;
        for (const { input, clip, range } of ordered) {
          const selectedLength = range.endSample - range.startSample;
          const sampleData = input.sampleData.map((source, channel) => {
            const next = new Float32Array(source);
            next.set(processed[channel].subarray(cursor, cursor + selectedLength), range.startSample);
            return next;
          });
          const bufferId = generateId();
          pendingBuffers.push({ id: bufferId, sampleRate: project.sampleRate, sampleData });
          replacements.set(clip.id, { ...clip, audioBufferId: bufferId });
          changedClips += 1;
          cursor += selectedLength;
        }
        nextTracks.set(track.id, {
          ...track,
          clips: track.clips.map((clip) => replacements.get(clip.id) ?? clip),
        });
      }
    } catch (error) {
      for (const buffer of pendingBuffers) {
        try {
          await audioDb.audioBuffers.delete(buffer.id);
        } catch {
          // No newly staged buffer is exposed through the project on failure.
        }
      }
      throw error;
    }

    const updatedProject: IProject = {
      ...project,
      selection: { ...selection },
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
      selection,
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
      selection,
      tracks: project.tracks.map((track) => nextTracks.get(track.id) ?? track),
    };
    await this.commitPendingAudioBuffers(projectId, pendingBuffers, updatedProject);
    return changedClips;
  }

  /**
   * Apply Audacity Loudness Normalization as one all-or-nothing transaction.
   * Every complete track is assembled and analysed before the first buffer or
   * project write, so a silent/invalid later track cannot partially commit.
   */
  async loudnessSelectionOnTracks(
    projectId: string,
    selection: GeneratorSelection,
    settings: LoudnessSettings,
    targets: readonly LoudnessTrackAudio[],
  ): Promise<number> {
    if (
      !Number.isFinite(selection.start) || !Number.isFinite(selection.end)
      || selection.start < 0 || selection.end <= selection.start
    ) throw new RangeError('Loudness 需要有效的正时长选区');
    validateLoudnessSettings(settings);
    if (targets.length === 0) throw new Error('没有可应用 Loudness 的音频选区');
    if (new Set(targets.map(({ trackId }) => trackId)).size !== targets.length) {
      throw new Error('Loudness 目标包含重复轨道');
    }
    const project = this.currentProject?.id === projectId
      ? this.currentProject
      : await this.getProject(projectId);
    if (!project) throw new Error('Project not found');

    const processed = targets.map((target) => {
      const track = project.tracks.find(({ id }) => id === target.trackId);
      if (!track) throw new Error(`Track not found: ${target.trackId}`);
      return processLoudnessTrack(track, target, selection, settings, project.sampleRate);
    });
    const totalSamples = processed.reduce(
      (sum, result) => sum + result.selectionChannels.reduce(
        (trackSum, channel) => trackSum + channel.length, 0,
      ), 0,
    );
    if (totalSamples > MAX_LOUDNESS_TOTAL_SAMPLES) {
      throw new RangeError('Loudness 选区过大，请分段处理');
    }

    const pendingBuffers: PendingAudioBuffer[] = [];
    const replacements = new Map<string, Map<string, string>>();
    for (const result of processed) {
      const trackReplacements = new Map<string, string>();
      for (const clip of result.clips) {
        const id = generateId();
        pendingBuffers.push({ id, sampleRate: project.sampleRate, sampleData: clip.sampleData });
        trackReplacements.set(clip.clipId, id);
      }
      replacements.set(result.trackId, trackReplacements);
    }
    const updatedProject: IProject = {
      ...project,
      selection,
      tracks: project.tracks.map((track) => {
        const trackReplacements = replacements.get(track.id);
        if (!trackReplacements) return track;
        return {
          ...track,
          clips: track.clips.map((clip) => {
            const audioBufferId = trackReplacements.get(clip.id);
            return audioBufferId ? { ...clip, audioBufferId } : clip;
          }),
        };
      }),
    };
    await this.commitPendingAudioBuffers(projectId, pendingBuffers, updatedProject);
    return pendingBuffers.length;
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
      selection,
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

    if (changedClips > 0) {
      project.selection = selection;
      await this.saveProject(project);
    }
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
