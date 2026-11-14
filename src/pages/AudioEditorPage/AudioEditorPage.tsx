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
  Magnet,
  Repeat,
} from 'lucide-react';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
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
import { projectService, type EchoTrackAudio, type RepairTrackAudio } from '@/services/projectService';
import { historyManager } from '@/services/historyService';
import {
  parseAudioClipboard,
  planClipboardPasteTrackIndices,
  serializeAudioClipboard,
  type AudioClipboardData,
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
import {
  createEchoState,
  getEchoClipSampleRange,
  getEchoPlan,
  processEchoSelection,
} from '@/lib/echoEffect';
import { processDelayChannels, type DelaySettings } from '@/lib/delayEffect';
import { processClipFixChannels, type ClipFixSettings } from '@/lib/clipFixEffect';
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
  removeWorkspace,
  resetWorkspace,
  saveWorkspaceStore,
  updateWorkspaceLayout,
  type WorkspaceLayout,
  type WorkspaceStore,
} from '@/services/workspaceService';
import type { IProject, ITrack, IClip, IEffect, ViewMode, EffectType, SnapMode } from '@/types/project';
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
import EchoEffectDialog from './sections/EchoEffectDialog';
import DelayEffectDialog from './sections/DelayEffectDialog';
import ClipFixDialog from './sections/ClipFixDialog';
import AdjustableFadeDialog from './sections/AdjustableFadeDialog';
import BassTrebleDialog from './sections/BassTrebleDialog';
import ReverbDialog from './sections/ReverbDialog';
import DistortionDialog from './sections/DistortionDialog';
import ClickRemovalDialog from './sections/ClickRemovalDialog';
import NoiseReductionDialog from './sections/NoiseReductionDialog';
import TruncateSilenceDialog from './sections/TruncateSilenceDialog';
import CompressorDialog from './sections/CompressorDialog';
import LimiterDialog, { type LimiterPreview } from './sections/LimiterDialog';
import { AmplifyDialog } from './sections/AmplifyDialog';
import { NormalizeDialog } from './sections/NormalizeDialog';
import { LoudnessDialog } from './sections/LoudnessDialog';
import { FilterCurveEqDialog } from './sections/FilterCurveEqDialog';
import { GraphicEqDialog } from './sections/GraphicEqDialog';
import { ChangeTempoDialog } from './sections/ChangeTempoDialog';
import { ChangeSpeedDialog } from './sections/ChangeSpeedDialog';
import { ChangePitchDialog } from './sections/ChangePitchDialog';
import { PaulstretchDialog } from './sections/PaulstretchDialog';
import WahWahEffectDialog from './sections/WahWahEffectDialog';
import PhaserEffectDialog from './sections/PhaserEffectDialog';
import ClassicFilterEffectDialog from './sections/ClassicFilterEffectDialog';
import TremoloEffectDialog from './sections/TremoloEffectDialog';
import VocoderDialog from './sections/VocoderDialog';
import AutoDuckEffectDialog from './sections/AutoDuckEffectDialog';
import CrossfadeTracksDialog from './sections/CrossfadeTracksDialog';
import { updateProjectTempo, updateProjectTimeSignature } from '@/lib/musicalTiming';
import { Empty, EmptyContent, EmptyHeader, EmptyTitle, EmptyDescription, EmptyMedia } from '@/components/ui/empty';
import {
  decayDbfs,
  dbfsToMeterPercent,
  formatDbfs,
  MIN_METER_DBFS,
  silentStereoLevels,
  type StereoLevels,
} from '@/lib/levelMeter';

export default function AudioEditorPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();

  const [project, setProject] = useState<IProject | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [playbackState, setPlaybackState] = useState<PlaybackState>('stopped');
  const [recordingState, setRecordingState] = useState<RecordingState>('idle');
  const [cursorPosition, setCursorPosition] = useState(0);
  const [selection, setSelection] = useState<{ start: number; end: number } | null>(null);
  const [loopRegion, setLoopRegion] = useState<LoopRegion | null>(null);
  const [loopEnabled, setLoopEnabled] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('waveform');
  const [horizontalZoom, setHorizontalZoom] = useState(50);
  const [verticalZoom, setVerticalZoom] = useState(1);
  const [snapEnabled, setSnapEnabled] = useState(false);
  const [snapMode, setSnapMode] = useState<SnapMode>('clips');
  const [scrollX, setScrollX] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportFormat, setExportFormat] = useState('wav');
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [effectsPanelTrackId, setEffectsPanelTrackId] = useState<string | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [micPermissionState, setMicPermissionState] = useState<'granted' | 'denied' | 'unknown'>('unknown');
  const [isDragging, setIsDragging] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [selectedClips, setSelectedClips] = useState<ClipKey[]>([]);
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const clipSelectionAnchorRef = useRef<ClipKey | null>(null);
  const [workspaceStore, setWorkspaceStore] = useState(loadWorkspaceStore);
  const initialWorkspace = workspaceStore.presets.find((preset) => preset.id === workspaceStore.activeId)
    ?? workspaceStore.presets[0];
  const [showTrackPanel, setShowTrackPanel] = useState(initialWorkspace.layout.showTrackPanel);
  const [showMixer, setShowMixer] = useState(initialWorkspace.layout.showMixer);
  const [showClipping, setShowClipping] = useState(initialWorkspace.layout.showClipping);
  const [workspaceDialogOpen, setWorkspaceDialogOpen] = useState(false);
  const [workspaceName, setWorkspaceName] = useState('');
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
  const [adjustableFadeDialogOpen, setAdjustableFadeDialogOpen] = useState(false);
  const [isApplyingAdjustableFade, setIsApplyingAdjustableFade] = useState(false);
  const [isApplyingInvert, setIsApplyingInvert] = useState(false);
  const [wahWahDialogOpen, setWahWahDialogOpen] = useState(false);
  const [isApplyingWahWah, setIsApplyingWahWah] = useState(false);
  const [phaserDialogOpen, setPhaserDialogOpen] = useState(false);
  const [isApplyingPhaser, setIsApplyingPhaser] = useState(false);
  const [classicFilterDialogOpen, setClassicFilterDialogOpen] = useState(false);
  const [isApplyingClassicFilter, setIsApplyingClassicFilter] = useState(false);
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
  const [paulstretchDialogOpen, setPaulstretchDialogOpen] = useState(false);
  const [isApplyingPaulstretch, setIsApplyingPaulstretch] = useState(false);
  const [crossfadeDialogOpen, setCrossfadeDialogOpen] = useState(false);
  const [isApplyingCrossfade, setIsApplyingCrossfade] = useState(false);
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

  const timelineRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isPlayingRef = useRef(false);
  const recordingSampleRateRef = useRef(44100);
  const workspaceHydratedRef = useRef(false);
  const workspaceStorageWarningShownRef = useRef(false);
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
    viewMode,
    horizontalZoom,
    verticalZoom,
  }), [showTrackPanel, showMixer, showClipping, viewMode, horizontalZoom, verticalZoom]);

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

  // Load project
  useEffect(() => {
    if (!projectId) return;
    loadProject(projectId);
    checkMicPermission();
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

  useEffect(() => {
    const handleKeyboard = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches('input, textarea, [contenteditable="true"]')) return;
      const key = event.key.toLowerCase();
      const modified = event.ctrlKey || event.metaKey;
      if (modified && key === 'i') {
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

  async function loadProject(id: string) {
    setIsLoading(true);
    try {
      const proj = await projectService.openProject(id);
      if (proj) {
        setProject(proj);
        const workspace = workspaceStore.presets.find((preset) => preset.id === workspaceStore.activeId)
          ?? workspaceStore.presets[0];
        setViewMode(workspace.layout.viewMode);
        setHorizontalZoom(normalizeHorizontalZoom(workspace.layout.horizontalZoom));
        setVerticalZoom(normalizeVerticalZoom(workspace.layout.verticalZoom));
        setSnapEnabled(proj.viewState.snapEnabled ?? false);
        setSnapMode(proj.viewState.snapMode ?? 'clips');
        setShowTrackPanel(workspace.layout.showTrackPanel);
        setShowMixer(workspace.layout.showMixer);
        setShowClipping(workspace.layout.showClipping);
        setScrollX(proj.viewState.scrollX);
        setSelection(proj.selection);
        const restoredLoop = normalizeLoopRegion(proj.loopRegion);
        setLoopRegion(restoredLoop);
        setLoopEnabled(restoredLoop ? (proj.loopEnabled ?? false) : false);
        setSelectedClips([]);
        setSelectedTrackId(proj.tracks[0]?.id ?? null);
        // 加载历史快照（IndexedDB 持久化的撤销/重做栈）
        const snapCount = await historyManager.loadForProject(id);
        updateHistoryState();
        if (snapCount > 0) {
          logger.info(`已恢复 ${snapCount} 步历史记录`);
        }
      } else {
        toast.error('工程不存在');
        navigate('/');
      }
    } catch (e) {
      toast.error('加载工程失败');
    } finally {
      setIsLoading(false);
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
        selection,
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

  function handleStop() {
    audioEngine.stopPlayback();
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
  async function handleRecord() {
    if (!project) return;

    if (recordingState === 'recording') {
      try {
        const data = await audioEngine.stopRecording();
        if (!data || data.length === 0 || data[0].length === 0) {
          toast.warning('未采集到音频，请检查麦克风输入');
          return;
        }

        const targetTrack = project.tracks.find((t) => t.armed) ?? project.tracks[0];
        if (!targetTrack) {
          toast.warning('没有可用于录音的轨道');
          return;
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
        if (updated) {
          setProject(updated);
          pushHistoryCmd({
            id: generateId(),
            label: '录音',
            execute: () => updated,
            undo: () => before,
          });
        }
        toast.success(`录音已添加到「${targetTrack.name}」`);
      } catch (error) {
        logger.error('保存录音失败:', String(error));
        toast.error('录音保存失败');
      } finally {
        setRecordingState('idle');
      }
      return;
    }

    try {
      await audioEngine.ensureContext();
      await audioEngine.startRecording();
      recordingSampleRateRef.current = audioEngine.getSampleRate();
      setRecordingState('recording');
      toast.info(`正在录音（${audioEngine.getRecordingMode()}）…`);
      setMicPermissionState('granted');
    } catch (e) {
      setRecordingState('idle');
      toast.error('无法访问麦克风，请检查权限设置');
      setMicPermissionState('denied');
    }
  }

  // Track operations
  async function addTrack() {
    if (!project) return;
    const before = project;
    const newTrack = await projectService.addTrack(project.id);
    if (newTrack) {
      const updated = await projectService.getProject(project.id);
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
  }

  async function deleteTrack(trackId: string) {
    if (!project || project.tracks.length <= 1) {
      toast.warning('至少需要保留一条轨道');
      return;
    }
    const before = project;
    await projectService.removeTrack(project.id, trackId);
    const updated = await projectService.getProject(project.id);
    if (updated) {
      setProject(updated);
      pushHistoryCmd({
        id: generateId(),
        label: '删除轨道',
        execute: () => updated,
        undo: () => before,
      });
    }
  }

  async function convertStereoTracksToMono() {
    if (!project) return;
    const before = project;
    try {
      const targets: EchoTrackAudio[] = [];
      for (const track of project.tracks) {
        const clips = [];
        let hasStereo = false;
        for (const clip of track.clips) {
          const effective = await loadEffectiveClipChannels(clip, project.sampleRate);
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
      if (targets.length === 0) {
        toast.warning('当前没有立体声轨道');
        return;
      }
      await projectService.stereoToMonoOnTracks(project.id, targets);
      const updated = await projectService.getProject(project.id);
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
      logger.error('Stereo To Mono failed', error);
      toast.error(error instanceof Error ? error.message : '立体声转单声道失败');
    }
  }

  async function splitStereoTracksToMono() {
    if (!project) return;
    const before = project;
    try {
      const targets: EchoTrackAudio[] = [];
      for (const track of project.tracks) {
        const clips = [];
        let hasStereo = false;
        for (const clip of track.clips) {
          const effective = await loadEffectiveClipChannels(clip, project.sampleRate);
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
      if (targets.length === 0) {
        toast.warning('当前没有立体声轨道');
        return;
      }
      await projectService.splitStereoToMonoTracks(project.id, targets);
      const updated = await projectService.getProject(project.id);
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
      logger.error('Split Stereo To Mono failed', error);
      toast.error(error instanceof Error ? error.message : '立体声拆分失败');
    }
  }

  async function updateTrack(trackId: string, updates: Partial<ITrack>) {
    if (!project) return;
    await projectService.updateTrack(project.id, trackId, updates);
    const updated = {
      ...project,
      tracks: project.tracks.map((t) => (t.id === trackId ? { ...t, ...updates } : t)),
    };
    setProject(updated);
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

  async function commitClipEdit(updated: IProject, label: string) {
    if (!project || updated === project) return;
    const before = project;
    setProject(updated);
    await projectService.saveProject(updated);
    pushHistoryCmd({
      id: generateId(),
      label,
      execute: () => updated,
      undo: () => before,
    });
  }

  async function handleTempoChange(value: number) {
    if (!project || playbackState !== 'stopped' || recordingState === 'recording') return;
    await commitClipEdit(updateProjectTempo(project, value), '调整 BPM');
  }

  async function handleTimeSignatureChange(numerator: number, denominator: number) {
    if (!project) return;
    await commitClipEdit(updateProjectTimeSignature(project, numerator, denominator), '调整拍号');
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
      trimClipSelection(project, keys, edge, delta),
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
      stretchClipSelection(project, keys, edge, delta),
      keys.length > 1 ? '成组拉伸片段' : '时间拉伸片段',
    );
  }

  async function handleClipMove(trackId: string, clipId: string, deltaSeconds: number, bypassSnap = false) {
    if (!project) return;
    const keys = keysForClip(trackId, clipId);
    const delta = resolveClipSnapDelta(trackId, clipId, 'move', deltaSeconds, bypassSnap);
    if (Math.abs(delta) < 0.001) return;
    await commitClipEdit(
      moveClipSelection(project, keys, delta),
      keys.length > 1 ? '成组移动片段' : '移动片段',
    );
  }

  async function handleClipReset(trackId: string, clipId: string) {
    if (!project) return;
    await commitClipEdit(resetClipStretch(project, keysForClip(trackId, clipId)), '恢复片段速度 100%');
  }

  async function handleDeleteSelectedClips() {
    if (!project || selectedClips.length === 0) return;
    await commitClipEdit(deleteClipSelection(project, selectedClips), `删除 ${selectedClips.length} 个片段`);
    setSelectedClips([]);
  }

  async function splitClipsAtCursor() {
    if (!project) return;
    const keys = selectedClips.length > 0
      ? selectedClips
      : project.tracks
        .filter((track) => track.id === selectedTrackId)
        .flatMap((track) => track.clips.map((clip) => ({ trackId: track.id, clipId: clip.id })));
    const result = splitClipSelectionAtTime(project, keys, cursorPosition, generateId);
    if (!result.didSplit) {
      toast.info('请将播放光标放在选中片段内部');
      return;
    }
    await commitClipEdit(result.project, '在光标处分割片段');
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

  function applyWorkspaceLayout(layout: WorkspaceLayout) {
    setShowTrackPanel(layout.showTrackPanel);
    setShowMixer(layout.showMixer);
    setShowClipping(layout.showClipping);
    setViewMode(layout.viewMode);
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

  function deleteActiveWorkspace() {
    const updated = removeWorkspace(workspaceStore, workspaceStore.activeId);
    setWorkspaceStore(updated);
    persistWorkspaceStore(updated);
    const preset = updated.presets.find((candidate) => candidate.id === updated.activeId);
    if (preset) applyWorkspaceLayout(preset.layout);
    toast.info('已删除自定义 Workspace');
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
      if (clips.length !== trackIds.length) throw new Error('目标轨道不可用');

      const updated = await projectService.getProject(project.id);
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
      if (clips.length !== trackIds.length) throw new Error('目标轨道不可用');

      const updated = await projectService.getProject(project.id);
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
      if (clips.length !== trackIds.length) throw new Error('目标轨道不可用');

      const updated = await projectService.getProject(project.id);
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
      if (clips.length !== trackIds.length) throw new Error('目标轨道不可用');

      const updated = await projectService.getProject(project.id);
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
      if (clips.length !== trackIds.length) throw new Error('目标轨道不可用');

      const updated = await projectService.getProject(project.id);
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
      if (clips.length !== trackIds.length) throw new Error('目标轨道不可用');

      const updated = await projectService.getProject(project.id);
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
      if (clips.length !== trackIds.length) throw new Error('目标轨道不可用');

      const updated = await projectService.getProject(project.id);
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
    setIsGeneratingSilence(true);
    try {
      if (activeSelection) {
        const changedClips = await projectService.silenceSelectionOnTracks(
          project.id,
          trackIds,
          activeSelection,
        );
        if (changedClips === 0) throw new Error('所选轨道的选区未覆盖任何可用音频');

        const updated = await projectService.getProject(project.id);
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
      if (clips.length !== trackIds.length) throw new Error('目标轨道不可用');

      const updated = await projectService.getProject(project.id);
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
      const message = error instanceof Error ? error.message : '未知错误';
      toast.error(`生成静默失败：${message}`);
    } finally {
      setIsGeneratingSilence(false);
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

      // Trigger download
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);

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
    setSelectedClips((current) => current.filter((key) => validClipKeys.has(clipKeyId(key))));
    setSelectedTrackId((current) => current && validTrackIds.has(current)
      ? current
      : restoredProject.tracks[0]?.id ?? null);
    setEffectsPanelTrackId((current) => current && !validTrackIds.has(current) ? null : current);
  }

  async function handleUndo() {
    if (!project) return;
    const result = historyManager.undo(project);
    if (result) {
      applyHistoryProject(result.project);
      await projectService.saveProject(result.project);
      await historyManager.flush();
      toast.info(`撤销：${result.command.label}`);
      updateHistoryState();
    }
  }

  async function handleRedo() {
    if (!project) return;
    const result = historyManager.redo(project);
    if (result) {
      applyHistoryProject(result.project);
      await projectService.saveProject(result.project);
      await historyManager.flush();
      toast.info(`重做：${result.command.label}`);
      updateHistoryState();
    }
  }

  // Clipboard operations
  async function storeSelectionInClipboard(proj: IProject, start: number, end: number): Promise<boolean> {
    const clipboardData = await copySelection(proj, start, end);
    if (!clipboardData || clipboardData.tracks.length === 0) return false;
    await audioDb.clipboard.put({
      id: 'current',
      data: serializeAudioClipboard(clipboardData),
      createdAt: Date.now(),
    });
    return true;
  }

  async function handleCut() {
    if (!project || !selection) return;
    try {
      if (!await storeSelectionInClipboard(project, selection.start, selection.end)) {
        toast.info('选区内没有可剪切的音频');
        return;
      }
      const before = JSON.parse(JSON.stringify(project)) as IProject;
      const result = await cutSelection(project, selection.start, selection.end);
      if (result) {
        setProject(result);
        await projectService.saveProject(result);
        pushHistoryCmd({
          id: generateId(),
          label: '剪切',
          execute: () => result,
          undo: () => before,
        });
        updateHistoryState();
        setSelection(null);
        toast.success('已剪切到剪贴板');
      }
    } catch (error) {
      logger.error('剪切失败:', String(error));
      toast.error('剪切失败');
    }
  }

  async function handleCopy() {
    if (!project || !selection) return;
    try {
      if (await storeSelectionInClipboard(project, selection.start, selection.end)) {
        toast.success('已复制到剪贴板');
      } else {
        toast.info('选区内没有可复制的音频');
      }
    } catch (error) {
      logger.error('复制失败:', String(error));
      toast.error('复制失败');
    }
  }

  async function handlePaste() {
    if (!project) return;
    try {
      
      const entry = await audioDb.clipboard.get('current');
      if (!entry) {
        toast.info('剪贴板为空');
        return;
      }
      const before = JSON.parse(JSON.stringify(project)) as IProject;
      const clipboardData = parseAudioClipboard(entry.data);
      const result = await pasteAtCursor(project, clipboardData, cursorPosition);
      if (result) {
        setProject(result);
        projectService.saveProject(result);
        pushHistoryCmd({
          id: generateId(),
          label: '粘贴',
          execute: () => result,
          undo: () => before,
        });
        updateHistoryState();
        toast.success('已粘贴');
      }
    } catch {
      toast.error('粘贴失败');
    }
  }

  async function handleTrim() {
    if (!project || !selection) return;
    const before = JSON.parse(JSON.stringify(project)) as IProject;
    const result = await trimToSelection(project, selection.start, selection.end);
    if (result) {
      setProject(result);
      projectService.saveProject(result);
      pushHistoryCmd({
        id: generateId(),
        label: '裁剪',
        execute: () => result,
        undo: () => before,
      });
      updateHistoryState();
      toast.success('已裁剪');
    }
  }

  // Effect operations
  async function handleRepeatSelection(repeatCount: number) {
    if (!project || !quantizedGeneratorSelection) return;
    setIsRepeating(true);
    try {
      const activeSelection = quantizedGeneratorSelection;
      const copied = await copySelection(project, activeSelection.start, activeSelection.end);
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
      const updated = await projectService.getProject(project.id);
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
      logger.error('重复选区失败:', String(error));
      toast.error(error instanceof Error ? `重复选区失败：${error.message}` : '重复选区失败');
    } finally {
      setIsRepeating(false);
    }
  }

  async function handleDuplicateSelection() {
    if (!project || !quantizedGeneratorSelection) return;
    const activeSelection = quantizedGeneratorSelection;
    try {
      const copied = await copySelection(project, activeSelection.start, activeSelection.end);
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
      const updated = await projectService.getProject(project.id);
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
      logger.error('Duplicate 选区失败:', String(error));
      toast.error(error instanceof Error ? `Duplicate 失败：${error.message}` : 'Duplicate 失败');
    }
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
    try {
      const targets = await collectEffectTargets(activeSelection);
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
      const updated = await projectService.getProject(project.id);
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
      logger.error('Crossfade 失败:', String(error));
      toast.error(error instanceof Error ? `Crossfade 失败：${error.message}` : 'Crossfade 失败');
    } finally {
      setIsApplyingCrossfade(false);
    }
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
    setIsApplyingEcho(true);
    try {
      const activeSelection = quantizedGeneratorSelection;
      const targets = await collectEffectTargets(activeSelection);
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
      const updated = await projectService.getProject(project.id);
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
    setIsApplyingDelay(true);
    try {
      const activeSelection = quantizedGeneratorSelection;
      const targets = await collectEffectTargets(activeSelection);
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
      const updated = await projectService.getProject(project.id);
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
    setIsApplyingClipFix(true);
    try {
      const activeSelection = quantizedGeneratorSelection;
      const targets = await collectEffectTargets(activeSelection);
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
      const updated = await projectService.getProject(project.id);
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
      logger.error('应用 Clip Fix 失败:', String(error));
      toast.error(error instanceof Error ? `应用 Clip Fix 失败：${error.message}` : '应用 Clip Fix 失败');
    } finally {
      setIsApplyingClipFix(false);
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

  async function handleAdjustableFadePreview(fadeSettings: AdjustableFadeSettings): Promise<Float32Array[]> {
    if (!project || !quantizedGeneratorSelection) throw new Error('请先选择要试听的音频');
    const selected = await collectPreviewChannels(quantizedGeneratorSelection);
    return processAdjustableFadeChannels(selected, fadeSettings);
  }

  async function handleApplyAdjustableFade(fadeSettings: AdjustableFadeSettings) {
    if (!project || !quantizedGeneratorSelection) return;
    setIsApplyingAdjustableFade(true);
    try {
      const activeSelection = quantizedGeneratorSelection;
      const targets = await collectEffectTargets(activeSelection);
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
      const updated = await projectService.getProject(project.id);
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
      logger.error('应用 Adjustable Fade 失败:', String(error));
      toast.error(error instanceof Error ? `应用 Adjustable Fade 失败：${error.message}` : '应用 Adjustable Fade 失败');
    } finally {
      setIsApplyingAdjustableFade(false);
    }
  }

  async function handleApplyRepair() {
    if (!project || !quantizedGeneratorSelection) return;
    setIsApplyingRepair(true);
    try {
      const activeSelection = quantizedGeneratorSelection;
      const targets = await collectFullTrackTargets(activeSelection);
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
      const updated = await projectService.getProject(project.id);
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
      const changed = await projectService.clickRemovalSelectionOnTracks(
        project.id,
        activeSelection,
        settings,
        targets,
      );
      if (changed === 0) {
        toast.info('Click Removal 参数为 0，已按官方行为跳过，未修改音频');
        return;
      }
      const updated = await projectService.getProject(project.id);
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

  // Effect operations
  async function addEffect(trackId: string, type: EffectType) {
    if (!project) return;
    const before = JSON.parse(JSON.stringify(project)) as IProject;
    const effect = await projectService.addEffectToTrack(project.id, trackId, type);
    if (effect) {
      const updated = await projectService.getProject(project.id);
      if (updated) {
        setProject(updated);
        pushHistoryCmd({
          id: generateId(),
          label: `添加${getEffectLabel(type)}`,
          execute: () => updated,
          undo: () => before,
    });
  }
    }
  }

  async function updateEffectParams(trackId: string, effectId: string, params: Record<string, number>) {
    if (!project) return;
    await projectService.updateEffect(project.id, trackId, effectId, { params });
    const updated = await projectService.getProject(project.id);
    if (updated) setProject(updated);
  }

  async function toggleEffectBypass(trackId: string, effectId: string) {
    if (!project) return;
    const track = project.tracks.find((t) => t.id === trackId);
    const effect = track?.effects.find((e) => e.id === effectId);
    if (!effect) return;
    await projectService.updateEffect(project.id, trackId, effectId, { bypassed: !effect.bypassed });
    const updated = await projectService.getProject(project.id);
    if (updated) setProject(updated);
  }

  async function removeEffect(trackId: string, effectId: string) {
    if (!project) return;
    const before = JSON.parse(JSON.stringify(project)) as IProject;
    await projectService.removeEffectFromTrack(project.id, trackId, effectId);
    const updated = await projectService.getProject(project.id);
    if (updated) {
      setProject(updated);
      pushHistoryCmd({
        id: generateId(),
        label: '移除效果',
        execute: () => updated,
        undo: () => before,
    });
  }
  }

  // Selection handling from canvas
  function handleSelectionChange(start: number, end: number) {
    if (start === end) {
      setSelection(null);
    } else {
      setSelection({ start: Math.min(start, end), end: Math.max(start, end) });
    }
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
  function getProjectDuration(): number {
    if (!project) return 0;
    let maxEnd = 0;
    for (const track of project.tracks) {
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
  async function cutSelection(
    proj: IProject,
    start: number,
    end: number,
  ): Promise<IProject | null> {
    // Copy first, then delete region
    const copied = await copySelection(proj, start, end);
    if (!copied) return null;

    // Store in clipboard
    try {
      
      await audioDb.clipboard.put({
        id: 'current',
        data: serializeAudioClipboard(copied),
        createdAt: Date.now(),
      });
    } catch {}

    return deleteRegion(proj, start, end);
  }

  async function storeProjectBuffer(
    projectId: string,
    channels: Float32Array[],
    sampleRate: number,
  ): Promise<string> {
    if (channels.length === 0 || channels[0].length === 0) throw new Error('Cannot store an empty audio buffer');
    const length = channels[0].length;
    if (channels.some((channel) => channel.length !== length)) {
      throw new Error('Audio channels must have equal lengths');
    }
    const bufferId = generateId();
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

  async function loadEffectiveClipChannels(clip: IClip, sampleRate: number): Promise<{
    channels: Float32Array[];
    sourceOffset: number;
  } | null> {
    const source = await projectService.loadAudioChannels(clip.audioBufferId);
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
  ): Promise<AudioClipboardData | null> {
    const duration = end - start;
    if (duration <= 0) return null;

    const result: AudioClipboardData['tracks'] = [];
    const sampleRate = proj.sampleRate;
    const totalSamples = Math.max(1, Math.ceil(duration * sampleRate));

    for (const track of proj.tracks) {
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
  ): Promise<IProject | null> {
    if (clipboardData.tracks.length === 0) return null;

    const updated = JSON.parse(JSON.stringify(proj)) as IProject;
    const destinationIndices = planClipboardPasteTrackIndices(
      updated.tracks.map((track) => track.id),
      selectedTrackId,
      clipboardData.tracks.length,
    );

    // Paste into the selected track and following tracks, creating only the
    // additional tracks needed to preserve every clipboard source track.
    for (let i = 0; i < clipboardData.tracks.length; i++) {
      const trackClip = clipboardData.tracks[i];
      const destinationIndex = destinationIndices[i]!;
      let targetTrack = destinationIndex >= 0 ? updated.tracks[destinationIndex] : undefined;

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

      targetTrack.clips.push(newClip);
      targetTrack.clips.sort((a, b) => a.startTime - b.startTime);
    }

    return updated;
  }

  async function deleteRegion(
    proj: IProject,
    start: number,
    end: number,
  ): Promise<IProject | null> {
    const updated = JSON.parse(JSON.stringify(proj)) as IProject;
    const duration = end - start;
    if (duration <= 0) return null;

    for (const track of updated.tracks) {
      const newClips: IClip[] = [];
      for (const clip of track.clips) {
        const clipEnd = clip.startTime + clip.duration;

        // Clip completely outside region
        if (clipEnd <= start || clip.startTime >= end) {
          newClips.push(clip);
          continue;
        }

        // Clip fully inside region - remove
        if (clip.startTime >= start && clipEnd <= end) {
          continue;
        }

        // Clip overlaps region - split or truncate
        const effective = await loadEffectiveClipChannels(clip, proj.sampleRate);
        if (!effective) {
          newClips.push(clip);
          continue;
        }
        const clipChannels = effective.channels;

        // Left part (before start)
        if (clip.startTime < start) {
          const leftDuration = start - clip.startTime;
          const leftSamples = Math.floor(leftDuration * proj.sampleRate);
          const leftStartSample = Math.floor(effective.sourceOffset * proj.sampleRate);
          const leftChannels = clipChannels.map((channel) =>
            wasmProcessor.sliceBuffer(channel, leftStartSample, leftStartSample + leftSamples),
          );
          const leftBufferId = await storeProjectBuffer(proj.id, leftChannels, proj.sampleRate);

          newClips.push({
            ...clip,
            id: generateId(),
            audioBufferId: leftBufferId,
            duration: leftDuration,
            originalDuration: leftDuration,
            stretchRatio: 1,
            offset: 0,
            fadeOut: 0, // reset fades for simplicity
          });
        }

        // Right part (after end) - shift left by duration
        if (clipEnd > end) {
          const rightOffsetInClip = end - clip.startTime + effective.sourceOffset;
          const rightStartSample = Math.floor(rightOffsetInClip * proj.sampleRate);
          const rightChannels = clipChannels.map((channel) =>
            wasmProcessor.sliceBuffer(channel, rightStartSample, channel.length),
          );
          const rightDuration = rightChannels[0].length / proj.sampleRate;
          const rightBufferId = await storeProjectBuffer(proj.id, rightChannels, proj.sampleRate);

          newClips.push({
            ...clip,
            id: generateId(),
            audioBufferId: rightBufferId,
            startTime: start, // shifted left
            offset: 0,
            duration: rightDuration,
            originalDuration: rightDuration,
            stretchRatio: 1,
            fadeIn: 0,
          });
        }
      }

      // Shift clips after the deleted region leftward
      for (const clip of newClips) {
        if (clip.startTime >= end) {
          clip.startTime -= duration;
        }
      }

      track.clips = newClips.sort((a, b) => a.startTime - b.startTime);
    }

    return updated;
  }

  async function trimToSelection(
    proj: IProject,
    start: number,
    end: number,
  ): Promise<IProject | null> {
    // Delete everything before start and after end
    let result = proj;
    // Delete after end first (doesn't affect start position)
    if (end < getProjectDuration()) {
      const after = await deleteRegion(result, end, getProjectDuration());
      if (after) result = after;
    }
    // Delete before start
    if (start > 0) {
      const before = await deleteRegion(result, 0, start);
      if (before) result = before;
      // Adjust cursor to start of trimmed project
      setCursorPosition(0);
    }
    return result;
  }

  // Apply gain effect to selection
  async function applyGainToSelection(gainDb: number) {
    if (!project || !selection) return;
    const before = JSON.parse(JSON.stringify(project)) as IProject;

    const updated = JSON.parse(JSON.stringify(project)) as IProject;
    const gainLin = dbToGain(gainDb);

    for (const track of updated.tracks) {
      for (const clip of track.clips) {
        const clipEnd = clip.startTime + clip.duration;
        if (clipEnd <= selection.start || clip.startTime >= selection.end) continue;

        const effective = await loadEffectiveClipChannels(clip, project.sampleRate);
        if (!effective) continue;
        const clipChannels = effective.channels;

        // Make a mutable copy of every channel.
        const dataCopies = clipChannels.map((channel) => new Float32Array(channel));

        const overlapStart = Math.max(clip.startTime, selection.start);
        const overlapEnd = Math.min(clipEnd, selection.end);

        const offsetInClip = overlapStart - clip.startTime + effective.sourceOffset;
        const startSample = Math.floor(offsetInClip * project.sampleRate);
        const endSample = Math.floor((offsetInClip + (overlapEnd - overlapStart)) * project.sampleRate);

        // Apply one linear gain to every channel.
        for (const dataCopy of dataCopies) {
          for (let i = startSample; i < endSample && i < dataCopy.length; i++) {
            dataCopy[i] *= gainLin;
          }
        }

        // Store modified buffer
        const newBufferId = await storeProjectBuffer(project.id, dataCopies, project.sampleRate);

        clip.audioBufferId = newBufferId;
        clip.offset = effective.sourceOffset;
        clip.originalDuration = dataCopies[0].length / project.sampleRate;
        clip.stretchRatio = 1;
      }
    }

    setProject(updated);
    projectService.saveProject(updated);
    historyManager.push({
      id: generateId(),
      label: `增益 ${gainDb > 0 ? '+' : ''}${gainDb.toFixed(1)} dB`,
      execute: () => updated,
      undo: () => before,
    }, before);
    updateHistoryState();
    toast.success(`已应用增益 ${gainDb > 0 ? '+' : ''}${gainDb.toFixed(1)} dB`);
  }

  async function applyFadeToSelection(type: 'in' | 'out') {
    if (!project || !selection) return;
    const before = JSON.parse(JSON.stringify(project)) as IProject;

    const updated = JSON.parse(JSON.stringify(project)) as IProject;
    const fadeDuration = selection.end - selection.start;

    for (const track of updated.tracks) {
      for (const clip of track.clips) {
        const clipEnd = clip.startTime + clip.duration;
        if (clipEnd <= selection.start || clip.startTime >= selection.end) continue;

        const effective = await loadEffectiveClipChannels(clip, project.sampleRate);
        if (!effective) continue;
        const clipChannels = effective.channels;

        const dataCopies = clipChannels.map((channel) => new Float32Array(channel));

        const overlapStart = Math.max(clip.startTime, selection.start);
        const overlapEnd = Math.min(clipEnd, selection.end);

        const offsetInClip = overlapStart - clip.startTime + effective.sourceOffset;
        const startSample = Math.floor(offsetInClip * project.sampleRate);
        const endSample = Math.floor(
          (offsetInClip + (overlapEnd - overlapStart)) * project.sampleRate,
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

        const newBufferId = await storeProjectBuffer(project.id, dataCopies, project.sampleRate);

        clip.audioBufferId = newBufferId;
        clip.offset = effective.sourceOffset;
        clip.originalDuration = dataCopies[0].length / project.sampleRate;
        clip.stretchRatio = 1;
      }
    }

    setProject(updated);
    projectService.saveProject(updated);
    historyManager.push({
      id: generateId(),
      label: type === 'in' ? '淡入' : '淡出',
      execute: () => updated,
      undo: () => before,
    }, before);
    updateHistoryState();
    toast.success(type === 'in' ? '已应用淡入' : '已应用淡出');
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
    if (!project || !selection) return;
    const before = JSON.parse(JSON.stringify(project)) as IProject;

    const updated = JSON.parse(JSON.stringify(project)) as IProject;

    for (const track of updated.tracks) {
      for (const clip of track.clips) {
        const clipEnd = clip.startTime + clip.duration;
        if (clipEnd <= selection.start || clip.startTime >= selection.end) continue;

        const effective = await loadEffectiveClipChannels(clip, project.sampleRate);
        if (!effective) continue;
        const clipChannels = effective.channels;

        const dataCopies = clipChannels.map((channel) => new Float32Array(channel));

        const overlapStart = Math.max(clip.startTime, selection.start);
        const overlapEnd = Math.min(clipEnd, selection.end);

        const offsetInClip = overlapStart - clip.startTime + effective.sourceOffset;
        const startSample = Math.floor(offsetInClip * project.sampleRate);
        const endSample = Math.floor(
          (offsetInClip + (overlapEnd - overlapStart)) * project.sampleRate,
        );

        // Reverse the same time range independently in each channel.
        for (const dataCopy of dataCopies) {
          const segment = dataCopy.slice(startSample, endSample);
          segment.reverse();
          dataCopy.set(segment, startSample);
        }

        const newBufferId = await storeProjectBuffer(project.id, dataCopies, project.sampleRate);

        clip.audioBufferId = newBufferId;
        clip.offset = effective.sourceOffset;
        clip.originalDuration = dataCopies[0].length / project.sampleRate;
        clip.stretchRatio = 1;
      }
    }

    setProject(updated);
    projectService.saveProject(updated);
    historyManager.push({
      id: generateId(),
      label: '反转',
      execute: () => updated,
      undo: () => before,
    }, before);
    updateHistoryState();
    toast.success('已反转选区');
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

  function fitProjectToWidth() {
    const nextZoom = horizontalZoomForDuration(
      projectDuration,
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
  const activeWorkspace = workspaceStore.presets.find((preset) => preset.id === workspaceStore.activeId)
    ?? workspaceStore.presets[0];

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
              <DropdownMenuItem onClick={handleCut} disabled={!selection}>剪切</DropdownMenuItem>
              <DropdownMenuItem onClick={handleCopy} disabled={!selection}>复制</DropdownMenuItem>
              <DropdownMenuItem onClick={handlePaste}>粘贴</DropdownMenuItem>
              <DropdownMenuItem onClick={() => void splitClipsAtCursor()} disabled={!canSplitAtCursor}>在光标处分割 (Ctrl+I)</DropdownMenuItem>
              <DropdownMenuItem onClick={handleTrim} disabled={!selection}>裁剪到选区</DropdownMenuItem>
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
              <DropdownMenuItem onClick={() => setSelection(null)} disabled={!selection}>清除选区</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-6 px-2 text-xs">视图</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onClick={() => setViewMode('waveform')}>波形</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setViewMode('spectrum')}>频谱</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setViewMode('both')}>波形与频谱</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setShowClipping((visible) => !visible)}>
                {showClipping ? '隐藏' : '显示'}波形削波
              </DropdownMenuItem>
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
              <DropdownMenuItem onClick={fitProjectToWidth} disabled={projectDuration <= 0}>
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
              <DropdownMenuItem onClick={convertStereoTracksToMono}>Stereo To Mono 立体声转单声道</DropdownMenuItem>
              <DropdownMenuItem onClick={splitStereoTracksToMono}>Split Stereo To Mono 立体声拆分为单声道</DropdownMenuItem>
              <DropdownMenuItem onClick={handleRecord}>
                {recordingState === 'recording' ? '停止录音' : '开始录音'}
              </DropdownMenuItem>
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
          className="au-toolbar flex h-9 shrink-0 items-center justify-end gap-6 overflow-x-auto overflow-y-hidden border-b px-3"
        >
          <LevelMeter mode="recording" active={recordingState === 'recording'} />
          <LevelMeter mode="playback" active={playbackState === 'playing'} />
          <span className="shrink-0 text-[9px] text-[#7f8992]">-60 … 0 dBFS · 峰值</span>
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
              <DropdownMenuItem onClick={handleCut} disabled={!selection}>
                <Scissors className="mr-2 size-4" />
                剪切 (Ctrl+X)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleCopy} disabled={!selection}>
                <Copy className="mr-2 size-4" />
                复制 (Ctrl+C)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handlePaste}>
                <Clipboard className="mr-2 size-4" />
                粘贴 (Ctrl+V)
              </DropdownMenuItem>
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
                onClick={handleDuplicateSelection}
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
              <DropdownMenuItem onClick={applyReverse} disabled={!selection}>
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
                <Button
                  variant="ghost"
                  size="icon"
                  className="ml-1 size-5 hover:bg-[#84b5ff]/20"
                  onClick={() => setSelection(null)}
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
              {project.tracks.map((track) => (
                <TrackPanelRow
                  key={track.id}
                  track={track}
                  isSelected={selectedTrackId === track.id}
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
                  onOpenEffects={() => {
                    setSelectedTrackId(track.id);
                    setEffectsPanelTrackId(track.id);
                  }}
                />
              ))}
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
              style={{ width: totalWidth }}
            >
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

            {/* Playhead */}
            <div
              className="pointer-events-none absolute top-0 bottom-0 z-10 w-px bg-[#e4e5e7]"
              style={{ left: cursorPosition * pxPerSec }}
            >
              <div className="absolute -left-1 top-7 size-2 rotate-45 bg-[#e4e5e7]" />
            </div>

            {/* Selection overlay */}
            {selection && (
              <div
                className="au-selection pointer-events-none absolute top-7 bottom-0 z-[5]"
                style={{
                  left: selection.start * pxPerSec,
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
                  left: loopRegion.start * pxPerSec,
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
                viewMode={viewMode}
                scrollX={scrollX}
                verticalZoom={verticalZoom}
                showClipping={showClipping}
                isSelected={selectedTrackId === track.id}
                selectedClips={selectedClips}
                onSelectClip={(clipId, mode) => selectClip(track.id, clipId, mode)}
                onTrimClip={(clipId, edge, delta, bypassSnap) => handleClipEdgeTrim(track.id, clipId, edge, delta, bypassSnap)}
                onStretchClip={(clipId, edge, delta, bypassSnap) => handleClipStretch(track.id, clipId, edge, delta, bypassSnap)}
                onMoveClip={(clipId, delta, bypassSnap) => handleClipMove(track.id, clipId, delta, bypassSnap)}
                onResolveClipDelta={(clipId, operation, delta, bypassSnap) => resolveClipSnapDelta(track.id, clipId, operation, delta, bypassSnap)}
                onResetClip={(clipId) => handleClipReset(track.id, clipId)}
                onSelectionChange={handleSelectionChange}
                onCursorChange={handleCursorChange}
                onSnapTime={resolveTimelineSnap}
              />
            ))}

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
              onRemoveEffect={(effectId) =>
                removeEffect(effectsPanelTrackId, effectId)
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
                onClick={() => setSelection(null)}
                aria-label="清除选区时间"
                title="清除选区"
              >
                <X className="size-3.5" />
              </Button>
            )}
          </div>
        </div>

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
            {micPermissionState === 'denied' && <span className="text-destructive">麦克风无权限</span>}
            {micPermissionState === 'granted' && recordingState !== 'recording' && <span>麦克风可用</span>}
            <span>光标 {formatTime(cursorPosition)}</span>
            <span>缩放 {Math.round(pxPerSec)} px/s</span>
          </div>
        </div>

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
                  onChange={(event) => setWorkspaceName(event.target.value)}
                  maxLength={40}
                  placeholder="例如：播客剪辑"
                  autoFocus
                />
              </div>
              <DialogFooter>
                <Button type="button" variant="secondary" onClick={() => setWorkspaceDialogOpen(false)}>取消</Button>
                <Button type="submit" disabled={!workspaceName.trim()}>保存 Workspace</Button>
              </DialogFooter>
            </form>
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

        <RepeatSelectionDialog
          open={repeatDialogOpen}
          onOpenChange={setRepeatDialogOpen}
          selectionDuration={generatorSelectionDuration ?? 0}
          sampleRate={project.sampleRate}
          isRepeating={isRepeating}
          onRepeat={handleRepeatSelection}
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
  onSelect,
  onMute,
  onSolo,
  onArm,
  onGainChange,
  onPanChange,
  onRename,
  onDelete,
  onOpenEffects,
}: {
  track: ITrack;
  isSelected: boolean;
  onSelect: () => void;
  onMute: () => void;
  onSolo: () => void;
  onArm: () => void;
  onGainChange: (db: number) => void;
  onPanChange: (pan: number) => void;
  onRename: (name: string) => void;
  onDelete: () => void;
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
    <div
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
            className="au-secondary size-6 min-h-6 p-0 text-[10px]"
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
            className="au-secondary size-6 min-h-6 p-0 text-[10px]"
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
  );
}

function LevelMeter({ mode, active }: { mode: 'recording' | 'playback'; active: boolean }) {
  const [levels, setLevels] = useState<StereoLevels>(silentStereoLevels);
  const label = mode === 'recording' ? '录音' : '播放';

  useEffect(() => {
    if (!active) {
      setLevels(silentStereoLevels());
      return;
    }

    let frame = 0;
    let previousTime: number | null = null;
    let current = silentStereoLevels();
    const tick = (now: number) => {
      const elapsed = previousTime === null ? 1 / 60 : Math.min(0.1, Math.max(0, (now - previousTime) / 1000));
      previousTime = now;
      const instantaneous = mode === 'recording'
        ? audioEngine.getRecordingLevels()
        : audioEngine.getPlaybackLevels();
      current = {
        left: decayDbfs(current.left, instantaneous.left, elapsed),
        right: decayDbfs(current.right, instantaneous.right, elapsed),
      };
      setLevels(current);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [active, mode]);

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
                aria-valuemin={MIN_METER_DBFS}
                aria-valuemax={0}
                aria-valuenow={Number(value.toFixed(1))}
                aria-valuetext={`${formatDbfs(value)} dBFS`}
                className={`h-1.5 w-24 overflow-hidden rounded-[1px] bg-[#161b20] ${value >= -0.05 ? 'ring-1 ring-red-400' : ''}`}
              >
                <div
                  className="h-full bg-gradient-to-r from-emerald-500 via-yellow-400 to-red-500 transition-[width] duration-75"
                  style={{ width: `${dbfsToMeterPercent(value)}%` }}
                />
              </div>
              <span className="w-7 text-right font-mono">{formatDbfs(value)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
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
  viewMode,
  scrollX,
  verticalZoom,
  showClipping,
  isSelected,
  selectedClips,
  onSelectClip,
  onTrimClip,
  onStretchClip,
  onMoveClip,
  onResolveClipDelta,
  onResetClip,
  onSelectionChange,
  onCursorChange,
  onSnapTime,
}: {
  track: ITrack;
  trackIndex: number;
  projectId: string;
  sampleRate: number;
  pxPerSec: number;
  totalWidth: number;
  viewMode: ViewMode;
  scrollX: number;
  verticalZoom: number;
  showClipping: boolean;
  isSelected: boolean;
  selectedClips: ClipKey[];
  onSelectClip: (clipId: string, mode: ClipSelectionMode) => void;
  onTrimClip: (clipId: string, edge: 'left' | 'right', deltaSeconds: number, bypassSnap?: boolean) => void;
  onStretchClip: (clipId: string, edge: 'left' | 'right', deltaSeconds: number, bypassSnap?: boolean) => void;
  onMoveClip: (clipId: string, deltaSeconds: number, bypassSnap?: boolean) => void;
  onResolveClipDelta: (clipId: string, operation: ClipSnapOperation, deltaSeconds: number, bypassSnap: boolean) => number;
  onResetClip: (clipId: string) => void;
  onSelectionChange: (start: number, end: number) => void;
  onCursorChange: (pos: number) => void;
  onSnapTime: (time: number, bypassSnap: boolean) => number;
}) {
  const trackHeight = 100;
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState(0);

  function handleMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const rawPosition = clamp(x / pxPerSec, 0, totalWidth / pxPerSec);
    const pos = onSnapTime(rawPosition, e.altKey);
    setIsDragging(true);
    setDragStart(pos);
    onCursorChange(pos);
  }

  function handleMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    if (!isDragging) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const rawPosition = clamp(x / pxPerSec, 0, totalWidth / pxPerSec);
    const pos = onSnapTime(rawPosition, e.altKey);
    onSelectionChange(dragStart, pos);
  }

  function handleMouseUp() {
    setIsDragging(false);
  }

  return (
    <div
      className={`relative border-b border-border transition-colors ${
        isSelected ? 'bg-accent/5' : ''
      }`}
      style={{ height: trackHeight, width: totalWidth }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {/* Track background pattern */}
      <div
        className="pointer-events-none absolute inset-0 opacity-5"
        style={{
          backgroundImage:
            'repeating-linear-gradient(0deg, transparent, transparent 24px, currentColor 24px, currentColor 25px)',
        }}
      />

      {/* Clips */}
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
          viewMode={viewMode}
          isSelected={selectedClips.some((key) => key.trackId === track.id && key.clipId === clip.id)}
          hasMultipleSelections={selectedClips.length > 1}
          trackColor={track.color}
          onTrim={(edge, delta, bypassSnap) => onTrimClip(clip.id, edge, delta, bypassSnap)}
          onStretch={(edge, delta, bypassSnap) => onStretchClip(clip.id, edge, delta, bypassSnap)}
          onMove={(delta, bypassSnap) => onMoveClip(clip.id, delta, bypassSnap)}
          onResolveDelta={(operation, delta, bypassSnap) => onResolveClipDelta(clip.id, operation, delta, bypassSnap)}
          onReset={() => onResetClip(clip.id)}
          onSelect={(mode) => onSelectClip(clip.id, mode)}
        />
      ))}
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
  viewMode,
  isSelected,
  hasMultipleSelections,
  trackColor,
  onTrim,
  onStretch,
  onMove,
  onResolveDelta,
  onReset,
  onSelect,
}: {
  clip: IClip;
  track: ITrack;
  projectId: string;
  sampleRate: number;
  pxPerSec: number;
  trackHeight: number;
  verticalZoom: number;
  showClipping: boolean;
  viewMode: ViewMode;
  isSelected: boolean;
  hasMultipleSelections: boolean;
  trackColor: string;
  onTrim: (edge: 'left' | 'right', deltaSeconds: number, bypassSnap?: boolean) => void;
  onStretch: (edge: 'left' | 'right', deltaSeconds: number, bypassSnap?: boolean) => void;
  onMove: (deltaSeconds: number, bypassSnap?: boolean) => void;
  onResolveDelta: (operation: ClipSnapOperation, deltaSeconds: number, bypassSnap: boolean) => number;
  onReset: () => void;
  onSelect: (mode: ClipSelectionMode) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [audioData, setAudioData] = useState<Float32Array | null>(null);
  const [edgeDrag, setEdgeDrag] = useState<{
    edge: 'left' | 'right';
    mode: 'trim' | 'stretch';
    startX: number;
    delta: number;
  } | null>(null);
  const [moveDrag, setMoveDrag] = useState<{ startX: number; delta: number } | null>(null);
  const suppressClickRef = useRef(false);

  useEffect(() => {
    let mounted = true;
    async function load() {
      const data = await projectService.loadAudioBuffer(clip.audioBufferId);
      if (mounted && data) {
        setAudioData(data);
      }
    }
    load();
    return () => {
      mounted = false;
    };
  }, [clip.audioBufferId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !audioData) return;

    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.floor(clip.duration * pxPerSec));
    const height = trackHeight - 24;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    const stretchRatio = getClipStretchRatio(clip);

    // Draw waveform or spectrum based on view mode
    if (viewMode === 'waveform' || viewMode === 'both') {
      drawWaveform(ctx, audioData, width, height, '#20252a', clip, sampleRate, verticalZoom, viewMode === 'both' ? 0.8 : 1, showClipping);
    }

    if (viewMode === 'spectrum' || viewMode === 'both') {
      const sourceStart = Math.max(0, Math.floor(clip.offset * sampleRate));
      const sourceEnd = Math.min(
        audioData.length,
        Math.floor((clip.offset + clip.duration * stretchRatio) * sampleRate),
      );
      drawSpectrumMini(
        ctx,
        audioData.subarray(sourceStart, Math.max(sourceStart + 1, sourceEnd)),
        width,
        height,
        sampleRate,
        viewMode === 'both' ? 0.5 : 1,
      );
    }
  }, [audioData, pxPerSec, clip.duration, clip.offset, clip.stretchRatio, viewMode, trackColor, trackHeight, sampleRate, verticalZoom, showClipping]);

  const left = clip.startTime * pxPerSec;
  const width = clip.duration * pxPerSec;
  const edgeDelta = edgeDrag?.delta ?? 0;
  const moveDelta = moveDrag?.delta ?? 0;
  const displayLeft = left + (edgeDrag?.edge === 'left' ? edgeDelta * pxPerSec : 0) + moveDelta * pxPerSec;
  const displayWidth = Math.max(
    2,
    width + (edgeDrag?.edge === 'left' ? -edgeDelta : edgeDelta) * pxPerSec,
  );

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

  function handleSelection(e: React.MouseEvent<HTMLDivElement> | React.KeyboardEvent<HTMLDivElement>) {
    const mode: ClipSelectionMode = e.ctrlKey || e.metaKey
      ? 'toggle'
      : e.shiftKey ? 'range' : 'replace';
    // Audacity keeps a multi-clip selection intact when one selected clip is activated.
    if (mode === 'replace' && isSelected && hasMultipleSelections) return;
    onSelect(mode);
  }

  return (
    <div
      className="au-clip group absolute top-1 bottom-1 overflow-hidden rounded-[3px] border text-[#20252a]"
      data-selected={isSelected}
      role="button"
      tabIndex={0}
      aria-label={`${clip.name || '音频片段'}，开始 ${formatTime(clip.startTime)}，时长 ${formatTime(clip.duration)}，速度 ${Math.round(100 / getClipStretchRatio(clip))}%`}
      aria-pressed={isSelected}
      style={{
        left: displayLeft,
        width: displayWidth,
        backgroundColor: `color-mix(in srgb, ${trackColor} 76%, white)`,
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
        style={{ backgroundColor: trackColor }}
        title="拖动移动片段；成组选择时同步移动"
        onPointerDown={handleMoveStart}
        onPointerMove={handleMoveMove}
        onPointerUp={handleMoveEnd}
        onPointerCancel={() => setMoveDrag(null)}
      >
        <span className="min-w-0 flex-1 truncate">{clip.name || '音频片段'}</span>
        {getClipStretchRatio(clip) !== 1 && (
          <button
            type="button"
            className="shrink-0 rounded-sm bg-[#20252a]/20 px-1 text-[9px] font-semibold hover:bg-[#20252a]/35"
            aria-label="恢复片段速度100%"
            title={`速度 ${Math.round(100 / getClipStretchRatio(clip))}%，点击恢复 100%`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onReset();
            }}
          >
            {Math.round(100 / getClipStretchRatio(clip))}%
          </button>
        )}
      </div>

      {/* Waveform canvas */}
      <canvas ref={canvasRef} className="absolute inset-x-0 bottom-1 top-5" />

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

function drawSpectrumMini(
  ctx: CanvasRenderingContext2D,
  data: Float32Array,
  width: number,
  height: number,
  sampleRate: number,
  alpha: number,
) {
  // Compute spectrogram-like overview
  const windowSize = 2048;
  const hopSize = Math.floor(data.length / width) || 1;
  const specData = wasmProcessor.spectrogram(data, windowSize, hopSize);
  const specLen = windowSize / 2 + 1;

  ctx.globalAlpha = alpha;

  const numFrames = Math.floor(specData.length / specLen);
  const pxPerFrame = width / numFrames;

  // Get only visible range (first ~2kHz for overview)
  const maxFreq = sampleRate / 2;
  const displayBins = Math.min(specLen, Math.floor(specLen * 0.2)); // top 20% of frequencies

  for (let f = 0; f < numFrames; f++) {
    const x = f * pxPerFrame;
    const frameStart = f * specLen;

    for (let b = 0; b < displayBins; b++) {
      const mag = specData[frameStart + b];
      // Convert to dB
      const db = 20 * Math.log10(Math.max(mag, 0.0001));
      // Normalize -100 to 0 dB
      const normalized = (db + 100) / 100;

      if (normalized > 0.05) {
        const y = height - (b / displayBins) * height;
        const hue = 240 - normalized * 200; // blue to red
        const lightness = 30 + normalized * 40;
        ctx.fillStyle = `hsla(${hue}, 80%, ${lightness}%, ${normalized * 0.8})`;
        ctx.fillRect(Math.floor(x), Math.floor(y - 1), Math.ceil(pxPerFrame), 2);
      }
    }
  }

  ctx.globalAlpha = 1;
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
