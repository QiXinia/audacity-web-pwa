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
import { projectService } from '@/services/projectService';
import { historyManager } from '@/services/historyService';
import { wasmProcessor, isWasmAvailable } from '@/wasm/processor';
import { formatTime, clamp, generateId, dbToGain, gainToDb } from '@/lib/audioUtils';
import type { IProject, ITrack, IClip, IEffect, ViewMode, EffectType } from '@/types/project';
import EffectPanel from './sections/EffectPanel';
import { Empty, EmptyContent, EmptyHeader, EmptyTitle, EmptyDescription, EmptyMedia } from '@/components/ui/empty';

export default function AudioEditorPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();

  const [project, setProject] = useState<IProject | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [playbackState, setPlaybackState] = useState<PlaybackState>('stopped');
  const [recordingState, setRecordingState] = useState<RecordingState>('idle');
  const [cursorPosition, setCursorPosition] = useState(0);
  const [selection, setSelection] = useState<{ start: number; end: number } | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('waveform');
  const [horizontalZoom, setHorizontalZoom] = useState(50);
  const [verticalZoom, setVerticalZoom] = useState(1);
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
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);

  const timelineRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isPlayingRef = useRef(false);

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

  async function checkMicPermission() {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
        setViewMode(proj.viewState.viewMode);
        setHorizontalZoom(proj.viewState.horizontalZoom);
        setVerticalZoom(proj.viewState.verticalZoom);
        setScrollX(proj.viewState.scrollX);
        setSelection(proj.selection);
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
        },
        selection,
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
      // Start playing from cursor position
      const isSoloActive = project.tracks.some((t) => t.solo);
      const duration = getProjectDuration();
      if (cursorPosition >= duration) {
        setCursorPosition(0);
      }
      await audioEngine.play(project.tracks, cursorPosition, isSoloActive);
    }
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
      const data = audioEngine.stopRecording();
      if (data && data.length > 0) {
        // Find first armed track, or first track
        const armedTrack = project.tracks.find((t) => t.armed);
        const targetTrack = armedTrack ?? project.tracks[0];
        if (targetTrack) {
          await projectService.addRecordingToTrack(
            project.id,
            targetTrack.id,
            data,
            project.sampleRate,
            cursorPosition,
          );
          // Reload project
          const updated = await projectService.getProject(project.id);
          if (updated) setProject(updated);
          toast.success('录音已添加到轨道');
        }
      }
    } else {
      try {
        // Ensure audio context exists
        await audioEngine.ensureContext();
        await audioEngine.startRecording();
        setRecordingState('recording');
        toast.info('正在录音...');
        setMicPermissionState('granted');
      } catch (e) {
        toast.error('无法访问麦克风，请检查权限设置');
        setMicPermissionState('denied');
      }
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
  function selectClip(trackId: string, clipId: string) {
    setSelectedTrackId(trackId);
    setSelectedClipId(clipId);
  }

  // Import audio
  function handleImportClick() {
    fileInputRef.current?.click();
  }

  async function handleFileImport(file: File, targetTrackId?: string) {
    if (!project) return;
    const trackId = targetTrackId ?? selectedTrackId ?? project.tracks[0]?.id;
    if (!trackId) return;
    const beforeProject = project;

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
  }) {
    // 深拷贝当前 project 作为操作前快照，用于 IndexedDB 持久化
    historyManager.push(cmd, project ?? undefined);
    updateHistoryState();
  }

  function updateHistoryState() {
    setCanUndo(historyManager.canUndo());
    setCanRedo(historyManager.canRedo());
  }

  function handleUndo() {
    if (!project) return;
    const result = historyManager.undo(project);
    if (result) {
      setProject(result.project);
      projectService.saveProject(result.project);
      toast.info(`撤销：${result.command.label}`);
      updateHistoryState();
    }
  }

  function handleRedo() {
    if (!project) return;
    const result = historyManager.redo(project);
    if (result) {
      setProject(result.project);
      projectService.saveProject(result.project);
      toast.info(`重做：${result.command.label}`);
      updateHistoryState();
    }
  }

  // Clipboard operations
  async function handleCut() {
    if (!project || !selection) return;
    // Save before state
    const before = JSON.parse(JSON.stringify(project)) as IProject;
    const result = await cutSelection(project, selection.start, selection.end);
    if (result) {
      setProject(result);
      projectService.saveProject(result);
      pushHistoryCmd({
        id: generateId(),
        label: '剪切',
        execute: () => result,
        undo: () => before,
      });
      updateHistoryState();
      setSelection(null);
    }
  }

  async function handleCopy() {
    if (!project || !selection) return;
    const clipboardData = await copySelection(project, selection.start, selection.end);
    if (clipboardData) {
      // Store in IndexedDB clipboard
      try {
        
        await audioDb.clipboard.put({
          id: 'current',
          data: JSON.stringify(clipboardData),
          createdAt: Date.now(),
        });
        toast.success('已复制到剪贴板');
      } catch {}
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
      const clipboardData = JSON.parse(entry.data);
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
    return Math.max(maxEnd, 30); // Minimum 30s timeline
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
        data: JSON.stringify(copied),
        createdAt: Date.now(),
      });
    } catch {}

    return deleteRegion(proj, start, end);
  }

  async function copySelection(
    proj: IProject,
    start: number,
    end: number,
  ): Promise<{ tracks: Array<{ trackId: string; data: Float32Array; startTime: number }>; sampleRate: number; duration: number } | null> {
    const duration = end - start;
    if (duration <= 0) return null;

    const result: Array<{ trackId: string; data: Float32Array; startTime: number }> = [];
    const sampleRate = proj.sampleRate;
    const totalSamples = Math.ceil(duration * sampleRate);

    for (const track of proj.tracks) {
      const trackBuffer = new Float32Array(totalSamples);
      let hasContent = false;

      for (const clip of track.clips) {
        const clipEnd = clip.startTime + clip.duration;
        if (clipEnd <= start || clip.startTime >= end) continue;

        const overlapStart = Math.max(clip.startTime, start);
        const overlapEnd = Math.min(clipEnd, end);
        const overlapDuration = overlapEnd - overlapStart;

        const clipData = await projectService.loadAudioBuffer(clip.audioBufferId);
        if (!clipData) continue;

        const offsetInClip = overlapStart - clip.startTime + clip.offset;
        const srcStartSample = Math.floor(offsetInClip * sampleRate);
        const srcSamples = Math.floor(overlapDuration * sampleRate);
        const dstStartSample = Math.floor((overlapStart - start) * sampleRate);

        for (let i = 0; i < srcSamples && srcStartSample + i < clipData.length && dstStartSample + i < totalSamples; i++) {
          // Apply fade in/out from clip
          let fadeGain = 1;
          const posInClip = offsetInClip * sampleRate + i;

          if (clip.fadeIn > 0 && posInClip < clip.fadeIn * sampleRate) {
            fadeGain = posInClip / (clip.fadeIn * sampleRate);
          }
          if (clip.fadeOut > 0 && posInClip > (clip.duration - clip.fadeOut) * sampleRate) {
            const fadePos = posInClip - (clip.duration - clip.fadeOut) * sampleRate;
            fadeGain = 1 - fadePos / (clip.fadeOut * sampleRate);
          }

          trackBuffer[dstStartSample + i] += clipData[srcStartSample + i] * dbToGain(clip.gain) * fadeGain;
        }
        hasContent = true;
      }

      if (hasContent) {
        result.push({ trackId: track.id, data: trackBuffer, startTime: 0 });
      }
    }

    return { tracks: result, sampleRate, duration };
  }

  async function pasteAtCursor(
    proj: IProject,
    clipboardData: { tracks: Array<{ trackId: string; data: Float32Array; startTime: number }>; sampleRate: number; duration: number },
    cursorPos: number,
  ): Promise<IProject | null> {
    if (clipboardData.tracks.length === 0) return null;

    const updated = JSON.parse(JSON.stringify(proj)) as IProject;

    // Paste each track's data as a new clip
    for (let i = 0; i < clipboardData.tracks.length; i++) {
      const trackClip = clipboardData.tracks[i];
      let targetTrack: ITrack | undefined;

      // Match by original track id if possible, else use first track / create new
      if (i === 0) {
        targetTrack = updated.tracks.find((t) => t.id === selectedTrackId) ?? updated.tracks[0];
      } else {
        // For multi-track paste, create new tracks
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

      if (!targetTrack) continue;

      // Store audio data
      const bufferId = generateId();
      
      await audioDb.audioBuffers.put({
        id: bufferId,
        projectId: proj.id,
        sampleRate: clipboardData.sampleRate,
        channels: 1,
        length: trackClip.data.length,
        duration: clipboardData.duration,
        channelData: [trackClip.data.buffer as ArrayBuffer],
        createdAt: Date.now(),
      });

      audioEngine.cacheBuffer(bufferId, [trackClip.data], clipboardData.sampleRate);

      const newClip: IClip = {
        id: generateId(),
        audioBufferId: bufferId,
        startTime: cursorPos,
        offset: 0,
        duration: clipboardData.duration,
        originalDuration: clipboardData.duration,
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
        const clipData = await projectService.loadAudioBuffer(clip.audioBufferId);
        if (!clipData) {
          newClips.push(clip);
          continue;
        }

        // Left part (before start)
        if (clip.startTime < start) {
          const leftDuration = start - clip.startTime;
          const leftSamples = Math.floor(leftDuration * proj.sampleRate);
          const leftData = wasmProcessor.sliceBuffer(clipData, 0, leftSamples);

          const leftBufferId = generateId();
          
          await audioDb.audioBuffers.put({
            id: leftBufferId,
            projectId: proj.id,
            sampleRate: proj.sampleRate,
            channels: 1,
            length: leftData.length,
            duration: leftDuration,
            channelData: [leftData.buffer as ArrayBuffer],
            createdAt: Date.now(),
          });
          audioEngine.cacheBuffer(leftBufferId, [leftData], proj.sampleRate);

          newClips.push({
            ...clip,
            id: generateId(),
            audioBufferId: leftBufferId,
            duration: leftDuration,
            originalDuration: leftDuration,
            offset: 0,
            fadeOut: 0, // reset fades for simplicity
          });
        }

        // Right part (after end) - shift left by duration
        if (clipEnd > end) {
          const rightOffsetInClip = end - clip.startTime + clip.offset;
          const rightStartSample = Math.floor(rightOffsetInClip * proj.sampleRate);
          const rightData = wasmProcessor.sliceBuffer(clipData, rightStartSample, clipData.length);
          const rightDuration = rightData.length / proj.sampleRate;

          const rightBufferId = generateId();
          
          await audioDb.audioBuffers.put({
            id: rightBufferId,
            projectId: proj.id,
            sampleRate: proj.sampleRate,
            channels: 1,
            length: rightData.length,
            duration: rightDuration,
            channelData: [rightData.buffer as ArrayBuffer],
            createdAt: Date.now(),
          });
          audioEngine.cacheBuffer(rightBufferId, [rightData], proj.sampleRate);

          newClips.push({
            ...clip,
            id: generateId(),
            audioBufferId: rightBufferId,
            startTime: start, // shifted left
            offset: 0,
            duration: rightDuration,
            originalDuration: rightDuration,
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

        const clipData = await projectService.loadAudioBuffer(clip.audioBufferId);
        if (!clipData) continue;

        // Make a mutable copy
        const dataCopy = new Float32Array(clipData);

        const overlapStart = Math.max(clip.startTime, selection.start);
        const overlapEnd = Math.min(clipEnd, selection.end);

        const offsetInClip = overlapStart - clip.startTime + clip.offset;
        const startSample = Math.floor(offsetInClip * project.sampleRate);
        const endSample = Math.floor((offsetInClip + (overlapEnd - overlapStart)) * project.sampleRate);

        // Apply gain to selected portion
        for (let i = startSample; i < endSample && i < dataCopy.length; i++) {
          dataCopy[i] *= gainLin;
        }

        // Store modified buffer
        const newBufferId = generateId();
        
        await audioDb.audioBuffers.put({
          id: newBufferId,
          projectId: project.id,
          sampleRate: project.sampleRate,
          channels: 1,
          length: dataCopy.length,
          duration: clip.duration,
          channelData: [dataCopy.buffer as ArrayBuffer],
          createdAt: Date.now(),
        });
        audioEngine.cacheBuffer(newBufferId, [dataCopy], project.sampleRate);

        clip.audioBufferId = newBufferId;
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

        const clipData = await projectService.loadAudioBuffer(clip.audioBufferId);
        if (!clipData) continue;

        const dataCopy = new Float32Array(clipData);

        const overlapStart = Math.max(clip.startTime, selection.start);
        const overlapEnd = Math.min(clipEnd, selection.end);

        const offsetInClip = overlapStart - clip.startTime + clip.offset;
        const startSample = Math.floor(offsetInClip * project.sampleRate);
        const endSample = Math.floor(
          (offsetInClip + (overlapEnd - overlapStart)) * project.sampleRate,
        );

        const selectionSamples = endSample - startSample;
        if (type === 'in') {
          // Apply fade in: from 0 to 1 across selection
          for (let i = 0; i < selectionSamples && startSample + i < dataCopy.length; i++) {
            const factor = i / selectionSamples;
            dataCopy[startSample + i] *= factor;
          }
        } else {
          // Apply fade out: from 1 to 0 across selection
          for (let i = 0; i < selectionSamples && startSample + i < dataCopy.length; i++) {
            const factor = 1 - i / selectionSamples;
            dataCopy[startSample + i] *= factor;
          }
        }

        const newBufferId = generateId();
        
        await audioDb.audioBuffers.put({
          id: newBufferId,
          projectId: project.id,
          sampleRate: project.sampleRate,
          channels: 1,
          length: dataCopy.length,
          duration: clip.duration,
          channelData: [dataCopy.buffer as ArrayBuffer],
          createdAt: Date.now(),
        });
        audioEngine.cacheBuffer(newBufferId, [dataCopy], project.sampleRate);

        clip.audioBufferId = newBufferId;
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

  async function applyNormalize() {
    if (!project || !selection) return;
    const before = JSON.parse(JSON.stringify(project)) as IProject;

    const updated = JSON.parse(JSON.stringify(project)) as IProject;

    for (const track of updated.tracks) {
      for (const clip of track.clips) {
        const clipEnd = clip.startTime + clip.duration;
        if (clipEnd <= selection.start || clip.startTime >= selection.end) continue;

        const clipData = await projectService.loadAudioBuffer(clip.audioBufferId);
        if (!clipData) continue;

        const dataCopy = new Float32Array(clipData);

        const overlapStart = Math.max(clip.startTime, selection.start);
        const overlapEnd = Math.min(clipEnd, selection.end);

        const offsetInClip = overlapStart - clip.startTime + clip.offset;
        const startSample = Math.floor(offsetInClip * project.sampleRate);
        const endSample = Math.floor(
          (offsetInClip + (overlapEnd - overlapStart)) * project.sampleRate,
        );

        // Find peak in selection
        let peak = 0;
        for (let i = startSample; i < endSample && i < dataCopy.length; i++) {
          const abs = Math.abs(dataCopy[i]);
          if (abs > peak) peak = abs;
        }

        if (peak > 0) {
          const targetLin = dbToGain(-1); // -1dB headroom
          const gain = targetLin / peak;
          for (let i = startSample; i < endSample && i < dataCopy.length; i++) {
            dataCopy[i] *= gain;
          }
        }

        const newBufferId = generateId();
        
        await audioDb.audioBuffers.put({
          id: newBufferId,
          projectId: project.id,
          sampleRate: project.sampleRate,
          channels: 1,
          length: dataCopy.length,
          duration: clip.duration,
          channelData: [dataCopy.buffer as ArrayBuffer],
          createdAt: Date.now(),
        });
        audioEngine.cacheBuffer(newBufferId, [dataCopy], project.sampleRate);

        clip.audioBufferId = newBufferId;
      }
    }

    setProject(updated);
    projectService.saveProject(updated);
    historyManager.push({
      id: generateId(),
      label: '标准化',
      execute: () => updated,
      undo: () => before,
    }, before);
    updateHistoryState();
    toast.success('已标准化到 -1 dB');
  }

  async function applyReverse() {
    if (!project || !selection) return;
    const before = JSON.parse(JSON.stringify(project)) as IProject;

    const updated = JSON.parse(JSON.stringify(project)) as IProject;

    for (const track of updated.tracks) {
      for (const clip of track.clips) {
        const clipEnd = clip.startTime + clip.duration;
        if (clipEnd <= selection.start || clip.startTime >= selection.end) continue;

        const clipData = await projectService.loadAudioBuffer(clip.audioBufferId);
        if (!clipData) continue;

        const dataCopy = new Float32Array(clipData);

        const overlapStart = Math.max(clip.startTime, selection.start);
        const overlapEnd = Math.min(clipEnd, selection.end);

        const offsetInClip = overlapStart - clip.startTime + clip.offset;
        const startSample = Math.floor(offsetInClip * project.sampleRate);
        const endSample = Math.floor(
          (offsetInClip + (overlapEnd - overlapStart)) * project.sampleRate,
        );

        // Reverse selected portion
        const segment = dataCopy.slice(startSample, endSample);
        segment.reverse();
        dataCopy.set(segment, startSample);

        const newBufferId = generateId();
        
        await audioDb.audioBuffers.put({
          id: newBufferId,
          projectId: project.id,
          sampleRate: project.sampleRate,
          channels: 1,
          length: dataCopy.length,
          duration: clip.duration,
          channelData: [dataCopy.buffer as ArrayBuffer],
          createdAt: Date.now(),
        });
        audioEngine.cacheBuffer(newBufferId, [dataCopy], project.sampleRate);

        clip.audioBufferId = newBufferId;
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

  const projectDuration = getProjectDuration();
  const pxPerSec = horizontalZoom;
  const totalWidth = Math.max(projectDuration * pxPerSec, 1000);

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
        className="flex h-screen flex-col overflow-hidden bg-background text-foreground"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* Top Toolbar - Audacity 4 风格紧凑工具栏 */}
        <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border bg-card/80 px-2">
          {/* 左侧：项目 + 撤销重做 */}
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" onClick={() => navigate('/')} className="size-8">
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
                  <Button variant="ghost" size="icon" onClick={handleSkipBack} className="size-8">
                    <SkipBack className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>跳到开头</TooltipContent>
              </Tooltip>
              <Button
                variant={playbackState === 'playing' ? 'default' : 'secondary'}
                size="icon"
                onClick={handlePlayPause}
                className="size-9"
              >
                {playbackState === 'playing' ? (
                  <Pause className="size-4" />
                ) : (
                  <Play className="size-4 ml-0.5" />
                )}
              </Button>
              <Button variant="ghost" size="icon" onClick={handleStop} className="size-8">
                <StopCircle className="size-4" />
              </Button>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" onClick={handleSkipForward} className="size-8">
                    <SkipForward className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>跳到末尾</TooltipContent>
              </Tooltip>
              <Separator orientation="vertical" className="mx-1.5 h-6" />
              <Button
                variant={recordingState === 'recording' ? 'destructive' : 'ghost'}
                size="icon"
                onClick={handleRecord}
                className={`size-8 ${recordingState === 'recording' ? 'animate-pulse' : ''}`}
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
          </div>

          {/* 右侧：视图 + 保存 + 导出 */}
          <div className="flex items-center gap-1">
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
                <Button variant="default" size="sm" onClick={() => setExportDialogOpen(true)} className="h-8">
                  <Download className="mr-1 size-3.5" />
                  导出
                </Button>
              </TooltipTrigger>
              <TooltipContent>导出音频文件</TooltipContent>
            </Tooltip>
          </div>
        </header>

        {/* Edit Toolbar */}
        <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border bg-muted/20 px-2">
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
              <DropdownMenuSeparator />
              <DropdownMenuLabel>处理</DropdownMenuLabel>
              <DropdownMenuItem onClick={applyNormalize} disabled={!selection}>
                标准化到 -1dB
              </DropdownMenuItem>
              <DropdownMenuItem onClick={applyReverse} disabled={!selection}>
                反转
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
              <div className="flex items-center gap-1.5 rounded-md bg-primary/10 px-2 py-0.5 text-primary">
                <span className="size-1.5 rounded-full bg-primary" />
                <span>选区：{formatTime(selection.start)} → {formatTime(selection.end)}</span>
                <span className="text-muted-foreground">（{formatTime(selection.end - selection.start)}）</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="ml-1 size-5 hover:bg-primary/20"
                  onClick={() => setSelection(null)}
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

          <div className="flex-1" />

          {/* Zoom controls */}
          <div className="flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  onClick={() => setHorizontalZoom((z) => Math.max(10, z - 20))}
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
                  onClick={() => setHorizontalZoom((z) => Math.min(500, z + 20))}
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
          <div className="flex w-56 shrink-0 flex-col border-r border-border bg-card/30">
            <div className="flex h-7 items-center justify-between border-b border-border px-2 text-xs text-muted-foreground">
              <span>轨道</span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="size-6" onClick={addTrack}>
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

          {/* Timeline Area (Center) */}
          <div
            ref={timelineRef}
            className="relative flex-1 overflow-auto bg-background"
            onScroll={(e) => setScrollX((e.target as HTMLDivElement).scrollLeft)}
          >
            {/* Time Ruler */}
            <div
              className="sticky top-0 z-20 h-7 shrink-0 border-b border-border bg-card/70 backdrop-blur"
              style={{ width: totalWidth }}
            >
              <TimeRuler duration={projectDuration} pxPerSec={pxPerSec} />
            </div>

            {/* Playhead */}
            <div
              className="pointer-events-none absolute top-0 bottom-0 z-10 w-px bg-red-500"
              style={{ left: cursorPosition * pxPerSec }}
            >
              <div className="absolute -left-1.5 top-7 size-3 rotate-45 bg-red-500" />
            </div>

            {/* Selection overlay */}
            {selection && (
              <div
                className="pointer-events-none absolute top-7 bottom-0 z-[5] bg-primary/20"
                style={{
                  left: selection.start * pxPerSec,
                  width: (selection.end - selection.start) * pxPerSec,
                }}
              />
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
                className="flex items-center justify-center py-20"
                style={{ width: totalWidth, minHeight: 300 }}
              >
                <Empty className="w-auto border-0">
                  <EmptyContent>
                    <EmptyMedia variant="icon">
                      <Music className="size-6" />
                    </EmptyMedia>
                    <EmptyHeader>
                      <EmptyTitle>空工程</EmptyTitle>
                      <EmptyDescription>
                        导入音频文件或开始录音来开始编辑
                      </EmptyDescription>
                    </EmptyHeader>
                    <div className="flex gap-2 pt-2">
                      <Button size="sm" onClick={handleImportClick}>
                        <Plus className="mr-1 size-3.5" />
                        导入音频
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
                isSelected={selectedTrackId === track.id}
                selectedClipId={selectedClipId}
                onSelectClip={(clipId) => selectClip(track.id, clipId)}
                onSelectionChange={handleSelectionChange}
                onCursorChange={handleCursorChange}
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

        {/* Status Bar - Audacity 4 风格底部状态栏 */}
        <div className="flex h-7 shrink-0 items-center justify-between border-t border-border bg-muted/40 px-3 text-[11px] text-muted-foreground">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <AudioWaveform className="size-3" />
              {project.tracks.length} 轨道
            </span>
            <span className="text-border">|</span>
            <span>{project.sampleRate} Hz</span>
            <span className="text-border">|</span>
            <span>32-bit float</span>
            <span className="text-border">|</span>
            <span className={isWasmAvailable() ? 'text-success' : 'text-warning'}>
              {isWasmAvailable() ? '● WASM 加速' : '○ JS 模式'}
            </span>
          </div>

          {/* 选区信息 */}
          {selection ? (
            <div className="flex items-center gap-3 font-mono tabular-nums">
              <span>选区: <span className="text-foreground">{formatTime(selection.start)}</span></span>
              <span className="text-border">-</span>
              <span className="text-foreground">{formatTime(selection.end)}</span>
              <span className="text-border" />
              <span className="text-primary">时长 {formatTime(selection.end - selection.start)}</span>
            </div>
          ) : (
            <div className="font-mono tabular-nums">
              光标: <span className="text-foreground">{formatTime(cursorPosition)}</span>
            </div>
          )}

          <div className="flex items-center gap-3">
            {micPermissionState === 'denied' && (
              <span className="text-destructive">麦克风无权限</span>
            )}
            {recordingState === 'recording' && (
              <span className="flex items-center gap-1 text-destructive">
                <span className="size-2 animate-pulse rounded-full bg-destructive" />
                录制中
              </span>
            )}
            {playbackState === 'playing' && (
              <span className="flex items-center gap-1 text-primary">
                <Play className="size-3 fill-current" />
                播放中
              </span>
            )}
            <span className="text-border">|</span>
            <span>缩放 {Math.round(pxPerSec)} px/s</span>
          </div>
        </div>

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
      className={`border-b border-border p-2 transition-colors ${
        isSelected ? 'bg-accent/20' : 'hover:bg-accent/10'
      }`}
      onClick={onSelect}
    >
      <div className="mb-1.5 flex items-center gap-1">
        <GripVertical className="size-3 text-muted-foreground" />
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
            className="h-6 text-xs"
            autoFocus
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span
            className="flex-1 truncate text-sm font-medium"
            onDoubleClick={(e) => {
              e.stopPropagation();
              setIsEditing(true);
            }}
          >
            {track.name}
          </span>
        )}
        <div
          className="size-2.5 shrink-0 rounded-sm"
          style={{ backgroundColor: track.color }}
        />
      </div>

      {/* Mute / Solo / Arm buttons */}
      <div className="mb-2 flex gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={track.muted ? 'destructive' : 'secondary'}
              size="sm"
              className="h-6 flex-1 px-1 text-xs"
              onClick={(e) => {
                e.stopPropagation();
                onMute();
              }}
            >
              {track.muted ? <VolumeX className="size-3" /> : <Volume2 className="size-3" />}
              <span className="ml-1">M</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>静音</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={track.solo ? 'default' : 'secondary'}
              size="sm"
              className="h-6 flex-1 px-1 text-xs"
              onClick={(e) => {
                e.stopPropagation();
                onSolo();
              }}
            >
              <Headphones className="size-3" />
              <span className="ml-1">S</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>独奏</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={track.armed ? 'destructive' : 'secondary'}
              size="sm"
              className="h-6 flex-1 px-1 text-xs"
              onClick={(e) => {
                e.stopPropagation();
                onArm();
              }}
            >
              <Mic className="size-3" />
              <span className="ml-1">R</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>录音准备</TooltipContent>
        </Tooltip>
      </div>

      {/* Gain slider */}
      <div className="mb-1.5">
        <div className="mb-0.5 flex justify-between text-[10px] text-muted-foreground">
          <span>增益</span>
          <span className="tabular-nums">{track.gain.toFixed(1)} dB</span>
        </div>
        <Slider
          value={[track.gain]}
          min={-60}
          max={12}
          step={0.5}
          onValueChange={(v) => onGainChange(v[0])}
          className="h-1"
        />
      </div>

      {/* Pan slider */}
      <div className="mb-2">
        <div className="mb-0.5 flex justify-between text-[10px] text-muted-foreground">
          <span>声像</span>
          <span className="tabular-nums">
            {track.pan === 0 ? 'C' : track.pan < 0 ? `L${Math.abs(track.pan).toFixed(1)}` : `R${track.pan.toFixed(1)}`}
          </span>
        </div>
        <Slider
          value={[track.pan]}
          min={-1}
          max={1}
          step={0.01}
          onValueChange={(v) => onPanChange(v[0])}
          className="h-1"
        />
      </div>

      {/* Effects & Delete */}
      <div className="flex items-center justify-between">
        <Badge variant="outline" className="text-[10px]">
          {track.clips.length} 片段
        </Badge>
        <div className="flex gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-6"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenEffects();
                }}
              >
                <Settings className="size-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>效果器</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-6 text-muted-foreground hover:text-destructive"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete();
                }}
              >
                <Trash2 className="size-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>删除轨道</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Effect count indicator */}
      {track.effects.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {track.effects.slice(0, 3).map((fx) => (
            <Badge
              key={fx.id}
              variant={fx.bypassed ? 'outline' : 'secondary'}
              className="text-[10px] px-1.5 py-0"
            >
              {fx.bypassed && <EyeOff className="mr-0.5 size-2.5" />}
              {getShortEffectLabel(fx.type)}
            </Badge>
          ))}
          {track.effects.length > 3 && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0">
              +{track.effects.length - 3}
            </Badge>
          )}
        </div>
      )}
    </div>
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
  isSelected,
  selectedClipId,
  onSelectClip,
  onSelectionChange,
  onCursorChange,
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
  isSelected: boolean;
  selectedClipId: string | null;
  onSelectClip: (clipId: string) => void;
  onSelectionChange: (start: number, end: number) => void;
  onCursorChange: (pos: number) => void;
}) {
  const trackHeight = 100;
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState(0);

  function handleMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const pos = x / pxPerSec;
    setIsDragging(true);
    setDragStart(pos);
    onCursorChange(pos);
  }

  function handleMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    if (!isDragging) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const pos = clamp(x / pxPerSec, 0, totalWidth / pxPerSec);
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
          viewMode={viewMode}
          isSelected={selectedClipId === clip.id}
          trackColor={track.color}
          onClick={(e) => {
            e.stopPropagation();
            onSelectClip(clip.id);
          }}
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
  viewMode,
  isSelected,
  trackColor,
  onClick,
}: {
  clip: IClip;
  track: ITrack;
  projectId: string;
  sampleRate: number;
  pxPerSec: number;
  trackHeight: number;
  verticalZoom: number;
  viewMode: ViewMode;
  isSelected: boolean;
  trackColor: string;
  onClick: (e: React.MouseEvent) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [audioData, setAudioData] = useState<Float32Array | null>(null);

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
    const height = trackHeight - 16;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    // Draw waveform or spectrum based on view mode
    if (viewMode === 'waveform' || viewMode === 'both') {
      drawWaveform(ctx, audioData, width, height, trackColor, clip, sampleRate, verticalZoom, viewMode === 'both' ? 0.6 : 1);
    }

    if (viewMode === 'spectrum' || viewMode === 'both') {
      drawSpectrumMini(ctx, audioData, width, height, sampleRate, viewMode === 'both' ? 0.5 : 1);
    }
  }, [audioData, pxPerSec, clip.duration, clip.offset, viewMode, trackColor, trackHeight, sampleRate, verticalZoom]);

  const left = clip.startTime * pxPerSec;
  const width = clip.duration * pxPerSec;

  return (
    <div
      className={`absolute top-2 bottom-2 overflow-hidden rounded-md border transition-shadow ${
        isSelected ? 'border-primary shadow-lg shadow-primary/20' : 'border-border/50'
      }`}
      style={{
        left,
        width,
        backgroundColor: `${trackColor}15`,
      }}
      onClick={onClick}
    >
      {/* Clip label */}
      <div className="absolute left-1 top-0 z-10 max-w-full truncate px-1 py-0.5 text-[10px] font-medium text-foreground/80">
        {clip.name || '音频片段'}
      </div>

      {/* Waveform canvas */}
      <canvas
        ref={canvasRef}
        className="absolute inset-x-0 bottom-1 top-4"
      />

      {/* Fade indicators */}
      {clip.fadeIn > 0 && (
        <div
          className="absolute left-0 top-0 bottom-0 bg-gradient-to-r from-background/30 to-transparent"
          style={{ width: clip.fadeIn * pxPerSec }}
        />
      )}
      {clip.fadeOut > 0 && (
        <div
          className="absolute right-0 top-0 bottom-0 bg-gradient-to-l from-background/30 to-transparent"
          style={{ width: clip.fadeOut * pxPerSec }}
        />
      )}
    </div>
  );
}

function drawWaveform(
  ctx: CanvasRenderingContext2D,
  data: Float32Array,
  width: number,
  height: number,
  color: string,
  clip: IClip,
  sampleRate: number,
  verticalZoom: number,
  alpha: number,
) {
  const samplesPerPixel = Math.floor((data.length * clip.duration / clip.originalDuration) / width) || 1;
  const centerY = height / 2;
  const amplitude = (height / 2 - 4) * verticalZoom;

  ctx.fillStyle = color;
  ctx.globalAlpha = alpha;

  ctx.beginPath();
  ctx.moveTo(0, centerY);

  for (let x = 0; x < width; x++) {
    const startSample = Math.floor(clip.offset * sampleRate + x * samplesPerPixel);
    const endSample = Math.min(startSample + samplesPerPixel, data.length);

    let min = 1;
    let max = -1;

    for (let i = startSample; i < endSample; i++) {
      const v = data[i] ?? 0;
      if (v < min) min = v;
      if (v > max) max = v;
    }

    const yMin = centerY - Math.min(1, Math.abs(max * verticalZoom)) * amplitude;
    const yMax = centerY + Math.min(1, Math.abs(min * verticalZoom)) * amplitude;

    ctx.moveTo(x, yMin);
    ctx.lineTo(x, yMax);
  }

  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.stroke();

  // Center line
  ctx.globalAlpha = alpha * 0.3;
  ctx.beginPath();
  ctx.moveTo(0, centerY);
  ctx.lineTo(width, centerY);
  ctx.strokeStyle = color;
  ctx.lineWidth = 0.5;
  ctx.stroke();

  ctx.globalAlpha = 1;
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
                {formatTime(t)}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
