import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, Play, RotateCcw, Volume2 } from 'lucide-react';
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
  amplificationDbFromRatio,
  DEFAULT_AMPLIFY_SETTINGS,
  defaultAmplifyRatio,
  isAmplifyAllowed,
  MAX_AMPLIFICATION_DB,
  MIN_AMPLIFICATION_DB,
  newPeakDbFromRatio,
  ratioFromAmplificationDb,
  ratioFromNewPeakDb,
  type AmplifySettings,
} from '@/lib/amplifyEffect';
import { formatTime } from '@/lib/audioUtils';

interface AmplifyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectionStart: number;
  selectionEnd: number;
  sampleRate: number;
  hasSelection: boolean;
  isApplying: boolean;
  onAnalyze: () => Promise<number>;
  onPreview: (settings: AmplifySettings) => Promise<Float32Array[]>;
  onApply: (settings: AmplifySettings) => void;
}

function formatDb(value: number): string {
  return (Math.abs(value) < 0.00005 ? 0 : value).toFixed(4);
}

export function AmplifyDialog({
  open,
  onOpenChange,
  selectionStart,
  selectionEnd,
  sampleRate,
  hasSelection,
  isApplying,
  onAnalyze,
  onPreview,
  onApply,
}: AmplifyDialogProps) {
  const [inputPeak, setInputPeak] = useState(0);
  const [ratio, setRatio] = useState(DEFAULT_AMPLIFY_SETTINGS.ratio);
  const [ampDraft, setAmpDraft] = useState('0.0000');
  const [peakDraft, setPeakDraft] = useState('0.0000');
  const [allowClipping, setAllowClipping] = useState(DEFAULT_AMPLIFY_SETTINGS.allowClipping);
  const [analysisError, setAnalysisError] = useState('');
  const [previewError, setPreviewError] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const analyzeRequestRef = useRef(0);
  const onAnalyzeRef = useRef(onAnalyze);
  onAnalyzeRef.current = onAnalyze;
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
      analyzeRequestRef.current += 1;
      stopPreview();
      return;
    }
    stopPreview();
    const requestId = analyzeRequestRef.current + 1;
    analyzeRequestRef.current = requestId;
    setInputPeak(0);
    setRatio(DEFAULT_AMPLIFY_SETTINGS.ratio);
    setAmpDraft('0.0000');
    setPeakDraft('0.0000');
    setAllowClipping(DEFAULT_AMPLIFY_SETTINGS.allowClipping);
    setAnalysisError('');
    setPreviewError('');
    setIsAnalyzing(true);
    void onAnalyzeRef.current().then((peak) => {
      if (requestId !== analyzeRequestRef.current) return;
      const nextRatio = defaultAmplifyRatio(peak);
      setInputPeak(peak);
      setRatio(nextRatio);
      setAmpDraft(formatDb(amplificationDbFromRatio(nextRatio)));
      setPeakDraft(formatDb(newPeakDbFromRatio(nextRatio, peak)));
    }).catch((error: unknown) => {
      if (requestId !== analyzeRequestRef.current) return;
      setAnalysisError(error instanceof Error ? error.message : '选区峰值分析失败');
    }).finally(() => {
      if (requestId === analyzeRequestRef.current) setIsAnalyzing(false);
    });
    return () => {
      analyzeRequestRef.current += 1;
    };
  }, [open, stopPreview]);

  useEffect(() => () => {
    previewRequestRef.current += 1;
    analyzeRequestRef.current += 1;
    const source = previewSourceRef.current;
    const context = previewContextRef.current;
    if (source) {
      source.onended = null;
      try { source.stop(); } catch { /* Source may already have ended. */ }
      source.disconnect();
    }
    if (context) void context.close().catch(() => undefined);
  }, []);

  const settings: AmplifySettings = { ratio, allowClipping };
  const editInvalid = !ampDraft.trim() || !peakDraft.trim()
    || !Number.isFinite(Number(ampDraft)) || !Number.isFinite(Number(peakDraft));
  const allowed = inputPeak > 0 && isAmplifyAllowed(settings, inputPeak);
  const unavailable = isApplying || isAnalyzing || !hasSelection || editInvalid
    || Boolean(analysisError) || inputPeak <= 0;
  const applyDisabled = unavailable || isPreviewing || !allowed;
  const previewDisabled = unavailable;
  const inputPeakDb = inputPeak > 0 ? 20 * Math.log10(inputPeak) : 0;
  const ampValue = amplificationDbFromRatio(ratio);
  const newPeakValue = newPeakDbFromRatio(ratio, inputPeak);

  function syncDrafts(nextRatio: number) {
    setRatio(nextRatio);
    setAmpDraft(formatDb(amplificationDbFromRatio(nextRatio)));
    setPeakDraft(formatDb(newPeakDbFromRatio(nextRatio, inputPeak)));
    setPreviewError('');
  }

  function changeAmplification(value: string) {
    setAmpDraft(value);
    setPreviewError('');
    if (!value.trim() || !Number.isFinite(Number(value)) || inputPeak <= 0) return;
    const nextRatio = ratioFromAmplificationDb(Number(value));
    setRatio(nextRatio);
    setPeakDraft(formatDb(newPeakDbFromRatio(nextRatio, inputPeak)));
  }

  function changeNewPeak(value: string) {
    setPeakDraft(value);
    setPreviewError('');
    if (!value.trim() || !Number.isFinite(Number(value)) || inputPeak <= 0) return;
    const nextRatio = ratioFromNewPeakDb(Number(value), inputPeak);
    setRatio(nextRatio);
    setAmpDraft(formatDb(amplificationDbFromRatio(nextRatio)));
  }

  function reset() {
    stopPreview();
    const nextRatio = defaultAmplifyRatio(inputPeak);
    setAllowClipping(DEFAULT_AMPLIFY_SETTINGS.allowClipping);
    syncDrafts(nextRatio);
  }

  function changeOpen(nextOpen: boolean) {
    if (!nextOpen) {
      analyzeRequestRef.current += 1;
      stopPreview();
    }
    onOpenChange(nextOpen);
  }

  async function preview() {
    if (previewDisabled || isPreviewing) return;
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
            <Volume2 className="size-4" />
            放大
          </DialogTitle>
          <DialogDescription>
            分析整个选区的峰值，统一调整所有选中轨道的增益。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2 text-sm">
          <div className="flex justify-between gap-4 text-xs text-[#9d9d9d]">
            <span>选区：{formatTime(selectionStart)} – {formatTime(selectionEnd)}</span>
            <span>{(selectionEnd - selectionStart).toFixed(3)} 秒</span>
          </div>
          <div className="text-xs text-[#9d9d9d]">
            {isAnalyzing ? '正在分析选区峰值…' : `选区峰值：${formatDb(inputPeakDb)} dB`}
          </div>

          <div className="space-y-2">
            <Label htmlFor="amplify-amount">放大增益（dB）</Label>
            <input
              aria-label="放大增益滑块"
              type="range"
              min={MIN_AMPLIFICATION_DB}
              max={MAX_AMPLIFICATION_DB}
              step={0.02}
              value={ampValue}
              disabled={unavailable || isPreviewing}
              onChange={(event) => syncDrafts(ratioFromAmplificationDb(Number(event.target.value)))}
              className="w-full"
            />
            <div className="flex items-center gap-2">
              <Input
                id="amplify-amount"
                aria-label="放大增益（dB）"
                inputMode="decimal"
                value={ampDraft}
                disabled={unavailable || isPreviewing}
                onChange={(event) => changeAmplification(event.target.value)}
                onBlur={() => syncDrafts(ratio)}
                className="h-9 w-36"
              />
              <span>dB</span>
              <span className="text-xs text-[#9d9d9d]">范围约 −50 至 50</span>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="amplify-new-peak">新峰值振幅（dB）</Label>
            <input
              aria-label="新峰值振幅滑块"
              type="range"
              min={MIN_AMPLIFICATION_DB + inputPeakDb}
              max={MAX_AMPLIFICATION_DB + inputPeakDb}
              step={0.02}
              value={newPeakValue}
              disabled={unavailable || isPreviewing}
              onChange={(event) => syncDrafts(ratioFromNewPeakDb(Number(event.target.value), inputPeak))}
              className="w-full"
            />
            <div className="flex items-center gap-2">
              <Input
                id="amplify-new-peak"
                aria-label="新峰值振幅（dB）"
                inputMode="decimal"
                value={peakDraft}
                disabled={unavailable || isPreviewing}
                onChange={(event) => changeNewPeak(event.target.value)}
                onBlur={() => syncDrafts(ratio)}
                className="h-9 w-36"
              />
              <span>dB</span>
            </div>
          </div>

          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={allowClipping}
              disabled={isApplying || isPreviewing || isAnalyzing}
              onChange={(event) => setAllowClipping(event.target.checked)}
            />
            <span>允许削波</span>
          </label>

          {!hasSelection && <p className="text-xs text-[#e0b25f]">请先选择要处理的音频。</p>}
          {editInvalid && <p role="alert" className="text-xs text-[#ef8d8d]">请输入有效的增益和新峰值。</p>}
          {analysisError && <p role="alert" className="text-xs text-[#ef8d8d]">{analysisError}</p>}
          {!allowed && !unavailable && (
            <p className="text-xs text-[#e0b25f]">新峰值超过 0 dB；请降低增益或明确允许削波。</p>
          )}
          {previewError && (
            <div className="flex items-center gap-2 text-xs text-[#ef8d8d]" role="alert">
              <AlertCircle className="size-4" />
              {previewError}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={reset} disabled={unavailable || isPreviewing}>
            <RotateCcw className="mr-2 size-4" />重置
          </Button>
          <Button
            type="button"
            variant="outline"
            aria-pressed={isPreviewing}
            onClick={isPreviewing ? stopPreview : () => void preview()}
            disabled={previewDisabled}
          >
            <Play className="mr-2 size-4" />{isPreviewing ? '停止试听' : '试听'}
          </Button>
          <Button
            type="button"
            onClick={() => { if (!applyDisabled) onApply(settings); }}
            disabled={applyDisabled}
          >
            {isApplying ? '应用中…' : '应用'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
