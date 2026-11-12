import { useEffect, useMemo, useState, type FormEvent } from 'react';
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
import { formatTime } from '@/lib/audioUtils';
import {
  DEFAULT_TRUNCATE_SILENCE_SETTINGS,
  validateTruncateSilenceSettings,
  type TruncateSilenceAction,
  type TruncateSilenceSettings,
} from '@/lib/truncateSilenceEffect';
import type { PreviewChannels } from '@/lib/generatorPreview';
import { useGeneratorPreview } from './useGeneratorPreview';

interface TruncateSilenceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sampleRate: number;
  selectionStart: number;
  selectionEnd: number;
  hasSelection: boolean;
  isApplying: boolean;
  onPreview: (settings: TruncateSilenceSettings) => Promise<PreviewChannels>;
  onApply: (settings: TruncateSilenceSettings) => void | Promise<void>;
}

type NumericField = 'thresholdDb' | 'minimumDuration' | 'truncateDuration' | 'compressPercent';
type Drafts = Record<NumericField, string>;

const DEFAULT_DRAFTS: Drafts = {
  thresholdDb: String(DEFAULT_TRUNCATE_SILENCE_SETTINGS.thresholdDb),
  minimumDuration: String(DEFAULT_TRUNCATE_SILENCE_SETTINGS.minimumDuration),
  truncateDuration: String(DEFAULT_TRUNCATE_SILENCE_SETTINGS.truncateDuration),
  compressPercent: String(DEFAULT_TRUNCATE_SILENCE_SETTINGS.compressPercent),
};

const CONTROLS: Record<NumericField, {
  label: string;
  minimum: number;
  maximum: number;
  step: number;
}> = {
  thresholdDb: { label: 'Threshold (dB)', minimum: -80, maximum: -20, step: 1 },
  minimumDuration: { label: 'Duration (seconds)', minimum: 0.001, maximum: 10000, step: 0.001 },
  truncateDuration: { label: 'Truncate to (seconds)', minimum: 0, maximum: 10000, step: 0.001 },
  compressPercent: { label: 'Compress to (%)', minimum: 0, maximum: 99.9, step: 0.1 },
};

interface NumericControlProps {
  field: NumericField;
  value: string;
  onChange: (value: string) => void;
}

function NumericControl({ field, value, onChange }: NumericControlProps) {
  const { label, minimum, maximum, step } = CONTROLS[field];
  const sliderValue = Number(value);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={`truncate-silence-${field}`}>{label}</Label>
        <Input
          id={`truncate-silence-${field}`}
          data-testid={`truncate-silence-${field}-input`}
          type="number"
          min={minimum}
          max={maximum}
          step={step}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-8 w-28"
          required
        />
      </div>
      <input
        type="range"
        aria-label={`${label}滑块`}
        min={minimum}
        max={maximum}
        step={step}
        value={Number.isFinite(sliderValue) ? sliderValue : minimum}
        onChange={(event) => onChange(event.target.value)}
        className="w-full accent-primary"
      />
    </div>
  );
}

export default function TruncateSilenceDialog({
  open,
  onOpenChange,
  sampleRate,
  selectionStart,
  selectionEnd,
  hasSelection,
  isApplying,
  onPreview,
  onApply,
}: TruncateSilenceDialogProps) {
  const [drafts, setDrafts] = useState<Drafts>({ ...DEFAULT_DRAFTS });
  const [action, setAction] = useState<TruncateSilenceAction>(DEFAULT_TRUNCATE_SILENCE_SETTINGS.action);
  const [independent, setIndependent] = useState(DEFAULT_TRUNCATE_SILENCE_SETTINGS.independent);
  const { isPreviewing, previewError, startPreview, stopPreview } = useGeneratorPreview();
  const settings = useMemo<TruncateSilenceSettings>(() => ({
    thresholdDb: Number(drafts.thresholdDb),
    minimumDuration: Number(drafts.minimumDuration),
    action,
    truncateDuration: Number(drafts.truncateDuration),
    compressPercent: Number(drafts.compressPercent),
    independent,
  }), [action, drafts, independent]);

  const validationError = useMemo(() => {
    if (Object.values(drafts).some((value) => !value.trim())) return '请填写全部 Truncate Silence 参数';
    try {
      validateTruncateSilenceSettings(settings);
      return '';
    } catch (error) {
      return error instanceof Error ? error.message : 'Truncate Silence 参数无效';
    }
  }, [drafts, settings]);

  useEffect(() => {
    if (!open) stopPreview();
  }, [open, stopPreview]);

  function changeOpen(nextOpen: boolean) {
    if (!nextOpen) stopPreview();
    onOpenChange(nextOpen);
  }

  function changeDraft(field: NumericField, value: string) {
    setDrafts((current) => ({ ...current, [field]: value }));
    stopPreview();
  }

  function reset() {
    setDrafts({ ...DEFAULT_DRAFTS });
    setAction(DEFAULT_TRUNCATE_SILENCE_SETTINGS.action);
    setIndependent(DEFAULT_TRUNCATE_SILENCE_SETTINGS.independent);
    stopPreview();
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (validationError || !hasSelection || isApplying) return;
    stopPreview();
    void onApply(settings);
  }

  function preview() {
    if (validationError || !hasSelection || isApplying) return;
    void startPreview(() => onPreview(settings), sampleRate);
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto" data-testid="truncate-silence-dialog">
        <DialogHeader>
          <DialogTitle>Truncate Silence 静音截断</DialogTitle>
          <DialogDescription>
            按 Audacity 4.0.2 检测并缩短静音，在剪切点使用 100 采样交叉淡化，而非 Silence Generator。
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <fieldset className="grid gap-4 rounded-md border p-4 sm:grid-cols-2" disabled={isApplying}>
            <legend className="px-1 text-sm font-medium">Detect silence</legend>
            <NumericControl field="thresholdDb" value={drafts.thresholdDb} onChange={(value) => changeDraft('thresholdDb', value)} />
            <NumericControl field="minimumDuration" value={drafts.minimumDuration} onChange={(value) => changeDraft('minimumDuration', value)} />
          </fieldset>
          <fieldset className="space-y-4 rounded-md border p-4" disabled={isApplying}>
            <legend className="px-1 text-sm font-medium">Action</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="truncate-silence-action"
                  checked={action === 'truncate'}
                  onChange={() => { setAction('truncate'); stopPreview(); }}
                />
                Truncate detected silence
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="truncate-silence-action"
                  checked={action === 'compress'}
                  onChange={() => { setAction('compress'); stopPreview(); }}
                />
                Compress excess silence
              </label>
            </div>
            {action === 'truncate' ? (
              <NumericControl field="truncateDuration" value={drafts.truncateDuration} onChange={(value) => changeDraft('truncateDuration', value)} />
            ) : (
              <NumericControl field="compressPercent" value={drafts.compressPercent} onChange={(value) => changeDraft('compressPercent', value)} />
            )}
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={independent}
                onChange={(event) => { setIndependent(event.target.checked); stopPreview(); }}
              />
              {action === 'truncate' ? 'Truncate tracks independently' : 'Compress tracks independently'}
            </label>
          </fieldset>
          <div className="space-y-1 rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
            <p>选区：{formatTime(selectionStart)}–{formatTime(selectionEnd)}，共 {formatTime(Math.max(0, selectionEnd - selectionStart))}</p>
            <p>非独立模式只截断所有选中轨道共有的静音；独立模式逐轨检测。试听使用第一条目标轨道及同一剪切计划。</p>
            <p>应用会将受影响的连续时间轴渲染为一个新片段，保留未触及的片段边缘并波纹平移后续片段。</p>
          </div>
          {!hasSelection && <p role="alert" className="text-sm text-destructive">请先选择要处理的音频</p>}
          {validationError && <p role="alert" className="text-sm text-destructive">{validationError}</p>}
          {previewError && <p role="alert" className="text-sm text-destructive">试听失败：{previewError}</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={isApplying} onClick={reset}>恢复默认</Button>
            <Button
              type="button"
              variant="outline"
              aria-pressed={isPreviewing}
              disabled={isApplying || !hasSelection || Boolean(validationError)}
              onClick={isPreviewing ? stopPreview : preview}
            >
              {isPreviewing ? '停止试听' : '试听'}
            </Button>
            <Button type="button" variant="secondary" onClick={() => changeOpen(false)}>取消</Button>
            <Button type="submit" disabled={isApplying || !hasSelection || Boolean(validationError)}>
              {isApplying ? '正在应用…' : '应用 Truncate Silence'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
