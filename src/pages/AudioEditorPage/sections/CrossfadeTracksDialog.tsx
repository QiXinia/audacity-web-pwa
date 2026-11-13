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
import { Label } from '@/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Slider } from '@/components/ui/slider';
import { formatTime } from '@/lib/audioUtils';
import {
  DEFAULT_CROSSFADE_SETTINGS,
  validateCrossfadeSettings,
  type CrossfadeDirectionMode,
  type CrossfadeSettings,
  type CrossfadeType,
} from '@/lib/crossfadeTracksEffect';
import type { PreviewChannels } from '@/lib/generatorPreview';
import { useGeneratorPreview } from './useGeneratorPreview';

interface CrossfadeTracksDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sampleRate: number;
  selectionStart: number;
  selectionEnd: number;
  isApplying: boolean;
  onPreview: (settings: CrossfadeSettings) => Promise<PreviewChannels>;
  onApply: (settings: CrossfadeSettings) => void | Promise<void>;
}

const TYPE_LABELS: Record<CrossfadeType, string> = {
  gain: 'Constant Gain 恒定增益',
  power1: 'Constant Power 1 恒定功率 1',
  power2: 'Constant Power 2 恒定功率 2',
  custom: 'Custom Curve 自定义曲线',
};

const DIRECTION_LABELS: Record<CrossfadeDirectionMode, string> = {
  automatic: 'Automatic 自动',
  'out-in': 'Alternating Out / In 交替淡出/淡入',
  'in-out': 'Alternating In / Out 交替淡入/淡出',
};

export default function CrossfadeTracksDialog({
  open,
  onOpenChange,
  sampleRate,
  selectionStart,
  selectionEnd,
  isApplying,
  onPreview,
  onApply,
}: CrossfadeTracksDialogProps) {
  const [type, setType] = useState<CrossfadeType>(DEFAULT_CROSSFADE_SETTINGS.type);
  const [customCurve, setCustomCurve] = useState(DEFAULT_CROSSFADE_SETTINGS.customCurve);
  const [direction, setDirection] = useState<CrossfadeDirectionMode>(
    DEFAULT_CROSSFADE_SETTINGS.direction,
  );
  const { isPreviewing, previewError, startPreview, stopPreview } = useGeneratorPreview();
  const settings = useMemo<CrossfadeSettings>(() => (
    { type, customCurve, direction }
  ), [type, customCurve, direction]);

  const validationError = useMemo(() => {
    try {
      validateCrossfadeSettings(settings);
      return '';
    } catch (error) {
      return error instanceof Error ? error.message : 'Crossfade 参数无效';
    }
  }, [settings]);

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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Crossfade Tracks 交叉淡化</DialogTitle>
          <DialogDescription>
            在同一时间范围的多条轨道之间交替淡出和淡入，不改变片段时间位置。
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="crossfade-type">Fade Type 淡化类型</Label>
            <NativeSelect
              id="crossfade-type"
              className="w-full"
              value={type}
              disabled={isApplying}
              onChange={(event) => setType(event.target.value as CrossfadeType)}
            >
              {Object.entries(TYPE_LABELS).map(([value, label]) => (
                <NativeSelectOption key={value} value={value}>{label}</NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-2" aria-disabled={type !== 'custom'}>
            <Label htmlFor="crossfade-curve">
              Custom curve 自定义曲线：{customCurve.toFixed(2)}
            </Label>
            <Slider
              id="crossfade-curve"
              min={0}
              max={1}
              step={0.01}
              value={[customCurve]}
              disabled={isApplying || type !== 'custom'}
              onValueChange={([value]) => setCustomCurve(value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="crossfade-direction">Fade direction 淡化方向</Label>
            <NativeSelect
              id="crossfade-direction"
              className="w-full"
              value={direction}
              disabled={isApplying}
              onChange={(event) => setDirection(event.target.value as CrossfadeDirectionMode)}
            >
              {Object.entries(DIRECTION_LABELS).map(([value, label]) => (
                <NativeSelectOption key={value} value={value}>{label}</NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1 rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
            <p>选区：{formatTime(selectionStart)}–{formatTime(selectionEnd)}，共 {formatTime(selectionEnd - selectionStart)}</p>
            <p>至少选择两条轨道；每个声道独立应用相同淡化曲线。</p>
          </div>
          {validationError && <p role="alert" className="text-sm text-destructive">{validationError}</p>}
          {previewError && <p role="alert" className="text-sm text-destructive">试听失败：{previewError}</p>}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              aria-pressed={isPreviewing}
              disabled={isApplying || Boolean(validationError)}
              onClick={isPreviewing ? stopPreview : preview}
            >
              {isPreviewing ? '停止试听' : '试听'}
            </Button>
            <Button type="button" variant="secondary" onClick={() => changeOpen(false)}>取消</Button>
            <Button type="submit" disabled={isApplying || Boolean(validationError)}>
              {isApplying ? '正在应用…' : '应用 Crossfade'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
