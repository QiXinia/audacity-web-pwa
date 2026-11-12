import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, AudioLines, Play, RotateCcw } from 'lucide-react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  DEFAULT_LOUDNESS_SETTINGS,
  validateLoudnessSettings,
  type LoudnessAlgorithm,
  type LoudnessSettings,
} from '@/lib/loudnessEffect';
import { formatTime } from '@/lib/audioUtils';

interface LoudnessDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectionStart: number;
  selectionEnd: number;
  sampleRate: number;
  hasSelection: boolean;
  isApplying: boolean;
  onPreview: (settings: LoudnessSettings) => Promise<Float32Array[]>;
  onApply: (settings: LoudnessSettings) => void;
}

export function LoudnessDialog({
  open, onOpenChange, selectionStart, selectionEnd, sampleRate, hasSelection,
  isApplying, onPreview, onApply,
}: LoudnessDialogProps) {
  const [algorithm, setAlgorithm] = useState<LoudnessAlgorithm>(DEFAULT_LOUDNESS_SETTINGS.algorithm);
  const [lufsDraft, setLufsDraft] = useState(String(DEFAULT_LOUDNESS_SETTINGS.lufsLevel));
  const [rmsDraft, setRmsDraft] = useState(String(DEFAULT_LOUDNESS_SETTINGS.rmsLevel));
  const [stereoIndependent, setStereoIndependent] = useState(DEFAULT_LOUDNESS_SETTINGS.stereoIndependent);
  const [dualMono, setDualMono] = useState(DEFAULT_LOUDNESS_SETTINGS.dualMono);
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

  const reset = useCallback(() => {
    stopPreview();
    setAlgorithm(DEFAULT_LOUDNESS_SETTINGS.algorithm);
    setLufsDraft(String(DEFAULT_LOUDNESS_SETTINGS.lufsLevel));
    setRmsDraft(String(DEFAULT_LOUDNESS_SETTINGS.rmsLevel));
    setStereoIndependent(DEFAULT_LOUDNESS_SETTINGS.stereoIndependent);
    setDualMono(DEFAULT_LOUDNESS_SETTINGS.dualMono);
    setPreviewError('');
  }, [stopPreview]);

  useEffect(() => {
    if (open) reset();
    else stopPreview();
  }, [open, reset, stopPreview]);

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

  const settings: LoudnessSettings = {
    algorithm,
    lufsLevel: Number(lufsDraft),
    rmsLevel: Number(rmsDraft),
    stereoIndependent,
    dualMono,
  };
  let validationError = '';
  try { validateLoudnessSettings(settings); }
  catch (error) { validationError = error instanceof Error ? error.message : 'Loudness 参数无效'; }
  const activeDraft = algorithm === 'loudness' ? lufsDraft : rmsDraft;
  if (!validationError && (activeDraft.trim() === '' || !Number.isFinite(Number(activeDraft)))) {
    validationError = '目标必须是有限数字';
  }
  const unavailable = isApplying || isPreviewing || !hasSelection;
  const invalid = Boolean(validationError);

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
      const length = channels[0]?.length ?? 0;
      if (channels.length === 0 || length === 0) throw new Error('选区内没有可试听的采样');
      if (channels.some((channel) => channel.length !== length)) throw new Error('试听声道必须等长');
      const AudioContextConstructor = window.AudioContext;
      if (!AudioContextConstructor) throw new Error('当前浏览器不支持试听');
      const context = new AudioContextConstructor();
      previewContextRef.current = context;
      const buffer = context.createBuffer(channels.length, length, sampleRate);
      channels.forEach((channel, index) => buffer.getChannelData(index).set(channel));
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
            <AudioLines className="size-4" />Loudness Normalization
          </DialogTitle>
          <DialogDescription>
            按 Audacity 的 EBU R128 感知响度或 RMS 分析整个选区，再以增益完成标准化。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2 text-sm">
          <div className="flex justify-between gap-4 text-xs text-[#9d9d9d]">
            <span>选区：{formatTime(selectionStart)} – {formatTime(selectionEnd)}</span>
            <span>{(selectionEnd - selectionStart).toFixed(3)} 秒</span>
          </div>

          <div className="space-y-2">
            <Label htmlFor="loudness-algorithm">算法</Label>
            <select
              id="loudness-algorithm"
              aria-label="算法"
              value={algorithm}
              disabled={isApplying || isPreviewing}
              onChange={(event) => {
                setAlgorithm(event.target.value as LoudnessAlgorithm);
                setPreviewError('');
              }}
              className="h-9 w-full rounded-md border border-[#4a4a4a] bg-[#202020] px-3 text-sm"
            >
              <option value="loudness">感知响度（EBU R128 / LUFS）</option>
              <option value="rms">RMS</option>
            </select>
          </div>

          {algorithm === 'loudness' ? (
            <div className="space-y-2">
              <Label htmlFor="loudness-lufs">目标响度（LUFS）</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="loudness-lufs"
                  aria-label="目标响度（LUFS）"
                  inputMode="decimal"
                  value={lufsDraft}
                  disabled={isApplying || isPreviewing}
                  onChange={(event) => { setLufsDraft(event.target.value); setPreviewError(''); }}
                  className="h-9 w-36"
                />
                <span>LUFS</span><span className="text-xs text-[#9d9d9d]">范围 −145 至 0</span>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="loudness-rms">目标 RMS（dB）</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="loudness-rms"
                  aria-label="目标 RMS（dB）"
                  inputMode="decimal"
                  value={rmsDraft}
                  disabled={isApplying || isPreviewing}
                  onChange={(event) => { setRmsDraft(event.target.value); setPreviewError(''); }}
                  className="h-9 w-36"
                />
                <span>dB</span><span className="text-xs text-[#9d9d9d]">范围 −145 至 0</span>
              </div>
            </div>
          )}

          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={stereoIndependent}
              disabled={isApplying || isPreviewing}
              onChange={(event) => setStereoIndependent(event.target.checked)}
            />
            <span>独立处理立体声声道</span>
          </label>

          {algorithm === 'loudness' && (
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={dualMono}
                disabled={isApplying || isPreviewing}
                onChange={(event) => setDualMono(event.target.checked)}
              />
              <span>将单声道视为 dual-mono（额外 −3 LU）</span>
            </label>
          )}

          <p className="text-xs leading-5 text-[#9d9d9d]">
            {algorithm === 'loudness'
              ? '采用两级 K-weighting、400ms block、100ms step 和绝对/相对门控；联动立体声按声道总功率分析。'
              : '联动立体声按两个声道 RMS 的二次域合并；独立模式分别调整每个声道。'}
          </p>

          {!hasSelection && <p className="text-xs text-[#e0b25f]">请先选择要处理的音频。</p>}
          {validationError && <p role="alert" className="text-xs text-[#ef8d8d]">{validationError}</p>}
          {previewError && (
            <div className="flex items-center gap-2 text-xs text-[#ef8d8d]" role="alert">
              <AlertCircle className="size-4" />{previewError}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={reset} disabled={isApplying || isPreviewing}>
            <RotateCcw className="mr-2 size-4" />重置
          </Button>
          <Button
            type="button" variant="outline" aria-pressed={isPreviewing}
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
