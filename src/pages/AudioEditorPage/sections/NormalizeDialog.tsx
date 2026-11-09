import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, Play, RotateCcw, SlidersHorizontal } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  DEFAULT_NORMALIZE_SETTINGS,
  isNormalizeBypassed,
  validateNormalizeSettings,
  type NormalizeSettings,
} from '@/lib/normalizeEffect';
import { formatTime } from '@/lib/audioUtils';

interface NormalizeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectionStart: number;
  selectionEnd: number;
  sampleRate: number;
  hasSelection: boolean;
  isApplying: boolean;
  onPreview: (settings: NormalizeSettings) => Promise<Float32Array[]>;
  onApply: (settings: NormalizeSettings) => void;
}

export function NormalizeDialog({
  open,
  onOpenChange,
  selectionStart,
  selectionEnd,
  sampleRate,
  hasSelection,
  isApplying,
  onPreview,
  onApply,
}: NormalizeDialogProps) {
  const [removeDc, setRemoveDc] = useState(DEFAULT_NORMALIZE_SETTINGS.removeDc);
  const [normalizePeak, setNormalizePeak] = useState(DEFAULT_NORMALIZE_SETTINGS.normalizePeak);
  const [peakDraft, setPeakDraft] = useState(String(DEFAULT_NORMALIZE_SETTINGS.peakDb));
  const [stereoIndependent, setStereoIndependent] = useState(
    DEFAULT_NORMALIZE_SETTINGS.stereoIndependent,
  );
  const [previewError, setPreviewError] = useState('');
  const [isPreviewing, setIsPreviewing] = useState(false);
  const previewContextRef = useRef<AudioContext | null>(null);
  const previewSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const previewRequestRef = useRef(0);

  const stopPreview = useCallback(() => {
    previewRequestRef.current += 1;
    const source = previewSourceRef.current;
    const context = previewContextRef.current;
    previewSourceRef.current = null;
    previewContextRef.current = null;
    if (source) {
      source.onended = null;
      try { source.stop(); } catch { /* Source may already have ended. */ }
      source.disconnect();
    }
    if (context) void context.close().catch(() => undefined);
    setIsPreviewing(false);
  }, []);

  useEffect(() => {
    if (!open) {
      stopPreview();
      return;
    }
    stopPreview();
    setRemoveDc(DEFAULT_NORMALIZE_SETTINGS.removeDc);
    setNormalizePeak(DEFAULT_NORMALIZE_SETTINGS.normalizePeak);
    setPeakDraft(String(DEFAULT_NORMALIZE_SETTINGS.peakDb));
    setStereoIndependent(DEFAULT_NORMALIZE_SETTINGS.stereoIndependent);
    setPreviewError('');
    setIsPreviewing(false);
  }, [open, stopPreview]);

  useEffect(() => () => {
    previewRequestRef.current += 1;
    const source = previewSourceRef.current;
    const context = previewContextRef.current;
    if (source) {
      source.onended = null;
      try { source.stop(); } catch { /* Source may already have ended. */ }
      source.disconnect();
    }
    if (context) void context.close().catch(() => undefined);
  }, []);

  const settings: NormalizeSettings = {
    removeDc,
    normalizePeak,
    peakDb: Number(peakDraft),
    stereoIndependent,
  };
  let validationError = '';
  try {
    validateNormalizeSettings(settings);
  } catch (error) {
    validationError = error instanceof Error ? error.message : '标准化参数无效';
  }
  const bypassed = isNormalizeBypassed(settings);
  const unavailable = isApplying || isPreviewing || !hasSelection;
  const invalid = Boolean(validationError) || bypassed;

  function reset() {
    stopPreview();
    setRemoveDc(DEFAULT_NORMALIZE_SETTINGS.removeDc);
    setNormalizePeak(DEFAULT_NORMALIZE_SETTINGS.normalizePeak);
    setPeakDraft(String(DEFAULT_NORMALIZE_SETTINGS.peakDb));
    setStereoIndependent(DEFAULT_NORMALIZE_SETTINGS.stereoIndependent);
    setPreviewError('');
  }

  function changeOpen(nextOpen: boolean) {
    if (!nextOpen) stopPreview();
    onOpenChange(nextOpen);
  }

  async function preview() {
    if (invalid || unavailable) return;
    const requestId = previewRequestRef.current + 1;
    previewRequestRef.current = requestId;
    setPreviewError('');
    setIsPreviewing(true);
    try {
      const channels = await onPreview(settings);
      if (requestId !== previewRequestRef.current) return;
      if (channels.length === 0 || !channels[0] || channels[0].length === 0) {
        throw new Error('选区内没有可试听的采样');
      }
      const length = channels[0].length;
      if (channels.some((channel) => channel.length !== length)) {
        throw new Error('试听声道必须等长');
      }
      const AudioContextConstructor = window.AudioContext;
      if (!AudioContextConstructor) throw new Error('当前浏览器不支持试听');
      const context = new AudioContextConstructor();
      previewContextRef.current = context;
      const buffer = context.createBuffer(channels.length, length, sampleRate);
      channels.forEach((channel, channelIndex) => {
        buffer.getChannelData(channelIndex).set(channel);
      });
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      source.onended = () => {
        if (previewSourceRef.current !== source) return;
        previewSourceRef.current = null;
        previewContextRef.current = null;
        source.disconnect();
        void context.close().catch(() => undefined);
        setIsPreviewing(false);
      };
      previewSourceRef.current = source;
      source.start();
      await context.resume();
    } catch (error) {
      if (requestId === previewRequestRef.current) {
        stopPreview();
        setPreviewError(error instanceof Error ? error.message : '试听失败，请重试');
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className="max-w-lg border-[#3a3a3a] bg-[#2b2b2b] text-[#d4d4d4]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <SlidersHorizontal className="size-4" />
            标准化
          </DialogTitle>
          <DialogDescription>
            先分析整个选区，再去除直流偏移并调整峰值。默认联动处理立体声。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2 text-sm">
          <div className="flex justify-between gap-4 text-xs text-[#9d9d9d]">
            <span>选区：{formatTime(selectionStart)} – {formatTime(selectionEnd)}</span>
            <span>{(selectionEnd - selectionStart).toFixed(3)} 秒</span>
          </div>

          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={removeDc}
              disabled={isApplying || isPreviewing}
              onChange={(event) => setRemoveDc(event.target.checked)}
            />
            <span>去除直流偏移（居中到 0.0）</span>
          </label>

          <div className="space-y-2">
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={normalizePeak}
                disabled={isApplying || isPreviewing}
                onChange={(event) => setNormalizePeak(event.target.checked)}
              />
              <span>标准化峰值到</span>
            </label>
            <div className="flex items-center gap-2 pl-6">
              <Label htmlFor="normalize-peak" className="sr-only">峰值（dB）</Label>
              <Input
                id="normalize-peak"
                aria-label="峰值（dB）"
                inputMode="decimal"
                value={peakDraft}
                disabled={!normalizePeak || isApplying || isPreviewing}
                onChange={(event) => {
                  setPeakDraft(event.target.value);
                  setPreviewError('');
                }}
                className="h-9 w-36"
              />
              <span>dB</span>
              <span className="text-xs text-[#9d9d9d]">范围 −145 至 0</span>
            </div>
          </div>

          <label className="flex cursor-pointer items-center gap-2 pl-6">
            <input
              type="checkbox"
              checked={stereoIndependent}
              disabled={!normalizePeak || isApplying || isPreviewing}
              onChange={(event) => setStereoIndependent(event.target.checked)}
            />
            <span>独立标准化立体声声道</span>
          </label>

          {!hasSelection && (
            <p className="text-xs text-[#e0b25f]">请先选择要处理的音频。</p>
          )}
          {validationError && (
            <p role="alert" className="text-xs text-[#ef8d8d]">{validationError}</p>
          )}
          {bypassed && !validationError && (
            <p className="text-xs text-[#e0b25f]">至少启用去直流或峰值标准化之一。</p>
          )}
          {previewError && (
            <div className="flex items-center gap-2 text-xs text-[#ef8d8d]" role="alert">
              <AlertCircle className="size-4" />
              {previewError}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={reset} disabled={isApplying || isPreviewing}>
            <RotateCcw className="mr-2 size-4" />重置
          </Button>
          <Button
            type="button"
            variant="outline"
            aria-pressed={isPreviewing}
            onClick={isPreviewing ? stopPreview : () => void preview()}
            disabled={isApplying || !hasSelection || invalid}
          >
            <Play className="mr-2 size-4" />{isPreviewing ? '停止试听' : '试听'}
          </Button>
          <Button type="button" onClick={() => onApply(settings)} disabled={invalid || unavailable}>
            {isApplying ? '应用中…' : '应用'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
