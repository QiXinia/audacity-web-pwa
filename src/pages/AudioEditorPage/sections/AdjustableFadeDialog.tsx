import { useEffect, useState, type FormEvent } from 'react';
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
  validateAdjustableFadeSettings,
  type AdjustableFadePreset,
  type AdjustableFadeSettings,
  type AdjustableFadeType,
  type AdjustableFadeUnits,
} from '@/lib/adjustableFadeEffect';
import type { PreviewChannels } from '@/lib/generatorPreview';
import { useGeneratorPreview } from './useGeneratorPreview';

interface AdjustableFadeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sampleRate: number;
  selectionStart: number;
  selectionEnd: number;
  isApplying: boolean;
  onPreview: (settings: AdjustableFadeSettings) => Promise<PreviewChannels>;
  onApply: (settings: AdjustableFadeSettings) => void | Promise<void>;
}

export default function AdjustableFadeDialog({
  open,
  onOpenChange,
  sampleRate,
  selectionStart,
  selectionEnd,
  isApplying,
  onPreview,
  onApply,
}: AdjustableFadeDialogProps) {
  const [fadeType, setFadeType] = useState<AdjustableFadeType>('up');
  const [midAdjustText, setMidAdjustText] = useState('0');
  const [units, setUnits] = useState<AdjustableFadeUnits>('percent');
  const [startText, setStartText] = useState('0');
  const [endText, setEndText] = useState('100');
  const [preset, setPreset] = useState<AdjustableFadePreset>('none');
  const { isPreviewing, previewError, startPreview, stopPreview } = useGeneratorPreview();

  const settings: AdjustableFadeSettings = {
    fadeType,
    midFadeAdjustPercent: Number(midAdjustText),
    units,
    startGain: Number(startText),
    endGain: Number(endText),
    preset,
  };
  let validationError = '';
  try {
    validateAdjustableFadeSettings(settings);
  } catch (error) {
    validationError = error instanceof Error ? error.message : 'Adjustable Fade 参数无效';
  }

  useEffect(() => {
    if (!open) stopPreview();
  }, [open, stopPreview]);

  function changeOpen(nextOpen: boolean) {
    if (!nextOpen) stopPreview();
    onOpenChange(nextOpen);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (validationError || isApplying) return;
    stopPreview();
    void onApply(settings);
  }

  function preview() {
    if (validationError || isApplying) return;
    void startPreview(() => onPreview(settings), sampleRate);
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Adjustable Fade 可调淡化</DialogTitle>
          <DialogDescription>按 Audacity Nyquist Adjustable Fade 控制淡化形状、起始电平和结束电平。</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="adjustable-fade-type">淡化类型</Label>
              <select
                id="adjustable-fade-type"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={fadeType}
                disabled={isApplying || preset !== 'none'}
                onChange={(event) => setFadeType(event.target.value as AdjustableFadeType)}
              >
                <option value="up">Fade Up 淡入</option>
                <option value="down">Fade Down 淡出</option>
                <option value="sCurveUp">S-Curve Up S 形淡入</option>
                <option value="sCurveDown">S-Curve Down S 形淡出</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="adjustable-fade-mid">Mid-fade Adjust (%)</Label>
              <Input id="adjustable-fade-mid" type="number" min={-100} max={100} step="any" value={midAdjustText} disabled={isApplying || preset !== 'none'} onChange={(event) => setMidAdjustText(event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="adjustable-fade-units">Start/End as</Label>
              <select
                id="adjustable-fade-units"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={units}
                disabled={isApplying || preset !== 'none'}
                onChange={(event) => setUnits(event.target.value as AdjustableFadeUnits)}
              >
                <option value="percent">% of Original 原始百分比</option>
                <option value="db">dB Gain 分贝增益</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="adjustable-fade-start">Start (or end)</Label>
              <Input id="adjustable-fade-start" type="number" step="any" value={startText} disabled={isApplying || preset !== 'none'} onChange={(event) => setStartText(event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="adjustable-fade-end">End (or start)</Label>
              <Input id="adjustable-fade-end" type="number" step="any" value={endText} disabled={isApplying || preset !== 'none'} onChange={(event) => setEndText(event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="adjustable-fade-preset">Handy Presets</Label>
              <select
                id="adjustable-fade-preset"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={preset}
                disabled={isApplying}
                onChange={(event) => setPreset(event.target.value as AdjustableFadePreset)}
              >
                <option value="none">None Selected 无预设</option>
                <option value="linearIn">Linear In 线性淡入</option>
                <option value="linearOut">Linear Out 线性淡出</option>
                <option value="exponentialIn">Exponential In 指数淡入</option>
                <option value="exponentialOut">Exponential Out 指数淡出</option>
                <option value="logarithmicIn">Logarithmic In 对数淡入</option>
                <option value="logarithmicOut">Logarithmic Out 对数淡出</option>
                <option value="roundedIn">Rounded In 圆融淡入</option>
                <option value="roundedOut">Rounded Out 圆融淡出</option>
                <option value="cosineIn">Cosine In 余弦淡入</option>
                <option value="cosineOut">Cosine Out 余弦淡出</option>
                <option value="sCurveIn">S-Curve In S 形淡入</option>
                <option value="sCurveOut">S-Curve Out S 形淡出</option>
              </select>
            </div>
          </div>
          <div className="space-y-1 rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
            <p>选区：{formatTime(selectionStart)}–{formatTime(selectionEnd)}，共 {formatTime(selectionEnd - selectionStart)}</p>
            <p>预设会覆盖自定义类型、中点弯曲和起止增益。</p>
          </div>
          {validationError && <p role="alert" className="text-sm text-destructive">{validationError}</p>}
          {previewError && <p role="alert" className="text-sm text-destructive">试听失败：{previewError}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={isApplying || !!validationError} onClick={isPreviewing ? stopPreview : preview}>
              {isPreviewing ? '停止试听' : '试听'}
            </Button>
            <Button type="button" variant="secondary" onClick={() => changeOpen(false)}>取消</Button>
            <Button type="submit" disabled={isApplying || !!validationError}>{isApplying ? '正在应用…' : '应用 Adjustable Fade'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
