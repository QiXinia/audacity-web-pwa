// EXPORTS: IProjectSummary, IProject, ITrack, IClip, IEffect, IPreferences, ViewMode, ProjectStatus, EffectType, TrackType

export type ViewMode = 'waveform' | 'waveformDb' | 'waveformDbLinear' | 'spectrum' | 'both';
export type ProjectStatus = 'active' | 'deleted';
export type EffectType = 'eq' | 'compressor' | 'reverb' | 'delay' | 'noiseGate' | 'gain' | 'highPass' | 'lowPass';
export type TrackType = 'audio';
export type TrackSampleFormat = 'int16' | 'int24' | 'float32';
export type DitherType = 'none' | 'rectangle' | 'triangle' | 'shaped';
export type SnapMode = 'clips' | 'samples' | 'milliseconds' | 'seconds' | 'beats' | 'bars';
export type { FrequencySelection } from '@/lib/spectralSelection';
import type { FrequencySelection } from '@/lib/spectralSelection';

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
  /** Audacity 4 non-destructive clip pitch in cents. */
  pitchCents?: number;
  /** Audacity 4 PitchAndSpeedPreset::OptimizeForVoice (browser approximation). */
  optimizeForVoice?: boolean;
  /** Audacity 4 Stretch with tempo changes; legacy clips default to true. */
  stretchToMatchTempo?: boolean;
  /** Source BPM used by Audacity 4 clip/project tempo matching. */
  rawAudioTempo?: number;
  /** Frozen or current project BPM; stretchRatio remains the actual playback ratio. */
  clipTempo?: number;
  /** Audacity 4 ClipColorIndex: 0/undefined inherits the track; 1…9 selects a theme color. */
  colorIndex?: number;
  /** Audacity 4 non-destructive clip group; undefined is the native -1/ungrouped state. */
  groupId?: number;
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

export type SpectrogramScale = 'linear' | 'logarithmic' | 'mel' | 'bark' | 'erb' | 'period';
export type SpectrogramColorScheme = 'roseus' | 'classic' | 'grayscale' | 'inverse-grayscale';
export type SpectrogramAlgorithm = 'frequencies' | 'reassignment' | 'pitch';
export type SpectrogramWindowType = 'rectangular' | 'bartlett' | 'hamming' | 'hann'
  | 'blackman' | 'blackman-harris' | 'welch' | 'gaussian25' | 'gaussian35' | 'gaussian45';

export interface ISpectrogramSettings {
  scale: SpectrogramScale;
  minFreq: number;
  maxFreq: number;
  gainDb: number;
  rangeDb: number;
  highBoostDbPerDec: number;
  colorScheme: SpectrogramColorScheme;
  algorithm: SpectrogramAlgorithm;
  windowType: SpectrogramWindowType;
  windowSize: number;
  zeroPaddingFactor: number;
}

export interface ISpectrogramPreferences extends ISpectrogramSettings {
  spectralSelectionEnabled: boolean;
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
  /** Persistent channel layout, including empty tracks; legacy tracks infer it from PCM metadata. */
  channelCount?: 1 | 2;
  /** Audacity stored sample format; decoded browser PCM is float32 until explicitly narrowed. */
  sampleFormat?: TrackSampleFormat;
  /** Persistent empty-track rate; non-empty tracks prefer their actual PCM metadata. */
  sampleRate?: number;
  /** Audacity per-track TrackViewType; legacy tracks inherit the Workspace default. */
  viewMode?: ViewMode;
  /** Audacity per-track Half-wave state; legacy tracks inherit the Workspace default. */
  halfWave?: boolean;
  /** Audacity per-track Spectrogram settings; legacy tracks inherit the official global defaults. */
  spectrogramUseGlobalSettings?: boolean;
  spectrogramSettings?: ISpectrogramSettings;
}

export interface IViewState {
  horizontalZoom: number;
  verticalZoom: number;
  scrollX: number;
  viewMode: ViewMode;
  snapEnabled?: boolean;
  snapMode?: SnapMode;
}

export interface ILabelTrack {
  id: string;
  name: string;
  /** Audacity TrackColorIndex; 0/undefined inherits the default label color. */
  colorIndex?: number;
}

export interface IAnalysisLabel {
  id: string;
  /** Clipping labels retain their source channel; manual labels have no fabricated channel. */
  kind: 'clipping' | 'manual';
  /** Source audio track used for navigation and analysis provenance. */
  trackId: string;
  /** Independent Label Track; legacy labels inherit the first effective label track. */
  labelTrackId?: string;
  channelIndex?: number;
  start: number;
  end: number;
  text: string;
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
  /** Independent Label Tracks; legacy projects inherit one implicit track when labels exist. */
  labelTracks?: ILabelTrack[];
  /** Persistent Audacity-style analysis labels; legacy projects omit this field. */
  analysisLabels?: IAnalysisLabel[];
  /** Independent linear frequency range; legacy projects omit this field. */
  spectralSelection?: FrequencySelection | null;
  /** Independent Audacity 4-style loop region; legacy projects omit both fields. */
  loopRegion?: { start: number; end: number } | null;
  loopEnabled?: boolean;
  viewState: IViewState;
  updatedAt: number;
  createdAt: number;
}

export type HighQualitySampleRateConverter =
  | 'lowQuality'
  | 'mediumQuality'
  | 'highQuality'
  | 'bestQuality';

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
  /** Audacity /Quality/HQDitherAlgorithmChoice; defaults to shaped. */
  highQualityDither: DitherType;
  /** Audacity /Quality/LibsoxrHQSampleRateConverterChoice; defaults to bestQuality. */
  highQualitySampleRateConverter: HighQualitySampleRateConverter;
  /** Audacity /GUI/MoveSelectionWithTracks; defaults to false. */
  moveSelectionWithTracks: boolean;
  /** Audacity /GUI/SyncLockTracks; defaults to false. */
  syncLockTracks: boolean;
}
