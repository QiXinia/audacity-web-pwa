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
import { audioEngine } from '@/engine/audioEngine';
import { wasmProcessor } from '@/wasm/processor';

type EffectType = IEffect['type'];

const PREFS_KEY = '__audacity_web_prefs';

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

    await audioDb.audioBuffers.put({
      id: bufferId,
      projectId,
      sampleRate,
      channels: channelData.length,
      length: channelData[0].length,
      duration,
      channelData: channelData.map((channel) =>
        channel.buffer.slice(channel.byteOffset, channel.byteOffset + channel.byteLength) as ArrayBuffer,
      ),
      createdAt: Date.now(),
    });

    // Cache all channels for playback and export.
    audioEngine.cacheBuffer(bufferId, channelData, sampleRate);

    onProgress?.(0.95);

    // Create clip
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

    track.clips.push(clip);
    track.clips.sort((a, b) => a.startTime - b.startTime);
    await this.saveProject(project);

    onProgress?.(1);

    return clip;
  }

  async addRecordingToTrack(
    projectId: string,
    trackId: string,
    sampleData: Float32Array[],
    sampleRate: number,
    startTime: number,
  ): Promise<IClip | null> {
    const project = this.currentProject?.id === projectId
      ? this.currentProject
      : await this.getProject(projectId);
    if (!project) return null;

    const track = project.tracks.find((t) => t.id === trackId);
    if (!track) return null;

    const bufferId = generateId();
    const numChannels = sampleData.length;
    const length = sampleData[0]?.length ?? 0;
    const duration = length / sampleRate;

    await audioDb.audioBuffers.put({
      id: bufferId,
      projectId,
      sampleRate,
      channels: numChannels,
      length,
      duration,
      channelData: sampleData.map((ch) => ch.buffer as ArrayBuffer),
      createdAt: Date.now(),
    });

    audioEngine.cacheBuffer(bufferId, sampleData, sampleRate);

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
      name: `录音 ${new Date().toLocaleTimeString()}`,
    };

    track.clips.push(clip);
    track.clips.sort((a, b) => a.startTime - b.startTime);
    await this.saveProject(project);

    return clip;
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
      timeSignature: record.timeSignature,
      tempo: record.tempo,
      tracks: deserializeTracks(record.tracksData),
      cursorPosition: 0,
      selection: deserializeSelection(record.selectionData),
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
