import { useEffect, useRef, useState } from 'react';
import { AlertCircle, Play, RotateCcw, Timer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  bpmAfterChangeTempo,
  CHANGE_TEMPO_SLIDER_MAX,
  durationAfterChangeTempo,
  isChangeTempoPercentValid,
  MAX_CHANGE_TEMPO_PERCENT,
  MIN_CHANGE_TEMPO_PERCENT,
  percentChangeFromBpm,
  percentChangeFromDuration,
  percentChangeFromSlider,
  sliderFromPercentChange,
  type ChangeTempoSettings,
} from '@/lib/changeTempoEffect';

interface ChangeTempoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectionStart: number;
  selectionEnd: number;
  sampleRate: number;
  initialBpm: number;
  hasSelection: boolean;
  isApplying: boolean;
  onPreview: (settings: ChangeTempoSettings) => Promise<Float32Array[]>;
  onApply: (settings: ChangeTempoSettings) => void;
}

function parseDraft(value: string): number {
  return value.trim() === '' ? Number.NaN : Number(value);
}

function fixed(value: number, digits: number): string {
  if (!Number.isFinite(value)) return '';
  const result = value.toFixed(digits);
  return result === `-${(0).toFixed(digits)}` ? (0).toFixed(digits) : result;
}

export function ChangeTempoDialog({
  open,
  onOpenChange,
  selectionStart,
  selectionEnd,
  sampleRate,
  initialBpm,
  hasSelection,
  isApplying,
  onPreview,
  onApply,
}: ChangeTempoDialogProps) {
  const selectionDuration = Math.max(0, selectionEnd - selectionStart);
  const [percentDraft, setPercentDraft] = useState('0.000');
  const [fromBpmDraft, setFromBpmDraft] = useState(() => fixed(initialBpm, 3));
  const [toBpmDraft, setToBpmDraft] = useState(() => fixed(initialBpm, 3));
  const [toLengthDraft, setToLengthDraft] = useState(() => fixed(selectionDuration, 2));
  const [editError, setEditError] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const previewContextRef = useRef<AudioContext | null>(null);
  const previewSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const previewRequestRef = useRef(0);

  const percentChange = parseDraft(percentDraft);
  const validPercent = isChangeTempoPercentValid(percentChange);
  const settings: ChangeTempoSettings = { percentChange };
  const sliderValue = validPercent ? sliderFromPercentChange(percentChange) : 0;
  const unavailable = !hasSelection || isApplying || isPreviewing;
  const actionsDisabled = unavailable
    || !validPercent
    || percentChange === 0
    || Boolean(editError);

  function stopPreview() {
    previewRequestRef.current += 1;
    const source = previewSourceRef.current;
    previewSourceRef.current = null;
    const context = previewContextRef.current;
    previewContextRef.current = null;
    if (source) {
      source.onended = null;
      try { source.stop(); } catch { /* already stopped */ }
      source.disconnect();
    }
    if (context) void context.close().catch(() => undefined);
    setIsPreviewing(false);
  }

  function reset() {
    stopPreview();
    setPercentDraft('0.000');
    setFromBpmDraft(fixed(initialBpm, 3));
    setToBpmDraft(fixed(initialBpm, 3));
    setToLengthDraft(fixed(selectionDuration, 2));
    setEditError(null);
    setPreviewError(null);
  }

  useEffect(() => {
    if (open) reset();
    return () => {
      previewRequestRef.current += 1;
      const source = previewSourceRef.current;
      previewSourceRef.current = null;
      const context = previewContextRef.current;
      previewContextRef.current = null;
      if (source) {
        source.onended = null;
        try { source.stop(); } catch { /* already stopped */ }
        source.disconnect();
      }
      if (context) void context.close().catch(() => undefined);
    };
    // A newly opened dialog always starts from the current selection.
  }, [open, selectionStart, selectionEnd, initialBpm]);

  function updateLinkedFields(
    nextPercent: number,
    source: 'percent' | 'length' | 'bpm' | 'slider',
  ) {
    if (source !== 'percent') setPercentDraft(fixed(nextPercent, 3));
    if (!isChangeTempoPercentValid(nextPercent)) {
      setEditError(`Tempo 变化必须在 ${MIN_CHANGE_TEMPO_PERCENT}% 至 ${MAX_CHANGE_TEMPO_PERCENT}% 之间`);
      return;
    }
    setEditError(null);
    const nextSettings = { percentChange: nextPercent };
    if (source !== 'length') {
      setToLengthDraft(fixed(durationAfterChangeTempo(selectionDuration, nextSettings), 2));
    }
    const fromBpm = parseDraft(fromBpmDraft);
    if (source !== 'bpm' && Number.isFinite(fromBpm) && fromBpm > 0) {
      setToBpmDraft(fixed(bpmAfterChangeTempo(fromBpm, nextSettings), 3));
    }
  }

  function changePercent(value: string) {
    setPercentDraft(value);
    updateLinkedFields(parseDraft(value), 'percent');
  }

  function changeFromBpm(value: string) {
    setFromBpmDraft(value);
    setPreviewError(null);
    const fromBpm = parseDraft(value);
    if (value.trim() === '') {
      setToBpmDraft('');
      setEditError(null);
      return;
    }
    if (!Number.isFinite(fromBpm) || fromBpm <= 0) {
      setEditError('原始 BPM 必须大于零');
      return;
    }
    if (!validPercent) return;
    setEditError(null);
    setToBpmDraft(fixed(bpmAfterChangeTempo(fromBpm, settings), 3));
  }

  function changeToBpm(value: string) {
    setToBpmDraft(value);
    setPreviewError(null);
    const fromBpm = parseDraft(fromBpmDraft);
    const toBpm = parseDraft(value);
    if (!Number.isFinite(fromBpm) || fromBpm <= 0 || !Number.isFinite(toBpm) || toBpm <= 0) {
      setEditError('请输入大于零的原始 BPM 和目标 BPM');
      return;
    }
    updateLinkedFields(percentChangeFromBpm(fromBpm, toBpm), 'bpm');
  }

  function changeToLength(value: string) {
    setToLengthDraft(value);
    setPreviewError(null);
    const targetLength = parseDraft(value);
    if (!Number.isFinite(targetLength) || targetLength <= 0 || selectionDuration <= 0) {
      setEditError('目标时长必须大于零');
      return;
    }
    updateLinkedFields(percentChangeFromDuration(selectionDuration, targetLength), 'length');
  }

  async function preview() {
    if (actionsDisabled) return;
    stopPreview();
    const requestId = previewRequestRef.current;
    setPreviewError(null);
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

  function changeOpen(nextOpen: boolean) {
    if (!nextOpen) stopPreview();
    onOpenChange(nextOpen);
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className="max-w-lg border-[#3a3a3a] bg-[#2b2b2b] text-[#d4d4d4]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Timer className="size-4" />
            Change Tempo（保持音高）
          </DialogTitle>
          <DialogDescription>
            改变选区速度而不改变音高；片段间隙和后续时间点同步调整。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2 text-sm">
          <div className="space-y-2">
            <Label htmlFor="change-tempo-percent">变化百分比（%）</Label>
            <input
              aria-label="变化百分比滑块"
              type="range"
              min={MIN_CHANGE_TEMPO_PERCENT}
              max={CHANGE_TEMPO_SLIDER_MAX}
              step={1}
              value={sliderValue}
              disabled={unavailable}
              onChange={(event) => updateLinkedFields(
                percentChangeFromSlider(Number(event.target.value)), 'slider',
              )}
              className="w-full"
            />
            <div className="flex items-center gap-2">
              <Input
                id="change-tempo-percent"
                aria-label="变化百分比（%）"
                inputMode="decimal"
                value={percentDraft}
                disabled={unavailable}
                onChange={(event) => changePercent(event.target.value)}
                className="h-9 w-36"
              />
              <span className="text-xs text-[#9d9d9d]">−95 至 3000；0 为不处理</span>
            </div>
          </div>

          <fieldset className="space-y-2 rounded-md border border-[#454545] p-3">
            <legend className="px-1 text-xs text-[#b8b8b8]">每分钟节拍（BPM）</legend>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="change-tempo-from-bpm">原始 BPM</Label>
                <Input
                  id="change-tempo-from-bpm"
                  aria-label="原始 BPM"
                  inputMode="decimal"
                  placeholder="可选"
                  value={fromBpmDraft}
                  disabled={unavailable}
                  onChange={(event) => changeFromBpm(event.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="change-tempo-to-bpm">目标 BPM</Label>
                <Input
                  id="change-tempo-to-bpm"
                  aria-label="目标 BPM"
                  inputMode="decimal"
                  placeholder="可选"
                  value={toBpmDraft}
                  disabled={unavailable}
                  onChange={(event) => changeToBpm(event.target.value)}
                />
              </div>
            </div>
          </fieldset>

          <fieldset className="space-y-2 rounded-md border border-[#454545] p-3">
            <legend className="px-1 text-xs text-[#b8b8b8]">时长（秒）</legend>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="change-tempo-from-length">原始时长</Label>
                <Input
                  id="change-tempo-from-length"
                  aria-label="原始时长（秒）"
                  value={fixed(selectionDuration, 2)}
                  readOnly
                  disabled
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="change-tempo-to-length">目标时长</Label>
                <Input
                  id="change-tempo-to-length"
                  aria-label="目标时长（秒）"
                  inputMode="decimal"
                  value={toLengthDraft}
                  disabled={unavailable}
                  onChange={(event) => changeToLength(event.target.value)}
                />
              </div>
            </div>
          </fieldset>

          {!hasSelection && <p className="text-xs text-[#e0b25f]">请先选择要处理的音频。</p>}
          {!validPercent && (
            <p role="alert" className="text-xs text-[#ef8d8d]">
              Tempo 变化必须在 {MIN_CHANGE_TEMPO_PERCENT}% 至 {MAX_CHANGE_TEMPO_PERCENT}% 之间。
            </p>
          )}
          {editError && validPercent && <p role="alert" className="text-xs text-[#ef8d8d]">{editError}</p>}
          {percentChange === 0 && validPercent && !editError && (
            <p className="text-xs text-[#9d9d9d]">请输入非零变化以启用试听和应用。</p>
          )}
          {previewError && (
            <div className="flex items-center gap-2 text-xs text-[#ef8d8d]" role="alert">
              <AlertCircle className="size-4" />
              {previewError}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={reset} disabled={unavailable}>
            <RotateCcw className="mr-2 size-4" />重置
          </Button>
          <Button
            type="button"
            variant="outline"
            aria-pressed={isPreviewing}
            onClick={isPreviewing ? stopPreview : () => void preview()}
            disabled={!isPreviewing && actionsDisabled}
          >
            <Play className="mr-2 size-4" />{isPreviewing ? '停止试听' : '试听'}
          </Button>
          <Button
            type="button"
            onClick={() => { if (!actionsDisabled) onApply(settings); }}
            disabled={actionsDisabled}
          >
            {isApplying ? '应用中…' : '应用'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
