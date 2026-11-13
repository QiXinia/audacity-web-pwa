import { useEffect, useMemo, useState } from 'react';
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
  DEFAULT_PHASER_SETTINGS,
  PHASER_LFO_SKIP_SAMPLES,
  normalizePhaserSettings,
  validatePhaserSettings,
  type PhaserSettings,
} from '@/lib/phaserEffect';
import { useGeneratorPreview } from './useGeneratorPreview';

interface PhaserEffectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sampleRate: number;
  selectionStart: number;
  selectionEnd: number;
  isApplying: boolean;
  onPreview: (settings: PhaserSettings) => Promise<Float32Array[]>;
  onApply: (settings: PhaserSettings) => Promise<void>;
}

const fields: ReadonlyArray<{
  key: keyof PhaserSettings;
  label: string;
  minimum: number;
  maximum: number;
  step: number;
}> = [
  { key: 'stages', label: 'Stages', minimum: 2, maximum: 24, step: 1 },
  { key: 'dryWet', label: 'Dry/Wet', minimum: 0, maximum: 255, step: 1 },
  { key: 'frequencyHz', label: 'LFO 频率（Hz）', minimum: 0.001, maximum: 4, step: 0.001 },
  { key: 'phaseDegrees', label: 'LFO 起始相位（°）', minimum: 0, maximum: 360, step: 1 },
  { key: 'depth', label: 'Depth', minimum: 0, maximum: 255, step: 1 },
  { key: 'feedbackPercent', label: 'Feedback（%）', minimum: -100, maximum: 100, step: 1 },
  { key: 'outputGainDb', label: '输出增益（dB）', minimum: -30, maximum: 30, step: 0.1 },
];

export default function PhaserEffectDialog({
  open,
  onOpenChange,
  sampleRate,
  selectionStart,
  selectionEnd,
  isApplying,
  onPreview,
  onApply,
}: PhaserEffectDialogProps) {
  const [settings, setSettings] = useState<PhaserSettings>({ ...DEFAULT_PHASER_SETTINGS });
  const [actionError, setActionError] = useState<string | null>(null);
  const {
    isPreviewing,
    previewError,
    startPreview,
    stopPreview,
  } = useGeneratorPreview();

  useEffect(() => {
    if (open) {
      setSettings({ ...DEFAULT_PHASER_SETTINGS });
      setActionError(null);
    } else {
      stopPreview();
    }
  }, [open, selectionStart, selectionEnd, stopPreview]);

  const validationError = useMemo(() => {
    try {
      validatePhaserSettings(settings);
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : '参数无效';
    }
  }, [settings]);
  const effectiveStages = validationError ? settings.stages : normalizePhaserSettings(settings).stages;

  function update(key: keyof PhaserSettings, value: number) {
    setSettings((current) => ({ ...current, [key]: value }));
    setActionError(null);
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) stopPreview();
    onOpenChange(nextOpen);
  }

  async function handlePreview() {
    if (validationError || isApplying) return;
    setActionError(null);
    try {
      await startPreview(() => onPreview(settings), sampleRate);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '试听失败');
    }
  }

  async function handleApply() {
    if (validationError || isApplying) return;
    setActionError(null);
    stopPreview();
    try {
      await onApply(settings);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '应用 Phaser 失败');
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Phaser</DialogTitle>
          <DialogDescription>
            对照 Audacity 4.0.2 的递归全通相位效果；不会改变输出时长或片段边界。
          </DialogDescription>
        </DialogHeader>

        <div data-testid="phaser-plan" className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
          选区 {selectionStart.toFixed(3)}–{selectionEnd.toFixed(3)} 秒 · {sampleRate} Hz ·
          实际 {effectiveStages} 个全通级 · 每 {PHASER_LFO_SKIP_SAMPLES} 个采样更新 LFO。
          奇数 Stages 按 Audacity 规则向下归一为偶数。
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {fields.map((field) => (
            <div key={field.key} className="grid gap-2">
              <Label htmlFor={`phaser-${field.key}`}>{field.label}</Label>
              <Input
                id={`phaser-${field.key}`}
                type="number"
                min={field.minimum}
                max={field.maximum}
                step={field.step}
                value={settings[field.key]}
                disabled={isApplying}
                onChange={(event) => update(field.key, Number(event.target.value))}
              />
            </div>
          ))}
        </div>

        {(validationError || previewError || actionError) && (
          <p role="alert" className="text-sm text-destructive">
            {validationError ?? actionError ?? previewError}
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" disabled={isApplying} onClick={() => handleOpenChange(false)}>
            取消
          </Button>
          <Button variant="outline" disabled={isApplying || Boolean(validationError)} onClick={handlePreview}>
            {isPreviewing ? '正在试听…' : '试听'}
          </Button>
          <Button disabled={isApplying || Boolean(validationError)} onClick={handleApply}>
            {isApplying ? '正在应用…' : '应用 Phaser'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
