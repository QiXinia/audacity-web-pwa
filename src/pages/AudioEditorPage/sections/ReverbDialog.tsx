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
  DEFAULT_REVERB_SETTINGS,
  validateReverbSettings,
  type ReverbSettings,
} from '@/lib/reverbEffect';
import type { PreviewChannels } from '@/lib/generatorPreview';
import { useGeneratorPreview } from './useGeneratorPreview';

interface ReverbDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sampleRate: number;
  selectionStart: number;
  selectionEnd: number;
  hasSelection: boolean;
  isApplying: boolean;
  onPreview: (settings: ReverbSettings) => Promise<PreviewChannels>;
  onApply: (settings: ReverbSettings) => void | Promise<void>;
}

type NumericField = Exclude<keyof ReverbSettings, 'wetOnly'>;
type Drafts = Record<NumericField, string>;

const DEFAULT_DRAFTS: Drafts = {
  roomSize: String(DEFAULT_REVERB_SETTINGS.roomSize),
  preDelayMs: String(DEFAULT_REVERB_SETTINGS.preDelayMs),
  reverberance: String(DEFAULT_REVERB_SETTINGS.reverberance),
  hfDamping: String(DEFAULT_REVERB_SETTINGS.hfDamping),
  toneLow: String(DEFAULT_REVERB_SETTINGS.toneLow),
  toneHigh: String(DEFAULT_REVERB_SETTINGS.toneHigh),
  wetGainDb: String(DEFAULT_REVERB_SETTINGS.wetGainDb),
  dryGainDb: String(DEFAULT_REVERB_SETTINGS.dryGainDb),
  stereoWidth: String(DEFAULT_REVERB_SETTINGS.stereoWidth),
};

interface ControlDefinition {
  field: NumericField;
  label: string;
  minimum: number;
  maximum: number;
}

const CONTROLS: ControlDefinition[] = [
  { field: 'roomSize', label: '房间大小（%）', minimum: 0, maximum: 100 },
  { field: 'preDelayMs', label: '预延迟（ms）', minimum: 0, maximum: 200 },
  { field: 'reverberance', label: '混响强度（%）', minimum: 0, maximum: 100 },
  { field: 'hfDamping', label: '高频阻尼（%）', minimum: 0, maximum: 100 },
  { field: 'toneLow', label: '低音色调（%）', minimum: 0, maximum: 100 },
  { field: 'toneHigh', label: '高音色调（%）', minimum: 0, maximum: 100 },
  { field: 'wetGainDb', label: '湿声增益（dB）', minimum: -20, maximum: 10 },
  { field: 'dryGainDb', label: '干声增益（dB）', minimum: -20, maximum: 10 },
  { field: 'stereoWidth', label: '立体声宽度（%）', minimum: 0, maximum: 100 },
];

interface ReverbControlProps extends ControlDefinition {
  id: string;
  value: string;
  onChange: (value: string) => void;
}

function ReverbControl({ id, label, minimum, maximum, value, onChange }: ReverbControlProps) {
  const sliderValue = Number(value);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={id}>{label}</Label>
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
        aria-label={`${label}滑块`}
        min={minimum}
        max={maximum}
        step={1}
        value={Number.isFinite(sliderValue) ? sliderValue : 0}
        onChange={(event) => onChange(event.target.value)}
        className="w-full accent-primary"
      />
    </div>
  );
}

export default function ReverbDialog({
  open,
  onOpenChange,
  sampleRate,
  selectionStart,
  selectionEnd,
  hasSelection,
  isApplying,
  onPreview,
  onApply,
}: ReverbDialogProps) {
  const [drafts, setDrafts] = useState<Drafts>({ ...DEFAULT_DRAFTS });
  const [wetOnly, setWetOnly] = useState(DEFAULT_REVERB_SETTINGS.wetOnly);
  const { isPreviewing, previewError, startPreview, stopPreview } = useGeneratorPreview();
  const settings = useMemo<ReverbSettings>(() => ({
    roomSize: Number(drafts.roomSize),
    preDelayMs: Number(drafts.preDelayMs),
    reverberance: Number(drafts.reverberance),
    hfDamping: Number(drafts.hfDamping),
    toneLow: Number(drafts.toneLow),
    toneHigh: Number(drafts.toneHigh),
    wetGainDb: Number(drafts.wetGainDb),
    dryGainDb: Number(drafts.dryGainDb),
    stereoWidth: Number(drafts.stereoWidth),
    wetOnly,
  }), [drafts, wetOnly]);

  const validationError = useMemo(() => {
    if (Object.values(drafts).some((value) => !value.trim())) return '请填写全部 Reverb 参数';
    try {
      validateReverbSettings(settings);
      return '';
    } catch (error) {
      return error instanceof Error ? error.message : 'Reverb 参数无效';
    }
  }, [drafts, settings]);

  useEffect(() => {
    if (!open) stopPreview();
  }, [open, stopPreview]);

  function changeOpen(nextOpen: boolean) {
    if (!nextOpen) stopPreview();
    onOpenChange(nextOpen);
  }

  function reset() {
    setDrafts({ ...DEFAULT_DRAFTS });
    setWetOnly(DEFAULT_REVERB_SETTINGS.wetOnly);
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
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Reverb 混响</DialogTitle>
          <DialogDescription>
            按 Audacity 4 的 libSoX/Freeverb 算法为选区添加空间与厅堂混响。
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <fieldset className="grid gap-4 rounded-md border p-4 sm:grid-cols-2" disabled={isApplying}>
            <legend className="px-1 text-sm font-medium">Reverb 参数</legend>
            {CONTROLS.map((control) => (
              <ReverbControl
                key={control.field}
                {...control}
                id={`reverb-${control.field}`}
                value={drafts[control.field]}
                onChange={(value) => setDrafts((current) => ({ ...current, [control.field]: value }))}
              />
            ))}
            <div className="flex items-center gap-2 sm:col-span-2">
              <input
                id="reverb-wet-only"
                type="checkbox"
                aria-label="仅湿声"
                checked={wetOnly}
                onChange={(event) => setWetOnly(event.target.checked)}
                className="h-4 w-4 accent-primary"
              />
              <Label htmlFor="reverb-wet-only" className="font-normal">
                仅湿声（Wet Only，忽略干声增益）
              </Label>
            </div>
          </fieldset>
          <div className="space-y-1 rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
            <p>选区：{formatTime(selectionStart)}–{formatTime(selectionEnd)}，共 {formatTime(Math.max(0, selectionEnd - selectionStart))}</p>
            <p>每条轨道独立保留预延迟和滤波历史，并跨所选片段连续处理。试听仅使用第一条含音频的轨道。</p>
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
              {isApplying ? '正在应用…' : '应用混响'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
