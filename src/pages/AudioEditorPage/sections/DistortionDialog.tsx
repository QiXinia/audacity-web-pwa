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
  DEFAULT_DISTORTION_SETTINGS,
  DISTORTION_TYPE_LABELS,
  DISTORTION_TYPES,
  getDistortionControlMeta,
  validateDistortionSettings,
  type DistortionSettings,
  type DistortionType,
} from '@/lib/distortionEffect';
import type { PreviewChannels } from '@/lib/generatorPreview';
import { useGeneratorPreview } from './useGeneratorPreview';

interface DistortionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sampleRate: number;
  selectionStart: number;
  selectionEnd: number;
  hasSelection: boolean;
  isApplying: boolean;
  onPreview: (settings: DistortionSettings) => Promise<PreviewChannels>;
  onApply: (settings: DistortionSettings) => void | Promise<void>;
}

type NumericField = 'thresholdDb' | 'noiseFloorDb' | 'param1' | 'param2' | 'repeats';
type Drafts = Record<NumericField, string>;

const DEFAULT_DRAFTS: Drafts = {
  thresholdDb: String(DEFAULT_DISTORTION_SETTINGS.thresholdDb),
  noiseFloorDb: String(DEFAULT_DISTORTION_SETTINGS.noiseFloorDb),
  param1: String(DEFAULT_DISTORTION_SETTINGS.param1),
  param2: String(DEFAULT_DISTORTION_SETTINGS.param2),
  repeats: String(DEFAULT_DISTORTION_SETTINGS.repeats),
};

const RANGES: Record<NumericField, { minimum: number; maximum: number }> = {
  thresholdDb: { minimum: -100, maximum: 0 },
  noiseFloorDb: { minimum: -80, maximum: -20 },
  param1: { minimum: 0, maximum: 100 },
  param2: { minimum: 0, maximum: 100 },
  repeats: { minimum: 0, maximum: 5 },
};

interface DistortionControlProps {
  id: string;
  field: NumericField;
  label: string;
  value: string;
  onChange: (value: string) => void;
}

function DistortionControl({ id, field, label, value, onChange }: DistortionControlProps) {
  const { minimum, maximum } = RANGES[field];
  const unit = field === 'thresholdDb' || field === 'noiseFloorDb' ? 'dB' : field === 'repeats' ? '次' : '%';
  const accessibleLabel = `${label}（${unit}）`;
  const sliderValue = Number(value);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={id}>{accessibleLabel}</Label>
        <Input
          id={id}
          type="number"
          min={minimum}
          max={maximum}
          step={1}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-8 w-24"
          required
        />
      </div>
      <input
        type="range"
        aria-label={`${accessibleLabel}滑块`}
        min={minimum}
        max={maximum}
        step={1}
        value={Number.isFinite(sliderValue) ? sliderValue : minimum}
        onChange={(event) => onChange(event.target.value)}
        className="w-full accent-primary"
      />
    </div>
  );
}

export default function DistortionDialog({
  open,
  onOpenChange,
  sampleRate,
  selectionStart,
  selectionEnd,
  hasSelection,
  isApplying,
  onPreview,
  onApply,
}: DistortionDialogProps) {
  const [drafts, setDrafts] = useState<Drafts>({ ...DEFAULT_DRAFTS });
  const [type, setType] = useState<DistortionType>(DEFAULT_DISTORTION_SETTINGS.type);
  const [dcBlock, setDcBlock] = useState(DEFAULT_DISTORTION_SETTINGS.dcBlock);
  const { isPreviewing, previewError, startPreview, stopPreview } = useGeneratorPreview();
  const meta = useMemo(() => getDistortionControlMeta(type), [type]);
  const settings = useMemo<DistortionSettings>(() => ({
    type,
    dcBlock,
    thresholdDb: Number(drafts.thresholdDb),
    noiseFloorDb: Number(drafts.noiseFloorDb),
    param1: Number(drafts.param1),
    param2: Number(drafts.param2),
    repeats: Number(drafts.repeats),
  }), [dcBlock, drafts, type]);

  const validationError = useMemo(() => {
    if (Object.values(drafts).some((value) => !value.trim())) return '请填写全部 Distortion 参数';
    try {
      validateDistortionSettings(settings);
      return '';
    } catch (error) {
      return error instanceof Error ? error.message : 'Distortion 参数无效';
    }
  }, [drafts, settings]);

  useEffect(() => {
    if (!open) stopPreview();
  }, [open, stopPreview]);

  function changeOpen(nextOpen: boolean) {
    if (!nextOpen) stopPreview();
    onOpenChange(nextOpen);
  }

  function changeType(nextType: DistortionType) {
    setType(nextType);
    if (!getDistortionControlMeta(nextType).dcBlock) setDcBlock(false);
    stopPreview();
  }

  function reset() {
    setDrafts({ ...DEFAULT_DRAFTS });
    setType(DEFAULT_DISTORTION_SETTINGS.type);
    setDcBlock(DEFAULT_DISTORTION_SETTINGS.dcBlock);
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

  const controls: { field: NumericField; label: string }[] = [
    { field: 'thresholdDb', label: meta.threshold ?? '' },
    { field: 'noiseFloorDb', label: meta.noiseFloor ?? '' },
    { field: 'param1', label: meta.param1 ?? '' },
    { field: 'param2', label: meta.param2 ?? '' },
    { field: 'repeats', label: meta.repeats ?? '' },
  ];

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Distortion 失真</DialogTitle>
          <DialogDescription>
            按 Audacity 4 的 DistortionBase 查找表为选区添加削波、泛音、整流或限幅失真。
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <fieldset className="grid gap-4 rounded-md border p-4 sm:grid-cols-2" disabled={isApplying}>
            <legend className="px-1 text-sm font-medium">Distortion 参数</legend>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="distortion-type">失真类型</Label>
              <select
                id="distortion-type"
                value={type}
                onChange={(event) => changeType(event.target.value as DistortionType)}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
              >
                {DISTORTION_TYPES.map((distortionType) => (
                  <option key={distortionType} value={distortionType}>
                    {DISTORTION_TYPE_LABELS[distortionType]}
                  </option>
                ))}
              </select>
            </div>
            {controls.filter((control) => control.label).map((control) => (
              <DistortionControl
                key={control.field}
                {...control}
                id={`distortion-${control.field}`}
                value={drafts[control.field]}
                onChange={(value) => setDrafts((current) => ({ ...current, [control.field]: value }))}
              />
            ))}
            {meta.dcBlock && (
              <div className="flex items-center gap-2 sm:col-span-2">
                <input
                  id="distortion-dc-block"
                  type="checkbox"
                  aria-label="DC blocking"
                  checked={dcBlock}
                  onChange={(event) => setDcBlock(event.target.checked)}
                  className="h-4 w-4 accent-primary"
                />
                <Label htmlFor="distortion-dc-block" className="font-normal">
                  DC blocking（每声道独立滚动平均）
                </Label>
              </div>
            )}
          </fieldset>
          <div className="space-y-1 rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
            <p>选区：{formatTime(selectionStart)}–{formatTime(selectionEnd)}，共 {formatTime(Math.max(0, selectionEnd - selectionStart))}</p>
            <p>每条轨道独立保留 DC filter，并跨所选片段连续处理。试听仅使用第一条含音频的轨道。</p>
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
              {isApplying ? '正在应用…' : '应用失真'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
