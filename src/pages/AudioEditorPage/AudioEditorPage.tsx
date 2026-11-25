import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { logger } from '@/lib/logger';
import {
  Play,
  Pause,
  StopCircle,
  Mic,
  SkipBack,
  SkipForward,
  Undo2,
  Redo2,
  Save,
  Download,
  Plus,
  Trash2,
  Volume2,
  VolumeX,
  Headphones,
  Music,
  ZoomIn,
  ZoomOut,
  Waves,
  BarChart3,
  Layers,
  ArrowLeft,
  Scissors,
  Copy,
  Clipboard,
  Crop,
  GripVertical,
  Eye,
  EyeOff,
  Settings,
  Trash,
  MicOff,
  X,
  MousePointer2,
  AudioWaveform,
  Link2,
  Magnet,
  Repeat,
} from 'lucide-react';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { DeleteBehaviorPanel } from '@/components/DeleteBehaviorPanel';
import { SelectionContextMenu } from '@/components/SelectionContextMenu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from '@/components/ui/dropdown-menu';
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { audioEngine, type PlaybackState, type RecordingState } from '@/engine/audioEngine';
import { audioDb } from '@/db/audioDb';
import { getMp3SampleRate } from '@/engine/mp3Encoder';
import {
  projectService,
  type EchoTrackAudio,
  type MixAndRenderTrackAudio,
  type RepairTrackAudio,
} from '@/services/projectService';
import { historyManager } from '@/services/historyService';
import {
  parseAudioClipboard,
  planClipboardPasteTrackIndices,
  serializeAudioClipboard,
  type AudioClipboardData,
  type AudioClipboardTrack,
} from '@/services/clipboardService';
import { wasmProcessor, isWasmAvailable } from '@/wasm/processor';
import { formatTime, clamp, generateId, dbToGain, gainToDb, resampleBuffer } from '@/lib/audioUtils';
import { generateToneChannels, type ToneRequest } from '@/lib/toneGenerator';
import { generateChirp, type ChirpRequest } from '@/lib/chirpGenerator';
import { generateDtmf, type DtmfRequest } from '@/lib/dtmfGenerator';
import { generatePluck, type PluckRequest } from '@/lib/pluckGenerator';
import { generateRhythmTrack, type RhythmTrackRequest } from '@/lib/rhythmTrackGenerator';
import { generateRissetDrum, type RissetDrumRequest } from '@/lib/rissetDrumGenerator';
import { generateNoise, type NoiseRequest } from '@/lib/noiseGenerator';
import { generateSilence } from '@/lib/silenceGenerator';
import {
  processClickRemovalTrack,
  type ClickRemovalSettings,
} from '@/lib/clickRemovalEffect';
import {
  processNoiseReductionTrack,
  type NoiseReductionProfile,
  type NoiseReductionSettings,
} from '@/lib/noiseReductionEffect';
import {
  processLoudnessTrack,
  type LoudnessSettings,
} from '@/lib/loudnessEffect';
import {
  processFilterCurveEqTrack,
  type FilterCurveEqSettings,
} from '@/lib/filterCurveEffect';
import {
  processGraphicEqTrack,
  type GraphicEqSettings,
} from '@/lib/graphicEqEffect';
import {
  processTruncateSilenceTracks,
  type TruncateSilenceSettings,
} from '@/lib/truncateSilenceEffect';
import { drawWaveform } from '@/lib/waveformDrawing';
import {
  DEFAULT_VERTICAL_ZOOM,
  MAX_VERTICAL_ZOOM,
  MIN_VERTICAL_ZOOM,
  normalizeVerticalZoom,
  stepVerticalZoom,
} from '@/lib/verticalZoom';
import {
  DEFAULT_HORIZONTAL_ZOOM,
  MAX_HORIZONTAL_ZOOM,
  MIN_HORIZONTAL_ZOOM,
  horizontalZoomForDuration,
  normalizeHorizontalZoom,
  stepHorizontalZoom,
} from '@/lib/horizontalZoom';
import {
  getClipSampleRange,
  quantizeSelectionToSamples,
  resolveGeneratorTrackIds,
  type GeneratorSelection,
} from '@/lib/generatorEditing';
import { resolveMixAndRenderTrackIds } from '@/lib/mixAndRenderEffect';
import { resolveRemoveTrackFocus } from '@/lib/trackRemoval';
import { moveTrackInOrder, type TrackMoveDirection } from '@/lib/trackMove';
import { needsMakeStereoRenderWarning } from '@/lib/trackChannelOperations';
import { getTrackSampleFormatLabel, TRACK_SAMPLE_FORMATS } from '@/lib/trackMedia';
import { RESAMPLE_RATE_CHOICES } from '@/lib/resampleEffect';
import type { TrackSortMode } from '@/lib/trackSorting';
import {
  getTrackAlignLabel,
  type TrackAlignMode,
} from '@/lib/trackAlignment';
import {
  measureContrastSelection as measureContrastPcm,
  type ContrastClip,
  type ContrastMeasurement,
} from '@/lib/contrastAnalysis';
import {
  createEchoState,
  getEchoClipSampleRange,
  getEchoPlan,
  processEchoSelection,
} from '@/lib/echoEffect';
import { processDelayChannels, type DelaySettings } from '@/lib/delayEffect';
import { processClipFixChannels, type ClipFixSettings } from '@/lib/clipFixEffect';
import { processNotchFilterChannels, type NotchFilterSettings } from '@/lib/notchFilterEffect';
import { processShelfFilterChannels, type ShelfFilterSettings } from '@/lib/shelfFilterEffect';
import { processSpectralEditChannels, type SpectralEditKind, type SpectralEditSettings } from '@/lib/spectralEditEffect';
import {
  frequencyToSpectrumY,
  getSpectrumRulerTicks,
  normalizeFrequencySelection,
  spectrumYToFrequency,
  type FrequencySelection,
} from '@/lib/spectralSelection';
import {
  mixPlotSpectrumSegments,
  type PlotSpectrumAudio,
  type PlotSpectrumSegment,
} from '@/lib/plotSpectrum';
import {
  analyzeFindClippingTracks,
  type FindClippingSettings,
  type FindClippingTrack,
} from '@/lib/findClipping';
import {
  analyzeLabelSoundsTracks,
  type LabelSoundsSettings,
  type LabelSoundsTrack,
} from '@/lib/labelSounds';
import {
  analyzeBeatFinderTracks,
  type BeatFinderSettings,
  type BeatFinderTrack,
} from '@/lib/beatFinder';
import { measureRmsSelection, type MeasureRmsClip } from '@/lib/measureRms';
import {
  serializeSampleDataExport,
  type SampleDataClip,
  type SampleDataExportFile,
  type SampleDataExportSettings,
} from '@/lib/sampleDataExport';
import {
  parseSampleDataImport,
  type SampleDataImportChannelCount,
  type SampleDataInvalidDataHandling,
} from '@/lib/sampleDataImport';
import {
  createRegularIntervalLabels,
  type RegularIntervalLabelsSettings,
} from '@/lib/regularIntervalLabels';
import {
  processAdjustableFadeChannels,
  type AdjustableFadeSettings,
} from '@/lib/adjustableFadeEffect';
import { processWahWahChannels, type WahWahSettings } from '@/lib/wahWahEffect';
import {
  createPhaserState,
  processPhaserChannels,
  type PhaserSettings,
} from '@/lib/phaserEffect';
import {
  createClassicFilterState,
  processClassicFilterChannels,
  type ClassicFilterSettings,
} from '@/lib/classicFilterEffect';
import {
  createPassFilterState,
  processPassFilterChannels,
  type PassFilterKind,
  type PassFilterSettings,
} from '@/lib/passFilterEffect';
import {
  createTremoloState,
  processTremoloChannels,
  type TremoloSettings,
} from '@/lib/tremoloEffect';
import {
  processVocoderChannels,
  type VocoderSettings,
} from '@/lib/vocoderEffect';
import {
  applyAutoDuckPlanToChannels,
  createAutoDuckPlan,
  getAutoDuckTimelinePlacement,
  renderAutoDuckSelectionChannels,
  type AutoDuckSettings,
} from '@/lib/autoDuckEffect';
import {
  createBassTrebleState,
  processBassTrebleChannels,
  type BassTrebleSettings,
} from '@/lib/bassTrebleEffect';
import {
  createReverbState,
  processReverbChannels,
  type ReverbSettings,
} from '@/lib/reverbEffect';
import {
  createDistortionState,
  processDistortionChannels,
  type DistortionSettings,
} from '@/lib/distortionEffect';
import {
  processCompressorChannels,
  type CompressorSettings,
} from '@/lib/compressorEffect';
import {
  DEFAULT_LEGACY_COMPRESSOR_SETTINGS,
  type LegacyCompressorSettings,
} from '@/lib/legacyCompressorEffect';
import {
  processLegacyLimiterChannels,
  type LegacyLimiterSettings,
} from '@/lib/legacyLimiterEffect';
import {
  DEFAULT_NOISE_GATE_SETTINGS,
  type NoiseGateSettings,
} from '@/lib/noiseGateEffect';
import {
  processLimiterChannels,
  type LimiterSettings,
} from '@/lib/limiterEffect';
import {
  isAmplifyAllowed,
  measureAmplifyPeak,
  processAmplifyChannels,
  type AmplifySettings,
} from '@/lib/amplifyEffect';
import {
  createNormalizePlan,
  processNormalizeChannels,
  type NormalizeSettings,
} from '@/lib/normalizeEffect';
import {
  processChangeTempoChannels,
  type ChangeTempoSettings,
} from '@/lib/changeTempoEffect';
import {
  processChangeSpeedChannels,
  type ChangeSpeedSettings,
} from '@/lib/changeSpeedEffect';
import {
  processChangePitchChannels,
  type ChangePitchSettings,
} from '@/lib/changePitchEffect';
import {
  processSlidingStretchChannels,
  slidingStretchSubrangeSettings,
  type SlidingStretchSettings,
} from '@/lib/slidingStretchEffect';
import {
  processPaulstretchChannels,
  type PaulstretchSettings,
} from '@/lib/paulstretchEffect';
import {
  DEFAULT_CROSSFADE_SETTINGS,
  processCrossfadeChannels,
  type CrossfadeSettings,
} from '@/lib/crossfadeTracksEffect';
import {
  loadGeneratorDuration,
  saveGeneratorDuration,
  type GeneratorKind,
} from '@/lib/generatorDuration';
import {
  boundClipStretchDelta,
  clipKeyId,
  deleteClipSelection,
  getClipStretchRatio,
  moveClipSelection,
  resetClipStretch,
  splitClipSelectionAtTime,
  stretchClipSelection,
  trimClipSelection,
  updateClipSelection,
  type ClipKey,
  type ClipSelectionMode,
} from '@/lib/clipEditing';
import { splitClipAtSilences as disjoinClipAtSilences } from '@/lib/clipSilence';
import { applySelectionEdit, type SelectionRippleMode } from '@/lib/selectionEdit';
import { planRangeJoin, splitRangeSelection } from '@/lib/selectionStructure';
import {
  planMultiClipJoin,
  planMultiClipSelection,
  removeMultiClipSelection,
} from '@/lib/multiClipEditing';
import {
  getClipGroupState,
  groupClips as applyClipGrouping,
  ungroupClips as applyClipUngrouping,
} from '@/lib/clipGrouping';
import {
  insertBlankSpaceOnTracks,
  pasteClipIntoTrack,
  type SelectionPasteMode,
} from '@/lib/selectionPaste';
import {
  loadDeletePreferences,
  needsDeleteOnboarding,
  resolveDeleteRippleMode,
  saveDeletePreferences,
  type CloseGapBehavior,
  type DeletePreferences,
  type SelectedDeleteBehavior,
} from '@/lib/deletePreferences';
import {
  loadPastePreferences,
  resolveDefaultPasteMode,
  shouldPasteIntoExistingClip,
  type PastePreferences,
} from '@/lib/pastePreferences';
import {
  findClipAtTime,
  mergeClipboardPcmIntoClip,
  replaceTrackWithMergedClip,
} from '@/lib/pasteIntoExistingClip';
import {
  collectClipSnapPoints,
  DEFAULT_SNAP_TOLERANCE_PIXELS,
  snapClipSelectionDelta,
  snapTimelineTime,
  type ClipSnapOperation,
  type SnapSettings,
} from '@/lib/snapping';
import {
  getLoopInteractionMode,
  getLoopPlaybackStart,
  normalizeLoopRegion,
  updateLoopRegionFromInteraction,
  type LoopInteractionMode,
  type LoopRegion,
} from '@/lib/loopPlayback';
import {
  createWorkspace,
  loadWorkspaceStore,
  MAX_WORKSPACE_NAME_LENGTH,
  removeWorkspace,
  resetWorkspace,
  saveWorkspaceStore,
  truncateWorkspaceNameInput,
  updateWorkspaceLayout,
  type WorkspaceLayout,
  type WorkspaceStore,
} from '@/services/workspaceService';
import {
  isAsymmetricStereoHeightsEnabled,
  loadChannelHeightRatios,
  loadStereoHeightsPreferences,
  normalizeChannelHeightRatio,
  resetChannelHeightRatios,
  saveChannelHeightRatio,
  saveStereoHeightsPreferences,
} from '@/lib/stereoHeights';
import type { IProject, ITrack, IClip, IEffect, IAnalysisLabel, ISpectrogramSettings, ViewMode, EffectType, SnapMode, TrackSampleFormat } from '@/types/project';
import EffectPanel from './sections/EffectPanel';
import PlaybackTimingControls from './sections/PlaybackTimingControls';
import ToneGeneratorDialog from './sections/ToneGeneratorDialog';
import ChirpGeneratorDialog from './sections/ChirpGeneratorDialog';
import DtmfGeneratorDialog from './sections/DtmfGeneratorDialog';
import PluckGeneratorDialog from './sections/PluckGeneratorDialog';
import RhythmTrackDialog from './sections/RhythmTrackDialog';
import RissetDrumDialog from './sections/RissetDrumDialog';
import NoiseGeneratorDialog from './sections/NoiseGeneratorDialog';
import SilenceGeneratorDialog from './sections/SilenceGeneratorDialog';
import RepeatSelectionDialog from './sections/RepeatSelectionDialog';
import ResampleDialog from './sections/ResampleDialog';
import TrackRateDialog from './sections/TrackRateDialog';
import TimerRecordDialog from './sections/TimerRecordDialog';
import {
  createTimerRecordController,
  executeTimerRecordCompletion,
  type TimerRecordAdvancedOptions,
  type TimerRecordController,
  type TimerRecordPhase,
  type TimerRecordSchedule,
} from '@/lib/timerRecord';
import EchoEffectDialog from './sections/EchoEffectDialog';
import DelayEffectDialog from './sections/DelayEffectDialog';
import ClipFixDialog from './sections/ClipFixDialog';
import NotchFilterDialog from './sections/NotchFilterDialog';
import ShelfFilterDialog from './sections/ShelfFilterDialog';
import SpectralEditDialog from './sections/SpectralEditDialog';
import SpectralSelectionBar from './sections/SpectralSelectionBar';
import PlotSpectrumDialog from './sections/PlotSpectrumDialog';
import { ContrastAnalysisDialog } from './sections/ContrastAnalysisDialog';
import MeasureRmsDialog, { type MeasureRmsTrackResult } from './sections/MeasureRmsDialog';
import SampleDataExportDialog from './sections/SampleDataExportDialog';
import SampleDataImportDialog, { type SampleDataImportCompletion } from './sections/SampleDataImportDialog';
import FindClippingDialog from './sections/FindClippingDialog';
import LabelSoundsDialog from './sections/LabelSoundsDialog';
import BeatFinderDialog from './sections/BeatFinderDialog';
import RegularIntervalLabelsDialog from './sections/RegularIntervalLabelsDialog';
import LabelEditorDialog from './sections/LabelEditorDialog';
import ExportLabelsDialog, { type LabelExportRequest } from './sections/ExportLabelsDialog';
import { ClippingLabelTimeline } from './sections/ClippingLabelTimeline';
import {
  appendAnalysisLabels,
  deleteLabelTrack,
  duplicateLabelTrack,
  getLabelTrackColor,
  getProjectLabelTracks,
  importLabelsAsNewTrack,
  moveLabelTrack,
  parseLabelsForImport,
  renameLabelTrack,
  replaceAnalysisLabels,
  resolveAnalysisLabelTrackId,
  serializeLabelsForExport,
  setLabelTrackColor,
} from '@/lib/labelTracks';
import AdjustableFadeDialog from './sections/AdjustableFadeDialog';
import BassTrebleDialog from './sections/BassTrebleDialog';
import ReverbDialog from './sections/ReverbDialog';
import DistortionDialog from './sections/DistortionDialog';
import ClickRemovalDialog from './sections/ClickRemovalDialog';
import NoiseReductionDialog from './sections/NoiseReductionDialog';
import TruncateSilenceDialog from './sections/TruncateSilenceDialog';
import CompressorDialog from './sections/CompressorDialog';
import LimiterDialog, { type LimiterPreview } from './sections/LimiterDialog';
import LegacyLimiterDialog from './sections/LegacyLimiterDialog';
import { AmplifyDialog } from './sections/AmplifyDialog';
import { NormalizeDialog } from './sections/NormalizeDialog';
import { LoudnessDialog } from './sections/LoudnessDialog';
import { FilterCurveEqDialog } from './sections/FilterCurveEqDialog';
import { GraphicEqDialog } from './sections/GraphicEqDialog';
import { ChangeTempoDialog } from './sections/ChangeTempoDialog';
import { ChangeSpeedDialog } from './sections/ChangeSpeedDialog';
import { ChangePitchDialog } from './sections/ChangePitchDialog';
import { ClipPitchAndSpeedDialog } from './sections/ClipPitchAndSpeedDialog';
import { ClipPropertiesDialog } from './sections/ClipPropertiesDialog';
import { TrackSpectrogramSettingsDialog } from './sections/TrackSpectrogramSettingsDialog';
import {
  applyClipPitchAndSpeed,
  getClipOptimizeForVoice,
  getClipPitchCents,
  hasClipPitchOrSpeed,
  renderClipPitchAndSpeedChannels,
  replaceClipWithRenderedPitchAndSpeed,
  type ClipPitchAndSpeedSettings,
} from '@/lib/clipPitchSpeed';
import { SlidingStretchDialog } from './sections/SlidingStretchDialog';
import { PaulstretchDialog } from './sections/PaulstretchDialog';
import WahWahEffectDialog from './sections/WahWahEffectDialog';
import PhaserEffectDialog from './sections/PhaserEffectDialog';
import ClassicFilterEffectDialog from './sections/ClassicFilterEffectDialog';
import PassFilterDialog from './sections/PassFilterDialog';
import TremoloEffectDialog from './sections/TremoloEffectDialog';
import VocoderDialog from './sections/VocoderDialog';
import AutoDuckEffectDialog from './sections/AutoDuckEffectDialog';
import CrossfadeTracksDialog from './sections/CrossfadeTracksDialog';
import { updateProjectTempo, updateProjectTimeSignature } from '@/lib/musicalTiming';
import { isClipStretchToMatchTempo, toggleClipStretchToMatchTempo } from '@/lib/clipTempo';
import {
  getSpectrogramColorValue,
  getSpectrogramHighBoostDb,
  getSpectrogramRgb,
  getTrackSpectrogramSettings,
  isSpectralSelectionEnabled,
  updateTrackSpectrogramSettings,
} from '@/lib/spectrogramSettings';
import { getSpectrogramFftLength } from '@/lib/spectrogramAlgorithm';
import { getSpectrogramFrameColorValues } from '@/lib/spectrogramDisplay';
import {
  CLIP_COLORS,
  getClipColor,
  getClipColorIndex,
  getTrackColorIndex,
  setClipColor,
} from '@/lib/clipColor';
import {
  getTrackHalfWave,
  getTrackViewMode,
  getTrackVisualizationMode,
  type TrackVisualizationMode,
} from '@/lib/trackVisualization';
import { renameClipTitle } from '@/lib/clipTitle';
import { Empty, EmptyContent, EmptyHeader, EmptyTitle, EmptyDescription, EmptyMedia } from '@/components/ui/empty';
import {
  decayDbfs,
  dbfsToMeterPercent,
  formatDbfs,
  silentStereoLevels,
  type StereoLevels,
} from '@/lib/levelMeter';
import { getMeterDbRange } from '@/lib/meterPreferences';
import {
  loadRecordingMonitoringPreferences,
  saveRecordingMonitoringPreferences,
  type RecordingMonitoringPreferences,
} from '@/lib/recordingMonitoringPreferences';
import {
  buildDbLinearRulerValues,
  buildDbRulerValues,
  DB_WAVE_RULER_WIDTH,
  dbValueToLinearWaveY,
  dbValueToWaveY,
} from '@/lib/dbWaveform';
import { buildLinearRulerTicks, type LinearRulerTick } from '@/lib/linearRuler';

function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

interface ClipSelectionEditTarget {
  trackId: string;
  selection: { start: number; end: number };
}

interface MultiClipSelectionEditTarget {
  keys: ClipKey[];
}

type DeleteEditTarget = ClipSelectionEditTarget | MultiClipSelectionEditTarget;
type MultiClipRippleMode = 'leave-gap' | 'per-track' | 'all-tracks';

type ClipContextEditCommand =
  | 'cut'
  | 'copy'
  | 'duplicate'
  | 'delete'
  | 'split'
  | { operation: 'cut' | 'delete'; mode: SelectionRippleMode };

type MultiClipContextEditCommand =
  | 'cut'
  | 'copy'
  | 'delete'
  | 'join'
  | 'group'
  | 'ungroup'
  | { operation: 'cut' | 'delete'; mode: MultiClipRippleMode };

function AudioEditorPageContent() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();

  const [project, setProject] = useState<IProject | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [playbackState, setPlaybackState] = useState<PlaybackState>('stopped');
  const [recordingState, setRecordingState] = useState<RecordingState>('idle');
  const [timerRecordDialogOpen, setTimerRecordDialogOpen] = useState(false);
  const [timerRecordSession, setTimerRecordSession] = useState<
    (TimerRecordSchedule & { phase: TimerRecordPhase; options: TimerRecordAdvancedOptions }) | null
  >(null);
  const [cursorPosition, setCursorPosition] = useState(0);
  const [selection, setSelection] = useState<{ start: number; end: number } | null>(null);
  const [spectralSelection, setSpectralSelection] = useState<FrequencySelection | null>(null);
  const [loopRegion, setLoopRegion] = useState<LoopRegion | null>(null);
  const [loopEnabled, setLoopEnabled] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('waveform');
  const [halfWave, setHalfWave] = useState(false);
  const [waveformDbRange] = useState(getMeterDbRange);
  const [horizontalZoom, setHorizontalZoom] = useState(50);
  const [verticalZoom, setVerticalZoom] = useState(1);
  const [snapEnabled, setSnapEnabled] = useState(false);
  const [snapMode, setSnapMode] = useState<SnapMode>('clips');
  const [scrollX, setScrollX] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isMixingAndRendering, setIsMixingAndRendering] = useState(false);
  const [resampleDialogOpen, setResampleDialogOpen] = useState(false);
  const [isResampling, setIsResampling] = useState(false);
  const [isMutingTracks, setIsMutingTracks] = useState(false);
  const [isPanningTracks, setIsPanningTracks] = useState(false);
  const [isRemovingTracks, setIsRemovingTracks] = useState(false);
  const [isSortingTracks, setIsSortingTracks] = useState(false);
  const [isMovingTrack, setIsMovingTrack] = useState(false);
  const [isDuplicatingTrack, setIsDuplicatingTrack] = useState(false);
  const [isTrackChannelOperation, setIsTrackChannelOperation] = useState(false);
  const [trackChannelCounts, setTrackChannelCounts] = useState<Record<string, 0 | 1 | 2>>({});
  const [trackSampleRates, setTrackSampleRates] = useState<Record<string, number | 'mixed'>>({});
  const [trackRateTargets, setTrackRateTargets] = useState<{
    trackIds: string[];
    initialRate: number;
  } | null>(null);
  const [trackResampleTargets, setTrackResampleTargets] = useState<string[] | null>(null);
  const [makeStereoConfirmation, setMakeStereoConfirmation] = useState<{
    leftTrackId: string;
    rightTrackId: string;
  } | null>(null);
  const [trackContextMenuId, setTrackContextMenuId] = useState<string | null>(null);
  const [isAligningTracks, setIsAligningTracks] = useState(false);
  const [moveSelectionWithTracks, setMoveSelectionWithTracks] = useState(
    () => projectService.getPreferences?.()?.moveSelectionWithTracks ?? false,
  );
  const [syncLockTracks, setSyncLockTracks] = useState(
    () => projectService.getPreferences?.()?.syncLockTracks ?? false,
  );
  const [exportFormat, setExportFormat] = useState('wav');
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [effectsPanelTrackId, setEffectsPanelTrackId] = useState<string | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [micPermissionState, setMicPermissionState] = useState<'granted' | 'denied' | 'unknown'>('unknown');
  const [recordingMonitoringPreferences, setRecordingMonitoringPreferences] = useState<RecordingMonitoringPreferences>(
    () => loadRecordingMonitoringPreferences(),
  );
  const [microphoneInputActive, setMicrophoneInputActive] = useState(false);
  const [microphoneSyncNonce, setMicrophoneSyncNonce] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [selectedClips, setSelectedClips] = useState<ClipKey[]>([]);
  const [clipPropertiesKey, setClipPropertiesKey] = useState<ClipKey | null>(null);
  const [spectrogramSettingsTrackId, setSpectrogramSettingsTrackId] = useState<string | null>(null);
  const [pitchAndSpeedClipKey, setPitchAndSpeedClipKey] = useState<ClipKey | null>(null);
  const [renamingClipKey, setRenamingClipKey] = useState<string | null>(null);
  const [renderingPitchAndSpeedClipId, setRenderingPitchAndSpeedClipId] = useState<string | null>(null);
  const [splittingSilenceClipId, setSplittingSilenceClipId] = useState<string | null>(null);
  const [selectionEditOperation, setSelectionEditOperation] = useState<string | null>(null);
  const [selectionUtilityOperation, setSelectionUtilityOperation] = useState<string | null>(null);
  const [selectionContextMenu, setSelectionContextMenu] = useState<{ x: number; y: number; trackId: string } | null>(null);
  const [hasAudioClipboard, setHasAudioClipboard] = useState(false);
  const [deletePreferences, setDeletePreferences] = useState<DeletePreferences>(() => loadDeletePreferences());
  const [pastePreferences] = useState<PastePreferences>(() => loadPastePreferences());
  const [deleteOnboarding, setDeleteOnboarding] = useState<{
    operation: 'cut' | 'delete';
    deleteBehavior: SelectedDeleteBehavior;
    closeGapBehavior: CloseGapBehavior;
    target?: DeleteEditTarget;
  } | null>(null);
  const [deleteFollowupOpen, setDeleteFollowupOpen] = useState(false);
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const clipSelectionAnchorRef = useRef<ClipKey | null>(null);
  const [workspaceStore, setWorkspaceStore] = useState(loadWorkspaceStore);
  const activeWorkspace = workspaceStore.presets.find((preset) => preset.id === workspaceStore.activeId)
    ?? workspaceStore.presets[0];
  const [showTrackPanel, setShowTrackPanel] = useState(activeWorkspace.layout.showTrackPanel);
  const [showMixer, setShowMixer] = useState(activeWorkspace.layout.showMixer);
  const [showClipping, setShowClipping] = useState(activeWorkspace.layout.showClipping);
  const [showRMS, setShowRMS] = useState(activeWorkspace.layout.showRMS);
  const [showVerticalRulers, setShowVerticalRulers] = useState(activeWorkspace.layout.showVerticalRulers);
  const [workspaceDialogOpen, setWorkspaceDialogOpen] = useState(false);
  const [workspaceManagerOpen, setWorkspaceManagerOpen] = useState(false);
  const [workspaceManagerSelectionId, setWorkspaceManagerSelectionId] = useState(workspaceStore.activeId);
  const managedWorkspace = workspaceStore.presets.find((preset) => preset.id === workspaceManagerSelectionId)
    ?? activeWorkspace;
  const [workspaceName, setWorkspaceName] = useState('');
  const [stereoHeightsPreferences, setStereoHeightsPreferences] = useState(() => (
    loadStereoHeightsPreferences(undefined, workspaceStore.presets.map((preset) => preset.name))
  ));
  const asymmetricStereoHeightsEnabled = isAsymmetricStereoHeightsEnabled(
    stereoHeightsPreferences,
    activeWorkspace.name,
  );
  const [channelHeightRatios, setChannelHeightRatios] = useState<Record<string, number>>({});
  const [generatorDurations, setGeneratorDurations] = useState<Record<GeneratorKind, number>>(() => ({
    tone: loadGeneratorDuration('tone'),
    chirp: loadGeneratorDuration('chirp'),
    dtmf: loadGeneratorDuration('dtmf'),
    noise: loadGeneratorDuration('noise'),
    silence: loadGeneratorDuration('silence'),
    pluck: loadGeneratorDuration('pluck'),
  }));
  const [toneDialogOpen, setToneDialogOpen] = useState(false);
  const [isGeneratingTone, setIsGeneratingTone] = useState(false);
  const [chirpDialogOpen, setChirpDialogOpen] = useState(false);
  const [isGeneratingChirp, setIsGeneratingChirp] = useState(false);
  const [dtmfDialogOpen, setDtmfDialogOpen] = useState(false);
  const [isGeneratingDtmf, setIsGeneratingDtmf] = useState(false);
  const [pluckDialogOpen, setPluckDialogOpen] = useState(false);
  const [isGeneratingPluck, setIsGeneratingPluck] = useState(false);
  const [rhythmDialogOpen, setRhythmDialogOpen] = useState(false);
  const [isGeneratingRhythm, setIsGeneratingRhythm] = useState(false);
  const [rissetDialogOpen, setRissetDialogOpen] = useState(false);
  const [isGeneratingRisset, setIsGeneratingRisset] = useState(false);
  const [noiseDialogOpen, setNoiseDialogOpen] = useState(false);
  const [isGeneratingNoise, setIsGeneratingNoise] = useState(false);
  const [silenceDialogOpen, setSilenceDialogOpen] = useState(false);
  const [isGeneratingSilence, setIsGeneratingSilence] = useState(false);
  const [repeatDialogOpen, setRepeatDialogOpen] = useState(false);
  const [isRepeating, setIsRepeating] = useState(false);
  const [echoDialogOpen, setEchoDialogOpen] = useState(false);
  const [isApplyingEcho, setIsApplyingEcho] = useState(false);
  const [delayDialogOpen, setDelayDialogOpen] = useState(false);
  const [isApplyingDelay, setIsApplyingDelay] = useState(false);
  const [clipFixDialogOpen, setClipFixDialogOpen] = useState(false);
  const [isApplyingClipFix, setIsApplyingClipFix] = useState(false);
  const [notchFilterDialogOpen, setNotchFilterDialogOpen] = useState(false);
  const [isApplyingNotchFilter, setIsApplyingNotchFilter] = useState(false);
  const [shelfFilterDialogOpen, setShelfFilterDialogOpen] = useState(false);
  const [isApplyingShelfFilter, setIsApplyingShelfFilter] = useState(false);
  const [spectralEditKind, setSpectralEditKind] = useState<SpectralEditKind | null>(null);
  const [isApplyingSpectralEdit, setIsApplyingSpectralEdit] = useState(false);
  const [plotSpectrumDialogOpen, setPlotSpectrumDialogOpen] = useState(false);
  const [contrastDialogOpen, setContrastDialogOpen] = useState(false);
  const [measureRmsDialogOpen, setMeasureRmsDialogOpen] = useState(false);
  const [measureRmsResults, setMeasureRmsResults] = useState<MeasureRmsTrackResult[]>([]);
  const [measureRmsError, setMeasureRmsError] = useState<string | null>(null);
  const [isMeasuringRms, setIsMeasuringRms] = useState(false);
  const measureRmsOperationRef = useRef(0);
  const [sampleDataExportDialogOpen, setSampleDataExportDialogOpen] = useState(false);
  const [isExportingSampleData, setIsExportingSampleData] = useState(false);
  const sampleDataExportOperationRef = useRef(0);
  const [sampleDataImportDialogOpen, setSampleDataImportDialogOpen] = useState(false);
  const [isImportingSampleData, setIsImportingSampleData] = useState(false);
  const sampleDataImportOperationRef = useRef(0);
  const [findClippingDialogOpen, setFindClippingDialogOpen] = useState(false);
  const [isFindingClipping, setIsFindingClipping] = useState(false);
  const [labelSoundsDialogOpen, setLabelSoundsDialogOpen] = useState(false);
  const [isLabelingSounds, setIsLabelingSounds] = useState(false);
  const [beatFinderDialogOpen, setBeatFinderDialogOpen] = useState(false);
  const [isFindingBeats, setIsFindingBeats] = useState(false);
  const [regularIntervalLabelsDialogOpen, setRegularIntervalLabelsDialogOpen] = useState(false);
  const [isCreatingRegularIntervalLabels, setIsCreatingRegularIntervalLabels] = useState(false);
  const [labelEditorDialogOpen, setLabelEditorDialogOpen] = useState(false);
  const [isApplyingLabels, setIsApplyingLabels] = useState(false);
  const [exportLabelsTrackId, setExportLabelsTrackId] = useState<string | null>(null);
  const [exportLabelsDialogOpen, setExportLabelsDialogOpen] = useState(false);
  const [adjustableFadeDialogOpen, setAdjustableFadeDialogOpen] = useState(false);
  const [isApplyingAdjustableFade, setIsApplyingAdjustableFade] = useState(false);
  const [isApplyingInvert, setIsApplyingInvert] = useState(false);
  const [isApplyingRemoveDcOffset, setIsApplyingRemoveDcOffset] = useState(false);
  const [isApplyingReverse, setIsApplyingReverse] = useState(false);
  const [wahWahDialogOpen, setWahWahDialogOpen] = useState(false);
  const [isApplyingWahWah, setIsApplyingWahWah] = useState(false);
  const [phaserDialogOpen, setPhaserDialogOpen] = useState(false);
  const [isApplyingPhaser, setIsApplyingPhaser] = useState(false);
  const [classicFilterDialogOpen, setClassicFilterDialogOpen] = useState(false);
  const [isApplyingClassicFilter, setIsApplyingClassicFilter] = useState(false);
  const [passFilterKind, setPassFilterKind] = useState<PassFilterKind | null>(null);
  const [isApplyingPassFilter, setIsApplyingPassFilter] = useState(false);
  const [tremoloDialogOpen, setTremoloDialogOpen] = useState(false);
  const [isApplyingTremolo, setIsApplyingTremolo] = useState(false);
  const [vocoderDialogOpen, setVocoderDialogOpen] = useState(false);
  const [isApplyingVocoder, setIsApplyingVocoder] = useState(false);
  const [autoDuckDialogOpen, setAutoDuckDialogOpen] = useState(false);
  const [isApplyingAutoDuck, setIsApplyingAutoDuck] = useState(false);
  const [bassTrebleDialogOpen, setBassTrebleDialogOpen] = useState(false);
  const [isApplyingBassTreble, setIsApplyingBassTreble] = useState(false);
  const [reverbDialogOpen, setReverbDialogOpen] = useState(false);
  const [isApplyingReverb, setIsApplyingReverb] = useState(false);
  const [isApplyingRepair, setIsApplyingRepair] = useState(false);
  const [clickRemovalDialogOpen, setClickRemovalDialogOpen] = useState(false);
  const [isApplyingClickRemoval, setIsApplyingClickRemoval] = useState(false);
  const [noiseReductionDialogOpen, setNoiseReductionDialogOpen] = useState(false);
  const [isApplyingNoiseReduction, setIsApplyingNoiseReduction] = useState(false);
  const [noiseReductionProfile, setNoiseReductionProfile] = useState<NoiseReductionProfile | null>(null);
  const [truncateSilenceDialogOpen, setTruncateSilenceDialogOpen] = useState(false);
  const [isApplyingTruncateSilence, setIsApplyingTruncateSilence] = useState(false);
  const [distortionDialogOpen, setDistortionDialogOpen] = useState(false);
  const [isApplyingDistortion, setIsApplyingDistortion] = useState(false);
  const [compressorDialogOpen, setCompressorDialogOpen] = useState(false);
  const [isApplyingCompressor, setIsApplyingCompressor] = useState(false);
  const [limiterDialogOpen, setLimiterDialogOpen] = useState(false);
  const [isApplyingLimiter, setIsApplyingLimiter] = useState(false);
  const [legacyLimiterDialogOpen, setLegacyLimiterDialogOpen] = useState(false);
  const [isApplyingLegacyLimiter, setIsApplyingLegacyLimiter] = useState(false);
  const [amplifyDialogOpen, setAmplifyDialogOpen] = useState(false);
  const [isApplyingAmplify, setIsApplyingAmplify] = useState(false);
  const [normalizeDialogOpen, setNormalizeDialogOpen] = useState(false);
  const [isApplyingNormalize, setIsApplyingNormalize] = useState(false);
  const [loudnessDialogOpen, setLoudnessDialogOpen] = useState(false);
  const [isApplyingLoudness, setIsApplyingLoudness] = useState(false);
  const [filterCurveEqDialogOpen, setFilterCurveEqDialogOpen] = useState(false);
  const [isApplyingFilterCurveEq, setIsApplyingFilterCurveEq] = useState(false);
  const [graphicEqDialogOpen, setGraphicEqDialogOpen] = useState(false);
  const [isApplyingGraphicEq, setIsApplyingGraphicEq] = useState(false);
  const [changeTempoDialogOpen, setChangeTempoDialogOpen] = useState(false);
  const [isApplyingChangeTempo, setIsApplyingChangeTempo] = useState(false);
  const [changeSpeedDialogOpen, setChangeSpeedDialogOpen] = useState(false);
  const [isApplyingChangeSpeed, setIsApplyingChangeSpeed] = useState(false);
  const [changePitchDialogOpen, setChangePitchDialogOpen] = useState(false);
  const [isApplyingChangePitch, setIsApplyingChangePitch] = useState(false);
  const [slidingStretchDialogOpen, setSlidingStretchDialogOpen] = useState(false);
  const [isApplyingSlidingStretch, setIsApplyingSlidingStretch] = useState(false);
  const [paulstretchDialogOpen, setPaulstretchDialogOpen] = useState(false);
  const [isApplyingPaulstretch, setIsApplyingPaulstretch] = useState(false);
  const [crossfadeDialogOpen, setCrossfadeDialogOpen] = useState(false);
  const [isApplyingCrossfade, setIsApplyingCrossfade] = useState(false);
  const [isApplyingCrossfadeClips, setIsApplyingCrossfadeClips] = useState(false);
  const [isApplyingStudioFadeOut, setIsApplyingStudioFadeOut] = useState(false);
  const quantizedGeneratorSelection = project
    ? quantizeSelectionToSamples(selection, project.sampleRate)
    : null;
  const generatorSelectionDuration = quantizedGeneratorSelection
    ? quantizedGeneratorSelection.end - quantizedGeneratorSelection.start
    : null;
  const autoDuckTrackOptions = project && quantizedGeneratorSelection
    ? project.tracks.filter((track) => track.clips.some((clip) => (
      quantizedGeneratorSelection.end > clip.startTime
      && quantizedGeneratorSelection.start < clip.startTime + clip.duration
    ))).map((track) => ({ id: track.id, name: track.name }))
    : [];
  const mixAndRenderTrackIds = project
    ? resolveMixAndRenderTrackIds(
      project.tracks.map((track) => track.id),
      selectedTrackId,
      selectedClips.map((clip) => clip.trackId),
    )
    : [];

  const timelineRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isPlayingRef = useRef(false);
  const recordingSampleRateRef = useRef(44100);
  const recordingStateRef = useRef<RecordingState>('idle');
  const recordingPageActiveRef = useRef(true);
  const projectLoadGenerationRef = useRef(0);
  const recordingMonitoringPreferencesRef = useRef(recordingMonitoringPreferences);
  const microphoneSyncGenerationRef = useRef(0);
  const microphoneErrorNotificationRef = useRef(false);
  recordingMonitoringPreferencesRef.current = recordingMonitoringPreferences;
  const startRecordingRef = useRef<() => Promise<boolean>>(async () => false);
  const startRecordingPromiseRef = useRef<Promise<boolean> | null>(null);
  const recordingStartGenerationRef = useRef(0);
  const stopRecordingRef = useRef<() => Promise<IProject | null>>(async () => null);
  const stopRecordingPromiseRef = useRef<Promise<IProject | null> | null>(null);
  const manualRecordStopPromiseRef = useRef<Promise<void> | null>(null);
  const timerRecordControllerRef = useRef<TimerRecordController | null>(null);
  recordingStateRef.current = recordingState;
  const workspaceHydratedRef = useRef(false);
  const workspaceStorageWarningShownRef = useRef(false);
  const channelHeightStorageWarningShownRef = useRef(false);
  useEffect(() => {
    if (!projectId) {
      setChannelHeightRatios({});
      return;
    }
    setChannelHeightRatios(loadChannelHeightRatios(projectId));
  }, [projectId]);
  useEffect(() => {
    if (!projectId || asymmetricStereoHeightsEnabled) return;
    resetChannelHeightRatios(projectId);
    setChannelHeightRatios((current) => Object.keys(current).length > 0 ? {} : current);
  }, [asymmetricStereoHeightsEnabled, projectId]);
  useEffect(() => {
    if (selectedClips.length === 0) {
      clipSelectionAnchorRef.current = null;
    } else if (clipSelectionAnchorRef.current === null) {
      clipSelectionAnchorRef.current = selectedClips[0];
    }
  }, [selectedClips]);
  const workspaceLayout = useMemo<WorkspaceLayout>(() => ({
    showTrackPanel,
    showMixer,
    showClipping,
    showRMS,
    showVerticalRulers,
    viewMode,
    halfWave,
    horizontalZoom,
    verticalZoom,
  }), [showTrackPanel, showMixer, showClipping, showRMS, showVerticalRulers, viewMode, halfWave, horizontalZoom, verticalZoom]);

  // Workspace customizations are local and automatically restored on reopen.
  useEffect(() => {
    if (!workspaceHydratedRef.current) {
      workspaceHydratedRef.current = true;
      return;
    }
    setWorkspaceStore((current) => {
      const updated = updateWorkspaceLayout(current, workspaceLayout);
      persistWorkspaceStore(updated);
      return updated;
    });
  }, [workspaceLayout]);

  // Leaving the editor must cancel timers and close either an active recorder
  // or a pending startup. Discard the returned channels: persisting a clip or
  // showing completion UI after unmount would mutate a project the user left.
  useEffect(() => {
    // StrictMode replays mount cleanup/setup; every real setup reopens the gate.
    recordingPageActiveRef.current = true;
    return () => {
      recordingPageActiveRef.current = false;
      const shouldStopRecording = startRecordingPromiseRef.current !== null
        || recordingStateRef.current === 'recording';
      timerRecordControllerRef.current?.cancel();
      timerRecordControllerRef.current = null;
      recordingStartGenerationRef.current += 1;
      startRecordingPromiseRef.current = null;
      recordingStateRef.current = 'idle';
      if (shouldStopRecording) {
        void (async () => { await audioEngine.stopRecording(); })().catch((error) => {
          logger.warn('离开编辑器时停止录音失败:', String(error));
        });
      }
    };
  }, []);

  // Load project. Async continuations from an old keyed instance must not seek
  // the shared engine, restore history, navigate, or change notifications after
  // the user has already opened another project.
  useEffect(() => {
    if (!projectId) return;
    const generation = ++projectLoadGenerationRef.current;
    void loadProject(projectId, generation);
    void checkMicPermission();
    return () => {
      if (projectLoadGenerationRef.current === generation) {
        projectLoadGenerationRef.current += 1;
      }
    };
  }, [projectId]);

  // Audacity 4 starts microphone metering/monitoring only while stopped. The
  // recording path takes over the input stream; playback suspends monitoring.
  useEffect(() => {
    const generation = ++microphoneSyncGenerationRef.current;
    const preferences = recordingMonitoringPreferencesRef.current;
    const shouldMonitor = playbackState === 'stopped'
      && recordingState === 'idle'
      && (preferences.showMicMetering || preferences.inputMonitoring);
    audioEngine.setMonitoringEnabled?.(preferences.inputMonitoring);

    if (!shouldMonitor) {
      audioEngine.stopMicrophoneMonitoring?.();
      setMicrophoneInputActive(false);
      microphoneErrorNotificationRef.current = false;
      return;
    }

    let current = true;
    void (async () => {
      try {
        await audioEngine.startMicrophoneMonitoring?.({ audible: preferences.inputMonitoring });
        if (!current || generation !== microphoneSyncGenerationRef.current) return;
        const active = audioEngine.isMicrophoneMonitoringActive?.() ?? false;
        setMicrophoneInputActive(active);
        if (active) setMicPermissionState('granted');
      } catch (error) {
        if (!current || generation !== microphoneSyncGenerationRef.current) return;
        setMicrophoneInputActive(false);
        setMicPermissionState('denied');
        logger.warn('麦克风监控未启动:', String(error));
        if (microphoneErrorNotificationRef.current) {
          toast.error(preferences.inputMonitoring
            ? '无法启动输入监听，请检查麦克风权限与设备'
            : '无法启动麦克风电平监控，请检查麦克风权限与设备');
        }
      } finally {
        if (generation === microphoneSyncGenerationRef.current) {
          microphoneErrorNotificationRef.current = false;
        }
      }
    })();
    return () => { current = false; };
  }, [playbackState, recordingState, recordingMonitoringPreferences, projectId, microphoneSyncNonce]);

  useEffect(() => () => {
    microphoneSyncGenerationRef.current += 1;
    audioEngine.stopMicrophoneMonitoring?.();
  }, []);

  useEffect(() => {
    let active = true;
    setSelectionContextMenu(null);
    setHasAudioClipboard(false);
    void (async () => {
      try {
        const entry = await audioDb.clipboard.get('current');
        if (active) setHasAudioClipboard(Boolean(entry));
      } catch {
        if (active) setHasAudioClipboard(false);
      }
    })();
    return () => { active = false; };
  }, [projectId]);

  // Register callbacks
  useEffect(() => {
    audioEngine.setCursorChangeCallback((pos) => {
      setCursorPosition(pos);
      // Auto scroll when playing
      if (timelineRef.current && isPlayingRef.current) {
        const container = timelineRef.current;
        const pxPerSec = horizontalZoom;
        const cursorPx = pos * pxPerSec;
        const scrollRight = container.scrollLeft + container.clientWidth - 100;
        if (cursorPx > scrollRight) {
          container.scrollLeft = cursorPx - container.clientWidth + 100;
          setScrollX(container.scrollLeft);
        }
      }
    });

    audioEngine.setStateChangeCallback((state) => {
      setPlaybackState(state);
      isPlayingRef.current = state === 'playing';
    });

    return () => {
      audioEngine.setCursorChangeCallback(() => {});
      audioEngine.setStateChangeCallback(() => {});
    };
  }, [horizontalZoom]);

  // Audacity closes the project's active AudioIO stream before switching
  // projects. Clear this instance's callbacks first (the effect above), then
  // stop the shared engine so no audio or animation frame survives unmount.
  useEffect(() => () => {
    audioEngine.stopPlayback?.();
  }, []);

  useEffect(() => {
    const handleKeyboard = (event: KeyboardEvent) => {
      const target = event.target;
      const readOnlyInput = target instanceof HTMLInputElement && target.readOnly;
      if (target instanceof Element && target.matches('input, textarea, [contenteditable="true"]') && !readOnlyInput) return;
      const key = event.key.toLowerCase();
      const modified = event.ctrlKey || event.metaKey;
      const contrastShortcut = event.shiftKey && key === 't' && (modified || event.altKey);
      if (modified && event.shiftKey && key === 'm') {
        event.preventDefault();
        void mixAndRenderSelectedTracks(true);
      } else if (contrastShortcut && quantizedGeneratorSelection
        && playbackState !== 'playing' && recordingState !== 'recording') {
        event.preventDefault();
        setContrastDialogOpen(true);
      } else if (modified && key === 'u') {
        event.preventDefault();
        void setTracksMute(!event.shiftKey, event.altKey);
      } else if (modified && key === 'i') {
        event.preventDefault();
        void splitClipsAtCursor();
      } else if (modified && key === 'c' && selection) {
        event.preventDefault();
        void handleCopy();
      } else if (modified && key === 'x' && selection) {
        event.preventDefault();
        void handleCut();
      } else if (modified && key === 'v') {
        event.preventDefault();
        void handlePaste();
      } else if (modified && key === 's') {
        event.preventDefault();
        void saveProject();
      } else if (modified && key === 'z') {
        event.preventDefault();
        if (event.shiftKey) void handleRedo();
        else void handleUndo();
      } else if (modified && key === 'y') {
        event.preventDefault();
        void handleRedo();
      } else if (modified && key === '1') {
        event.preventDefault();
        changeHorizontalZoom('in');
      } else if (modified && key === '2') {
        event.preventDefault();
        resetHorizontalZoom();
      } else if (modified && key === '3') {
        event.preventDefault();
        changeHorizontalZoom('out');
      } else if (modified && key === 'e' && selection) {
        event.preventDefault();
        zoomToSelection();
      } else if (modified && key === 'f') {
        event.preventDefault();
        fitProjectToWidth();
      } else if (event.key === 'F2' && !modified && !event.altKey && !event.shiftKey
        && selectedClips.length === 1 && !renderingPitchAndSpeedClipId && !splittingSilenceClipId) {
        const selected = selectedClips[0] as ClipKey | undefined;
        const clipExists = selected && project?.tracks.some((track) => track.id === selected.trackId
          && track.clips.some((clip) => clip.id === selected.clipId));
        if (selected && clipExists) {
          event.preventDefault();
          setRenamingClipKey(clipKeyId(selected));
        }
      } else if ((event.key === 'Delete' || event.key === 'Backspace') && selection) {
        event.preventDefault();
        void handleDeleteSelection();
      } else if ((event.key === 'Delete' || event.key === 'Backspace') && selectedClips.length > 0) {
        event.preventDefault();
        void handleDeleteSelectedClips();
      }
    };
    window.addEventListener('keydown', handleKeyboard);
    return () => window.removeEventListener('keydown', handleKeyboard);
  }, [
    project,
    selectedClips,
    selectedTrackId,
    cursorPosition,
    selection,
    loopRegion,
    loopEnabled,
    snapEnabled,
    snapMode,
    horizontalZoom,
    verticalZoom,
    playbackState,
    recordingState,
    renderingPitchAndSpeedClipId,
    splittingSilenceClipId,
    selectionEditOperation,
    selectionUtilityOperation,
    isMixingAndRendering,
    isMutingTracks,
    scrollX,
    viewMode,
  ]);

  async function checkMicPermission() {
    try {
      const result = await (navigator.permissions as any)?.query({ name: 'microphone' });
      if (result) {
        setMicPermissionState(result.state);
        result.addEventListener('change', () => {
          setMicPermissionState(result.state);
        });
      }
    } catch {
      // Permission API not supported
    }
  }

  async function loadProject(id: string, generation: number) {
    const isCurrentLoad = () => projectLoadGenerationRef.current === generation;
    setIsLoading(true);
    try {
      const proj = await projectService.openProject(id);
      if (!isCurrentLoad()) return;
      if (proj) {
        setProject(proj);
        const workspace = workspaceStore.presets.find((preset) => preset.id === workspaceStore.activeId)
          ?? workspaceStore.presets[0];
        setViewMode(workspace.layout.viewMode);
        setHalfWave(workspace.layout.halfWave);
        setHorizontalZoom(normalizeHorizontalZoom(workspace.layout.horizontalZoom));
        setVerticalZoom(normalizeVerticalZoom(workspace.layout.verticalZoom));
        setSnapEnabled(proj.viewState.snapEnabled ?? false);
        setSnapMode(proj.viewState.snapMode ?? 'clips');
        setShowTrackPanel(workspace.layout.showTrackPanel);
        setShowMixer(workspace.layout.showMixer);
        setShowClipping(workspace.layout.showClipping);
        setShowRMS(workspace.layout.showRMS);
        setShowVerticalRulers(workspace.layout.showVerticalRulers);
        setScrollX(proj.viewState.scrollX);
        setSelection(proj.selection);
        setCursorPosition(proj.cursorPosition);
        audioEngine.seek(proj.cursorPosition);
        setSpectralSelection(isSpectralSelectionEnabled() ? normalizeFrequencySelection(
          proj.spectralSelection,
          proj.sampleRate,
          getTrackSpectrogramSettings(proj.tracks[0], proj.sampleRate),
        ) : null);
        const restoredLoop = normalizeLoopRegion(proj.loopRegion);
        setLoopRegion(restoredLoop);
        setLoopEnabled(restoredLoop ? (proj.loopEnabled ?? false) : false);
        setSelectedClips([]);
        setSelectedTrackId(proj.tracks[0]?.id ?? null);
        // 加载历史快照（IndexedDB 持久化的撤销/重做栈）
        const snapCount = await historyManager.loadForProject(id);
        if (!isCurrentLoad()) return;
        updateHistoryState();
        if (snapCount > 0) {
          logger.info(`已恢复 ${snapCount} 步历史记录`);
        }
      } else if (isCurrentLoad()) {
        toast.error('工程不存在');
        navigate('/');
      }
    } catch (e) {
      if (isCurrentLoad()) toast.error('加载工程失败');
    } finally {
      if (isCurrentLoad()) setIsLoading(false);
    }
  }

  async function saveProject() {
    if (!project) return;
    setIsSaving(true);
    try {
      const updated = {
        ...project,
        viewState: {
          horizontalZoom,
          verticalZoom,
          scrollX,
          viewMode,
          snapEnabled,
          snapMode,
        },
        cursorPosition,
        selection,
        spectralSelection,
        loopRegion,
        loopEnabled,
      };
      await projectService.saveProject(updated);
      setProject(updated);
      toast.success('工程已保存');
    } catch (e) {
      toast.error('保存失败');
    } finally {
      setIsSaving(false);
    }
  }

  // Playback controls
  async function handlePlayPause() {
    if (!project) return;

    if (playbackState === 'playing') {
      audioEngine.pause();
    } else if (playbackState === 'paused') {
      audioEngine.resume();
    } else {
      // Audacity 4 uses an independent loop region with the normal transport.
      const activeLoop = loopEnabled ? normalizeLoopRegion(loopRegion) : null;
      const isSoloActive = project.tracks.some((t) => t.solo);
      const duration = getProjectDuration();
      let playbackStart = cursorPosition;
      if (activeLoop) playbackStart = getLoopPlaybackStart(activeLoop, cursorPosition);
      else if (cursorPosition >= duration) playbackStart = 0;
      setCursorPosition(playbackStart);
      await audioEngine.play(project.tracks, playbackStart, isSoloActive, { loop: activeLoop });
    }
  }

  function toggleLoopEnabled() {
    if (loopRegion) {
      setLoopEnabled((enabled) => !enabled);
    } else if (selection && selection.end > selection.start) {
      setLoopRegion({ ...selection });
      setLoopEnabled(true);
    }
  }

  function setLoopFromSelection() {
    if (!selection || selection.end <= selection.start) return;
    setLoopRegion({ ...selection });
    setLoopEnabled(true);
  }

  function clearLoopRegion() {
    setLoopRegion(null);
    setLoopEnabled(false);
  }

  function changeLoopRegion(region: LoopRegion | null, enabled?: boolean) {
    setLoopRegion(region);
    if (enabled !== undefined) setLoopEnabled(region ? enabled : false);
  }

  function stopPlaybackAndSyncMonitoring() {
    audioEngine.stopPlayback();
    // A stopped→stopped transition has no playback callback. Explicitly
    // resynchronize so Stop and clip-processing cleanup cannot leave the mic
    // stream closed while the UI still claims that metering is active.
    setMicrophoneInputActive(false);
    setMicrophoneSyncNonce((current) => current + 1);
  }

  function handleStop() {
    stopPlaybackAndSyncMonitoring();
    setCursorPosition(0);
  }

  function handleSkipBack() {
    const newPos = Math.max(0, cursorPosition - 5);
    setCursorPosition(newPos);
    audioEngine.seek(newPos);
  }

  function handleSkipForward() {
    const duration = getProjectDuration();
    const newPos = Math.min(duration, cursorPosition + 5);
    setCursorPosition(newPos);
    audioEngine.seek(newPos);
  }

  // Recording
  function stopRecording(): Promise<IProject | null> {
    if (stopRecordingPromiseRef.current) return stopRecordingPromiseRef.current;
    const pendingStart = startRecordingPromiseRef.current;
    if (recordingStateRef.current !== 'recording' && !pendingStart) return Promise.resolve(null);
    if (pendingStart) {
      // Invalidate the UI continuation as well as the engine startup. The old
      // promise must not later restore recording state or block a clean restart.
      recordingStartGenerationRef.current += 1;
      startRecordingPromiseRef.current = null;
    }

    const stopOperation = stopRecordingInternal();
    const sharedStopOperation = stopOperation.finally(() => {
      if (stopRecordingPromiseRef.current === sharedStopOperation) {
        stopRecordingPromiseRef.current = null;
      }
    });
    stopRecordingPromiseRef.current = sharedStopOperation;
    return sharedStopOperation;
  }

  async function stopRecordingInternal(): Promise<IProject | null> {
    try {
      const data = await audioEngine.stopRecording();
      if (!recordingPageActiveRef.current) return null;
      if (!data || data.length === 0 || data[0].length === 0) {
        toast.warning('未采集到音频，请检查麦克风输入');
        return null;
      }
      if (!project) {
        toast.warning('工程已关闭，无法保存录音');
        return null;
      }

      const targetTrack = project.tracks.find((t) => t.armed) ?? project.tracks[0];
      if (!targetTrack) {
        toast.warning('没有可用于录音的轨道');
        return null;
      }

      // Web Audio 使用设备采样率；统一重采样到工程采样率，避免导出时长和播放速度偏移。
      const resampled = data.map((channel) =>
        resampleBuffer(channel, recordingSampleRateRef.current, project.sampleRate),
      );
      const before = project;
      const clip = await projectService.addRecordingToTrack(
        project.id,
        targetTrack.id,
        resampled,
        project.sampleRate,
        cursorPosition,
      );
      if (!clip) throw new Error('Recording clip could not be created');

      const updated = await projectService.getProject(project.id);
      if (!updated) throw new Error('Recorded project could not be reloaded');
      setProject(updated);
      pushHistoryCmd({
        id: generateId(),
        label: '录音',
        execute: () => updated,
        undo: () => before,
      });
      toast.success(`录音已添加到「${targetTrack.name}」`);
      return updated;
    } catch (error) {
      if (!recordingPageActiveRef.current) return null;
      logger.error('保存录音失败:', String(error));
      toast.error('录音保存失败');
      return null;
    } finally {
      recordingStateRef.current = 'idle';
      if (recordingPageActiveRef.current) setRecordingState('idle');
    }
  }

  function startRecording(): Promise<boolean> {
    if (startRecordingPromiseRef.current) return startRecordingPromiseRef.current;
    if (!recordingPageActiveRef.current || !project || recordingStateRef.current === 'recording') {
      return Promise.resolve(false);
    }

    const generation = ++recordingStartGenerationRef.current;
    const startOperation = startRecordingInternal(generation);
    const sharedStartOperation = startOperation.finally(() => {
      if (startRecordingPromiseRef.current === sharedStartOperation) {
        startRecordingPromiseRef.current = null;
      }
    });
    startRecordingPromiseRef.current = sharedStartOperation;
    return sharedStartOperation;
  }

  async function startRecordingInternal(generation: number): Promise<boolean> {
    try {
      audioEngine.setMonitoringEnabled?.(recordingMonitoringPreferencesRef.current.inputMonitoring);
      await audioEngine.ensureContext();
      if (generation !== recordingStartGenerationRef.current) return false;
      await audioEngine.startRecording();
      if (generation !== recordingStartGenerationRef.current) return false;
      recordingSampleRateRef.current = audioEngine.getSampleRate();
      recordingStateRef.current = 'recording';
      setRecordingState('recording');
      // Keep transient capture feedback away from the transport controls: a
      // top-centre toast covers the same Record button needed to stop capture.
      toast.info(`正在录音（${audioEngine.getRecordingMode()}）…`, {
        position: 'bottom-right',
        duration: 4000,
      });
      setMicPermissionState('granted');
      return true;
    } catch (e) {
      if (generation !== recordingStartGenerationRef.current) return false;
      recordingStateRef.current = 'idle';
      setRecordingState('idle');
      toast.error('无法访问麦克风，请检查权限设置');
      setMicPermissionState('denied');
      return false;
    }
  }

  startRecordingRef.current = startRecording;
  stopRecordingRef.current = stopRecording;

  async function finalizeTimerRecord(
    options: TimerRecordAdvancedOptions,
    recordedProject: IProject,
    wasStopped = false,
  ): Promise<boolean> {
    if (!options.automaticSave && !options.automaticExport) return false;
    let exportMuted = false;
    const effectiveOptions = wasStopped ? { ...options, postAction: 'nothing' as const } : options;
    const result = await executeTimerRecordCompletion(effectiveOptions, {
      saveProject: async () => {
        await projectService.saveProject(recordedProject);
        setProject({ ...recordedProject });
      },
      exportWav: async () => {
        const hasAudibleAudio = recordedProject.tracks.some((track) =>
          !track.muted && track.clips.some((clip) => clip.duration > 0),
        );
        if (!hasAudibleAudio) {
          exportMuted = true;
          return;
        }
        const duration = getProjectDuration(recordedProject);
        if (duration <= 0) throw new Error('没有可导出的音频内容');
        const blob = await audioEngine.exportWav(
          recordedProject.tracks,
          duration,
          recordedProject.sampleRate,
          16,
        );
        triggerBlobDownload(blob, options.exportFilename);
      },
    });

    const successes: string[] = [];
    const failures: string[] = [];
    if (result.saveSucceeded === true) successes.push('工程已自动保存');
    if (result.exportSucceeded === true && !exportMuted) successes.push(`WAV 已导出为 ${options.exportFilename}`);
    if (result.saveSucceeded === false) failures.push('自动保存失败');
    if (result.exportSucceeded === false) failures.push('自动导出失败');

    if (failures.length > 0) {
      const details = [...successes, ...failures].join('，');
      toast.error(`定时录音完成：${details}${options.postAction === 'close-project' ? '；已取消关闭工程' : ''}`);
      return false;
    }
    if (wasStopped && options.postAction === 'close-project') {
      toast.info('已手动停止定时录音；已取消关闭工程');
    }
    if (exportMuted) toast.warning('所有音频均静音，未生成导出文件');
    if (successes.length > 0) toast.success(`定时录音完成：${successes.join('，')}`);
    return result.shouldCloseProject;
  }

  async function handleRecord() {
    if (manualRecordStopPromiseRef.current) {
      await manualRecordStopPromiseRef.current;
      return;
    }

    if (startRecordingPromiseRef.current || recordingStateRef.current === 'recording') {
      const activeSession = timerRecordSession;
      timerRecordControllerRef.current?.cancel();
      timerRecordControllerRef.current = null;
      setTimerRecordSession(null);
      const manualStopOperation = (async () => {
        const recordedProject = await stopRecordingRef.current();
        if (activeSession?.phase === 'recording' && recordedProject) {
          await finalizeTimerRecord(activeSession.options, recordedProject, true);
        }
      })();
      manualRecordStopPromiseRef.current = manualStopOperation;
      try {
        await manualStopOperation;
      } finally {
        if (manualRecordStopPromiseRef.current === manualStopOperation) {
          manualRecordStopPromiseRef.current = null;
        }
      }
      return;
    }
    if (timerRecordSession) {
      toast.warning(timerRecordSession.phase === 'finalizing'
        ? '正在完成定时录音，请稍候'
        : '请先取消等待中的定时录音');
      return;
    }
    await startRecordingRef.current();
  }

  function scheduleTimerRecord(schedule: TimerRecordSchedule, options: TimerRecordAdvancedOptions) {
    if (startRecordingPromiseRef.current || recordingStateRef.current === 'recording' || timerRecordSession) {
      toast.warning('请先停止当前录音或取消已有定时录音');
      return;
    }
    setTimerRecordDialogOpen(false);
    let completedProject: IProject | null = null;
    const controller = createTimerRecordController({
      onStart: async () => {
        if (!await startRecordingRef.current()) throw new Error('无法启动录音');
      },
      onStop: async () => {
        completedProject = await stopRecordingRef.current();
        if (!completedProject) throw new Error('录音保存失败，未执行自动保存或导出');
      },
      onPhaseChange: (phase) => {
        setTimerRecordSession((current) => current ? { ...current, phase } : current);
      },
      onComplete: async () => {
        let shouldCloseProject = false;
        try {
          if (!completedProject) throw new Error('无法读取定时录音工程');
          shouldCloseProject = await finalizeTimerRecord(options, completedProject);
        } finally {
          timerRecordControllerRef.current = null;
          setTimerRecordSession(null);
        }
        if (shouldCloseProject) navigate('/');
      },
      onError: (error) => {
        timerRecordControllerRef.current = null;
        setTimerRecordSession(null);
        toast.error(`定时录音失败：${error instanceof Error ? error.message : String(error)}`);
      },
    });
    timerRecordControllerRef.current = controller;
    setTimerRecordSession({ ...schedule, phase: 'waiting', options });
    controller.start(schedule);
    toast.info(schedule.startAt <= Date.now()
      ? '定时录音即将开始…'
      : `将于 ${new Date(schedule.startAt).toLocaleString()} 开始录音`);
  }

  async function cancelTimerRecord() {
    if (timerRecordSession?.phase === 'finalizing') {
      toast.warning('正在保存或导出定时录音，请稍候');
      return;
    }
    timerRecordControllerRef.current?.cancel();
    timerRecordControllerRef.current = null;
    setTimerRecordSession(null);
    if (startRecordingPromiseRef.current || recordingStateRef.current === 'recording') {
      await stopRecordingRef.current();
    }
    toast.info('已取消定时录音');
  }

  // Track operations
  async function addTrack() {
    if (!project) return;
    const before = project;
    const projectId = project.id;
    const generation = projectLoadGenerationRef.current;
    const isCurrentAction = () => projectLoadGenerationRef.current === generation;
    try {
      const newTrack = await projectService.addTrack(projectId);
      if (!isCurrentAction()) return;
      if (newTrack) {
        const updated = await projectService.getProject(projectId);
        if (!isCurrentAction()) return;
        if (updated) {
          setProject(updated);
          pushHistoryCmd({
            id: generateId(),
            label: '添加轨道',
            execute: () => updated,
            undo: () => before,
          });
        }
      }
    } catch (error) {
      if (!isCurrentAction()) return;
      logger.error('Add track failed', error);
      toast.error(`添加轨道失败：${error instanceof Error ? error.message : '未知错误'}`);
    }
  }

  async function deleteTrack(trackId: string) {
    if (!project) return;
    const before = project;
    const projectId = project.id;
    const generation = projectLoadGenerationRef.current;
    const isCurrentAction = () => projectLoadGenerationRef.current === generation;
    try {
      await projectService.removeTrack(projectId, trackId);
      if (!isCurrentAction()) return;
      const updated = await projectService.getProject(projectId);
      if (!isCurrentAction()) return;
      if (updated) {
        const fallbackTrackId = updated.tracks[0]?.id ?? null;
        setProject(updated);
        setSelectedTrackId((current) => current && updated.tracks.some((track) => track.id === current)
          ? current
          : fallbackTrackId);
        setEffectsPanelTrackId((current) => current && updated.tracks.some((track) => track.id === current)
          ? current
          : fallbackTrackId);
        pushHistoryCmd({
          id: generateId(),
          label: '删除轨道',
          execute: () => updated,
          undo: () => before,
        });
      }
    } catch (error) {
      if (!isCurrentAction()) return;
      logger.error('Delete track failed', error);
      toast.error(`删除轨道失败：${error instanceof Error ? error.message : '未知错误'}`);
    }
  }

  async function mixAndRenderSelectedTracks(toNewTrack: boolean) {
    if (!project || isMixingAndRendering) return;
    if (playbackState === 'playing' || recordingState === 'recording') {
      toast.warning('请先停止播放或录音');
      return;
    }
    const targetTrackIds = resolveMixAndRenderTrackIds(
      project.tracks.map((track) => track.id),
      selectedTrackId,
      selectedClips.map((clip) => clip.trackId),
    );
    if (targetTrackIds.length === 0) {
      toast.warning('请先选择要混音的轨道');
      return;
    }

    const before = project;
    const projectId = project.id;
    const generation = projectLoadGenerationRef.current;
    const isCurrentAction = () => projectLoadGenerationRef.current === generation;
    setIsMixingAndRendering(true);
    try {
      const targets: MixAndRenderTrackAudio[] = [];
      for (const track of project.tracks) {
        if (!targetTrackIds.includes(track.id)) continue;
        const clips: MixAndRenderTrackAudio['clips'] = [];
        for (const clip of [...track.clips].sort((left, right) => left.startTime - right.startTime)) {
          const effective = await loadEffectiveClipChannels(clip, project.sampleRate);
          if (!isCurrentAction()) return;
          if (!effective) throw new Error(`无法读取片段“${clip.name ?? clip.id}”`);
          clips.push({
            clipId: clip.id,
            sampleData: effective.channels,
            sourceOffset: effective.sourceOffset,
          });
        }
        targets.push({ trackId: track.id, clips });
      }

      const result = await projectService.mixAndRenderOnTracks(projectId, targets, toNewTrack);
      if (!isCurrentAction()) return;
      const updated = await projectService.getProject(projectId);
      if (!isCurrentAction()) return;
      if (!updated) throw new Error('混音结果不可用');
      setProject(updated);
      if (!toNewTrack) {
        setSelectedTrackId(result.trackId);
        setSelectedClips([{ trackId: result.trackId, clipId: result.clipId }]);
      }
      pushHistoryCmd({
        id: generateId(),
        label: result.inputTrackCount === 1 ? 'Render' : 'Mix and Render',
        execute: () => updated,
        undo: () => before,
      });
      toast.success(toNewTrack
        ? `已混音渲染到新轨道「${result.trackName}」`
        : `已混音渲染为「${result.trackName}」`);
    } catch (error) {
      if (!isCurrentAction()) return;
      logger.error('Mix and Render failed', error);
      toast.error(error instanceof Error ? error.message : '混音渲染失败');
    } finally {
      setIsMixingAndRendering(false);
    }
  }

  async function resampleSelectedTracks(newRate: number) {
    if (!project || isResampling) return;
    if (playbackState === 'playing' || recordingState === 'recording') {
      toast.warning('请先停止播放或录音');
      return;
    }
    if (mixAndRenderTrackIds.length === 0) {
      toast.warning('请先选择要重采样的轨道');
      return;
    }

    const before = project;
    const projectId = project.id;
    const generation = projectLoadGenerationRef.current;
    const isCurrentAction = () => projectLoadGenerationRef.current === generation;
    setIsResampling(true);
    try {
      const result = await projectService.resampleTracksOnTracks(
        projectId,
        mixAndRenderTrackIds,
        newRate,
      );
      if (!isCurrentAction()) return;
      if (result.trackCount === 0) {
        setResampleDialogOpen(false);
        toast.success(`选中轨道已经是 ${newRate} Hz`);
        return;
      }
      const updated = await projectService.getProject(projectId);
      if (!isCurrentAction()) return;
      if (!updated) throw new Error('重采样结果不可用');
      setProject(updated);
      pushHistoryCmd({
        id: generateId(),
        label: 'Resample Track',
        execute: () => updated,
        undo: () => before,
      });
      setResampleDialogOpen(false);
      toast.success(result.clipCount === 0
        ? `已将 ${result.trackCount} 条空轨的速率设为 ${newRate} Hz`
        : `已将 ${result.trackCount} 条轨道的 ${result.clipCount} 个片段重采样为 ${newRate} Hz`);
      if (result.fallbackWarning) toast.warning(result.fallbackWarning);
    } catch (error) {
      if (!isCurrentAction()) return;
      logger.error('Resample failed', error);
      toast.error(error instanceof Error ? error.message : '重采样失败');
    } finally {
      setIsResampling(false);
    }
  }

  async function convertStereoTracksToMono() {
    if (!project) return;
    const before = project;
    const projectId = project.id;
    const generation = projectLoadGenerationRef.current;
    const isCurrentAction = () => projectLoadGenerationRef.current === generation;
    try {
      const targets: EchoTrackAudio[] = [];
      for (const track of project.tracks) {
        const clips = [];
        let hasStereo = false;
        for (const clip of track.clips) {
          const effective = await loadEffectiveClipChannels(clip, project.sampleRate);
          if (!isCurrentAction()) return;
          if (!effective) throw new Error(`无法读取片段“${clip.name ?? clip.id}”`);
          if (effective.channels.length === 2) hasStereo = true;
          clips.push({
            clipId: clip.id,
            sampleData: effective.channels,
            sourceOffset: effective.sourceOffset,
          });
        }
        if (hasStereo) targets.push({ trackId: track.id, clips });
      }
      if (!isCurrentAction()) return;
      if (targets.length === 0) {
        toast.warning('当前没有立体声轨道');
        return;
      }
      await projectService.stereoToMonoOnTracks(projectId, targets);
      if (!isCurrentAction()) return;
      const updated = await projectService.getProject(projectId);
      if (!isCurrentAction()) return;
      if (updated) {
        setProject(updated);
        pushHistoryCmd({
          id: generateId(),
          label: 'Stereo To Mono',
          execute: () => updated,
          undo: () => before,
        });
      }
    } catch (error) {
      if (!isCurrentAction()) return;
      logger.error('Stereo To Mono failed', error);
      toast.error(error instanceof Error ? error.message : '立体声转单声道失败');
    }
  }

  async function splitStereoTracksToMono() {
    if (!project) return;
    const before = project;
    const projectId = project.id;
    const generation = projectLoadGenerationRef.current;
    const isCurrentAction = () => projectLoadGenerationRef.current === generation;
    try {
      const targets: EchoTrackAudio[] = [];
      for (const track of project.tracks) {
        const clips = [];
        let hasStereo = false;
        for (const clip of track.clips) {
          const effective = await loadEffectiveClipChannels(clip, project.sampleRate);
          if (!isCurrentAction()) return;
          if (!effective) throw new Error(`无法读取片段“${clip.name ?? clip.id}”`);
          if (effective.channels.length === 2) hasStereo = true;
          clips.push({
            clipId: clip.id,
            sampleData: effective.channels,
            sourceOffset: effective.sourceOffset,
          });
        }
        if (hasStereo) targets.push({ trackId: track.id, clips });
      }
      if (!isCurrentAction()) return;
      if (targets.length === 0) {
        toast.warning('当前没有立体声轨道');
        return;
      }
      await projectService.splitStereoToMonoTracks(projectId, targets);
      if (!isCurrentAction()) return;
      const updated = await projectService.getProject(projectId);
      if (!isCurrentAction()) return;
      if (updated) {
        setProject(updated);
        pushHistoryCmd({
          id: generateId(),
          label: 'Split Stereo To Mono',
          execute: () => updated,
          undo: () => before,
        });
      }
    } catch (error) {
      if (!isCurrentAction()) return;
      logger.error('Split Stereo To Mono failed', error);
      toast.error(error instanceof Error ? error.message : '立体声拆分失败');
    }
  }

  function getTrackChannelCount(track: ITrack): 0 | 1 | 2 {
    const detected = trackChannelCounts[track.id];
    if (detected !== undefined) return detected;
    if (track.clips.length > 0) return track.channelCount ?? 0;
    return track.channelCount ?? 1;
  }

  function getTrackSampleRate(track: ITrack): number | 'mixed' {
    const detected = trackSampleRates[track.id];
    if (detected !== undefined) return detected;
    if (track.clips.length === 0) return track.sampleRate ?? project?.sampleRate ?? 44100;
    return track.sampleRate ?? 'mixed';
  }

  useEffect(() => {
    // Persisted track rates are authoritative after undo/redo; legacy tracks are re-inspected on demand.
    setTrackSampleRates((current) => {
      const next = { ...current };
      const trackIds = new Set(project?.tracks.map((track) => track.id) ?? []);
      for (const id of Object.keys(next)) {
        if (!trackIds.has(id)) delete next[id];
      }
      for (const track of project?.tracks ?? []) {
        if (track.sampleRate === undefined) delete next[track.id];
        else next[track.id] = track.sampleRate;
      }
      return next;
    });
  }, [project]);

  async function ensureTrackChannelCount(track: ITrack): Promise<void> {
    if (trackChannelCounts[track.id] !== undefined && trackSampleRates[track.id] !== undefined) return;
    const generation = projectLoadGenerationRef.current;
    const isCurrentAction = () => projectLoadGenerationRef.current === generation;
    if (track.clips.length === 0) {
      if (!isCurrentAction()) return;
      setTrackChannelCounts((current) => ({ ...current, [track.id]: track.channelCount ?? 1 }));
      setTrackSampleRates((current) => ({
        ...current,
        [track.id]: track.sampleRate ?? project?.sampleRate ?? 44100,
      }));
      return;
    }
    if (typeof projectService.loadAudioBufferMetadata !== 'function') return;
    try {
      const sourceIds = [...new Set(track.clips.map((clip) => clip.audioBufferId))];
      const metadata = await Promise.all(sourceIds.map((id) => projectService.loadAudioBufferMetadata(id)));
      if (!isCurrentAction()) return;
      if (metadata.some((record) => !record)) throw new Error('audio metadata unavailable');
      const count = metadata.every((record) => record!.channels === 1)
        ? 1
        : metadata.every((record) => record!.channels === 2) ? 2 : 0;
      const rates = [...new Set(metadata.map((record) => record!.sampleRate))];
      setTrackChannelCounts((current) => ({ ...current, [track.id]: count }));
      setTrackSampleRates((current) => ({
        ...current,
        [track.id]: rates.length === 1 ? rates[0]! : 'mixed',
      }));
    } catch (error) {
      if (!isCurrentAction()) return;
      // Keep the entry retryable instead of guessing channel or rate metadata.
      logger.warn('Unable to inspect track media metadata', error);
    }
  }

  function prepareTrackChannelOperation(): boolean {
    if (recordingStateRef.current === 'recording') {
      toast.warning('请先停止录音');
      return false;
    }
    stopPlaybackAndSyncMonitoring();
    return true;
  }

  function getTrackContextTargetIds(trackId: string): string[] {
    if (!project) return [];
    const clipTrackIds = new Set(selectedClips.map((clip) => clip.trackId));
    if (!clipTrackIds.has(trackId)) return [trackId];
    return project.tracks.filter((track) => clipTrackIds.has(track.id)).map((track) => track.id);
  }

  function openTrackRateDialog(trackId: string): void {
    if (!project || isTrackChannelOperation || isResampling) return;
    if (recordingStateRef.current === 'recording') {
      toast.warning('请先停止录音');
      return;
    }
    const track = project.tracks.find((candidate) => candidate.id === trackId);
    if (!track) return;
    const rate = getTrackSampleRate(track);
    setTrackRateTargets({
      trackIds: getTrackContextTargetIds(trackId),
      initialRate: typeof rate === 'number' ? rate : project.sampleRate,
    });
  }

  function openTrackResampleDialog(trackId: string): void {
    if (!project || isResampling || isTrackChannelOperation) return;
    setTrackResampleTargets(getTrackContextTargetIds(trackId));
  }

  async function changeTrackFormat(trackId: string, format: TrackSampleFormat): Promise<void> {
    if (!project || isTrackChannelOperation || isResampling) return;
    if (!prepareTrackChannelOperation()) return;
    const trackIds = getTrackContextTargetIds(trackId);
    const before = project;
    const projectId = project.id;
    const generation = projectLoadGenerationRef.current;
    const isCurrentAction = () => projectLoadGenerationRef.current === generation;
    setIsTrackChannelOperation(true);
    try {
      const result = await projectService.changeTrackFormatOnTracks(projectId, trackIds, format);
      if (!isCurrentAction()) return;
      if (result.trackCount === 0) {
        toast.success(`选中轨道已经是 ${getTrackSampleFormatLabel(format)}`);
        return;
      }
      const updated = await projectService.getProject(projectId);
      if (!isCurrentAction()) return;
      if (!updated) throw new Error('Track format 结果不可用');
      setProject(updated);
      pushHistoryCmd({
        id: generateId(),
        label: 'Changed track format',
        execute: () => updated,
        undo: () => before,
      });
      toast.success(`已将 ${result.trackCount} 条轨道的 ${result.clipCount} 个片段转换为 ${getTrackSampleFormatLabel(format)}`);
    } catch (error) {
      if (!isCurrentAction()) return;
      logger.error('Change track format failed', error);
      toast.error(error instanceof Error ? error.message : '轨道格式转换失败');
    } finally {
      setIsTrackChannelOperation(false);
    }
  }

  async function changeTrackRate(newRate: number, directTrackIds?: string[]): Promise<void> {
    const trackIds = directTrackIds ?? trackRateTargets?.trackIds;
    if (!project || !trackIds || isTrackChannelOperation || isResampling) return;
    if (!prepareTrackChannelOperation()) return;
    const before = project;
    const projectId = project.id;
    const generation = projectLoadGenerationRef.current;
    const isCurrentAction = () => projectLoadGenerationRef.current === generation;
    setIsTrackChannelOperation(true);
    try {
      const result = await projectService.changeTrackRateOnTracks(projectId, trackIds, newRate);
      if (!isCurrentAction()) return;
      if (result.trackCount === 0) {
        setTrackRateTargets(null);
        toast.success(`选中轨道已经是 ${newRate} Hz`);
        return;
      }
      const updated = await projectService.getProject(projectId);
      if (!isCurrentAction()) return;
      if (!updated) throw new Error('Track rate 结果不可用');
      setProject(updated);
      setTrackSampleRates((current) => {
        const next = { ...current };
        for (const id of trackIds) next[id] = newRate;
        return next;
      });
      pushHistoryCmd({
        id: generateId(),
        label: 'Changed track rate',
        execute: () => updated,
        undo: () => before,
      });
      setTrackRateTargets(null);
      toast.success(`已更改 ${result.trackCount} 条轨道的速率；${result.clipCount} 个片段保留原始 PCM`);
    } catch (error) {
      if (!isCurrentAction()) return;
      logger.error('Change track rate failed', error);
      toast.error(error instanceof Error ? error.message : '轨道速率更改失败');
    } finally {
      setIsTrackChannelOperation(false);
    }
  }

  async function resampleTrackContext(newRate: number): Promise<void> {
    if (!project || !trackResampleTargets || isResampling || isTrackChannelOperation) return;
    if (!prepareTrackChannelOperation()) return;
    const trackIds = trackResampleTargets;
    const before = project;
    const projectId = project.id;
    const generation = projectLoadGenerationRef.current;
    const isCurrentAction = () => projectLoadGenerationRef.current === generation;
    setIsResampling(true);
    try {
      const result = await projectService.resampleTracksOnTracks(projectId, trackIds, newRate);
      if (!isCurrentAction()) return;
      if (result.trackCount === 0) {
        setTrackResampleTargets(null);
        toast.success(`选中轨道已经是 ${newRate} Hz`);
        return;
      }
      const updated = await projectService.getProject(projectId);
      if (!isCurrentAction()) return;
      if (!updated) throw new Error('Resample track 结果不可用');
      setProject(updated);
      setTrackSampleRates((current) => {
        const next = { ...current };
        for (const id of trackIds) next[id] = newRate;
        return next;
      });
      pushHistoryCmd({
        id: generateId(),
        label: 'Resampled audio track(s)',
        execute: () => updated,
        undo: () => before,
      });
      setTrackResampleTargets(null);
      toast.success(result.clipCount === 0
        ? `已将 ${result.trackCount} 条空轨的速率设为 ${newRate} Hz`
        : `已将 ${result.trackCount} 条轨道的 ${result.clipCount} 个片段重采样为 ${newRate} Hz`);
      if (result.fallbackWarning) toast.warning(result.fallbackWarning);
    } catch (error) {
      if (!isCurrentAction()) return;
      logger.error('Resample track context failed', error);
      toast.error(error instanceof Error ? error.message : '轨道重采样失败');
    } finally {
      setIsResampling(false);
    }
  }

  async function swapStereoChannels(trackId: string): Promise<void> {
    if (!project || isTrackChannelOperation) return;
    if (!prepareTrackChannelOperation()) return;
    const before = project;
    const projectId = project.id;
    const generation = projectLoadGenerationRef.current;
    const isCurrentAction = () => projectLoadGenerationRef.current === generation;
    setIsTrackChannelOperation(true);
    try {
      const changed = await projectService.swapStereoChannelsOnTrack(projectId, trackId);
      if (!isCurrentAction()) return;
      if (changed === 0) {
        toast.success('空立体声轨道无需交换声道');
        return;
      }
      const updated = await projectService.getProject(projectId);
      if (!isCurrentAction()) return;
      if (!updated) throw new Error('声道交换结果不可用');
      setProject(updated);
      pushHistoryCmd({
        id: generateId(),
        label: 'Swap stereo channels',
        execute: () => updated,
        undo: () => before,
      });
      toast.success(`已交换 ${changed} 个片段的左右声道`);
    } catch (error) {
      if (!isCurrentAction()) return;
      logger.error('Swap stereo channels failed', error);
      toast.error(error instanceof Error ? error.message : '声道交换失败');
    } finally {
      setIsTrackChannelOperation(false);
    }
  }

  async function splitStereoTrack(trackId: string, mode: 'lr' | 'center'): Promise<void> {
    if (!project || isTrackChannelOperation) return;
    if (!prepareTrackChannelOperation()) return;
    const before = project;
    const projectId = project.id;
    const generation = projectLoadGenerationRef.current;
    const isCurrentAction = () => projectLoadGenerationRef.current === generation;
    setIsTrackChannelOperation(true);
    try {
      const result = await projectService.splitStereoTrackOnTrack(projectId, trackId, mode);
      if (!isCurrentAction()) return;
      const updated = await projectService.getProject(projectId);
      if (!isCurrentAction()) return;
      if (!updated) throw new Error('立体声拆分结果不可用');
      setProject(updated);
      setSelectedTrackId(result.leftTrackId);
      setEffectsPanelTrackId(result.leftTrackId);
      setSelectedClips([]);
      pushHistoryCmd({
        id: generateId(),
        label: mode === 'lr' ? 'Split stereo to L/R mono' : 'Split stereo to center mono',
        execute: () => updated,
        undo: () => before,
      });
      toast.success(mode === 'lr' ? '已拆分为左右声像单声道轨道' : '已拆分为居中单声道轨道');
    } catch (error) {
      if (!isCurrentAction()) return;
      logger.error('Split stereo track failed', error);
      toast.error(error instanceof Error ? error.message : '立体声拆分失败');
    } finally {
      setIsTrackChannelOperation(false);
    }
  }

  async function performMakeStereoTrack(leftTrackId: string, rightTrackId: string): Promise<void> {
    if (!project || isTrackChannelOperation) return;
    setMakeStereoConfirmation(null);
    if (!prepareTrackChannelOperation()) return;
    const before = project;
    const projectId = project.id;
    const generation = projectLoadGenerationRef.current;
    const isCurrentAction = () => projectLoadGenerationRef.current === generation;
    setIsTrackChannelOperation(true);
    try {
      const targets: EchoTrackAudio[] = [];
      for (const trackId of [leftTrackId, rightTrackId]) {
        const track = project.tracks.find((candidate) => candidate.id === trackId);
        if (!track) throw new Error('目标单声道轨道不可用');
        const clips: EchoTrackAudio['clips'] = [];
        for (const clip of [...track.clips].sort((left, right) => left.startTime - right.startTime)) {
          const effective = await loadEffectiveClipChannels(clip, project.sampleRate);
          if (!isCurrentAction()) return;
          if (!effective) throw new Error(`无法读取片段“${clip.name ?? clip.id}”`);
          clips.push({
            clipId: clip.id,
            sampleData: effective.channels,
            sourceOffset: effective.sourceOffset,
          });
        }
        targets.push({ trackId, clips });
      }
      const result = await projectService.makeStereoTrackFromMono(
        projectId,
        leftTrackId,
        rightTrackId,
        targets,
      );
      if (!isCurrentAction()) return;
      const updated = await projectService.getProject(projectId);
      if (!isCurrentAction()) return;
      if (!updated) throw new Error('Make stereo 结果不可用');
      setProject(updated);
      setSelectedTrackId(result.trackId);
      setEffectsPanelTrackId(result.trackId);
      setSelectedClips([]);
      pushHistoryCmd({
        id: generateId(),
        label: 'Make stereo track',
        execute: () => updated,
        undo: () => before,
      });
      toast.success('已将相邻单声道轨道合并为立体声');
    } catch (error) {
      if (!isCurrentAction()) return;
      logger.error('Make stereo track failed', error);
      toast.error(error instanceof Error ? error.message : '合并立体声失败');
    } finally {
      setIsTrackChannelOperation(false);
    }
  }

  async function requestMakeStereoTrack(trackId: string): Promise<void> {
    if (!project || isTrackChannelOperation) return;
    const trackIndex = project.tracks.findIndex((track) => track.id === trackId);
    const left = project.tracks[trackIndex];
    const right = project.tracks[trackIndex + 1];
    if (!left || !right || getTrackChannelCount(left) !== 1 || getTrackChannelCount(right) !== 1) {
      toast.warning('Make stereo 需要当前轨道及其下一条轨道均为单声道');
      return;
    }
    if (needsMakeStereoRenderWarning(left, right, project.sampleRate)) {
      setMakeStereoConfirmation({ leftTrackId: left.id, rightTrackId: right.id });
      return;
    }
    await performMakeStereoTrack(left.id, right.id);
  }

  async function setTracksMute(muted: boolean, selectedOnly: boolean): Promise<void> {
    if (!project || isMutingTracks) return;
    const targetTrackIds = selectedOnly
      ? resolveMixAndRenderTrackIds(
        project.tracks.map((track) => track.id),
        selectedTrackId,
        selectedClips.map((clip) => clip.trackId),
      )
      : project.tracks.map((track) => track.id);
    if (targetTrackIds.length === 0) {
      toast.warning('请先选择要静音或取消静音的轨道');
      return;
    }

    const targets = new Set(targetTrackIds);
    const label = muted
      ? (selectedOnly ? 'Mute Tracks' : 'Mute All Tracks')
      : (selectedOnly ? 'Unmute Tracks' : 'Unmute All Tracks');
    const projectId = project.id;
    const generation = projectLoadGenerationRef.current;
    const isCurrentAction = () => projectLoadGenerationRef.current === generation;
    setIsMutingTracks(true);
    try {
      const result = await projectService.setTracksMute(projectId, targetTrackIds, muted);
      if (!isCurrentAction()) return;
      if (!result) return;
      const persisted = await projectService.getProject(projectId);
      if (!isCurrentAction()) return;
      if (!persisted) throw new Error('轨道状态保存后无法重新加载');
      setProject(persisted);
      pushHistoryCmd({
        id: generateId(),
        label,
        execute: () => result.after,
        undo: () => result.before,
      });
      const affectedCount = result.before.tracks.filter((track) => targets.has(track.id)).length;
      toast.success(`${muted ? '已静音' : '已取消静音'} ${affectedCount} 条${selectedOnly ? '选中' : ''}轨道`);
    } catch (error) {
      if (!isCurrentAction()) return;
      logger.error('Mute/Unmute tracks failed', error);
      toast.error(error instanceof Error ? error.message : '轨道静音状态保存失败');
    } finally {
      setIsMutingTracks(false);
    }
  }

  async function setTracksPan(pan: -1 | 0 | 1): Promise<void> {
    if (!project || isPanningTracks) return;
    const targetTrackIds = resolveMixAndRenderTrackIds(
      project.tracks.map((track) => track.id),
      selectedTrackId,
      selectedClips.map((clip) => clip.trackId),
    );
    if (targetTrackIds.length === 0) {
      toast.warning('请先选择要调整声像的轨道');
      return;
    }

    const targets = new Set(targetTrackIds);
    const label = pan < 0 ? 'Pan Left' : pan > 0 ? 'Pan Right' : 'Pan Center';
    const projectId = project.id;
    const generation = projectLoadGenerationRef.current;
    const isCurrentAction = () => projectLoadGenerationRef.current === generation;
    setIsPanningTracks(true);
    try {
      const result = await projectService.setTracksPan(projectId, targetTrackIds, pan);
      if (!isCurrentAction()) return;
      if (!result) return;
      const persisted = await projectService.getProject(projectId);
      if (!isCurrentAction()) return;
      if (!persisted) throw new Error('轨道声像保存后无法重新加载');
      setProject(persisted);
      pushHistoryCmd({
        id: generateId(),
        label,
        execute: () => result.after,
        undo: () => result.before,
      });
      const affectedCount = result.before.tracks.filter((track) => targets.has(track.id)).length;
      toast.success(`已将 ${affectedCount} 条选中轨道的声像设为${pan < 0 ? '左侧' : pan > 0 ? '右侧' : '中央'}`);
    } catch (error) {
      if (!isCurrentAction()) return;
      logger.error('Pan tracks failed', error);
      toast.error(error instanceof Error ? error.message : '轨道声像保存失败');
    } finally {
      setIsPanningTracks(false);
    }
  }

  async function removeSelectedTracks(): Promise<void> {
    if (!project || isRemovingTracks) return;
    if (playbackState !== 'stopped' || recordingState === 'recording') {
      toast.warning('请先停止播放或录音');
      return;
    }
    const targetTrackIds = resolveMixAndRenderTrackIds(
      project.tracks.map((track) => track.id),
      selectedTrackId,
      selectedClips.map((clip) => clip.trackId),
    );
    if (targetTrackIds.length === 0) {
      toast.warning('请先选择要移除的轨道');
      return;
    }

    const targets = new Set(targetTrackIds);
    const projectId = project.id;
    const generation = projectLoadGenerationRef.current;
    const isCurrentAction = () => projectLoadGenerationRef.current === generation;
    setIsRemovingTracks(true);
    try {
      // Resolve tracks, labels, and undo state inside the project write queue.
      // Saving this render's complete project would overwrite concurrent edits.
      const result = await projectService.removeTracks(projectId, targetTrackIds);
      if (!isCurrentAction()) return;
      if (!result) return;
      const persisted = await projectService.getProject(projectId);
      if (!isCurrentAction()) return;
      if (!persisted) throw new Error('轨道移除后无法重新加载工程');
      const focusedTrackId = resolveRemoveTrackFocus(
        result.before.tracks.map((track) => track.id),
        targetTrackIds,
      );
      setProject(persisted);
      setSelectedTrackId(
        focusedTrackId && persisted.tracks.some((track) => track.id === focusedTrackId)
          ? focusedTrackId
          : persisted.tracks[0]?.id ?? null,
      );
      setSelectedClips((current) => current.filter((key) => !targets.has(key.trackId)));
      setEffectsPanelTrackId((current) => current && targets.has(current) ? null : current);
      pushHistoryCmd({
        id: generateId(),
        label: 'Remove Track',
        execute: () => result.after,
        undo: () => result.before,
      });
      const removedCount = result.before.tracks.length - result.after.tracks.length;
      toast.success(`已移除 ${removedCount} 条选中轨道`);
    } catch (error) {
      if (!isCurrentAction()) return;
      logger.error('Remove Tracks failed', error);
      toast.error(error instanceof Error ? error.message : '选中轨道移除失败');
    } finally {
      setIsRemovingTracks(false);
    }
  }

  async function sortTracks(mode: TrackSortMode): Promise<void> {
    if (!project || isSortingTracks) return;
    if (project.tracks.length === 0) {
      toast.warning('工程中没有可排序的轨道');
      return;
    }

    const label = mode === 'time' ? 'Sort by Time' : 'Sort by Name';
    const projectId = project.id;
    const generation = projectLoadGenerationRef.current;
    const isCurrentAction = () => projectLoadGenerationRef.current === generation;
    setIsSortingTracks(true);
    try {
      // Audacity sorts every track, independent of the current track selection.
      // Resolve the source inside ProjectService's queue instead of saving this
      // render's complete track array over concurrently committed mutations.
      const result = await projectService.sortTracks(projectId, mode);
      if (!isCurrentAction()) return;
      if (!result) return;
      const persisted = await projectService.getProject(projectId);
      if (!isCurrentAction()) return;
      if (!persisted) throw new Error('轨道排序后无法重新加载工程');
      setProject(persisted);
      pushHistoryCmd({
        id: generateId(),
        label,
        execute: () => result.after,
        undo: () => result.before,
      });
      toast.success(`已按${mode === 'time' ? '开始时间' : '名称'}排序 ${result.after.tracks.length} 条轨道`);
    } catch (error) {
      if (!isCurrentAction()) return;
      logger.error('Sort Tracks failed', error);
      toast.error(error instanceof Error ? error.message : '轨道排序保存失败');
    } finally {
      setIsSortingTracks(false);
    }
  }

  async function moveTrack(trackId: string, direction: TrackMoveDirection): Promise<void> {
    if (!project || isMovingTrack) return;
    const ordered = moveTrackInOrder(project.tracks, trackId, direction);
    if (ordered.every((track, index) => track.id === project.tracks[index]?.id)) return;

    const projectId = project.id;
    const generation = projectLoadGenerationRef.current;
    const isCurrentAction = () => projectLoadGenerationRef.current === generation;
    setIsMovingTrack(true);
    try {
      const result = await projectService.moveTrack(projectId, trackId, direction);
      if (!isCurrentAction()) return;
      if (!result) return;
      const persisted = await projectService.getProject(projectId);
      if (!isCurrentAction()) return;
      if (!persisted) throw new Error('轨道移动后无法重新加载工程');
      setProject(persisted);
      setSelectedTrackId(trackId);
      pushHistoryCmd({
        id: generateId(),
        label: 'Move track',
        execute: () => result.after,
        undo: () => result.before,
      });
    } catch (error) {
      if (!isCurrentAction()) return;
      logger.error('Move track failed', error);
      toast.error(error instanceof Error ? error.message : '轨道移动保存失败');
    } finally {
      setIsMovingTrack(false);
    }
  }

  async function duplicateTrack(trackId: string): Promise<void> {
    if (!project || isDuplicatingTrack) return;
    const source = project.tracks.find((track) => track.id === trackId);
    if (!source) return;
    const before = structuredClone(project);
    const projectId = project.id;
    const generation = projectLoadGenerationRef.current;
    const isCurrentAction = () => projectLoadGenerationRef.current === generation;
    setIsDuplicatingTrack(true);
    try {
      const duplicated = await projectService.duplicateTrack(projectId, trackId);
      if (!isCurrentAction()) return;
      if (!duplicated) throw new Error('目标轨道不可用');
      const persisted = await projectService.getProject(projectId);
      if (!isCurrentAction()) return;
      if (!persisted) throw new Error('轨道复制后无法重新加载工程');
      setProject(persisted);
      pushHistoryCmd({
        id: generateId(),
        label: 'Duplicate track',
        execute: () => persisted,
        undo: () => before,
      });
      toast.success(`已复制轨道「${source.name}」`);
    } catch (error) {
      if (!isCurrentAction()) return;
      logger.error('Duplicate track failed', error);
      toast.error(error instanceof Error ? error.message : '轨道复制失败');
    } finally {
      setIsDuplicatingTrack(false);
    }
  }

  function setMoveSelectionPreference(enabled: boolean): void {
    setMoveSelectionWithTracks(enabled);
    const preferences = projectService.getPreferences?.();
    if (preferences) {
      projectService.savePreferences?.({ ...preferences, moveSelectionWithTracks: enabled });
    }
  }

  function setSyncLockPreference(enabled: boolean): void {
    setSyncLockTracks(enabled);
    const preferences = projectService.getPreferences?.();
    if (preferences) {
      projectService.savePreferences?.({ ...preferences, syncLockTracks: enabled });
    }
  }

  async function alignSelectedTracks(mode: TrackAlignMode): Promise<void> {
    if (!project || isAligningTracks) return;
    if (playbackState !== 'stopped' || recordingState === 'recording') {
      toast.warning('请先停止播放或录音');
      return;
    }
    const targetTrackIds = resolveMixAndRenderTrackIds(
      project.tracks.map((track) => track.id),
      selectedTrackId,
      selectedClips.map((clip) => clip.trackId),
    );
    if (targetTrackIds.length === 0) {
      toast.warning('请先选择要对齐的轨道');
      return;
    }

    const label = getTrackAlignLabel(mode, moveSelectionWithTracks);
    const projectId = project.id;
    const generation = projectLoadGenerationRef.current;
    const isCurrentAction = () => projectLoadGenerationRef.current === generation;
    setIsAligningTracks(true);
    try {
      const result = await projectService.alignTracks(projectId, targetTrackIds, mode, {
        cursorPosition,
        selection,
        moveSelectionWithTracks,
        syncLockTracks,
      });
      if (!isCurrentAction()) return;
      if (!result) return;
      const persisted = await projectService.getProject(projectId);
      if (!isCurrentAction()) return;
      if (!persisted) throw new Error('轨道对齐后无法重新加载工程');
      setProject(persisted);
      setSelection(persisted.selection);
      setCursorPosition(persisted.cursorPosition);
      if (persisted.cursorPosition !== cursorPosition) audioEngine.seek(persisted.cursorPosition);
      if (mode === 'end-to-end') {
        // Audacity's DoAlign calls ZoomFitHorizontally after Align End to End.
        // Use the persisted project so the fit includes the newly aligned clip end.
        fitProjectToWidth(getProjectDuration(persisted));
      }
      pushHistoryCmd({
        id: generateId(),
        label,
        execute: () => result.after,
        undo: () => result.before,
      }, result.before);
      const targets = new Set(targetTrackIds);
      const affectedCount = result.before.tracks.filter((track) => targets.has(track.id)).length;
      toast.success(`已对齐 ${affectedCount} 条选中轨道`);
    } catch (error) {
      if (!isCurrentAction()) return;
      logger.error('Align Tracks failed', error);
      toast.error(error instanceof Error ? error.message : '轨道对齐保存失败');
    } finally {
      setIsAligningTracks(false);
    }
  }

  async function updateTrack(trackId: string, updates: Partial<ITrack>) {
    if (!project) return;
    const projectId = project.id;
    const generation = projectLoadGenerationRef.current;
    const isCurrentAction = () => projectLoadGenerationRef.current === generation;
    try {
      const updated = await projectService.updateTrack(projectId, trackId, updates);
      if (!isCurrentAction()) return;
      // Render only the committed snapshot. A null result means the project was
      // permanently deleted or the track disappeared before the write.
      if (updated) setProject(updated);
    } catch (error) {
      if (!isCurrentAction()) return;
      logger.error('Update track failed', error);
      toast.error(`轨道更新失败：${error instanceof Error ? error.message : '未知错误'}`);
    }
  }

  function toggleMute(trackId: string) {
    if (!project) return;
    const track = project.tracks.find((t) => t.id === trackId);
    if (!track) return;
    updateTrack(trackId, { muted: !track.muted });
  }

  function toggleSolo(trackId: string) {
    if (!project) return;
    const track = project.tracks.find((t) => t.id === trackId);
    if (!track) return;
    updateTrack(trackId, { solo: !track.solo });
  }

  function toggleArm(trackId: string) {
    if (!project) return;
    const track = project.tracks.find((t) => t.id === trackId);
    if (!track) return;
    updateTrack(trackId, { armed: !track.armed });
  }

  function updateTrackGain(trackId: string, gainDb: number) {
    updateTrack(trackId, { gain: gainDb });
  }

  function updateTrackPan(trackId: string, pan: number) {
    updateTrack(trackId, { pan });
  }

  function renameTrack(trackId: string, name: string) {
    updateTrack(trackId, { name });
  }

  // Clip operations
  function selectClip(trackId: string, clipId: string, mode: ClipSelectionMode = 'replace') {
    const key = { trackId, clipId };
    setSelectedTrackId(trackId);
    setSelectedClips((current) => {
      const alreadySelected = current.some((candidate) => clipKeyId(candidate) === clipKeyId(key));
      const hadRangeAnchor = [clipSelectionAnchorRef.current, ...current].some((candidate) =>
        candidate !== null && (project?.tracks ?? []).some((track) =>
          track.id === candidate.trackId && track.clips.some((clip) => clip.id === candidate.clipId),
        ),
      );
      const next = updateClipSelection(
        current,
        key,
        mode,
        project?.tracks ?? [],
        clipSelectionAnchorRef.current,
      );
      if (mode === 'replace' || (mode === 'toggle' && !alreadySelected) || (mode === 'range' && !hadRangeAnchor)) {
        clipSelectionAnchorRef.current = key;
      }
      return next;
    });
  }

  function keysForClip(trackId: string, clipId: string): ClipKey[] {
    const key = { trackId, clipId };
    return selectedClips.some((item) => clipKeyId(item) === clipKeyId(key))
      ? selectedClips
      : [key];
  }

  async function commitClipEdit(
    edit: (latest: IProject) => IProject | Promise<IProject>,
    label: string,
    onCommitted?: () => void,
  ): Promise<boolean> {
    if (!project) return false;
    const projectId = project.id;
    const generation = projectLoadGenerationRef.current;
    const isCurrentAction = () => projectLoadGenerationRef.current === generation;
    try {
      const result = await projectService.editLatestProject(projectId, edit);
      if (!result) return false;
      // A committed old-project edit must retain its newly referenced resources,
      // but it must not overwrite the newly opened page or its undo history.
      onCommitted?.();
      if (!isCurrentAction()) return false;
      setProject(result.after);
      pushHistoryCmd({
        id: generateId(),
        label,
        execute: () => result.after,
        undo: () => result.before,
      }, result.before);
      return true;
    } catch (error) {
      if (!isCurrentAction()) return false;
      logger.error('Clip edit failed', error);
      toast.error(error instanceof Error ? error.message : 'Clip edit failed');
      return false;
    }
  }

  async function handleTempoChange(value: number) {
    if (!project || playbackState !== 'stopped' || recordingState === 'recording') return;
    await commitClipEdit((latest) => updateProjectTempo(latest, value), '调整 BPM');
  }

  async function handleTimeSignatureChange(numerator: number, denominator: number) {
    if (!project) return;
    await commitClipEdit(
      (latest) => updateProjectTimeSignature(latest, numerator, denominator),
      '调整拍号',
    );
  }

  function createSnapSettings(points: readonly number[], bypassSnap: boolean): SnapSettings {
    return {
      enabled: snapEnabled && !bypassSnap,
      mode: snapMode,
      points,
      toleranceSeconds: DEFAULT_SNAP_TOLERANCE_PIXELS / Math.max(1, horizontalZoom),
      sampleRate: project?.sampleRate ?? 48000,
      tempo: project?.tempo ?? 120,
      timeSignature: project?.timeSignature ?? { numerator: 4, denominator: 4 },
    };
  }

  function resolveClipSnapDelta(
    trackId: string,
    clipId: string,
    operation: ClipSnapOperation,
    deltaSeconds: number,
    bypassSnap = false,
  ): number {
    if (!project) return deltaSeconds;
    const keys = keysForClip(trackId, clipId);
    return snapClipSelectionDelta(
      project,
      keys,
      operation,
      deltaSeconds,
      createSnapSettings(collectClipSnapPoints(project, keys), bypassSnap),
    );
  }

  function resolveTimelineSnap(time: number, bypassSnap = false): number {
    if (!project) return time;
    const points = collectClipSnapPoints(project);
    if (Number.isFinite(cursorPosition) && cursorPosition >= 0) points.push(cursorPosition);
    if (selection) points.push(selection.start, selection.end);
    return snapTimelineTime(time, createSnapSettings(points, bypassSnap));
  }

  async function handleClipEdgeTrim(
    trackId: string,
    clipId: string,
    edge: 'left' | 'right',
    deltaSeconds: number,
    bypassSnap = false,
  ) {
    if (!project) return;
    const keys = keysForClip(trackId, clipId);
    const delta = resolveClipSnapDelta(trackId, clipId, `trim-${edge}`, deltaSeconds, bypassSnap);
    if (Math.abs(delta) < 0.001) return;
    await commitClipEdit(
      (latest) => trimClipSelection(latest, keys, edge, delta),
      keys.length > 1 ? '成组修剪片段' : '修剪片段',
    );
  }

  async function handleClipStretch(
    trackId: string,
    clipId: string,
    edge: 'left' | 'right',
    deltaSeconds: number,
    bypassSnap = false,
  ) {
    if (!project) return;
    const keys = keysForClip(trackId, clipId);
    const delta = resolveClipSnapDelta(trackId, clipId, `stretch-${edge}`, deltaSeconds, bypassSnap);
    if (Math.abs(delta) < 0.001) return;
    await commitClipEdit(
      (latest) => stretchClipSelection(latest, keys, edge, delta),
      keys.length > 1 ? '成组拉伸片段' : '时间拉伸片段',
    );
  }

  async function handleClipMove(trackId: string, clipId: string, deltaSeconds: number, bypassSnap = false) {
    if (!project) return;
    const keys = keysForClip(trackId, clipId);
    const delta = resolveClipSnapDelta(trackId, clipId, 'move', deltaSeconds, bypassSnap);
    if (Math.abs(delta) < 0.001) return;
    await commitClipEdit(
      (latest) => moveClipSelection(latest, keys, delta),
      keys.length > 1 ? '成组移动片段' : '移动片段',
    );
  }

  async function handleClipReset(trackId: string, clipId: string) {
    if (!project) return;
    const keys = keysForClip(trackId, clipId);
    await commitClipEdit((latest) => resetClipStretch(latest, keys), '恢复片段速度 100%');
  }

  async function handleClipPitchAndSpeed(settings: ClipPitchAndSpeedSettings) {
    if (!project || !pitchAndSpeedClipKey) return;
    const key = pitchAndSpeedClipKey;
    const committed = await commitClipEdit(
      (latest) => applyClipPitchAndSpeed(latest, key, settings),
      '调整片段音高与速度',
    );
    if (committed) toast.success('已更新片段音高与速度');
  }

  async function resetClipPitchAndSpeed(trackId: string, clipId: string) {
    if (!project || renderingPitchAndSpeedClipId) return;
    const key = { trackId, clipId };
    const clip = project.tracks.find((track) => track.id === trackId)
      ?.clips.find((candidate) => candidate.id === clipId);
    if (!clip || !hasClipPitchOrSpeed(clip)) return;
    stopPlaybackAndSyncMonitoring();
    await commitClipEdit((latest) => applyClipPitchAndSpeed(latest, key, {
      pitchCents: 0,
      speedPercentage: 100,
      optimizeForVoice: false,
    }), '重置片段音高与速度');
  }

  async function renderClipPitchAndSpeed(trackId: string, clipId: string) {
    if (!project || renderingPitchAndSpeedClipId) return;
    const key = { trackId, clipId };
    const operationId = clipKeyId(key);
    const clip = project.tracks.find((track) => track.id === trackId)
      ?.clips.find((candidate) => candidate.id === clipId);
    if (!clip || !hasClipPitchOrSpeed(clip)) return;

    setRenderingPitchAndSpeedClipId(operationId);
    stopPlaybackAndSyncMonitoring();
    let uncommittedBufferId: string | null = null;
    try {
      const channels = await projectService.loadAudioChannels(clip.audioBufferId, project.sampleRate);
      if (!channels) throw new Error(`片段“${clip.name || clip.id}”的音频不可用`);
      const renderedChannels = renderClipPitchAndSpeedChannels(clip, channels, project.sampleRate);
      const renderedDuration = renderedChannels[0].length / project.sampleRate;
      uncommittedBufferId = generateId();
      await storeProjectBuffer(project.id, renderedChannels, project.sampleRate, uncommittedBufferId);
      const committed = await commitClipEdit(
        (latest) => replaceClipWithRenderedPitchAndSpeed(latest, key, uncommittedBufferId!, renderedDuration, clip),
        'Rendered time-stretched audio · Render',
        () => { uncommittedBufferId = null; },
      );
      if (!committed) return;
      setSelectedClips([key]);
      clipSelectionAnchorRef.current = key;
      toast.success('Rendered time-stretched audio');
    } catch (error) {
      logger.error('Render clip pitch and speed failed', error);
      toast.error(`Render pitch and speed 失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      if (uncommittedBufferId) {
        try {
          await discardUncommittedProjectBuffer(uncommittedBufferId);
        } catch (cleanupError) {
          logger.error('Discard uncommitted pitch and speed render failed', cleanupError);
          toast.error('Render pitch and speed 的临时音频清理失败，请检查浏览器存储');
        }
      }
      setRenderingPitchAndSpeedClipId(null);
    }
  }

  async function splitClipAtSilences(trackId: string, clipId: string) {
    if (!project || renderingPitchAndSpeedClipId || splittingSilenceClipId) return;
    const key = { trackId, clipId };
    const clip = project.tracks.find((track) => track.id === trackId)
      ?.clips.find((candidate) => candidate.id === clipId);
    if (!clip) return;

    const operationId = clipKeyId(key);
    setSplittingSilenceClipId(operationId);
    stopPlaybackAndSyncMonitoring();
    try {
      const channels = await projectService.loadAudioChannels(clip.audioBufferId, project.sampleRate);
      if (!channels) throw new Error(`片段“${clip.name || clip.id}”的音频不可用`);
      const result = disjoinClipAtSilences(project, key, channels, generateId);
      if (!result.didChange) {
        toast.info('未找到所有声道同时精确为零且至少 0.01 秒的静音区间');
        return;
      }
      const committed = await commitClipEdit(
        (latest) => disjoinClipAtSilences(latest, key, channels, generateId).project,
        'Split at silences',
      );
      if (!committed) return;
      setSelectedClips([]);
      clipSelectionAnchorRef.current = null;
      toast.success(`Split at silences · 移除 ${result.regions.length} 个静音区间`);
    } catch (error) {
      logger.error('Split at silences failed', error);
      toast.error(`Split at silences 失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setSplittingSilenceClipId(null);
    }
  }

  async function toggleStretchWithTempoChanges(trackId: string, clipId: string) {
    if (!project || recordingState === 'recording' || renderingPitchAndSpeedClipId) return;
    const clip = project.tracks.find((track) => track.id === trackId)
      ?.clips.find((candidate) => candidate.id === clipId);
    if (!clip) return;
    const enabled = !isClipStretchToMatchTempo(clip);
    stopPlaybackAndSyncMonitoring();
    await commitClipEdit(
      (latest) => toggleClipStretchToMatchTempo(latest, { trackId, clipId }),
      enabled ? '启用 Stretch with tempo changes' : '停用 Stretch with tempo changes',
    );
  }

  async function changeClipColor(trackId: string, clipId: string, colorIndex: number) {
    if (!project || renderingPitchAndSpeedClipId) return;
    await commitClipEdit(
      (latest) => setClipColor(latest, { trackId, clipId }, colorIndex),
      '修改片段颜色',
    );
  }

  async function changeTrackColor(trackId: string, colorIndex: number): Promise<void> {
    if (!project) return;
    const projectId = project.id;
    const generation = projectLoadGenerationRef.current;
    const isCurrentAction = () => projectLoadGenerationRef.current === generation;
    try {
      const updated = await projectService.updateTrackAppearance(projectId, trackId, {
        type: 'color', colorIndex,
      });
      if (!isCurrentAction()) return;
      if (updated) setProject(updated);
    } catch (error) {
      if (!isCurrentAction()) return;
      logger.error('Change track color failed', error);
      toast.error(error instanceof Error ? error.message : '轨道颜色保存失败');
    }
  }

  async function changeTrackViewMode(trackId: string, mode: ViewMode): Promise<void> {
    if (!project) return;
    const projectId = project.id;
    const generation = projectLoadGenerationRef.current;
    const isCurrentAction = () => projectLoadGenerationRef.current === generation;
    try {
      const updated = await projectService.updateTrackAppearance(projectId, trackId, {
        type: 'viewMode', viewMode: mode,
      });
      if (!isCurrentAction()) return;
      if (updated) setProject(updated);
    } catch (error) {
      if (!isCurrentAction()) return;
      logger.error('Change track visualization failed', error);
      toast.error(error instanceof Error ? error.message : '轨道视图保存失败');
    }
  }

  async function changeTrackHalfWave(trackId: string, value: boolean): Promise<void> {
    if (!project) return;
    const projectId = project.id;
    const generation = projectLoadGenerationRef.current;
    const isCurrentAction = () => projectLoadGenerationRef.current === generation;
    try {
      const updated = await projectService.updateTrackAppearance(projectId, trackId, {
        type: 'halfWave', halfWave: value,
      });
      if (!isCurrentAction()) return;
      if (updated) setProject(updated);
    } catch (error) {
      if (!isCurrentAction()) return;
      logger.error('Change track Half-wave failed', error);
      toast.error(error instanceof Error ? error.message : 'Half-wave 保存失败');
    }
  }

  async function changeClipTitle(trackId: string, clipId: string, newTitle: string) {
    if (!project || renderingPitchAndSpeedClipId) return;
    await commitClipEdit(
      (latest) => renameClipTitle(latest, { trackId, clipId }, newTitle),
      '重命名片段',
    );
  }

  function openClipProperties(trackId: string, clipId: string) {
    selectClip(trackId, clipId, 'replace');
    setPitchAndSpeedClipKey(null);
    setClipPropertiesKey({ trackId, clipId });
  }

  async function handleTrackSpectrogramSettings(
    trackId: string,
    settings: ISpectrogramSettings,
    useGlobalSettings: boolean,
  ) {
    if (!project) return;
    await commitClipEdit(
      (latest) => updateTrackSpectrogramSettings(latest, trackId, settings, useGlobalSettings),
      useGlobalSettings ? '恢复全局 Spectrogram 设置' : '调整轨道 Spectrogram 设置',
    );
  }

  function openClipPitchAndSpeed(trackId: string, clipId: string) {
    selectClip(trackId, clipId, 'replace');
    setClipPropertiesKey(null);
    setPitchAndSpeedClipKey({ trackId, clipId });
  }

  async function handleDeleteSelectedClips() {
    if (!project || selectedClips.length === 0) return;
    const keys = selectedClips;
    const committed = await commitClipEdit(
      (latest) => deleteClipSelection(latest, keys),
      `删除 ${keys.length} 个片段`,
    );
    if (committed) setSelectedClips([]);
  }

  async function splitClipsAtCursor(keysOverride?: ClipKey[]) {
    if (!project) return;
    const keys = keysOverride ?? (selectedClips.length > 0
      ? selectedClips
      : project.tracks
        .filter((track) => track.id === selectedTrackId)
        .flatMap((track) => track.clips.map((clip) => ({ trackId: track.id, clipId: clip.id }))));
    const splitTime = cursorPosition;
    const result = splitClipSelectionAtTime(project, keys, splitTime, generateId);
    if (!result.didSplit) {
      toast.info('请将播放光标放在选中片段内部');
      return;
    }
    const committed = await commitClipEdit(
      (latest) => splitClipSelectionAtTime(latest, keys, splitTime, generateId).project,
      '在光标处分割片段',
    );
    if (!committed) return;
    setSelectedClips([]);
    toast.success('已分割片段');
  }

  function persistWorkspaceStore(store: WorkspaceStore): boolean {
    const persisted = saveWorkspaceStore(store);
    if (persisted) {
      workspaceStorageWarningShownRef.current = false;
      return true;
    }
    if (!workspaceStorageWarningShownRef.current) {
      workspaceStorageWarningShownRef.current = true;
      toast.error('浏览器存储不可用，Workspace 更改仅在本次会话保留');
    }
    return false;
  }

  function changeChannelHeightRatio(trackId: string, ratio: number) {
    setChannelHeightRatios((current) => ({ ...current, [trackId]: ratio }));
  }

  function commitChannelHeightRatio(trackId: string, ratio: number) {
    if (!projectId) return;
    changeChannelHeightRatio(trackId, ratio);
    if (!saveChannelHeightRatio(projectId, trackId, ratio) && !channelHeightStorageWarningShownRef.current) {
      channelHeightStorageWarningShownRef.current = true;
      toast.error('浏览器存储不可用，声道高度仅在本次会话保留');
    }
  }

  function changeRecordingMonitoringPreferences(patch: Partial<RecordingMonitoringPreferences>) {
    const next = { ...recordingMonitoringPreferencesRef.current, ...patch };
    if (!saveRecordingMonitoringPreferences(next)) {
      toast.error('浏览器存储不可用，录音监控偏好未保存');
      return;
    }
    microphoneErrorNotificationRef.current = true;
    setRecordingMonitoringPreferences(next);
  }

  function applyWorkspaceLayout(layout: WorkspaceLayout) {
    setShowTrackPanel(layout.showTrackPanel);
    setShowMixer(layout.showMixer);
    setShowClipping(layout.showClipping);
    setShowRMS(layout.showRMS);
    setShowVerticalRulers(layout.showVerticalRulers);
    setViewMode(layout.viewMode);
    setHalfWave(layout.halfWave);
    setHorizontalZoom(normalizeHorizontalZoom(layout.horizontalZoom));
    setVerticalZoom(normalizeVerticalZoom(layout.verticalZoom));
  }

  function applyWorkspace(id: string) {
    const preset = workspaceStore.presets.find((candidate) => candidate.id === id);
    if (!preset) return;
    const updated = { ...workspaceStore, activeId: id };
    setWorkspaceStore(updated);
    persistWorkspaceStore(updated);
    applyWorkspaceLayout(preset.layout);
  }

  function openWorkspaceManager() {
    setWorkspaceManagerSelectionId(workspaceStore.activeId);
    setWorkspaceManagerOpen(true);
  }

  function openWorkspaceCreator() {
    setWorkspaceManagerOpen(false);
    setWorkspaceDialogOpen(true);
  }

  function applyManagedWorkspace() {
    applyWorkspace(managedWorkspace.id);
    setWorkspaceManagerOpen(false);
  }

  function saveCurrentWorkspace() {
    try {
      const updated = createWorkspace(
        workspaceStore,
        generateId(),
        workspaceName,
        workspaceLayout,
      );
      if (!persistWorkspaceStore(updated)) return;
      setWorkspaceStore(updated);
      setWorkspaceDialogOpen(false);
      setWorkspaceName('');
      toast.success('Workspace 已保存到当前浏览器');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Workspace 保存失败');
    }
  }

  function resetActiveWorkspace() {
    const updated = resetWorkspace(workspaceStore, workspaceStore.activeId);
    setWorkspaceStore(updated);
    persistWorkspaceStore(updated);
    const preset = updated.presets.find((candidate) => candidate.id === updated.activeId);
    if (preset) applyWorkspaceLayout(preset.layout);
    toast.info('已恢复内置 Workspace');
  }

  function deleteWorkspace(id: string) {
    const updated = removeWorkspace(workspaceStore, id);
    if (updated === workspaceStore) return;
    setWorkspaceStore(updated);
    persistWorkspaceStore(updated);
    const validNames = new Set(updated.presets.map((candidate) => candidate.name));
    const updatedStereoPreferences = {
      ...stereoHeightsPreferences,
      workspaceNames: stereoHeightsPreferences.workspaceNames.filter((name) => validNames.has(name)),
    };
    setStereoHeightsPreferences(updatedStereoPreferences);
    saveStereoHeightsPreferences(updatedStereoPreferences);
    if (updated.activeId !== workspaceStore.activeId) {
      const preset = updated.presets.find((candidate) => candidate.id === updated.activeId);
      if (preset) applyWorkspaceLayout(preset.layout);
    }
    toast.info('已删除自定义 Workspace');
  }

  function deleteActiveWorkspace() {
    deleteWorkspace(workspaceStore.activeId);
  }

  function deleteManagedWorkspace() {
    if (managedWorkspace.builtIn) return;
    const nextActiveId = workspaceStore.activeId === managedWorkspace.id
      ? 'classic'
      : workspaceStore.activeId;
    deleteWorkspace(managedWorkspace.id);
    setWorkspaceManagerSelectionId(nextActiveId);
  }

  function rememberLastGeneratorDuration(kind: GeneratorKind, duration: number) {
    setGeneratorDurations((current) => ({ ...current, [kind]: duration }));
    saveGeneratorDuration(kind, duration);
  }

  async function handleGenerateTone(settings: ToneRequest) {
    if (!project) return;
    const trackIds = resolveGeneratorTrackIds(project.tracks, selectedTrackId, selectedClips);
    if (trackIds.length === 0) {
      toast.warning('请先添加一个音频轨道');
      return;
    }

    const activeSelection = quantizeSelectionToSamples(selection, project.sampleRate);
    const beforeProject = structuredClone(project);
    const generation = projectLoadGenerationRef.current;
    setIsGeneratingTone(true);
    try {
      const duration = activeSelection
        ? activeSelection.end - activeSelection.start
        : settings.duration;
      const channels = generateToneChannels({
        waveform: settings.waveform,
        frequency: settings.frequency,
        amplitude: settings.amplitude,
        duration,
        sampleRate: project.sampleRate,
        channelCount: settings.channelCount,
      });
      const clips = await projectService.addGeneratedAudioToTracks(
        project.id,
        trackIds.map((trackId) => ({ trackId, sampleData: channels })),
        project.sampleRate,
        activeSelection?.start ?? cursorPosition,
        `音调 ${settings.frequency} Hz`,
        activeSelection ?? undefined,
      );
      if (projectLoadGenerationRef.current !== generation) return;
      if (clips.length !== trackIds.length) throw new Error('目标轨道不可用');

      const updated = await projectService.getProject(project.id);
      if (projectLoadGenerationRef.current !== generation) return;
      if (!updated) throw new Error('工程保存后无法重新加载');
      setProject(updated);
      setSelectedTrackId(trackIds[0]!);
      setSelectedClips(clips.map((clip, index) => ({ trackId: trackIds[index]!, clipId: clip.id })));
      pushHistoryCmd({
        id: generateId(),
        label: '生成音调',
        execute: () => updated,
        undo: () => beforeProject,
      });
      if (!activeSelection) rememberLastGeneratorDuration('tone', duration);
      setToneDialogOpen(false);
      const trackMessage = trackIds.length > 1 ? `到 ${trackIds.length} 条轨道` : '';
      toast.success(activeSelection
        ? `已将 ${trackIds.length} 条轨道的 ${formatTime(activeSelection.start)}–${formatTime(activeSelection.end)} 替换为音调`
        : `已在 ${formatTime(cursorPosition)} ${trackMessage}生成 ${formatTime(duration)} 音调`);
    } catch (error) {
      if (projectLoadGenerationRef.current !== generation) return;
      const message = error instanceof Error ? error.message : '未知错误';
      toast.error(`生成音调失败：${message}`);
    } finally {
      setIsGeneratingTone(false);
    }
  }

  async function handleGenerateChirp(settings: ChirpRequest) {
    if (!project) return;
    const trackIds = resolveGeneratorTrackIds(project.tracks, selectedTrackId, selectedClips);
    if (trackIds.length === 0) {
      toast.warning('请先添加一个音频轨道');
      return;
    }

    const activeSelection = quantizeSelectionToSamples(selection, project.sampleRate);
    const beforeProject = structuredClone(project);
    const generation = projectLoadGenerationRef.current;
    setIsGeneratingChirp(true);
    try {
      const duration = activeSelection
        ? activeSelection.end - activeSelection.start
        : settings.duration;
      const channels = generateChirp({
        ...settings,
        duration,
        sampleRate: project.sampleRate,
      });
      const clips = await projectService.addGeneratedAudioToTracks(
        project.id,
        trackIds.map((trackId) => ({ trackId, sampleData: [channels] })),
        project.sampleRate,
        activeSelection?.start ?? cursorPosition,
        `扫频 ${settings.startFrequency}–${settings.endFrequency} Hz`,
        activeSelection ?? undefined,
      );
      if (projectLoadGenerationRef.current !== generation) return;
      if (clips.length !== trackIds.length) throw new Error('目标轨道不可用');

      const updated = await projectService.getProject(project.id);
      if (projectLoadGenerationRef.current !== generation) return;
      if (!updated) throw new Error('工程保存后无法重新加载');
      setProject(updated);
      setSelectedTrackId(trackIds[0]!);
      setSelectedClips(clips.map((clip, index) => ({ trackId: trackIds[index]!, clipId: clip.id })));
      pushHistoryCmd({
        id: generateId(),
        label: '生成扫频',
        execute: () => updated,
        undo: () => beforeProject,
      });
      if (!activeSelection) rememberLastGeneratorDuration('chirp', duration);
      setChirpDialogOpen(false);
      const trackMessage = trackIds.length > 1 ? `到 ${trackIds.length} 条轨道` : '';
      toast.success(activeSelection
        ? `已将 ${trackIds.length} 条轨道的 ${formatTime(activeSelection.start)}–${formatTime(activeSelection.end)} 替换为扫频`
        : `已在 ${formatTime(cursorPosition)} ${trackMessage}生成 ${formatTime(duration)} 扫频`);
    } catch (error) {
      if (projectLoadGenerationRef.current !== generation) return;
      const message = error instanceof Error ? error.message : '未知错误';
      toast.error(`生成扫频失败：${message}`);
    } finally {
      setIsGeneratingChirp(false);
    }
  }

  async function handleGenerateDtmf(settings: DtmfRequest) {
    if (!project) return;
    const trackIds = resolveGeneratorTrackIds(project.tracks, selectedTrackId, selectedClips);
    if (trackIds.length === 0) {
      toast.warning('请先添加一个音频轨道');
      return;
    }

    const activeSelection = quantizeSelectionToSamples(selection, project.sampleRate);
    const beforeProject = structuredClone(project);
    const generation = projectLoadGenerationRef.current;
    setIsGeneratingDtmf(true);
    try {
      const duration = activeSelection
        ? activeSelection.end - activeSelection.start
        : settings.duration;
      const channels = generateDtmf({
        ...settings,
        duration,
        sampleRate: project.sampleRate,
      });
      const clips = await projectService.addGeneratedAudioToTracks(
        project.id,
        trackIds.map((trackId) => ({ trackId, sampleData: [channels] })),
        project.sampleRate,
        activeSelection?.start ?? cursorPosition,
        `DTMF ${settings.sequence}`,
        activeSelection ?? undefined,
      );
      if (projectLoadGenerationRef.current !== generation) return;
      if (clips.length !== trackIds.length) throw new Error('目标轨道不可用');

      const updated = await projectService.getProject(project.id);
      if (projectLoadGenerationRef.current !== generation) return;
      if (!updated) throw new Error('工程保存后无法重新加载');
      setProject(updated);
      setSelectedTrackId(trackIds[0]!);
      setSelectedClips(clips.map((clip, index) => ({ trackId: trackIds[index]!, clipId: clip.id })));
      pushHistoryCmd({
        id: generateId(),
        label: '生成 DTMF',
        execute: () => updated,
        undo: () => beforeProject,
      });
      if (!activeSelection) rememberLastGeneratorDuration('dtmf', duration);
      setDtmfDialogOpen(false);
      const trackMessage = trackIds.length > 1 ? `到 ${trackIds.length} 条轨道` : '';
      toast.success(activeSelection
        ? `已将 ${trackIds.length} 条轨道的 ${formatTime(activeSelection.start)}–${formatTime(activeSelection.end)} 替换为 DTMF`
        : `已在 ${formatTime(cursorPosition)} ${trackMessage}生成 ${formatTime(duration)} DTMF`);
    } catch (error) {
      if (projectLoadGenerationRef.current !== generation) return;
      const message = error instanceof Error ? error.message : '未知错误';
      toast.error(`生成 DTMF 失败：${message}`);
    } finally {
      setIsGeneratingDtmf(false);
    }
  }

  async function handleGeneratePluck(settings: PluckRequest) {
    if (!project) return;
    const trackIds = resolveGeneratorTrackIds(project.tracks, selectedTrackId, selectedClips);
    if (trackIds.length === 0) {
      toast.warning('请先添加一个音频轨道');
      return;
    }

    const activeSelection = quantizeSelectionToSamples(selection, project.sampleRate);
    const replacementSelection = activeSelection
      ? { ...activeSelection, allowDurationChange: true }
      : undefined;
    const beforeProject = structuredClone(project);
    const generation = projectLoadGenerationRef.current;
    setIsGeneratingPluck(true);
    try {
      const channels = generatePluck({ ...settings, sampleRate: project.sampleRate });
      const clips = await projectService.addGeneratedAudioToTracks(
        project.id,
        trackIds.map((trackId) => ({ trackId, sampleData: [channels] })),
        project.sampleRate,
        activeSelection?.start ?? cursorPosition,
        `Pluck MIDI ${settings.midi}`,
        replacementSelection,
      );
      if (projectLoadGenerationRef.current !== generation) return;
      if (clips.length !== trackIds.length) throw new Error('目标轨道不可用');

      const updated = await projectService.getProject(project.id);
      if (projectLoadGenerationRef.current !== generation) return;
      if (!updated) throw new Error('工程保存后无法重新加载');
      setProject(updated);
      setSelectedTrackId(trackIds[0]!);
      setSelectedClips(clips.map((clip, index) => ({ trackId: trackIds[index]!, clipId: clip.id })));
      pushHistoryCmd({
        id: generateId(),
        label: '生成 Pluck',
        execute: () => updated,
        undo: () => beforeProject,
      });
      rememberLastGeneratorDuration('pluck', settings.duration);
      setPluckDialogOpen(false);
      const trackMessage = trackIds.length > 1 ? `到 ${trackIds.length} 条轨道` : '';
      toast.success(activeSelection
        ? `已将 ${trackIds.length} 条轨道的选区替换为 ${formatTime(settings.duration)} Pluck，后续片段已平移`
        : `已在 ${formatTime(cursorPosition)} ${trackMessage}生成 ${formatTime(settings.duration)} Pluck`);
    } catch (error) {
      if (projectLoadGenerationRef.current !== generation) return;
      const message = error instanceof Error ? error.message : '未知错误';
      toast.error(`生成 Pluck 失败：${message}`);
    } finally {
      setIsGeneratingPluck(false);
    }
  }

  async function handleGenerateRhythm(settings: RhythmTrackRequest) {
    if (!project) return;
    const trackIds = resolveGeneratorTrackIds(project.tracks, selectedTrackId, selectedClips);
    if (trackIds.length === 0) {
      toast.warning('请先添加一个音频轨道');
      return;
    }

    const activeSelection = quantizeSelectionToSamples(selection, project.sampleRate);
    const replacementSelection = activeSelection
      ? { ...activeSelection, allowDurationChange: true }
      : undefined;
    const beforeProject = structuredClone(project);
    const generation = projectLoadGenerationRef.current;
    setIsGeneratingRhythm(true);
    try {
      const randomSeed = new Uint32Array(1);
      globalThis.crypto?.getRandomValues(randomSeed);
      const seed = randomSeed[0] || ((Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0) || 1;
      const result = generateRhythmTrack({ ...settings, sampleRate: project.sampleRate, seed });
      const channels = result.samples;
      const clips = await projectService.addGeneratedAudioToTracks(
        project.id,
        trackIds.map((trackId) => ({ trackId, sampleData: [channels] })),
        project.sampleRate,
        activeSelection?.start ?? cursorPosition,
        `Rhythm ${settings.tempo} BPM`,
        replacementSelection,
      );
      if (projectLoadGenerationRef.current !== generation) return;
      if (clips.length !== trackIds.length) throw new Error('目标轨道不可用');

      const updated = await projectService.getProject(project.id);
      if (projectLoadGenerationRef.current !== generation) return;
      if (!updated) throw new Error('工程保存后无法重新加载');
      setProject(updated);
      setSelectedTrackId(trackIds[0]!);
      setSelectedClips(clips.map((clip, index) => ({ trackId: trackIds[index]!, clipId: clip.id })));
      pushHistoryCmd({
        id: generateId(),
        label: '生成 Rhythm Track',
        execute: () => updated,
        undo: () => beforeProject,
      });
      setRhythmDialogOpen(false);
      const trackMessage = trackIds.length > 1 ? `到 ${trackIds.length} 条轨道` : '';
      toast.success(activeSelection
        ? `已将 ${trackIds.length} 条轨道的选区替换为 ${formatTime(result.duration)} Rhythm Track，后续片段已平移`
        : `已在 ${formatTime(cursorPosition)} ${trackMessage}生成 ${result.barCount} 小节 Rhythm Track`);
    } catch (error) {
      if (projectLoadGenerationRef.current !== generation) return;
      const message = error instanceof Error ? error.message : '未知错误';
      toast.error(`生成 Rhythm Track 失败：${message}`);
    } finally {
      setIsGeneratingRhythm(false);
    }
  }

  async function handleGenerateRisset(settings: RissetDrumRequest) {
    if (!project) return;
    const trackIds = resolveGeneratorTrackIds(project.tracks, selectedTrackId, selectedClips);
    if (trackIds.length === 0) {
      toast.warning('请先添加一个音频轨道');
      return;
    }

    const activeSelection = quantizeSelectionToSamples(selection, project.sampleRate);
    const replacementSelection = activeSelection
      ? { ...activeSelection, allowDurationChange: true }
      : undefined;
    const beforeProject = structuredClone(project);
    const generation = projectLoadGenerationRef.current;
    setIsGeneratingRisset(true);
    try {
      const randomSeed = new Uint32Array(1);
      globalThis.crypto?.getRandomValues(randomSeed);
      const seed = randomSeed[0] || ((Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0) || 1;
      const result = generateRissetDrum({ ...settings, sampleRate: project.sampleRate, seed });
      const clips = await projectService.addGeneratedAudioToTracks(
        project.id,
        trackIds.map((trackId) => ({ trackId, sampleData: [result.samples] })),
        project.sampleRate,
        activeSelection?.start ?? cursorPosition,
        `Risset Drum ${settings.frequency} Hz`,
        replacementSelection,
      );
      if (projectLoadGenerationRef.current !== generation) return;
      if (clips.length !== trackIds.length) throw new Error('目标轨道不可用');

      const updated = await projectService.getProject(project.id);
      if (projectLoadGenerationRef.current !== generation) return;
      if (!updated) throw new Error('工程保存后无法重新加载');
      setProject(updated);
      setSelectedTrackId(trackIds[0]!);
      setSelectedClips(clips.map((clip, index) => ({ trackId: trackIds[index]!, clipId: clip.id })));
      pushHistoryCmd({
        id: generateId(),
        label: '生成 Risset Drum',
        execute: () => updated,
        undo: () => beforeProject,
      });
      setRissetDialogOpen(false);
      const trackMessage = trackIds.length > 1 ? `到 ${trackIds.length} 条轨道` : '';
      toast.success(activeSelection
        ? `已将 ${trackIds.length} 条轨道的选区替换为 ${formatTime(result.duration)} Risset Drum，后续片段已平移`
        : `已在 ${formatTime(cursorPosition)} ${trackMessage}生成 ${formatTime(result.duration)} Risset Drum`);
    } catch (error) {
      if (projectLoadGenerationRef.current !== generation) return;
      const message = error instanceof Error ? error.message : '未知错误';
      toast.error(`生成 Risset Drum 失败：${message}`);
    } finally {
      setIsGeneratingRisset(false);
    }
  }

  async function handleGenerateNoise(settings: NoiseRequest) {

    if (!project) return;
    const trackIds = resolveGeneratorTrackIds(project.tracks, selectedTrackId, selectedClips);
    if (trackIds.length === 0) {
      toast.warning('请先添加一个音频轨道');
      return;
    }

    const activeSelection = quantizeSelectionToSamples(selection, project.sampleRate);
    const beforeProject = structuredClone(project);
    const generation = projectLoadGenerationRef.current;
    setIsGeneratingNoise(true);
    try {
      const duration = activeSelection
        ? activeSelection.end - activeSelection.start
        : settings.duration;
      const randomSeed = new Uint32Array(1);
      globalThis.crypto?.getRandomValues(randomSeed);
      const seed = randomSeed[0] || ((Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0) || 1;
      const clips = await projectService.addGeneratedAudioToTracks(
        project.id,
        trackIds.map((trackId, index) => ({
          trackId,
          sampleData: [generateNoise({
            ...settings,
            duration,
            sampleRate: project.sampleRate,
            seed: ((seed + index) >>> 0) || 1,
          })],
        })),
        project.sampleRate,
        activeSelection?.start ?? cursorPosition,
        `噪声 ${settings.type}`,
        activeSelection ?? undefined,
      );
      if (projectLoadGenerationRef.current !== generation) return;
      if (clips.length !== trackIds.length) throw new Error('目标轨道不可用');

      const updated = await projectService.getProject(project.id);
      if (projectLoadGenerationRef.current !== generation) return;
      if (!updated) throw new Error('工程保存后无法重新加载');
      setProject(updated);
      setSelectedTrackId(trackIds[0]!);
      setSelectedClips(clips.map((clip, index) => ({ trackId: trackIds[index]!, clipId: clip.id })));
      pushHistoryCmd({
        id: generateId(),
        label: '生成噪声',
        execute: () => updated,
        undo: () => beforeProject,
      });
      if (!activeSelection) rememberLastGeneratorDuration('noise', duration);
      setNoiseDialogOpen(false);
      const trackMessage = trackIds.length > 1 ? `到 ${trackIds.length} 条轨道` : '';
      toast.success(activeSelection
        ? `已将 ${trackIds.length} 条轨道的 ${formatTime(activeSelection.start)}–${formatTime(activeSelection.end)} 替换为噪声`
        : `已在 ${formatTime(cursorPosition)} ${trackMessage}生成 ${formatTime(duration)} 噪声`);
    } catch (error) {
      if (projectLoadGenerationRef.current !== generation) return;
      const message = error instanceof Error ? error.message : '未知错误';
      toast.error(`生成噪声失败：${message}`);
    } finally {
      setIsGeneratingNoise(false);
    }
  }

  async function handleGenerateSilence(requestedDuration: number) {
    if (!project) return;
    const trackIds = resolveGeneratorTrackIds(project.tracks, selectedTrackId, selectedClips);
    if (trackIds.length === 0) {
      toast.warning('请先添加一个音频轨道');
      return;
    }

    const activeSelection = quantizeSelectionToSamples(selection, project.sampleRate);
    const beforeProject = structuredClone(project);
    const generation = projectLoadGenerationRef.current;
    setIsGeneratingSilence(true);
    try {
      if (activeSelection) {
        const changedClips = await projectService.silenceSelectionOnTracks(
          project.id,
          trackIds,
          activeSelection,
        );
        if (projectLoadGenerationRef.current !== generation) return;
        if (changedClips === 0) throw new Error('所选轨道的选区未覆盖任何可用音频');

        const updated = await projectService.getProject(project.id);
        if (projectLoadGenerationRef.current !== generation) return;
        if (!updated) throw new Error('工程保存后无法重新加载');
        setProject(updated);
        pushHistoryCmd({
          id: generateId(),
          label: '生成静默',
          execute: () => updated,
          undo: () => beforeProject,
        });
        setSilenceDialogOpen(false);
        toast.success(`已将 ${trackIds.length} 条轨道的 ${formatTime(activeSelection.start)}–${formatTime(activeSelection.end)} 替换为静默`);
        return;
      }

      const channels = generateSilence({
        duration: requestedDuration,
        sampleRate: project.sampleRate,
      });
      const clips = await projectService.addGeneratedAudioToTracks(
        project.id,
        trackIds.map((trackId) => ({ trackId, sampleData: [channels] })),
        project.sampleRate,
        cursorPosition,
        '静默',
      );
      if (projectLoadGenerationRef.current !== generation) return;
      if (clips.length !== trackIds.length) throw new Error('目标轨道不可用');

      const updated = await projectService.getProject(project.id);
      if (projectLoadGenerationRef.current !== generation) return;
      if (!updated) throw new Error('工程保存后无法重新加载');
      setProject(updated);
      setSelectedTrackId(trackIds[0]!);
      setSelectedClips(clips.map((clip, index) => ({ trackId: trackIds[index]!, clipId: clip.id })));
      pushHistoryCmd({
        id: generateId(),
        label: '生成静默',
        execute: () => updated,
        undo: () => beforeProject,
      });
      rememberLastGeneratorDuration('silence', requestedDuration);
      setSilenceDialogOpen(false);
      const trackMessage = trackIds.length > 1 ? `到 ${trackIds.length} 条轨道` : '';
      toast.success(`已在 ${formatTime(cursorPosition)} ${trackMessage}生成 ${formatTime(requestedDuration)} 静默`);
    } catch (error) {
      if (projectLoadGenerationRef.current !== generation) return;
      const message = error instanceof Error ? error.message : '未知错误';
      toast.error(`生成静默失败：${message}`);
    } finally {
      setIsGeneratingSilence(false);
    }
  }

  function handleSampleDataImportDialogChange(open: boolean): void {
    if (!open) {
      sampleDataImportOperationRef.current += 1;
      setIsImportingSampleData(false);
    }
    setSampleDataImportDialogOpen(open);
  }

  async function handleSampleDataImport(
    file: File,
    invalidDataHandling: SampleDataInvalidDataHandling,
  ): Promise<SampleDataImportCompletion> {
    if (!project) throw new Error('工程尚未加载');
    const trackIds = resolveGeneratorTrackIds(project.tracks, selectedTrackId, selectedClips);
    if (trackIds.length === 0) throw new Error('请先添加一个音频轨道');

    const operation = ++sampleDataImportOperationRef.current;
    const beforeProject = structuredClone(project);
    setIsImportingSampleData(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (operation !== sampleDataImportOperationRef.current) throw new Error('导入已取消');

      const targets: { trackId: string; sampleData: Float32Array[] }[] = [];
      let invalidValueCount = 0;
      let paddedRightSample = false;
      for (const trackId of trackIds) {
        const track = project.tracks.find((candidate) => candidate.id === trackId);
        if (!track) throw new Error(`目标轨道不可用：${trackId}`);
        let channelCount: SampleDataImportChannelCount = 1;
        let inspectedClip = false;
        for (const clip of track.clips) {
          const channels = await projectService.loadAudioChannels(clip.audioBufferId);
          if (operation !== sampleDataImportOperationRef.current) throw new Error('导入已取消');
          if (!channels || (channels.length !== 1 && channels.length !== 2)) {
            throw new Error(`无法确定目标轨「${track.name}」的声道布局`);
          }
          if (inspectedClip && channels.length !== channelCount) {
            throw new Error(`目标轨「${track.name}」包含不一致的声道布局，无法导入`);
          }
          channelCount = channels.length;
          inspectedClip = true;
        }

        const parsed = parseSampleDataImport(bytes, { channelCount, invalidDataHandling });
        targets.push({ trackId, sampleData: parsed.channels });
        invalidValueCount += parsed.invalidValueCount;
        paddedRightSample ||= parsed.paddedRightSample;
      }
      if (operation !== sampleDataImportOperationRef.current) throw new Error('导入已取消');

      const activeSelection = quantizeSelectionToSamples(selection, project.sampleRate);
      const replacementSelection = activeSelection
        ? { ...activeSelection, allowDurationChange: true }
        : undefined;
      const clips = await projectService.addGeneratedAudioToTracks(
        project.id,
        targets,
        project.sampleRate,
        activeSelection?.start ?? cursorPosition,
        file.name.replace(/\.[^.]+$/, '') || 'Sample Data Import',
        replacementSelection,
      );
      if (clips.length !== trackIds.length) throw new Error('目标轨道不可用');

      const updated = await projectService.getProject(project.id);
      if (!updated) throw new Error('工程保存后无法重新加载');
      if (operation !== sampleDataImportOperationRef.current) throw new Error('导入已取消');
      setProject(updated);
      setSelectedTrackId(trackIds[0]!);
      setSelectedClips(clips.map((clip, index) => ({ trackId: trackIds[index]!, clipId: clip.id })));
      pushHistoryCmd({
        id: generateId(),
        label: 'Sample Data Import',
        execute: () => updated,
        undo: () => beforeProject,
      });
      toast.success(`已从 ${file.name} 导入到 ${trackIds.length} 条轨道${invalidValueCount > 0 ? `，${invalidValueCount} 个无效值按零读取` : ''}`);
      return { trackCount: trackIds.length, invalidValueCount, paddedRightSample };
    } finally {
      if (operation === sampleDataImportOperationRef.current) setIsImportingSampleData(false);
    }
  }

  // Import audio
  function handleImportClick() {
    fileInputRef.current?.click();
  }

  async function handleFileImport(file: File, targetTrackId?: string) {
    if (!project) return;
    const trackId = targetTrackId ?? selectedTrackId ?? project.tracks[0]?.id;
    if (!trackId) return;
    const beforeProject = structuredClone(project);

    const importPos = cursorPosition;

    const toastId = toast.loading(`正在导入 ${file.name}...`);
    try {
      const clip = await projectService.importAudioToTrack(
        project.id,
        trackId,
        file,
        importPos,
        (progress) => {
          // Could update progress
        },
      );

      if (clip) {
        const updated = await projectService.getProject(project.id);
        if (updated) {
          setProject(updated);
          pushHistoryCmd({
            id: generateId(),
            label: '导入音频',
            execute: () => updated,
            undo: () => beforeProject,
          });
        }
        toast.success(`已导入 ${file.name}`);
      }
    } catch (e) {
      toast.error(`导入失败：${file.name}`);
    } finally {
      toast.dismiss(toastId);
    }
  }

  async function handleFiles(files: FileList | File[]) {
    const fileArray = Array.from(files);
    if (!project || fileArray.length === 0) return;

    // Import first file to selected track, rest to new tracks
    for (let i = 0; i < fileArray.length; i++) {
      let targetTrackId: string | undefined;
      if (i === 0) {
        targetTrackId = selectedTrackId ?? project.tracks[0]?.id;
      } else {
        const newTrack = await projectService.addTrack(project.id);
        targetTrackId = newTrack?.id;
      }
      if (targetTrackId) {
        await handleFileImport(fileArray[i], targetTrackId);
      }
    }

    // Reload
    const updated = await projectService.getProject(project.id);
    if (updated) setProject(updated);
  }

  // Export
  async function handleExport() {
    if (!project) return;
    setIsExporting(true);

    try {
      const duration = getProjectDuration();
      if (duration === 0) {
        toast.warning('没有可导出的音频内容');
        return;
      }

      let blob: Blob;
      let filename = `${project.name}.${exportFormat}`;

      if (exportFormat === 'wav') {
        blob = await audioEngine.exportWav(project.tracks, duration, project.sampleRate, 16);
      } else if (exportFormat === 'wav32') {
        blob = await audioEngine.exportWav(project.tracks, duration, project.sampleRate, 32);
        filename = `${project.name}_32bit.wav`;
      } else if (exportFormat === 'mp3') {
        blob = await audioEngine.exportMp3(project.tracks, duration, project.sampleRate, 128);
      }

      triggerBlobDownload(blob, filename);
      toast.success(`已导出 ${filename}`);
      setExportDialogOpen(false);
    } catch (e) {
      toast.error('导出失败');
    } finally {
      setIsExporting(false);
    }
  }

  // History
  function pushHistoryCmd(cmd: {
    id: string;
    label: string;
    execute: () => IProject;
    undo: () => IProject;
  }, projectBefore?: IProject) {
    // 深拷贝当前 project 作为操作前快照，用于 IndexedDB 持久化
    historyManager.push(cmd, projectBefore ?? project ?? undefined);
    updateHistoryState();
  }

  function updateHistoryState() {
    setCanUndo(historyManager.canUndo());
    setCanRedo(historyManager.canRedo());
  }

  function applyHistoryProject(restoredProject: IProject) {
    const validTrackIds = new Set(restoredProject.tracks.map((track) => track.id));
    const validClipKeys = new Set(restoredProject.tracks.flatMap((track) =>
      track.clips.map((clip) => clipKeyId({ trackId: track.id, clipId: clip.id })),
    ));
    setProject(restoredProject);
    setSelection(restoredProject.selection);
    setCursorPosition(restoredProject.cursorPosition);
    audioEngine.seek(restoredProject.cursorPosition);
    setSpectralSelection(normalizeFrequencySelection(
      restoredProject.spectralSelection,
      restoredProject.sampleRate,
      getTrackSpectrogramSettings(
        restoredProject.tracks.find((track) => track.id === selectedTrackId) ?? restoredProject.tracks[0],
        restoredProject.sampleRate,
      ),
    ));
    setSelectedClips((current) => current.filter((key) => validClipKeys.has(clipKeyId(key))));
    setSelectedTrackId((current) => current && validTrackIds.has(current)
      ? current
      : restoredProject.tracks[0]?.id ?? null);
    setEffectsPanelTrackId((current) => current && !validTrackIds.has(current) ? null : current);
  }

  async function handleUndo() {
    if (!project) return;
    const generation = projectLoadGenerationRef.current;
    const isCurrentAction = () => projectLoadGenerationRef.current === generation;
    try {
      const result = await historyManager.undo(
        project,
        (restoredProject) => projectService.saveProject(restoredProject),
      );
      if (result && isCurrentAction()) {
        await historyManager.flush();
        if (!isCurrentAction()) return;
        applyHistoryProject(result.project);
        toast.info(`撤销：${result.command.label}`);
        updateHistoryState();
      }
    } catch {
      if (!isCurrentAction()) return;
      toast.error('撤销失败，工程和历史未更改');
      updateHistoryState();
    }
  }

  async function handleRedo() {
    if (!project) return;
    const generation = projectLoadGenerationRef.current;
    const isCurrentAction = () => projectLoadGenerationRef.current === generation;
    try {
      const result = await historyManager.redo(
        project,
        (restoredProject) => projectService.saveProject(restoredProject),
      );
      if (result && isCurrentAction()) {
        await historyManager.flush();
        if (!isCurrentAction()) return;
        applyHistoryProject(result.project);
        toast.info(`重做：${result.command.label}`);
        updateHistoryState();
      }
    } catch {
      if (!isCurrentAction()) return;
      toast.error('重做失败，工程和历史未更改');
      updateHistoryState();
    }
  }

  // Clipboard operations
  async function storeSelectionInClipboard(
    proj: IProject,
    start: number,
    end: number,
    trackIds?: ReadonlySet<string>,
  ): Promise<boolean> {
    const clipboardData = await copySelection(proj, start, end, trackIds);
    if (!clipboardData || clipboardData.tracks.length === 0) return false;
    await audioDb.clipboard.put({
      id: 'current',
      data: serializeAudioClipboard(clipboardData),
      createdAt: Date.now(),
    });
    setHasAudioClipboard(true);
    return true;
  }

  async function openSelectionContextMenu(trackId: string, x: number, y: number) {
    if (!selection || selection.end <= selection.start) return;
    setSelectedTrackId(trackId);
    setSelectionContextMenu({ trackId, x, y });
    try {
      const entry = await audioDb.clipboard.get('current');
      setHasAudioClipboard(Boolean(entry));
    } catch {
      setHasAudioClipboard(false);
    }
  }

  async function handleCut(target?: ClipSelectionEditTarget) {
    await handlePreferredSelectionEdit('cut', target);
  }

  async function handleDeleteSelection(target?: ClipSelectionEditTarget) {
    await handlePreferredSelectionEdit('delete', target);
  }

  async function handlePreferredSelectionEdit(
    operation: 'cut' | 'delete',
    target?: ClipSelectionEditTarget,
  ) {
    if (!project || (!selection && !target?.selection) || selectionEditOperation) return;
    if (needsDeleteOnboarding(deletePreferences)) {
      // Audacity's onboarding starts with Leave gap and retains the configured ripple fallback.
      setDeleteOnboarding({
        operation,
        deleteBehavior: 'leave-gap',
        closeGapBehavior: deletePreferences.closeGapBehavior,
        target,
      });
      return;
    }
    await handleSelectionEdit(operation, resolveDeleteRippleMode(deletePreferences), target);
  }

  async function applyDeleteOnboarding() {
    if (!deleteOnboarding) return;
    const pending = deleteOnboarding;
    const next: DeletePreferences = {
      deleteBehavior: pending.deleteBehavior,
      closeGapBehavior: pending.closeGapBehavior,
    };
    if (!saveDeletePreferences(next)) {
      toast.error('浏览器存储不可用，Delete 偏好未保存；未修改音频');
      return;
    }
    setDeletePreferences(next);
    setDeleteOnboarding(null);
    if (pending.target && 'keys' in pending.target) {
      const resolved = resolveDeleteRippleMode(next);
      const mode: MultiClipRippleMode = resolved === 'all-tracks'
        ? 'all-tracks'
        : resolved === 'per-track' ? 'per-track' : 'leave-gap';
      await handleMultiClipSelectionEdit(pending.operation, mode, pending.target.keys);
    } else {
      await handleSelectionEdit(
        pending.operation,
        resolveDeleteRippleMode(next),
        pending.target as ClipSelectionEditTarget | undefined,
      );
    }
    setDeleteFollowupOpen(true);
  }

  async function handleSelectionEdit(
    operation: 'cut' | 'delete',
    mode: SelectionRippleMode,
    target?: ClipSelectionEditTarget,
  ) {
    const activeSelection = target?.selection ?? selection;
    if (!project || !activeSelection || selectionEditOperation) return;
    if (recordingState === 'recording') {
      toast.info('请先停止录音，再编辑选区');
      return;
    }

    const labels: Record<SelectionRippleMode, string> = {
      'leave-gap': `${operation === 'cut' ? 'Cut' : 'Delete'} and leave gap`,
      'per-clip': `${operation === 'cut' ? 'Cut' : 'Delete'} and close gap`,
      'per-track': `${operation === 'cut' ? 'Cut' : 'Delete'} and close gap on this track`,
      'all-tracks': `${operation === 'cut' ? 'Cut' : 'Delete'} and close gap on all tracks`,
    };
    const targetTrackIds = target
      ? mode === 'all-tracks' ? project.tracks.map((track) => track.id) : [target.trackId]
      : mode === 'per-track'
        ? selectedTrackId ? [selectedTrackId] : []
        : project.tracks.map((track) => track.id);
    if (targetTrackIds.length === 0) {
      toast.info('请先选择要编辑的轨道');
      return;
    }

    setSelectionEditOperation(`${operation}:${mode}`);
    try {
      if (operation === 'cut'
        && !await storeSelectionInClipboard(
          project,
          activeSelection.start,
          activeSelection.end,
          new Set(targetTrackIds),
        )) {
        toast.info('选区内没有可剪切的音频');
        return;
      }

      const result = applySelectionEdit(
        project,
        activeSelection.start,
        activeSelection.end,
        mode,
        targetTrackIds,
        generateId,
      );
      if (!result.didChange) {
        toast.info('选区内没有可删除的音频');
        return;
      }

      const committed = await commitClipEdit((latest) => {
        const edited = applySelectionEdit(
          latest,
          activeSelection.start,
          activeSelection.end,
          mode,
          targetTrackIds,
          generateId,
        );
        return edited.didChange
          ? { ...edited.project, selection: null, spectralSelection: null }
          : latest;
      }, labels[mode]);
      if (!committed) return;
      setSelection(null);
      setSpectralSelection(null);
      setSelectedClips([]);
      toast.success(operation === 'cut' ? '已剪切到剪贴板' : '已删除选区');
    } catch (error) {
      logger.error(`${labels[mode]} failed:`, String(error));
      toast.error(operation === 'cut' ? '剪切失败' : '删除失败');
    } finally {
      setSelectionEditOperation(null);
    }
  }

  function renderSelectionEditMenus() {
    const disabled = !selection || selectionEditOperation !== null || recordingState === 'recording';
    return (
      <>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger disabled={disabled} data-testid="selection-cut-menu">
            Cut and…
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem data-testid="selection-cut-leave-gap" onSelect={() => void handleSelectionEdit('cut', 'leave-gap')}>
              Cut and leave gap
            </DropdownMenuItem>
            <DropdownMenuItem data-testid="selection-cut-per-clip" onSelect={() => void handleSelectionEdit('cut', 'per-clip')}>
              Cut and close gap
            </DropdownMenuItem>
            <DropdownMenuItem data-testid="selection-cut-per-track" onSelect={() => void handleSelectionEdit('cut', 'per-track')}>
              Cut and close gap on this track
            </DropdownMenuItem>
            <DropdownMenuItem data-testid="selection-cut-all-tracks" onSelect={() => void handleSelectionEdit('cut', 'all-tracks')}>
              Cut and close gap on all tracks
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger disabled={disabled || !hasAudioClipboard} data-testid="selection-paste-menu">
            Paste and…
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-80">
            <DropdownMenuItem data-testid="selection-paste-overlap" disabled={disabled || !hasAudioClipboard} onSelect={() => void handlePaste('overlap')}>
              Paste and overlap
            </DropdownMenuItem>
            <DropdownMenuItem data-testid="selection-paste-per-track" disabled={disabled || !hasAudioClipboard} onSelect={() => void handlePaste('per-track')}>
              Paste and make room on this track
            </DropdownMenuItem>
            <DropdownMenuItem data-testid="selection-paste-all-tracks" disabled={disabled || !hasAudioClipboard} onSelect={() => void handlePaste('all-tracks')}>
              Paste and make room on all tracks
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger disabled={disabled} data-testid="selection-delete-menu">
            Delete and…
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem data-testid="selection-delete-leave-gap" onSelect={() => void handleSelectionEdit('delete', 'leave-gap')}>
              Delete and leave gap
            </DropdownMenuItem>
            <DropdownMenuItem data-testid="selection-delete-per-clip" onSelect={() => void handleSelectionEdit('delete', 'per-clip')}>
              Delete and close gap
            </DropdownMenuItem>
            <DropdownMenuItem data-testid="selection-delete-per-track" onSelect={() => void handleSelectionEdit('delete', 'per-track')}>
              Delete and close gap on this track
            </DropdownMenuItem>
            <DropdownMenuItem data-testid="selection-delete-all-tracks" onSelect={() => void handleSelectionEdit('delete', 'all-tracks')}>
              Delete and close gap on all tracks
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </>
    );
  }

  async function splitRangeAtBoundaries(target?: ClipSelectionEditTarget) {
    const activeSelection = target?.selection ?? selection;
    if (!project || !activeSelection || selectionUtilityOperation) return;
    if (recordingState === 'recording') {
      toast.info('请先停止录音，再分割选区');
      return;
    }
    setSelectionUtilityOperation('split');
    try {
      const trackIds = target ? [target.trackId] : project.tracks.map((track) => track.id);
      const result = splitRangeSelection(project, activeSelection, trackIds, generateId);
      if (!result.didChange) {
        toast.info('选区边界没有需要分割的 Clip');
        return;
      }
      const committed = await commitClipEdit(
        (latest) => splitRangeSelection(latest, activeSelection, trackIds, generateId).project,
        'Split',
      );
      if (committed) toast.success('已按选区边界分割');
    } catch (error) {
      console.error('Range split failed:', error);
      toast.error('分割选区失败，请重试');
    } finally {
      setSelectionUtilityOperation(null);
    }
  }

  async function splitRangeAtSilences() {
    if (!project || !selection || selectionUtilityOperation) return;
    if (recordingState === 'recording') {
      toast.info('请先停止录音，再按静音分割');
      return;
    }
    setSelectionUtilityOperation('disjoin');
    try {
      const targets = project.tracks.flatMap((track) => track.clips
        .filter((clip) => clip.startTime < selection.end && clip.startTime + clip.duration > selection.start)
        .map((clip) => ({ trackId: track.id, clipId: clip.id, clip })));
      const channelsByClip = new Map<string, Float32Array[]>();
      for (const target of targets) {
        const channels = await projectService.loadAudioChannels(target.clip.audioBufferId, project.sampleRate);
        if (!channels || channels.length === 0) throw new Error(`Missing audio for clip ${target.clipId}`);
        channelsByClip.set(clipKeyId(target), channels);
      }
      let removedRegions = 0;
      const applyDisjoin = (source: IProject): IProject => {
        let next = source;
        let removed = 0;
        for (const target of targets) {
          const result = disjoinClipAtSilences(
            next,
            { trackId: target.trackId, clipId: target.clipId },
            channelsByClip.get(clipKeyId(target))!,
            generateId,
            selection,
          );
          if (result.didChange) {
            next = result.project;
            removed += result.regions.length;
          }
        }
        removedRegions = removed;
        return next;
      };
      if (applyDisjoin(project) === project) {
        toast.info('选区内没有至少 0.01 秒的全声道精确零静音');
        return;
      }
      const committed = await commitClipEdit(applyDisjoin, 'Split at silences');
      if (committed) toast.success(`已删除 ${removedRegions} 段选区内静音`);
    } catch (error) {
      console.error('Range disjoin failed:', error);
      toast.error('按静音分割失败，请重试');
    } finally {
      setSelectionUtilityOperation(null);
    }
  }

  async function joinRangeClips(multiClipKeys?: ClipKey[]) {
    if (!project || (!selection && !multiClipKeys) || selectionUtilityOperation) return;
    if (recordingState === 'recording') {
      toast.info('请先停止录音，再合并 Clip');
      return;
    }
    const multiGroup = multiClipKeys ? planMultiClipJoin(project, multiClipKeys) : null;
    const groups = multiClipKeys
      ? multiGroup ? [multiGroup] : []
      : planRangeJoin(project, selection!, project.tracks.map((track) => track.id));
    if (groups.length === 0) {
      toast.info(multiClipKeys
        ? 'Join 需要同一轨道至少两个选中 Clip，且跨度内不能包含未选 Clip'
        : '每条轨道至少需要两个与选区相交的 Clip 才能 Join');
      return;
    }
    setSelectionUtilityOperation('join');
    try {
      const prepared: Array<{
        trackId: string;
        sourceClipIds: ReadonlySet<string>;
        joinedClip: IClip;
      }> = [];
      const joinedSelection: ClipKey[] = [];
      const sampleRate = project.sampleRate;
      for (const group of groups) {
        const totalSamples = Math.round((group.end - group.start) * sampleRate);
        if (totalSamples <= 0) continue;
        const rendered = [] as Array<{
          clip: IClip;
          effective: NonNullable<Awaited<ReturnType<typeof loadEffectiveClipChannels>>>;
        }>;
        for (const clip of group.clips) {
          const effective = await loadEffectiveClipChannels(clip, sampleRate);
          if (!effective) throw new Error(`Missing audio for clip ${clip.id}`);
          rendered.push({ clip, effective });
        }
        const channelCount = Math.max(1, ...rendered.map(({ effective }) => effective.channels.length));
        const channels = Array.from({ length: channelCount }, () => new Float32Array(totalSamples));
        for (const { clip, effective } of rendered) {
          const destinationStart = Math.round((clip.startTime - group.start) * sampleRate);
          const clipFrames = Math.min(
            Math.max(0, Math.round(clip.duration * sampleRate)),
            Math.max(0, totalSamples - destinationStart),
          );
          const sourceStart = Math.floor(effective.sourceOffset * sampleRate);
          const fadeInFrames = Math.min(clipFrames, Math.round(clip.fadeIn * sampleRate));
          const fadeOutFrames = Math.min(clipFrames, Math.round(clip.fadeOut * sampleRate));
          const clipGain = dbToGain(clip.gain);
          for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
            const source = effective.channels[channelIndex];
            if (!source) continue;
            const destination = channels[channelIndex]!;
            for (let frame = 0; frame < clipFrames; frame += 1) {
              const sourceValue = source[sourceStart + frame] ?? 0;
              let frameGain = clipGain;
              if (fadeInFrames > 0 && frame < fadeInFrames) frameGain *= frame / fadeInFrames;
              if (fadeOutFrames > 0 && frame >= clipFrames - fadeOutFrames) {
                frameGain *= (clipFrames - 1 - frame) / fadeOutFrames;
              }
              destination[destinationStart + frame] = sourceValue * frameGain;
            }
          }
        }
        const audioBufferId = await storeProjectBuffer(project.id, channels, sampleRate);
        const first = group.clips[0]!;
        const joinedClip: IClip = {
          id: generateId(),
          audioBufferId,
          startTime: group.start,
          offset: 0,
          duration: totalSamples / sampleRate,
          originalDuration: totalSamples / sampleRate,
          stretchRatio: 1,
          gain: 0,
          fadeIn: 0,
          fadeOut: 0,
          name: first.name,
          colorIndex: first.colorIndex,
        };
        prepared.push({
          trackId: group.trackId,
          sourceClipIds: new Set(group.clips.map((clip) => clip.id)),
          joinedClip,
        });
        joinedSelection.push({ trackId: group.trackId, clipId: joinedClip.id });
      }
      if (joinedSelection.length === 0) return;
      const committed = await commitClipEdit((latest) => {
        for (const item of prepared) {
          const track = latest.tracks.find((candidate) => candidate.id === item.trackId);
          if (!track || [...item.sourceClipIds].some((id) => !track.clips.some((clip) => clip.id === id))) {
            return latest;
          }
        }
        return {
          ...latest,
          tracks: latest.tracks.map((track) => {
            const trackJoins = prepared.filter((item) => item.trackId === track.id);
            if (trackJoins.length === 0) return track;
            const joinedIds = new Set(trackJoins.flatMap((item) => [...item.sourceClipIds]));
            return {
              ...track,
              clips: [
                ...track.clips.filter((clip) => !joinedIds.has(clip.id)),
                ...trackJoins.map((item) => item.joinedClip),
              ].sort((left, right) => left.startTime - right.startTime || left.id.localeCompare(right.id)),
            };
          }),
        };
      }, 'Join');
      if (!committed) return;
      setSelectedClips(joinedSelection);
      setSelectedTrackId(joinedSelection[0]!.trackId);
      clipSelectionAnchorRef.current = joinedSelection[0]!;
      toast.success(`已合并 ${joinedSelection.length} 条轨道上的 Clip`);
    } catch (error) {
      console.error('Range join failed:', error);
      toast.error('合并 Clip 失败，请重试');
    } finally {
      setSelectionUtilityOperation(null);
    }
  }

  async function handleCopy(target?: ClipSelectionEditTarget) {
    const activeSelection = target?.selection ?? selection;
    if (!project || !activeSelection) return;
    try {
      if (await storeSelectionInClipboard(
        project,
        activeSelection.start,
        activeSelection.end,
        target ? new Set([target.trackId]) : undefined,
      )) {
        toast.success('已复制到剪贴板');
      } else {
        toast.info('选区内没有可复制的音频');
      }
    } catch (error) {
      logger.error('复制失败:', String(error));
      toast.error('复制失败');
    }
  }

  async function handlePaste(mode?: SelectionPasteMode) {
    if (!project || selectionEditOperation || selectionUtilityOperation) return;
    if (recordingState === 'recording') {
      toast.info('请先停止录音，再粘贴');
      return;
    }
    const resolvedMode = mode ?? resolveDefaultPasteMode(pastePreferences);
    try {
      const entry = await audioDb.clipboard.get('current');
      if (!entry) {
        setHasAudioClipboard(false);
        toast.info('剪贴板为空');
        return;
      }
      const clipboardData = parseAudioClipboard(entry.data);
      const labels: Record<SelectionPasteMode, string> = {
        overlap: 'Paste and overlap',
        'per-track': 'Paste and make room on this track',
        'all-tracks': 'Paste and make room on all tracks',
      };
      const committed = await commitClipEdit(async (latest) => {
        // Audacity resolves Paste destinations against the current track list.
        // Keep PCM preparation and destination mutation inside the project write
        // queue so an older editor snapshot cannot overwrite concurrent tracks.
        return await pasteAtCursor(latest, clipboardData, cursorPosition, resolvedMode) ?? latest;
      }, labels[resolvedMode]);
      if (committed) {
        await historyManager.flush();
        updateHistoryState();
        toast.success(labels[resolvedMode]);
      }
    } catch (error) {
      console.error('Paste failed:', error);
      toast.error('粘贴失败');
    }
  }

  async function handleTrim() {
    if (!project || !selection) return;
    const activeSelection = { ...selection };
    const committed = await commitClipEdit(async (latest) => (
      await trimToSelection(latest, activeSelection.start, activeSelection.end) ?? latest
    ), '裁剪');
    if (committed) {
      if (activeSelection.start > 0) setCursorPosition(0);
      updateHistoryState();
      toast.success('已裁剪');
    }
  }

  // Effect operations
  async function handleRepeatSelection(repeatCount: number) {
    if (!project || !quantizedGeneratorSelection) return;
    const generation = projectLoadGenerationRef.current;
    const isCurrentAction = () => projectLoadGenerationRef.current === generation;
    setIsRepeating(true);
    try {
      const activeSelection = quantizedGeneratorSelection;
      const copied = await copySelection(project, activeSelection.start, activeSelection.end);
      if (!isCurrentAction()) return;
      if (!copied || copied.tracks.length === 0) {
        toast.info('选区内没有可重复的音频');
        return;
      }
      const before = JSON.parse(JSON.stringify(project)) as IProject;
      const inserted = await projectService.repeatSelectionOnTracks(
        project.id,
        activeSelection,
        repeatCount,
        copied.tracks.map((track) => ({ trackId: track.trackId, sampleData: track.channels })),
      );
      if (!isCurrentAction()) return;
      const updated = await projectService.getProject(project.id);
      if (!isCurrentAction()) return;
      if (!updated) throw new Error('重复后无法重新读取工程');
      setProject(updated);
      setSelection(updated.selection ?? {
        start: activeSelection.start,
        end: activeSelection.end + (activeSelection.end - activeSelection.start) * repeatCount,
      });
      pushHistoryCmd({
        id: generateId(),
        label: `重复选区 ×${repeatCount}`,
        execute: () => updated,
        undo: () => before,
      });
      updateHistoryState();
      setRepeatDialogOpen(false);
      toast.success(`已插入 ${inserted.length} 个重复片段`);
    } catch (error) {
      if (!isCurrentAction()) return;
      logger.error('重复选区失败:', String(error));
      toast.error(error instanceof Error ? `重复选区失败：${error.message}` : '重复选区失败');
    } finally {
      setIsRepeating(false);
    }
  }

  async function handleDuplicateSelection(target?: ClipSelectionEditTarget) {
    const activeSelection = target
      ? quantizeSelectionToSamples(target.selection, project?.sampleRate ?? 44100)
      : quantizedGeneratorSelection;
    if (!project || !activeSelection) return;
    const generation = projectLoadGenerationRef.current;
    const isCurrentAction = () => projectLoadGenerationRef.current === generation;
    try {
      const copied = await copySelection(
        project,
        activeSelection.start,
        activeSelection.end,
        target ? new Set([target.trackId]) : undefined,
      );
      if (!isCurrentAction()) return;
      if (!copied || copied.tracks.length === 0) {
        toast.info('选区内没有可复制的音频');
        return;
      }
      const before = JSON.parse(JSON.stringify(project)) as IProject;
      const inserted = await projectService.duplicateSelectionToTracks(
        project.id,
        activeSelection,
        copied.tracks.map((track) => ({ trackId: track.trackId, sampleData: track.channels })),
      );
      if (!isCurrentAction()) return;
      const updated = await projectService.getProject(project.id);
      if (!isCurrentAction()) return;
      if (!updated) throw new Error('复制后无法重新读取工程');
      setProject(updated);
      setSelection(updated.selection ?? activeSelection);
      pushHistoryCmd({
        id: generateId(),
        label: 'Duplicate 复制',
        execute: () => updated,
        undo: () => before,
      });
      updateHistoryState();
      toast.success(`已在 ${inserted.length} 条新轨道复制选区`);
    } catch (error) {
      if (!isCurrentAction()) return;
      logger.error('Duplicate 选区失败:', String(error));
      toast.error(error instanceof Error ? `Duplicate 失败：${error.message}` : 'Duplicate 失败');
    }
  }

  async function runClipContextEditCommand(
    trackId: string,
    clipId: string,
    command: ClipContextEditCommand,
  ) {
    if (!project || recordingState === 'recording'
      || renderingPitchAndSpeedClipId || splittingSilenceClipId) return;

    const key = { trackId, clipId };
    selectClip(trackId, clipId, 'replace');

    // Audacity's global Split uses selection boundaries when present, and the
    // playback position otherwise. The Clip menu supplies the selected track.
    if (command === 'split') {
      if (selection && selection.end > selection.start) {
        await splitRangeAtBoundaries({ trackId, selection });
      } else {
        await splitClipsAtCursor([key]);
      }
      return;
    }

    const clip = project.tracks.find((track) => track.id === trackId)
      ?.clips.find((candidate) => candidate.id === clipId);
    if (!clip) return;
    const target: ClipSelectionEditTarget = {
      trackId,
      selection: { start: clip.startTime, end: clip.startTime + clip.duration },
    };
    // Keep the visible editor state aligned with the explicit synchronous target.
    // Handlers receive `target` directly so they cannot observe stale React state.
    setSelection(target.selection);

    if (typeof command === 'string') {
      if (command === 'cut') await handleCut(target);
      else if (command === 'copy') await handleCopy(target);
      else if (command === 'duplicate') await handleDuplicateSelection(target);
      else if (command === 'delete') await handleDeleteSelection(target);
      return;
    }
    await handleSelectionEdit(command.operation, command.mode, target);
  }

  async function storeMultiClipSelectionInClipboard(keys: ClipKey[]): Promise<boolean> {
    if (!project) return false;
    const plan = planMultiClipSelection(project, keys);
    if (!plan) return false;
    const tracks: AudioClipboardTrack[] = [];
    for (const group of plan.tracks) {
      const segments: NonNullable<AudioClipboardTrack['segments']> = [];
      for (const clip of group.clips) {
        const copied = await copySelection(
          project,
          clip.startTime,
          clip.startTime + clip.duration,
          new Set([group.trackId]),
        );
        const channels = copied?.tracks.find((track) => track.trackId === group.trackId)?.channels;
        if (!channels || channels.length === 0) throw new Error(`无法读取 Clip「${clip.name}」的音频`);
        segments.push({
          startTime: clip.startTime - plan.start,
          duration: clip.duration,
          channels,
          name: clip.name,
        });
      }
      if (segments.length > 0) {
        tracks.push({ trackId: group.trackId, startTime: 0, channels: [], segments });
      }
    }
    if (tracks.length === 0) return false;
    await audioDb.clipboard.put({
      id: 'current',
      data: serializeAudioClipboard({
        tracks,
        sampleRate: project.sampleRate,
        duration: plan.end - plan.start,
      }),
      createdAt: Date.now(),
    });
    setHasAudioClipboard(true);
    return true;
  }

  async function handleMultiClipCopy(keys: ClipKey[]) {
    if (!project || selectionEditOperation || recordingState === 'recording') return;
    setSelectionEditOperation('copy:multi-clip');
    try {
      if (await storeMultiClipSelectionInClipboard(keys)) toast.success('已按选中 Clip 复制（保留间隙与边界）');
    } catch (error) {
      logger.error('多 Clip Copy 失败:', String(error));
      toast.error(error instanceof Error ? `Copy 失败：${error.message}` : 'Copy 失败');
    } finally {
      setSelectionEditOperation(null);
    }
  }

  async function handleMultiClipSelectionEdit(
    operation: 'cut' | 'delete',
    mode: MultiClipRippleMode,
    keys: ClipKey[],
  ) {
    if (!project || selectionEditOperation || recordingState === 'recording') return;
    const plan = planMultiClipSelection(project, keys);
    if (!plan) return;
    if (mode === 'all-tracks') {
      await handleSelectionEdit(operation, 'all-tracks', {
        trackId: plan.tracks[0]!.trackId,
        selection: { start: plan.start, end: plan.end },
      });
      return;
    }

    setSelectionEditOperation(`${operation}:multi-clip:${mode}`);
    try {
      if (operation === 'cut') await storeMultiClipSelectionInClipboard(keys);
      if (!removeMultiClipSelection(project, keys, mode === 'per-track')) return;
      const label = `${operation === 'cut' ? 'Cut' : 'Delete'} ${mode === 'per-track' ? 'and close gap on this track' : 'and leave gap'}`;
      const committed = await commitClipEdit(
        (latest) => removeMultiClipSelection(latest, keys, mode === 'per-track') ?? latest,
        label,
      );
      if (!committed) return;
      setSelectedClips([]);
      toast.success(`${operation === 'cut' ? 'Cut' : 'Delete'} 已仅作用于选中 Clip`);
    } catch (error) {
      logger.error(`多 Clip ${operation} 失败:`, String(error));
      toast.error(error instanceof Error ? `${operation === 'cut' ? 'Cut' : 'Delete'} 失败：${error.message}` : '编辑失败');
    } finally {
      setSelectionEditOperation(null);
    }
  }

  async function handlePreferredMultiClipSelectionEdit(
    operation: 'cut' | 'delete',
    keys: ClipKey[],
  ) {
    if (!project || selectionEditOperation || recordingState === 'recording') return;
    if (needsDeleteOnboarding(deletePreferences)) {
      setDeleteOnboarding({
        operation,
        deleteBehavior: 'leave-gap',
        closeGapBehavior: deletePreferences.closeGapBehavior,
        target: { keys },
      });
      return;
    }
    const resolved = resolveDeleteRippleMode(deletePreferences);
    const mode: MultiClipRippleMode = resolved === 'all-tracks'
      ? 'all-tracks'
      : resolved === 'per-track' ? 'per-track' : 'leave-gap';
    await handleMultiClipSelectionEdit(operation, mode, keys);
  }

  async function runMultiClipContextEditCommand(
    trackId: string,
    clipId: string,
    command: MultiClipContextEditCommand,
  ) {
    if (!project || recordingState === 'recording'
      || selectionEditOperation || selectionUtilityOperation
      || renderingPitchAndSpeedClipId || splittingSilenceClipId) return;
    const keys = keysForClip(trackId, clipId);
    if (keys.length < 2) return;
    if (command === 'group' || command === 'ungroup') {
      const updated = command === 'group'
        ? applyClipGrouping(project, keys)
        : applyClipUngrouping(project, keys);
      if (!updated) return;
      const committed = await commitClipEdit((latest) => {
        const edited = command === 'group'
          ? applyClipGrouping(latest, keys)
          : applyClipUngrouping(latest, keys);
        return edited ?? latest;
      }, command === 'group' ? 'Group clips' : 'Ungroup clips');
      if (committed) toast.success(command === 'group' ? '已分组选中 Clip' : '已取消选中 Clip 的分组');
      return;
    }
    if (command === 'join') {
      await joinRangeClips(keys);
      return;
    }
    if (command === 'copy') {
      await handleMultiClipCopy(keys);
      return;
    }
    if (command === 'cut' || command === 'delete') {
      await handlePreferredMultiClipSelectionEdit(command, keys);
      return;
    }
    await handleMultiClipSelectionEdit(command.operation, command.mode, keys);
  }

  async function handleCrossfadePreview(settings: CrossfadeSettings) {
    if (!project || !quantizedGeneratorSelection) throw new Error('请先选择要试听的音频');
    const targets = await collectEffectTargets(quantizedGeneratorSelection);
    const target = targets[0];
    if (!target) throw new Error('选区内没有可试听的音频');
    const firstClip = target.clips[0];
    if (!firstClip) throw new Error('试听片段不可用');
    return processCrossfadeChannels(firstClip.sampleData, 'out', settings);
  }

  async function handleCrossfade(settings: CrossfadeSettings) {
    if (!project || !quantizedGeneratorSelection) return;
    const activeSelection = quantizedGeneratorSelection;
    setIsApplyingCrossfade(true);
    const loadGeneration = projectLoadGenerationRef.current;
    try {
      const targets = await collectEffectTargets(activeSelection);
      if (loadGeneration !== projectLoadGenerationRef.current) return;
      if (targets.length < 2) {
        toast.info('Crossfade Tracks 至少需要两条选区内轨道');
        return;
      }
      const before = JSON.parse(JSON.stringify(project)) as IProject;
      const changed = await projectService.crossfadeSelectionOnTracks(
        project.id,
        activeSelection,
        settings,
        targets,
      );
      if (loadGeneration !== projectLoadGenerationRef.current) return;
      const updated = await projectService.getProject(project.id);
      if (loadGeneration !== projectLoadGenerationRef.current) return;
      if (!updated) throw new Error('Crossfade 后无法重新读取工程');
      setProject(updated);
      setSelection(updated.selection ?? activeSelection);
      pushHistoryCmd({
        id: generateId(),
        label: 'Crossfade Tracks 交叉淡化',
        execute: () => updated,
        undo: () => before,
      });
      updateHistoryState();
      setCrossfadeDialogOpen(false);
      toast.success(`已在 ${changed} 个片段应用交叉淡化`);
    } catch (error) {
      if (loadGeneration !== projectLoadGenerationRef.current) return;
      logger.error('Crossfade 失败:', String(error));
      toast.error(error instanceof Error ? `Crossfade 失败：${error.message}` : 'Crossfade 失败');
    } finally {
      setIsApplyingCrossfade(false);
    }
  }

  async function handleCrossfadeClips() {
    if (!project || !quantizedGeneratorSelection) return;
    const activeSelection = quantizedGeneratorSelection;
    setIsApplyingCrossfadeClips(true);
    const loadGeneration = projectLoadGenerationRef.current;
    try {
      const targets = await collectEffectTargets(activeSelection);
      if (loadGeneration !== projectLoadGenerationRef.current) return;
      if (targets.length !== 1) {
        toast.info('Crossfade Clips 只能应用于一条轨道');
        return;
      }
      const target = targets[0];
      if (!target || target.clips.length < 1 || target.clips.length > 2) {
        toast.info('Crossfade Clips 选区必须包含一个或两个片段');
        return;
      }
      const before = JSON.parse(JSON.stringify(project)) as IProject;
      const changed = await projectService.crossfadeClipsSelection(
        project.id,
        activeSelection,
        target,
      );
      if (loadGeneration !== projectLoadGenerationRef.current) return;
      const updated = await projectService.getProject(project.id);
      if (loadGeneration !== projectLoadGenerationRef.current) return;
      if (!updated) throw new Error('Crossfade Clips 后无法重新读取工程');
      setProject(updated);
      setSelection(updated.selection ?? activeSelection);
      pushHistoryCmd({
        id: generateId(),
        label: 'Crossfade Clips 片段交叉淡化',
        execute: () => updated,
        undo: () => before,
      });
      updateHistoryState();
      toast.success(`已合并并交叉淡化 ${changed} 个选区`);
    } catch (error) {
      if (loadGeneration !== projectLoadGenerationRef.current) return;
      logger.error('Crossfade Clips 失败:', String(error));
      toast.error(error instanceof Error ? `Crossfade Clips 失败：${error.message}` : 'Crossfade Clips 失败');
    } finally {
      setIsApplyingCrossfadeClips(false);
    }
  }

  async function handleStudioFadeOut() {
    if (!project || !quantizedGeneratorSelection) return;
    const activeSelection = quantizedGeneratorSelection;
    setIsApplyingStudioFadeOut(true);
    const loadGeneration = projectLoadGenerationRef.current;
    try {
      const targets = await collectEffectTargets(activeSelection);
      if (loadGeneration !== projectLoadGenerationRef.current) return;
      if (targets.length === 0) {
        toast.info('选区内没有可处理的音频');
        return;
      }
      const before = JSON.parse(JSON.stringify(project)) as IProject;
      const changed = await projectService.studioFadeOutSelectionOnTracks(
        project.id,
        activeSelection,
        targets,
      );
      if (loadGeneration !== projectLoadGenerationRef.current) return;
      const updated = await projectService.getProject(project.id);
      if (loadGeneration !== projectLoadGenerationRef.current) return;
      if (!updated) throw new Error('Studio Fade Out 后无法重新读取工程');
      setProject(updated);
      pushHistoryCmd({
        id: generateId(),
        label: 'Studio Fade Out 工作室淡出',
        execute: () => updated,
        undo: () => before,
      });
      updateHistoryState();
      toast.success(`已对 ${changed} 个片段应用 Studio Fade Out`);
    } catch (error) {
      if (loadGeneration !== projectLoadGenerationRef.current) return;
      logger.error('Studio Fade Out 失败:', String(error));
      toast.error(error instanceof Error ? `Studio Fade Out 失败：${error.message}` : 'Studio Fade Out 失败');
    } finally {
      setIsApplyingStudioFadeOut(false);
    }
  }

  async function loadPlotSpectrumAudio(): Promise<PlotSpectrumAudio> {
    if (!project || !quantizedGeneratorSelection) throw new Error('请先选择要分析的音频');
    const activeSelection = quantizedGeneratorSelection;
    const trackIds = new Set(resolveGeneratorTrackIds(project.tracks, selectedTrackId, selectedClips));
    const segments: PlotSpectrumSegment[] = [];
    for (const track of project.tracks) {
      if (!trackIds.has(track.id)) continue;
      const clips: PlotSpectrumSegment['clips'][number][] = [];
      for (const clip of [...track.clips].sort((left, right) => left.startTime - right.startTime)) {
        if (activeSelection.end <= clip.startTime || activeSelection.start >= clip.startTime + clip.duration) continue;
        const effective = await loadEffectiveClipChannels(clip, project.sampleRate);
        if (!effective) throw new Error(`片段“${clip.name ?? clip.id}”的音频不可用`);
        clips.push({
          clipId: clip.id,
          startTime: clip.startTime,
          duration: clip.duration,
          sourceOffset: effective.sourceOffset,
          channels: effective.channels,
        });
      }
      if (clips.length > 0) segments.push({ trackId: track.id, clips });
    }
    return mixPlotSpectrumSegments(segments, activeSelection, project.sampleRate);
  }

  async function measureContrastAudio(): Promise<ContrastMeasurement> {
    if (!project || !quantizedGeneratorSelection) throw new Error('请先选择要测量的音频');
    const activeSelection = quantizedGeneratorSelection;
    const trackIds = resolveGeneratorTrackIds(project.tracks, selectedTrackId, selectedClips);
    if (trackIds.length !== 1) throw new Error('一次只能测量一条音频轨道');
    const track = project.tracks.find(({ id }) => id === trackIds[0]);
    if (!track) throw new Error('请选择一条音频轨道');
    const clips: ContrastClip[] = [];
    for (const clip of [...track.clips].sort((left, right) => left.startTime - right.startTime)) {
      if (activeSelection.end <= clip.startTime || activeSelection.start >= clip.startTime + clip.duration) continue;
      const effective = await loadEffectiveClipChannels(clip, project.sampleRate);
      if (!effective) throw new Error(`片段“${clip.name ?? clip.id}”的音频不可用`);
      clips.push({
        clipId: clip.id,
        startTime: clip.startTime,
        duration: clip.duration,
        sourceOffset: effective.sourceOffset,
        channels: effective.channels,
      });
    }
    return measureContrastPcm(clips, activeSelection, project.sampleRate);
  }

  function handleMeasureRmsDialogChange(open: boolean): void {
    if (!open) {
      measureRmsOperationRef.current += 1;
      setIsMeasuringRms(false);
    }
    setMeasureRmsDialogOpen(open);
  }

  async function openMeasureRms(): Promise<void> {
    if (!project || !quantizedGeneratorSelection) return;
    const operation = ++measureRmsOperationRef.current;
    setMeasureRmsDialogOpen(true);
    setIsMeasuringRms(true);
    setMeasureRmsResults([]);
    setMeasureRmsError(null);
    try {
      const activeSelection = quantizedGeneratorSelection;
      const trackIds = new Set(resolveGeneratorTrackIds(project.tracks, selectedTrackId, selectedClips));
      const results: MeasureRmsTrackResult[] = [];
      for (const track of project.tracks) {
        if (!trackIds.has(track.id)) continue;
        const clips: MeasureRmsClip[] = [];
        for (const clip of [...track.clips].sort((left, right) => left.startTime - right.startTime)) {
          if (activeSelection.end <= clip.startTime || activeSelection.start >= clip.startTime + clip.duration) continue;
          const effective = await loadEffectiveClipChannels(clip, project.sampleRate);
          if (operation !== measureRmsOperationRef.current) return;
          if (!effective) throw new Error(`片段“${clip.name ?? clip.id}”的音频不可用`);
          clips.push({
            clipId: clip.id,
            startTime: clip.startTime,
            duration: clip.duration,
            sourceOffset: effective.sourceOffset,
            channels: effective.channels,
          });
        }
        results.push({
          trackId: track.id,
          trackName: track.name,
          measurement: measureRmsSelection(clips, activeSelection, project.sampleRate),
        });
      }
      if (results.length === 0) throw new Error('没有可测量的目标音频轨道');
      if (operation === measureRmsOperationRef.current) setMeasureRmsResults(results);
    } catch (reason: unknown) {
      if (operation === measureRmsOperationRef.current) {
        setMeasureRmsError(reason instanceof Error ? reason.message : '无法测量当前选区');
      }
    } finally {
      if (operation === measureRmsOperationRef.current) setIsMeasuringRms(false);
    }
  }

  function handleSampleDataExportDialogChange(open: boolean): void {
    if (!open) {
      sampleDataExportOperationRef.current += 1;
      setIsExportingSampleData(false);
    }
    setSampleDataExportDialogOpen(open);
  }

  async function handleSampleDataExport(settings: SampleDataExportSettings): Promise<SampleDataExportFile> {
    if (!project || !quantizedGeneratorSelection) throw new Error('请先选择要导出的音频');
    const operation = ++sampleDataExportOperationRef.current;
    setIsExportingSampleData(true);
    try {
      const activeSelection = quantizedGeneratorSelection;
      const trackIds = resolveGeneratorTrackIds(project.tracks, selectedTrackId, selectedClips);
      if (trackIds.length !== 1) {
        throw new Error(trackIds.length === 0 ? '没有可导出的目标音频轨道' : 'Sample Data Export 一次仅支持一条目标音轨，请只选择一条轨道');
      }
      const track = project.tracks.find((candidate) => candidate.id === trackIds[0]);
      if (!track) throw new Error('目标音轨不可用');
      const clips: SampleDataClip[] = [];
      for (const clip of [...track.clips].sort((left, right) => left.startTime - right.startTime)) {
        if (activeSelection.end <= clip.startTime || activeSelection.start >= clip.startTime + clip.duration) continue;
        const effective = await loadEffectiveClipChannels(clip, project.sampleRate);
        if (operation !== sampleDataExportOperationRef.current) throw new Error('导出已取消');
        if (!effective) throw new Error(`片段“${clip.name ?? clip.id}”的音频不可用`);
        clips.push({
          clipId: clip.id,
          startTime: clip.startTime,
          duration: clip.duration,
          sourceOffset: effective.sourceOffset,
          channels: effective.channels,
        });
      }
      const file = serializeSampleDataExport({
        clips,
        selection: activeSelection,
        sampleRate: project.sampleRate,
        settings,
      });
      if (operation !== sampleDataExportOperationRef.current) throw new Error('导出已取消');
      const blob = new Blob([file.content], { type: file.mimeType });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = file.filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      return file;
    } finally {
      if (operation === sampleDataExportOperationRef.current) setIsExportingSampleData(false);
    }
  }

  async function handleFindClipping(settings: FindClippingSettings): Promise<void> {
    if (!project || !quantizedGeneratorSelection) throw new Error('请先选择要分析的音频');
    setIsFindingClipping(true);
    try {
      const activeSelection = quantizedGeneratorSelection;
      const trackIds = new Set(resolveGeneratorTrackIds(project.tracks, selectedTrackId, selectedClips));
      const tracks: FindClippingTrack[] = [];
      for (const track of project.tracks) {
        if (!trackIds.has(track.id)) continue;
        const clips: FindClippingTrack['clips'][number][] = [];
        for (const clip of [...track.clips].sort((left, right) => left.startTime - right.startTime)) {
          if (activeSelection.end <= clip.startTime || activeSelection.start >= clip.startTime + clip.duration) continue;
          const effective = await loadEffectiveClipChannels(clip, project.sampleRate);
          if (!effective) throw new Error(`片段“${clip.name ?? clip.id}”的音频不可用`);
          clips.push({
            clipId: clip.id,
            startTime: clip.startTime,
            duration: clip.duration,
            sourceOffset: effective.sourceOffset,
            channels: effective.channels,
          });
        }
        if (clips.length > 0) tracks.push({ trackId: track.id, clips });
      }
      const detected = analyzeFindClippingTracks(tracks, activeSelection, project.sampleRate, settings);
      if (detected.length === 0) {
        toast.info('当前选区没有符合阈值的削波');
        setFindClippingDialogOpen(false);
        return;
      }
      const created: IAnalysisLabel[] = detected.map((label) => ({
        ...label,
        id: generateId(),
        kind: 'clipping',
      }));
      const committed = await commitClipEdit((latest) => ({
        ...appendAnalysisLabels(latest, created, generateId),
        updatedAt: Date.now(),
      }), `Find Clipping 查找削波（${created.length} 个标签）`);
      if (!committed) return;
      toast.success(`已创建 ${created.length} 个 Clipping 标签`);
      setFindClippingDialogOpen(false);
    } finally {
      setIsFindingClipping(false);
    }
  }

  async function handleLabelSounds(settings: LabelSoundsSettings): Promise<void> {
    if (!project || !quantizedGeneratorSelection) throw new Error('请先选择要分析的音频');
    setIsLabelingSounds(true);
    try {
      const activeSelection = quantizedGeneratorSelection;
      const trackIds = new Set(resolveGeneratorTrackIds(project.tracks, selectedTrackId, selectedClips));
      const tracks: LabelSoundsTrack[] = [];
      for (const track of project.tracks) {
        if (!trackIds.has(track.id)) continue;
        const clips: LabelSoundsTrack['clips'][number][] = [];
        for (const clip of [...track.clips].sort((left, right) => left.startTime - right.startTime)) {
          if (activeSelection.end <= clip.startTime || activeSelection.start >= clip.startTime + clip.duration) continue;
          const effective = await loadEffectiveClipChannels(clip, project.sampleRate);
          if (!effective) throw new Error(`片段“${clip.name ?? clip.id}”的音频不可用`);
          clips.push({
            clipId: clip.id,
            startTime: clip.startTime,
            duration: clip.duration,
            sourceOffset: effective.sourceOffset,
            channels: effective.channels,
          });
        }
        if (clips.length > 0) tracks.push({ trackId: track.id, clips });
      }
      const detected = analyzeLabelSoundsTracks(tracks, activeSelection, project.sampleRate, settings);
      if (detected.length === 0) {
        toast.info('No sounds found. Try lowering Threshold level (dB).');
        setLabelSoundsDialogOpen(false);
        return;
      }
      const created: IAnalysisLabel[] = detected.map((label) => ({
        ...label,
        id: generateId(),
        kind: 'manual',
      }));
      const committed = await commitClipEdit((latest) => ({
        ...appendAnalysisLabels(latest, created, generateId),
        updatedAt: Date.now(),
      }), `Label sounds 标记声音（${created.length} 个标签）`);
      if (!committed) return;
      toast.success(`已创建 ${created.length} 个声音标签`);
      setLabelSoundsDialogOpen(false);
    } finally {
      setIsLabelingSounds(false);
    }
  }

  async function handleBeatFinder(settings: BeatFinderSettings): Promise<void> {
    if (!project || !quantizedGeneratorSelection) throw new Error('请先选择要分析的音频');
    setIsFindingBeats(true);
    try {
      const activeSelection = quantizedGeneratorSelection;
      const trackIds = new Set(resolveGeneratorTrackIds(project.tracks, selectedTrackId, selectedClips));
      const tracks: BeatFinderTrack[] = [];
      for (const track of project.tracks) {
        if (!trackIds.has(track.id)) continue;
        const clips: BeatFinderTrack['clips'][number][] = [];
        for (const clip of [...track.clips].sort((left, right) => left.startTime - right.startTime)) {
          if (activeSelection.end <= clip.startTime || activeSelection.start >= clip.startTime + clip.duration) continue;
          const effective = await loadEffectiveClipChannels(clip, project.sampleRate);
          if (!effective) throw new Error(`片段“${clip.name ?? clip.id}”的音频不可用`);
          clips.push({
            clipId: clip.id,
            startTime: clip.startTime,
            duration: clip.duration,
            sourceOffset: effective.sourceOffset,
            channels: effective.channels,
          });
        }
        if (clips.length > 0) tracks.push({ trackId: track.id, clips });
      }
      const detected = analyzeBeatFinderTracks(tracks, activeSelection, project.sampleRate, settings);
      if (detected.length === 0) {
        toast.info('No beats found. Try lowering Threshold Percentage.');
        setBeatFinderDialogOpen(false);
        return;
      }
      const created: IAnalysisLabel[] = detected.map((label) => ({
        ...label,
        id: generateId(),
        kind: 'manual',
      }));
      const committed = await commitClipEdit((latest) => ({
        ...appendAnalysisLabels(latest, created, generateId),
        updatedAt: Date.now(),
      }), `Beat finder 节拍查找（${created.length} 个标签）`);
      if (!committed) return;
      toast.success(`已创建 ${created.length} 个节拍标签`);
      setBeatFinderDialogOpen(false);
    } finally {
      setIsFindingBeats(false);
    }
  }

  async function handleRegularIntervalLabels(settings: RegularIntervalLabelsSettings): Promise<void> {
    if (!project || !quantizedGeneratorSelection) throw new Error('请先选择要创建标签的音频选区');
    setIsCreatingRegularIntervalLabels(true);
    try {
      const result = createRegularIntervalLabels(quantizedGeneratorSelection, settings);
      if (result.labels.length === 0) {
        if (result.completion) toast.error(result.completion.message);
        setRegularIntervalLabelsDialogOpen(false);
        return;
      }
      const trackIds = new Set(resolveGeneratorTrackIds(project.tracks, selectedTrackId, selectedClips));
      const targetTrack = project.tracks.filter((track) => trackIds.has(track.id)).at(-1);
      if (!targetTrack) throw new Error('没有可接收标签的目标轨道');
      const created: IAnalysisLabel[] = result.labels.map((label) => ({
        ...label,
        id: generateId(),
        kind: 'manual',
        trackId: targetTrack.id,
      }));
      const committed = await commitClipEdit((latest) => {
        if (!latest.tracks.some((track) => track.id === targetTrack.id)) {
          throw new Error('目标轨道已不存在，未创建标签');
        }
        return {
          ...appendAnalysisLabels(latest, created, generateId),
          updatedAt: Date.now(),
        };
      }, `Regular interval labels 等间隔标签（${created.length} 个标签）`);
      if (!committed) return;
      setRegularIntervalLabelsDialogOpen(false);
      if (result.completion?.type === 'warning') toast.warning(result.completion.message);
      else if (result.completion?.type === 'success') toast.success(result.completion.message);
    } finally {
      setIsCreatingRegularIntervalLabels(false);
    }
  }

  function handleAnalysisLabelSelect(label: IAnalysisLabel): void {
    const nextSelection = label.end > label.start ? { start: label.start, end: label.end } : null;
    setSelectedTrackId(label.trackId);
    setSelection(nextSelection);
    setSpectralSelection(null);
    setProject((current) => current ? { ...current, selection: nextSelection, spectralSelection: null } : current);
    handleCursorChange(label.start);
  }

  async function handleImportLabels(file: File): Promise<IAnalysisLabel[]> {
    if (!project) throw new Error('没有打开的工程');
    setIsApplyingLabels(true);
    try {
      const parsed = parseLabelsForImport(await file.text(), file.name);
      const targetTrackId = project.tracks.some((track) => track.id === selectedTrackId)
        ? selectedTrackId!
        : project.tracks[0]?.id ?? '';
      let imported: ReturnType<typeof importLabelsAsNewTrack> | null = null;
      const committed = await commitClipEdit((latest) => {
        imported = importLabelsAsNewTrack(latest, parsed.labels, targetTrackId, generateId);
        return { ...imported.project, updatedAt: Date.now() };
      }, `Import labels 导入标签（${parsed.labels.length} 个标签）`);
      if (!committed || !imported) throw new Error('Import labels 未保存');
      const importedLabels = imported.labels;
      if (parsed.rejectedCount > 0) {
        toast.warning(`One or more saved labels could not be read. 已跳过 ${parsed.rejectedCount} 条无法读取的标签`);
      } else {
        toast.success(`已导入 ${importedLabels.length} 个标签并创建 Label Track`);
      }
      return importedLabels;
    } finally {
      setIsApplyingLabels(false);
    }
  }

  async function handleEditLabels(labels: IAnalysisLabel[]): Promise<void> {
    if (!project) return;
    if (JSON.stringify(labels) === JSON.stringify(project.analysisLabels ?? [])) {
      setLabelEditorDialogOpen(false);
      return;
    }
    setIsApplyingLabels(true);
    try {
      const committed = await commitClipEdit((latest) => ({
        ...replaceAnalysisLabels(latest, labels, generateId),
        updatedAt: Date.now(),
      }), `Edit Labels 编辑标签（${labels.length} 个标签）`);
      if (!committed) return;
      setLabelEditorDialogOpen(false);
      toast.success(`已保存 ${labels.length} 个标签`);
    } finally {
      setIsApplyingLabels(false);
    }
  }

  async function commitLabelTrackEdit(
    edit: (latest: IProject) => IProject,
    historyLabel: string,
  ): Promise<void> {
    if (!project) return;
    await commitClipEdit((latest) => {
      const edited = edit(latest);
      return edited === latest ? latest : { ...edited, updatedAt: Date.now() };
    }, historyLabel);
  }

  async function handleRenameLabelTrack(trackId: string, name: string): Promise<void> {
    if (!project) return;
    await commitLabelTrackEdit((latest) => renameLabelTrack(latest, trackId, name), 'Rename label track');
  }

  async function handleDuplicateLabelTrack(trackId: string): Promise<void> {
    if (!project) return;
    await commitLabelTrackEdit(
      (latest) => duplicateLabelTrack(latest, trackId, generateId),
      'Duplicate label track',
    );
  }

  async function handleDeleteLabelTrack(trackId: string): Promise<void> {
    if (!project) return;
    await commitLabelTrackEdit((latest) => deleteLabelTrack(latest, trackId), 'Delete label track');
  }

  async function handleMoveLabelTrack(trackId: string, direction: TrackMoveDirection): Promise<void> {
    if (!project) return;
    await commitLabelTrackEdit(
      (latest) => moveLabelTrack(latest, trackId, direction),
      'Move label track',
    );
  }

  async function handleLabelTrackColorChange(trackId: string, colorIndex: number): Promise<void> {
    if (!project) return;
    await commitLabelTrackEdit(
      (latest) => setLabelTrackColor(latest, trackId, colorIndex),
      'Change label track color',
    );
  }

  function handleExportLabels(request: LabelExportRequest): void {
    if (!project) return;
    const content = serializeLabelsForExport(project, request.trackIds, request.fileType);
    const mimeType = request.fileType === 'vtt'
      ? 'text/vtt;charset=utf-8'
      : request.fileType === 'srt' ? 'application/x-subrip;charset=utf-8' : 'text/plain;charset=utf-8';
    triggerBlobDownload(
      new Blob([content], { type: mimeType }),
      `${request.fileName}.${request.fileType}`,
    );
    toast.success(`已导出 ${request.trackIds.length} 条 Label Track`);
  }

  async function collectEffectTargets(activeSelection: { start: number; end: number }): Promise<EchoTrackAudio[]> {
    if (!project) return [];
    const targets: EchoTrackAudio[] = [];
    for (const track of project.tracks) {
      const clips: EchoTrackAudio['clips'] = [];
      for (const clip of [...track.clips].sort((left, right) => left.startTime - right.startTime)) {
        if (
          activeSelection.end <= clip.startTime
          || activeSelection.start >= clip.startTime + clip.duration
        ) continue;
        const effective = await loadEffectiveClipChannels(clip, project.sampleRate);
        if (!effective) throw new Error(`片段“${clip.name ?? clip.id}”的音频不可用`);
        clips.push({
          clipId: clip.id,
          sampleData: effective.channels,
          sourceOffset: effective.sourceOffset,
        });
      }
      if (clips.length > 0) targets.push({ trackId: track.id, clips });
    }
    return targets;
  }

  async function collectFullTrackTargets(activeSelection: { start: number; end: number }): Promise<RepairTrackAudio[]> {
    if (!project) return [];
    const targets: RepairTrackAudio[] = [];
    for (const track of project.tracks) {
      const intersects = track.clips.some((clip) => (
        activeSelection.end > clip.startTime && activeSelection.start < clip.startTime + clip.duration
      ));
      if (!intersects) continue;
      const clips: RepairTrackAudio['clips'] = [];
      for (const clip of [...track.clips].sort((left, right) => left.startTime - right.startTime)) {
        const effective = await loadEffectiveClipChannels(clip, project.sampleRate);
        if (!effective) throw new Error(`片段“${clip.name ?? clip.id}”的音频不可用`);
        clips.push({
          clipId: clip.id,
          sampleData: effective.channels,
          sourceOffset: effective.sourceOffset,
        });
      }
      targets.push({ trackId: track.id, clips });
    }
    return targets;
  }

  async function handleEchoPreview(delaySeconds: number, decay: number): Promise<Float32Array[]> {
    if (!project || !quantizedGeneratorSelection) throw new Error('请先选择要试听的音频');
    const activeSelection = quantizedGeneratorSelection;
    const plan = getEchoPlan(delaySeconds, decay, project.sampleRate);
    const targets = await collectEffectTargets(activeSelection);
    const target = targets[0];
    if (!target) throw new Error('选区内没有可试听的音频');
    const sourceTrack = project.tracks.find((track) => track.id === target.trackId);
    if (!sourceTrack) throw new Error('试听轨道不可用');
    const state = createEchoState(plan);
    const segments: { channels: Float32Array[]; start: number; end: number }[] = [];

    for (const input of target.clips) {
      const clip = sourceTrack.clips.find((candidate) => candidate.id === input.clipId);
      if (!clip) throw new Error('试听片段不可用');
      const range = getEchoClipSampleRange(
        clip,
        activeSelection,
        input.sourceOffset,
        project.sampleRate,
        input.sampleData[0]?.length ?? 0,
      );
      if (!range) continue;
      const processed = processEchoSelection(
        input.sampleData,
        range.startSample,
        range.endSample,
        state,
      );
      segments.push({
        channels: processed.map((channel) => channel.slice(range.startSample, range.endSample)),
        start: range.startSample,
        end: range.endSample,
      });
    }
    const totalLength = segments.reduce((total, segment) => total + segment.end - segment.start, 0);
    const channelCount = segments.reduce((maximum, segment) => Math.max(maximum, segment.channels.length), 0);
    if (totalLength === 0 || channelCount === 0) throw new Error('选区内没有可试听的采样');
    const preview = Array.from({ length: channelCount }, () => new Float32Array(totalLength));
    let destinationOffset = 0;
    for (const segment of segments) {
      const length = segment.end - segment.start;
      preview.forEach((channel, channelIndex) => {
        const source = segment.channels[channelIndex];
        if (source) channel.set(source, destinationOffset);
      });
      destinationOffset += length;
    }
    return preview;
  }

  async function handleApplyEcho(delaySeconds: number, decay: number) {
    if (!project || !quantizedGeneratorSelection) return;
    const generation = projectLoadGenerationRef.current;
    const isCurrentAction = () => projectLoadGenerationRef.current === generation;
    setIsApplyingEcho(true);
    try {
      const activeSelection = quantizedGeneratorSelection;
      const targets = await collectEffectTargets(activeSelection);
      if (!isCurrentAction()) return;
      if (targets.length === 0) {
        toast.info('选区内没有可处理的音频');
        return;
      }
      const before = JSON.parse(JSON.stringify(project)) as IProject;
      const changed = await projectService.echoSelectionOnTracks(
        project.id,
        activeSelection,
        delaySeconds,
        decay,
        targets,
      );
      if (!isCurrentAction()) return;
      const updated = await projectService.getProject(project.id);
      if (!isCurrentAction()) return;
      if (!updated) throw new Error('应用回声后无法重新读取工程');
      setProject(updated);
      pushHistoryCmd({
        id: generateId(),
        label: 'Echo 回声',
        execute: () => updated,
        undo: () => before,
      });
      updateHistoryState();
      setEchoDialogOpen(false);
      toast.success(`已对 ${changed} 个片段应用回声`);
    } catch (error) {
      if (!isCurrentAction()) return;
      logger.error('应用回声失败:', String(error));
      toast.error(error instanceof Error ? `应用回声失败：${error.message}` : '应用回声失败');
    } finally {
      setIsApplyingEcho(false);
    }
  }

  async function handleDelayPreview(delaySettings: DelaySettings): Promise<Float32Array[]> {
    if (!project || !quantizedGeneratorSelection) throw new Error('请先选择要试听的音频');
    const activeSelection = quantizedGeneratorSelection;
    const targets = await collectEffectTargets(activeSelection);
    const target = targets[0];
    if (!target) throw new Error('选区内没有可试听的音频');
    const ordered = [...target.clips].sort((left, right) => left.sourceOffset - right.sourceOffset);
    const channelCount = ordered[0]?.sampleData.length ?? 0;
    const ranges = ordered.map((input) => {
      const clip = project.tracks
        .find((track) => track.id === target.trackId)
        ?.clips.find((candidate) => candidate.id === input.clipId);
      if (!clip) throw new Error('试听片段不可用');
      const range = getClipSampleRange(
        clip,
        activeSelection,
        input.sourceOffset,
        project.sampleRate,
        input.sampleData[0].length,
      );
      if (!range) throw new Error('试听片段不在选区内');
      return { input, range };
    });
    const totalLength = ranges.reduce((total, item) => total + item.range.endSample - item.range.startSample, 0);
    const selected = Array.from({ length: channelCount }, () => new Float32Array(totalLength));
    let cursor = 0;
    for (const item of ranges) {
      const length = item.range.endSample - item.range.startSample;
      for (let channel = 0; channel < channelCount; channel += 1) {
        selected[channel].set(item.input.sampleData[channel].subarray(item.range.startSample, item.range.endSample), cursor);
      }
      cursor += length;
    }
    return processDelayChannels(selected, delaySettings, project.sampleRate);
  }

  async function handleApplyDelay(delaySettings: DelaySettings) {
    if (!project || !quantizedGeneratorSelection) return;
    const generation = projectLoadGenerationRef.current;
    const isCurrentAction = () => projectLoadGenerationRef.current === generation;
    setIsApplyingDelay(true);
    try {
      const activeSelection = quantizedGeneratorSelection;
      const targets = await collectEffectTargets(activeSelection);
      if (!isCurrentAction()) return;
      if (targets.length === 0) {
        toast.info('选区内没有可处理的音频');
        return;
      }
      const before = JSON.parse(JSON.stringify(project)) as IProject;
      const changed = await projectService.delaySelectionOnTracks(
        project.id,
        activeSelection,
        delaySettings,
        targets,
      );
      if (!isCurrentAction()) return;
      const updated = await projectService.getProject(project.id);
      if (!isCurrentAction()) return;
      if (!updated) throw new Error('应用 Delay 后无法重新读取工程');
      setProject(updated);
      pushHistoryCmd({
        id: generateId(),
        label: 'Delay 延迟',
        execute: () => updated,
        undo: () => before,
      });
      updateHistoryState();
      setDelayDialogOpen(false);
      toast.success(`已对 ${changed} 个片段应用 Delay`);
    } catch (error) {
      if (!isCurrentAction()) return;
      logger.error('应用 Delay 失败:', String(error));
      toast.error(error instanceof Error ? `应用 Delay 失败：${error.message}` : '应用 Delay 失败');
    } finally {
      setIsApplyingDelay(false);
    }
  }

  async function handleClipFixPreview(clipFixSettings: ClipFixSettings): Promise<Float32Array[]> {
    if (!project || !quantizedGeneratorSelection) throw new Error('请先选择要试听的音频');
    const activeSelection = quantizedGeneratorSelection;
    const targets = await collectEffectTargets(activeSelection);
    const target = targets[0];
    if (!target) throw new Error('选区内没有可试听的音频');
    const ordered = [...target.clips].sort((left, right) => left.sourceOffset - right.sourceOffset);
    const channelCount = ordered[0]?.sampleData.length ?? 0;
    const ranges = ordered.map((input) => {
      const clip = project.tracks
        .find((track) => track.id === target.trackId)
        ?.clips.find((candidate) => candidate.id === input.clipId);
      if (!clip) throw new Error('试听片段不可用');
      const range = getClipSampleRange(
        clip,
        activeSelection,
        input.sourceOffset,
        project.sampleRate,
        input.sampleData[0].length,
      );
      if (!range) throw new Error('试听片段不在选区内');
      return { input, range };
    });
    const totalLength = ranges.reduce((total, item) => total + item.range.endSample - item.range.startSample, 0);
    const selected = Array.from({ length: channelCount }, () => new Float32Array(totalLength));
    let cursor = 0;
    for (const item of ranges) {
      const length = item.range.endSample - item.range.startSample;
      for (let channel = 0; channel < channelCount; channel += 1) {
        selected[channel].set(item.input.sampleData[channel].subarray(item.range.startSample, item.range.endSample), cursor);
      }
      cursor += length;
    }
    return processClipFixChannels(selected, clipFixSettings);
  }

  async function handleApplyClipFix(clipFixSettings: ClipFixSettings) {
    if (!project || !quantizedGeneratorSelection) return;
    const generation = projectLoadGenerationRef.current;
    const isCurrentAction = () => projectLoadGenerationRef.current === generation;
    setIsApplyingClipFix(true);
    try {
      const activeSelection = quantizedGeneratorSelection;
      const targets = await collectEffectTargets(activeSelection);
      if (!isCurrentAction()) return;
      if (targets.length === 0) {
        toast.info('选区内没有可处理的音频');
        return;
      }
      const before = JSON.parse(JSON.stringify(project)) as IProject;
      const changed = await projectService.clipFixSelectionOnTracks(
        project.id,
        activeSelection,
        clipFixSettings,
        targets,
      );
      if (!isCurrentAction()) return;
      const updated = await projectService.getProject(project.id);
      if (!isCurrentAction()) return;
      if (!updated) throw new Error('应用 Clip Fix 后无法重新读取工程');
      setProject(updated);
      pushHistoryCmd({
        id: generateId(),
        label: 'Clip Fix 削波修复',
        execute: () => updated,
        undo: () => before,
      });
      updateHistoryState();
      setClipFixDialogOpen(false);
      toast.success(`已对 ${changed} 个片段应用 Clip Fix`);
    } catch (error) {
      if (!isCurrentAction()) return;
      logger.error('应用 Clip Fix 失败:', String(error));
      toast.error(error instanceof Error ? `应用 Clip Fix 失败：${error.message}` : '应用 Clip Fix 失败');
    } finally {
      setIsApplyingClipFix(false);
    }
  }

  async function handleNotchFilterPreview(notchSettings: NotchFilterSettings): Promise<Float32Array[]> {
    if (!project || !quantizedGeneratorSelection) throw new Error('请先选择要试听的音频');
    const activeSelection = quantizedGeneratorSelection;
    const targets = await collectEffectTargets(activeSelection);
    const target = targets[0];
    if (!target) throw new Error('选区内没有可试听的音频');
    const ordered = [...target.clips].sort((left, right) => left.sourceOffset - right.sourceOffset);
    const channelCount = ordered[0]?.sampleData.length ?? 0;
    const ranges = ordered.map((input) => {
      const clip = project.tracks
        .find((track) => track.id === target.trackId)
        ?.clips.find((candidate) => candidate.id === input.clipId);
      if (!clip) throw new Error('试听片段不可用');
      const range = getClipSampleRange(
        clip,
        activeSelection,
        input.sourceOffset,
        project.sampleRate,
        input.sampleData[0].length,
      );
      if (!range) throw new Error('试听片段不在选区内');
      return { input, range };
    });
    const totalLength = ranges.reduce((total, item) => total + item.range.endSample - item.range.startSample, 0);
    const selected = Array.from({ length: channelCount }, () => new Float32Array(totalLength));
    let cursor = 0;
    for (const item of ranges) {
      const length = item.range.endSample - item.range.startSample;
      for (let channel = 0; channel < channelCount; channel += 1) {
        selected[channel].set(item.input.sampleData[channel].subarray(item.range.startSample, item.range.endSample), cursor);
      }
      cursor += length;
    }
    return processNotchFilterChannels(selected, notchSettings, project.sampleRate);
  }

  async function handleApplyNotchFilter(notchSettings: NotchFilterSettings) {
    if (!project || !quantizedGeneratorSelection) return;
    const generation = projectLoadGenerationRef.current;
    const isCurrentAction = () => projectLoadGenerationRef.current === generation;
    setIsApplyingNotchFilter(true);
    try {
      const activeSelection = quantizedGeneratorSelection;
      const targets = await collectEffectTargets(activeSelection);
      if (!isCurrentAction()) return;
      if (targets.length === 0) {
        toast.info('选区内没有可处理的音频');
        return;
      }
      const before = JSON.parse(JSON.stringify(project)) as IProject;
      const changed = await projectService.notchFilterSelectionOnTracks(
        project.id,
        activeSelection,
        notchSettings,
        targets,
      );
      if (!isCurrentAction()) return;
      const updated = await projectService.getProject(project.id);
      if (!isCurrentAction()) return;
      if (!updated) throw new Error('应用 Notch Filter 后无法重新读取工程');
      setProject(updated);
      pushHistoryCmd({
        id: generateId(),
        label: 'Notch Filter 陷波滤波',
        execute: () => updated,
        undo: () => before,
      });
      updateHistoryState();
      setNotchFilterDialogOpen(false);
      toast.success(`已对 ${changed} 个片段应用 Notch Filter`);
    } catch (error) {
      if (!isCurrentAction()) return;
      logger.error('应用 Notch Filter 失败:', String(error));
      toast.error(error instanceof Error ? `应用 Notch Filter 失败：${error.message}` : '应用 Notch Filter 失败');
    } finally {
      setIsApplyingNotchFilter(false);
    }
  }

  async function collectPreviewChannels(activeSelection: GeneratorSelection): Promise<Float32Array[]> {
    const targets = await collectEffectTargets(activeSelection);
    const target = targets[0];
    if (!target) throw new Error('选区内没有可试听的音频');
    const ordered = [...target.clips].sort((left, right) => left.sourceOffset - right.sourceOffset);
    const channelCount = ordered[0]?.sampleData.length ?? 0;
    const ranges = ordered.map((input) => {
      const clip = project?.tracks
        .find((track) => track.id === target.trackId)
        ?.clips.find((candidate) => candidate.id === input.clipId);
      if (!clip) throw new Error('试听片段不可用');
      const range = getClipSampleRange(
        clip,
        activeSelection,
        input.sourceOffset,
        project?.sampleRate ?? 0,
        input.sampleData[0].length,
      );
      if (!range) throw new Error('试听片段不在选区内');
      return { input, range };
    });
    const totalLength = ranges.reduce((total, item) => total + item.range.endSample - item.range.startSample, 0);
    const selected = Array.from({ length: channelCount }, () => new Float32Array(totalLength));
    let cursor = 0;
    for (const item of ranges) {
      const length = item.range.endSample - item.range.startSample;
      for (let channel = 0; channel < channelCount; channel += 1) {
        selected[channel].set(item.input.sampleData[channel].subarray(item.range.startSample, item.range.endSample), cursor);
      }
      cursor += length;
    }
    return selected;
  }

  async function handleShelfFilterPreview(settings: ShelfFilterSettings): Promise<Float32Array[]> {
    if (!project || !quantizedGeneratorSelection) throw new Error('请先选择要试听的音频');
    const selected = await collectPreviewChannels(quantizedGeneratorSelection);
    return processShelfFilterChannels(selected, settings, project.sampleRate);
  }

  async function handleApplyShelfFilter(settings: ShelfFilterSettings) {
    if (!project || !quantizedGeneratorSelection) return;
    setIsApplyingShelfFilter(true);
    const loadGeneration = projectLoadGenerationRef.current;
    try {
      const activeSelection = quantizedGeneratorSelection;
      const targets = await collectEffectTargets(activeSelection);
      if (loadGeneration !== projectLoadGenerationRef.current) return;
      if (targets.length === 0) {
        toast.info('选区内没有可处理的音频');
        return;
      }
      const before = JSON.parse(JSON.stringify(project)) as IProject;
      const changed = await projectService.shelfFilterSelectionOnTracks(
        project.id,
        activeSelection,
        settings,
        targets,
      );
      if (loadGeneration !== projectLoadGenerationRef.current) return;
      const updated = await projectService.getProject(project.id);
      if (loadGeneration !== projectLoadGenerationRef.current) return;
      if (!updated) throw new Error('应用 Shelf Filter 后无法重新读取工程');
      setProject(updated);
      pushHistoryCmd({
        id: generateId(),
        label: 'Shelf Filter 搁架滤波',
        execute: () => updated,
        undo: () => before,
      });
      updateHistoryState();
      setShelfFilterDialogOpen(false);
      toast.success(`已对 ${changed} 个片段应用 Shelf Filter`);
    } catch (error) {
      if (loadGeneration !== projectLoadGenerationRef.current) return;
      logger.error('应用 Shelf Filter 失败:', String(error));
      toast.error(error instanceof Error ? `应用 Shelf Filter 失败：${error.message}` : '应用 Shelf Filter 失败');
    } finally {
      setIsApplyingShelfFilter(false);
    }
  }

  async function handleSpectralEditPreview(settings: SpectralEditSettings): Promise<Float32Array[]> {
    if (!project || !quantizedGeneratorSelection) throw new Error('请先选择要试听的音频');
    const selected = await collectPreviewChannels(quantizedGeneratorSelection);
    return processSpectralEditChannels(selected, settings, project.sampleRate);
  }

  async function handleApplySpectralEdit(settings: SpectralEditSettings) {
    if (!project || !quantizedGeneratorSelection) return;
    setIsApplyingSpectralEdit(true);
    const loadGeneration = projectLoadGenerationRef.current;
    try {
      const activeSelection = quantizedGeneratorSelection;
      const targets = await collectEffectTargets(activeSelection);
      if (loadGeneration !== projectLoadGenerationRef.current) return;
      if (targets.length === 0) {
        toast.info('选区内没有可处理的音频');
        return;
      }
      const before = JSON.parse(JSON.stringify({
        ...project,
        selection: activeSelection,
        spectralSelection,
      })) as IProject;
      const changed = await projectService.spectralEditSelectionOnTracks(
        project.id,
        activeSelection,
        settings,
        targets,
        spectralSelection,
      );
      if (loadGeneration !== projectLoadGenerationRef.current) return;
      const updated = await projectService.getProject(project.id);
      if (loadGeneration !== projectLoadGenerationRef.current) return;
      if (!updated) throw new Error('应用 Spectral tools 后无法重新读取工程');
      const labels: Record<SpectralEditKind, string> = {
        'delete-selection': 'Spectral Edit Delete selection',
        'delete-center': 'Spectral Edit Delete center frequency',
        'amplify-center': 'Spectral Edit Amplify center frequency',
        'amplify-selection': 'Spectral Edit Amplify selection',
      };
      setProject(updated);
      setSelection(updated.selection);
      setSpectralSelection(normalizeFrequencySelection(
        updated.spectralSelection,
        updated.sampleRate,
        getTrackSpectrogramSettings(
          updated.tracks.find((track) => track.id === selectedTrackId) ?? updated.tracks[0],
          updated.sampleRate,
        ),
      ));
      pushHistoryCmd({
        id: generateId(),
        label: labels[settings.kind],
        execute: () => updated,
        undo: () => before,
      });
      updateHistoryState();
      setSpectralEditKind(null);
      toast.success(`已对 ${changed} 个片段应用 ${labels[settings.kind]}`);
    } catch (error) {
      if (loadGeneration !== projectLoadGenerationRef.current) return;
      logger.error('应用 Spectral tools 失败:', String(error));
      toast.error(error instanceof Error ? `应用 Spectral tools 失败：${error.message}` : '应用 Spectral tools 失败');
    } finally {
      setIsApplyingSpectralEdit(false);
    }
  }

  async function handleAdjustableFadePreview(fadeSettings: AdjustableFadeSettings): Promise<Float32Array[]> {
    if (!project || !quantizedGeneratorSelection) throw new Error('请先选择要试听的音频');
    const selected = await collectPreviewChannels(quantizedGeneratorSelection);
    return processAdjustableFadeChannels(selected, fadeSettings);
  }

  async function handleApplyAdjustableFade(fadeSettings: AdjustableFadeSettings) {
    if (!project || !quantizedGeneratorSelection) return;
    setIsApplyingAdjustableFade(true);
    const loadGeneration = projectLoadGenerationRef.current;
    try {
      const activeSelection = quantizedGeneratorSelection;
      const targets = await collectEffectTargets(activeSelection);
      if (loadGeneration !== projectLoadGenerationRef.current) return;
      if (targets.length === 0) {
        toast.info('选区内没有可处理的音频');
        return;
      }
      const before = JSON.parse(JSON.stringify(project)) as IProject;
      const changed = await projectService.adjustableFadeSelectionOnTracks(
        project.id,
        activeSelection,
        fadeSettings,
        targets,
      );
      if (loadGeneration !== projectLoadGenerationRef.current) return;
      const updated = await projectService.getProject(project.id);
      if (loadGeneration !== projectLoadGenerationRef.current) return;
      if (!updated) throw new Error('应用 Adjustable Fade 后无法重新读取工程');
      setProject(updated);
      pushHistoryCmd({
        id: generateId(),
        label: 'Adjustable Fade 可调淡化',
        execute: () => updated,
        undo: () => before,
      });
      updateHistoryState();
      setAdjustableFadeDialogOpen(false);
      toast.success(`已对 ${changed} 个片段应用 Adjustable Fade`);
    } catch (error) {
      if (loadGeneration !== projectLoadGenerationRef.current) return;
      logger.error('应用 Adjustable Fade 失败:', String(error));
      toast.error(error instanceof Error ? `应用 Adjustable Fade 失败：${error.message}` : '应用 Adjustable Fade 失败');
    } finally {
      setIsApplyingAdjustableFade(false);
    }
  }

  async function handleApplyRepair() {
    if (!project || !quantizedGeneratorSelection) return;
    setIsApplyingRepair(true);
    const loadGeneration = projectLoadGenerationRef.current;
    try {
      const activeSelection = quantizedGeneratorSelection;
      const targets = await collectFullTrackTargets(activeSelection);
      if (loadGeneration !== projectLoadGenerationRef.current) return;
      if (targets.length === 0) {
        toast.info('选区内没有可修复的音频');
        return;
      }
      const before = JSON.parse(JSON.stringify(project)) as IProject;
      const changed = await projectService.repairSelectionOnTracks(
        project.id,
        activeSelection,
        targets,
      );
      if (loadGeneration !== projectLoadGenerationRef.current) return;
      const updated = await projectService.getProject(project.id);
      if (loadGeneration !== projectLoadGenerationRef.current) return;
      if (!updated) throw new Error('应用 Repair 后无法重新读取工程');
      setProject(updated);
      pushHistoryCmd({
        id: generateId(),
        label: 'Repair 修复',
        execute: () => updated,
        undo: () => before,
      });
      updateHistoryState();
      toast.success(`已对 ${changed} 个片段应用 Repair 修复`);
    } catch (error) {
      if (loadGeneration !== projectLoadGenerationRef.current) return;
      logger.error('应用 Repair 修复失败:', String(error));
      toast.error(error instanceof Error ? `应用 Repair 修复失败：${error.message}` : '应用 Repair 修复失败');
    } finally {
      setIsApplyingRepair(false);
    }
  }

  async function handleClickRemovalPreview(settings: ClickRemovalSettings): Promise<Float32Array[]> {
    if (!project || !quantizedGeneratorSelection) throw new Error('请先选择要试听的音频');
    const activeSelection = quantizedGeneratorSelection;
    const targets = await collectFullTrackTargets(activeSelection);
    const target = targets[0];
    if (!target) throw new Error('选区内没有可试听的音频');
    const sourceTrack = project.tracks.find((track) => track.id === target.trackId);
    if (!sourceTrack) throw new Error('试听轨道不可用');
    return processClickRemovalTrack(
      sourceTrack,
      target,
      activeSelection,
      settings,
      project.sampleRate,
    ).selectionChannels;
  }

  async function handleApplyClickRemoval(settings: ClickRemovalSettings) {
    if (!project || !quantizedGeneratorSelection || isApplyingClickRemoval) return;
    setIsApplyingClickRemoval(true);
    const loadGeneration = projectLoadGenerationRef.current;
    try {
      const activeSelection = quantizedGeneratorSelection;
      const targets = await collectFullTrackTargets(activeSelection);
      if (loadGeneration !== projectLoadGenerationRef.current) return;
      if (targets.length === 0) {
        toast.info('选区内没有可处理的音频');
        return;
      }
      const before = {
        ...(JSON.parse(JSON.stringify(project)) as IProject),
        selection: activeSelection,
      };
      const changed = await projectService.clickRemovalSelectionOnTracks(
        project.id,
        activeSelection,
        settings,
        targets,
      );
      if (loadGeneration !== projectLoadGenerationRef.current) return;
      if (changed === 0) {
        toast.info('Click Removal 参数为 0，已按官方行为跳过，未修改音频');
        return;
      }
      const updated = await projectService.getProject(project.id);
      if (loadGeneration !== projectLoadGenerationRef.current) return;
      if (!updated) throw new Error('应用 Click Removal 后无法重新读取工程');
      setProject(updated);
      setSelection(updated.selection);
      pushHistoryCmd({
        id: generateId(),
        label: 'Click Removal 咔哒声消除',
        execute: () => updated,
        undo: () => before,
      }, before);
      updateHistoryState();
      setClickRemovalDialogOpen(false);
      toast.success(`已对 ${changed} 个片段应用 Click Removal 咔哒声消除`);
    } catch (error) {
      if (loadGeneration !== projectLoadGenerationRef.current) return;
      logger.error('应用 Click Removal 失败:', String(error));
      toast.error(error instanceof Error ? `应用 Click Removal 失败：${error.message}` : '应用 Click Removal 失败');
    } finally {
      setIsApplyingClickRemoval(false);
    }
  }

  async function handleGetNoiseReductionProfile() {
    if (!project || !quantizedGeneratorSelection) {
      toast.info('请先选择一段纯噪声');
      return;
    }
    try {
      const targets = await collectFullTrackTargets(quantizedGeneratorSelection);
      const profile = await projectService.learnNoiseReductionProfile(
        project.id,
        quantizedGeneratorSelection,
        targets,
      );
      setNoiseReductionProfile(profile);
      setNoiseReductionDialogOpen(false);
      toast.success(`Noise Profile 已获取：${profile.totalWindows} 个窗口，请重新选择待处理音频`);
    } catch (error) {
      logger.error('获取 Noise Profile 失败:', String(error));
      toast.error(error instanceof Error ? `获取 Noise Profile 失败：${error.message}` : '获取 Noise Profile 失败');
    }
  }

  async function handleNoiseReductionPreview(
    settings: NoiseReductionSettings,
    profile: NoiseReductionProfile,
  ): Promise<Float32Array[]> {
    if (!project || !quantizedGeneratorSelection) throw new Error('请先选择要试听的音频');
    const activeSelection = quantizedGeneratorSelection;
    const targets = await collectFullTrackTargets(activeSelection);
    const target = targets[0];
    if (!target) throw new Error('选区内没有可试听的音频');
    const sourceTrack = project.tracks.find((track) => track.id === target.trackId);
    if (!sourceTrack) throw new Error('试听轨道不可用');
    return processNoiseReductionTrack(
      sourceTrack,
      target,
      activeSelection,
      profile,
      settings,
      project.sampleRate,
    ).selectionChannels;
  }

  async function handleApplyNoiseReduction(settings: NoiseReductionSettings, profile: NoiseReductionProfile) {
    if (!project || !quantizedGeneratorSelection || isApplyingNoiseReduction) return;
    setIsApplyingNoiseReduction(true);
    try {
      const activeSelection = quantizedGeneratorSelection;
      const targets = await collectFullTrackTargets(activeSelection);
      const before = {
        ...(JSON.parse(JSON.stringify(project)) as IProject),
        selection: activeSelection,
      };
      const changed = await projectService.noiseReductionSelectionOnTracks(
        project.id,
        activeSelection,
        settings,
        profile,
        targets,
      );
      const updated = await projectService.getProject(project.id);
      if (!updated) throw new Error('应用 Noise Reduction 后无法重新读取工程');
      setProject(updated);
      setSelection(updated.selection);
      pushHistoryCmd({
        id: generateId(),
        label: 'Noise Reduction 降噪',
        execute: () => updated,
        undo: () => before,
      }, before);
      updateHistoryState();
      setNoiseReductionDialogOpen(false);
      toast.success(`已对 ${changed} 个片段应用 Noise Reduction 降噪`);
    } catch (error) {
      logger.error('应用 Noise Reduction 失败:', String(error));
      toast.error(error instanceof Error ? `应用 Noise Reduction 失败：${error.message}` : '应用 Noise Reduction 失败');
    } finally {
      setIsApplyingNoiseReduction(false);
    }
  }

  async function handleTruncateSilencePreview(settings: TruncateSilenceSettings): Promise<Float32Array[]> {
    if (!project || !quantizedGeneratorSelection) throw new Error('请先选择要试听的音频');
    const activeSelection = quantizedGeneratorSelection;
    const targets = await collectFullTrackTargets(activeSelection);
    if (targets.length === 0) throw new Error('选区内没有可试听的音频');
    const processed = processTruncateSilenceTracks(
      project.tracks,
      targets,
      activeSelection,
      settings,
      project.sampleRate,
    );
    const changed = processed.tracks.find(({ changed: hasCuts }) => hasCuts);
    if (!changed) throw new Error('未检测到符合参数且可缩短的静音');
    return changed.sampleData;
  }

  async function handleApplyTruncateSilence(settings: TruncateSilenceSettings) {
    if (!project || !quantizedGeneratorSelection || isApplyingTruncateSilence) return;
    setIsApplyingTruncateSilence(true);
    try {
      const activeSelection = quantizedGeneratorSelection;
      const targets = await collectFullTrackTargets(activeSelection);
      if (targets.length === 0) {
        toast.info('选区内没有可处理的音频');
        return;
      }
      const before = {
        ...(JSON.parse(JSON.stringify(project)) as IProject),
        selection: activeSelection,
      };
      const result = await projectService.truncateSilenceSelectionOnTracks(
        project.id,
        activeSelection,
        settings,
        targets,
      );
      if (result.changedTracks === 0) {
        toast.info('未检测到符合参数且可缩短的静音，未修改音频');
        return;
      }
      const updated = await projectService.getProject(project.id);
      if (!updated) throw new Error('应用 Truncate Silence 后无法重新读取工程');
      setProject(updated);
      setSelection(updated.selection);
      pushHistoryCmd({
        id: generateId(),
        label: 'Truncate Silence 静音截断',
        execute: () => updated,
        undo: () => before,
      }, before);
      updateHistoryState();
      setTruncateSilenceDialogOpen(false);
      toast.success(`已对 ${result.changedTracks} 条轨道应用 Truncate Silence 静音截断`);
    } catch (error) {
      logger.error('应用 Truncate Silence 失败:', String(error));
      toast.error(error instanceof Error ? `应用 Truncate Silence 失败：${error.message}` : '应用 Truncate Silence 失败');
    } finally {
      setIsApplyingTruncateSilence(false);
    }
  }

  async function handleWahWahPreview(settings: WahWahSettings): Promise<Float32Array[]> {
    if (!project || !quantizedGeneratorSelection) throw new Error('请先选择要试听的音频');
    const activeSelection = quantizedGeneratorSelection;
    const targets = await collectEffectTargets(activeSelection);
    const target = targets[0];
    if (!target) throw new Error('选区内没有可试听的音频');
    const sourceTrack = project.tracks.find((track) => track.id === target.trackId);
    if (!sourceTrack) throw new Error('试听轨道不可用');
    const segments: Float32Array[][] = [];

    for (const input of target.clips) {
      const clip = sourceTrack.clips.find((candidate) => candidate.id === input.clipId);
      if (!clip) throw new Error('试听片段不可用');
      const range = getClipSampleRange(
        clip,
        activeSelection,
        input.sourceOffset,
        project.sampleRate,
        input.sampleData[0]?.length ?? 0,
      );
      if (!range) continue;
      const selectedChannels = input.sampleData.map((channel) => (
        channel.slice(range.startSample, range.endSample)
      ));
      segments.push(processWahWahChannels(selectedChannels, settings, project.sampleRate));
    }

    const totalLength = segments.reduce((total, segment) => total + (segment[0]?.length ?? 0), 0);
    const channelCount = segments.reduce((maximum, segment) => Math.max(maximum, segment.length), 0);
    if (totalLength === 0 || channelCount === 0) throw new Error('选区内没有可试听的采样');
    const preview = Array.from({ length: channelCount }, () => new Float32Array(totalLength));
    let destinationOffset = 0;
    for (const segment of segments) {
      const length = segment[0]?.length ?? 0;
      preview.forEach((channel, channelIndex) => {
        const source = segment[channelIndex];
        if (source) channel.set(source, destinationOffset);
      });
      destinationOffset += length;
    }
    return preview;
  }

  async function handleApplyWahWah(settings: WahWahSettings) {
    if (!project || !quantizedGeneratorSelection) return;
    setIsApplyingWahWah(true);
    try {
      const activeSelection = quantizedGeneratorSelection;
      const targets = await collectEffectTargets(activeSelection);
      if (targets.length === 0) {
        toast.info('选区内没有可处理的音频');
        return;
      }
      const before = JSON.parse(JSON.stringify(project)) as IProject;
      const changed = await projectService.wahWahSelectionOnTracks(
        project.id,
        activeSelection,
        settings,
        targets,
      );
      const updated = await projectService.getProject(project.id);
      if (!updated) throw new Error('应用 Wah Wah 后无法重新读取工程');
      setProject(updated);
      pushHistoryCmd({
        id: generateId(),
        label: 'Wah Wah',
        execute: () => updated,
        undo: () => before,
      });
      updateHistoryState();
      setWahWahDialogOpen(false);
      toast.success(`已对 ${changed} 个片段应用 Wah Wah`);
    } catch (error) {
      logger.error('应用 Wah Wah 失败:', String(error));
      toast.error(error instanceof Error ? `应用 Wah Wah 失败：${error.message}` : '应用 Wah Wah 失败');
    } finally {
      setIsApplyingWahWah(false);
    }
  }

  async function handlePhaserPreview(settings: PhaserSettings): Promise<Float32Array[]> {
    if (!project || !quantizedGeneratorSelection) throw new Error('请先选择要试听的音频');
    const activeSelection = quantizedGeneratorSelection;
    const targets = await collectEffectTargets(activeSelection);
    const target = targets[0];
    if (!target) throw new Error('选区内没有可试听的音频');
    const sourceTrack = project.tracks.find((track) => track.id === target.trackId);
    if (!sourceTrack) throw new Error('试听轨道不可用');
    const states = target.clips[0]?.sampleData.map(() => (
      createPhaserState(settings, project.sampleRate)
    )) ?? [];
    const segments: Float32Array[][] = [];

    for (const input of target.clips) {
      const clip = sourceTrack.clips.find((candidate) => candidate.id === input.clipId);
      if (!clip) throw new Error('试听片段不可用');
      const range = getClipSampleRange(
        clip,
        activeSelection,
        input.sourceOffset,
        project.sampleRate,
        input.sampleData[0]?.length ?? 0,
      );
      if (!range) continue;
      const selectedChannels = input.sampleData.map((channel) => (
        channel.slice(range.startSample, range.endSample)
      ));
      segments.push(processPhaserChannels(selectedChannels, settings, project.sampleRate, states));
    }

    const totalLength = segments.reduce((total, segment) => total + (segment[0]?.length ?? 0), 0);
    const channelCount = segments.reduce((maximum, segment) => Math.max(maximum, segment.length), 0);
    if (totalLength === 0 || channelCount === 0) throw new Error('选区内没有可试听的采样');
    const preview = Array.from({ length: channelCount }, () => new Float32Array(totalLength));
    let destinationOffset = 0;
    for (const segment of segments) {
      const length = segment[0]?.length ?? 0;
      preview.forEach((channel, channelIndex) => {
        const source = segment[channelIndex];
        if (source) channel.set(source, destinationOffset);
      });
      destinationOffset += length;
    }
    return preview;
  }

  async function handleApplyPhaser(settings: PhaserSettings) {
    if (!project || !quantizedGeneratorSelection) return;
    setIsApplyingPhaser(true);
    try {
      const activeSelection = quantizedGeneratorSelection;
      const targets = await collectEffectTargets(activeSelection);
      if (targets.length === 0) {
        toast.info('选区内没有可处理的音频');
        return;
      }
      const before = JSON.parse(JSON.stringify(project)) as IProject;
      const changed = await projectService.phaserSelectionOnTracks(
        project.id,
        activeSelection,
        settings,
        targets,
      );
      const updated = await projectService.getProject(project.id);
      if (!updated) throw new Error('应用 Phaser 后无法重新读取工程');
      setProject(updated);
      pushHistoryCmd({
        id: generateId(),
        label: 'Phaser',
        execute: () => updated,
        undo: () => before,
      });
      updateHistoryState();
      setPhaserDialogOpen(false);
      toast.success(`已对 ${changed} 个片段应用 Phaser`);
    } catch (error) {
      logger.error('应用 Phaser 失败:', String(error));
      toast.error(error instanceof Error ? `应用 Phaser 失败：${error.message}` : '应用 Phaser 失败');
    } finally {
      setIsApplyingPhaser(false);
    }
  }

  async function handleClassicFilterPreview(settings: ClassicFilterSettings): Promise<Float32Array[]> {
    if (!project || !quantizedGeneratorSelection) throw new Error('请先选择要试听的音频');
    const activeSelection = quantizedGeneratorSelection;
    const targets = await collectEffectTargets(activeSelection);
    const target = targets[0];
    if (!target) throw new Error('选区内没有可试听的音频');
    const sourceTrack = project.tracks.find((track) => track.id === target.trackId);
    if (!sourceTrack) throw new Error('试听轨道不可用');
    const states = target.clips[0]?.sampleData.map(() => (
      createClassicFilterState(settings, project.sampleRate)
    )) ?? [];
    const segments: Float32Array[][] = [];

    for (const input of target.clips) {
      const clip = sourceTrack.clips.find((candidate) => candidate.id === input.clipId);
      if (!clip) throw new Error('试听片段不可用');
      const range = getClipSampleRange(
        clip,
        activeSelection,
        input.sourceOffset,
        project.sampleRate,
        input.sampleData[0]?.length ?? 0,
      );
      if (!range) continue;
      const selectedChannels = input.sampleData.map((channel) => (
        channel.slice(range.startSample, range.endSample)
      ));
      segments.push(processClassicFilterChannels(selectedChannels, settings, project.sampleRate, states));
    }

    const totalLength = segments.reduce((total, segment) => total + (segment[0]?.length ?? 0), 0);
    const channelCount = segments.reduce((maximum, segment) => Math.max(maximum, segment.length), 0);
    if (totalLength === 0 || channelCount === 0) throw new Error('选区内没有可试听的采样');
    const preview = Array.from({ length: channelCount }, () => new Float32Array(totalLength));
    let destinationOffset = 0;
    for (const segment of segments) {
      const length = segment[0]?.length ?? 0;
      preview.forEach((channel, channelIndex) => {
        const source = segment[channelIndex];
        if (source) channel.set(source, destinationOffset);
      });
      destinationOffset += length;
    }
    return preview;
  }

  async function handleApplyClassicFilter(settings: ClassicFilterSettings) {
    if (!project || !quantizedGeneratorSelection || isApplyingClassicFilter) return;
    setIsApplyingClassicFilter(true);
    try {
      const activeSelection = quantizedGeneratorSelection;
      const targets = await collectEffectTargets(activeSelection);
      if (targets.length === 0) {
        toast.info('选区内没有可处理的音频');
        return;
      }
      const before = {
        ...(JSON.parse(JSON.stringify(project)) as IProject),
        selection: activeSelection,
      };
      const changed = await projectService.classicFilterSelectionOnTracks(
        project.id,
        activeSelection,
        settings,
        targets,
      );
      const updated = await projectService.getProject(project.id);
      if (!updated) throw new Error('应用 Classic Filters 后无法重新读取工程');
      setProject(updated);
      setSelection(updated.selection);
      pushHistoryCmd({
        id: generateId(),
        label: 'Classic Filters',
        execute: () => updated,
        undo: () => before,
      }, before);
      updateHistoryState();
      setClassicFilterDialogOpen(false);
      toast.success(`已对 ${changed} 个片段应用 Classic Filters`);
    } catch (error) {
      logger.error('应用 Classic Filters 失败:', String(error));
      toast.error(error instanceof Error ? `应用 Classic Filters 失败：${error.message}` : '应用 Classic Filters 失败');
    } finally {
      setIsApplyingClassicFilter(false);
    }
  }

  async function handlePassFilterPreview(settings: PassFilterSettings): Promise<Float32Array[]> {
    if (!project || !quantizedGeneratorSelection) throw new Error('请先选择要试听的音频');
    const activeSelection = quantizedGeneratorSelection;
    const targets = await collectEffectTargets(activeSelection);
    const target = targets[0];
    if (!target) throw new Error('选区内没有可试听的音频');
    const sourceTrack = project.tracks.find((track) => track.id === target.trackId);
    if (!sourceTrack) throw new Error('试听轨道不可用');
    const states = target.clips[0]?.sampleData.map(() => (
      createPassFilterState(settings, project.sampleRate)
    )) ?? [];
    const segments: Float32Array[][] = [];

    for (const input of target.clips) {
      const clip = sourceTrack.clips.find((candidate) => candidate.id === input.clipId);
      if (!clip) throw new Error('试听片段不可用');
      const range = getClipSampleRange(
        clip,
        activeSelection,
        input.sourceOffset,
        project.sampleRate,
        input.sampleData[0]?.length ?? 0,
      );
      if (!range) continue;
      const selectedChannels = input.sampleData.map((channel) => (
        channel.slice(range.startSample, range.endSample)
      ));
      segments.push(processPassFilterChannels(selectedChannels, settings, project.sampleRate, states));
    }

    const totalLength = segments.reduce((total, segment) => total + (segment[0]?.length ?? 0), 0);
    const channelCount = segments.reduce((maximum, segment) => Math.max(maximum, segment.length), 0);
    if (totalLength === 0 || channelCount === 0) throw new Error('选区内没有可试听的采样');
    const preview = Array.from({ length: channelCount }, () => new Float32Array(totalLength));
    let destinationOffset = 0;
    for (const segment of segments) {
      const length = segment[0]?.length ?? 0;
      preview.forEach((channel, channelIndex) => {
        const source = segment[channelIndex];
        if (source) channel.set(source, destinationOffset);
      });
      destinationOffset += length;
    }
    return preview;
  }

  async function handleApplyPassFilter(settings: PassFilterSettings) {
    if (!project || !quantizedGeneratorSelection || !passFilterKind || isApplyingPassFilter) return;
    const kind = passFilterKind;
    const title = kind === 'highpass' ? 'High-pass filter' : 'Low-pass filter';
    setIsApplyingPassFilter(true);
    try {
      const activeSelection = quantizedGeneratorSelection;
      const targets = await collectEffectTargets(activeSelection);
      if (targets.length === 0) {
        toast.info('选区内没有可处理的音频');
        return;
      }
      const before = {
        ...(JSON.parse(JSON.stringify(project)) as IProject),
        selection: activeSelection,
      };
      const changed = await projectService.passFilterSelectionOnTracks(
        project.id,
        activeSelection,
        settings,
        targets,
      );
      const updated = await projectService.getProject(project.id);
      if (!updated) throw new Error(`应用 ${title} 后无法重新读取工程`);
      setProject(updated);
      setSelection(updated.selection);
      pushHistoryCmd({
        id: generateId(),
        label: title,
        execute: () => updated,
        undo: () => before,
      }, before);
      updateHistoryState();
      setPassFilterKind(null);
      toast.success(`已对 ${changed} 个片段应用 ${title}`);
    } catch (error) {
      logger.error(`应用 ${title} 失败:`, String(error));
      toast.error(error instanceof Error ? `应用 ${title} 失败：${error.message}` : `应用 ${title} 失败`);
    } finally {
      setIsApplyingPassFilter(false);
    }
  }

  async function handleTremoloPreview(settings: TremoloSettings): Promise<Float32Array[]> {
    if (!project || !quantizedGeneratorSelection) throw new Error('请先选择要试听的音频');
    const activeSelection = quantizedGeneratorSelection;
    const targets = await collectEffectTargets(activeSelection);
    const target = targets[0];
    if (!target) throw new Error('选区内没有可试听的音频');
    const sourceTrack = project.tracks.find((track) => track.id === target.trackId);
    if (!sourceTrack) throw new Error('试听轨道不可用');
    const state = createTremoloState();
    const segments: Float32Array[][] = [];

    for (const input of target.clips) {
      const clip = sourceTrack.clips.find((candidate) => candidate.id === input.clipId);
      if (!clip) throw new Error('试听片段不可用');
      const range = getClipSampleRange(
        clip,
        activeSelection,
        input.sourceOffset,
        project.sampleRate,
        input.sampleData[0]?.length ?? 0,
      );
      if (!range) continue;
      const selectedChannels = input.sampleData.map((channel) => (
        channel.slice(range.startSample, range.endSample)
      ));
      segments.push(processTremoloChannels(selectedChannels, settings, project.sampleRate, state));
    }

    const totalLength = segments.reduce((total, segment) => total + (segment[0]?.length ?? 0), 0);
    const channelCount = segments.reduce((maximum, segment) => Math.max(maximum, segment.length), 0);
    if (totalLength === 0 || channelCount === 0) throw new Error('选区内没有可试听的采样');
    const preview = Array.from({ length: channelCount }, () => new Float32Array(totalLength));
    let destinationOffset = 0;
    for (const segment of segments) {
      const length = segment[0]?.length ?? 0;
      preview.forEach((channel, channelIndex) => {
        const source = segment[channelIndex];
        if (source) channel.set(source, destinationOffset);
      });
      destinationOffset += length;
    }
    return preview;
  }

  async function handleApplyTremolo(settings: TremoloSettings) {
    if (!project || !quantizedGeneratorSelection || isApplyingTremolo) return;
    setIsApplyingTremolo(true);
    try {
      const activeSelection = quantizedGeneratorSelection;
      const targets = await collectEffectTargets(activeSelection);
      if (targets.length === 0) {
        toast.info('选区内没有可处理的音频');
        return;
      }
      const before = {
        ...(JSON.parse(JSON.stringify(project)) as IProject),
        selection: activeSelection,
      };
      const changed = await projectService.tremoloSelectionOnTracks(
        project.id,
        activeSelection,
        settings,
        targets,
      );
      const updated = await projectService.getProject(project.id);
      if (!updated) throw new Error('应用 Tremolo 后无法重新读取工程');
      setProject(updated);
      setSelection(updated.selection);
      pushHistoryCmd({
        id: generateId(),
        label: 'Tremolo',
        execute: () => updated,
        undo: () => before,
      }, before);
      updateHistoryState();
      setTremoloDialogOpen(false);
      toast.success(`已对 ${changed} 个片段应用 Tremolo`);
    } catch (error) {
      logger.error('应用 Tremolo 失败:', String(error));
      toast.error(error instanceof Error ? `应用 Tremolo 失败：${error.message}` : '应用 Tremolo 失败');
    } finally {
      setIsApplyingTremolo(false);
    }
  }

  async function handleVocoderPreview(settings: VocoderSettings): Promise<Float32Array[]> {
    if (!project || !quantizedGeneratorSelection) throw new Error('请先选择要试听的音频');
    const activeSelection = quantizedGeneratorSelection;
    const targets = await collectEffectTargets(activeSelection);
    const target = targets[0];
    if (!target) throw new Error('选区内没有可试听的音频');
    const segments: Float32Array[][] = [];
    for (const input of target.clips) {
      const sourceTrack = project.tracks.find((track) => track.id === target.trackId);
      const clip = sourceTrack?.clips.find((candidate) => candidate.id === input.clipId);
      if (!clip) throw new Error('试听片段不可用');
      const range = getClipSampleRange(
        clip,
        activeSelection,
        input.sourceOffset,
        project.sampleRate,
        input.sampleData[0]?.length ?? 0,
      );
      if (!range) throw new Error('试听区间无效');
      const selectedChannels = input.sampleData.map((channel) => channel.slice(range.startSample, range.endSample));
      segments.push(processVocoderChannels(selectedChannels, settings, project.sampleRate));
    }
    const totalLength = segments.reduce((total, segment) => total + (segment[0]?.length ?? 0), 0);
    const preview = Array.from({ length: segments[0]?.length ?? 0 }, () => new Float32Array(totalLength));
    let offset = 0;
    for (const segment of segments) {
      for (let channelIndex = 0; channelIndex < segment.length; channelIndex += 1) {
        preview[channelIndex].set(segment[channelIndex], offset);
      }
      offset += segment[0]?.length ?? 0;
    }
    return preview;
  }

  async function handleApplyVocoder(settings: VocoderSettings) {
    if (!project || !quantizedGeneratorSelection || isApplyingVocoder) return;
    setIsApplyingVocoder(true);
    try {
      const activeSelection = quantizedGeneratorSelection;
      const targets = await collectEffectTargets(activeSelection);
      if (targets.length === 0) {
        toast.info('选区内没有可处理的音频');
        return;
      }
      const before = {
        ...(JSON.parse(JSON.stringify(project)) as IProject),
        selection: activeSelection,
      };
      const changed = await projectService.vocoderSelectionOnTracks(
        project.id,
        activeSelection,
        settings,
        targets,
      );
      const updated = await projectService.getProject(project.id);
      if (!updated) throw new Error('应用 Vocoder 后无法重新读取工程');
      setProject(updated);
      setSelection(updated.selection);
      pushHistoryCmd({
        id: generateId(),
        label: 'Vocoder',
        execute: () => updated,
        undo: () => before,
      }, before);
      updateHistoryState();
      setVocoderDialogOpen(false);
      toast.success(`已对 ${changed} 个片段应用 Vocoder`);
    } catch (error) {
      logger.error('应用 Vocoder 失败:', String(error));
      toast.error(error instanceof Error ? `应用 Vocoder 失败：${error.message}` : '应用 Vocoder 失败');
    } finally {
      setIsApplyingVocoder(false);
    }
  }

  async function handleAutoDuckPreview(
    settings: AutoDuckSettings,
    controlTrackId: string,
  ): Promise<Float32Array[]> {
    if (!project || !quantizedGeneratorSelection) throw new Error('请先选择要试听的音频');
    const activeSelection = quantizedGeneratorSelection;
    const targets = await collectEffectTargets(activeSelection);
    const control = targets.find((target) => target.trackId === controlTrackId);
    const target = targets.find((candidate) => candidate.trackId !== controlTrackId);
    if (!control) throw new Error('Auto Duck 控制轨不在选区音频中');
    if (!target) throw new Error('选区内没有可试听的非控制轨音频');
    const controlTrack = project.tracks.find((track) => track.id === control.trackId);
    const sourceTrack = project.tracks.find((track) => track.id === target.trackId);
    if (!controlTrack || !sourceTrack) throw new Error('Auto Duck 试听轨道不可用');
    const controlChannels = renderAutoDuckSelectionChannels(
      control.clips.map((input) => {
        const clip = controlTrack.clips.find((candidate) => candidate.id === input.clipId);
        if (!clip) throw new Error('Auto Duck 控制片段不可用');
        return {
          startTime: clip.startTime,
          duration: clip.duration,
          sourceOffset: input.sourceOffset,
          sampleData: input.sampleData,
        };
      }),
      activeSelection,
      project.sampleRate,
    );
    const plan = createAutoDuckPlan(controlChannels[0], settings, project.sampleRate);
    const segments: Float32Array[][] = [];
    for (const input of target.clips) {
      const clip = sourceTrack.clips.find((candidate) => candidate.id === input.clipId);
      if (!clip) throw new Error('Auto Duck 试听片段不可用');
      const placement = getAutoDuckTimelinePlacement(
        clip,
        activeSelection,
        input.sourceOffset,
        project.sampleRate,
        input.sampleData[0]?.length ?? 0,
      );
      if (!placement) continue;
      const selectedChannels = input.sampleData.map((channel) => (
        channel.slice(placement.startSample, placement.endSample)
      ));
      segments.push(applyAutoDuckPlanToChannels(
        selectedChannels,
        plan,
        settings,
        project.sampleRate,
        placement.timelineSample,
      ));
    }
    const totalLength = segments.reduce((total, segment) => total + (segment[0]?.length ?? 0), 0);
    const channelCount = segments.reduce((maximum, segment) => Math.max(maximum, segment.length), 0);
    if (totalLength === 0 || channelCount === 0) throw new Error('选区内没有可试听的采样');
    const preview = Array.from({ length: channelCount }, () => new Float32Array(totalLength));
    let destinationOffset = 0;
    for (const segment of segments) {
      const length = segment[0]?.length ?? 0;
      preview.forEach((channel, channelIndex) => {
        const source = segment[channelIndex];
        if (source) channel.set(source, destinationOffset);
      });
      destinationOffset += length;
    }
    return preview;
  }

  async function handleApplyAutoDuck(settings: AutoDuckSettings, controlTrackId: string) {
    if (!project || !quantizedGeneratorSelection || isApplyingAutoDuck) return;
    setIsApplyingAutoDuck(true);
    try {
      const activeSelection = quantizedGeneratorSelection;
      const targets = await collectEffectTargets(activeSelection);
      if (targets.length < 2) {
        toast.info('Auto Duck 需要选区内至少两条含音频轨道');
        return;
      }
      const before = {
        ...(JSON.parse(JSON.stringify(project)) as IProject),
        selection: activeSelection,
      };
      const changed = await projectService.autoDuckSelectionOnTracks(
        project.id,
        activeSelection,
        settings,
        targets,
        controlTrackId,
      );
      if (changed === 0) {
        toast.info('控制轨未超过阈值，未修改任何音频');
        return;
      }
      const updated = await projectService.getProject(project.id);
      if (!updated) throw new Error('应用 Auto Duck 后无法重新读取工程');
      setProject(updated);
      setSelection(updated.selection);
      pushHistoryCmd({
        id: generateId(),
        label: 'Auto Duck',
        execute: () => updated,
        undo: () => before,
      }, before);
      updateHistoryState();
      setAutoDuckDialogOpen(false);
      toast.success(`已对 ${changed} 个片段应用 Auto Duck，控制轨未修改`);
    } catch (error) {
      logger.error('应用 Auto Duck 失败:', String(error));
      toast.error(error instanceof Error ? `应用 Auto Duck 失败：${error.message}` : '应用 Auto Duck 失败');
    } finally {
      setIsApplyingAutoDuck(false);
    }
  }

  async function handleBassTreblePreview(settings: BassTrebleSettings): Promise<Float32Array[]> {
    if (!project || !quantizedGeneratorSelection) throw new Error('请先选择要试听的音频');
    const activeSelection = quantizedGeneratorSelection;
    const targets = await collectEffectTargets(activeSelection);
    const target = targets[0];
    if (!target) throw new Error('选区内没有可试听的音频');
    const sourceTrack = project.tracks.find((track) => track.id === target.trackId);
    if (!sourceTrack) throw new Error('试听轨道不可用');
    const states = target.clips[0]?.sampleData.map(() => (
      createBassTrebleState(settings, project.sampleRate)
    )) ?? [];
    const segments: Float32Array[][] = [];

    for (const input of target.clips) {
      const clip = sourceTrack.clips.find((candidate) => candidate.id === input.clipId);
      if (!clip) throw new Error('试听片段不可用');
      const range = getClipSampleRange(
        clip,
        activeSelection,
        input.sourceOffset,
        project.sampleRate,
        input.sampleData[0]?.length ?? 0,
      );
      if (!range) continue;
      const selectedChannels = input.sampleData.map((channel) => (
        channel.slice(range.startSample, range.endSample)
      ));
      segments.push(processBassTrebleChannels(
        selectedChannels,
        settings,
        project.sampleRate,
        states,
      ));
    }

    const totalLength = segments.reduce((total, segment) => total + (segment[0]?.length ?? 0), 0);
    const channelCount = segments.reduce((maximum, segment) => Math.max(maximum, segment.length), 0);
    if (totalLength === 0 || channelCount === 0) throw new Error('选区内没有可试听的采样');
    const preview = Array.from({ length: channelCount }, () => new Float32Array(totalLength));
    let destinationOffset = 0;
    for (const segment of segments) {
      const length = segment[0]?.length ?? 0;
      preview.forEach((channel, channelIndex) => {
        const source = segment[channelIndex];
        if (source) channel.set(source, destinationOffset);
      });
      destinationOffset += length;
    }
    return preview;
  }

  async function handleApplyBassTreble(settings: BassTrebleSettings) {
    if (!project || !quantizedGeneratorSelection) return;
    setIsApplyingBassTreble(true);
    try {
      const activeSelection = quantizedGeneratorSelection;
      const targets = await collectEffectTargets(activeSelection);
      if (targets.length === 0) {
        toast.info('选区内没有可处理的音频');
        return;
      }
      const before = JSON.parse(JSON.stringify(project)) as IProject;
      const changed = await projectService.bassTrebleSelectionOnTracks(
        project.id,
        activeSelection,
        settings,
        targets,
      );
      const updated = await projectService.getProject(project.id);
      if (!updated) throw new Error('应用低音和高音后无法重新读取工程');
      setProject(updated);
      pushHistoryCmd({
        id: generateId(),
        label: '低音和高音',
        execute: () => updated,
        undo: () => before,
      });
      updateHistoryState();
      setBassTrebleDialogOpen(false);
      toast.success(`已对 ${changed} 个片段应用低音和高音`);
    } catch (error) {
      logger.error('应用低音和高音失败:', String(error));
      toast.error(error instanceof Error ? `应用低音和高音失败：${error.message}` : '应用低音和高音失败');
    } finally {
      setIsApplyingBassTreble(false);
    }
  }

  async function handleReverbPreview(settings: ReverbSettings): Promise<Float32Array[]> {
    if (!project || !quantizedGeneratorSelection) throw new Error('请先选择要试听的音频');
    const activeSelection = quantizedGeneratorSelection;
    const targets = await collectEffectTargets(activeSelection);
    const target = targets[0];
    if (!target) throw new Error('选区内没有可试听的音频');
    const sourceTrack = project.tracks.find((track) => track.id === target.trackId);
    if (!sourceTrack) throw new Error('试听轨道不可用');
    const channelCount = target.clips[0]?.sampleData.length ?? 0;
    const state = createReverbState(settings, project.sampleRate, channelCount);
    const segments: Float32Array[][] = [];

    for (const input of target.clips) {
      const clip = sourceTrack.clips.find((candidate) => candidate.id === input.clipId);
      if (!clip) throw new Error('试听片段不可用');
      const range = getClipSampleRange(
        clip,
        activeSelection,
        input.sourceOffset,
        project.sampleRate,
        input.sampleData[0]?.length ?? 0,
      );
      if (!range) continue;
      const selectedChannels = input.sampleData.map((channel) => (
        channel.slice(range.startSample, range.endSample)
      ));
      segments.push(processReverbChannels(selectedChannels, settings, project.sampleRate, state));
    }

    const totalLength = segments.reduce((total, segment) => total + (segment[0]?.length ?? 0), 0);
    const previewChannelCount = segments.reduce((maximum, segment) => Math.max(maximum, segment.length), 0);
    if (totalLength === 0 || previewChannelCount === 0) throw new Error('选区内没有可试听的采样');
    const preview = Array.from({ length: previewChannelCount }, () => new Float32Array(totalLength));
    let destinationOffset = 0;
    for (const segment of segments) {
      const length = segment[0]?.length ?? 0;
      preview.forEach((channel, channelIndex) => {
        const source = segment[channelIndex];
        if (source) channel.set(source, destinationOffset);
      });
      destinationOffset += length;
    }
    return preview;
  }

  async function handleApplyReverb(settings: ReverbSettings) {
    if (!project || !quantizedGeneratorSelection) return;
    setIsApplyingReverb(true);
    try {
      const activeSelection = quantizedGeneratorSelection;
      const targets = await collectEffectTargets(activeSelection);
      if (targets.length === 0) {
        toast.info('选区内没有可处理的音频');
        return;
      }
      const before = JSON.parse(JSON.stringify(project)) as IProject;
      const changed = await projectService.reverbSelectionOnTracks(
        project.id,
        activeSelection,
        settings,
        targets,
      );
      const updated = await projectService.getProject(project.id);
      if (!updated) throw new Error('应用 Reverb 后无法重新读取工程');
      setProject(updated);
      pushHistoryCmd({
        id: generateId(),
        label: 'Reverb 混响',
        execute: () => updated,
        undo: () => before,
      });
      updateHistoryState();
      setReverbDialogOpen(false);
      toast.success(`已对 ${changed} 个片段应用 Reverb 混响`);
    } catch (error) {
      logger.error('应用 Reverb 失败:', String(error));
      toast.error(error instanceof Error ? `应用 Reverb 失败：${error.message}` : '应用 Reverb 失败');
    } finally {
      setIsApplyingReverb(false);
    }
  }

  async function handleDistortionPreview(settings: DistortionSettings): Promise<Float32Array[]> {
    if (!project || !quantizedGeneratorSelection) throw new Error('请先选择要试听的音频');
    const activeSelection = quantizedGeneratorSelection;
    const targets = await collectEffectTargets(activeSelection);
    const target = targets[0];
    if (!target) throw new Error('选区内没有可试听的音频');
    const sourceTrack = project.tracks.find((track) => track.id === target.trackId);
    if (!sourceTrack) throw new Error('试听轨道不可用');
    const channelCount = target.clips[0]?.sampleData.length ?? 0;
    const state = createDistortionState(settings, project.sampleRate, channelCount);
    const segments: Float32Array[][] = [];

    for (const input of target.clips) {
      const clip = sourceTrack.clips.find((candidate) => candidate.id === input.clipId);
      if (!clip) throw new Error('试听片段不可用');
      const range = getClipSampleRange(
        clip,
        activeSelection,
        input.sourceOffset,
        project.sampleRate,
        input.sampleData[0]?.length ?? 0,
      );
      if (!range) continue;
      const selectedChannels = input.sampleData.map((channel) => (
        channel.slice(range.startSample, range.endSample)
      ));
      segments.push(processDistortionChannels(selectedChannels, settings, project.sampleRate, state));
    }

    const totalLength = segments.reduce((total, segment) => total + (segment[0]?.length ?? 0), 0);
    const previewChannelCount = segments.reduce((maximum, segment) => Math.max(maximum, segment.length), 0);
    if (totalLength === 0 || previewChannelCount === 0) throw new Error('选区内没有可试听的采样');
    const preview = Array.from({ length: previewChannelCount }, () => new Float32Array(totalLength));
    let destinationOffset = 0;
    for (const segment of segments) {
      const length = segment[0]?.length ?? 0;
      preview.forEach((channel, channelIndex) => {
        const source = segment[channelIndex];
        if (source) channel.set(source, destinationOffset);
      });
      destinationOffset += length;
    }
    return preview;
  }

  async function handleApplyDistortion(settings: DistortionSettings) {
    if (!project || !quantizedGeneratorSelection) return;
    setIsApplyingDistortion(true);
    try {
      const activeSelection = quantizedGeneratorSelection;
      const targets = await collectEffectTargets(activeSelection);
      if (targets.length === 0) {
        toast.info('选区内没有可处理的音频');
        return;
      }
      const before = JSON.parse(JSON.stringify(project)) as IProject;
      const changed = await projectService.distortionSelectionOnTracks(
        project.id,
        activeSelection,
        settings,
        targets,
      );
      const updated = await projectService.getProject(project.id);
      if (!updated) throw new Error('应用 Distortion 后无法重新读取工程');
      setProject(updated);
      pushHistoryCmd({
        id: generateId(),
        label: 'Distortion 失真',
        execute: () => updated,
        undo: () => before,
      });
      updateHistoryState();
      setDistortionDialogOpen(false);
      toast.success(`已对 ${changed} 个片段应用 Distortion 失真`);
    } catch (error) {
      logger.error('应用 Distortion 失败:', String(error));
      toast.error(error instanceof Error ? `应用 Distortion 失败：${error.message}` : '应用 Distortion 失败');
    } finally {
      setIsApplyingDistortion(false);
    }
  }

  async function handleCompressorPreview(settings: CompressorSettings): Promise<Float32Array[]> {
    if (!project || !quantizedGeneratorSelection) throw new Error('请先选择要试听的音频');
    const activeSelection = quantizedGeneratorSelection;
    const targets = await collectEffectTargets(activeSelection);
    const target = targets[0];
    if (!target) throw new Error('选区内没有可试听的音频');
    const sourceTrack = project.tracks.find((track) => track.id === target.trackId);
    if (!sourceTrack) throw new Error('试听轨道不可用');
    const channelCount = target.clips[0]?.sampleData.length ?? 0;
    const segments: { channels: Float32Array[]; start: number; end: number }[] = [];

    for (const input of target.clips) {
      const clip = sourceTrack.clips.find((candidate) => candidate.id === input.clipId);
      if (!clip) throw new Error('试听片段不可用');
      const range = getClipSampleRange(
        clip,
        activeSelection,
        input.sourceOffset,
        project.sampleRate,
        input.sampleData[0]?.length ?? 0,
      );
      if (!range) continue;
      if (input.sampleData.length !== channelCount) throw new Error('试听片段的声道数不一致');
      segments.push({
        channels: input.sampleData.map((channel) => channel.slice(range.startSample, range.endSample)),
        start: range.startSample,
        end: range.endSample,
      });
    }

    const totalLength = segments.reduce((total, segment) => total + segment.end - segment.start, 0);
    if (totalLength === 0 || channelCount === 0) throw new Error('选区内没有可试听的采样');
    const selected = Array.from({ length: channelCount }, () => new Float32Array(totalLength));
    let destinationOffset = 0;
    for (const segment of segments) {
      const length = segment.end - segment.start;
      selected.forEach((channel, channelIndex) => channel.set(segment.channels[channelIndex], destinationOffset));
      destinationOffset += length;
    }
    // Preview uses the same per-track concatenation and one-time latency compensation as Apply.
    return processCompressorChannels(selected, settings, project.sampleRate);
  }

  async function handleApplyCompressor(settings: CompressorSettings) {
    if (!project || !quantizedGeneratorSelection || isApplyingCompressor) return;
    setIsApplyingCompressor(true);
    try {
      const activeSelection = quantizedGeneratorSelection;
      const targets = await collectEffectTargets(activeSelection);
      if (targets.length === 0) {
        toast.info('选区内没有可处理的音频');
        return;
      }
      const before = {
        ...(JSON.parse(JSON.stringify(project)) as IProject),
        selection: activeSelection,
      };
      const changed = await projectService.compressorSelectionOnTracks(
        project.id,
        activeSelection,
        settings,
        targets,
      );
      if (changed === 0) {
        setCompressorDialogOpen(false);
        toast.info('Compressor 参数为直通，未修改音频');
        return;
      }
      const updated = await projectService.getProject(project.id);
      if (!updated) throw new Error('应用 Compressor 后无法重新读取工程');
      setProject(updated);
      setSelection(updated.selection);
      pushHistoryCmd({
        id: generateId(),
        label: 'Compressor 压缩器',
        execute: () => updated,
        undo: () => before,
      }, before);
      updateHistoryState();
      setCompressorDialogOpen(false);
      toast.success(`已对 ${changed} 个片段应用 Compressor 压缩器`);
    } catch (error) {
      logger.error('应用 Compressor 失败:', String(error));
      toast.error(error instanceof Error ? `应用 Compressor 失败：${error.message}` : '应用 Compressor 失败');
    } finally {
      setIsApplyingCompressor(false);
    }
  }

  async function handleApplyLegacyCompressor(legacySettings: LegacyCompressorSettings = DEFAULT_LEGACY_COMPRESSOR_SETTINGS) {
    if (!project || !quantizedGeneratorSelection) return;
    const activeSelection = quantizedGeneratorSelection;
    const targets = await collectEffectTargets(activeSelection);
    if (targets.length === 0) {
      toast.info('选区内没有可处理的音频');
      return;
    }
    const before = {
      ...(JSON.parse(JSON.stringify(project)) as IProject),
      selection: activeSelection,
    };
    const changed = await projectService.legacyCompressorSelectionOnTracks(
      project.id,
      activeSelection,
      legacySettings,
      targets,
    );
    const updated = await projectService.getProject(project.id);
    if (!updated) throw new Error('应用 Legacy Compressor 后无法重新读取工程');
    setProject(updated);
    setSelection(updated.selection);
    pushHistoryCmd({
      id: generateId(),
      label: 'Legacy Compressor 旧版压缩器',
      execute: () => updated,
      undo: () => before,
    }, before);
    updateHistoryState();
    toast.success(`已对 ${changed} 个片段应用 Legacy Compressor`);
  }

  async function handleApplyNoiseGate(gateSettings: NoiseGateSettings = DEFAULT_NOISE_GATE_SETTINGS) {
    if (!project || !quantizedGeneratorSelection) return;
    const activeSelection = quantizedGeneratorSelection;
    const targets = await collectEffectTargets(activeSelection);
    if (targets.length === 0) {
      toast.info('选区内没有可处理的音频');
      return;
    }
    const before = {
      ...(JSON.parse(JSON.stringify(project)) as IProject),
      selection: activeSelection,
    };
    const changed = await projectService.noiseGateSelectionOnTracks(
      project.id,
      activeSelection,
      gateSettings,
      targets,
    );
    const updated = await projectService.getProject(project.id);
    if (!updated) throw new Error('应用 Noise Gate 后无法重新读取工程');
    setProject(updated);
    setSelection(updated.selection);
    pushHistoryCmd({
      id: generateId(),
      label: 'Noise Gate 噪声门',
      execute: () => updated,
      undo: () => before,
    }, before);
    updateHistoryState();
    toast.success(`已对 ${changed} 个片段应用 Noise Gate`);
  }

  async function handleLimiterPreview(settings: LimiterSettings): Promise<LimiterPreview> {
    if (!project || !quantizedGeneratorSelection) throw new Error('请先选择要试听的音频');
    const activeSelection = quantizedGeneratorSelection;
    const targets = await collectEffectTargets(activeSelection);
    const target = targets[0];
    if (!target) throw new Error('选区内没有可试听的音频');
    const sourceTrack = project.tracks.find((track) => track.id === target.trackId);
    if (!sourceTrack) throw new Error('试听轨道不可用');
    const channelCount = target.clips[0]?.sampleData.length ?? 0;
    const segments: { channels: Float32Array[]; start: number; end: number }[] = [];

    for (const input of target.clips) {
      const clip = sourceTrack.clips.find((candidate) => candidate.id === input.clipId);
      if (!clip) throw new Error('试听片段不可用');
      const range = getClipSampleRange(
        clip,
        activeSelection,
        input.sourceOffset,
        project.sampleRate,
        input.sampleData[0]?.length ?? 0,
      );
      if (!range) continue;
      if (input.sampleData.length !== channelCount) throw new Error('试听片段的声道数不一致');
      segments.push({
        channels: input.sampleData.map((channel) => channel.slice(range.startSample, range.endSample)),
        start: range.startSample,
        end: range.endSample,
      });
    }

    const totalLength = segments.reduce((total, segment) => total + segment.end - segment.start, 0);
    if (totalLength === 0 || channelCount === 0) throw new Error('选区内没有可试听的采样');
    const selected = Array.from({ length: channelCount }, () => new Float32Array(totalLength));
    let destinationOffset = 0;
    for (const segment of segments) {
      const length = segment.end - segment.start;
      selected.forEach((channel, channelIndex) => channel.set(segment.channels[channelIndex], destinationOffset));
      destinationOffset += length;
    }
    return {
      inputChannels: selected,
      channels: processLimiterChannels(selected, settings, project.sampleRate),
    };
  }

  async function handleApplyLimiter(settings: LimiterSettings) {
    if (!project || !quantizedGeneratorSelection || isApplyingLimiter) return;
    setIsApplyingLimiter(true);
    try {
      const activeSelection = quantizedGeneratorSelection;
      const targets = await collectEffectTargets(activeSelection);
      if (targets.length === 0) {
        toast.info('选区内没有可处理的音频');
        return;
      }
      const before = {
        ...(JSON.parse(JSON.stringify(project)) as IProject),
        selection: activeSelection,
      };
      const changed = await projectService.limiterSelectionOnTracks(
        project.id,
        activeSelection,
        settings,
        targets,
      );
      const updated = await projectService.getProject(project.id);
      if (!updated) throw new Error('应用 Limiter 后无法重新读取工程');
      setProject(updated);
      setSelection(updated.selection);
      pushHistoryCmd({
        id: generateId(),
        label: 'Limiter 限制器',
        execute: () => updated,
        undo: () => before,
      }, before);
      updateHistoryState();
      setLimiterDialogOpen(false);
      toast.success(`已对 ${changed} 个片段应用 Limiter 限制器`);
    } catch (error) {
      logger.error('应用 Limiter 失败:', String(error));
      toast.error(error instanceof Error ? `应用 Limiter 失败：${error.message}` : '应用 Limiter 失败');
    } finally {
      setIsApplyingLimiter(false);
    }
  }

  async function handleLegacyLimiterPreview(settings: LegacyLimiterSettings): Promise<Float32Array[]> {
    if (!project || !quantizedGeneratorSelection) throw new Error('请先选择要试听的音频');
    const activeSelection = quantizedGeneratorSelection;
    const targets = await collectEffectTargets(activeSelection);
    const target = targets[0];
    if (!target) throw new Error('选区内没有可试听的音频');
    const sourceTrack = project.tracks.find((track) => track.id === target.trackId);
    if (!sourceTrack) throw new Error('试听轨道不可用');
    const channelCount = target.clips[0]?.sampleData.length ?? 0;
    const segments: { channels: Float32Array[]; start: number; end: number }[] = [];
    for (const input of target.clips) {
      const clip = sourceTrack.clips.find((candidate) => candidate.id === input.clipId);
      if (!clip) throw new Error('试听片段不可用');
      const range = getClipSampleRange(
        clip,
        activeSelection,
        input.sourceOffset,
        project.sampleRate,
        input.sampleData[0]?.length ?? 0,
      );
      if (!range) continue;
      if (input.sampleData.length !== channelCount) throw new Error('试听片段的声道数不一致');
      segments.push({
        channels: input.sampleData.map((channel) => channel.slice(range.startSample, range.endSample)),
        start: range.startSample,
        end: range.endSample,
      });
    }
    const totalLength = segments.reduce((total, segment) => total + segment.end - segment.start, 0);
    if (totalLength === 0 || channelCount === 0) throw new Error('选区内没有可试听的采样');
    const selected = Array.from({ length: channelCount }, () => new Float32Array(totalLength));
    let destinationOffset = 0;
    for (const segment of segments) {
      const length = segment.end - segment.start;
      selected.forEach((channel, channelIndex) => channel.set(segment.channels[channelIndex], destinationOffset));
      destinationOffset += length;
    }
    return processLegacyLimiterChannels(selected, settings, project.sampleRate);
  }

  async function handleApplyLegacyLimiter(settings: LegacyLimiterSettings) {
    if (!project || !quantizedGeneratorSelection || isApplyingLegacyLimiter) return;
    setIsApplyingLegacyLimiter(true);
    try {
      const activeSelection = quantizedGeneratorSelection;
      const targets = await collectEffectTargets(activeSelection);
      if (targets.length === 0) {
        toast.info('选区内没有可处理的音频');
        return;
      }
      const before = {
        ...(JSON.parse(JSON.stringify(project)) as IProject),
        selection: activeSelection,
      };
      const changed = await projectService.legacyLimiterSelectionOnTracks(
        project.id,
        activeSelection,
        settings,
        targets,
      );
      const updated = await projectService.getProject(project.id);
      if (!updated) throw new Error('应用 Legacy limiter 后无法重新读取工程');
      setProject(updated);
      setSelection(updated.selection);
      pushHistoryCmd({
        id: generateId(),
        label: 'Legacy limiter 旧版限制器',
        execute: () => updated,
        undo: () => before,
      }, before);
      updateHistoryState();
      setLegacyLimiterDialogOpen(false);
      toast.success(`已对 ${changed} 个片段应用 Legacy limiter 旧版限制器`);
    } catch (error) {
      logger.error('应用 Legacy limiter 失败:', String(error));
      toast.error(error instanceof Error ? `应用 Legacy limiter 失败：${error.message}` : '应用 Legacy limiter 失败');
    } finally {
      setIsApplyingLegacyLimiter(false);
    }
  }

  // Effect operations
  async function addEffect(trackId: string, type: EffectType): Promise<IEffect | null> {
    if (!project) return null;
    const projectId = project.id;
    const generation = projectLoadGenerationRef.current;
    const isCurrentAction = () => projectLoadGenerationRef.current === generation;
    try {
      const result = await projectService.addEffectToTrack(projectId, trackId, type);
      if (!result || !isCurrentAction()) return null;
      setProject(result.after);
      pushHistoryCmd({
        id: generateId(),
        label: `添加${getEffectLabel(type)}`,
        execute: () => result.after,
        undo: () => result.before,
      }, result.before);
      return result.effect;
    } catch (error) {
      if (!isCurrentAction()) return null;
      logger.error('Add realtime effect failed', error);
      toast.error(`添加效果失败：${error instanceof Error ? error.message : '未知错误'}`);
      return null;
    }
  }

  async function updateEffectParams(trackId: string, effectId: string, params: Record<string, number>) {
    if (!project) return;
    const projectId = project.id;
    const generation = projectLoadGenerationRef.current;
    try {
      const result = await projectService.updateEffect(projectId, trackId, effectId, { params });
      if (!result || projectLoadGenerationRef.current !== generation) return;
      setProject(result.after);
    } catch (error) {
      if (projectLoadGenerationRef.current !== generation) return;
      logger.error('Update realtime effect parameters failed', error);
      toast.error(`更新效果参数失败：${error instanceof Error ? error.message : '未知错误'}`);
    }
  }

  async function toggleEffectBypass(trackId: string, effectId: string) {
    if (!project) return;
    const projectId = project.id;
    const generation = projectLoadGenerationRef.current;
    try {
      const result = await projectService.toggleEffectBypass(projectId, trackId, effectId);
      if (!result || projectLoadGenerationRef.current !== generation) return;
      setProject(result.after);
    } catch (error) {
      if (projectLoadGenerationRef.current !== generation) return;
      logger.error('Toggle realtime effect bypass failed', error);
      toast.error(`切换效果旁路失败：${error instanceof Error ? error.message : '未知错误'}`);
    }
  }

  async function removeEffect(trackId: string, effectId: string) {
    if (!project) return;
    const projectId = project.id;
    const generation = projectLoadGenerationRef.current;
    const isCurrentAction = () => projectLoadGenerationRef.current === generation;
    try {
      const result = await projectService.removeEffectFromTrack(projectId, trackId, effectId);
      if (!result || !isCurrentAction()) return;
      setProject(result.after);
      pushHistoryCmd({
        id: generateId(),
        label: `移除${getEffectLabel(result.removed.type)}`,
        execute: () => result.after,
        undo: () => result.before,
      }, result.before);
    } catch (error) {
      if (!isCurrentAction()) return;
      logger.error('Remove realtime effect failed', error);
      toast.error(`移除效果失败：${error instanceof Error ? error.message : '未知错误'}`);
    }
  }

  async function toggleAllEffects(trackId: string, active: boolean) {
    if (!project) return;
    const projectId = project.id;
    const generation = projectLoadGenerationRef.current;
    const isCurrentAction = () => projectLoadGenerationRef.current === generation;
    try {
      const result = await projectService.setTrackEffectsActive(projectId, trackId, active);
      if (!result || !isCurrentAction()) return;
      setProject(result.after);
      pushHistoryCmd({
        id: generateId(),
        label: active ? '启用全部轨道效果' : '关闭全部轨道效果',
        execute: () => result.after,
        undo: () => result.before,
      }, result.before);
    } catch (error) {
      if (!isCurrentAction()) return;
      logger.error('Toggle all track effects failed', error);
      toast.error(`切换全部效果失败：${error instanceof Error ? error.message : '未知错误'}`);
    }
  }

  async function moveEffect(trackId: string, effectId: string, toIndex: number) {
    if (!project) return;
    const projectId = project.id;
    const generation = projectLoadGenerationRef.current;
    const isCurrentAction = () => projectLoadGenerationRef.current === generation;
    try {
      const result = await projectService.moveEffectToIndex(projectId, trackId, effectId, toIndex);
      if (!result || !isCurrentAction()) return;
      setProject(result.after);
      pushHistoryCmd({
        id: generateId(),
        label: '调整效果顺序',
        execute: () => result.after,
        undo: () => result.before,
      }, result.before);
    } catch (error) {
      if (!isCurrentAction()) return;
      logger.error('Move realtime effect failed', error);
      toast.error(`调整效果顺序失败：${error instanceof Error ? error.message : '未知错误'}`);
    }
  }

  async function replaceEffect(trackId: string, effectId: string, type: EffectType): Promise<IEffect | null> {
    if (!project) return null;
    const projectId = project.id;
    const generation = projectLoadGenerationRef.current;
    const isCurrentAction = () => projectLoadGenerationRef.current === generation;
    try {
      const result = await projectService.replaceEffectOnTrack(projectId, trackId, effectId, type);
      if (!result || !isCurrentAction()) return null;
      const previousType = result.before.tracks
        .find((track) => track.id === trackId)?.effects
        .find((effect) => effect.id === effectId)?.type;
      setProject(result.after);
      pushHistoryCmd({
        id: generateId(),
        label: `将${previousType ? getEffectLabel(previousType) : '效果'}替换为${getEffectLabel(type)}`,
        execute: () => result.after,
        undo: () => result.before,
      }, result.before);
      return result.replacement;
    } catch (error) {
      if (!isCurrentAction()) return null;
      logger.error('Replace realtime effect failed', error);
      toast.error(`替换效果失败：${error instanceof Error ? error.message : '未知错误'}`);
      return null;
    }
  }

  // Selection handling from canvas
  function handleSelectionChange(start: number, end: number, trackId?: string) {
    if (trackId) setSelectedTrackId(trackId);
    const nextSelection = start === end
      ? null
      : { start: Math.min(start, end), end: Math.max(start, end) };
    setSelection(nextSelection);
    setSpectralSelection(null);
    setProject((current) => current
      ? { ...current, selection: nextSelection, spectralSelection: null }
      : current);
  }

  function handleSpectralSelectionChange(
    start: number,
    end: number,
    firstHz: number,
    secondHz: number,
  ) {
    if (!project) return;
    if (!isSpectralSelectionEnabled()) {
      handleSelectionChange(start, end, selectedTrackId ?? undefined);
      return;
    }
    const nextSelection = start === end
      ? null
      : { start: Math.min(start, end), end: Math.max(start, end) };
    const nextFrequency = nextSelection
      ? normalizeFrequencySelection(
        { lowHz: firstHz, highHz: secondHz },
        project.sampleRate,
        getTrackSpectrogramSettings(
          project.tracks.find((track) => track.id === selectedTrackId) ?? project.tracks[0],
          project.sampleRate,
        ),
      )
      : null;
    const committedSelection = nextFrequency ? nextSelection : null;
    setSelection(committedSelection);
    setSpectralSelection(nextFrequency);
    setProject((current) => current
      ? { ...current, selection: committedSelection, spectralSelection: nextFrequency }
      : current);
  }

  function clearSelection() {
    setSelection(null);
    setSpectralSelection(null);
    setProject((current) => current
      ? { ...current, selection: null, spectralSelection: null }
      : current);
  }

  function handleCursorChange(pos: number) {
    setCursorPosition(pos);
    audioEngine.seek(pos);
  }

  // Drag and drop
  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    setIsDragOver(true);
  }

  function handleDragLeave() {
    setIsDragOver(false);
  }

  async function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragOver(false);
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      await handleFiles(files);
    }
  }

  // Helpers
  function getProjectDuration(source: IProject | null = project): number {
    if (!source) return 0;
    let maxEnd = 0;
    for (const track of source.tracks) {
      for (const clip of track.clips) {
        const end = clip.startTime + clip.duration;
        if (end > maxEnd) maxEnd = end;
      }
    }
    return maxEnd;
  }

  function getEffectLabel(type: EffectType): string {
    const labels: Record<EffectType, string> = {
      gain: '增益',
      highPass: '高通滤波',
      lowPass: '低通滤波',
      eq: '均衡器',
      compressor: '压缩器',
      reverb: '混响',
      delay: '延迟',
      noiseGate: '噪声门',
    };
    return labels[type] || type;
  }

  // Selection edit operations
  async function storeProjectBuffer(
    projectId: string,
    channels: Float32Array[],
    sampleRate: number,
    bufferId = generateId(),
  ): Promise<string> {
    if (channels.length === 0 || channels[0].length === 0) throw new Error('Cannot store an empty audio buffer');
    const length = channels[0].length;
    if (channels.some((channel) => channel.length !== length)) {
      throw new Error('Audio channels must have equal lengths');
    }
    await audioDb.audioBuffers.put({
      id: bufferId,
      projectId,
      sampleRate,
      channels: channels.length,
      length,
      duration: length / sampleRate,
      channelData: channels.map((channel) =>
        channel.buffer.slice(channel.byteOffset, channel.byteOffset + channel.byteLength) as ArrayBuffer,
      ),
      createdAt: Date.now(),
    });
    audioEngine.cacheBuffer(bufferId, channels, sampleRate);
    return bufferId;
  }

  async function discardUncommittedProjectBuffer(bufferId: string): Promise<void> {
    const cleanupErrors: unknown[] = [];
    try {
      await audioDb.audioBuffers.delete(bufferId);
    } catch (error) {
      cleanupErrors.push(error);
    }
    try {
      audioEngine.evictBuffer(bufferId);
    } catch (error) {
      cleanupErrors.push(error);
    }
    if (cleanupErrors.length > 0) {
      throw new AggregateError(cleanupErrors, '临时音频缓冲清理失败');
    }
  }

  async function loadEffectiveClipChannels(clip: IClip, sampleRate: number): Promise<{
    channels: Float32Array[];
    sourceOffset: number;
  } | null> {
    const source = await projectService.loadAudioChannels(clip.audioBufferId, sampleRate);
    if (!source || source.length === 0) return null;
    return {
      channels: audioEngine.processClipChannels(clip, source, sampleRate),
      sourceOffset: clip.offset / getClipStretchRatio(clip),
    };
  }

  async function copySelection(
    proj: IProject,
    start: number,
    end: number,
    trackIds?: ReadonlySet<string>,
  ): Promise<AudioClipboardData | null> {
    const duration = end - start;
    if (duration <= 0) return null;

    const result: AudioClipboardData['tracks'] = [];
    const sampleRate = proj.sampleRate;
    const totalSamples = Math.max(1, Math.ceil(duration * sampleRate));

    for (const track of proj.tracks) {
      if (trackIds && !trackIds.has(track.id)) continue;
      const trackBuffers: Float32Array[] = [];
      let hasContent = false;

      for (const clip of track.clips) {
        const clipEnd = clip.startTime + clip.duration;
        if (clipEnd <= start || clip.startTime >= end) continue;

        const overlapStart = Math.max(clip.startTime, start);
        const overlapEnd = Math.min(clipEnd, end);
        const effective = await loadEffectiveClipChannels(clip, proj.sampleRate);
        if (!effective) continue;
        const clipChannels = effective.channels;

        while (trackBuffers.length < clipChannels.length) {
          trackBuffers.push(new Float32Array(totalSamples));
        }

        const offsetInClip = overlapStart - clip.startTime + effective.sourceOffset;
        const srcStartSample = Math.floor(offsetInClip * sampleRate);
        const srcSamples = Math.floor((overlapEnd - overlapStart) * sampleRate);
        const dstStartSample = Math.floor((overlapStart - start) * sampleRate);
        const positionAtOverlapStart = (overlapStart - clip.startTime) * sampleRate;

        for (let i = 0; i < srcSamples && srcStartSample + i < clipChannels[0].length && dstStartSample + i < totalSamples; i++) {
          const positionInClip = positionAtOverlapStart + i;
          let fadeGain = 1;
          if (clip.fadeIn > 0 && positionInClip < clip.fadeIn * sampleRate) {
            fadeGain = positionInClip / (clip.fadeIn * sampleRate);
          }
          if (clip.fadeOut > 0 && positionInClip > (clip.duration - clip.fadeOut) * sampleRate) {
            const fadePos = positionInClip - (clip.duration - clip.fadeOut) * sampleRate;
            fadeGain = 1 - fadePos / (clip.fadeOut * sampleRate);
          }

          for (let channel = 0; channel < clipChannels.length; channel++) {
            trackBuffers[channel][dstStartSample + i] +=
              clipChannels[channel][srcStartSample + i] * dbToGain(clip.gain) * fadeGain;
          }
        }
        hasContent = true;
      }

      if (hasContent) {
        result.push({ trackId: track.id, channels: trackBuffers, startTime: 0 });
      }
    }

    return { tracks: result, sampleRate, duration };
  }

  async function pasteAtCursor(
    proj: IProject,
    clipboardData: AudioClipboardData,
    cursorPos: number,
    mode: SelectionPasteMode = 'overlap',
  ): Promise<IProject | null> {
    if (clipboardData.tracks.length === 0) return null;

    let updated = JSON.parse(JSON.stringify(proj)) as IProject;
    const destinationIndices = planClipboardPasteTrackIndices(
      updated.tracks.map((track) => track.id),
      selectedTrackId,
      clipboardData.tracks.length,
    );
    if (mode === 'all-tracks') {
      updated = insertBlankSpaceOnTracks(
        updated,
        cursorPos,
        clipboardData.duration,
        updated.tracks.map((track) => track.id),
        generateId,
      ).project;
    }

    // Paste into the selected track and following tracks, creating only the
    // additional tracks needed to preserve every clipboard source track.
    for (let i = 0; i < clipboardData.tracks.length; i++) {
      const trackClip = clipboardData.tracks[i];
      const destinationIndex = destinationIndices[i]!;
      let targetTrack = destinationIndex >= 0 ? updated.tracks[destinationIndex] : undefined;
      let actualDestinationIndex = destinationIndex;

      if (!targetTrack) {
        const newTrack = {
          id: generateId(),
          name: `音轨 ${updated.tracks.length + 1}`,
          type: 'audio' as const,
          gain: 0,
          pan: 0,
          muted: false,
          solo: false,
          armed: false,
          color: '',
          clips: [],
          effects: [],
        };
        updated.tracks.push(newTrack);
        targetTrack = newTrack;
        actualDestinationIndex = updated.tracks.length - 1;
      }

      if (trackClip.segments && trackClip.segments.length > 0) {
        if (mode === 'per-track') {
          updated = insertBlankSpaceOnTracks(
            updated,
            cursorPos,
            clipboardData.duration,
            [targetTrack.id],
            generateId,
          ).project;
          targetTrack = updated.tracks[actualDestinationIndex]!;
        }
        for (const segment of trackClip.segments) {
          const bufferId = await storeProjectBuffer(proj.id, segment.channels, clipboardData.sampleRate);
          const newClip: IClip = {
            id: generateId(),
            audioBufferId: bufferId,
            startTime: cursorPos + segment.startTime,
            offset: 0,
            duration: segment.duration,
            originalDuration: segment.duration,
            stretchRatio: 1,
            gain: 0,
            fadeIn: 0,
            fadeOut: 0,
            name: segment.name || '粘贴',
          };
          targetTrack = pasteClipIntoTrack(targetTrack, newClip, 'overlap', generateId);
        }
        updated.tracks[actualDestinationIndex] = targetTrack;
        continue;
      }

      const existingClip = shouldPasteIntoExistingClip(pastePreferences, mode)
        ? findClipAtTime(targetTrack, cursorPos)
        : null;
      if (existingClip) {
        const effective = await loadEffectiveClipChannels(existingClip, proj.sampleRate);
        if (effective) {
          const pastedChannels = clipboardData.sampleRate === proj.sampleRate
            ? trackClip.channels.map((channel) => channel.slice())
            : trackClip.channels.map((channel) => resampleBuffer(
              channel,
              clipboardData.sampleRate,
              proj.sampleRate,
            ));
          const merged = mergeClipboardPcmIntoClip({
            clip: existingClip,
            existingChannels: effective.channels,
            sourceOffset: effective.sourceOffset,
            pastedChannels,
            pasteTime: cursorPos,
            sampleRate: proj.sampleRate,
          });
          const mergedBufferId = await storeProjectBuffer(proj.id, merged.channels, proj.sampleRate);
          const mergedClip: IClip = { ...merged.clip, audioBufferId: mergedBufferId };
          targetTrack = replaceTrackWithMergedClip(
            targetTrack,
            existingClip,
            mergedClip,
            mode === 'per-track' ? 'insert' : 'overlap',
            generateId,
          );
          updated.tracks[actualDestinationIndex] = targetTrack;
          continue;
        }
      }

      // Store every channel without downmixing.
      const bufferId = await storeProjectBuffer(proj.id, trackClip.channels, clipboardData.sampleRate);

      const newClip: IClip = {
        id: generateId(),
        audioBufferId: bufferId,
        startTime: cursorPos,
        offset: 0,
        duration: clipboardData.duration,
        originalDuration: clipboardData.duration,
        stretchRatio: 1,
        gain: 0,
        fadeIn: 0,
        fadeOut: 0,
        name: '粘贴',
      };

      targetTrack = pasteClipIntoTrack(
        targetTrack,
        newClip,
        mode === 'per-track' ? 'insert' : 'overlap',
        generateId,
      );
      updated.tracks[actualDestinationIndex] = targetTrack;
    }

    return updated;
  }

  async function deleteRegion(
    proj: IProject,
    start: number,
    end: number,
  ): Promise<IProject | null> {
    const result = applySelectionEdit(proj, start, end, 'all-tracks', [], generateId);
    return result.didChange ? result.project : null;
  }

  async function trimToSelection(
    proj: IProject,
    start: number,
    end: number,
  ): Promise<IProject | null> {
    // Delete everything before start and after end. Resolve duration from the
    // queued project itself, not from the React snapshot that started the edit.
    let result = proj;
    const projectDuration = getProjectDuration(proj);
    // Delete after end first (doesn't affect start position)
    if (end < projectDuration) {
      const after = await deleteRegion(result, end, projectDuration);
      if (after) result = after;
    }
    // Delete before start
    if (start > 0) {
      const before = await deleteRegion(result, 0, start);
      if (before) result = before;
    }
    return result;
  }

  // Apply gain effect to selection
  async function applyGainToSelection(gainDb: number) {
    if (!project || !selection) return;
    const activeSelection = { ...selection };
    const label = `增益 ${gainDb > 0 ? '+' : ''}${gainDb.toFixed(1)} dB`;
    const committed = await commitClipEdit(async (latest) => {
      const updated = JSON.parse(JSON.stringify(latest)) as IProject;
      const gainLin = dbToGain(gainDb);

      for (const track of updated.tracks) {
        for (const clip of track.clips) {
          const clipEnd = clip.startTime + clip.duration;
          if (clipEnd <= activeSelection.start || clip.startTime >= activeSelection.end) continue;

          const effective = await loadEffectiveClipChannels(clip, latest.sampleRate);
          if (!effective) continue;
          const dataCopies = effective.channels.map((channel) => new Float32Array(channel));
          const overlapStart = Math.max(clip.startTime, activeSelection.start);
          const overlapEnd = Math.min(clipEnd, activeSelection.end);
          const offsetInClip = overlapStart - clip.startTime + effective.sourceOffset;
          const startSample = Math.floor(offsetInClip * latest.sampleRate);
          const endSample = Math.floor(
            (offsetInClip + (overlapEnd - overlapStart)) * latest.sampleRate,
          );

          for (const dataCopy of dataCopies) {
            for (let i = startSample; i < endSample && i < dataCopy.length; i++) {
              dataCopy[i] *= gainLin;
            }
          }

          clip.audioBufferId = await storeProjectBuffer(latest.id, dataCopies, latest.sampleRate);
          clip.offset = effective.sourceOffset;
          clip.originalDuration = dataCopies[0].length / latest.sampleRate;
          clip.stretchRatio = 1;
        }
      }
      return updated;
    }, label);
    if (committed) {
      updateHistoryState();
      toast.success(`已应用${label}`);
    }
  }

  async function applyFadeToSelection(type: 'in' | 'out') {
    if (!project || !selection) return;
    const activeSelection = { ...selection };
    const committed = await commitClipEdit(async (latest) => {
      const updated = JSON.parse(JSON.stringify(latest)) as IProject;

      for (const track of updated.tracks) {
        for (const clip of track.clips) {
          const clipEnd = clip.startTime + clip.duration;
          if (clipEnd <= activeSelection.start || clip.startTime >= activeSelection.end) continue;

          const effective = await loadEffectiveClipChannels(clip, latest.sampleRate);
          if (!effective) continue;
          const dataCopies = effective.channels.map((channel) => new Float32Array(channel));
          const overlapStart = Math.max(clip.startTime, activeSelection.start);
          const overlapEnd = Math.min(clipEnd, activeSelection.end);
          const offsetInClip = overlapStart - clip.startTime + effective.sourceOffset;
          const startSample = Math.floor(offsetInClip * latest.sampleRate);
          const endSample = Math.floor(
            (offsetInClip + (overlapEnd - overlapStart)) * latest.sampleRate,
          );

          const selectionSamples = endSample - startSample;
          for (const dataCopy of dataCopies) {
            if (type === 'in') {
              for (let i = 0; i < selectionSamples && startSample + i < dataCopy.length; i++) {
                const factor = selectionSamples > 0 ? i / selectionSamples : 1;
                dataCopy[startSample + i] *= factor;
              }
            } else {
              for (let i = 0; i < selectionSamples && startSample + i < dataCopy.length; i++) {
                const factor = selectionSamples > 0 ? 1 - i / selectionSamples : 0;
                dataCopy[startSample + i] *= factor;
              }
            }
          }

          clip.audioBufferId = await storeProjectBuffer(latest.id, dataCopies, latest.sampleRate);
          clip.offset = effective.sourceOffset;
          clip.originalDuration = dataCopies[0].length / latest.sampleRate;
          clip.stretchRatio = 1;
        }
      }
      return updated;
    }, type === 'in' ? '淡入' : '淡出');
    if (committed) {
      updateHistoryState();
      toast.success(type === 'in' ? '已应用淡入' : '已应用淡出');
    }
  }

  function prepareAmplifyTargets(
    activeSelection: { start: number; end: number },
    targets: EchoTrackAudio[],
  ) {
    if (!project) throw new Error('工程不可用');
    return targets.map((target) => {
      const sourceTrack = project.tracks.find((track) => track.id === target.trackId);
      if (!sourceTrack) throw new Error('放大轨道不可用');
      const clips = target.clips.map((input) => {
        const clip = sourceTrack.clips.find((candidate) => candidate.id === input.clipId);
        if (!clip) throw new Error('放大片段不可用');
        const range = getClipSampleRange(
          clip,
          activeSelection,
          input.sourceOffset,
          project.sampleRate,
          input.sampleData[0]?.length ?? 0,
        );
        if (!range) throw new Error('放大片段不在选区内');
        return {
          selectedChannels: input.sampleData.map((channel) => (
            channel.slice(range.startSample, range.endSample)
          )),
        };
      });
      return { target, clips };
    });
  }

  async function handleAnalyzeAmplify(): Promise<number> {
    if (!project || !quantizedGeneratorSelection) throw new Error('请先选择要放大的音频');
    const targets = await collectEffectTargets(quantizedGeneratorSelection);
    if (targets.length === 0) throw new Error('选区内没有可放大的音频');
    const prepared = prepareAmplifyTargets(quantizedGeneratorSelection, targets);
    const segments = prepared.flatMap((target) => (
      target.clips.flatMap((clip) => clip.selectedChannels)
    ));
    const peak = measureAmplifyPeak(segments);
    if (peak <= 0) throw new Error('所选音频为静音，没有可放大的内容');
    return peak;
  }

  async function handleAmplifyPreview(settings: AmplifySettings): Promise<Float32Array[]> {
    if (!project || !quantizedGeneratorSelection) throw new Error('请先选择要试听的音频');
    const activeSelection = quantizedGeneratorSelection;
    const targets = await collectEffectTargets(activeSelection);
    const prepared = prepareAmplifyTargets(activeSelection, targets);
    const allSegments = prepared.flatMap((target) => (
      target.clips.flatMap((clip) => clip.selectedChannels)
    ));
    const inputPeak = measureAmplifyPeak(allSegments);
    if (inputPeak <= 0) throw new Error('所选音频为静音，没有可放大的内容');
    if (!isAmplifyAllowed(settings, inputPeak)) {
      throw new Error('不允许削波时，放大后的峰值不能超过 0 dB');
    }
    const target = prepared[0];
    if (!target) throw new Error('选区内没有可试听的音频');
    const segments = target.clips.map(({ selectedChannels }) => (
      processAmplifyChannels(selectedChannels, settings)
    ));
    const totalLength = segments.reduce((total, segment) => total + (segment[0]?.length ?? 0), 0);
    const channelCount = segments.reduce((maximum, segment) => Math.max(maximum, segment.length), 0);
    if (totalLength === 0 || channelCount === 0) throw new Error('选区内没有可试听的采样');
    const preview = Array.from({ length: channelCount }, () => new Float32Array(totalLength));
    let destinationOffset = 0;
    for (const segment of segments) {
      const length = segment[0]?.length ?? 0;
      preview.forEach((channel, channelIndex) => {
        const source = segment[channelIndex];
        if (source) channel.set(source, destinationOffset);
      });
      destinationOffset += length;
    }
    return preview;
  }

  async function handleApplyAmplify(settings: AmplifySettings) {
    if (!project || !quantizedGeneratorSelection) return;
    setIsApplyingAmplify(true);
    try {
      const activeSelection = quantizedGeneratorSelection;
      const targets = await collectEffectTargets(activeSelection);
      if (targets.length === 0) {
        toast.info('选区内没有可处理的音频');
        return;
      }
      const before = JSON.parse(JSON.stringify(project)) as IProject;
      const changed = await projectService.amplifySelectionOnTracks(
        project.id,
        activeSelection,
        settings,
        targets,
      );
      const updated = await projectService.getProject(project.id);
      if (!updated) throw new Error('应用放大后无法重新读取工程');
      setProject(updated);
      pushHistoryCmd({
        id: generateId(),
        label: '放大',
        execute: () => updated,
        undo: () => before,
      });
      updateHistoryState();
      setAmplifyDialogOpen(false);
      toast.success(`已对 ${changed} 个片段应用放大`);
    } catch (error) {
      logger.error('应用放大失败:', String(error));
      toast.error(error instanceof Error ? `应用放大失败：${error.message}` : '应用放大失败');
    } finally {
      setIsApplyingAmplify(false);
    }
  }

  async function handleNormalizePreview(settings: NormalizeSettings): Promise<Float32Array[]> {
    if (!project || !quantizedGeneratorSelection) throw new Error('请先选择要试听的音频');
    const activeSelection = quantizedGeneratorSelection;
    const targets = await collectEffectTargets(activeSelection);
    const target = targets[0];
    if (!target) throw new Error('选区内没有可试听的音频');
    const sourceTrack = project.tracks.find((track) => track.id === target.trackId);
    if (!sourceTrack) throw new Error('试听轨道不可用');
    const segmentsByChannel = target.clips[0]?.sampleData.map(() => [] as Float32Array[]) ?? [];
    const prepared: { selectedChannels: Float32Array[] }[] = [];

    for (const input of target.clips) {
      const clip = sourceTrack.clips.find((candidate) => candidate.id === input.clipId);
      if (!clip) throw new Error('试听片段不可用');
      const range = getClipSampleRange(
        clip,
        activeSelection,
        input.sourceOffset,
        project.sampleRate,
        input.sampleData[0]?.length ?? 0,
      );
      if (!range) continue;
      const selectedChannels = input.sampleData.map((channel) => (
        channel.slice(range.startSample, range.endSample)
      ));
      selectedChannels.forEach((channel, channelIndex) => {
        if (!segmentsByChannel[channelIndex]) throw new Error('试听轨道的选区声道数不一致');
        segmentsByChannel[channelIndex].push(channel);
      });
      prepared.push({ selectedChannels });
    }

    // Preview uses exactly the same whole-track analysis as the eventual commit.
    const plan = createNormalizePlan(segmentsByChannel, settings);
    const segments = prepared.map(({ selectedChannels }) => (
      processNormalizeChannels(selectedChannels, settings, plan)
    ));
    const totalLength = segments.reduce((total, segment) => total + (segment[0]?.length ?? 0), 0);
    const channelCount = segments.reduce((maximum, segment) => Math.max(maximum, segment.length), 0);
    if (totalLength === 0 || channelCount === 0) throw new Error('选区内没有可试听的采样');
    const preview = Array.from({ length: channelCount }, () => new Float32Array(totalLength));
    let destinationOffset = 0;
    for (const segment of segments) {
      const length = segment[0]?.length ?? 0;
      preview.forEach((channel, channelIndex) => {
        const source = segment[channelIndex];
        if (source) channel.set(source, destinationOffset);
      });
      destinationOffset += length;
    }
    return preview;
  }

  async function handleApplyNormalize(settings: NormalizeSettings) {
    if (!project || !quantizedGeneratorSelection) return;
    setIsApplyingNormalize(true);
    try {
      const activeSelection = quantizedGeneratorSelection;
      const targets = await collectEffectTargets(activeSelection);
      if (targets.length === 0) {
        toast.info('选区内没有可处理的音频');
        return;
      }
      const before = JSON.parse(JSON.stringify(project)) as IProject;
      const changed = await projectService.normalizeSelectionOnTracks(
        project.id,
        activeSelection,
        settings,
        targets,
      );
      const updated = await projectService.getProject(project.id);
      if (!updated) throw new Error('应用标准化后无法重新读取工程');
      setProject(updated);
      pushHistoryCmd({
        id: generateId(),
        label: '标准化',
        execute: () => updated,
        undo: () => before,
      });
      updateHistoryState();
      setNormalizeDialogOpen(false);
      toast.success(`已对 ${changed} 个片段应用标准化`);
    } catch (error) {
      logger.error('应用标准化失败:', String(error));
      toast.error(error instanceof Error ? `应用标准化失败：${error.message}` : '应用标准化失败');
    } finally {
      setIsApplyingNormalize(false);
    }
  }

  async function handleApplyRemoveDcOffset() {
    if (!project || !quantizedGeneratorSelection || isApplyingRemoveDcOffset) return;
    const activeSelection = quantizedGeneratorSelection;
    setIsApplyingRemoveDcOffset(true);
    try {
      const targets = await collectEffectTargets(activeSelection);
      if (targets.length === 0) {
        toast.info('选区内没有可处理的音频');
        return;
      }
      const before = {
        ...structuredClone(project),
        selection: activeSelection,
      };
      const changed = await projectService.removeDcOffsetSelectionOnTracks(
        project.id,
        activeSelection,
        targets,
      );
      const updated = await projectService.getProject(project.id);
      if (!updated) throw new Error('Remove DC offset 后无法重新读取工程');
      setProject(updated);
      setSelection(updated.selection);
      pushHistoryCmd({
        id: generateId(),
        label: 'Remove DC offset 去除直流偏移',
        execute: () => updated,
        undo: () => before,
      }, before);
      updateHistoryState();
      toast.success(`已对 ${changed} 个片段应用 Remove DC offset`);
    } catch (error) {
      logger.error('应用 Remove DC offset 失败:', String(error));
      toast.error(error instanceof Error ? `应用 Remove DC offset 失败：${error.message}` : '应用 Remove DC offset 失败');
    } finally {
      setIsApplyingRemoveDcOffset(false);
    }
  }

  async function handleLoudnessPreview(settings: LoudnessSettings): Promise<Float32Array[]> {
    if (!project || !quantizedGeneratorSelection) throw new Error('请先选择要试听的音频');
    const activeSelection = quantizedGeneratorSelection;
    const targets = await collectFullTrackTargets(activeSelection);
    const target = targets[0];
    if (!target) throw new Error('选区内没有可试听的音频');
    const sourceTrack = project.tracks.find((track) => track.id === target.trackId);
    if (!sourceTrack) throw new Error('试听轨道不可用');
    // Preview and apply share full-track assembly, EBU gating and gain mapping.
    return processLoudnessTrack(
      sourceTrack, target, activeSelection, settings, project.sampleRate,
    ).selectionChannels;
  }

  async function handleApplyLoudness(settings: LoudnessSettings) {
    if (!project || !quantizedGeneratorSelection) return;
    setIsApplyingLoudness(true);
    try {
      const activeSelection = quantizedGeneratorSelection;
      const targets = await collectFullTrackTargets(activeSelection);
      if (targets.length === 0) {
        toast.info('选区内没有可处理的音频');
        return;
      }
      const before = JSON.parse(JSON.stringify(project)) as IProject;
      const changed = await projectService.loudnessSelectionOnTracks(
        project.id, activeSelection, settings, targets,
      );
      const updated = await projectService.getProject(project.id);
      if (!updated) throw new Error('应用 Loudness 后无法重新读取工程');
      setProject(updated);
      setSelection(updated.selection);
      pushHistoryCmd({
        id: generateId(),
        label: 'Loudness Normalization 响度标准化',
        execute: () => updated,
        undo: () => before,
      });
      updateHistoryState();
      setLoudnessDialogOpen(false);
      toast.success(`已对 ${changed} 个片段应用 Loudness Normalization`);
    } catch (error) {
      logger.error('应用 Loudness 失败:', String(error));
      toast.error(error instanceof Error ? `应用 Loudness 失败：${error.message}` : '应用 Loudness 失败');
    } finally {
      setIsApplyingLoudness(false);
    }
  }

  async function handleFilterCurveEqPreview(settings: FilterCurveEqSettings): Promise<Float32Array[]> {
    if (!project || !quantizedGeneratorSelection) throw new Error('请先选择要试听的音频');
    const activeSelection = quantizedGeneratorSelection;
    const targets = await collectFullTrackTargets(activeSelection);
    const target = targets[0];
    if (!target) throw new Error('选区内没有可试听的音频');
    const sourceTrack = project.tracks.find((track) => track.id === target.trackId);
    if (!sourceTrack) throw new Error('试听轨道不可用');
    // Preview and apply share curve sampling, FIR design and full-track mapping.
    return processFilterCurveEqTrack(
      sourceTrack, target, activeSelection, settings, project.sampleRate,
    ).selectionChannels;
  }

  async function handleApplyFilterCurveEq(settings: FilterCurveEqSettings) {
    if (!project || !quantizedGeneratorSelection) return;
    setIsApplyingFilterCurveEq(true);
    try {
      const activeSelection = quantizedGeneratorSelection;
      const targets = await collectFullTrackTargets(activeSelection);
      if (targets.length === 0) {
        toast.info('选区内没有可处理的音频');
        return;
      }
      const before = JSON.parse(JSON.stringify(project)) as IProject;
      const changed = await projectService.filterCurveEqSelectionOnTracks(
        project.id, activeSelection, settings, targets,
      );
      if (changed === 0) {
        setFilterCurveEqDialogOpen(false);
        toast.info('Filter Curve EQ 曲线为平直，未修改音频');
        return;
      }
      const updated = await projectService.getProject(project.id);
      if (!updated) throw new Error('应用 Filter Curve EQ 后无法重新读取工程');
      setProject(updated);
      setSelection(updated.selection);
      pushHistoryCmd({
        id: generateId(),
        label: 'Filter Curve EQ 滤波曲线均衡',
        execute: () => updated,
        undo: () => before,
      });
      updateHistoryState();
      setFilterCurveEqDialogOpen(false);
      toast.success(`已对 ${changed} 个片段应用 Filter Curve EQ`);
    } catch (error) {
      logger.error('应用 Filter Curve EQ 失败:', String(error));
      toast.error(error instanceof Error ? `应用 Filter Curve EQ 失败：${error.message}` : '应用 Filter Curve EQ 失败');
    } finally {
      setIsApplyingFilterCurveEq(false);
    }
  }

  async function handleGraphicEqPreview(settings: GraphicEqSettings): Promise<Float32Array[]> {
    if (!project || !quantizedGeneratorSelection) throw new Error('请先选择要试听的音频');
    const activeSelection = quantizedGeneratorSelection;
    const targets = await collectFullTrackTargets(activeSelection);
    const target = targets[0];
    if (!target) throw new Error('选区内没有可试听的音频');
    const sourceTrack = project.tracks.find((track) => track.id === target.trackId);
    if (!sourceTrack) throw new Error('试听轨道不可用');
    // Preview and apply share the official B-spline FIR and full-track mapping.
    return processGraphicEqTrack(
      sourceTrack, target, activeSelection, settings, project.sampleRate,
    ).selectionChannels;
  }

  async function handleApplyGraphicEq(settings: GraphicEqSettings) {
    if (!project || !quantizedGeneratorSelection) return;
    setIsApplyingGraphicEq(true);
    try {
      const activeSelection = quantizedGeneratorSelection;
      const targets = await collectFullTrackTargets(activeSelection);
      if (targets.length === 0) {
        toast.info('选区内没有可处理的音频');
        return;
      }
      const before = JSON.parse(JSON.stringify(project)) as IProject;
      const changed = await projectService.graphicEqSelectionOnTracks(
        project.id, activeSelection, settings, targets,
      );
      if (changed === 0) {
        setGraphicEqDialogOpen(false);
        toast.info('Graphic EQ 各频段为平直，未修改音频');
        return;
      }
      const updated = await projectService.getProject(project.id);
      if (!updated) throw new Error('应用 Graphic EQ 后无法重新读取工程');
      setProject(updated);
      setSelection(updated.selection);
      pushHistoryCmd({
        id: generateId(),
        label: 'Graphic EQ 图示均衡',
        execute: () => updated,
        undo: () => before,
      });
      updateHistoryState();
      setGraphicEqDialogOpen(false);
      toast.success(`已对 ${changed} 个片段应用 Graphic EQ`);
    } catch (error) {
      logger.error('应用 Graphic EQ 失败:', String(error));
      toast.error(error instanceof Error ? `应用 Graphic EQ 失败：${error.message}` : '应用 Graphic EQ 失败');
    } finally {
      setIsApplyingGraphicEq(false);
    }
  }

  async function handleChangeSpeedPreview(settings: ChangeSpeedSettings): Promise<Float32Array[]> {
    if (!project || !quantizedGeneratorSelection) throw new Error('请先选择要试听的音频');
    const activeSelection = quantizedGeneratorSelection;
    const targets = await collectEffectTargets(activeSelection);
    const target = targets[0];
    if (!target) throw new Error('选区内没有可试听的音频');
    const sourceTrack = project.tracks.find((track) => track.id === target.trackId);
    if (!sourceTrack) throw new Error('试听轨道不可用');
    const segments: Float32Array[][] = [];
    for (const input of target.clips) {
      const clip = sourceTrack.clips.find((candidate) => candidate.id === input.clipId);
      if (!clip) throw new Error('试听片段不可用');
      const range = getClipSampleRange(
        clip,
        activeSelection,
        input.sourceOffset,
        project.sampleRate,
        input.sampleData[0]?.length ?? 0,
      );
      if (!range) continue;
      const selected = input.sampleData.map((channel) => (
        channel.slice(range.startSample, range.endSample)
      ));
      segments.push(processChangeSpeedChannels(selected, settings, project.sampleRate));
    }
    const totalLength = segments.reduce((total, segment) => total + (segment[0]?.length ?? 0), 0);
    const channelCount = segments.reduce((maximum, segment) => Math.max(maximum, segment.length), 0);
    if (totalLength === 0 || channelCount === 0) throw new Error('选区内没有可试听的采样');
    const preview = Array.from({ length: channelCount }, () => new Float32Array(totalLength));
    let destinationOffset = 0;
    for (const segment of segments) {
      const length = segment[0]?.length ?? 0;
      preview.forEach((channel, channelIndex) => {
        const source = segment[channelIndex];
        if (source) channel.set(source, destinationOffset);
      });
      destinationOffset += length;
    }
    return preview;
  }

  async function handleApplyChangeSpeed(settings: ChangeSpeedSettings) {
    if (!project || !quantizedGeneratorSelection || isApplyingChangeSpeed) return;
    setIsApplyingChangeSpeed(true);
    try {
      const activeSelection = quantizedGeneratorSelection;
      const targets = await collectEffectTargets(activeSelection);
      if (targets.length === 0) {
        toast.info('选区内没有可处理的音频');
        return;
      }
      const before = {
        ...(JSON.parse(JSON.stringify(project)) as IProject),
        selection: activeSelection,
      };
      const changed = await projectService.changeSpeedSelectionOnTracks(
        project.id,
        activeSelection,
        settings,
        targets,
      );
      const updated = await projectService.getProject(project.id);
      if (!updated) throw new Error('应用 Change Speed 后无法重新读取工程');
      setProject(updated);
      setSelection(updated.selection);
      pushHistoryCmd({
        id: generateId(),
        label: 'Change Speed',
        execute: () => updated,
        undo: () => before,
      }, before);
      updateHistoryState();
      setChangeSpeedDialogOpen(false);
      toast.success(`已对 ${changed} 个片段应用 Change Speed（速度及音高）`);
    } catch (error) {
      logger.error('应用 Change Speed 失败:', String(error));
      toast.error(error instanceof Error ? `Change Speed 失败：${error.message}` : 'Change Speed 失败');
    } finally {
      setIsApplyingChangeSpeed(false);
    }
  }

  async function handleChangePitchPreview(settings: ChangePitchSettings): Promise<Float32Array[]> {
    if (!project || !quantizedGeneratorSelection) throw new Error('请先选择要试听的音频');
    const activeSelection = quantizedGeneratorSelection;
    const targets = await collectEffectTargets(activeSelection);
    const target = targets[0];
    if (!target) throw new Error('选区内没有可试听的音频');
    const sourceTrack = project.tracks.find((track) => track.id === target.trackId);
    if (!sourceTrack) throw new Error('试听轨道不可用');
    const segments: Float32Array[][] = [];
    for (const input of target.clips) {
      const clip = sourceTrack.clips.find((candidate) => candidate.id === input.clipId);
      if (!clip) throw new Error('试听片段不可用');
      const range = getClipSampleRange(
        clip,
        activeSelection,
        input.sourceOffset,
        project.sampleRate,
        input.sampleData[0]?.length ?? 0,
      );
      if (!range) continue;
      const selected = input.sampleData.map((channel) => (
        channel.slice(range.startSample, range.endSample)
      ));
      segments.push(processChangePitchChannels(selected, settings, project.sampleRate));
    }
    const totalLength = segments.reduce((total, segment) => total + (segment[0]?.length ?? 0), 0);
    const channelCount = segments.reduce((maximum, segment) => Math.max(maximum, segment.length), 0);
    if (totalLength === 0 || channelCount === 0) throw new Error('选区内没有可试听的采样');
    const preview = Array.from({ length: channelCount }, () => new Float32Array(totalLength));
    let destinationOffset = 0;
    for (const segment of segments) {
      const length = segment[0]?.length ?? 0;
      preview.forEach((channel, channelIndex) => {
        const source = segment[channelIndex];
        if (source) channel.set(source, destinationOffset);
      });
      destinationOffset += length;
    }
    return preview;
  }

  async function handleApplyChangePitch(settings: ChangePitchSettings) {
    if (!project || !quantizedGeneratorSelection || isApplyingChangePitch) return;
    setIsApplyingChangePitch(true);
    try {
      const activeSelection = quantizedGeneratorSelection;
      const targets = await collectEffectTargets(activeSelection);
      if (targets.length === 0) {
        toast.info('选区内没有可处理的音频');
        return;
      }
      const before = {
        ...(JSON.parse(JSON.stringify(project)) as IProject),
        selection: activeSelection,
      };
      const changed = await projectService.changePitchSelectionOnTracks(
        project.id,
        activeSelection,
        settings,
        targets,
      );
      const updated = await projectService.getProject(project.id);
      if (!updated) throw new Error('应用 Change Pitch 后无法重新读取工程');
      setProject(updated);
      setSelection(updated.selection);
      pushHistoryCmd({
        id: generateId(),
        label: 'Change Pitch',
        execute: () => updated,
        undo: () => before,
      }, before);
      updateHistoryState();
      setChangePitchDialogOpen(false);
      toast.success(`已对 ${changed} 个片段应用 Change Pitch（保持时长）`);
    } catch (error) {
      logger.error('应用 Change Pitch 失败:', String(error));
      toast.error(error instanceof Error ? `Change Pitch 失败：${error.message}` : 'Change Pitch 失败');
    } finally {
      setIsApplyingChangePitch(false);
    }
  }

  async function handleChangeTempoPreview(settings: ChangeTempoSettings): Promise<Float32Array[]> {
    if (!project || !quantizedGeneratorSelection) throw new Error('请先选择要试听的音频');
    const activeSelection = quantizedGeneratorSelection;
    const targets = await collectEffectTargets(activeSelection);
    const target = targets[0];
    if (!target) throw new Error('选区内没有可试听的音频');
    const sourceTrack = project.tracks.find((track) => track.id === target.trackId);
    if (!sourceTrack) throw new Error('试听轨道不可用');
    const segments: Float32Array[][] = [];
    for (const input of target.clips) {
      const clip = sourceTrack.clips.find((candidate) => candidate.id === input.clipId);
      if (!clip) throw new Error('试听片段不可用');
      const range = getClipSampleRange(
        clip,
        activeSelection,
        input.sourceOffset,
        project.sampleRate,
        input.sampleData[0]?.length ?? 0,
      );
      if (!range) continue;
      const selected = input.sampleData.map((channel) => (
        channel.slice(range.startSample, range.endSample)
      ));
      segments.push(processChangeTempoChannels(selected, settings, project.sampleRate));
    }
    const totalLength = segments.reduce((total, segment) => total + (segment[0]?.length ?? 0), 0);
    const channelCount = segments.reduce((maximum, segment) => Math.max(maximum, segment.length), 0);
    if (totalLength === 0 || channelCount === 0) throw new Error('选区内没有可试听的采样');
    const preview = Array.from({ length: channelCount }, () => new Float32Array(totalLength));
    let destinationOffset = 0;
    for (const segment of segments) {
      const length = segment[0]?.length ?? 0;
      preview.forEach((channel, channelIndex) => {
        const source = segment[channelIndex];
        if (source) channel.set(source, destinationOffset);
      });
      destinationOffset += length;
    }
    return preview;
  }

  async function handleApplyChangeTempo(settings: ChangeTempoSettings) {
    if (!project || !quantizedGeneratorSelection || isApplyingChangeTempo) return;
    setIsApplyingChangeTempo(true);
    try {
      const activeSelection = quantizedGeneratorSelection;
      const targets = await collectEffectTargets(activeSelection);
      if (targets.length === 0) {
        toast.info('选区内没有可处理的音频');
        return;
      }
      const before = {
        ...(JSON.parse(JSON.stringify(project)) as IProject),
        selection: activeSelection,
      };
      const changed = await projectService.changeTempoSelectionOnTracks(
        project.id,
        activeSelection,
        settings,
        targets,
      );
      const updated = await projectService.getProject(project.id);
      if (!updated) throw new Error('应用 Change Tempo 后无法重新读取工程');
      setProject(updated);
      setSelection(updated.selection);
      pushHistoryCmd({
        id: generateId(),
        label: 'Change Tempo',
        execute: () => updated,
        undo: () => before,
      }, before);
      updateHistoryState();
      setChangeTempoDialogOpen(false);
      toast.success(`已对 ${changed} 个片段应用 Change Tempo（保持音高）`);
    } catch (error) {
      logger.error('应用 Change Tempo 失败:', String(error));
      toast.error(error instanceof Error ? `Change Tempo 失败：${error.message}` : 'Change Tempo 失败');
    } finally {
      setIsApplyingChangeTempo(false);
    }
  }

  async function handleSlidingStretchPreview(settings: SlidingStretchSettings): Promise<Float32Array[]> {
    if (!project || !quantizedGeneratorSelection) throw new Error('请先选择要试听的音频');
    const activeSelection = quantizedGeneratorSelection;
    const selectionDuration = activeSelection.end - activeSelection.start;
    const targets = await collectEffectTargets(activeSelection);
    const target = targets[0];
    if (!target) throw new Error('选区内没有可试听的音频');
    const sourceTrack = project.tracks.find((track) => track.id === target.trackId);
    if (!sourceTrack) throw new Error('试听轨道不可用');
    const segments: Float32Array[][] = [];
    for (const input of target.clips) {
      const clip = sourceTrack.clips.find((candidate) => candidate.id === input.clipId);
      if (!clip) throw new Error('试听片段不可用');
      const range = getClipSampleRange(
        clip,
        activeSelection,
        input.sourceOffset,
        project.sampleRate,
        input.sampleData[0]?.length ?? 0,
      );
      if (!range) continue;
      const selected = input.sampleData.map((channel) => (
        channel.slice(range.startSample, range.endSample)
      ));
      const overlapStart = Math.max(clip.startTime, activeSelection.start);
      const overlapEnd = Math.min(clip.startTime + clip.duration, activeSelection.end);
      const clipSettings = slidingStretchSubrangeSettings(
        settings,
        (overlapStart - activeSelection.start) / selectionDuration,
        (overlapEnd - activeSelection.start) / selectionDuration,
      );
      segments.push(processSlidingStretchChannels(selected, clipSettings, project.sampleRate));
    }
    const totalLength = segments.reduce((total, segment) => total + (segment[0]?.length ?? 0), 0);
    const channelCount = segments.reduce((maximum, segment) => Math.max(maximum, segment.length), 0);
    if (totalLength === 0 || channelCount === 0) throw new Error('选区内没有可试听的采样');
    const preview = Array.from({ length: channelCount }, () => new Float32Array(totalLength));
    let destinationOffset = 0;
    for (const segment of segments) {
      const length = segment[0]?.length ?? 0;
      preview.forEach((channel, channelIndex) => {
        const source = segment[channelIndex];
        if (source) channel.set(source, destinationOffset);
      });
      destinationOffset += length;
    }
    return preview;
  }

  async function handleApplySlidingStretch(settings: SlidingStretchSettings) {
    if (!project || !quantizedGeneratorSelection || isApplyingSlidingStretch) return;
    setIsApplyingSlidingStretch(true);
    try {
      const activeSelection = quantizedGeneratorSelection;
      const targets = await collectEffectTargets(activeSelection);
      if (targets.length === 0) {
        toast.info('选区内没有可处理的音频');
        return;
      }
      const before = {
        ...(JSON.parse(JSON.stringify(project)) as IProject),
        selection: activeSelection,
      };
      const changed = await projectService.slidingStretchSelectionOnTracks(
        project.id,
        activeSelection,
        settings,
        targets,
      );
      const updated = await projectService.getProject(project.id);
      if (!updated) throw new Error('应用 Sliding Stretch 后无法重新读取工程');
      setProject(updated);
      setSelection(updated.selection);
      pushHistoryCmd({
        id: generateId(),
        label: 'Sliding Stretch',
        execute: () => updated,
        undo: () => before,
      }, before);
      updateHistoryState();
      setSlidingStretchDialogOpen(false);
      toast.success(`已对 ${changed} 个片段应用 Sliding Stretch（连续变速/变调）`);
    } catch (error) {
      logger.error('应用 Sliding Stretch 失败:', String(error));
      toast.error(error instanceof Error ? `Sliding Stretch 失败：${error.message}` : 'Sliding Stretch 失败');
    } finally {
      setIsApplyingSlidingStretch(false);
    }
  }

  async function handlePaulstretchPreview(settings: PaulstretchSettings): Promise<Float32Array[]> {
    if (!project || !quantizedGeneratorSelection) throw new Error('请先选择要试听的音频');
    const activeSelection = quantizedGeneratorSelection;
    const targets = await collectEffectTargets(activeSelection);
    const target = targets[0];
    if (!target) throw new Error('选区内没有可试听的音频');
    const sourceTrack = project.tracks.find((track) => track.id === target.trackId);
    if (!sourceTrack) throw new Error('试听轨道不可用');
    const segments: Float32Array[][] = [];
    for (const input of target.clips) {
      const clip = sourceTrack.clips.find((candidate) => candidate.id === input.clipId);
      if (!clip) throw new Error('试听片段不可用');
      const range = getClipSampleRange(
        clip,
        activeSelection,
        input.sourceOffset,
        project.sampleRate,
        input.sampleData[0]?.length ?? 0,
      );
      if (!range) continue;
      const selected = input.sampleData.map((channel) => (
        channel.slice(range.startSample, range.endSample)
      ));
      segments.push(processPaulstretchChannels(selected, settings, project.sampleRate));
    }
    const totalLength = segments.reduce((total, segment) => total + (segment[0]?.length ?? 0), 0);
    const channelCount = segments.reduce((maximum, segment) => Math.max(maximum, segment.length), 0);
    if (totalLength === 0 || channelCount === 0) throw new Error('选区内没有可试听的采样');
    const preview = Array.from({ length: channelCount }, () => new Float32Array(totalLength));
    let destinationOffset = 0;
    for (const segment of segments) {
      const length = segment[0]?.length ?? 0;
      preview.forEach((channel, channelIndex) => {
        const source = segment[channelIndex];
        if (source) channel.set(source, destinationOffset);
      });
      destinationOffset += length;
    }
    return preview;
  }

  async function handleApplyPaulstretch(settings: PaulstretchSettings) {
    if (!project || !quantizedGeneratorSelection || isApplyingPaulstretch) return;
    setIsApplyingPaulstretch(true);
    try {
      const activeSelection = quantizedGeneratorSelection;
      const targets = await collectEffectTargets(activeSelection);
      if (targets.length === 0) {
        toast.info('选区内没有可处理的音频');
        return;
      }
      const before = {
        ...(JSON.parse(JSON.stringify(project)) as IProject),
        selection: activeSelection,
      };
      const changed = await projectService.paulstretchSelectionOnTracks(
        project.id,
        activeSelection,
        settings,
        targets,
      );
      const updated = await projectService.getProject(project.id);
      if (!updated) throw new Error('应用 Paulstretch 后无法重新读取工程');
      setProject(updated);
      setSelection(updated.selection);
      pushHistoryCmd({
        id: generateId(),
        label: 'Paulstretch',
        execute: () => updated,
        undo: () => before,
      }, before);
      updateHistoryState();
      setPaulstretchDialogOpen(false);
      toast.success(`已对 ${changed} 个片段应用 Paulstretch`);
    } catch (error) {
      logger.error('应用 Paulstretch 失败:', String(error));
      toast.error(error instanceof Error ? `Paulstretch 失败：${error.message}` : 'Paulstretch 失败');
    } finally {
      setIsApplyingPaulstretch(false);
    }
  }

  async function handleApplyInvert() {
    if (!project || !quantizedGeneratorSelection || isApplyingInvert) return;
    setIsApplyingInvert(true);
    try {
      const before = structuredClone(project);
      const targets = await collectEffectTargets(quantizedGeneratorSelection);
      const changed = await projectService.invertSelectionOnTracks(
        project.id,
        quantizedGeneratorSelection,
        targets,
      );
      const updated = await projectService.getProject(project.id);
      if (!updated) throw new Error('极性反转后无法重新读取工程');
      setProject(updated);
      pushHistoryCmd({
        id: generateId(),
        label: 'Invert 极性反转',
        execute: () => updated,
        undo: () => before,
      }, before);
      toast.success(`已对 ${changed} 个片段应用极性反转`);
    } catch (error) {
      logger.error('应用极性反转失败:', String(error));
      toast.error(error instanceof Error ? `应用极性反转失败：${error.message}` : '应用极性反转失败');
    } finally {
      setIsApplyingInvert(false);
    }
  }

  async function applyReverse() {
    if (!project || !quantizedGeneratorSelection || isApplyingReverse) return;
    const activeSelection = quantizedGeneratorSelection;
    setIsApplyingReverse(true);
    try {
      const before = {
        ...structuredClone(project),
        selection: activeSelection,
      };
      const targets = await collectEffectTargets(activeSelection);
      const changed = await projectService.reverseSelectionOnTracks(
        project.id,
        activeSelection,
        targets,
      );
      const updated = await projectService.getProject(project.id);
      if (!updated) throw new Error('时间反转后无法重新读取工程');
      setProject(updated);
      setSelection(updated.selection);
      pushHistoryCmd({
        id: generateId(),
        label: 'Reverse 时间反转',
        execute: () => updated,
        undo: () => before,
      }, before);
      toast.success(`已对 ${changed} 个片段应用时间反转`);
    } catch (error) {
      logger.error('应用时间反转失败:', String(error));
      toast.error(error instanceof Error ? `应用时间反转失败：${error.message}` : '应用时间反转失败');
    } finally {
      setIsApplyingReverse(false);
    }
  }

  function scrollTimelineTo(time: number, zoom: number) {
    window.requestAnimationFrame(() => {
      const container = timelineRef.current;
      if (!container) return;
      container.scrollLeft = Math.max(0, time * zoom);
      setScrollX(container.scrollLeft);
    });
  }

  function changeHorizontalZoom(direction: 'in' | 'out') {
    setHorizontalZoom((current) => stepHorizontalZoom(current, direction));
  }

  function resetHorizontalZoom() {
    setHorizontalZoom(DEFAULT_HORIZONTAL_ZOOM);
  }

  function zoomToSelection() {
    if (!selection || selection.end <= selection.start) return;
    const nextZoom = horizontalZoomForDuration(
      selection.end - selection.start,
      timelineRef.current?.clientWidth ?? 0,
    );
    if (nextZoom === null) return;
    setHorizontalZoom(nextZoom);
    scrollTimelineTo(selection.start, nextZoom);
  }

  function fitProjectToWidth(duration = getProjectDuration()) {
    const nextZoom = horizontalZoomForDuration(
      duration,
      timelineRef.current?.clientWidth ?? 0,
    );
    if (nextZoom === null) return;
    setHorizontalZoom(nextZoom);
    scrollTimelineTo(0, nextZoom);
  }

  const projectDuration = getProjectDuration();
  const canSplitAtCursor = project?.tracks.some((track) => track.clips.some((clip) => {
    const inSelection = selectedClips.length === 0
      ? track.id === selectedTrackId
      : selectedClips.some((key) => key.trackId === track.id && key.clipId === clip.id);
    return inSelection && cursorPosition > clip.startTime + 0.05
      && cursorPosition < clip.startTime + clip.duration - 0.05;
  })) ?? false;
  const timelineDuration = Math.max(projectDuration, 30);
  const pxPerSec = horizontalZoom;
  const totalWidth = Math.max(timelineDuration * pxPerSec, 1000);
  const rulerWidth = showVerticalRulers ? DB_WAVE_RULER_WIDTH : 0;
  const timelineContentWidth = totalWidth + rulerWidth;
  const activeWorkspaceName = activeWorkspace.name;
  const activeWorkspaceBuiltIn = activeWorkspace.builtIn;
  const multiClipGroupState = project ? getClipGroupState(project, selectedClips) : null;

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="text-center text-muted-foreground">
          <div className="mb-2">加载工程中...</div>
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="text-center">
          <p className="mb-4 text-muted-foreground">工程不存在</p>
          <Button onClick={() => navigate('/')}>返回工程列表</Button>
        </div>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div
        className="audacity-editor flex h-screen flex-col overflow-hidden"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* Audacity 4 application menu: every item maps to a real local action. */}
        <nav aria-label="应用菜单" className="au-toolbar flex h-8 shrink-0 items-center gap-0.5 overflow-x-auto overflow-y-hidden border-b px-2 text-xs">
          <div className="mr-2 flex items-center gap-1.5 font-semibold">
            <AudioWaveform className="size-4 text-[#ff4d6d]" />
            <span>Audacity Web</span>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-6 px-2 text-xs">文件</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onClick={handleImportClick}>导入音频…</DropdownMenuItem>
              <DropdownMenuItem onClick={saveProject} disabled={isSaving}>保存工程</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setExportDialogOpen(true)}>导出音频…</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => navigate('/')}>返回工程列表</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-6 px-2 text-xs">编辑</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onClick={handleUndo} disabled={!canUndo}>撤销</DropdownMenuItem>
              <DropdownMenuItem onClick={handleRedo} disabled={!canRedo}>重做</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem data-testid="cut-selection" onClick={() => void handleCut()} disabled={!selection}>剪切 (Ctrl+X)</DropdownMenuItem>
              <DropdownMenuItem data-testid="delete-selection" onClick={() => void handleDeleteSelection()} disabled={!selection}>删除 (Delete)</DropdownMenuItem>
              <DropdownMenuItem onClick={() => void handleCopy()} disabled={!selection}>复制</DropdownMenuItem>
              <DropdownMenuItem onClick={() => handlePaste()}>粘贴</DropdownMenuItem>
              {renderSelectionEditMenus()}
              <DropdownMenuItem onClick={() => void splitClipsAtCursor()} disabled={!canSplitAtCursor}>在光标处分割 (Ctrl+I)</DropdownMenuItem>
              <DropdownMenuItem onClick={handleTrim} disabled={!selection}>裁剪到选区</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setLabelEditorDialogOpen(true)}>Edit Labels… 编辑标签…</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-6 px-2 text-xs">选择</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem
                onClick={() => setSelection({ start: 0, end: projectDuration })}
                disabled={projectDuration <= 0}
              >
                选择全部音频
              </DropdownMenuItem>
              <DropdownMenuItem onClick={clearSelection} disabled={!selection}>清除选区</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-6 px-2 text-xs">视图</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onClick={() => setViewMode('waveform')}>波形</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setViewMode('waveformDb')}>波形 (对数 dB)</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setViewMode('waveformDbLinear')}>波形 (线性 dB)</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setViewMode('spectrum')}>频谱</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setViewMode('both')}>波形与频谱</DropdownMenuItem>
              <DropdownMenuCheckboxItem
                checked={halfWave}
                onClick={() => setHalfWave((current) => !current)}
                disabled={viewMode === 'spectrum'}
              >
                半波显示
              </DropdownMenuCheckboxItem>
              <DropdownMenuItem onClick={() => setShowClipping((visible) => !visible)}>
                {showClipping ? '隐藏' : '显示'}波形削波
              </DropdownMenuItem>
              <DropdownMenuCheckboxItem
                checked={showRMS}
                onClick={() => setShowRMS((visible) => !visible)}
                disabled={viewMode === 'spectrum'}
                data-testid="view-show-rms"
              >
                显示波形 RMS
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={showVerticalRulers}
                onClick={() => setShowVerticalRulers((visible) => !visible)}
                data-testid="view-show-vertical-rulers"
              >
                显示纵向标尺
              </DropdownMenuCheckboxItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>水平缩放 {Math.round(horizontalZoom)}%</DropdownMenuLabel>
              <DropdownMenuItem
                onClick={() => changeHorizontalZoom('in')}
                disabled={horizontalZoom >= MAX_HORIZONTAL_ZOOM}
              >
                水平放大 (Ctrl+1)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={resetHorizontalZoom}>
                正常大小 (Ctrl+2)
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => changeHorizontalZoom('out')}
                disabled={horizontalZoom <= MIN_HORIZONTAL_ZOOM}
              >
                水平缩小 (Ctrl+3)
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={zoomToSelection}
                disabled={!selection || selection.end <= selection.start}
              >
                缩放至选区 (Ctrl+E)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => fitProjectToWidth()} disabled={projectDuration <= 0}>
                适应宽度 (Ctrl+F)
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>纵向缩放 {Math.round(verticalZoom * 100)}%</DropdownMenuLabel>
              <DropdownMenuItem
                onClick={() => setVerticalZoom((current) => stepVerticalZoom(current, 'in'))}
                disabled={verticalZoom >= MAX_VERTICAL_ZOOM}
              >
                纵向放大
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setVerticalZoom((current) => stepVerticalZoom(current, 'out'))}
                disabled={verticalZoom <= MIN_VERTICAL_ZOOM}
              >
                纵向缩小
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setVerticalZoom(DEFAULT_VERTICAL_ZOOM)}>
                重置纵向缩放
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setShowTrackPanel((visible) => !visible)}>
                {showTrackPanel ? '隐藏' : '显示'}轨道面板
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setShowMixer((visible) => !visible)}>
                {showMixer ? '隐藏' : '显示'}混音器
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-6 px-2 text-xs">轨道</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onClick={addTrack}>添加单声道轨道</DropdownMenuItem>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger disabled={project.tracks.length === 0 || isMutingTracks}>
                  Mute/Unmute 静音/取消静音
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuItem disabled={isMutingTracks} onClick={() => void setTracksMute(true, false)}>
                    Mute All Tracks 静音所有轨道
                    <span className="ml-auto text-xs text-muted-foreground">Ctrl+U</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled={isMutingTracks} onClick={() => void setTracksMute(false, false)}>
                    Unmute All Tracks 取消静音所有轨道
                    <span className="ml-auto text-xs text-muted-foreground">Ctrl+Shift+U</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={mixAndRenderTrackIds.length === 0 || isMutingTracks}
                    onClick={() => void setTracksMute(true, true)}
                  >
                    Mute Tracks 静音选中轨道
                    <span className="ml-auto text-xs text-muted-foreground">Ctrl+Alt+U</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={mixAndRenderTrackIds.length === 0 || isMutingTracks}
                    onClick={() => void setTracksMute(false, true)}
                  >
                    Unmute Tracks 取消静音选中轨道
                    <span className="ml-auto text-xs text-muted-foreground">Ctrl+Alt+Shift+U</span>
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger disabled={mixAndRenderTrackIds.length === 0 || isPanningTracks}>
                  Pan 声像
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuItem disabled={isPanningTracks} onClick={() => void setTracksPan(-1)}>
                    Left 左侧
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled={isPanningTracks} onClick={() => void setTracksPan(1)}>
                    Right 右侧
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled={isPanningTracks} onClick={() => void setTracksPan(0)}>
                    Center 中央
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger
                  disabled={mixAndRenderTrackIds.length === 0 || isMixingAndRendering
                    || playbackState === 'playing' || recordingState === 'recording'}
                >
                  Mix 混音
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuItem
                    disabled={isMixingAndRendering}
                    onClick={() => void mixAndRenderSelectedTracks(false)}
                  >
                    Mix and Render 混音并渲染
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={isMixingAndRendering}
                    onClick={() => void mixAndRenderSelectedTracks(true)}
                  >
                    Mix and Render to New Track 混音并渲染到新轨道
                    <span className="ml-auto text-xs text-muted-foreground">Ctrl+Shift+M</span>
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuItem
                disabled={mixAndRenderTrackIds.length === 0 || isResampling
                  || playbackState === 'playing' || recordingState === 'recording'}
                onClick={() => setResampleDialogOpen(true)}
              >
                Resample… 重采样…
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={mixAndRenderTrackIds.length === 0 || isRemovingTracks
                  || playbackState !== 'stopped' || recordingState === 'recording'}
                onClick={() => void removeSelectedTracks()}
              >
                Remove Tracks 移除轨道
              </DropdownMenuItem>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger
                  disabled={mixAndRenderTrackIds.length === 0 || isAligningTracks
                    || playbackState !== 'stopped' || recordingState === 'recording'}
                >
                  Align Tracks 对齐轨道
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuItem disabled={isAligningTracks} onClick={() => void alignSelectedTracks('end-to-end')}>
                    Align End to End 首尾相接
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled={isAligningTracks} onClick={() => void alignSelectedTracks('together')}>
                    Align Together 对齐到一起
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled={isAligningTracks} onClick={() => void alignSelectedTracks('start-zero')}>
                    Start to Zero 起点到零
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled={isAligningTracks} onClick={() => void alignSelectedTracks('start-selection-start')}>
                    Start to Cursor/Selection Start 起点到光标/选区起点
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled={isAligningTracks} onClick={() => void alignSelectedTracks('start-selection-end')}>
                    Start to Selection End 起点到选区终点
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled={isAligningTracks} onClick={() => void alignSelectedTracks('end-selection-start')}>
                    End to Cursor/Selection Start 终点到光标/选区起点
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled={isAligningTracks} onClick={() => void alignSelectedTracks('end-selection-end')}>
                    End to Selection End 终点到选区终点
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuCheckboxItem
                    checked={moveSelectionWithTracks}
                    onCheckedChange={setMoveSelectionPreference}
                  >
                    Move Selection with Tracks 随轨道移动选区
                  </DropdownMenuCheckboxItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger disabled={project.tracks.length === 0 || isSortingTracks}>
                  Sort Tracks 轨道排序
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuItem disabled={isSortingTracks} onClick={() => void sortTracks('time')}>
                    By Start Time 按开始时间
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled={isSortingTracks} onClick={() => void sortTracks('name')}>
                    By Name 按名称
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem
                checked={syncLockTracks}
                onCheckedChange={setSyncLockPreference}
              >
                Keep tracks synchronized (Sync-Lock) 保持轨道同步
              </DropdownMenuCheckboxItem>
              <DropdownMenuItem onClick={convertStereoTracksToMono}>Stereo To Mono 立体声转单声道</DropdownMenuItem>
              <DropdownMenuItem onClick={splitStereoTracksToMono}>Split Stereo To Mono 立体声拆分为单声道</DropdownMenuItem>
              <DropdownMenuItem onClick={handleRecord} disabled={timerRecordSession?.phase === 'waiting' || timerRecordSession?.phase === 'finalizing'}>
                {recordingState === 'recording' ? '停止录音' : '开始录音'}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-6 px-2 text-xs">走带</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem
                onClick={() => setTimerRecordDialogOpen(true)}
                disabled={recordingState === 'recording' || timerRecordSession !== null}
              >
                Timer Record… 定时录音…
              </DropdownMenuItem>
              {timerRecordSession && (
                <DropdownMenuItem
                  onClick={() => void cancelTimerRecord()}
                  disabled={timerRecordSession.phase === 'finalizing'}
                >
                  {timerRecordSession.phase === 'waiting'
                    ? '取消定时录音'
                    : timerRecordSession.phase === 'finalizing' ? '正在完成定时录音' : '停止定时录音'}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-6 px-2 text-xs">生成</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onClick={() => setToneDialogOpen(true)}>音调…</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setChirpDialogOpen(true)}>扫频（Chirp）…</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setDtmfDialogOpen(true)}>DTMF 音调…</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setPluckDialogOpen(true)}>Pluck 拨弦…</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setRhythmDialogOpen(true)}>Rhythm Track 节奏音轨…</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setRissetDialogOpen(true)}>Risset Drum…</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setNoiseDialogOpen(true)}>噪声…</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSilenceDialogOpen(true)}>静默…</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSampleDataImportDialogOpen(true)}>Sample Data Import… 采样数据导入…</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-6 px-2 text-xs">分析</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem
                onClick={() => setPlotSpectrumDialogOpen(true)}
                disabled={!quantizedGeneratorSelection}
              >
                Plot Spectrum… 频谱分析…
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setContrastDialogOpen(true)}
                disabled={!quantizedGeneratorSelection || playbackState === 'playing' || recordingState === 'recording'}
                title="Ctrl+Shift+T；浏览器保留该组合键时可用 Alt+Shift+T"
              >
                Contrast… 对比度分析…
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => { void openMeasureRms(); }}
                disabled={!quantizedGeneratorSelection || playbackState === 'playing' || recordingState === 'recording'}
              >
                Measure RMS… RMS 测量…
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setSampleDataExportDialogOpen(true)}
                disabled={!quantizedGeneratorSelection || playbackState === 'playing' || recordingState === 'recording'}
              >
                Sample Data Export… 采样数据导出…
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setFindClippingDialogOpen(true)}
                disabled={!quantizedGeneratorSelection || playbackState === 'playing' || recordingState === 'recording'}
              >
                Find Clipping… 查找削波…
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setBeatFinderDialogOpen(true)}
                disabled={!quantizedGeneratorSelection || playbackState === 'playing' || recordingState === 'recording'}
              >
                Beat finder… 节拍查找…
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setLabelSoundsDialogOpen(true)}
                disabled={!quantizedGeneratorSelection || playbackState === 'playing' || recordingState === 'recording'}
              >
                Label sounds… 标记声音…
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setRegularIntervalLabelsDialogOpen(true)}
                disabled={!quantizedGeneratorSelection || playbackState === 'playing' || recordingState === 'recording'}
              >
                Regular interval labels… 等间隔标签…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={() => toast.info('独立非官方 Web 版 · 工程仅保存在当前浏览器')}
          >
            帮助
          </Button>
          <div className="flex-1" />
          <span className="hidden px-2 text-[10px] text-[#aab0b6] md:inline">本地工作区</span>
        </nav>

        {/* Top Toolbar - Audacity 4 风格紧凑工具栏 */}
        <header className="au-toolbar flex h-12 shrink-0 items-center gap-2 overflow-x-auto overflow-y-hidden border-b px-2">
          {/* 左侧：项目 + 撤销重做 */}
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" onClick={() => navigate('/')} className="size-8" aria-label="返回工程列表" title="返回工程列表">
              <ArrowLeft className="size-4" />
            </Button>
            <Separator orientation="vertical" className="mx-1 h-5" />
            <span className="px-2 text-sm font-semibold">{project.name}</span>
            <Badge variant="outline" className="text-[10px] font-normal">
              {project.sampleRate} Hz · {project.tracks.length}轨
            </Badge>
            <Separator orientation="vertical" className="mx-1 h-5" />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleUndo}
                  disabled={!canUndo}
                  className="size-8"
                  aria-label="撤销"
                  title="撤销 (Ctrl+Z)"
                >
                  <Undo2 className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>撤销 (Ctrl+Z)</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleRedo}
                  disabled={!canRedo}
                  className="size-8"
                  aria-label="重做"
                  title="重做 (Ctrl+Shift+Z)"
                >
                  <Redo2 className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>重做 (Ctrl+Shift+Z)</TooltipContent>
            </Tooltip>
          </div>

          {/* 中央：走带控制 + 大时间显示 */}
          <div className="flex flex-1 items-center justify-center gap-4">
            <div className="flex items-center gap-0.5">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" onClick={handleSkipBack} className="size-8" aria-label="跳到开头" title="跳到开头">
                    <SkipBack className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>跳到开头</TooltipContent>
              </Tooltip>
              <Button
                variant={playbackState === 'playing' ? 'default' : 'secondary'}
                size="icon"
                onClick={handlePlayPause}
                className="au-secondary size-9"
                aria-label={playbackState === 'playing' ? '暂停' : '播放'}
                title={playbackState === 'playing' ? '暂停' : '播放'}
              >
                {playbackState === 'playing' ? (
                  <Pause className="size-4" />
                ) : (
                  <Play className="size-4 ml-0.5" />
                )}
              </Button>
              <Button variant="ghost" size="icon" onClick={handleStop} className="size-8" aria-label="停止" title="停止">
                <StopCircle className="size-4" />
              </Button>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" onClick={handleSkipForward} className="size-8" aria-label="跳到末尾" title="跳到末尾">
                    <SkipForward className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>跳到末尾</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={loopEnabled ? 'secondary' : 'ghost'}
                    size="icon"
                    onClick={toggleLoopEnabled}
                    disabled={playbackState !== 'stopped' || (!loopRegion && (!selection || selection.end <= selection.start))}
                    className="size-8"
                    aria-label="切换循环播放"
                    aria-pressed={loopEnabled}
                    title={loopRegion ? '启用或停用循环区域；按播放开始循环' : '将当前选区设为循环区域'}
                  >
                    <Repeat className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{loopRegion ? '启用或停用循环区域；按播放开始循环' : '将当前选区设为循环区域'}</TooltipContent>
              </Tooltip>
              <Separator orientation="vertical" className="mx-1.5 h-6" />
              <Button
                variant={recordingState === 'recording' ? 'destructive' : 'ghost'}
                size="icon"
                onClick={handleRecord}
                disabled={timerRecordSession?.phase === 'waiting' || timerRecordSession?.phase === 'finalizing'}
                className={`size-8 ${recordingState === 'recording' ? 'animate-pulse' : ''}`}
                aria-label={recordingState === 'recording' ? '停止录音' : '开始录音'}
                title={recordingState === 'recording' ? '停止录音' : '开始录音'}
              >
                {recordingState === 'recording' ? (
                  <MicOff className="size-4" />
                ) : (
                  <Mic className="size-4" />
                )}
              </Button>
            </div>

            {/* 大时间显示 - Audacity 风格 */}
            <div className="flex items-baseline gap-2 font-mono tabular-nums">
              <span className="text-2xl font-bold tracking-tight">{formatTime(cursorPosition)}</span>
              <span className="text-sm text-muted-foreground">/ {formatTime(projectDuration)}</span>
            </div>
            <Separator orientation="vertical" className="h-7" />
            <PlaybackTimingControls
              tempo={project.tempo}
              timeSignature={project.timeSignature}
              bpmDisabled={playbackState !== 'stopped' || recordingState === 'recording'}
              onTempoChange={handleTempoChange}
              onTimeSignatureChange={handleTimeSignatureChange}
            />
          </div>

          {/* 右侧：视图 + 保存 + 导出 */}
          <div className="flex items-center gap-1">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-7 w-[228px] justify-between px-2 text-xs" aria-label="Workspace 工作区">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="shrink-0 text-[10px] uppercase tracking-wide text-[#aab0b6]">Workspace</span>
                    <span className="truncate">{activeWorkspace.name}</span>
                  </span>
                  <span aria-hidden="true">▾</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-[228px]">
                <DropdownMenuLabel>Workspace</DropdownMenuLabel>
                {workspaceStore.presets.map((preset) => (
                  <DropdownMenuItem key={preset.id} onClick={() => applyWorkspace(preset.id)}>
                    <span className="w-4">{preset.id === workspaceStore.activeId ? '✓' : ''}</span>
                    <span className="flex-1">{preset.name}</span>
                    {!preset.builtIn && <span className="text-[10px] text-muted-foreground">自定义</span>}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={openWorkspaceManager}>编辑 Workspaces…</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setWorkspaceDialogOpen(true)}>将当前布局另存为…</DropdownMenuItem>
                {!!activeWorkspace.builtIn && (
                  <DropdownMenuItem onClick={resetActiveWorkspace}>恢复 {activeWorkspace.name} 预设</DropdownMenuItem>
                )}
                {!activeWorkspace.builtIn && (
                  <DropdownMenuItem onClick={deleteActiveWorkspace}>删除当前 Workspace</DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            <Separator orientation="vertical" className="mx-1 h-5" />
            <Tabs
              value={viewMode}
              onValueChange={(v) => setViewMode(v as ViewMode)}
              className="w-auto"
            >
              <TabsList className="h-8">
                <TabsTrigger value="waveform" className="h-7 gap-1 text-xs px-2">
                  <Waves className="size-3.5" />
                  波形
                </TabsTrigger>
                <TabsTrigger
                  value="waveformDb"
                  className="h-7 gap-1 text-xs px-2"
                  data-testid="waveform-db-tab"
                  title="Waveform (dB)"
                >
                  <AudioWaveform className="size-3.5" />
                  波形 (dB)
                </TabsTrigger>
                <TabsTrigger
                  value="waveformDbLinear"
                  className="h-7 gap-1 text-xs px-2"
                  data-testid="waveform-db-linear-tab"
                  title="Waveform Linear (dB)"
                >
                  <AudioWaveform className="size-3.5" />
                  线性 dB
                </TabsTrigger>
                <TabsTrigger value="spectrum" className="h-7 gap-1 text-xs px-2">
                  <BarChart3 className="size-3.5" />
                  频谱
                </TabsTrigger>
                <TabsTrigger value="both" className="h-7 gap-1 text-xs px-2">
                  <Layers className="size-3.5" />
                  叠加
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <Separator orientation="vertical" className="mx-1 h-5" />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="sm" onClick={saveProject} disabled={isSaving} className="h-8">
                  <Save className="mr-1 size-3.5" />
                  {isSaving ? '保存中' : '保存'}
                </Button>
              </TooltipTrigger>
              <TooltipContent>保存工程 (Ctrl+S)</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="secondary" size="sm" onClick={() => setExportDialogOpen(true)} className="au-secondary h-8">
                  <Download className="mr-1 size-3.5" />
                  导出
                </Button>
              </TooltipTrigger>
              <TooltipContent>导出音频文件</TooltipContent>
            </Tooltip>
          </div>
        </header>

        <section
          aria-label="录音与播放电平表"
          data-testid="audio-level-meters"
          data-mic-input-active={microphoneInputActive ? 'true' : 'false'}
          data-mic-metering={recordingMonitoringPreferences.showMicMetering ? 'true' : 'false'}
          data-input-monitoring={recordingMonitoringPreferences.inputMonitoring ? 'true' : 'false'}
          className="au-toolbar flex h-9 shrink-0 items-center justify-end gap-6 overflow-x-auto overflow-y-hidden border-b px-3"
        >
          <LevelMeter
            mode="recording"
            active={recordingState === 'recording' || (microphoneInputActive && playbackState === 'stopped')}
          />
          <LevelMeter mode="playback" active={playbackState === 'playing'} />
          <MeterDbRangeLabel />
        </section>

        {/* Edit Toolbar */}
        <div className="au-toolbar flex h-9 shrink-0 items-center gap-1 overflow-x-auto overflow-y-hidden border-b px-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="text-xs">
                <Scissors className="mr-1 size-3.5" />
                编辑
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem data-testid="toolbar-cut-selection" onClick={() => void handleCut()} disabled={!selection}>
                <Scissors className="mr-2 size-4" />
                剪切 (Ctrl+X)
              </DropdownMenuItem>
              <DropdownMenuItem data-testid="toolbar-delete-selection" onClick={() => void handleDeleteSelection()} disabled={!selection}>
                <Trash2 className="mr-2 size-4" />
                删除 (Delete)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => void handleCopy()} disabled={!selection}>
                <Copy className="mr-2 size-4" />
                复制 (Ctrl+C)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handlePaste()}>
                <Clipboard className="mr-2 size-4" />
                粘贴 (Ctrl+V)
              </DropdownMenuItem>
              {renderSelectionEditMenus()}
              <DropdownMenuItem onClick={() => void splitClipsAtCursor()} disabled={!canSplitAtCursor}>
                <Scissors className="mr-2 size-4" />
                在光标处分割 (Ctrl+I)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleTrim} disabled={!selection}>
                <Crop className="mr-2 size-4" />
                裁剪到选区
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Separator orientation="vertical" className="mx-1 h-5" />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="text-xs">
                <Volume2 className="mr-1 size-3.5" />
                效果
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuLabel>增益 / 音量</DropdownMenuLabel>
              <DropdownMenuItem
                onClick={() => setAmplifyDialogOpen(true)}
                disabled={!quantizedGeneratorSelection}
              >
                放大…
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => applyGainToSelection(3)} disabled={!selection}>
                增益 +3 dB
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => applyGainToSelection(-3)} disabled={!selection}>
                增益 -3 dB
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>淡入淡出</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => applyFadeToSelection('in')} disabled={!selection}>
                淡入
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => applyFadeToSelection('out')} disabled={!selection}>
                淡出
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setAdjustableFadeDialogOpen(true)}
                disabled={!quantizedGeneratorSelection}
              >
                Adjustable Fade 可调淡化…
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>滤波 / 音色</DropdownMenuLabel>
              <DropdownMenuItem
                onClick={() => setBassTrebleDialogOpen(true)}
                disabled={!quantizedGeneratorSelection}
              >
                低音和高音…
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setFilterCurveEqDialogOpen(true)}
                disabled={!quantizedGeneratorSelection}
              >
                Filter Curve EQ 滤波曲线均衡…
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setGraphicEqDialogOpen(true)}
                disabled={!quantizedGeneratorSelection}
              >
                Graphic EQ 图示均衡…
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setNotchFilterDialogOpen(true)}
                disabled={!quantizedGeneratorSelection || isApplyingNotchFilter}
                title="移除单一中心频率周围的窄带"
              >
                Notch Filter 陷波滤波…
              </DropdownMenuItem>
              <DropdownMenuItem
                data-testid="effect-shelf-filter"
                onClick={() => setShelfFilterDialogOpen(true)}
                disabled={!quantizedGeneratorSelection || isApplyingShelfFilter}
                title="使用 Audacity slope=1 低架或高架滤波器处理选区"
              >
                Shelf Filter 搁架滤波…
              </DropdownMenuItem>
              <DropdownMenuLabel>Spectral tools</DropdownMenuLabel>
              <DropdownMenuItem
                data-testid="effect-spectral-delete-selection"
                onClick={() => setSpectralEditKind('delete-selection')}
                disabled={!quantizedGeneratorSelection || isApplyingSpectralEdit}
                title="Audacity 4 spectral-delete：Blackman 窗口化 sinc FIR 删除频率选区"
              >
                Delete selection…
              </DropdownMenuItem>
              <DropdownMenuItem
                data-testid="effect-spectral-delete-center"
                onClick={() => setSpectralEditKind('delete-center')}
                disabled={!quantizedGeneratorSelection || isApplyingSpectralEdit}
                title="Audacity 4 SpectralEditMulti：删除中心频率"
              >
                Delete selection center frequency…
              </DropdownMenuItem>
              <DropdownMenuItem
                data-testid="effect-spectral-amplify-center"
                onClick={() => setSpectralEditKind('amplify-center')}
                disabled={!quantizedGeneratorSelection || isApplyingSpectralEdit}
                title="Audacity 4 SpectralEditParametricEQ：增益中心频率"
              >
                Amplify selection center frequency…
              </DropdownMenuItem>
              <DropdownMenuItem
                data-testid="effect-spectral-amplify-selection"
                onClick={() => setSpectralEditKind('amplify-selection')}
                disabled={!quantizedGeneratorSelection || isApplyingSpectralEdit}
                title="Audacity 4 SpectralEditShelves：增益频率选区"
              >
                Amplify selection…
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setWahWahDialogOpen(true)}
                disabled={!quantizedGeneratorSelection}
              >
                Wah Wah…
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setPhaserDialogOpen(true)}
                disabled={!quantizedGeneratorSelection}
              >
                Phaser…
              </DropdownMenuItem>
              <DropdownMenuItem
                data-testid="effect-highpass-filter"
                onClick={() => setPassFilterKind('highpass')}
                disabled={!quantizedGeneratorSelection || isApplyingPassFilter}
                title="使用 Audacity 4 highpass.ny 一阶或 Butterworth 级联处理选区"
              >
                High-pass filter 高通滤波…
              </DropdownMenuItem>
              <DropdownMenuItem
                data-testid="effect-lowpass-filter"
                onClick={() => setPassFilterKind('lowpass')}
                disabled={!quantizedGeneratorSelection || isApplyingPassFilter}
                title="使用 Audacity 4 lowpass.ny 一阶或 Butterworth 级联处理选区"
              >
                Low-pass filter 低通滤波…
              </DropdownMenuItem>
              <DropdownMenuItem
                data-testid="effect-classic-filters"
                onClick={() => setClassicFilterDialogOpen(true)}
                disabled={!quantizedGeneratorSelection}
              >
                Classic Filters…
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setTremoloDialogOpen(true)}
                disabled={!quantizedGeneratorSelection}
              >
                Tremolo…
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setVocoderDialogOpen(true)}
                disabled={!quantizedGeneratorSelection}
              >
                Vocoder…
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setAutoDuckDialogOpen(true)}
                disabled={!quantizedGeneratorSelection || autoDuckTrackOptions.length < 2}
              >
                Auto Duck…
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>动态</DropdownMenuLabel>
              <DropdownMenuItem
                onClick={() => setCompressorDialogOpen(true)}
                disabled={!quantizedGeneratorSelection}
              >
                Compressor 压缩器…
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => void handleApplyLegacyCompressor()}
                disabled={!quantizedGeneratorSelection}
              >
                Legacy Compressor 旧版压缩器
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => void handleApplyNoiseGate()}
                disabled={!quantizedGeneratorSelection}
              >
                Noise Gate 噪声门
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setLimiterDialogOpen(true)}
                disabled={!quantizedGeneratorSelection}
              >
                Limiter 限制器…
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setLegacyLimiterDialogOpen(true)}
                disabled={!quantizedGeneratorSelection}
              >
                Legacy limiter 旧版限制器…
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>延迟 / 混响</DropdownMenuLabel>
              <DropdownMenuItem
                onClick={() => setEchoDialogOpen(true)}
                disabled={!quantizedGeneratorSelection}
              >
                Echo 回声…
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setDelayDialogOpen(true)}
                disabled={!quantizedGeneratorSelection}
              >
                Delay 延迟…
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setCrossfadeDialogOpen(true)}
                disabled={!quantizedGeneratorSelection}
              >
                Crossfade Tracks 交叉淡化…
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={handleCrossfadeClips}
                disabled={!quantizedGeneratorSelection || isApplyingCrossfadeClips}
              >
                Crossfade Clips 片段交叉淡化
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={handleStudioFadeOut}
                disabled={!quantizedGeneratorSelection || isApplyingStudioFadeOut}
              >
                Studio Fade Out 工作室淡出
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setReverbDialogOpen(true)}
                disabled={!quantizedGeneratorSelection}
              >
                Reverb 混响…
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setDistortionDialogOpen(true)}
                disabled={!quantizedGeneratorSelection}
              >
                Distortion 失真（离线）…
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>时间 / 音高</DropdownMenuLabel>
              <DropdownMenuItem
                onClick={() => setChangeSpeedDialogOpen(true)}
                disabled={!quantizedGeneratorSelection}
              >
                Change Speed（速度及音高）…
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setChangePitchDialogOpen(true)}
                disabled={!quantizedGeneratorSelection}
              >
                Change Pitch（保持时长）…
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setChangeTempoDialogOpen(true)}
                disabled={!quantizedGeneratorSelection}
              >
                Change Tempo（保持音高）…
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setSlidingStretchDialogOpen(true)}
                disabled={!quantizedGeneratorSelection}
              >
                Sliding Stretch（连续变速/变调）…
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setPaulstretchDialogOpen(true)}
                disabled={!quantizedGeneratorSelection}
              >
                Paulstretch（极端时间拉伸）…
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => setRepeatDialogOpen(true)}
                disabled={!quantizedGeneratorSelection}
              >
                Repeat 重复…
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => void handleDuplicateSelection()}
                disabled={!quantizedGeneratorSelection}
              >
                Duplicate 复制为新轨道
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>处理</DropdownMenuLabel>
              <DropdownMenuItem
                onClick={() => setNoiseReductionDialogOpen(true)}
                disabled={!quantizedGeneratorSelection}
                title="先选择纯噪声获取 Profile，再选择待处理音频应用官方频谱降噪"
              >
                Noise Reduction 降噪…
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setClickRemovalDialogOpen(true)}
                disabled={!quantizedGeneratorSelection}
                title="检测并替换窄尖峰，每条轨道的选区必须大于 4096 个采样"
              >
                Click Removal 咔哒声消除…
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setTruncateSilenceDialogOpen(true)}
                disabled={!quantizedGeneratorSelection}
                title="按 Audacity 4.0.2 截断或压缩静音，并在剪切点交叉淡化"
              >
                Truncate Silence 静音截断…
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={handleApplyRepair}
                disabled={!quantizedGeneratorSelection || isApplyingRepair}
                title="使用周边音频插值修复，每条轨道最多 128 个采样"
              >
                修复（Repair）
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setClipFixDialogOpen(true)}
                disabled={!quantizedGeneratorSelection || isApplyingClipFix}
                title="检测削波区域并用三次曲线重建峰值"
              >
                Clip Fix 削波修复…
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setNormalizeDialogOpen(true)}
                disabled={!quantizedGeneratorSelection}
              >
                标准化…
              </DropdownMenuItem>
              <DropdownMenuItem
                data-testid="effect-remove-dc-offset"
                onClick={() => void handleApplyRemoveDcOffset()}
                disabled={!quantizedGeneratorSelection || isApplyingRemoveDcOffset}
                title="按 Audacity Remove DC offset 逐声道减去选区均值，将音频垂直居中到 0.0"
              >
                Remove DC offset 去除直流偏移
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setLoudnessDialogOpen(true)}
                disabled={!quantizedGeneratorSelection}
                title="按 Audacity EBU R128 感知响度或 RMS 标准化完整选区"
              >
                Loudness Normalization 响度标准化…
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={handleApplyInvert}
                disabled={!quantizedGeneratorSelection || isApplyingInvert}
                title="按 Audacity Invert 将所选采样逐点取反，不改变时间顺序"
              >
                Invert 极性反转
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={applyReverse}
                disabled={!quantizedGeneratorSelection || isApplyingReverse}
                title="按 Audacity Reverse 逐声道反转选区采样，不改变采样极性"
              >
                Reverse 时间反转
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Separator orientation="vertical" className="mx-1 h-5" />

          <Button variant="ghost" size="sm" onClick={handleImportClick} className="text-xs">
            <Plus className="mr-1 size-3.5" />
            导入音频
          </Button>

          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files) {
                handleFiles(e.target.files);
                e.target.value = '';
              }
            }}
          />

          {/* Selection status indicator */}
          <div className="flex items-center gap-2 text-xs">
            {selection ? (
              <div className="flex items-center gap-1.5 rounded-sm border border-[#84b5ff]/40 bg-[#84b5ff]/10 px-2 py-0.5 text-[#a2c7ff]">
                <span className="size-1.5 rounded-full bg-[#84b5ff]" />
                <span>选区：{formatTime(selection.start)} → {formatTime(selection.end)}</span>
                <span className="text-muted-foreground">（{formatTime(selection.end - selection.start)}）</span>
                {spectralSelection && (
                  <span
                    className="rounded-sm border border-[#fff2a8]/40 bg-[#fff2a8]/10 px-1.5 py-0.5 text-[#fff2a8]"
                    data-testid="spectral-selection-status"
                  >
                    频率 {spectralSelection.lowHz.toFixed(3)}–{spectralSelection.highHz.toFixed(3)} Hz
                  </span>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="ml-1 size-5 hover:bg-[#84b5ff]/20"
                  onClick={clearSelection}
                  aria-label="清除选区"
                  title="清除选区"
                >
                  <X className="size-3" />
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <MousePointer2 className="size-3" />
                <span>拖拽时间轴创建选区</span>
              </div>
            )}
          </div>

          {selectedClips.length > 0 && (
            <div className="flex items-center gap-1 rounded-sm border border-[#434a50] px-1.5 py-0.5 text-[11px]">
              <span>{selectedClips.length} 个片段</span>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-1.5 text-[10px]"
                onClick={() => {
                  const key = selectedClips[selectedClips.length - 1];
                  void handleClipReset(key.trackId, key.clipId);
                }}
              >
                速度 100%
              </Button>
              <Button variant="ghost" size="icon" className="size-6" onClick={() => void handleDeleteSelectedClips()} aria-label="删除选中片段" title="删除选中片段">
                <Trash2 className="size-3" />
              </Button>
              <Button variant="ghost" size="icon" className="size-6" onClick={() => setSelectedClips([])} aria-label="清除片段选择" title="清除片段选择">
                <X className="size-3" />
              </Button>
            </div>
          )}

          <div className="flex-1" />

          {/* Zoom controls */}
          <div className="flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  onClick={() => changeHorizontalZoom('out')}
                  disabled={horizontalZoom <= MIN_HORIZONTAL_ZOOM}
                  aria-label="水平缩小"
                  title="水平缩小"
                >
                  <ZoomOut className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>水平缩小</TooltipContent>
            </Tooltip>
            <span className="w-12 text-center text-xs text-muted-foreground">
              {Math.round(horizontalZoom)}%
            </span>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  onClick={() => changeHorizontalZoom('in')}
                  disabled={horizontalZoom >= MAX_HORIZONTAL_ZOOM}
                  aria-label="水平放大"
                  title="水平放大"
                >
                  <ZoomIn className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>水平放大</TooltipContent>
            </Tooltip>
          </div>
        </div>

        {/* Main Area */}
        <div className="flex flex-1 overflow-hidden">
          {/* Track Panel (Left) */}
          {showTrackPanel && (
          <div className="flex w-60 shrink-0 flex-col border-r border-[#434a50] bg-[#252b31]">
            <div className="au-toolbar flex h-7 items-center justify-between border-b px-2 text-xs text-[#aab0b6]">
              <span>轨道</span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="size-6" onClick={addTrack} aria-label="添加轨道" title="添加轨道">
                    <Plus className="size-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>添加轨道</TooltipContent>
              </Tooltip>
            </div>

            <div className="flex-1 overflow-y-auto">
              {project.tracks.map((track, trackIndex) => (
                <TrackPanelRow
                  key={track.id}
                  track={track}
                  isSelected={selectedTrackId === track.id}
                  isMoving={isMovingTrack}
                  isDuplicating={isDuplicatingTrack}
                  isChannelOperation={isTrackChannelOperation}
                  channelCount={getTrackChannelCount(track)}
                  sampleRate={getTrackSampleRate(track)}
                  isRecording={recordingState === 'recording'}
                  isResampling={isResampling}
                  canMakeStereo={selectedTrackId === track.id
                    && getTrackChannelCount(track) === 1
                    && trackIndex + 1 < project.tracks.length
                    && getTrackChannelCount(project.tracks[trackIndex + 1]!) === 1}
                  canMoveUp={trackIndex > 0}
                  canMoveDown={trackIndex < project.tracks.length - 1}
                  contextMenuOpen={trackContextMenuId === track.id}
                  onContextMenuOpenChange={(open) => {
                    setTrackContextMenuId((current) => open ? track.id : current === track.id ? null : current);
                    if (open) {
                      setSelectedTrackId(track.id);
                      setEffectsPanelTrackId(track.id);
                      void ensureTrackChannelCount(track);
                      const nextTrack = project.tracks[trackIndex + 1];
                      if (nextTrack) void ensureTrackChannelCount(nextTrack);
                    }
                  }}
                  onSelect={() => {
                    setSelectedTrackId(track.id);
                    setEffectsPanelTrackId(track.id);
                  }}
                  onMute={() => toggleMute(track.id)}
                  onSolo={() => toggleSolo(track.id)}
                  onArm={() => toggleArm(track.id)}
                  onGainChange={(db) => updateTrackGain(track.id, db)}
                  onPanChange={(pan) => updateTrackPan(track.id, pan)}
                  onRename={(name) => renameTrack(track.id, name)}
                  onDelete={() => deleteTrack(track.id)}
                  onDuplicate={() => void duplicateTrack(track.id)}
                  onSwapStereoChannels={() => void swapStereoChannels(track.id)}
                  onSplitStereo={(mode) => void splitStereoTrack(track.id, mode)}
                  onMakeStereo={() => void requestMakeStereoTrack(track.id)}
                  onFormatChange={(format) => void changeTrackFormat(track.id, format)}
                  onRateChange={(rate) => void changeTrackRate(rate, getTrackContextTargetIds(track.id))}
                  onOpenRateDialog={() => openTrackRateDialog(track.id)}
                  onResample={() => openTrackResampleDialog(track.id)}
                  viewMode={getTrackViewMode(track, viewMode)}
                  halfWave={getTrackHalfWave(track, halfWave)}
                  onViewModeChange={(mode) => void changeTrackViewMode(track.id, mode)}
                  onHalfWaveChange={(value) => void changeTrackHalfWave(track.id, value)}
                  onOpenSpectrogramSettings={() => setSpectrogramSettingsTrackId(track.id)}
                  onColorChange={(colorIndex) => void changeTrackColor(track.id, colorIndex)}
                  showVerticalRulers={showVerticalRulers}
                  onShowVerticalRulersChange={(visible) => setShowVerticalRulers(visible)}
                  showMicMetering={recordingMonitoringPreferences.showMicMetering}
                  inputMonitoring={recordingMonitoringPreferences.inputMonitoring}
                  onShowMicMeteringChange={(enabled) => changeRecordingMonitoringPreferences({ showMicMetering: enabled })}
                  onInputMonitoringChange={(enabled) => changeRecordingMonitoringPreferences({ inputMonitoring: enabled })}
                  onMove={(direction) => void moveTrack(track.id, direction)}
                  onOpenEffects={() => {
                    setSelectedTrackId(track.id);
                    setEffectsPanelTrackId(track.id);
                  }}
                />
              ))}
              {getProjectLabelTracks(project).map((labelTrack) => {
                const effectiveTracks = getProjectLabelTracks(project);
                const labelCount = (project.analysisLabels ?? []).filter((label) => (
                  resolveAnalysisLabelTrackId(label, effectiveTracks) === labelTrack.id
                )).length;
                return (
                  <div
                    key={labelTrack.id}
                    data-testid={`label-track-panel-${labelTrack.id}`}
                    className="flex h-10 shrink-0 border-b border-[#434a50] bg-[#20262b] px-1 text-[#d8c49a]"
                    style={{ borderLeft: `4px solid ${getLabelTrackColor(labelTrack)}` }}
                  >
                    <button
                      type="button"
                      aria-label={`编辑 Label Track ${labelTrack.name}`}
                      title={`${labelTrack.name} · 打开 Edit Labels`}
                      className="flex min-w-0 flex-1 flex-col justify-center rounded-sm px-2 text-left hover:bg-[#30383f] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f0c56d]"
                      onClick={() => setLabelEditorDialogOpen(true)}
                    >
                      <span className="truncate text-xs font-medium">{labelTrack.name}</span>
                      <span className="text-[10px] text-[#aab0b6]">{labelCount} 个标签</span>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
          )}

          {/* Timeline Area (Center) */}
          <div
            ref={timelineRef}
            data-testid="timeline-viewport"
            className="relative flex-1 overflow-auto bg-[#252b31]"
            onScroll={(e) => setScrollX((e.target as HTMLDivElement).scrollLeft)}
          >
            {/* Time Ruler */}
            <div
              className="au-toolbar sticky top-0 z-20 h-7 shrink-0 border-b"
              style={{ width: timelineContentWidth }}
            >
              <div className="relative h-full" style={{ marginLeft: rulerWidth, width: totalWidth }}>
                <TimeRuler duration={timelineDuration} pxPerSec={pxPerSec} />
                <LoopRulerInteraction
                  region={loopRegion}
                  enabled={loopEnabled}
                  pxPerSec={pxPerSec}
                  maxTime={totalWidth / pxPerSec}
                  disabled={playbackState !== 'stopped'}
                  onSnapTime={resolveTimelineSnap}
                  onChange={changeLoopRegion}
                  onToggle={toggleLoopEnabled}
                />
              </div>
            </div>

            {/* Playhead */}
            <div
              className="pointer-events-none absolute top-0 bottom-0 z-10 w-px bg-[#e4e5e7]"
              style={{ left: rulerWidth + cursorPosition * pxPerSec }}
            >
              <div className="absolute -left-1 top-7 size-2 rotate-45 bg-[#e4e5e7]" />
            </div>

            {/* Selection overlay */}
            {selection && (
              <div
                className="au-selection pointer-events-none absolute top-7 bottom-0 z-[5]"
                style={{
                  left: rulerWidth + selection.start * pxPerSec,
                  width: (selection.end - selection.start) * pxPerSec,
                }}
              />
            )}

            {/* Independent Audacity 4 loop region overlay */}
            {loopRegion && (
              <div
                aria-label="循环区域"
                data-loop-enabled={loopEnabled}
                data-loop-start={loopRegion.start}
                data-loop-end={loopRegion.end}
                className={`pointer-events-none absolute top-7 bottom-0 z-[6] border-x ${loopEnabled ? 'border-[#8bd5a7] bg-[#8bd5a7]/10' : 'border-[#aab0b6]/60 bg-[#aab0b6]/5'}`}
                style={{
                  left: rulerWidth + loopRegion.start * pxPerSec,
                  width: (loopRegion.end - loopRegion.start) * pxPerSec,
                }}
              >
                <span className={`sticky left-1 top-1 inline-block rounded-sm px-1 text-[9px] ${loopEnabled ? 'bg-[#8bd5a7] text-[#1c1e21]' : 'bg-[#5b6168] text-white'}`}>
                  循环 {formatTime(loopRegion.start)}–{formatTime(loopRegion.end)}
                </span>
              </div>
            )}

            {/* Drag overlay */}
            <AnimatePresence>
              {isDragOver && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 z-30 flex items-center justify-center bg-primary/10 backdrop-blur-sm"
                >
                  <div className="rounded-lg border-2 border-dashed border-primary bg-background/80 px-8 py-6 text-center">
                    <Music className="mx-auto mb-2 size-10 text-primary" />
                    <p className="font-medium">释放以导入音频文件</p>
                    <p className="text-xs text-muted-foreground">支持 WAV、MP3、OGG、FLAC 等格式</p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Empty state */}
            {project.tracks.every((t) => t.clips.length === 0) && (
              <div
                className="sticky left-0 flex items-center justify-center py-20"
                style={{ width: '100%', minHeight: 300 }}
              >
                <Empty className="w-auto border-0">
                  <EmptyContent>
                    <EmptyMedia variant="icon">
                      <Music className="size-6" />
                    </EmptyMedia>
                    <EmptyHeader>
                      <EmptyTitle>空工程</EmptyTitle>
                      <EmptyDescription>
                        导入音频、生成音调或开始录音来开始编辑
                      </EmptyDescription>
                    </EmptyHeader>
                    <div className="flex gap-2 pt-2">
                      <Button size="sm" onClick={handleImportClick}>
                        <Plus className="mr-1 size-3.5" />
                        导入音频
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => setToneDialogOpen(true)}>
                        <AudioWaveform className="mr-1 size-3.5" />
                        生成音调
                      </Button>
                      <Button size="sm" variant="secondary" onClick={handleRecord}>
                        <Mic className="mr-1 size-3.5" />
                        开始录音
                      </Button>
                    </div>
                  </EmptyContent>
                </Empty>
              </div>
            )}

            {/* Waveform / Spectrum for each track */}
            {project.tracks.map((track, trackIndex) => (
              <TrackTimeline
                key={track.id}
                track={track}
                trackIndex={trackIndex}
                projectId={project.id}
                sampleRate={project.sampleRate}
                pxPerSec={pxPerSec}
                totalWidth={totalWidth}
                rulerWidth={rulerWidth}
                dbRange={waveformDbRange}
                viewMode={getTrackViewMode(track, viewMode)}
                halfWave={getTrackHalfWave(track, halfWave)}
                onViewModeChange={(mode) => void changeTrackViewMode(track.id, mode)}
                onOpenSpectrogramSettings={() => setSpectrogramSettingsTrackId(track.id)}
                onHalfWaveChange={(value) => void changeTrackHalfWave(track.id, value)}
                onVerticalZoomChange={setVerticalZoom}
                selection={selection}
                spectralSelection={spectralSelection}
                scrollX={scrollX}
                verticalZoom={verticalZoom}
                showClipping={showClipping}
                showRMS={showRMS}
                isSelected={selectedTrackId === track.id}
                selectedClips={selectedClips}
                onSelectClip={(clipId, mode) => selectClip(track.id, clipId, mode)}
                onTrimClip={(clipId, edge, delta, bypassSnap) => handleClipEdgeTrim(track.id, clipId, edge, delta, bypassSnap)}
                onStretchClip={(clipId, edge, delta, bypassSnap) => handleClipStretch(track.id, clipId, edge, delta, bypassSnap)}
                onMoveClip={(clipId, delta, bypassSnap) => handleClipMove(track.id, clipId, delta, bypassSnap)}
                onResolveClipDelta={(clipId, operation, delta, bypassSnap) => resolveClipSnapDelta(track.id, clipId, operation, delta, bypassSnap)}
                onResetClip={(clipId) => handleClipReset(track.id, clipId)}
                onClipProperties={(clipId) => openClipProperties(track.id, clipId)}
                onPitchAndSpeed={(clipId) => openClipPitchAndSpeed(track.id, clipId)}
                onResetPitchAndSpeed={(clipId) => resetClipPitchAndSpeed(track.id, clipId)}
                onRenderPitchAndSpeed={(clipId) => renderClipPitchAndSpeed(track.id, clipId)}
                onToggleStretchWithTempoChanges={(clipId) => toggleStretchWithTempoChanges(track.id, clipId)}
                onClipColorChange={(clipId, colorIndex) => changeClipColor(track.id, clipId, colorIndex)}
                onEditCommand={(clipId, command) => void runClipContextEditCommand(track.id, clipId, command)}
                onMultiClipEditCommand={(clipId, command) => void runMultiClipContextEditCommand(track.id, clipId, command)}
                canJoinMultiSelection={planMultiClipJoin(project, selectedClips) !== null}
                canGroupMultiSelection={multiClipGroupState?.canGroup ?? false}
                canUngroupMultiSelection={multiClipGroupState?.canUngroup ?? false}
                multiClipOperationInProgress={Boolean(
                  selectionEditOperation || selectionUtilityOperation
                  || renderingPitchAndSpeedClipId || splittingSilenceClipId,
                )}
                onSplitAtSilences={(clipId) => splitClipAtSilences(track.id, clipId)}
                splittingSilenceClipId={splittingSilenceClipId}
                renamingClipKey={renamingClipKey}
                onRenameClipStart={(clipId) => {
                  selectClip(track.id, clipId, 'replace');
                  setRenamingClipKey(clipKeyId({ trackId: track.id, clipId }));
                }}
                onRenameClip={(clipId, newTitle) => changeClipTitle(track.id, clipId, newTitle)}
                onRenameClipEnd={() => setRenamingClipKey(null)}
                tempoChangesDisabled={recordingState === 'recording'}
                renderingPitchAndSpeedClipId={renderingPitchAndSpeedClipId}
                onSelectionChange={(start, end) => handleSelectionChange(start, end, track.id)}
                onSelectionContextMenu={(trackId, x, y) => void openSelectionContextMenu(trackId, x, y)}
                onSpectralSelectionChange={handleSpectralSelectionChange}
                onCursorChange={handleCursorChange}
                onSnapTime={resolveTimelineSnap}
                channelHeightRatio={channelHeightRatios[track.id] ?? 0.5}
                asymmetricStereoHeightsEnabled={asymmetricStereoHeightsEnabled}
                onChannelHeightRatioChange={(ratio) => changeChannelHeightRatio(track.id, ratio)}
                onChannelHeightRatioCommit={(ratio) => commitChannelHeightRatio(track.id, ratio)}
              />
            ))}

            <ClippingLabelTimeline
              labels={project.analysisLabels ?? []}
              labelTracks={getProjectLabelTracks(project)}
              tracks={project.tracks}
              pxPerSec={pxPerSec}
              totalWidth={totalWidth}
              offsetX={rulerWidth}
              onSelect={handleAnalysisLabelSelect}
              onEdit={() => setLabelEditorDialogOpen(true)}
              onRenameTrack={(trackId, name) => void handleRenameLabelTrack(trackId, name)}
              onDuplicateTrack={(trackId) => void handleDuplicateLabelTrack(trackId)}
              onDeleteTrack={(trackId) => void handleDeleteLabelTrack(trackId)}
              onMoveTrack={(trackId, direction) => void handleMoveLabelTrack(trackId, direction)}
              onTrackColorChange={(trackId, colorIndex) => void handleLabelTrackColorChange(trackId, colorIndex)}
              onExportLabels={(trackId) => {
                setExportLabelsTrackId(trackId);
                setExportLabelsDialogOpen(true);
              }}
            />

            {/* Bottom padding for transport bar visibility */}
            <div className="h-20" />
          </div>

          {/* Effects Panel (Right) */}
          {effectsPanelTrackId && (
            <EffectPanel
              track={project.tracks.find((t) => t.id === effectsPanelTrackId)!}
              onClose={() => setEffectsPanelTrackId(null)}
              onAddEffect={(type) => addEffect(effectsPanelTrackId, type)}
              onUpdateEffect={(effectId, params) =>
                updateEffectParams(effectsPanelTrackId, effectId, params)
              }
              onToggleBypass={(effectId) =>
                toggleEffectBypass(effectsPanelTrackId, effectId)
              }
              onToggleAllEffects={(trackId, active) => toggleAllEffects(trackId, active)}
              onRemoveEffect={(effectId) =>
                removeEffect(effectsPanelTrackId, effectId)
              }
              onMoveEffect={(effectId, toIndex) =>
                moveEffect(effectsPanelTrackId, effectId, toIndex)
              }
              onReplaceEffect={(effectId, type) =>
                replaceEffect(effectsPanelTrackId, effectId, type)
              }
            />
          )}
        </div>

        {showMixer && (
          <section aria-label="混音器" className="au-toolbar flex h-40 shrink-0 items-stretch gap-2 overflow-x-auto border-t p-2">
            <div className="flex min-w-24 flex-col justify-center border-r border-[#434a50] px-3 text-xs">
              <span className="font-semibold">混音器</span>
              <span className="mt-1 text-[10px] text-[#aab0b6]">{project.tracks.length} 条轨道 · 立体声输出</span>
              <Button variant="secondary" size="sm" className="au-secondary mt-3 h-6 text-[10px]" onClick={() => setExportDialogOpen(true)}>
                导出混音
              </Button>
            </div>
            {project.tracks.map((track) => (
              <div key={track.id} className="au-panel flex w-40 shrink-0 flex-col gap-1 rounded-sm p-2 text-[10px]">
                <div className="flex items-center gap-1">
                  <span className="size-2 rounded-sm" style={{ backgroundColor: track.color }} />
                  <span className="flex-1 truncate font-medium">{track.name}</span>
                  <span>{gainToDb(track.gain).toFixed(1)} dB</span>
                </div>
                <div className="flex flex-1 items-center justify-around gap-2">
                  <GainKnob value={gainToDb(track.gain)} onChange={(db) => updateTrackGain(track.id, db)} />
                  <div className="flex gap-1">
                    <Button variant={track.muted ? 'secondary' : 'ghost'} size="icon" className="size-6 text-[10px]" onClick={() => toggleMute(track.id)} aria-label={`混音器静音 ${track.name}`}>M</Button>
                    <Button variant={track.solo ? 'secondary' : 'ghost'} size="icon" className="size-6 text-[10px]" onClick={() => toggleSolo(track.id)} aria-label={`混音器独奏 ${track.name}`}>S</Button>
                  </div>
                </div>
                <Slider aria-label={`混音器声像 ${track.name}`} value={[track.pan]} min={-1} max={1} step={0.01} onValueChange={(values) => updateTrackPan(track.id, values[0])} />
                <span className="text-center text-[#aab0b6]">{track.pan < -0.01 ? `左 ${Math.round(-track.pan * 100)}` : track.pan > 0.01 ? `右 ${Math.round(track.pan * 100)}` : '中央'}</span>
              </div>
            ))}
          </section>
        )}

        {/* Audacity 4 selection toolbar */}
        <div className="au-toolbar flex min-h-12 shrink-0 flex-wrap items-center justify-between gap-2 border-t px-3 py-1.5 text-[11px]">
          <div className="flex min-w-44 items-center gap-3">
            <span className="font-medium text-[#e4e5e7]">
              {recordingState === 'recording' ? '录制中' : playbackState === 'playing' ? '播放中' : playbackState === 'paused' ? '已暂停' : '已停止'}
            </span>
            <span className="text-[#aab0b6]">
              {selection ? '已选择音频区间' : '在时间轴上拖拽以选择音频'}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5" aria-label="吸附工具栏">
            <Button
              type="button"
              variant={snapEnabled ? 'secondary' : 'ghost'}
              size="sm"
              className="h-7 px-2 text-[10px]"
              aria-label={snapEnabled ? '关闭吸附' : '启用吸附'}
              aria-pressed={snapEnabled}
              title="吸附到片段边界或时间网格；8 px 容差，Alt 拖动临时关闭"
              onClick={() => setSnapEnabled((enabled) => !enabled)}
            >
              <Magnet className="mr-1 size-3.5" />
              吸附
            </Button>
            <Select value={snapMode} onValueChange={(value) => setSnapMode(value as SnapMode)} disabled={!snapEnabled}>
              <SelectTrigger aria-label="吸附目标" className="h-7 w-28 text-[10px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="clips">片段边界</SelectItem>
                <SelectItem value="samples">采样点</SelectItem>
                <SelectItem value="milliseconds">毫秒</SelectItem>
                <SelectItem value="seconds">秒</SelectItem>
                <SelectItem value="beats">四分音符</SelectItem>
                <SelectItem value="bars">小节</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-wrap items-center gap-1.5" aria-label="循环区域工具栏">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[10px]"
              aria-label="将选区设为循环区域"
              disabled={playbackState !== 'stopped' || !selection || selection.end <= selection.start}
              onClick={setLoopFromSelection}
            >
              <Repeat className="mr-1 size-3.5" />
              选区→循环
            </Button>
            {loopRegion && (
              <>
                <span className="font-mono text-[10px] text-[#aab0b6]" aria-label="循环区域时间">
                  {formatTime(loopRegion.start)}–{formatTime(loopRegion.end)} · {loopEnabled ? '开' : '关'}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-6"
                  aria-label="清除循环区域"
                  title="清除循环区域"
                  disabled={playbackState !== 'stopped'}
                  onClick={clearLoopRegion}
                >
                  <X className="size-3.5" />
                </Button>
              </>
            )}
          </div>
          <div className="flex max-w-full flex-wrap items-end gap-2 font-mono tabular-nums">
            <label className="flex flex-col gap-0.5 text-[9px] uppercase tracking-wide text-[#aab0b6]">
              选区开始
              <input
                aria-label="选区开始时间"
                readOnly
                className="au-time-field h-6 w-28 rounded-sm px-2 text-[11px] sm:w-32"
                value={formatAudacityTime(selection?.start ?? 0)}
              />
            </label>
            <label className="flex flex-col gap-0.5 text-[9px] uppercase tracking-wide text-[#aab0b6]">
              选区结束
              <input
                aria-label="选区结束时间"
                readOnly
                className="au-time-field h-6 w-28 rounded-sm px-2 text-[11px] sm:w-32"
                value={formatAudacityTime(selection?.end ?? 0)}
              />
            </label>
            <label className="flex flex-col gap-0.5 text-[9px] uppercase tracking-wide text-[#aab0b6]">
              时长
              <input
                aria-label="选区时长"
                readOnly
                className="au-time-field h-6 w-28 rounded-sm px-2 text-[11px] sm:w-32"
                value={formatAudacityTime(selection ? selection.end - selection.start : 0)}
              />
            </label>
            {selection && (
              <Button
                variant="ghost"
                size="icon"
                className="size-6"
                onClick={clearSelection}
                aria-label="清除选区时间"
                title="清除选区"
              >
                <X className="size-3.5" />
              </Button>
            )}
          </div>
        </div>

        {selection && spectralSelection && (
          <SpectralSelectionBar
            selection={spectralSelection}
            sampleRate={project.sampleRate}
            track={project.tracks.find((track) => track.id === selectedTrackId) ?? project.tracks[0]}
            onChange={(next) => handleSpectralSelectionChange(
              selection.start,
              selection.end,
              next.lowHz,
              next.highHz,
            )}
          />
        )}

        {/* Technical status bar */}
        <div className="flex h-6 shrink-0 items-center justify-between gap-3 overflow-x-auto border-t border-[#434a50] bg-[#252b31] px-3 text-[10px] text-[#aab0b6]">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <AudioWaveform className="size-3" />
              {project.tracks.length} 轨道
            </span>
            <span>{project.sampleRate} Hz</span>
            <span>32-bit float</span>
            <span className={isWasmAvailable() ? 'text-[#8bd5a7]' : 'text-warning'}>
              {isWasmAvailable() ? '● WASM 加速' : '○ JS 模式'}
            </span>
          </div>
          <div className="flex items-center gap-3">
            {timerRecordSession && (
              <>
                <span data-testid="timer-record-status" className="text-[#8bd5a7]">
                  {timerRecordSession.phase === 'waiting'
                    ? `定时等待 ${new Date(timerRecordSession.startAt).toLocaleTimeString()}`
                    : timerRecordSession.phase === 'recording'
                      ? `定时录音至 ${new Date(timerRecordSession.endAt).toLocaleTimeString()}`
                      : '正在保存或导出定时录音…'}
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  className="h-4 px-2 text-[10px]"
                  disabled={timerRecordSession.phase === 'finalizing'}
                  onClick={() => void cancelTimerRecord()}
                >
                  {timerRecordSession.phase === 'waiting'
                    ? '取消定时录音'
                    : timerRecordSession.phase === 'finalizing' ? '正在完成…' : '停止定时录音'}
                </Button>
              </>
            )}
            {micPermissionState === 'denied' && <span className="text-destructive">麦克风无权限</span>}
            {micPermissionState === 'granted' && recordingState !== 'recording' && <span>麦克风可用</span>}
            <span>光标 {formatTime(cursorPosition)}</span>
            <span>缩放 {Math.round(pxPerSec)} px/s</span>
          </div>
        </div>

        <Dialog open={workspaceManagerOpen} onOpenChange={setWorkspaceManagerOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>编辑 Workspaces</DialogTitle>
              <DialogDescription>选择要应用的布局，创建新的 Workspace，或删除不再需要的自定义项。</DialogDescription>
            </DialogHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button type="button" variant="secondary" onClick={openWorkspaceCreator}>
                <Plus className="mr-1 size-4" />
                新建 Workspace
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={managedWorkspace.builtIn}
                onClick={deleteManagedWorkspace}
              >
                <Trash2 className="mr-1 size-4" />
                删除所选 Workspace
              </Button>
            </div>
            <div className="max-h-80 overflow-y-auto rounded-md border" role="group" aria-label="Workspace 列表">
              {workspaceStore.presets.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  aria-label={`选择 ${preset.name}`}
                  aria-pressed={preset.id === managedWorkspace.id}
                  onClick={() => setWorkspaceManagerSelectionId(preset.id)}
                  className="flex w-full items-center gap-3 border-b px-3 py-2 text-left text-sm last:border-b-0 hover:bg-accent aria-pressed:bg-accent"
                >
                  <span className="min-w-0 flex-1 truncate">{preset.name}</span>
                  {preset.id === workspaceStore.activeId && (
                    <span className="text-xs text-muted-foreground">当前</span>
                  )}
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {preset.builtIn ? '内置' : '自定义'}
                  </span>
                </button>
              ))}
            </div>
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => setWorkspaceManagerOpen(false)}>取消</Button>
              <Button type="button" onClick={applyManagedWorkspace}>选择</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={workspaceDialogOpen} onOpenChange={setWorkspaceDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>保存 Workspace</DialogTitle>
              <DialogDescription>保存当前轨道面板、混音器、波形模式和缩放布局到当前浏览器。</DialogDescription>
            </DialogHeader>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                saveCurrentWorkspace();
              }}
              className="space-y-4"
            >
              <div className="space-y-2">
                <Label htmlFor="workspace-name">Workspace 名称</Label>
                <Input
                  id="workspace-name"
                  value={workspaceName}
                  onChange={(event) => setWorkspaceName(truncateWorkspaceNameInput(event.target.value))}
                  aria-describedby="workspace-name-length"
                  placeholder="例如：播客剪辑"
                  autoFocus
                />
                <p id="workspace-name-length" className="text-right text-xs text-muted-foreground" aria-live="polite">
                  {Array.from(workspaceName.trim()).length} / {MAX_WORKSPACE_NAME_LENGTH} 码点
                </p>
              </div>
              <DialogFooter>
                <Button type="button" variant="secondary" onClick={() => setWorkspaceDialogOpen(false)}>取消</Button>
                <Button type="submit" disabled={!workspaceName.trim()}>保存 Workspace</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        {deleteOnboarding && (
          <Dialog
            open
            onOpenChange={(open) => { if (!open) setDeleteOnboarding(null); }}
          >
            <DialogContent data-testid="delete-onboarding-dialog" className="max-w-3xl" showCloseButton={false}>
              <DialogHeader>
                <DialogTitle>Choose behavior when deleting a portion of a clip</DialogTitle>
                <DialogDescription>
                  首次使用普通 {deleteOnboarding.operation === 'cut' ? 'Cut' : 'Delete'} 前请选择行为；取消不会保存偏好或修改音频。
                </DialogDescription>
              </DialogHeader>
              <DeleteBehaviorPanel
                idPrefix="delete-onboarding"
                deleteBehavior={deleteOnboarding.deleteBehavior}
                closeGapBehavior={deleteOnboarding.closeGapBehavior}
                onDeleteBehaviorChange={(deleteBehavior) => setDeleteOnboarding((current) => (
                  current ? { ...current, deleteBehavior } : current
                ))}
                onCloseGapBehaviorChange={(closeGapBehavior) => setDeleteOnboarding((current) => (
                  current ? { ...current, closeGapBehavior } : current
                ))}
              />
              <DialogFooter>
                <Button
                  type="button"
                  variant="secondary"
                  data-testid="delete-onboarding-cancel"
                  onClick={() => setDeleteOnboarding(null)}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  data-testid="delete-onboarding-apply"
                  disabled={selectionEditOperation !== null}
                  onClick={() => void applyDeleteOnboarding()}
                >
                  Apply
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}

        <Dialog open={deleteFollowupOpen} onOpenChange={setDeleteFollowupOpen}>
          <DialogContent data-testid="delete-preference-followup" className="max-w-md" showCloseButton={false}>
            <DialogHeader>
              <DialogTitle>Delete preference</DialogTitle>
              <DialogDescription>Your delete behavior has been set</DialogDescription>
            </DialogHeader>
            <div className="space-y-3 text-sm text-muted-foreground">
              <p>You can change this at any time in Preferences.</p>
              <p>Cut/Delete and… 菜单仍可直接使用 leave gap、per clip、per track 和 all tracks 四种模式。</p>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                data-testid="delete-followup-preferences"
                onClick={() => {
                  setDeleteFollowupOpen(false);
                  navigate('/settings');
                }}
              >
                Preferences
              </Button>
              <Button type="button" data-testid="delete-followup-ok" onClick={() => setDeleteFollowupOpen(false)}>
                OK
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <ToneGeneratorDialog
          open={toneDialogOpen}
          onOpenChange={setToneDialogOpen}
          sampleRate={project.sampleRate}
          cursorPosition={cursorPosition}
          defaultDuration={generatorSelectionDuration ?? generatorDurations.tone}
          selectionActive={Boolean(quantizedGeneratorSelection)}
          replacementPosition={quantizedGeneratorSelection?.start}
          replacementEnd={quantizedGeneratorSelection?.end}
          isGenerating={isGeneratingTone}
          onGenerate={handleGenerateTone}
        />

        <ChirpGeneratorDialog
          open={chirpDialogOpen}
          onOpenChange={setChirpDialogOpen}
          sampleRate={project.sampleRate}
          cursorPosition={cursorPosition}
          defaultDuration={generatorSelectionDuration ?? generatorDurations.chirp}
          selectionActive={Boolean(quantizedGeneratorSelection)}
          replacementPosition={quantizedGeneratorSelection?.start}
          replacementEnd={quantizedGeneratorSelection?.end}
          isGenerating={isGeneratingChirp}
          onGenerate={handleGenerateChirp}
        />

        <DtmfGeneratorDialog
          open={dtmfDialogOpen}
          onOpenChange={setDtmfDialogOpen}
          sampleRate={project.sampleRate}
          cursorPosition={cursorPosition}
          defaultDuration={generatorSelectionDuration ?? generatorDurations.dtmf}
          selectionActive={Boolean(quantizedGeneratorSelection)}
          replacementPosition={quantizedGeneratorSelection?.start}
          replacementEnd={quantizedGeneratorSelection?.end}
          isGenerating={isGeneratingDtmf}
          onGenerate={handleGenerateDtmf}
        />

        <PluckGeneratorDialog
          open={pluckDialogOpen}
          onOpenChange={setPluckDialogOpen}
          sampleRate={project.sampleRate}
          cursorPosition={cursorPosition}
          defaultDuration={generatorDurations.pluck}
          selectionActive={Boolean(quantizedGeneratorSelection)}
          replacementPosition={quantizedGeneratorSelection?.start}
          replacementEnd={quantizedGeneratorSelection?.end}
          isGenerating={isGeneratingPluck}
          onGenerate={handleGeneratePluck}
        />

        <RhythmTrackDialog
          open={rhythmDialogOpen}
          onOpenChange={setRhythmDialogOpen}
          sampleRate={project.sampleRate}
          cursorPosition={cursorPosition}
          selectionActive={Boolean(quantizedGeneratorSelection)}
          replacementPosition={quantizedGeneratorSelection?.start}
          replacementEnd={quantizedGeneratorSelection?.end}
          isGenerating={isGeneratingRhythm}
          onGenerate={handleGenerateRhythm}
        />

        <RissetDrumDialog
          open={rissetDialogOpen}
          onOpenChange={setRissetDialogOpen}
          sampleRate={project.sampleRate}
          cursorPosition={cursorPosition}
          selectionActive={Boolean(quantizedGeneratorSelection)}
          replacementPosition={quantizedGeneratorSelection?.start}
          replacementEnd={quantizedGeneratorSelection?.end}
          isGenerating={isGeneratingRisset}
          onGenerate={handleGenerateRisset}
        />

        <NoiseGeneratorDialog
          open={noiseDialogOpen}
          onOpenChange={setNoiseDialogOpen}
          sampleRate={project.sampleRate}
          cursorPosition={cursorPosition}
          defaultDuration={generatorSelectionDuration ?? generatorDurations.noise}
          selectionActive={Boolean(quantizedGeneratorSelection)}
          replacementPosition={quantizedGeneratorSelection?.start}
          isGenerating={isGeneratingNoise}
          onGenerate={handleGenerateNoise}
        />

        <SilenceGeneratorDialog
          open={silenceDialogOpen}
          onOpenChange={setSilenceDialogOpen}
          sampleRate={project.sampleRate}
          cursorPosition={cursorPosition}
          defaultDuration={generatorSelectionDuration ?? generatorDurations.silence}
          selectionActive={Boolean(quantizedGeneratorSelection)}
          isGenerating={isGeneratingSilence}
          onGenerate={handleGenerateSilence}
        />

        <SampleDataImportDialog
          open={sampleDataImportDialogOpen}
          onOpenChange={handleSampleDataImportDialogChange}
          isImporting={isImportingSampleData}
          onImport={handleSampleDataImport}
        />

        <PlotSpectrumDialog
          open={plotSpectrumDialogOpen}
          onOpenChange={setPlotSpectrumDialogOpen}
          selectionStart={quantizedGeneratorSelection?.start ?? 0}
          selectionEnd={quantizedGeneratorSelection?.end ?? 0}
          sampleRate={project.sampleRate}
          onLoadAudio={loadPlotSpectrumAudio}
        />

        <ContrastAnalysisDialog
          open={contrastDialogOpen}
          onOpenChange={setContrastDialogOpen}
          projectName={project.name}
          onMeasure={measureContrastAudio}
        />

        <MeasureRmsDialog
          open={measureRmsDialogOpen}
          onOpenChange={handleMeasureRmsDialogChange}
          selectionStart={quantizedGeneratorSelection?.start ?? 0}
          selectionEnd={quantizedGeneratorSelection?.end ?? 0}
          results={measureRmsResults}
          isMeasuring={isMeasuringRms}
          error={measureRmsError}
        />

        <SampleDataExportDialog
          open={sampleDataExportDialogOpen}
          onOpenChange={handleSampleDataExportDialogChange}
          selectionStart={quantizedGeneratorSelection?.start ?? 0}
          selectionEnd={quantizedGeneratorSelection?.end ?? 0}
          isExporting={isExportingSampleData}
          onExport={handleSampleDataExport}
        />

        <FindClippingDialog
          open={findClippingDialogOpen}
          onOpenChange={setFindClippingDialogOpen}
          selectionStart={quantizedGeneratorSelection?.start ?? 0}
          selectionEnd={quantizedGeneratorSelection?.end ?? 0}
          sampleRate={project.sampleRate}
          isApplying={isFindingClipping}
          onApply={handleFindClipping}
        />

        <LabelSoundsDialog
          open={labelSoundsDialogOpen}
          onOpenChange={setLabelSoundsDialogOpen}
          selectionStart={quantizedGeneratorSelection?.start ?? 0}
          selectionEnd={quantizedGeneratorSelection?.end ?? 0}
          sampleRate={project.sampleRate}
          isApplying={isLabelingSounds}
          onApply={handleLabelSounds}
        />

        <BeatFinderDialog
          open={beatFinderDialogOpen}
          onOpenChange={setBeatFinderDialogOpen}
          selectionStart={quantizedGeneratorSelection?.start ?? 0}
          selectionEnd={quantizedGeneratorSelection?.end ?? 0}
          isApplying={isFindingBeats}
          onApply={handleBeatFinder}
        />

        <RegularIntervalLabelsDialog
          open={regularIntervalLabelsDialogOpen}
          onOpenChange={setRegularIntervalLabelsDialogOpen}
          selectionStart={quantizedGeneratorSelection?.start ?? 0}
          selectionEnd={quantizedGeneratorSelection?.end ?? 0}
          isApplying={isCreatingRegularIntervalLabels}
          onApply={handleRegularIntervalLabels}
        />

        <LabelEditorDialog
          open={labelEditorDialogOpen}
          onOpenChange={setLabelEditorDialogOpen}
          labels={project.analysisLabels ?? []}
          tracks={project.tracks}
          selectedTrackId={selectedTrackId}
          selection={selection}
          isApplying={isApplyingLabels}
          onApply={handleEditLabels}
          onImport={handleImportLabels}
          onExport={() => {
            setExportLabelsTrackId(null);
            setExportLabelsDialogOpen(true);
          }}
        />

        <ExportLabelsDialog
          open={exportLabelsDialogOpen}
          onOpenChange={setExportLabelsDialogOpen}
          tracks={getProjectLabelTracks(project)}
          initialTrackId={exportLabelsTrackId}
          onExport={handleExportLabels}
        />

        <RepeatSelectionDialog
          open={repeatDialogOpen}
          onOpenChange={setRepeatDialogOpen}
          selectionDuration={generatorSelectionDuration ?? 0}
          sampleRate={project.sampleRate}
          isRepeating={isRepeating}
          onRepeat={handleRepeatSelection}
        />

        <TimerRecordDialog
          open={timerRecordDialogOpen}
          projectName={project?.name ?? 'untitled'}
          onOpenChange={setTimerRecordDialogOpen}
          onSchedule={scheduleTimerRecord}
        />

        <ResampleDialog
          open={resampleDialogOpen}
          onOpenChange={setResampleDialogOpen}
          projectSampleRate={project.sampleRate}
          selectedTrackCount={mixAndRenderTrackIds.length}
          isResampling={isResampling}
          onResample={resampleSelectedTracks}
        />

        <TrackRateDialog
          open={trackRateTargets !== null}
          onOpenChange={(open) => { if (!open) setTrackRateTargets(null); }}
          initialRate={trackRateTargets?.initialRate ?? project.sampleRate}
          selectedTrackCount={trackRateTargets?.trackIds.length ?? 0}
          isChangingRate={isTrackChannelOperation}
          onChangeRate={changeTrackRate}
        />

        <ResampleDialog
          open={trackResampleTargets !== null}
          title="Resample track"
          onOpenChange={(open) => { if (!open) setTrackResampleTargets(null); }}
          projectSampleRate={(() => {
            const track = project.tracks.find((candidate) => candidate.id === trackResampleTargets?.[0]);
            const rate = track ? getTrackSampleRate(track) : project.sampleRate;
            return typeof rate === 'number' ? rate : project.sampleRate;
          })()}
          selectedTrackCount={trackResampleTargets?.length ?? 0}
          isResampling={isResampling}
          onResample={resampleTrackContext}
        />

        <EchoEffectDialog
          open={echoDialogOpen}
          onOpenChange={setEchoDialogOpen}
          sampleRate={project.sampleRate}
          selectionStart={quantizedGeneratorSelection?.start ?? 0}
          selectionEnd={quantizedGeneratorSelection?.end ?? 0}
          isApplying={isApplyingEcho}
          onPreview={handleEchoPreview}
          onApply={handleApplyEcho}
        />

        <DelayEffectDialog
          open={delayDialogOpen}
          onOpenChange={setDelayDialogOpen}
          sampleRate={project.sampleRate}
          selectionStart={quantizedGeneratorSelection?.start ?? 0}
          selectionEnd={quantizedGeneratorSelection?.end ?? 0}
          isApplying={isApplyingDelay}
          onPreview={handleDelayPreview}
          onApply={handleApplyDelay}
        />

        <ClipFixDialog
          open={clipFixDialogOpen}
          onOpenChange={setClipFixDialogOpen}
          sampleRate={project.sampleRate}
          selectionStart={quantizedGeneratorSelection?.start ?? 0}
          selectionEnd={quantizedGeneratorSelection?.end ?? 0}
          isApplying={isApplyingClipFix}
          onPreview={handleClipFixPreview}
          onApply={handleApplyClipFix}
        />

        <NotchFilterDialog
          open={notchFilterDialogOpen}
          onOpenChange={setNotchFilterDialogOpen}
          sampleRate={project.sampleRate}
          selectionStart={quantizedGeneratorSelection?.start ?? 0}
          selectionEnd={quantizedGeneratorSelection?.end ?? 0}
          isApplying={isApplyingNotchFilter}
          onPreview={handleNotchFilterPreview}
          onApply={handleApplyNotchFilter}
        />

        <ShelfFilterDialog
          open={shelfFilterDialogOpen}
          onOpenChange={setShelfFilterDialogOpen}
          sampleRate={project.sampleRate}
          selectionStart={quantizedGeneratorSelection?.start ?? 0}
          selectionEnd={quantizedGeneratorSelection?.end ?? 0}
          isApplying={isApplyingShelfFilter}
          onPreview={handleShelfFilterPreview}
          onApply={handleApplyShelfFilter}
        />

        <SpectralEditDialog
          kind={spectralEditKind}
          onOpenChange={(open) => { if (!open) setSpectralEditKind(null); }}
          sampleRate={project.sampleRate}
          frequencySelection={spectralSelection}
          selectionStart={quantizedGeneratorSelection?.start ?? 0}
          selectionEnd={quantizedGeneratorSelection?.end ?? 0}
          isApplying={isApplyingSpectralEdit}
          onPreview={handleSpectralEditPreview}
          onApply={handleApplySpectralEdit}
        />

        <AdjustableFadeDialog
          open={adjustableFadeDialogOpen}
          onOpenChange={setAdjustableFadeDialogOpen}
          sampleRate={project.sampleRate}
          selectionStart={quantizedGeneratorSelection?.start ?? 0}
          selectionEnd={quantizedGeneratorSelection?.end ?? 0}
          isApplying={isApplyingAdjustableFade}
          onPreview={handleAdjustableFadePreview}
          onApply={handleApplyAdjustableFade}
        />

        <CrossfadeTracksDialog
          open={crossfadeDialogOpen}
          onOpenChange={setCrossfadeDialogOpen}
          sampleRate={project.sampleRate}
          selectionStart={quantizedGeneratorSelection?.start ?? 0}
          selectionEnd={quantizedGeneratorSelection?.end ?? 0}
          isApplying={isApplyingCrossfade}
          onPreview={handleCrossfadePreview}
          onApply={handleCrossfade}
        />

        <BassTrebleDialog
          open={bassTrebleDialogOpen}
          onOpenChange={setBassTrebleDialogOpen}
          sampleRate={project.sampleRate}
          selectionStart={quantizedGeneratorSelection?.start ?? 0}
          selectionEnd={quantizedGeneratorSelection?.end ?? 0}
          hasSelection={Boolean(quantizedGeneratorSelection)}
          isApplying={isApplyingBassTreble}
          onPreview={handleBassTreblePreview}
          onApply={handleApplyBassTreble}
        />

        <ReverbDialog
          open={reverbDialogOpen}
          onOpenChange={setReverbDialogOpen}
          sampleRate={project.sampleRate}
          selectionStart={quantizedGeneratorSelection?.start ?? 0}
          selectionEnd={quantizedGeneratorSelection?.end ?? 0}
          hasSelection={Boolean(quantizedGeneratorSelection)}
          isApplying={isApplyingReverb}
          onPreview={handleReverbPreview}
          onApply={handleApplyReverb}
        />

        <DistortionDialog
          open={distortionDialogOpen}
          onOpenChange={setDistortionDialogOpen}
          sampleRate={project.sampleRate}
          selectionStart={quantizedGeneratorSelection?.start ?? 0}
          selectionEnd={quantizedGeneratorSelection?.end ?? 0}
          hasSelection={Boolean(quantizedGeneratorSelection)}
          isApplying={isApplyingDistortion}
          onPreview={handleDistortionPreview}
          onApply={handleApplyDistortion}
        />

        <ClickRemovalDialog
          open={clickRemovalDialogOpen}
          onOpenChange={setClickRemovalDialogOpen}
          sampleRate={project.sampleRate}
          selectionStart={quantizedGeneratorSelection?.start ?? 0}
          selectionEnd={quantizedGeneratorSelection?.end ?? 0}
          hasSelection={Boolean(quantizedGeneratorSelection)}
          isApplying={isApplyingClickRemoval}
          onPreview={handleClickRemovalPreview}
          onApply={handleApplyClickRemoval}
        />

        <NoiseReductionDialog
          open={noiseReductionDialogOpen}
          onOpenChange={setNoiseReductionDialogOpen}
          sampleRate={project.sampleRate}
          selectionStart={quantizedGeneratorSelection?.start ?? 0}
          selectionEnd={quantizedGeneratorSelection?.end ?? 0}
          hasSelection={Boolean(quantizedGeneratorSelection)}
          isApplying={isApplyingNoiseReduction}
          profile={noiseReductionProfile}
          onGetProfile={handleGetNoiseReductionProfile}
          onClearProfile={() => setNoiseReductionProfile(null)}
          onPreview={handleNoiseReductionPreview}
          onApply={handleApplyNoiseReduction}
        />

        <TruncateSilenceDialog
          open={truncateSilenceDialogOpen}
          onOpenChange={setTruncateSilenceDialogOpen}
          sampleRate={project.sampleRate}
          selectionStart={quantizedGeneratorSelection?.start ?? 0}
          selectionEnd={quantizedGeneratorSelection?.end ?? 0}
          hasSelection={Boolean(quantizedGeneratorSelection)}
          isApplying={isApplyingTruncateSilence}
          onPreview={handleTruncateSilencePreview}
          onApply={handleApplyTruncateSilence}
        />

        <CompressorDialog
          open={compressorDialogOpen}
          onOpenChange={setCompressorDialogOpen}
          sampleRate={project.sampleRate}
          selectionStart={quantizedGeneratorSelection?.start ?? 0}
          selectionEnd={quantizedGeneratorSelection?.end ?? 0}
          hasSelection={Boolean(quantizedGeneratorSelection)}
          isApplying={isApplyingCompressor}
          onPreview={handleCompressorPreview}
          onApply={handleApplyCompressor}
        />

        <LimiterDialog
          open={limiterDialogOpen}
          onOpenChange={setLimiterDialogOpen}
          sampleRate={project.sampleRate}
          selectionStart={quantizedGeneratorSelection?.start ?? 0}
          selectionEnd={quantizedGeneratorSelection?.end ?? 0}
          hasSelection={Boolean(quantizedGeneratorSelection)}
          isApplying={isApplyingLimiter}
          onPreview={handleLimiterPreview}
          onApply={handleApplyLimiter}
        />

        <LegacyLimiterDialog
          open={legacyLimiterDialogOpen}
          onOpenChange={setLegacyLimiterDialogOpen}
          sampleRate={project.sampleRate}
          selectionStart={quantizedGeneratorSelection?.start ?? 0}
          selectionEnd={quantizedGeneratorSelection?.end ?? 0}
          hasSelection={Boolean(quantizedGeneratorSelection)}
          isApplying={isApplyingLegacyLimiter}
          onPreview={handleLegacyLimiterPreview}
          onApply={handleApplyLegacyLimiter}
        />

        <AmplifyDialog
          open={amplifyDialogOpen}
          onOpenChange={setAmplifyDialogOpen}
          selectionStart={quantizedGeneratorSelection?.start ?? 0}
          selectionEnd={quantizedGeneratorSelection?.end ?? 0}
          sampleRate={project.sampleRate}
          hasSelection={Boolean(quantizedGeneratorSelection)}
          isApplying={isApplyingAmplify}
          onAnalyze={handleAnalyzeAmplify}
          onPreview={handleAmplifyPreview}
          onApply={handleApplyAmplify}
        />

        <NormalizeDialog
          open={normalizeDialogOpen}
          onOpenChange={setNormalizeDialogOpen}
          selectionStart={quantizedGeneratorSelection?.start ?? 0}
          selectionEnd={quantizedGeneratorSelection?.end ?? 0}
          sampleRate={project.sampleRate}
          hasSelection={Boolean(quantizedGeneratorSelection)}
          isApplying={isApplyingNormalize}
          onPreview={handleNormalizePreview}
          onApply={handleApplyNormalize}
        />

        <LoudnessDialog
          open={loudnessDialogOpen}
          onOpenChange={setLoudnessDialogOpen}
          selectionStart={quantizedGeneratorSelection?.start ?? 0}
          selectionEnd={quantizedGeneratorSelection?.end ?? 0}
          sampleRate={project.sampleRate}
          hasSelection={Boolean(quantizedGeneratorSelection)}
          isApplying={isApplyingLoudness}
          onPreview={handleLoudnessPreview}
          onApply={handleApplyLoudness}
        />

        <FilterCurveEqDialog
          open={filterCurveEqDialogOpen}
          onOpenChange={setFilterCurveEqDialogOpen}
          selectionStart={quantizedGeneratorSelection?.start ?? 0}
          selectionEnd={quantizedGeneratorSelection?.end ?? 0}
          sampleRate={project.sampleRate}
          hasSelection={Boolean(quantizedGeneratorSelection)}
          isApplying={isApplyingFilterCurveEq}
          onPreview={handleFilterCurveEqPreview}
          onApply={handleApplyFilterCurveEq}
        />

        <GraphicEqDialog
          open={graphicEqDialogOpen}
          onOpenChange={setGraphicEqDialogOpen}
          selectionStart={quantizedGeneratorSelection?.start ?? 0}
          selectionEnd={quantizedGeneratorSelection?.end ?? 0}
          sampleRate={project.sampleRate}
          hasSelection={Boolean(quantizedGeneratorSelection)}
          isApplying={isApplyingGraphicEq}
          onPreview={handleGraphicEqPreview}
          onApply={handleApplyGraphicEq}
        />

        <ChangeSpeedDialog
          open={changeSpeedDialogOpen}
          onOpenChange={setChangeSpeedDialogOpen}
          selectionDuration={quantizedGeneratorSelection
            ? quantizedGeneratorSelection.end - quantizedGeneratorSelection.start
            : 0}
          sampleRate={project.sampleRate}
          hasSelection={Boolean(quantizedGeneratorSelection)}
          applying={isApplyingChangeSpeed}
          onPreview={handleChangeSpeedPreview}
          onApply={handleApplyChangeSpeed}
        />

        {spectrogramSettingsTrackId && (() => {
          const track = project.tracks.find((candidate) => candidate.id === spectrogramSettingsTrackId);
          if (!track) return null;
          return (
            <TrackSpectrogramSettingsDialog
              open
              onOpenChange={(open) => { if (!open) setSpectrogramSettingsTrackId(null); }}
              track={track}
              sampleRate={project.sampleRate}
              onApply={(settings, useGlobalSettings) => handleTrackSpectrogramSettings(track.id, settings, useGlobalSettings)}
            />
          );
        })()}

        {clipPropertiesKey && (() => {
          const track = project.tracks.find((candidate) => candidate.id === clipPropertiesKey.trackId);
          const clip = track?.clips.find((candidate) => candidate.id === clipPropertiesKey.clipId);
          // Removing the selected clip closes the properties dialog as well.
          if (!track || !clip) return null;
          return (
            <ClipPropertiesDialog
              open
              onOpenChange={(open) => { if (!open) setClipPropertiesKey(null); }}
              clip={clip}
              track={track}
            />
          );
        })()}

        {pitchAndSpeedClipKey && (() => {
          const track = project.tracks.find((candidate) => candidate.id === pitchAndSpeedClipKey.trackId);
          const clip = track?.clips.find((candidate) => candidate.id === pitchAndSpeedClipKey.clipId);
          // Removing the selected clip closes the official dialog as well.
          if (!clip) return null;
          return (
            <ClipPitchAndSpeedDialog
              open
              onOpenChange={(open) => { if (!open) setPitchAndSpeedClipKey(null); }}
              clip={clip}
              isPlaying={playbackState === 'playing'}
              onApply={handleClipPitchAndSpeed}
            />
          );
        })()}

        <ChangePitchDialog
          open={changePitchDialogOpen}
          onOpenChange={setChangePitchDialogOpen}
          sampleRate={project.sampleRate}
          hasSelection={Boolean(quantizedGeneratorSelection)}
          applying={isApplyingChangePitch}
          onPreview={handleChangePitchPreview}
          onApply={handleApplyChangePitch}
        />

        <ChangeTempoDialog
          open={changeTempoDialogOpen}
          onOpenChange={setChangeTempoDialogOpen}
          selectionStart={quantizedGeneratorSelection?.start ?? 0}
          selectionEnd={quantizedGeneratorSelection?.end ?? 0}
          sampleRate={project.sampleRate}
          initialBpm={project.tempo}
          hasSelection={Boolean(quantizedGeneratorSelection)}
          isApplying={isApplyingChangeTempo}
          onPreview={handleChangeTempoPreview}
          onApply={handleApplyChangeTempo}
        />

        <SlidingStretchDialog
          open={slidingStretchDialogOpen}
          onOpenChange={setSlidingStretchDialogOpen}
          selectionDuration={quantizedGeneratorSelection
            ? quantizedGeneratorSelection.end - quantizedGeneratorSelection.start
            : 0}
          sampleRate={project.sampleRate}
          hasSelection={Boolean(quantizedGeneratorSelection)}
          isApplying={isApplyingSlidingStretch}
          onPreview={handleSlidingStretchPreview}
          onApply={handleApplySlidingStretch}
        />

        <PaulstretchDialog
          open={paulstretchDialogOpen}
          onOpenChange={setPaulstretchDialogOpen}
          selectionDuration={quantizedGeneratorSelection
            ? quantizedGeneratorSelection.end - quantizedGeneratorSelection.start
            : 0}
          sampleRate={project.sampleRate}
          hasSelection={Boolean(quantizedGeneratorSelection)}
          applying={isApplyingPaulstretch}
          onPreview={handlePaulstretchPreview}
          onApply={handleApplyPaulstretch}
        />

        <WahWahEffectDialog
          open={wahWahDialogOpen}
          onOpenChange={setWahWahDialogOpen}
          sampleRate={project.sampleRate}
          selectionStart={quantizedGeneratorSelection?.start ?? 0}
          selectionEnd={quantizedGeneratorSelection?.end ?? 0}
          isApplying={isApplyingWahWah}
          onPreview={handleWahWahPreview}
          onApply={handleApplyWahWah}
        />

        <PhaserEffectDialog
          open={phaserDialogOpen}
          onOpenChange={setPhaserDialogOpen}
          sampleRate={project.sampleRate}
          selectionStart={quantizedGeneratorSelection?.start ?? 0}
          selectionEnd={quantizedGeneratorSelection?.end ?? 0}
          isApplying={isApplyingPhaser}
          onPreview={handlePhaserPreview}
          onApply={handleApplyPhaser}
        />

        <PassFilterDialog
          key={passFilterKind ?? 'closed'}
          kind={passFilterKind ?? 'lowpass'}
          open={passFilterKind !== null}
          onOpenChange={(open) => { if (!open) setPassFilterKind(null); }}
          sampleRate={project.sampleRate}
          selectionStart={quantizedGeneratorSelection?.start ?? 0}
          selectionEnd={quantizedGeneratorSelection?.end ?? 0}
          isApplying={isApplyingPassFilter}
          onPreview={handlePassFilterPreview}
          onApply={handleApplyPassFilter}
        />

        <ClassicFilterEffectDialog
          open={classicFilterDialogOpen}
          onOpenChange={setClassicFilterDialogOpen}
          sampleRate={project.sampleRate}
          selectionStart={quantizedGeneratorSelection?.start ?? 0}
          selectionEnd={quantizedGeneratorSelection?.end ?? 0}
          isApplying={isApplyingClassicFilter}
          onPreview={handleClassicFilterPreview}
          onApply={handleApplyClassicFilter}
        />

        <TremoloEffectDialog
          open={tremoloDialogOpen}
          onOpenChange={setTremoloDialogOpen}
          sampleRate={project.sampleRate}
          selectionStart={quantizedGeneratorSelection?.start ?? 0}
          selectionEnd={quantizedGeneratorSelection?.end ?? 0}
          isApplying={isApplyingTremolo}
          onPreview={handleTremoloPreview}
          onApply={handleApplyTremolo}
        />

        <VocoderDialog
          open={vocoderDialogOpen}
          onOpenChange={setVocoderDialogOpen}
          sampleRate={project.sampleRate}
          selectionStart={quantizedGeneratorSelection?.start ?? 0}
          selectionEnd={quantizedGeneratorSelection?.end ?? 0}
          isApplying={isApplyingVocoder}
          onPreview={handleVocoderPreview}
          onApply={handleApplyVocoder}
        />

        <AutoDuckEffectDialog
          open={autoDuckDialogOpen}
          onOpenChange={setAutoDuckDialogOpen}
          tracks={autoDuckTrackOptions}
          sampleRate={project.sampleRate}
          selectionStart={quantizedGeneratorSelection?.start ?? 0}
          selectionEnd={quantizedGeneratorSelection?.end ?? 0}
          isApplying={isApplyingAutoDuck}
          onPreview={handleAutoDuckPreview}
          onApply={handleApplyAutoDuck}
        />

        <SelectionContextMenu
          open={Boolean(selectionContextMenu && selection)}
          x={selectionContextMenu?.x ?? 0}
          y={selectionContextMenu?.y ?? 0}
          hasClipboard={hasAudioClipboard}
          disabled={recordingState === 'recording' || Boolean(selectionEditOperation) || Boolean(selectionUtilityOperation)}
          onOpenChange={(open) => { if (!open) setSelectionContextMenu(null); }}
          onCut={() => void handleCut()}
          onCopy={() => void handleCopy()}
          onPaste={(mode) => void handlePaste(mode)}
          onDuplicate={() => void handleDuplicateSelection()}
          onDelete={() => void handleDeleteSelection()}
          onEdit={(operation, mode) => void handleSelectionEdit(operation, mode)}
          onSplit={() => void splitRangeAtBoundaries()}
          onDisjoin={() => void splitRangeAtSilences()}
          onJoin={() => void joinRangeClips()}
        />

        <AlertDialog
        open={makeStereoConfirmation !== null}
        onOpenChange={(open) => {
          if (!open && !isTrackChannelOperation) setMakeStereoConfirmation(null);
        }}
      >
        <AlertDialogContent data-testid="make-stereo-confirmation">
          <AlertDialogHeader>
            <AlertDialogTitle>Combine mono tracks to stereo</AlertDialogTitle>
            <AlertDialogDescription className="whitespace-pre-line">
              {'When combining mono tracks to stereo, the tracks are mixed and rendered into a single track.'}
              {'\n\n'}
              {'This causes any realtime effects applied to the tracks to be applied. Any hidden data is removed and the result is one large clip.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="make-stereo-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction
              data-testid="make-stereo-confirm"
              onClick={() => {
                if (makeStereoConfirmation) {
                  void performMakeStereoTrack(
                    makeStereoConfirmation.leftTrackId,
                    makeStereoConfirmation.rightTrackId,
                  );
                }
              }}
            >
              Yes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Export Dialog */}
        <Dialog open={exportDialogOpen} onOpenChange={setExportDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>导出音频</DialogTitle>
              <DialogDescription>
                将当前工程混音并导出为音频文件
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label>导出格式</Label>
                <Select value={exportFormat} onValueChange={setExportFormat}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="wav">WAV (PCM 16-bit, 立体声)</SelectItem>
                    <SelectItem value="wav32">WAV (Float 32-bit, 立体声)</SelectItem>
                    <SelectItem value="mp3">MP3 (128 kbps, 立体声)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
                <p>
                  采样率：<span className="text-foreground">
                    {exportFormat === 'mp3' ? getMp3SampleRate(project.sampleRate) : project.sampleRate} Hz
                  </span>
                </p>
                <p>
                  声道：<span className="text-foreground">立体声 (Stereo)</span>
                </p>
                <p>
                  时长：<span className="text-foreground">{formatTime(getProjectDuration())}</span>
                </p>
              </div>
            </div>

            <DialogFooter>
              <Button variant="secondary" onClick={() => setExportDialogOpen(false)}>
                取消
              </Button>
              <Button onClick={handleExport} disabled={isExporting}>
                {isExporting ? '导出中...' : '导出'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}

// Track Panel Row Component
function TrackPanelRow({
  track,
  isSelected,
  isMoving,
  isDuplicating,
  isChannelOperation,
  channelCount,
  sampleRate,
  isRecording,
  isResampling,
  canMakeStereo,
  canMoveUp,
  canMoveDown,
  contextMenuOpen,
  onContextMenuOpenChange,
  onSelect,
  onMute,
  onSolo,
  onArm,
  onGainChange,
  onPanChange,
  onRename,
  onDelete,
  onDuplicate,
  onSwapStereoChannels,
  onSplitStereo,
  onMakeStereo,
  onFormatChange,
  onRateChange,
  onOpenRateDialog,
  onResample,
  viewMode,
  halfWave,
  onViewModeChange,
  onHalfWaveChange,
  onOpenSpectrogramSettings,
  onColorChange,
  showVerticalRulers,
  onShowVerticalRulersChange,
  showMicMetering,
  inputMonitoring,
  onShowMicMeteringChange,
  onInputMonitoringChange,
  onMove,
  onOpenEffects,
}: {
  track: ITrack;
  isSelected: boolean;
  isMoving: boolean;
  isDuplicating: boolean;
  isChannelOperation: boolean;
  channelCount: 0 | 1 | 2;
  sampleRate: number | 'mixed';
  isRecording: boolean;
  isResampling: boolean;
  canMakeStereo: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  contextMenuOpen: boolean;
  onContextMenuOpenChange: (open: boolean) => void;
  onSelect: () => void;
  onMute: () => void;
  onSolo: () => void;
  onArm: () => void;
  onGainChange: (db: number) => void;
  onPanChange: (pan: number) => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onSwapStereoChannels: () => void;
  onSplitStereo: (mode: 'lr' | 'center') => void;
  onMakeStereo: () => void;
  onFormatChange: (format: TrackSampleFormat) => void;
  onRateChange: (rate: number) => void;
  onOpenRateDialog: () => void;
  onResample: () => void;
  viewMode: ViewMode;
  halfWave: boolean;
  onViewModeChange: (mode: TrackVisualizationMode) => void;
  onHalfWaveChange: (value: boolean) => void;
  onOpenSpectrogramSettings: () => void;
  onColorChange: (colorIndex: number) => void;
  showVerticalRulers: boolean;
  onShowVerticalRulersChange: (visible: boolean) => void;
  showMicMetering: boolean;
  inputMonitoring: boolean;
  onShowMicMeteringChange: (enabled: boolean) => void;
  onInputMonitoringChange: (enabled: boolean) => void;
  onMove: (direction: TrackMoveDirection) => void;
  onOpenEffects: () => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(track.name);

  function handleRenameSubmit() {
    if (editName.trim()) {
      onRename(editName.trim());
    }
    setIsEditing(false);
  }

  return (
    <ContextMenu open={contextMenuOpen} onOpenChange={onContextMenuOpenChange}>
      <ContextMenuTrigger asChild>
        <div
          data-testid={`track-panel-row-${track.id}`}
          className={`au-panel relative flex h-[100px] flex-col border-b p-1.5 transition-colors ${
            isSelected ? 'shadow-[inset_0_0_0_1px_#84b5ff]' : 'hover:bg-[#373e45]'
          }`}
          onClick={onSelect}
        >
      <div className="mb-1 flex h-[18px] items-center gap-1">
        <GripVertical className="size-3 shrink-0 text-[#aab0b6]" />
        {isEditing ? (
          <Input
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onBlur={handleRenameSubmit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleRenameSubmit();
              if (e.key === 'Escape') {
                setEditName(track.name);
                setIsEditing(false);
              }
            }}
            className="h-5 text-xs"
            aria-label="轨道名称"
            autoFocus
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span
            className="flex-1 truncate text-xs font-medium text-[#e4e5e7]"
            title="双击重命名轨道"
            onDoubleClick={(e) => {
              e.stopPropagation();
              setIsEditing(true);
            }}
          >
            {track.name}
          </span>
        )}
        <div
          data-testid={`track-color-swatch-${track.id}`}
          data-track-color={track.color}
          className="size-2 shrink-0 rounded-sm"
          style={{ backgroundColor: track.color }}
          aria-label="轨道颜色"
        />
        <Button
          variant="ghost"
          size="icon"
          className="size-5 text-[#aab0b6] hover:text-destructive"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          aria-label={`删除轨道 ${track.name}`}
          title="删除轨道"
        >
          <Trash2 className="size-3" />
        </Button>
      </div>

      <div className="mb-1 flex h-8 items-center gap-1.5">
        <GainKnob value={track.gain} onChange={onGainChange} />
        <div className="min-w-0 flex-1">
          <Slider
            value={[track.pan]}
            min={-1}
            max={1}
            step={0.01}
            onValueChange={(v) => onPanChange(v[0])}
            className="h-1"
            aria-label="声像"
          />
          <div className="mt-1 flex justify-between text-[9px] text-[#aab0b6]">
            <span>声像</span>
            <span className="tabular-nums">
              {track.pan === 0 ? 'C' : track.pan < 0 ? `L${Math.abs(track.pan).toFixed(1)}` : `R${track.pan.toFixed(1)}`}
            </span>
          </div>
        </div>
        <div className="flex gap-0.5">
          <Button
            variant={track.muted ? 'destructive' : 'secondary'}
            size="icon"
            className={track.muted ? 'size-6 min-h-6 p-0 text-[10px]' : 'au-secondary size-6 min-h-6 p-0 text-[10px]'}
            onClick={(e) => {
              e.stopPropagation();
              onMute();
            }}
            aria-label={`静音 ${track.name}`}
            aria-pressed={track.muted}
            title="静音 (Mute)"
          >
            M
          </Button>
          <Button
            variant={track.solo ? 'default' : 'secondary'}
            size="icon"
            className={track.solo ? 'size-6 min-h-6 p-0 text-[10px]' : 'au-secondary size-6 min-h-6 p-0 text-[10px]'}
            onClick={(e) => {
              e.stopPropagation();
              onSolo();
            }}
            aria-label={`独奏 ${track.name}`}
            aria-pressed={track.solo}
            title="独奏 (Solo)"
          >
            S
          </Button>
          <Button
            variant={track.armed ? 'destructive' : 'secondary'}
            size="icon"
            className="au-secondary size-6 min-h-6 p-0 text-[10px]"
            onClick={(e) => {
              e.stopPropagation();
              onArm();
            }}
            aria-label={`录音准备 ${track.name}`}
            aria-pressed={track.armed}
            title="录音准备"
          >
            R
          </Button>
        </div>
      </div>

      <Button
        variant="secondary"
        size="sm"
        className="au-secondary mt-auto h-5 min-h-5 w-full rounded-sm px-2 text-[10px]"
        onClick={(e) => {
          e.stopPropagation();
          onOpenEffects();
        }}
        aria-label={`打开 ${track.name} 效果器`}
        title={`${track.clips.length} 个片段 · ${track.effects.length} 个效果`}
      >
        <Settings className="size-3" />
        Effects
        {track.effects.length > 0 && (
          <span className="ml-auto rounded-sm bg-[#252b31]/70 px-1 text-[9px]">{track.effects.length}</span>
        )}
      </Button>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-56" data-testid={`track-context-menu-${track.id}`}>
        <ContextMenuItem
          data-testid="track-rename-menu"
          onSelect={() => { window.setTimeout(() => setIsEditing(true), 0); }}
        >
          Rename track
        </ContextMenuItem>
        <ContextMenuItem
          data-testid="track-duplicate-menu"
          disabled={isDuplicating}
          onSelect={onDuplicate}
        >
          Duplicate track
        </ContextMenuItem>
        <ContextMenuItem data-testid="track-delete-menu" onSelect={onDelete}>
          Delete track
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuSub>
          <ContextMenuSubTrigger data-testid="track-move-submenu">Move track</ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-48">
            <ContextMenuItem
              data-testid="track-move-up-menu"
              disabled={isMoving || !canMoveUp}
              onClick={() => onMove('up')}
            >
              Move up
            </ContextMenuItem>
            <ContextMenuItem
              data-testid="track-move-down-menu"
              disabled={isMoving || !canMoveDown}
              onClick={() => onMove('down')}
            >
              Move down
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem
              data-testid="track-move-top-menu"
              disabled={isMoving || !canMoveUp}
              onClick={() => onMove('top')}
            >
              Move to top
            </ContextMenuItem>
            <ContextMenuItem
              data-testid="track-move-bottom-menu"
              disabled={isMoving || !canMoveDown}
              onClick={() => onMove('bottom')}
            >
              Move to bottom
            </ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSub>
          <ContextMenuSubTrigger data-testid="track-visualization-submenu">Track visualization</ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-48">
            <ContextMenuRadioGroup
              value={getTrackVisualizationMode(viewMode)}
              onValueChange={(value) => onViewModeChange(value as TrackVisualizationMode)}
            >
              <ContextMenuRadioItem value="waveform" data-testid="track-view-waveform">
                Waveform
              </ContextMenuRadioItem>
              <ContextMenuRadioItem value="spectrum" data-testid="track-view-spectrogram">
                Spectrogram
              </ContextMenuRadioItem>
              <ContextMenuRadioItem value="both" data-testid="track-view-multi">
                Multi-view
              </ContextMenuRadioItem>
            </ContextMenuRadioGroup>
            <ContextMenuCheckboxItem
              checked={halfWave}
              onCheckedChange={(checked) => onHalfWaveChange(checked === true)}
              data-testid="track-view-half-wave"
            >
              Half-wave
            </ContextMenuCheckboxItem>
            <ContextMenuSeparator />
            <ContextMenuItem
              data-testid="track-spectrogram-settings-menu"
              onSelect={onOpenSpectrogramSettings}
            >
              Spectrogram settings
            </ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSub>
          <ContextMenuSubTrigger data-testid="track-color-submenu">Track color</ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-48">
            <ContextMenuRadioGroup
              value={String(getTrackColorIndex(track))}
              onValueChange={(value) => onColorChange(Number(value))}
            >
              {CLIP_COLORS.map((entry) => (
                <ContextMenuRadioItem
                  key={entry.index}
                  value={String(entry.index)}
                  data-testid={`track-color-${entry.index}`}
                >
                  <span
                    aria-hidden="true"
                    className="size-3 rounded-sm border border-black/10"
                    style={{ backgroundColor: entry.color }}
                  />
                  {entry.name}
                </ContextMenuRadioItem>
              ))}
            </ContextMenuRadioGroup>
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuCheckboxItem
          data-testid="track-toggle-vertical-rulers"
          checked={showVerticalRulers}
          onCheckedChange={(checked) => onShowVerticalRulersChange(checked === true)}
        >
          Show vertical rulers
        </ContextMenuCheckboxItem>
        <ContextMenuSub>
          <ContextMenuSubTrigger data-testid="track-meters-monitoring-submenu">
            Meters &amp; monitoring
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-56">
            <ContextMenuCheckboxItem
              data-testid="track-show-mic-metering"
              checked={showMicMetering}
              onCheckedChange={(checked) => onShowMicMeteringChange(checked === true)}
            >
              Show mic metering
            </ContextMenuCheckboxItem>
            <ContextMenuSeparator />
            <ContextMenuCheckboxItem
              data-testid="track-input-monitoring"
              checked={inputMonitoring}
              onCheckedChange={(checked) => onInputMonitoringChange(checked === true)}
            >
              Turn on input monitoring
            </ContextMenuCheckboxItem>
          </ContextMenuSubContent>
        </ContextMenuSub>
        {channelCount === 2 && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem
              data-testid="track-swap-stereo-channels"
              disabled={isChannelOperation}
              onSelect={() => onSwapStereoChannels()}
            >
              Swap stereo channels
            </ContextMenuItem>
            <ContextMenuItem
              data-testid="track-split-stereo-lr"
              disabled={isChannelOperation}
              onSelect={() => onSplitStereo('lr')}
            >
              Split stereo to L/R mono
            </ContextMenuItem>
            <ContextMenuItem
              data-testid="track-split-stereo-center"
              disabled={isChannelOperation}
              onSelect={() => onSplitStereo('center')}
            >
              Split stereo to center mono
            </ContextMenuItem>
          </>
        )}
        {channelCount === 1 && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem
              data-testid="track-make-stereo"
              disabled={!canMakeStereo || isChannelOperation}
              onSelect={() => onMakeStereo()}
            >
              Make stereo track
            </ContextMenuItem>
          </>
        )}
        <ContextMenuSeparator />
        <ContextMenuSub>
          <ContextMenuSubTrigger
            data-testid="track-format-submenu"
            disabled={isRecording || isChannelOperation || isResampling}
          >
            Format: {getTrackSampleFormatLabel(track.sampleFormat)}
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-48">
            <ContextMenuRadioGroup
              value={track.sampleFormat ?? 'float32'}
              onValueChange={(value) => onFormatChange(value as TrackSampleFormat)}
            >
              {TRACK_SAMPLE_FORMATS.map((format) => (
                <ContextMenuRadioItem
                  key={format.value}
                  value={format.value}
                  data-testid={`track-format-${format.value}`}
                  disabled={isRecording || isChannelOperation || isResampling}
                >
                  {format.label}
                </ContextMenuRadioItem>
              ))}
            </ContextMenuRadioGroup>
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSub>
          <ContextMenuSubTrigger
            data-testid="track-rate-submenu"
            disabled={isRecording || isChannelOperation || isResampling}
          >
            Rate: {typeof sampleRate === 'number' ? `${sampleRate} Hz` : 'Mixed'}
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-48">
            <ContextMenuRadioGroup
              value={typeof sampleRate === 'number' && RESAMPLE_RATE_CHOICES.includes(sampleRate)
                ? String(sampleRate)
                : 'custom'}
              onValueChange={(value) => {
                if (value === 'custom') onOpenRateDialog();
                else onRateChange(Number(value));
              }}
            >
              {RESAMPLE_RATE_CHOICES.map((rate) => (
                <ContextMenuRadioItem
                  key={rate}
                  value={String(rate)}
                  data-testid={`track-rate-${rate}`}
                  disabled={isRecording || isChannelOperation || isResampling}
                >
                  {rate} Hz
                </ContextMenuRadioItem>
              ))}
              <ContextMenuSeparator />
              <ContextMenuRadioItem
                value="custom"
                data-testid="track-rate-custom"
                disabled={isRecording || isChannelOperation || isResampling}
              >
                Other…
              </ContextMenuRadioItem>
            </ContextMenuRadioGroup>
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuItem
          data-testid="track-resample"
          disabled={isChannelOperation || isResampling}
          onSelect={onResample}
        >
          Resample track…
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function LevelMeter({ mode, active }: { mode: 'recording' | 'playback'; active: boolean }) {
  const [minDb] = useState(getMeterDbRange);
  const [levels, setLevels] = useState<StereoLevels>(() => silentStereoLevels(minDb));
  const label = mode === 'recording' ? '录音' : '播放';

  useEffect(() => {
    if (!active) {
      setLevels(silentStereoLevels(minDb));
      return;
    }

    let frame = 0;
    let previousTime: number | null = null;
    let current = silentStereoLevels(minDb);
    const tick = (now: number) => {
      const elapsed = previousTime === null ? 1 / 60 : Math.min(0.1, Math.max(0, (now - previousTime) / 1000));
      previousTime = now;
      const instantaneous = mode === 'recording'
        ? audioEngine.getRecordingLevels()
        : audioEngine.getPlaybackLevels();
      current = {
        left: decayDbfs(current.left, instantaneous.left, elapsed, minDb),
        right: decayDbfs(current.right, instantaneous.right, elapsed, minDb),
      };
      setLevels(current);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [active, minDb, mode]);

  return (
    <div className="flex shrink-0 items-center gap-2" aria-label={`${label}电平表`} title={`${label}峰值电平 · dBFS`}>
      {mode === 'recording' ? <Mic className="size-3.5 text-red-400" /> : <Volume2 className="size-3.5 text-emerald-400" />}
      <span className="w-7 text-[10px] text-[#c1c7cc]">{label}</span>
      <div className="space-y-1">
        {(['left', 'right'] as const).map((channel, index) => {
          const value = levels[channel];
          const channelLabel = index === 0 ? '左' : '右';
          return (
            <div key={channel} className="flex items-center gap-1 text-[8px] leading-none text-[#9ca4ab]">
              <span className="w-2">{index === 0 ? 'L' : 'R'}</span>
              <div
                role="meter"
                aria-label={`${label}${channelLabel}声道峰值电平`}
                aria-valuemin={minDb}
                aria-valuemax={0}
                aria-valuenow={Number(value.toFixed(1))}
                aria-valuetext={`${formatDbfs(value, minDb)} dBFS`}
                className={`h-1.5 w-24 overflow-hidden rounded-[1px] bg-[#161b20] ${value >= -0.05 ? 'ring-1 ring-red-400' : ''}`}
              >
                <div
                  data-testid={`${mode}-${channel}-meter-fill`}
                  className="h-full bg-gradient-to-r from-emerald-500 via-yellow-400 to-red-500 transition-[width] duration-75"
                  style={{ width: `${dbfsToMeterPercent(value, minDb)}%` }}
                />
              </div>
              <span className="w-7 text-right font-mono">{formatDbfs(value, minDb)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MeterDbRangeLabel() {
  const [minDb] = useState(getMeterDbRange);
  return <span className="shrink-0 text-[9px] text-[#7f8992]">{minDb} … 0 dBFS · 峰值</span>;
}

function GainKnob({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const drag = useRef<{ y: number; value: number } | null>(null);
  const angle = -135 + ((value + 60) / 72) * 270;

  return (
    <button
      type="button"
      role="slider"
      className="relative size-7 shrink-0 cursor-ns-resize rounded-full border-2 border-[#515a63] bg-[#20252a] text-[#e4e5e7]"
      aria-label="轨道增益"
      aria-valuemin={-60}
      aria-valuemax={12}
      aria-valuenow={value}
      aria-valuetext={`${value.toFixed(1)} dB`}
      title={`增益 ${value.toFixed(1)} dB · 上下拖拽，双击复位`}
      onPointerDown={(e) => {
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { y: e.clientY, value };
      }}
      onPointerMove={(e) => {
        if (!drag.current) return;
        e.stopPropagation();
        const sensitivity = e.shiftKey ? 0.05 : 0.25;
        onChange(clamp(drag.current.value + (drag.current.y - e.clientY) * sensitivity, -60, 12));
      }}
      onPointerUp={(e) => {
        e.stopPropagation();
        drag.current = null;
        e.currentTarget.releasePointerCapture(e.pointerId);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onChange(0);
      }}
      onKeyDown={(e) => {
        const direction = e.key === 'ArrowUp' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowDown' || e.key === 'ArrowLeft' ? -1 : 0;
        if (direction !== 0) {
          e.preventDefault();
          onChange(clamp(value + direction * (e.shiftKey ? 0.1 : 1), -60, 12));
        }
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <span
        className="absolute left-[calc(50%-1px)] top-[2px] h-2.5 w-0.5 rounded-full bg-[#84b5ff]"
        style={{ transform: `rotate(${angle}deg)`, transformOrigin: '50% 9px' }}
      />
    </button>
  );
}

function getShortEffectLabel(type: string): string {
  const map: Record<string, string> = {
    gain: '增益',
    highPass: '高通',
    lowPass: '低通',
    eq: 'EQ',
    compressor: '压缩',
    reverb: '混响',
    delay: '延迟',
    noiseGate: '噪声门',
  };
  return map[type] || type;
}

// Track Timeline Component
function TrackTimeline({
  track,
  trackIndex,
  projectId,
  sampleRate,
  pxPerSec,
  totalWidth,
  rulerWidth,
  dbRange,
  viewMode,
  halfWave,
  onViewModeChange,
  onOpenSpectrogramSettings,
  onHalfWaveChange,
  onVerticalZoomChange,
  selection,
  spectralSelection,
  scrollX,
  verticalZoom,
  showClipping,
  showRMS,
  isSelected,
  selectedClips,
  onSelectClip,
  onTrimClip,
  onStretchClip,
  onMoveClip,
  onResolveClipDelta,
  onResetClip,
  onClipProperties,
  onPitchAndSpeed,
  onResetPitchAndSpeed,
  onRenderPitchAndSpeed,
  onToggleStretchWithTempoChanges,
  onClipColorChange,
  onEditCommand,
  onMultiClipEditCommand,
  canJoinMultiSelection,
  canGroupMultiSelection,
  canUngroupMultiSelection,
  multiClipOperationInProgress,
  onSplitAtSilences,
  splittingSilenceClipId,
  renamingClipKey,
  onRenameClipStart,
  onRenameClip,
  onRenameClipEnd,
  tempoChangesDisabled,
  renderingPitchAndSpeedClipId,
  onSelectionChange,
  onSelectionContextMenu,
  onSpectralSelectionChange,
  onCursorChange,
  onSnapTime,
  channelHeightRatio,
  asymmetricStereoHeightsEnabled,
  onChannelHeightRatioChange,
  onChannelHeightRatioCommit,
}: {
  track: ITrack;
  trackIndex: number;
  projectId: string;
  sampleRate: number;
  pxPerSec: number;
  totalWidth: number;
  rulerWidth: number;
  dbRange: number;
  viewMode: ViewMode;
  halfWave: boolean;
  onViewModeChange: (mode: ViewMode) => void;
  onOpenSpectrogramSettings: () => void;
  onHalfWaveChange: (value: boolean) => void;
  onVerticalZoomChange: (value: number) => void;
  selection: { start: number; end: number } | null;
  spectralSelection: FrequencySelection | null;
  scrollX: number;
  verticalZoom: number;
  showClipping: boolean;
  showRMS: boolean;
  isSelected: boolean;
  selectedClips: ClipKey[];
  onSelectClip: (clipId: string, mode: ClipSelectionMode) => void;
  onTrimClip: (clipId: string, edge: 'left' | 'right', deltaSeconds: number, bypassSnap?: boolean) => void;
  onStretchClip: (clipId: string, edge: 'left' | 'right', deltaSeconds: number, bypassSnap?: boolean) => void;
  onMoveClip: (clipId: string, deltaSeconds: number, bypassSnap?: boolean) => void;
  onResolveClipDelta: (clipId: string, operation: ClipSnapOperation, deltaSeconds: number, bypassSnap: boolean) => number;
  onResetClip: (clipId: string) => void;
  onClipProperties: (clipId: string) => void;
  onPitchAndSpeed: (clipId: string) => void;
  onResetPitchAndSpeed: (clipId: string) => void;
  onRenderPitchAndSpeed: (clipId: string) => void;
  onToggleStretchWithTempoChanges: (clipId: string) => void;
  onClipColorChange: (clipId: string, colorIndex: number) => void;
  onEditCommand: (clipId: string, command: ClipContextEditCommand) => void;
  onMultiClipEditCommand: (clipId: string, command: MultiClipContextEditCommand) => void;
  canJoinMultiSelection: boolean;
  canGroupMultiSelection: boolean;
  canUngroupMultiSelection: boolean;
  multiClipOperationInProgress: boolean;
  onSplitAtSilences: (clipId: string) => void;
  splittingSilenceClipId: string | null;
  renamingClipKey: string | null;
  onRenameClipStart: (clipId: string) => void;
  onRenameClip: (clipId: string, newTitle: string) => void;
  onRenameClipEnd: () => void;
  tempoChangesDisabled: boolean;
  renderingPitchAndSpeedClipId: string | null;
  onSelectionChange: (start: number, end: number) => void;
  onSelectionContextMenu: (trackId: string, x: number, y: number) => void;
  onSpectralSelectionChange: (start: number, end: number, firstHz: number, secondHz: number) => void;
  onCursorChange: (pos: number) => void;
  onSnapTime: (time: number, bypassSnap: boolean) => number;
  channelHeightRatio: number;
  asymmetricStereoHeightsEnabled: boolean;
  onChannelHeightRatioChange: (ratio: number) => void;
  onChannelHeightRatioCommit: (ratio: number) => void;
}) {
  const trackHeight = 100;
  const spectrogramSettings = getTrackSpectrogramSettings(track, sampleRate);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState(0);
  const [stereoClipIds, setStereoClipIds] = useState<string[]>([]);
  const handleAudioChannelsChange = useCallback((clipId: string, isStereo: boolean) => {
    setStereoClipIds((current) => {
      if (isStereo) return current.includes(clipId) ? current : [...current, clipId];
      return current.filter((id) => id !== clipId);
    });
  }, []);

  function handleMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    // Radix portals keep React-tree bubbling: menu clicks must not move the timeline cursor.
    if (e.button !== 0 || (e.target instanceof Element && e.target.closest(
      '[data-slot="context-menu-content"], [data-slot="context-menu-sub-content"]',
    ))) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left - rulerWidth;
    const rawPosition = clamp(x / pxPerSec, 0, totalWidth / pxPerSec);
    const pos = onSnapTime(rawPosition, e.altKey);
    setIsDragging(true);
    setDragStart(pos);
    onCursorChange(pos);
  }

  function handleMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    if (!isDragging) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left - rulerWidth;
    const rawPosition = clamp(x / pxPerSec, 0, totalWidth / pxPerSec);
    const pos = onSnapTime(rawPosition, e.altKey);
    onSelectionChange(dragStart, pos);
  }

  function handleMouseUp() {
    setIsDragging(false);
  }

  function handleContextMenuCapture(e: React.MouseEvent<HTMLDivElement>) {
    if (!selection || selection.end <= selection.start) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const localX = e.clientX - rect.left;
    if (localX < rulerWidth) return;
    const time = (localX - rulerWidth) / pxPerSec;
    const epsilon = 1e-7;
    if (time < selection.start - epsilon || time > selection.end + epsilon) return;
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    onSelectionContextMenu(track.id, e.clientX, e.clientY);
  }

  return (
    <div
      className={`relative border-b border-border transition-colors ${
        isSelected ? 'bg-accent/5' : ''
      }`}
      style={{ height: trackHeight, width: totalWidth + rulerWidth }}
      data-testid={`track-timeline-${track.id}`}
      data-ruler-width={rulerWidth}
      onMouseDownCapture={(e) => {
        if (e.button !== 0) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onContextMenuCapture={handleContextMenuCapture}
    >
      {/* Track background pattern */}
      <div
        className="pointer-events-none absolute inset-0 opacity-5"
        style={{
          backgroundImage:
            'repeating-linear-gradient(0deg, transparent, transparent 24px, currentColor 24px, currentColor 25px)',
        }}
      />

      {rulerWidth > 0 && (viewMode === 'spectrum' ? (
        <TrackSpectrumRuler
          trackId={track.id}
          trackName={track.name}
          width={rulerWidth}
          trackHeight={trackHeight}
          waveformHeight={trackHeight - 24}
          sampleRate={sampleRate}
          settings={spectrogramSettings}
          onOpenSettings={onOpenSpectrogramSettings}
          isStereo={stereoClipIds.length > 0}
          channelHeightRatio={channelHeightRatio}
          asymmetricStereoHeightsEnabled={asymmetricStereoHeightsEnabled}
        />
      ) : viewMode === 'both' ? (
        <TrackCombinedRuler
          trackId={track.id}
          trackName={track.name}
          width={rulerWidth}
          trackHeight={trackHeight}
          waveformHeight={trackHeight - 24}
          sampleRate={sampleRate}
          spectrogramSettings={spectrogramSettings}
          onOpenSpectrogramSettings={onOpenSpectrogramSettings}
          dbRange={dbRange}
          halfWave={halfWave}
          onViewModeChange={onViewModeChange}
          onHalfWaveChange={onHalfWaveChange}
          onVerticalZoomChange={onVerticalZoomChange}
          verticalZoom={verticalZoom}
          isStereo={stereoClipIds.length > 0}
          channelHeightRatio={channelHeightRatio}
          asymmetricStereoHeightsEnabled={asymmetricStereoHeightsEnabled}
        />
      ) : (
        <TrackWaveRuler
          trackId={track.id}
          trackName={track.name}
          width={rulerWidth}
          trackHeight={trackHeight}
          waveformHeight={trackHeight - 24}
          dbRange={dbRange}
          viewMode={viewMode}
          halfWave={halfWave}
          onViewModeChange={onViewModeChange}
          onHalfWaveChange={onHalfWaveChange}
          onVerticalZoomChange={onVerticalZoomChange}
          verticalZoom={verticalZoom}
          isStereo={stereoClipIds.length > 0}
          channelHeightRatio={channelHeightRatio}
          asymmetricStereoHeightsEnabled={asymmetricStereoHeightsEnabled}
        />
      ))}

      {/* Clips */}
      <div className="absolute inset-y-0" style={{ left: rulerWidth, width: totalWidth }}>
        {track.clips.map((clip) => (
        <ClipItem
          key={clip.id}
          clip={clip}
          track={track}
          projectId={projectId}
          sampleRate={sampleRate}
          pxPerSec={pxPerSec}
          trackHeight={trackHeight}
          verticalZoom={verticalZoom}
          showClipping={showClipping}
          showRMS={showRMS}
          viewMode={viewMode}
          halfWave={halfWave}
          dbRange={dbRange}
          selection={selection}
          spectralSelection={spectralSelection}
          isSelected={selectedClips.some((key) => key.trackId === track.id && key.clipId === clip.id)}
          hasMultipleSelections={selectedClips.length > 1}
          trackColor={track.color}
          onTrim={(edge, delta, bypassSnap) => onTrimClip(clip.id, edge, delta, bypassSnap)}
          onStretch={(edge, delta, bypassSnap) => onStretchClip(clip.id, edge, delta, bypassSnap)}
          onMove={(delta, bypassSnap) => onMoveClip(clip.id, delta, bypassSnap)}
          onResolveDelta={(operation, delta, bypassSnap) => onResolveClipDelta(clip.id, operation, delta, bypassSnap)}
          onReset={() => onResetClip(clip.id)}
          onClipProperties={() => onClipProperties(clip.id)}
          onOpenSpectrogramSettings={onOpenSpectrogramSettings}
          onPitchAndSpeed={() => onPitchAndSpeed(clip.id)}
          onResetPitchAndSpeed={() => onResetPitchAndSpeed(clip.id)}
          onRenderPitchAndSpeed={() => onRenderPitchAndSpeed(clip.id)}
          onToggleStretchWithTempoChanges={() => onToggleStretchWithTempoChanges(clip.id)}
          onClipColorChange={(colorIndex) => onClipColorChange(clip.id, colorIndex)}
          onEditCommand={(command) => onEditCommand(clip.id, command)}
          onMultiClipEditCommand={(command) => onMultiClipEditCommand(clip.id, command)}
          canJoinMultiSelection={canJoinMultiSelection}
          canGroupMultiSelection={canGroupMultiSelection}
          canUngroupMultiSelection={canUngroupMultiSelection}
          multiClipOperationInProgress={multiClipOperationInProgress}
          onSplitAtSilences={() => onSplitAtSilences(clip.id)}
          splittingSilenceClipId={splittingSilenceClipId}
          isRenaming={renamingClipKey === clipKeyId({ trackId: track.id, clipId: clip.id })}
          onRenameStart={() => onRenameClipStart(clip.id)}
          onRename={(newTitle) => onRenameClip(clip.id, newTitle)}
          onRenameEnd={onRenameClipEnd}
          tempoChangesDisabled={tempoChangesDisabled}
          renderingPitchAndSpeedClipId={renderingPitchAndSpeedClipId}
          onSelect={(mode) => onSelectClip(clip.id, mode)}
          onSpectralSelectionChange={onSpectralSelectionChange}
          onCursorChange={onCursorChange}
          onSnapTime={onSnapTime}
          onAudioChannelsChange={handleAudioChannelsChange}
          channelHeightRatio={channelHeightRatio}
          asymmetricStereoHeightsEnabled={asymmetricStereoHeightsEnabled}
          onChannelHeightRatioChange={onChannelHeightRatioChange}
          onChannelHeightRatioCommit={onChannelHeightRatioCommit}
        />
        ))}
      </div>
    </div>
  );
}

function TrackWaveRuler({
  trackId,
  trackName,
  width,
  trackHeight,
  waveformHeight,
  dbRange,
  viewMode,
  halfWave,
  onViewModeChange,
  onHalfWaveChange,
  onVerticalZoomChange,
  verticalZoom,
  isStereo,
  channelHeightRatio,
  asymmetricStereoHeightsEnabled,
  embedded = false,
}: {
  trackId: string;
  trackName: string;
  width: number;
  trackHeight: number;
  waveformHeight: number;
  dbRange: number;
  viewMode: ViewMode;
  halfWave: boolean;
  onViewModeChange: (mode: ViewMode) => void;
  onHalfWaveChange: (value: boolean) => void;
  onVerticalZoomChange: (value: number) => void;
  verticalZoom: number;
  isStereo: boolean;
  channelHeightRatio: number;
  asymmetricStereoHeightsEnabled: boolean;
  embedded?: boolean;
}) {
  const ratio = isStereo
    ? normalizeChannelHeightRatio(asymmetricStereoHeightsEnabled ? channelHeightRatio : 0.5, waveformHeight)
    : 0.5;
  const upperHeight = isStereo ? Math.round(waveformHeight * ratio) : waveformHeight;
  const bands = isStereo
    ? [
        { channel: 0, top: 0, height: upperHeight },
        { channel: 1, top: upperHeight, height: waveformHeight - upperHeight },
      ]
    : [{ channel: 0, top: 0, height: waveformHeight }];
  const isLinearAmp = viewMode === 'waveform';
  const isLinearDb = viewMode === 'waveformDbLinear';
  const formatLabel = isLinearAmp ? 'Linear (amp)' : isLinearDb ? 'Linear (dB)' : 'Logarithmic (dB)';
  const halves = halfWave ? (['positive'] as const) : (['positive', 'negative'] as const);

  return (
    <div
      className={`${embedded ? 'relative shrink-0' : 'sticky left-0 z-[28]'} select-none border-r border-[#59636c] bg-[#20262b] text-[#bdc6ce]`}
      style={{ width, height: trackHeight }}
      data-testid={`${isLinearAmp ? 'track-linear-ruler' : 'track-db-ruler'}-${trackId}`}
      data-db-range={isLinearAmp ? undefined : dbRange}
      data-vertical-zoom={verticalZoom}
      data-channel-count={isStereo ? 2 : 1}
      data-stereo-ratio={ratio}
      data-ruler-format={viewMode}
      data-half-wave={halfWave}
      role="group"
      aria-label={`${trackName} ${formatLabel} 轨道标尺${isLinearAmp ? '' : `，下限 ${dbRange} dB`}，纵向缩放 ${verticalZoom}，${halfWave ? '半波' : '全波'}`}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <div className="flex h-5 items-center justify-between border-b border-[#434a50] px-1 text-[8px]">
        <span>{isLinearAmp ? 'amp' : isLinearDb ? 'dB·lin' : 'dB·log'}</span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex size-4 items-center justify-center rounded-sm hover:bg-[#3a444d]"
              aria-label={`${trackName} 轨道标尺设置`}
              title="轨道标尺设置"
              data-testid={`track-ruler-settings-${trackId}`}
            >
              <Settings className="size-3" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-48">
            <DropdownMenuLabel>纵向缩放 {Math.round(verticalZoom * 100)}%</DropdownMenuLabel>
            <DropdownMenuItem
              onClick={() => onVerticalZoomChange(stepVerticalZoom(verticalZoom, 'in'))}
              disabled={verticalZoom >= MAX_VERTICAL_ZOOM}
              data-testid="ruler-zoom-in"
            >
              放大
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => onVerticalZoomChange(stepVerticalZoom(verticalZoom, 'out'))}
              disabled={verticalZoom <= MIN_VERTICAL_ZOOM}
              data-testid="ruler-zoom-out"
            >
              缩小
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => onVerticalZoomChange(DEFAULT_VERTICAL_ZOOM)}
              disabled={verticalZoom === DEFAULT_VERTICAL_ZOOM}
              data-testid="ruler-zoom-reset"
            >
              重置
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>标尺格式</DropdownMenuLabel>
            <DropdownMenuCheckboxItem
              checked={viewMode === 'waveformDb'}
              onClick={() => onViewModeChange('waveformDb')}
              data-testid="ruler-format-log-db"
            >
              Logarithmic (dB)
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={isLinearDb}
              onClick={() => onViewModeChange('waveformDbLinear')}
              data-testid="ruler-format-linear-db"
            >
              Linear (dB)
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={viewMode === 'waveform'}
              onClick={() => onViewModeChange('waveform')}
              data-testid="ruler-format-linear-amp"
            >
              Linear (amp)
            </DropdownMenuCheckboxItem>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem
              checked={halfWave}
              onClick={() => onHalfWaveChange(!halfWave)}
              data-testid="ruler-half-wave"
            >
              Half wave
            </DropdownMenuCheckboxItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="pointer-events-none absolute inset-x-0 top-5" style={{ height: waveformHeight }}>
        {isLinearAmp ? bands.map((band) => {
          const ticks = buildLinearRulerTicks({
            height: band.height,
            verticalZoom,
            halfWave,
            channel: band.channel,
            stereo: isStereo,
          });
          const renderTick = (tick: LinearRulerTick, kind: 'major' | 'minor') => {
            const valueKey = String(tick.value).replace('-', 'n').replace('.', 'p');
            return (
              <div
                key={`${band.channel}-${kind}-${tick.value}`}
                className="absolute inset-x-0 h-0"
                style={{ top: band.top + tick.y }}
                data-testid={`linear-ruler-${kind}-tick-${trackId}-${band.channel}-${valueKey}`}
                data-channel={band.channel}
                data-value={tick.value}
                data-y={band.top + tick.y}
                data-collapsed={ticks.collapsed}
                data-full-width={tick.fullWidth}
                data-negative={tick.negative}
                data-bold={tick.bold}
                aria-hidden="true"
              >
                <span className={`absolute right-0 top-0 h-px ${tick.fullWidth ? 'left-0 w-full' : kind === 'major' ? 'w-2' : 'w-1'} ${tick.bold ? 'bg-[#a3afb9]' : 'bg-[#7c8790]'}`} />
                {kind === 'major' && (
                  <span className={`absolute left-0.5 top-0 bg-[#20262b]/85 pr-1 text-[7px] leading-none ${tick.alignment === 'upper' ? 'translate-y-1' : tick.alignment === 'lower' ? '-translate-y-full' : '-translate-y-1/2'}`}>
                    {tick.label}
                  </span>
                )}
              </div>
            );
          };
          return (
            <div key={band.channel}>
              {ticks.minor.map((tick) => renderTick(tick, 'minor'))}
              {ticks.major.map((tick) => renderTick(tick, 'major'))}
            </div>
          );
        }) : bands.map((band) => {
          const values = isLinearDb
            ? buildDbLinearRulerValues(band.height, dbRange, verticalZoom, isStereo, halfWave)
            : buildDbRulerValues(band.height, dbRange, verticalZoom, isStereo ? 17 : 20, halfWave);
          return halves.flatMap((half) => values.map((value) => {
            const y = band.top + (isLinearDb
              ? dbValueToLinearWaveY(value, band.height, dbRange, verticalZoom, half === 'negative', halfWave)
              : dbValueToWaveY(value, band.height, dbRange, verticalZoom, half === 'negative', halfWave));
            const valueKey = String(value).replace('-', 'n').replace('.', 'p');
            const isFloor = Math.abs(value + Math.abs(dbRange)) < 1e-9;
            const label = isLinearDb
              ? isFloor ? '∞' : Math.abs(Math.round(value))
              : Math.abs(value);
            return (
              <div
                key={`${band.channel}-${half}-${value}`}
                className="absolute inset-x-0 h-0"
                style={{ top: y }}
                data-testid={`db-ruler-tick-${trackId}-${band.channel}-${half}-${valueKey}`}
                data-channel={band.channel}
                data-half={half}
                data-db={value}
                data-y={y}
                aria-hidden="true"
              >
                <span className="absolute right-0 top-0 h-px w-2 bg-[#7c8790]" />
                {half === 'positive' && (
                  <span className="absolute left-0.5 top-0 -translate-y-1/2 bg-[#20262b]/85 pr-1 text-[7px] leading-none">
                    {label}
                  </span>
                )}
              </div>
            );
          }));
        })}
      </div>
    </div>
  );
}

/** Audacity VerticalRulersPanel also exposes a frequency ruler for spectrogram tracks. */
function TrackSpectrumRuler({
  trackId,
  trackName,
  width,
  trackHeight,
  waveformHeight,
  sampleRate,
  settings,
  onOpenSettings,
  isStereo,
  channelHeightRatio,
  asymmetricStereoHeightsEnabled,
  embedded = false,
  showHeader = true,
}: {
  trackId: string;
  trackName: string;
  width: number;
  trackHeight: number;
  waveformHeight: number;
  sampleRate: number;
  settings: ISpectrogramSettings;
  onOpenSettings: () => void;
  isStereo: boolean;
  channelHeightRatio: number;
  asymmetricStereoHeightsEnabled: boolean;
  embedded?: boolean;
  showHeader?: boolean;
}) {
  const ratio = isStereo
    ? normalizeChannelHeightRatio(asymmetricStereoHeightsEnabled ? channelHeightRatio : 0.5, waveformHeight)
    : 0.5;
  const upperHeight = isStereo ? Math.round(waveformHeight * ratio) : waveformHeight;
  const bands = isStereo
    ? [
        { channel: 0, top: 0, height: upperHeight },
        { channel: 1, top: upperHeight, height: waveformHeight - upperHeight },
      ]
    : [{ channel: 0, top: 0, height: waveformHeight }];

  return (
    <div
      className={`${embedded ? 'relative shrink-0' : 'sticky left-0 z-[28]'} select-none border-r border-[#59636c] bg-[#20262b] text-[#bdc6ce]`}
      style={{ width, height: trackHeight }}
      data-testid={`track-spectrum-ruler-${trackId}`}
      data-sample-rate={sampleRate}
      data-spectrogram-scale={settings.scale}
      data-spectrogram-min-frequency={settings.minFreq}
      data-spectrogram-max-frequency={settings.maxFreq}
      data-channel-count={isStereo ? 2 : 1}
      data-stereo-ratio={ratio}
      role="group"
      aria-label={`${trackName} 频率标尺，${settings.scale}，${settings.minFreq}–${settings.maxFreq} Hz`}
      onMouseDown={(event) => event.stopPropagation()}
    >
      {showHeader ? (
        <div className="flex h-5 items-center justify-between gap-0.5 border-b border-[#59636c] px-1 text-[8px] font-medium">
          <span className="truncate">{trackName}</span>
          <span className="flex shrink-0 items-center gap-0.5 text-[#8f9aa3]">
            Hz
            <button
              type="button"
              data-testid={`track-spectrogram-settings-${trackId}`}
              aria-label={`${trackName} Spectrogram settings`}
              title="Spectrogram settings"
              className="grid size-4 place-items-center rounded-sm hover:bg-[#434a50] hover:text-white"
              onClick={(event) => { event.stopPropagation(); onOpenSettings(); }}
            >
              <Settings className="size-2.5" />
            </button>
          </span>
        </div>
      ) : (
        <button
          type="button"
          data-testid={`track-spectrogram-settings-${trackId}`}
          aria-label={`${trackName} Spectrogram settings`}
          title="Spectrogram settings"
          className="absolute right-0.5 top-0.5 z-[2] grid size-4 place-items-center rounded-sm bg-[#20262b]/85 text-[#8f9aa3] hover:bg-[#434a50] hover:text-white"
          onClick={(event) => { event.stopPropagation(); onOpenSettings(); }}
        >
          <Settings className="size-2.5" />
        </button>
      )}
      <div className={`pointer-events-none absolute inset-x-0 ${showHeader ? 'top-5' : 'top-0'}`} style={{ height: waveformHeight }}>
        {bands.map((band) => getSpectrumRulerTicks(band.height, sampleRate, settings).map((tick, index) => {
          const labelTop = Math.min(Math.max(tick.y - 4, 0), Math.max(0, band.height - 8));
          return (
            <div
              key={`${band.channel}-${tick.frequencyHz}`}
              className="absolute inset-x-0 h-0"
              style={{ top: band.top + tick.y }}
              data-testid={`spectrum-ruler-tick-${trackId}-${band.channel}-${index}`}
              data-channel={band.channel}
              data-frequency-hz={tick.frequencyHz}
              data-y={band.top + tick.y}
              aria-hidden="true"
            >
              <span className="absolute right-0 top-0 h-px w-2 bg-[#7c8790]" />
              <span
                className="absolute left-0.5 top-0 whitespace-nowrap bg-[#20262b]/85 text-[7px] leading-none"
                style={{ top: labelTop - tick.y }}
              >
                {tick.label}
              </span>
            </div>
          );
        }))}
      </div>
    </div>
  );
}

/** Audacity Multi-view splits the content into waveform and spectrogram panes. */
function TrackCombinedRuler({
  trackId,
  trackName,
  width,
  trackHeight,
  sampleRate,
  spectrogramSettings,
  onOpenSpectrogramSettings,
  dbRange,
  halfWave,
  onViewModeChange,
  onHalfWaveChange,
  onVerticalZoomChange,
  verticalZoom,
  isStereo,
  channelHeightRatio,
  asymmetricStereoHeightsEnabled,
}: {
  trackId: string;
  trackName: string;
  width: number;
  trackHeight: number;
  waveformHeight: number;
  sampleRate: number;
  spectrogramSettings: ISpectrogramSettings;
  onOpenSpectrogramSettings: () => void;
  dbRange: number;
  halfWave: boolean;
  onViewModeChange: (mode: ViewMode) => void;
  onHalfWaveChange: (value: boolean) => void;
  onVerticalZoomChange: (value: number) => void;
  verticalZoom: number;
  isStereo: boolean;
  channelHeightRatio: number;
  asymmetricStereoHeightsEnabled: boolean;
}) {
  const contentHeight = Math.max(0, trackHeight - 24);
  const paneHeight = contentHeight / 2;
  const waveRulerHeight = 20 + paneHeight;
  return (
    <div
      className="sticky left-0 z-[28] flex flex-col select-none bg-[#20262b] text-[#bdc6ce]"
      style={{ width, height: trackHeight }}
      data-testid={`track-combined-ruler-${trackId}`}
      data-ruler-width={width}
      data-layout="split"
      data-waveform-height={paneHeight}
      data-spectrum-height={paneHeight}
      role="group"
      aria-label={`${trackName} 振幅与频率上下分栏标尺`}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <TrackWaveRuler
        trackId={trackId}
        trackName={trackName}
        width={width}
        trackHeight={waveRulerHeight}
        waveformHeight={paneHeight}
        dbRange={dbRange}
        viewMode="waveform"
        halfWave={halfWave}
        onViewModeChange={onViewModeChange}
        onHalfWaveChange={onHalfWaveChange}
        onVerticalZoomChange={onVerticalZoomChange}
        verticalZoom={verticalZoom}
        isStereo={isStereo}
        channelHeightRatio={channelHeightRatio}
        asymmetricStereoHeightsEnabled={asymmetricStereoHeightsEnabled}
        embedded
      />
      <TrackSpectrumRuler
        trackId={trackId}
        trackName={trackName}
        width={width}
        trackHeight={trackHeight - waveRulerHeight}
        waveformHeight={paneHeight}
        sampleRate={sampleRate}
        settings={spectrogramSettings}
        onOpenSettings={onOpenSpectrogramSettings}
        isStereo={isStereo}
        channelHeightRatio={channelHeightRatio}
        asymmetricStereoHeightsEnabled={asymmetricStereoHeightsEnabled}
        embedded
        showHeader={false}
      />
    </div>
  );
}

// Clip Item Component - renders waveform inside clip bounds
function ClipItem({
  clip,
  track,
  projectId,
  sampleRate,
  pxPerSec,
  trackHeight,
  verticalZoom,
  showClipping,
  showRMS,
  viewMode,
  halfWave,
  dbRange,
  selection,
  spectralSelection,
  isSelected,
  hasMultipleSelections,
  trackColor,
  onTrim,
  onStretch,
  onMove,
  onResolveDelta,
  onReset,
  onClipProperties,
  onOpenSpectrogramSettings,
  onPitchAndSpeed,
  onResetPitchAndSpeed,
  onRenderPitchAndSpeed,
  onToggleStretchWithTempoChanges,
  onClipColorChange,
  onEditCommand,
  onMultiClipEditCommand,
  canJoinMultiSelection,
  canGroupMultiSelection,
  canUngroupMultiSelection,
  multiClipOperationInProgress,
  onSplitAtSilences,
  splittingSilenceClipId,
  isRenaming,
  onRenameStart,
  onRename,
  onRenameEnd,
  tempoChangesDisabled,
  renderingPitchAndSpeedClipId,
  onSelect,
  onSpectralSelectionChange,
  onCursorChange,
  onSnapTime,
  onAudioChannelsChange,
  channelHeightRatio,
  asymmetricStereoHeightsEnabled,
  onChannelHeightRatioChange,
  onChannelHeightRatioCommit,
}: {
  clip: IClip;
  track: ITrack;
  projectId: string;
  sampleRate: number;
  pxPerSec: number;
  trackHeight: number;
  verticalZoom: number;
  showClipping: boolean;
  showRMS: boolean;
  viewMode: ViewMode;
  halfWave: boolean;
  dbRange: number;
  selection: { start: number; end: number } | null;
  spectralSelection: FrequencySelection | null;
  isSelected: boolean;
  hasMultipleSelections: boolean;
  trackColor: string;
  onTrim: (edge: 'left' | 'right', deltaSeconds: number, bypassSnap?: boolean) => void;
  onStretch: (edge: 'left' | 'right', deltaSeconds: number, bypassSnap?: boolean) => void;
  onMove: (deltaSeconds: number, bypassSnap?: boolean) => void;
  onResolveDelta: (operation: ClipSnapOperation, deltaSeconds: number, bypassSnap: boolean) => number;
  onReset: () => void;
  onClipProperties: () => void;
  onOpenSpectrogramSettings: () => void;
  onPitchAndSpeed: () => void;
  onResetPitchAndSpeed: () => void;
  onRenderPitchAndSpeed: () => void;
  onToggleStretchWithTempoChanges: () => void;
  onClipColorChange: (colorIndex: number) => void;
  onEditCommand: (command: ClipContextEditCommand) => void;
  onMultiClipEditCommand: (command: MultiClipContextEditCommand) => void;
  canJoinMultiSelection: boolean;
  canGroupMultiSelection: boolean;
  canUngroupMultiSelection: boolean;
  multiClipOperationInProgress: boolean;
  onSplitAtSilences: () => void;
  splittingSilenceClipId: string | null;
  isRenaming: boolean;
  onRenameStart: () => void;
  onRename: (newTitle: string) => void;
  onRenameEnd: () => void;
  tempoChangesDisabled: boolean;
  renderingPitchAndSpeedClipId: string | null;
  onSelect: (mode: ClipSelectionMode) => void;
  onSpectralSelectionChange: (start: number, end: number, firstHz: number, secondHz: number) => void;
  onCursorChange: (pos: number) => void;
  onSnapTime: (time: number, bypassSnap: boolean) => number;
  onAudioChannelsChange: (clipId: string, isStereo: boolean) => void;
  channelHeightRatio: number;
  asymmetricStereoHeightsEnabled: boolean;
  onChannelHeightRatioChange: (ratio: number) => void;
  onChannelHeightRatioCommit: (ratio: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [audioChannels, setAudioChannels] = useState<Float32Array[] | null>(null);
  const [edgeDrag, setEdgeDrag] = useState<{
    edge: 'left' | 'right';
    mode: 'trim' | 'stretch';
    startX: number;
    delta: number;
  } | null>(null);
  const [moveDrag, setMoveDrag] = useState<{ startX: number; delta: number } | null>(null);
  const suppressClickRef = useRef(false);
  const spectralDragRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    time: number;
    frequencyHz: number;
    moved: boolean;
  } | null>(null);
  const splitterDragRef = useRef<{
    pointerId: number;
    startClientY: number;
    startRatio: number;
    currentRatio: number;
  } | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const renameCompletedRef = useRef(false);
  useEffect(() => {
    renameCompletedRef.current = false;
    if (!isRenaming) return;
    const input = renameInputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, [isRenaming, clip.id]);
  const canvasHeight = trackHeight - 24;
  const isMultiView = viewMode === 'both';
  const paneHeight = isMultiView ? canvasHeight / 2 : canvasHeight;
  const spectrogramSettings = getTrackSpectrogramSettings(track, sampleRate);
  const isStereoClip = audioChannels?.length === 2;
  const effectiveChannelHeightRatio = isStereoClip
    ? normalizeChannelHeightRatio(asymmetricStereoHeightsEnabled ? channelHeightRatio : 0.5, paneHeight)
    : 0.5;

  useEffect(() => {
    onAudioChannelsChange(clip.id, isStereoClip);
  }, [clip.id, isStereoClip, onAudioChannelsChange]);

  useEffect(() => {
    let mounted = true;
    async function load() {
      setAudioChannels(null);
      try {
        let channels: Float32Array[] | null = null;
        if (typeof projectService.loadAudioChannels === 'function') {
          channels = await projectService.loadAudioChannels(clip.audioBufferId, sampleRate) ?? null;
        } else {
          // Keep older integrations that only provide the mono buffer loader.
          const firstChannel = await projectService.loadAudioBuffer(clip.audioBufferId, sampleRate);
          channels = firstChannel ? [firstChannel] : null;
        }
        if (mounted) setAudioChannels(channels && channels.length > 0 ? channels : null);
      } catch {
        if (mounted) setAudioChannels(null);
      }
    }
    load();
    return () => {
      mounted = false;
    };
  }, [clip.audioBufferId, sampleRate]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !audioChannels || audioChannels.length === 0) return;

    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.floor(clip.duration * pxPerSec));
    const height = canvasHeight;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);
    delete canvas.dataset.spectrogramError;
    canvas.dataset.spectrogramCompletedFrames = '0';

    const stretchRatio = getClipStretchRatio(clip);
    const firstChannelHeight = isStereoClip ? paneHeight * effectiveChannelHeightRatio : paneHeight;
    const channelBands = isStereoClip
      ? [
          { data: audioChannels[0]!, top: 0, height: firstChannelHeight },
          { data: audioChannels[1]!, top: firstChannelHeight, height: paneHeight - firstChannelHeight },
        ]
      : [{ data: audioChannels[0]!, top: 0, height: paneHeight }];
    const renderBands = channelBands.flatMap((band) => [
      ...(viewMode === 'waveform' || viewMode === 'waveformDb' || viewMode === 'waveformDbLinear' || isMultiView
        ? [{ ...band, kind: 'waveform' as const }]
        : []),
      ...(viewMode === 'spectrum' || isMultiView
        ? [{ ...band, top: band.top + (isMultiView ? paneHeight : 0), kind: 'spectrum' as const }]
        : []),
    ]);

    const spectrumCleanups: Array<() => void> = [];
    const spectrumRenderTracker: SpectrogramRenderTracker = { pending: 0, completedFrames: 0, failed: false };
    for (const band of renderBands) {
      const bandHeight = Math.max(1, band.height);
      ctx.save();
      ctx.translate(0, band.top);
      ctx.beginPath();
      ctx.rect(0, 0, width, bandHeight);
      ctx.clip();

      if (band.kind === 'waveform') {
        drawWaveform(
          ctx,
          band.data,
          width,
          bandHeight,
          '#20252a',
          clip,
          sampleRate,
          verticalZoom,
          1,
          showClipping,
          viewMode === 'waveformDb' ? dbRange : undefined,
          halfWave,
          showRMS,
        );
      } else {
        const sourceStart = Math.max(0, Math.floor(clip.offset * sampleRate));
        const sourceEnd = Math.min(
          band.data.length,
          Math.floor((clip.offset + clip.duration * stretchRatio) * sampleRate),
        );
        const cleanup = drawSpectrumMini(
          ctx,
          band.data.subarray(sourceStart, Math.max(sourceStart + 1, sourceEnd)),
          width,
          bandHeight,
          sampleRate,
          1,
          spectrogramSettings,
          band.top,
          spectrumRenderTracker,
        );
        if (cleanup) spectrumCleanups.push(cleanup);
      }
      ctx.restore();
    }
    return () => {
      spectrumCleanups.forEach((cleanup) => cleanup());
    };
  }, [audioChannels, pxPerSec, clip.duration, clip.offset, clip.stretchRatio, viewMode, halfWave, dbRange, trackColor, canvasHeight, sampleRate, verticalZoom, showClipping, showRMS, isStereoClip, effectiveChannelHeightRatio, isMultiView, paneHeight, spectrogramSettings.scale, spectrogramSettings.minFreq, spectrogramSettings.maxFreq, spectrogramSettings.gainDb, spectrogramSettings.rangeDb, spectrogramSettings.highBoostDbPerDec, spectrogramSettings.colorScheme, spectrogramSettings.algorithm, spectrogramSettings.windowType, spectrogramSettings.windowSize, spectrogramSettings.zeroPaddingFactor]);

  const left = clip.startTime * pxPerSec;
  const width = clip.duration * pxPerSec;
  const edgeDelta = edgeDrag?.delta ?? 0;
  const moveDelta = moveDrag?.delta ?? 0;
  const displayLeft = left + (edgeDrag?.edge === 'left' ? edgeDelta * pxPerSec : 0) + moveDelta * pxPerSec;
  const displayWidth = Math.max(
    2,
    width + (edgeDrag?.edge === 'left' ? -edgeDelta : edgeDelta) * pxPerSec,
  );
  const spectrumHeight = paneHeight;
  const spectralRect = selection && spectralSelection ? (() => {
    const clipEnd = clip.startTime + clip.duration;
    const selectedStart = Math.max(selection.start, clip.startTime);
    const selectedEnd = Math.min(selection.end, clipEnd);
    if (selectedEnd <= selectedStart) return null;
    const rectLeft = (selectedStart - clip.startTime) * pxPerSec;
    const rectRight = (selectedEnd - clip.startTime) * pxPerSec;
    const top = frequencyToSpectrumY(spectralSelection.highHz, spectrumHeight, sampleRate, spectrogramSettings);
    const bottom = frequencyToSpectrumY(spectralSelection.lowHz, spectrumHeight, sampleRate, spectrogramSettings);
    return bottom > top
      ? { left: rectLeft, width: rectRight - rectLeft, top, height: bottom - top }
      : null;
  })() : null;

  function handleChannelSplitterStart(e: React.PointerEvent<HTMLButtonElement>) {
    if (!asymmetricStereoHeightsEnabled || !isStereoClip) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    splitterDragRef.current = {
      pointerId: e.pointerId,
      startClientY: e.clientY,
      startRatio: effectiveChannelHeightRatio,
      currentRatio: effectiveChannelHeightRatio,
    };
  }

  function handleChannelSplitterMove(e: React.PointerEvent<HTMLButtonElement>) {
    const drag = splitterDragRef.current;
    if (!drag || drag.pointerId !== e.pointerId || paneHeight <= 0) return;
    e.preventDefault();
    e.stopPropagation();
    const next = normalizeChannelHeightRatio(
      drag.startRatio + (e.clientY - drag.startClientY) / paneHeight,
      paneHeight,
    );
    drag.currentRatio = next;
    onChannelHeightRatioChange(next);
  }

  function handleChannelSplitterEnd(e: React.PointerEvent<HTMLButtonElement>) {
    const drag = splitterDragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    e.preventDefault();
    e.stopPropagation();
    splitterDragRef.current = null;
    onChannelHeightRatioCommit(drag.currentRatio);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }

  function handleChannelSplitterKeyDown(e: React.KeyboardEvent<HTMLButtonElement>) {
    if (!asymmetricStereoHeightsEnabled || !isStereoClip) return;
    let requested: number;
    if (e.key === 'ArrowUp') requested = effectiveChannelHeightRatio - (e.shiftKey ? 0.1 : 0.02);
    else if (e.key === 'ArrowDown') requested = effectiveChannelHeightRatio + (e.shiftKey ? 0.1 : 0.02);
    else if (e.key === 'Home') requested = 0;
    else if (e.key === 'End') requested = 1;
    else return;
    e.preventDefault();
    e.stopPropagation();
    const next = normalizeChannelHeightRatio(requested, paneHeight);
    onChannelHeightRatioChange(next);
    onChannelHeightRatioCommit(next);
  }

  function boundedEdgeDelta(edge: 'left' | 'right', mode: 'trim' | 'stretch', rawDelta: number) {
    const ratio = getClipStretchRatio(clip);
    if (mode === 'stretch') return boundClipStretchDelta(clip, edge, rawDelta);
    if (edge === 'left') {
      return clamp(rawDelta, -Math.min(clip.startTime, clip.offset / ratio), Math.max(0, clip.duration - 0.05));
    }
    return clamp(
      rawDelta,
      0.05 - clip.duration,
      Math.max(0.05, (clip.originalDuration - clip.offset) / ratio) - clip.duration,
    );
  }

  function handleEdgeMove(e: React.PointerEvent<HTMLButtonElement>) {
    if (!edgeDrag) return;
    e.stopPropagation();
    const rawDelta = (e.clientX - edgeDrag.startX) / pxPerSec;
    const bounded = boundedEdgeDelta(edgeDrag.edge, edgeDrag.mode, rawDelta);
    const operation: ClipSnapOperation = `${edgeDrag.mode}-${edgeDrag.edge}`;
    setEdgeDrag({ ...edgeDrag, delta: onResolveDelta(operation, bounded, e.altKey) });
  }

  function handleEdgeEnd(e: React.PointerEvent<HTMLButtonElement>) {
    if (!edgeDrag) return;
    e.stopPropagation();
    if (Math.abs(edgeDrag.delta) >= 0.001) {
      if (edgeDrag.mode === 'trim') onTrim(edgeDrag.edge, edgeDrag.delta, e.altKey);
      else onStretch(edgeDrag.edge, edgeDrag.delta, e.altKey);
    }
    setEdgeDrag(null);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  }

  function handleEdgeKeyDown(
    edge: 'left' | 'right',
    mode: 'trim' | 'stretch',
    e: React.KeyboardEvent<HTMLButtonElement>,
  ) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    e.stopPropagation();
    const direction = e.key === 'ArrowLeft' ? -1 : 1;
    const bounded = boundedEdgeDelta(edge, mode, direction * (e.shiftKey ? 1 : 0.1));
    const delta = onResolveDelta(`${mode}-${edge}`, bounded, false);
    if (Math.abs(delta) >= 0.001) {
      if (mode === 'trim') onTrim(edge, delta);
      else onStretch(edge, delta);
    }
  }

  function handleMoveStart(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    setMoveDrag({ startX: e.clientX, delta: 0 });
  }

  function handleMoveMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!moveDrag) return;
    e.stopPropagation();
    const rawDelta = Math.max(-clip.startTime, (e.clientX - moveDrag.startX) / pxPerSec);
    const delta = onResolveDelta('move', rawDelta, e.altKey);
    if (Math.abs(delta) >= 0.001) suppressClickRef.current = true;
    setMoveDrag({ ...moveDrag, delta });
  }

  function handleMoveEnd(e: React.PointerEvent<HTMLDivElement>) {
    if (!moveDrag) return;
    e.stopPropagation();
    if (Math.abs(moveDrag.delta) >= 0.001) onMove(moveDrag.delta, e.altKey);
    setMoveDrag(null);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  }

  function getSpectrumPoint(e: React.PointerEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = clamp(e.clientX - rect.left, 0, rect.width);
    const y = clamp(e.clientY - rect.top, 0, rect.height);
    return {
      time: clip.startTime + x / pxPerSec,
      frequencyHz: spectrumYToFrequency(y, rect.height, sampleRate, spectrogramSettings),
    };
  }

  function handleSpectrumStart(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const point = getSpectrumPoint(e);
    const time = onSnapTime(point.time, e.altKey);
    spectralDragRef.current = {
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      time,
      frequencyHz: point.frequencyHz,
      moved: false,
    };
    onCursorChange(time);
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function handleSpectrumMove(e: React.PointerEvent<HTMLDivElement>) {
    const drag = spectralDragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    e.preventDefault();
    e.stopPropagation();
    if (!drag.moved && Math.hypot(
      e.clientX - drag.startClientX,
      e.clientY - drag.startClientY,
    ) < 2) return;
    drag.moved = true;
    suppressClickRef.current = true;
    const point = getSpectrumPoint(e);
    onSpectralSelectionChange(
      drag.time,
      onSnapTime(point.time, e.altKey),
      drag.frequencyHz,
      point.frequencyHz,
    );
  }

  function handleSpectrumEnd(e: React.PointerEvent<HTMLDivElement>) {
    const drag = spectralDragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    e.preventDefault();
    e.stopPropagation();
    if (drag.moved) {
      const point = getSpectrumPoint(e);
      onSpectralSelectionChange(
        drag.time,
        onSnapTime(point.time, e.altKey),
        drag.frequencyHz,
        point.frequencyHz,
      );
    }
    spectralDragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }

  function handleSelection(e: React.MouseEvent<HTMLDivElement> | React.KeyboardEvent<HTMLDivElement>) {
    const mode: ClipSelectionMode = e.ctrlKey || e.metaKey
      ? 'toggle'
      : e.shiftKey ? 'range' : 'replace';
    const hasClipGroup = Number.isSafeInteger(clip.groupId) && (clip.groupId ?? -1) >= 0;
    // Audacity preserves a multi-selection for a selected ungrouped clip, but
    // plain activation of a grouped clip reselects that complete group.
    if (mode === 'replace' && isSelected && hasMultipleSelections && !hasClipGroup) return;
    onSelect(mode);
  }

  function finishRename() {
    if (renameCompletedRef.current) return;
    renameCompletedRef.current = true;
    onRename(renameInputRef.current?.value ?? clip.name ?? '');
    onRenameEnd();
  }

  function cancelRename() {
    if (renameCompletedRef.current) return;
    renameCompletedRef.current = true;
    onRenameEnd();
  }

  function renderChannelSplitter(pane: 'primary' | 'spectrum') {
    const isSpectrumPane = pane === 'spectrum';
    return (
      <button
        key={pane}
        type="button"
        role="slider"
        aria-label={`${clip.name} ${isSpectrumPane ? '频谱' : ''}立体声声道高度`}
        aria-orientation="vertical"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(effectiveChannelHeightRatio * 100)}
        aria-valuetext={`左声道 ${Math.round(effectiveChannelHeightRatio * 100)}%，右声道 ${Math.round((1 - effectiveChannelHeightRatio) * 100)}%`}
        data-testid={isSpectrumPane ? `stereo-channel-splitter-spectrum-${clip.id}` : `stereo-channel-splitter-${clip.id}`}
        data-channel-pane={isSpectrumPane ? 'spectrum' : 'waveform'}
        data-channel-ratio={effectiveChannelHeightRatio}
        disabled={!asymmetricStereoHeightsEnabled}
        tabIndex={asymmetricStereoHeightsEnabled ? 0 : -1}
        title={asymmetricStereoHeightsEnabled
          ? '拖动调整左右声道高度；方向键微调，Home/End 到边界'
          : '在设置中启用非对称立体声声道高度后可拖动'}
        className={`absolute inset-x-0 z-[25] h-[9px] -translate-y-1/2 touch-none ${
          asymmetricStereoHeightsEnabled ? 'cursor-row-resize' : 'cursor-default'
        }`}
        style={{ top: 20 + (isSpectrumPane ? paneHeight : 0) + effectiveChannelHeightRatio * paneHeight }}
        onPointerDown={handleChannelSplitterStart}
        onPointerMove={handleChannelSplitterMove}
        onPointerUp={handleChannelSplitterEnd}
        onPointerCancel={handleChannelSplitterEnd}
        onKeyDown={handleChannelSplitterKeyDown}
        onMouseDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onClick={(e) => e.stopPropagation()}
        onDragStart={(e) => e.preventDefault()}
      >
        <span className={`pointer-events-none absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-[#20252a]/30 ${
          asymmetricStereoHeightsEnabled ? '' : 'opacity-40'
        }`} />
      </button>
    );
  }

  const isRenderingPitchAndSpeed = renderingPitchAndSpeedClipId === clipKeyId({ trackId: track.id, clipId: clip.id });
  const isSplittingAtSilences = splittingSilenceClipId === clipKeyId({ trackId: track.id, clipId: clip.id });
  const clipOperationInProgress = renderingPitchAndSpeedClipId !== null || splittingSilenceClipId !== null;
  const pitchAndSpeedModified = hasClipPitchOrSpeed(clip);
  const clipColor = getClipColor(clip, trackColor);

  return (
    <ContextMenu onOpenChange={(open) => { if (open && !isSelected) onSelect('replace'); }}>
      <ContextMenuTrigger asChild>
    <div
      className="au-clip group absolute top-1 bottom-1 overflow-hidden rounded-[3px] border text-[#20252a]"
      data-selected={isSelected}
      data-audio-buffer-id={clip.audioBufferId}
      data-start-time={clip.startTime}
      data-offset={clip.offset}
      data-duration={clip.duration}
      data-original-duration={clip.originalDuration}
      data-rendering-pitch-speed={isRenderingPitchAndSpeed ? 'true' : undefined}
      data-splitting-silences={isSplittingAtSilences ? 'true' : undefined}
      data-pitch-cents={getClipPitchCents(clip)}
      data-optimize-for-voice={getClipOptimizeForVoice(clip)}
      data-stretch-ratio={getClipStretchRatio(clip)}
      data-stretch-to-match-tempo={isClipStretchToMatchTempo(clip)}
      data-clip-tempo={clip.clipTempo ?? ''}
      data-raw-audio-tempo={clip.rawAudioTempo ?? ''}
      data-clip-color-index={getClipColorIndex(clip)}
      data-clip-group-id={clip.groupId ?? -1}
      data-spectrogram-scale={spectrogramSettings.scale}
      data-spectrogram-min-frequency={spectrogramSettings.minFreq}
      data-spectrogram-max-frequency={spectrogramSettings.maxFreq}
      data-spectrogram-gain={spectrogramSettings.gainDb}
      data-spectrogram-range={spectrogramSettings.rangeDb}
      data-spectrogram-high-boost={spectrogramSettings.highBoostDbPerDec}
      data-spectrogram-color-scheme={spectrogramSettings.colorScheme}
      data-spectrogram-algorithm={spectrogramSettings.algorithm}
      data-spectrogram-window-type={spectrogramSettings.windowType}
      data-spectrogram-window-size={spectrogramSettings.windowSize}
      data-spectrogram-zero-padding={spectrogramSettings.zeroPaddingFactor}
      data-clip-color={clipColor}
      data-clip-name={clip.name ?? ''}
      data-rename-active={isRenaming ? 'true' : undefined}
      role="button"
      tabIndex={0}
      aria-label={`${clip.name || '音频片段'}，开始 ${formatTime(clip.startTime)}，时长 ${formatTime(clip.duration)}，速度 ${Math.round(100 * getClipStretchRatio(clip))}%`}
      aria-pressed={isSelected}
      style={{
        left: displayLeft,
        width: displayWidth,
        backgroundColor: `color-mix(in srgb, ${clipColor} 76%, white)`,
      }}
      onClick={(e) => {
        e.stopPropagation();
        if (suppressClickRef.current) {
          suppressClickRef.current = false;
          return;
        }
        handleSelection(e);
      }}
      onKeyDown={(e) => {
        if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
          e.preventDefault();
          e.stopPropagation();
          onMove((e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 1 : 0.1));
          return;
        }
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          handleSelection(e);
        }
      }}
    >
      {/* Audacity 4 clip header */}
      <div
        className="absolute inset-x-0 top-0 z-10 flex h-5 cursor-grab touch-none select-none items-center gap-1 truncate px-1.5 text-[10px] font-medium active:cursor-grabbing"
        style={{ backgroundColor: clipColor }}
        title="拖动移动片段；成组选择时同步移动"
        onPointerDown={handleMoveStart}
        onPointerMove={handleMoveMove}
        onPointerUp={handleMoveEnd}
        onPointerCancel={() => setMoveDrag(null)}
        onDoubleClick={(e) => {
          if (clipOperationInProgress) return;
          e.preventDefault();
          e.stopPropagation();
          onRenameStart();
        }}
      >
        {isRenaming ? (
          <input
            ref={renameInputRef}
            type="text"
            defaultValue={clip.name ?? ''}
            data-testid={`clip-rename-input-${clip.id}`}
            aria-label="Rename clip"
            className="h-5 min-w-0 flex-1 cursor-text select-text rounded-[2px] border border-[#20252a]/50 bg-white/90 px-1 text-[10px] font-medium outline-none"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            onBlur={finishRename}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') {
                e.preventDefault();
                finishRename();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                cancelRename();
              }
            }}
          />
        ) : (
          <span data-testid={`clip-title-${clip.id}`} className="min-w-0 flex-1 truncate">{clip.name ?? '音频片段'}</span>
        )}
        {Number.isSafeInteger(clip.groupId) && (clip.groupId ?? -1) >= 0 && (
          <span
            data-testid={`clip-group-${clip.id}`}
            className="flex shrink-0 items-center gap-0.5 rounded-sm bg-[#20252a]/20 px-1 text-[9px] font-semibold"
            title={`Clip group ${clip.groupId}`}
            aria-label={`Clip group ${clip.groupId}`}
          >
            <Link2 className="size-3" aria-hidden="true" />
            {clip.groupId}
          </span>
        )}
        <button
          type="button"
          className={`shrink-0 rounded-sm p-0.5 hover:bg-[#20252a]/20 ${
            getClipPitchCents(clip) !== 0 || getClipOptimizeForVoice(clip) ? 'bg-[#20252a]/20' : ''
          }`}
          aria-label={`Pitch and speed：${clip.name || '音频片段'}`}
          title="Pitch and speed"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onPitchAndSpeed();
          }}
        >
          <AudioWaveform className="size-3" aria-hidden="true" />
        </button>
        {getClipStretchRatio(clip) !== 1 && (
          <button
            type="button"
            className="shrink-0 rounded-sm bg-[#20252a]/20 px-1 text-[9px] font-semibold hover:bg-[#20252a]/35"
            aria-label="恢复片段速度100%"
            title={`速度 ${Math.round(100 * getClipStretchRatio(clip))}%，点击恢复 100%`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onReset();
            }}
          >
            {Math.round(100 * getClipStretchRatio(clip))}%
          </button>
        )}
      </div>

      {/* Waveform canvas */}
      <canvas
        ref={canvasRef}
        className="absolute inset-x-0 bottom-1 top-5"
        data-testid={`waveform-canvas-${clip.id}`}
        data-view-mode={viewMode}
        data-db-range={viewMode === 'waveformDb' || viewMode === 'waveformDbLinear' ? dbRange : undefined}
        data-half-wave={halfWave}
        data-show-rms={showRMS}
        data-channel-count={audioChannels?.length ?? 0}
        data-stereo-ratio={effectiveChannelHeightRatio}
        data-layout={isMultiView ? 'split' : 'single'}
        data-waveform-pane-height={viewMode === 'spectrum' ? 0 : paneHeight}
        data-spectrum-pane-height={viewMode === 'spectrum' || isMultiView ? paneHeight : 0}
        data-spectrum-top={isMultiView ? paneHeight : 0}
        data-spectrogram-scale={spectrogramSettings.scale}
        data-spectrogram-min-frequency={spectrogramSettings.minFreq}
        data-spectrogram-max-frequency={spectrogramSettings.maxFreq}
        data-spectrogram-gain={spectrogramSettings.gainDb}
        data-spectrogram-range={spectrogramSettings.rangeDb}
        data-spectrogram-high-boost={spectrogramSettings.highBoostDbPerDec}
        data-spectrogram-color-scheme={spectrogramSettings.colorScheme}
      data-spectrogram-algorithm={spectrogramSettings.algorithm}
      data-spectrogram-window-type={spectrogramSettings.windowType}
      data-spectrogram-window-size={spectrogramSettings.windowSize}
      data-spectrogram-zero-padding={spectrogramSettings.zeroPaddingFactor}
      />
      {isMultiView && (
        <div
          className="pointer-events-none absolute inset-x-0 z-10 h-px bg-[#20252a]/45"
          style={{ top: 20 + paneHeight }}
          data-testid={`multi-view-divider-${clip.id}`}
          aria-hidden="true"
        />
      )}
      {isStereoClip && (
        <>
          {renderChannelSplitter('primary')}
          {isMultiView && renderChannelSplitter('spectrum')}
        </>
      )}

      {(viewMode === 'spectrum' || viewMode === 'both') && (
        <div
          className="absolute inset-x-0 z-[15] cursor-crosshair touch-none select-none"
          style={{ top: 20 + (isMultiView ? paneHeight : 0), height: spectrumHeight }}
          data-testid={`spectral-selection-surface-${clip.id}`}
          data-layout={isMultiView ? 'split' : 'single'}
          role="group"
          aria-label="频谱矩形选区，拖拽选择时间和频率"
          title="拖拽创建时间×频率选区；频率范围对应当前线性频谱显示范围"
          onPointerDown={handleSpectrumStart}
          onPointerMove={handleSpectrumMove}
          onPointerUp={handleSpectrumEnd}
          onPointerCancel={() => { spectralDragRef.current = null; }}
          onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
          onClick={(e) => e.stopPropagation()}
        >
          {spectralRect && (
            <div
              className="pointer-events-none absolute border border-[#fff2a8] bg-[#fff2a8]/25 shadow-[inset_0_0_0_1px_rgba(32,37,42,0.25)]"
              data-testid="spectral-selection-rectangle"
              style={spectralRect}
            >
              {spectralRect.width >= 110 && spectralRect.height >= 18 && spectralSelection && (
                <span className="absolute right-1 top-0.5 rounded-sm bg-[#20252a]/75 px-1 text-[9px] text-[#fff2a8]">
                  {spectralSelection.lowHz.toFixed(1)}–{spectralSelection.highHz.toFixed(1)} Hz
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Functional trim and non-destructive stretch handles */}
      {([
        { mode: 'trim', edge: 'left' },
        { mode: 'trim', edge: 'right' },
        { mode: 'stretch', edge: 'left' },
        { mode: 'stretch', edge: 'right' },
      ] as const).map(({ mode, edge }) => (
        <button
          key={`${mode}-${edge}`}
          type="button"
          aria-label={`${mode === 'trim' ? '修剪' : '拉伸'}片段${edge === 'left' ? '左' : '右'}边缘`}
          title={`${mode === 'trim' ? '修剪' : '非破坏性时间拉伸'}${edge === 'left' ? '起点' : '终点'}；方向键 0.1 秒，Shift+方向键 1 秒`}
          className={`absolute z-20 cursor-ew-resize touch-none select-none opacity-0 transition-opacity focus:opacity-100 group-hover:opacity-100 ${
            isSelected || (edgeDrag?.edge === edge && edgeDrag.mode === mode) ? 'opacity-100' : ''
          } ${edge === 'left' ? 'left-0' : 'right-0'} ${
            mode === 'trim' ? 'top-5 bottom-1 w-2.5' : 'top-6 h-4 w-4'
          }`}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => handleEdgeKeyDown(edge, mode, e)}
          onPointerDown={(e) => {
            e.currentTarget.focus();
            e.preventDefault();
            e.stopPropagation();
            e.currentTarget.setPointerCapture(e.pointerId);
            setEdgeDrag({ edge, mode, startX: e.clientX, delta: 0 });
          }}
          onPointerMove={handleEdgeMove}
          onPointerUp={handleEdgeEnd}
          onPointerCancel={() => setEdgeDrag(null)}
        >
          {mode === 'trim' ? (
            <span
              className={`absolute top-1/2 size-0 -translate-y-1/2 border-y-4 border-y-transparent ${
                edge === 'left'
                  ? 'left-0.5 border-r-[6px] border-r-[#20252a]'
                  : 'right-0.5 border-l-[6px] border-l-[#20252a]'
              }`}
            />
          ) : (
            <span className={`absolute top-0 text-[13px] font-bold leading-none ${edge === 'left' ? 'left-1' : 'right-1'}`}>↔</span>
          )}
        </button>
      ))}

      {/* Fade indicators */}
      {clip.fadeIn > 0 && (
        <div
          className="pointer-events-none absolute left-0 top-5 bottom-0 bg-gradient-to-r from-[#20252a]/20 to-transparent"
          style={{ width: clip.fadeIn * pxPerSec }}
        />
      )}
      {clip.fadeOut > 0 && (
        <div
          className="pointer-events-none absolute right-0 top-5 bottom-0 bg-gradient-to-l from-[#20252a]/20 to-transparent"
          style={{ width: clip.fadeOut * pxPerSec }}
        />
      )}
    </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-60">
        {hasMultipleSelections ? (
          <>
            <ContextMenuItem
              data-testid="multi-clip-cut-menu"
              disabled={multiClipOperationInProgress}
              onSelect={() => onMultiClipEditCommand('cut')}
            >
              Cut
            </ContextMenuItem>
            <ContextMenuItem
              data-testid="multi-clip-copy-menu"
              disabled={multiClipOperationInProgress}
              onSelect={() => onMultiClipEditCommand('copy')}
            >
              Copy
            </ContextMenuItem>
            <ContextMenuItem
              data-testid="multi-clip-delete-menu"
              disabled={multiClipOperationInProgress}
              onSelect={() => onMultiClipEditCommand('delete')}
            >
              Delete
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuSub>
              <ContextMenuSubTrigger
                data-testid="multi-clip-cut-options-menu"
                disabled={multiClipOperationInProgress}
              >
                Cut and…
              </ContextMenuSubTrigger>
              <ContextMenuSubContent className="w-72">
                {([
                  { mode: 'leave-gap', label: 'leave gap' },
                  { mode: 'per-track', label: 'close gap on this track' },
                  { mode: 'all-tracks', label: 'close gap on all tracks' },
                ] as const).map(({ mode, label }) => (
                  <ContextMenuItem
                    key={mode}
                    data-testid={`multi-clip-cut-${mode}`}
                    disabled={multiClipOperationInProgress}
                    onSelect={() => onMultiClipEditCommand({ operation: 'cut', mode })}
                  >
                    Cut and {label}
                  </ContextMenuItem>
                ))}
              </ContextMenuSubContent>
            </ContextMenuSub>
            <ContextMenuSub>
              <ContextMenuSubTrigger
                data-testid="multi-clip-delete-options-menu"
                disabled={multiClipOperationInProgress}
              >
                Delete and…
              </ContextMenuSubTrigger>
              <ContextMenuSubContent className="w-72">
                {([
                  { mode: 'leave-gap', label: 'leave gap' },
                  { mode: 'per-track', label: 'close gap on this track' },
                  { mode: 'all-tracks', label: 'close gap on all tracks' },
                ] as const).map(({ mode, label }) => (
                  <ContextMenuItem
                    key={mode}
                    data-testid={`multi-clip-delete-${mode}`}
                    disabled={multiClipOperationInProgress}
                    onSelect={() => onMultiClipEditCommand({ operation: 'delete', mode })}
                  >
                    Delete and {label}
                  </ContextMenuItem>
                ))}
              </ContextMenuSubContent>
            </ContextMenuSub>
            <ContextMenuSeparator />
            <ContextMenuItem
              data-testid="multi-clip-join-menu"
              disabled={!canJoinMultiSelection || multiClipOperationInProgress}
              title="Join 需要同一轨道的多个选中 Clip，且跨度内没有未选 Clip"
              onSelect={() => onMultiClipEditCommand('join')}
            >
              Join
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem
              data-testid="multi-clip-group-menu"
              disabled={!canGroupMultiSelection || multiClipOperationInProgress}
              title="将选中 Clip 设为同一组；若已选组则复用首个组 ID"
              onSelect={() => onMultiClipEditCommand('group')}
            >
              Group
            </ContextMenuItem>
            <ContextMenuItem
              data-testid="multi-clip-ungroup-menu"
              disabled={!canUngroupMultiSelection || multiClipOperationInProgress}
              title="仅取消选中 Clip 的分组，不影响未选 Clip"
              onSelect={() => onMultiClipEditCommand('ungroup')}
            >
              Ungroup
            </ContextMenuItem>
          </>
        ) : (
          <>
        <ContextMenuItem
          data-testid="clip-properties-menu"
          disabled={hasMultipleSelections || clipOperationInProgress}
          onSelect={onClipProperties}
        >
          Clip properties
        </ContextMenuItem>
        <ContextMenuItem
          data-testid="clip-rename-menu"
          disabled={hasMultipleSelections || clipOperationInProgress}
          onSelect={() => {
            // Radix restores trigger focus after onSelect; start editing after that handoff.
            window.setTimeout(onRenameStart, 0);
          }}
        >
          Rename clip
        </ContextMenuItem>
        <ContextMenuSub>
          <ContextMenuSubTrigger
            data-testid="clip-color-menu"
            disabled={clipOperationInProgress}
          >
            Clip color
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-52">
            <ContextMenuRadioGroup
              value={String(getClipColorIndex(clip))}
              onValueChange={(value) => onClipColorChange(Number(value))}
            >
              <ContextMenuRadioItem value="0" data-testid="clip-color-auto">
                <span aria-hidden="true" className="size-3 rounded-sm border border-black/10" style={{ backgroundColor: trackColor }} />
                Same as track color
              </ContextMenuRadioItem>
              <ContextMenuSeparator />
              {CLIP_COLORS.map((entry) => (
                <ContextMenuRadioItem
                  key={entry.index}
                  value={String(entry.index)}
                  data-testid={`clip-color-${entry.index}`}
                >
                  <span aria-hidden="true" className="size-3 rounded-sm border border-black/10" style={{ backgroundColor: entry.color }} />
                  {entry.name}
                </ContextMenuRadioItem>
              ))}
            </ContextMenuRadioGroup>
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSeparator />
        <ContextMenuItem
          data-testid="clip-cut-menu"
          disabled={hasMultipleSelections || clipOperationInProgress}
          onSelect={() => onEditCommand('cut')}
        >
          Cut
        </ContextMenuItem>
        <ContextMenuItem
          data-testid="clip-copy-menu"
          disabled={hasMultipleSelections || clipOperationInProgress}
          onSelect={() => onEditCommand('copy')}
        >
          Copy
        </ContextMenuItem>
        <ContextMenuItem
          data-testid="clip-duplicate-menu"
          disabled={hasMultipleSelections || clipOperationInProgress}
          onSelect={() => onEditCommand('duplicate')}
        >
          Duplicate
        </ContextMenuItem>
        <ContextMenuItem
          data-testid="clip-delete-menu"
          disabled={hasMultipleSelections || clipOperationInProgress}
          onSelect={() => onEditCommand('delete')}
        >
          Delete
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuSub>
          <ContextMenuSubTrigger
            data-testid="clip-cut-options-menu"
            disabled={hasMultipleSelections || clipOperationInProgress}
          >
            Cut and…
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-72">
            {([
              { mode: 'leave-gap', label: 'leave gap' },
              { mode: 'per-track', label: 'close gap on this track' },
              { mode: 'all-tracks', label: 'close gap on all tracks' },
            ] as const).map(({ mode, label }) => (
              <ContextMenuItem
                key={mode}
                data-testid={`clip-cut-${mode}`}
                onSelect={() => onEditCommand({ operation: 'cut', mode })}
              >
                Cut and {label}
              </ContextMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSub>
          <ContextMenuSubTrigger
            data-testid="clip-delete-options-menu"
            disabled={hasMultipleSelections || clipOperationInProgress}
          >
            Delete and…
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-72">
            {([
              { mode: 'leave-gap', label: 'leave gap' },
              { mode: 'per-track', label: 'close gap on this track' },
              { mode: 'all-tracks', label: 'close gap on all tracks' },
            ] as const).map(({ mode, label }) => (
              <ContextMenuItem
                key={mode}
                data-testid={`clip-delete-${mode}`}
                onSelect={() => onEditCommand({ operation: 'delete', mode })}
              >
                Delete and {label}
              </ContextMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSeparator />
        <ContextMenuItem
          data-testid="clip-split-menu"
          disabled={hasMultipleSelections || clipOperationInProgress}
          onSelect={() => onEditCommand('split')}
        >
          Split
        </ContextMenuItem>
        <ContextMenuItem
          data-testid="clip-split-silences-menu"
          disabled={hasMultipleSelections || clipOperationInProgress}
          onSelect={onSplitAtSilences}
        >
          {isSplittingAtSilences ? 'Splitting at silences…' : 'Split at silences'}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuCheckboxItem
          checked={isClipStretchToMatchTempo(clip)}
          disabled={tempoChangesDisabled || clipOperationInProgress}
          onSelect={onToggleStretchWithTempoChanges}
        >
          Stretch with tempo changes
        </ContextMenuCheckboxItem>
        <ContextMenuItem
          disabled={clipOperationInProgress}
          onSelect={onPitchAndSpeed}
        >
          Pitch and speed…
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          disabled={!pitchAndSpeedModified || clipOperationInProgress}
          onSelect={onResetPitchAndSpeed}
        >
          Reset pitch and speed
        </ContextMenuItem>
        <ContextMenuItem
          disabled={!pitchAndSpeedModified || clipOperationInProgress}
          onSelect={onRenderPitchAndSpeed}
        >
          {isRenderingPitchAndSpeed ? 'Rendering pitch and speed…' : 'Render pitch and speed'}
        </ContextMenuItem>
        {(viewMode === 'spectrum' || viewMode === 'both') && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem
              data-testid="clip-spectrogram-settings-menu"
              disabled={clipOperationInProgress}
              onSelect={onOpenSpectrogramSettings}
            >
              Spectrogram settings
            </ContextMenuItem>
          </>
        )}
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}

function formatAudacityTime(seconds: number): string {
  const safeSeconds = Math.max(0, seconds);
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const secs = Math.floor(safeSeconds % 60);
  const milliseconds = Math.floor((safeSeconds - Math.floor(safeSeconds)) * 1000);
  return `${hours.toString().padStart(2, '0')}h${minutes.toString().padStart(2, '0')}m${secs
    .toString()
    .padStart(2, '0')}.${milliseconds.toString().padStart(3, '0')}s`;
}

const SPECTROGRAM_WORKER_CELL_THRESHOLD = 4_000_000;

interface SpectrogramRenderTracker {
  pending: number;
  completedFrames: number;
  failed: boolean;
}

type SpectrogramWorkerMessage =
  | { type: 'chunk'; startFrame: number; completedFrames: number; values: Float32Array }
  | {
    type: 'done';
    frameCount: number;
    bufferedFrames: number;
    distantBinCount: number;
    cachedContributionCount: number;
    totalContributionCount: number;
    usedContributionCache: boolean;
  }
  | { type: 'error'; message: string };

function paintSpectrogramChunk(
  ctx: CanvasRenderingContext2D,
  values: Float32Array,
  startFrame: number,
  totalFrameCount: number,
  width: number,
  height: number,
  settings: ISpectrogramSettings,
) {
  const pxPerFrame = width / totalFrameCount;
  const chunkFrameCount = Math.floor(values.length / height);
  for (let localFrame = 0; localFrame < chunkFrameCount; localFrame++) {
    const x = (startFrame + localFrame) * pxPerFrame;
    for (let pixelY = 0; pixelY < height; pixelY++) {
      const [red, green, blue] = getSpectrogramRgb(values[localFrame * height + pixelY]!, settings.colorScheme);
      ctx.fillStyle = `rgb(${red}, ${green}, ${blue})`;
      ctx.fillRect(Math.floor(x), pixelY, Math.ceil(pxPerFrame), 1);
    }
  }
}

function drawSpectrumMiniWorker(
  ctx: CanvasRenderingContext2D,
  data: Float32Array,
  width: number,
  height: number,
  sampleRate: number,
  alpha: number,
  settings: ISpectrogramSettings,
  totalFrameCount: number,
  offsetY: number,
  tracker: SpectrogramRenderTracker,
): () => void {
  const worker = new Worker(new URL('../../lib/spectrogram.worker.ts', import.meta.url), { type: 'module' });
  let cancelled = false;
  let workerCompletedFrames = 0;
  ctx.globalAlpha = alpha;
  tracker.pending += 1;
  ctx.canvas.dataset.spectrogramState = 'pending';
  ctx.canvas.dataset.spectrogramCompletedFrames = String(tracker.completedFrames);
  worker.onmessage = ({ data: message }: MessageEvent<SpectrogramWorkerMessage>) => {
    if (cancelled) return;
    if (message.type === 'chunk') {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(0, offsetY);
      ctx.beginPath();
      ctx.rect(0, 0, width, height);
      ctx.clip();
      paintSpectrogramChunk(ctx, message.values, message.startFrame, totalFrameCount, width, height, settings);
      ctx.restore();
      tracker.completedFrames += message.completedFrames - workerCompletedFrames;
      workerCompletedFrames = message.completedFrames;
      ctx.canvas.dataset.spectrogramCompletedFrames = String(tracker.completedFrames);
      return;
    }
    ctx.globalAlpha = 1;
    tracker.pending = Math.max(0, tracker.pending - 1);
    if (message.type === 'error') {
      tracker.failed = true;
      ctx.canvas.dataset.spectrogramError = message.message;
    } else {
      ctx.canvas.dataset.spectrogramBufferedFrames = String(message.bufferedFrames);
      ctx.canvas.dataset.spectrogramDistantBins = String(message.distantBinCount);
      ctx.canvas.dataset.spectrogramCachedContributions = String(message.cachedContributionCount);
      ctx.canvas.dataset.spectrogramTotalContributions = String(message.totalContributionCount);
      ctx.canvas.dataset.spectrogramUsedContributionCache = String(message.usedContributionCache);
    }
    if (tracker.pending === 0) {
      ctx.canvas.dataset.spectrogramState = tracker.failed ? 'error' : 'done';
    }
    worker.terminate();
  };
  worker.onerror = (event) => {
    if (cancelled) return;
    ctx.globalAlpha = 1;
    tracker.pending = Math.max(0, tracker.pending - 1);
    tracker.failed = true;
    ctx.canvas.dataset.spectrogramError = event.message;
    if (tracker.pending === 0) ctx.canvas.dataset.spectrogramState = 'error';
    worker.terminate();
  };
  const input = data.slice();
  worker.postMessage({ data: input, width, height, sampleRate, settings }, [input.buffer]);
  return () => {
    cancelled = true;
    worker.onmessage = null;
    worker.onerror = null;
    worker.terminate();
    ctx.globalAlpha = 1;
  };
}

function drawSpectrumMini(
  ctx: CanvasRenderingContext2D,
  data: Float32Array,
  width: number,
  height: number,
  sampleRate: number,
  alpha: number,
  settings: ISpectrogramSettings,
  offsetY = 0,
  tracker?: SpectrogramRenderTracker,
): (() => void) | undefined {
  if (width <= 0 || height <= 0) return undefined;
  const fftLength = getSpectrogramFftLength(settings);
  const hopSize = Math.floor(data.length / width) || 1;
  const specLen = fftLength / 2;
  const estimatedFrames = Math.max(1, Math.ceil(data.length / hopSize));
  const renderTracker = tracker ?? { pending: 0, completedFrames: 0, failed: false };
  if (typeof Worker !== 'undefined' && estimatedFrames * specLen > SPECTROGRAM_WORKER_CELL_THRESHOLD) {
    return drawSpectrumMiniWorker(ctx, data, width, height, sampleRate, alpha, settings, estimatedFrames, offsetY, renderTracker);
  }

  const specData = wasmProcessor.spectrogram(data, settings.windowSize, hopSize, settings);
  const frameCount = Math.floor(specData.length / specLen);
  if (frameCount <= 0) return undefined;

  ctx.globalAlpha = alpha;
  for (let frame = 0; frame < frameCount; frame++) {
    const frameStart = frame * specLen;
    const values = getSpectrogramFrameColorValues(
      specData.subarray(frameStart, frameStart + specLen),
      fftLength,
      height,
      sampleRate,
      settings,
    );
    paintSpectrogramChunk(ctx, values, frame, frameCount, width, height, settings);
  }
  ctx.globalAlpha = 1;
  renderTracker.completedFrames += frameCount;
  ctx.canvas.dataset.spectrogramCompletedFrames = String(renderTracker.completedFrames);
  if (renderTracker.pending === 0) ctx.canvas.dataset.spectrogramState = 'done';
  return undefined;
}

// Time Ruler Component
function formatRulerTime(seconds: number, interval: number) {
  const totalMs = Math.round(seconds * 1000);
  const hours = Math.floor(totalMs / 3_600_000);
  const minutes = Math.floor((totalMs % 3_600_000) / 60_000);
  const secs = Math.floor((totalMs % 60_000) / 1000);
  const ms = totalMs % 1000;
  const base = hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  return interval < 1 ? `${base}.${String(ms).padStart(3, '0')}` : base;
}

interface ActiveLoopInteraction {
  mode: LoopInteractionMode;
  region: LoopRegion | null;
  anchorTime: number;
  startX: number;
  moved: boolean;
  pointerId: number;
}

function LoopRulerInteraction({
  region,
  enabled,
  pxPerSec,
  maxTime,
  disabled,
  onSnapTime,
  onChange,
  onToggle,
}: {
  region: LoopRegion | null;
  enabled: boolean;
  pxPerSec: number;
  maxTime: number;
  disabled: boolean;
  onSnapTime: (time: number, bypassSnap?: boolean) => number;
  onChange: (region: LoopRegion | null, enabled?: boolean) => void;
  onToggle: () => void;
}) {
  const interaction = useRef<ActiveLoopInteraction | null>(null);

  function eventTime(e: React.PointerEvent<HTMLDivElement>): number {
    const rect = e.currentTarget.getBoundingClientRect();
    return clamp((e.clientX - rect.left) / Math.max(1, pxPerSec), 0, maxTime);
  }

  function interactionMode(e: React.PointerEvent<HTMLDivElement>): LoopInteractionMode | null {
    return getLoopInteractionMode(region, eventTime(e), pxPerSec, e.ctrlKey || e.metaKey);
  }

  function updateCursor(e: React.PointerEvent<HTMLDivElement>) {
    if (interaction.current) {
      e.currentTarget.style.cursor = interaction.current.mode === 'move' ? 'grabbing' : 'ew-resize';
      return;
    }
    const mode = interactionMode(e);
    e.currentTarget.style.cursor = mode === 'move' ? 'grab'
      : mode === 'resize-start' || mode === 'resize-end' ? 'ew-resize'
        : mode === 'create' ? 'crosshair' : 'default';
  }

  function finishInteraction(e: React.PointerEvent<HTMLDivElement>, toggleOnClick: boolean) {
    const active = interaction.current;
    if (!active || active.pointerId !== e.pointerId) return;
    interaction.current = null;
    if (toggleOnClick && active.mode === 'move' && !active.moved) onToggle();
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    updateCursor(e);
  }

  return (
    <div
      role="group"
      aria-label="循环时间线：Ctrl 或 Command 拖拽创建循环，拖动循环移动，拖动边缘调整，单击循环切换播放"
      title="Ctrl/Cmd+拖拽创建循环 · 拖动循环移动 · 拖动边缘调整 · 单击切换 · Alt 临时禁用吸附"
      data-testid="loop-ruler-interaction"
      aria-disabled={disabled}
      className="absolute inset-0 z-[21] touch-none select-none"
      onPointerDown={(e) => {
        if (disabled || e.button !== 0) return;
        const mode = interactionMode(e);
        if (!mode) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        interaction.current = {
          mode,
          region,
          anchorTime: eventTime(e),
          startX: e.clientX,
          moved: false,
          pointerId: e.pointerId,
        };
        updateCursor(e);
      }}
      onPointerMove={(e) => {
        const active = interaction.current;
        if (!active || active.pointerId !== e.pointerId) {
          updateCursor(e);
          return;
        }
        if (!active.moved && Math.abs(e.clientX - active.startX) <= 3) return;
        active.moved = true;
        const next = updateLoopRegionFromInteraction({
          mode: active.mode,
          region: active.region,
          anchorTime: active.anchorTime,
          currentTime: eventTime(e),
          maxTime,
          snapTime: (time) => onSnapTime(time, e.altKey),
        });
        if (next || active.mode === 'create') onChange(next, active.mode === 'create' ? true : undefined);
        updateCursor(e);
      }}
      onPointerUp={(e) => finishInteraction(e, true)}
      onPointerCancel={(e) => finishInteraction(e, false)}
      onLostPointerCapture={(e) => {
        if (interaction.current?.pointerId === e.pointerId) interaction.current = null;
      }}
    >
      {region && (
        <div
          aria-hidden="true"
          data-testid="loop-ruler-region"
          className={`pointer-events-none absolute inset-y-0 border-x ${enabled ? 'border-[#8bd5a7] bg-[#8bd5a7]/25' : 'border-[#aab0b6]/70 bg-[#aab0b6]/15'}`}
          style={{ left: region.start * pxPerSec, width: (region.end - region.start) * pxPerSec }}
        >
          <span className={`absolute left-1 top-0.5 text-[9px] ${enabled ? 'text-[#b8f4cd]' : 'text-[#c7ccd1]'}`}>循环</span>
          <span data-testid="loop-ruler-start-handle" className="absolute inset-y-0 -left-1 w-2 bg-[#8bd5a7]/70" />
          <span data-testid="loop-ruler-end-handle" className="absolute inset-y-0 -right-1 w-2 bg-[#8bd5a7]/70" />
        </div>
      )}
    </div>
  );
}

// React Router keeps the same route element alive when only projectId changes.
// A keyed content instance runs the old project's cleanup and keeps its recording
// refs and async continuations isolated from the next project.
export default function AudioEditorPage() {
  const { projectId } = useParams<{ projectId: string }>();
  return <AudioEditorPageContent key={projectId ?? ''} />;
}

function TimeRuler({ duration, pxPerSec }: { duration: number; pxPerSec: number }) {
  const totalWidth = Math.max(duration * pxPerSec, 1000);
  const markers: number[] = [];

  // Calculate suitable interval
  let interval = 1;
  const pixelsPerSecond = pxPerSec;
  if (pixelsPerSecond < 10) interval = 10;
  else if (pixelsPerSecond < 30) interval = 5;
  else if (pixelsPerSecond < 100) interval = 1;
  else if (pixelsPerSecond < 200) interval = 0.5;
  else interval = 0.25;

  for (let t = 0; t <= duration + 10; t += interval) {
    markers.push(t);
  }

  return (
    <div className="relative h-full w-full" style={{ width: totalWidth }}>
      {markers.map((t) => {
        const isMajor = Number.isInteger(t) && (t % 10 === 0 || interval >= 1);
        return (
          <div
            key={t}
            className="absolute top-0 h-full"
            style={{ left: t * pxPerSec }}
          >
            <div
              className={`absolute left-0 bottom-0 ${
                isMajor ? 'h-3 w-px bg-foreground/50' : 'h-1.5 w-px bg-foreground/20'
              }`}
            />
            {isMajor && (
              <span className="absolute left-1 top-0.5 text-[10px] tabular-nums text-muted-foreground">
                {formatRulerTime(t, interval)}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
