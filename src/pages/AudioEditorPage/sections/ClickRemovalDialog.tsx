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
  DEFAULT_CLICK_REMOVAL_SETTINGS,
  isClickRemovalBypassed,
  validateClickRemovalSettings,
  type ClickRemovalSettings,
} from '@/lib/clickRemovalEffect';
import type { PreviewChannels } from '@/lib/generatorPreview';
import { useGeneratorPreview } from './useGeneratorPreview';

interface ClickRemovalDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sampleRate: number;
  selectionStart: number;
  selectionEnd: number;
  hasSelection: boolean;
  isApplying: boolean;
  onPreview: (settings: ClickRemovalSettings) => Promise<PreviewChannels>;
  onApply: (settings: ClickRemovalSettings) => void | Promise<void>;
}

type NumericField = keyof ClickRemovalSettings;
type Drafts = Record<NumericField, string>;

const DEFAULT_DRAFTS: Drafts = {
  threshold: String(DEFAULT_CLICK_REMOVAL_SETTINGS.threshold),
  width: String(DEFAULT_CLICK_REMOVAL_SETTINGS.width),
};

const CONTROLS: Record<NumericField, {
  label: string;
  minimum: number;
  maximum: number;
  step: number;
}> = {
  threshold: {
    label: 'Threshold (lower is more sensitive)',
    minimum: 0,
    maximum: 900,
    step: 10,
  },
  width: {
    label: 'Max spike width (higher is more sensitive)',
    minimum: 0,
    maximum: 40,
    step: 10,
  },
};

interface ClickRemovalControlProps {
  id: string;
  field: NumericField;
  value: string;
  onChange: (value: string) => void;
}

function ClickRemovalControl({ id, field, value, onChange }: ClickRemovalControlProps) {
  const { label, minimum, maximum, step } = CONTROLS[field];
  const sliderValue = Number(value);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={id}>{label}</Label>
        <Input
          id={id}
          data-testid={`click-removal-${field}-input`}
          type="number"
          min={minimum}
          max={maximum}
          step={step}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-8 w-24"
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

export default function ClickRemovalDialog({
  open,
  onOpenChange,
  sampleRate,
  selectionStart,
  selectionEnd,
  hasSelection,
  isApplying,
  onPreview,
  onApply,
}: ClickRemovalDialogProps) {
  const [drafts, setDrafts] = useState<Drafts>({ ...DEFAULT_DRAFTS });
  const { isPreviewing, previewError, startPreview, stopPreview } = useGeneratorPreview();
  const settings = useMemo<ClickRemovalSettings>(() => ({
    threshold: Number(drafts.threshold),
    width: Number(drafts.width),
  }), [drafts]);

  const validationError = useMemo(() => {
    if (Object.values(drafts).some((value) => !value.trim())) return '请填写全部 Click Removal 参数';
    try {
      validateClickRemovalSettings(settings);
      return '';
    } catch (error) {
      return error instanceof Error ? error.message : 'Click Removal 参数无效';
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
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto" data-testid="click-removal-dialog">
        <DialogHeader>
          <DialogTitle>Click Removal 咔哒声消除</DialogTitle>
          <DialogDescription>
            按 Audacity 4.0.2 的多尺度 RMS 检测窄尖峰，并以左右采样线性替换。
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <fieldset className="grid gap-4 rounded-md border p-4 sm:grid-cols-2" disabled={isApplying}>
            <legend className="px-1 text-sm font-medium">Click Removal 参数</legend>
            {(Object.keys(CONTROLS) as NumericField[]).map((field) => (
              <ClickRemovalControl
                key={field}
                id={`click-removal-${field}`}
                field={field}
                value={drafts[field]}
                onChange={(value) => changeDraft(field, value)}
              />
            ))}
          </fieldset>
          <div className="space-y-1 rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
            <p>选区：{formatTime(selectionStart)}–{formatTime(selectionEnd)}，共 {formatTime(Math.max(0, selectionEnd - selectionStart))}</p>
            <p>每轨选区须大于 4096 个采样；试听使用第一条含音频轨道的真实连续选区。</p>
            {isClickRemovalBypassed(settings) && <p>任一参数为 0 时按官方行为跳过效果，不修改音频。</p>}
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
              {isApplying ? '正在应用…' : '应用 Click Removal'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
