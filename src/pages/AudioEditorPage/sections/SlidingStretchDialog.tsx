import { useEffect, useRef, useState } from 'react';
import { AlertCircle, AudioWaveform, Play, RotateCcw } from 'lucide-react';
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
  DEFAULT_SLIDING_STRETCH_SETTINGS,
  durationAfterSlidingStretch,
  isSlidingStretchBypassed,
  MAX_SLIDING_STRETCH_PITCH_PERCENT,
  MAX_SLIDING_STRETCH_PITCH_SEMITONES,
  MAX_SLIDING_STRETCH_TEMPO_PERCENT,
  MIN_SLIDING_STRETCH_PITCH_PERCENT,
  MIN_SLIDING_STRETCH_PITCH_SEMITONES,
  MIN_SLIDING_STRETCH_TEMPO_PERCENT,
  slidingStretchPercentToSemitones,
  slidingStretchSemitonesToPercent,
  validateSlidingStretchSettings,
  type SlidingStretchSettings,
} from '@/lib/slidingStretchEffect';

interface SlidingStretchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectionDuration: number;
  sampleRate: number;
  hasSelection: boolean;
  isApplying: boolean;
  onPreview: (settings: SlidingStretchSettings) => Promise<Float32Array[]>;
  onApply: (settings: SlidingStretchSettings) => void;
}

type Drafts = Record<keyof SlidingStretchSettings, string>;
type TempoKey = 'initialTempoPercent' | 'finalTempoPercent';
type SemitonesKey = 'initialPitchSemitones' | 'finalPitchSemitones';
type PitchPercentKey = 'initialPitchPercent' | 'finalPitchPercent';

function fixed(value: number, digits: number): string {
  if (!Number.isFinite(value)) return '';
  const result = value.toFixed(digits);
  return result === `-${(0).toFixed(digits)}` ? (0).toFixed(digits) : result;
}

function defaultDrafts(): Drafts {
  return {
    initialTempoPercent: '0.000',
    finalTempoPercent: '0.000',
    initialPitchSemitones: '0.00',
    finalPitchSemitones: '0.00',
    initialPitchPercent: '0.000',
    finalPitchPercent: '0.000',
  };
}

function parseDraft(value: string): number {
  return value.trim() === '' ? Number.NaN : Number(value);
}

interface TempoCardProps {
  title: string;
  label: string;
  sliderLabel: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}

function TempoCard({ title, label, sliderLabel, value, disabled, onChange }: TempoCardProps) {
  const numeric = parseDraft(value);
  const sliderValue = Number.isFinite(numeric)
    ? Math.max(MIN_SLIDING_STRETCH_TEMPO_PERCENT, Math.min(MAX_SLIDING_STRETCH_TEMPO_PERCENT, numeric))
    : 0;
  return (
    <fieldset className="space-y-3 rounded-md border border-[#454545] p-3">
      <legend className="px-1 text-xs font-medium text-[#e4e5e7]">{title}</legend>
      <Label htmlFor={label}>{label}</Label>
      <input
        aria-label={sliderLabel}
        type="range"
        min={MIN_SLIDING_STRETCH_TEMPO_PERCENT}
        max={MAX_SLIDING_STRETCH_TEMPO_PERCENT}
        step={1}
        value={sliderValue}
        disabled={disabled}
        onChange={(event) => onChange(fixed(Number(event.target.value), 3))}
        className="w-full"
      />
      <div className="flex items-center gap-2">
        <Input
          id={label}
          aria-label={label}
          inputMode="decimal"
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          className="h-9 w-32"
        />
        <span className="text-xs text-[#9d9d9d]">%</span>
      </div>
    </fieldset>
  );
}

interface PitchCardProps {
  title: string;
  semitonesLabel: string;
  percentLabel: string;
  sliderLabel: string;
  semitonesValue: string;
  percentValue: string;
  disabled: boolean;
  onSemitonesChange: (value: string) => void;
  onPercentChange: (value: string) => void;
}

function PitchCard({
  title,
  semitonesLabel,
  percentLabel,
  sliderLabel,
  semitonesValue,
  percentValue,
  disabled,
  onSemitonesChange,
  onPercentChange,
}: PitchCardProps) {
  const numeric = parseDraft(percentValue);
  const sliderValue = Number.isFinite(numeric)
    ? Math.max(MIN_SLIDING_STRETCH_PITCH_PERCENT, Math.min(MAX_SLIDING_STRETCH_PITCH_PERCENT, numeric))
    : 0;
  return (
    <fieldset className="space-y-3 rounded-md border border-[#454545] p-3">
      <legend className="px-1 text-xs font-medium text-[#e4e5e7]">{title}</legend>
      <div className="space-y-1.5">
        <Label htmlFor={semitonesLabel}>
          半音（{MIN_SLIDING_STRETCH_PITCH_SEMITONES} → {MAX_SLIDING_STRETCH_PITCH_SEMITONES}）
        </Label>
        <Input
          id={semitonesLabel}
          aria-label={semitonesLabel}
          inputMode="decimal"
          value={semitonesValue}
          disabled={disabled}
          onChange={(event) => onSemitonesChange(event.target.value)}
          className="h-9 w-32"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={percentLabel}>百分比变化</Label>
        <input
          aria-label={sliderLabel}
          type="range"
          min={MIN_SLIDING_STRETCH_PITCH_PERCENT}
          max={MAX_SLIDING_STRETCH_PITCH_PERCENT}
          step={1}
          value={sliderValue}
          disabled={disabled}
          onChange={(event) => onPercentChange(fixed(Number(event.target.value), 3))}
          className="w-full"
        />
        <div className="flex items-center gap-2">
          <Input
            id={percentLabel}
            aria-label={percentLabel}
            inputMode="decimal"
            value={percentValue}
            disabled={disabled}
            onChange={(event) => onPercentChange(event.target.value)}
            className="h-9 w-32"
          />
          <span className="text-xs text-[#9d9d9d]">%</span>
        </div>
      </div>
    </fieldset>
  );
}

export function SlidingStretchDialog({
  open,
  onOpenChange,
  selectionDuration,
  sampleRate,
  hasSelection,
  isApplying,
  onPreview,
  onApply,
}: SlidingStretchDialogProps) {
  const [drafts, setDrafts] = useState<Drafts>(defaultDrafts);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const previewContextRef = useRef<AudioContext | null>(null);
  const previewSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const previewRequestRef = useRef(0);

  const settings: SlidingStretchSettings = {
    initialTempoPercent: parseDraft(drafts.initialTempoPercent),
    finalTempoPercent: parseDraft(drafts.finalTempoPercent),
    initialPitchSemitones: parseDraft(drafts.initialPitchSemitones),
    finalPitchSemitones: parseDraft(drafts.finalPitchSemitones),
    initialPitchPercent: parseDraft(drafts.initialPitchPercent),
    finalPitchPercent: parseDraft(drafts.finalPitchPercent),
  };
  let validationError: string | null = null;
  try {
    validateSlidingStretchSettings(settings);
  } catch (error) {
    validationError = error instanceof Error ? error.message : '参数无效';
  }
  const valid = validationError === null;
  const bypassed = valid && isSlidingStretchBypassed(settings);
  const unavailable = !hasSelection || isApplying || isPreviewing;
  const actionsDisabled = unavailable || !valid || bypassed;
  const expectedDuration = valid && selectionDuration >= 0
    ? durationAfterSlidingStretch(selectionDuration, settings)
    : Number.NaN;

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
    setDrafts(defaultDrafts());
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
  }, [open, selectionDuration]);

  function changeTempo(key: TempoKey, value: string) {
    setPreviewError(null);
    setDrafts((current) => ({ ...current, [key]: value }));
  }

  function changeSemitones(key: SemitonesKey, value: string) {
    setPreviewError(null);
    const percentKey: PitchPercentKey = key === 'initialPitchSemitones'
      ? 'initialPitchPercent'
      : 'finalPitchPercent';
    setDrafts((current) => {
      const next = { ...current, [key]: value };
      const semitones = parseDraft(value);
      if (
        Number.isFinite(semitones)
        && semitones >= MIN_SLIDING_STRETCH_PITCH_SEMITONES
        && semitones <= MAX_SLIDING_STRETCH_PITCH_SEMITONES
      ) {
        next[percentKey] = fixed(slidingStretchSemitonesToPercent(semitones), 6);
      }
      return next;
    });
  }

  function changePitchPercent(key: PitchPercentKey, value: string) {
    setPreviewError(null);
    const semitonesKey: SemitonesKey = key === 'initialPitchPercent'
      ? 'initialPitchSemitones'
      : 'finalPitchSemitones';
    setDrafts((current) => {
      const next = { ...current, [key]: value };
      const percent = parseDraft(value);
      if (
        Number.isFinite(percent)
        && percent >= MIN_SLIDING_STRETCH_PITCH_PERCENT
        && percent <= MAX_SLIDING_STRETCH_PITCH_PERCENT
      ) {
        next[semitonesKey] = fixed(slidingStretchPercentToSemitones(percent), 6);
      }
      return next;
    });
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
      <DialogContent className="max-w-2xl border-[#3a3a3a] bg-[#2b2b2b] text-[#d4d4d4]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AudioWaveform className="size-4" />
            Sliding stretch
          </DialogTitle>
          <DialogDescription>
            按 Audacity 线性输出速率连续改变选区 Tempo 和/或音高；片段间隙与后续时间点同步映射。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2 text-sm">
          <div className="grid gap-3 sm:grid-cols-2">
            <TempoCard
              title="Initial tempo change"
              label="初始 Tempo 变化（%）"
              sliderLabel="初始 Tempo 滑块"
              value={drafts.initialTempoPercent}
              disabled={unavailable}
              onChange={(value) => changeTempo('initialTempoPercent', value)}
            />
            <TempoCard
              title="Final tempo change"
              label="最终 Tempo 变化（%）"
              sliderLabel="最终 Tempo 滑块"
              value={drafts.finalTempoPercent}
              disabled={unavailable}
              onChange={(value) => changeTempo('finalTempoPercent', value)}
            />
            <PitchCard
              title="Initial pitch shift"
              semitonesLabel="初始音高半音数"
              percentLabel="初始音高变化（%）"
              sliderLabel="初始音高百分比滑块"
              semitonesValue={drafts.initialPitchSemitones}
              percentValue={drafts.initialPitchPercent}
              disabled={unavailable}
              onSemitonesChange={(value) => changeSemitones('initialPitchSemitones', value)}
              onPercentChange={(value) => changePitchPercent('initialPitchPercent', value)}
            />
            <PitchCard
              title="Final pitch shift"
              semitonesLabel="最终音高半音数"
              percentLabel="最终音高变化（%）"
              sliderLabel="最终音高百分比滑块"
              semitonesValue={drafts.finalPitchSemitones}
              percentValue={drafts.finalPitchPercent}
              disabled={unavailable}
              onSemitonesChange={(value) => changeSemitones('finalPitchSemitones', value)}
              onPercentChange={(value) => changePitchPercent('finalPitchPercent', value)}
            />
          </div>

          <div className="rounded-md border border-[#454545] px-3 py-2 text-xs text-[#b8b8b8]">
            <p>Tempo 范围 −90%…500%；音高百分比范围 −50%…100%。</p>
            <p>
              选区时长 {selectionDuration.toFixed(3)} 秒 → 预计 {Number.isFinite(expectedDuration) ? expectedDuration.toFixed(3) : '—'} 秒
            </p>
            <p className="mt-1 text-[#9d9d9d]">
              Web 端采用确定性重采样 + WSOLA 回退，保留官方时间映射；不宣称与 SBSMS 逐采样或位一致。
            </p>
          </div>

          {!hasSelection && <p className="text-xs text-[#e0b25f]">请先选择要处理的音频。</p>}
          {validationError && <p role="alert" className="text-xs text-[#ef8d8d]">{validationError}</p>}
          {bypassed && (
            <p className="text-xs text-[#9d9d9d]">请输入非零 Tempo 或音高变化以启用试听和应用。</p>
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
