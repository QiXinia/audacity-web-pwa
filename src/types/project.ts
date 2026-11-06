// EXPORTS: IProjectSummary, IProject, ITrack, IClip, IEffect, IPreferences, ViewMode, ProjectStatus, EffectType, TrackType

export type ViewMode = 'waveform' | 'spectrum' | 'both';
export type ProjectStatus = 'active' | 'deleted';
export type EffectType = 'eq' | 'compressor' | 'reverb' | 'delay' | 'noiseGate' | 'gain' | 'highPass' | 'lowPass';
export type TrackType = 'audio';
export type SnapMode = 'clips' | 'samples' | 'milliseconds' | 'seconds' | 'beats' | 'bars';

export interface IProjectSummary {
  id: string;
  name: string;
  sampleRate: number;
  duration: number;
  trackCount: number;
  updatedAt: number;
  createdAt: number;
  status: ProjectStatus;
  deletedAt?: number;
  thumbnail?: string;
}

export interface IClip {
  id: string;
  audioBufferId: string;
  startTime: number;
  offset: number;
  duration: number;
  originalDuration: number;
  /** Source seconds per timeline second: 2 = half duration, 0.5 = double duration. */
  stretchRatio?: number;
  gain: number;
  fadeIn: number;
  fadeOut: number;
  name?: string;
}

export interface IEffect {
  id: string;
  type: EffectType;
  bypassed: boolean;
  params: Record<string, number>;
}

export interface ITrack {
  id: string;
  name: string;
  type: TrackType;
  gain: number;
  pan: number;
  muted: boolean;
  solo: boolean;
  armed: boolean;
  color: string;
  clips: IClip[];
  effects: IEffect[];
}

export interface IViewState {
  horizontalZoom: number;
  verticalZoom: number;
  scrollX: number;
  viewMode: ViewMode;
  snapEnabled?: boolean;
  snapMode?: SnapMode;
}

export interface IProject {
  id: string;
  name: string;
  sampleRate: number;
  timeSignature: { numerator: number; denominator: number };
  tempo: number;
  tracks: ITrack[];
  cursorPosition: number;
  selection: { start: number; end: number } | null;
  /** Independent Audacity 4-style loop region; legacy projects omit both fields. */
  loopRegion?: { start: number; end: number } | null;
  loopEnabled?: boolean;
  viewState: IViewState;
  updatedAt: number;
  createdAt: number;
}

export interface IPreferences {
  theme: 'dark' | 'light';
  defaultSampleRate: number;
  defaultFormat: 'wav' | 'mp3' | 'ogg';
  bufferSize: number;
  language: 'zh-CN' | 'en';
  autoSave: boolean;
  autoBackup: boolean;
  maxRecordingDuration: number;
  useWasm: boolean;
}
