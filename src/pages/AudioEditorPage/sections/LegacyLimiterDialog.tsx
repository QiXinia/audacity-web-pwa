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
  DEFAULT_LEGACY_LIMITER_SETTINGS,
  validateLegacyLimiterSettings,
  type LegacyLimiterSettings,
  type LegacyLimiterType,
} from '@/lib/legacyLimiterEffect';
import type { PreviewChannels } from '@/lib/generatorPreview';
import { useGeneratorPreview } from './useGeneratorPreview';

interface LegacyLimiterDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sampleRate: number;
  selectionStart: number;
  selectionEnd: number;
  hasSelection: boolean;
  isApplying: boolean;
  onPreview: (settings: LegacyLimiterSettings) => Promise<PreviewChannels>;
  onApply: (settings: LegacyLimiterSettings) => void | Promise<void>;
}

type NumericField = 'inputGainLeftDb' | 'inputGainRightDb' | 'limitToDb' | 'holdMs';
type Drafts = Record<NumericField, string>;

const DEFAULT_DRAFTS: Drafts = {
  inputGainLeftDb: String(DEFAULT_LEGACY_LIMITER_SETTINGS.inputGainLeftDb),
  inputGainRightDb: String(DEFAULT_LEGACY_LIMITER_SETTINGS.inputGainRightDb),
  limitToDb: String(DEFAULT_LEGACY_LIMITER_SETTINGS.limitToDb),
  holdMs: String(DEFAULT_LEGACY_LIMITER_SETTINGS.holdMs),
};

const CONTROLS: Record<NumericField, { label: string; minimum: number; maximum: number }> = {
  inputGainLeftDb: { label: 'Input Gain (dB) mono/Left', minimum: 0, maximum: 10 },
  inputGainRightDb: { label: 'Input Gain (dB) Right channel', minimum: 0, maximum: 10 },
  limitToDb: { label: 'Limit to (dB)', minimum: -10, maximum: 0 },
  holdMs: { label: 'Hold (ms)', minimum: 1, maximum: 50 },
};

export default function LegacyLimiterDialog({
  open,
  onOpenChange,
  sampleRate,
  selectionStart,
  selectionEnd,
  hasSelection,
  isApplying,
  onPreview,
  onApply,
}: LegacyLimiterDialogProps) {
  const [type, setType] = useState<LegacyLimiterType>(DEFAULT_LEGACY_LIMITER_SETTINGS.type);
  const [applyMakeupGain, setApplyMakeupGain] = useState(DEFAULT_LEGACY_LIMITER_SETTINGS.applyMakeupGain);
  const [drafts, setDrafts] = useState<Drafts>({ ...DEFAULT_DRAFTS });
  const { isPreviewing, previewError, startPreview, stopPreview } = useGeneratorPreview();
  const settings = useMemo<LegacyLimiterSettings>(() => ({
    type,
    applyMakeupGain,
    inputGainLeftDb: Number(drafts.inputGainLeftDb),
    inputGainRightDb: Number(drafts.inputGainRightDb),
    limitToDb: Number(drafts.limitToDb),
    holdMs: Number(drafts.holdMs),
  }), [type, applyMakeupGain, drafts]);
  const validationError = useMemo(() => {
    if (Object.values(drafts).some((value) => !value.trim())) return '请填写全部 Legacy limiter 参数';
    try {
      validateLegacyLimiterSettings(settings);
      return '';
    } catch (error) {
      return error instanceof Error ? error.message : 'Legacy limiter 参数无效';
    }
  }, [drafts, settings]);
  const canProcess = hasSelection && !validationError && !isApplying;

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
    setType(DEFAULT_LEGACY_LIMITER_SETTINGS.type);
    setApplyMakeupGain(DEFAULT_LEGACY_LIMITER_SETTINGS.applyMakeupGain);
    setDrafts({ ...DEFAULT_DRAFTS });
    stopPreview();
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!canProcess) return;
    stopPreview();
    void onApply(settings);
  }

  function preview() {
    if (!canProcess) return;
    void startPreview(() => onPreview(settings), sampleRate);
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto" data-testid="legacy-limiter-dialog">
        <DialogHeader>
          <DialogTitle>Legacy limiter 旧版限制器</DialogTitle>
          <DialogDescription>
            按 Audacity 4.0.2 legacy-limiter.ny 实现四种限制/削波方式、左右声道独立输入增益和 Hold 峰值包络。
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <fieldset className="grid gap-4 rounded-md border p-4 sm:grid-cols-2" disabled={isApplying}>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="legacy-limiter-type">Type</Label>
              <select
                id="legacy-limiter-type"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={type}
                onChange={(event) => { setType(event.target.value as LegacyLimiterType); stopPreview(); }}
              >
                <option value="softLimit">Soft Limit</option>
                <option value="hardLimit">Hard Limit</option>
                <option value="softClip">Soft Clip</option>
                <option value="hardClip">Hard Clip</option>
              </select>
            </div>
            {(Object.keys(CONTROLS) as NumericField[]).map((field) => {
              const control = CONTROLS[field];
              return (
                <div className="space-y-2" key={field}>
                  <Label htmlFor={`legacy-limiter-${field}`}>{control.label}</Label>
                  <Input
                    id={`legacy-limiter-${field}`}
                    data-testid={`legacy-limiter-${field}-input`}
                    type="number"
                    min={control.minimum}
                    max={control.maximum}
                    step="any"
                    value={drafts[field]}
                    onChange={(event) => changeDraft(field, event.target.value)}
                    required
                  />
                </div>
              );
            })}
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="legacy-limiter-makeup">Apply Make-up Gain</Label>
              <select
                id="legacy-limiter-makeup"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={applyMakeupGain ? 'yes' : 'no'}
                onChange={(event) => { setApplyMakeupGain(event.target.value === 'yes'); stopPreview(); }}
              >
                <option value="no">No</option>
                <option value="yes">Yes</option>
              </select>
            </div>
          </fieldset>
          <p className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
            选区：{formatTime(selectionStart)}–{formatTime(selectionEnd)}。单声道使用 mono/Left 增益；立体声右声道使用 Right channel 增益。
          </p>
          {!hasSelection && <p role="alert" className="text-sm text-destructive">请先选择要处理的音频</p>}
          {validationError && <p role="alert" className="text-sm text-destructive">{validationError}</p>}
          {previewError && <p role="alert" className="text-sm text-destructive">试听失败：{previewError}</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={isApplying} onClick={reset}>恢复默认</Button>
            <Button type="button" variant="outline" disabled={!canProcess} onClick={isPreviewing ? stopPreview : preview}>
              {isPreviewing ? '停止试听' : '试听'}
            </Button>
            <Button type="button" variant="secondary" onClick={() => changeOpen(false)}>取消</Button>
            <Button type="submit" disabled={!canProcess}>{isApplying ? '正在应用…' : '应用 Legacy limiter'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
