import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  DEFAULT_LABEL_SOUNDS_SETTINGS,
  validateLabelSoundsSettings,
  type LabelSoundsMeasurement,
  type LabelSoundsSettings,
  type LabelSoundsType,
} from '@/lib/labelSounds';

export default function LabelSoundsDialog({
  open,
  onOpenChange,
  selectionStart,
  selectionEnd,
  sampleRate,
  isApplying,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectionStart: number;
  selectionEnd: number;
  sampleRate: number;
  isApplying: boolean;
  onApply: (settings: LabelSoundsSettings) => Promise<void>;
}) {
  const [settings, setSettings] = useState<LabelSoundsSettings>({ ...DEFAULT_LABEL_SOUNDS_SETTINGS });
  const [applyError, setApplyError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSettings({ ...DEFAULT_LABEL_SOUNDS_SETTINGS });
    setApplyError(null);
  }, [open]);

  let validationError: string | null = null;
  try {
    validateLabelSoundsSettings(settings);
  } catch (error) {
    validationError = error instanceof Error ? error.message : String(error);
  }

  function update<K extends keyof LabelSoundsSettings>(key: K, value: LabelSoundsSettings[K]): void {
    setSettings((current) => ({ ...current, [key]: value }));
  }

  function numberValue(value: string, valueAsNumber: number): number {
    return value === '' ? Number.NaN : valueAsNumber;
  }

  async function apply(): Promise<void> {
    if (validationError || isApplying) return;
    setApplyError(null);
    try {
      await onApply(settings);
    } catch (error) {
      setApplyError(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!isApplying) onOpenChange(next); }}>
      <DialogContent data-testid="label-sounds-dialog" className="max-w-[620px] gap-0 p-0">
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle>Label sounds</DialogTitle>
          <DialogDescription>Creates labels for sounds or silences. 按阈值检测声音并生成带编号的时间标签。</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 px-5 py-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="label-sounds-threshold">Threshold level (dB)</Label>
              <Input id="label-sounds-threshold" type="number" min={-100} max={0} step={1}
                value={Number.isFinite(settings.thresholdDb) ? settings.thresholdDb : ''} disabled={isApplying}
                onChange={(event) => update('thresholdDb', numberValue(event.target.value, event.target.valueAsNumber))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="label-sounds-measurement">Threshold measurement</Label>
              <select id="label-sounds-measurement" className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={settings.measurement} disabled={isApplying}
                onChange={(event) => update('measurement', event.target.value as LabelSoundsMeasurement)}>
                <option value="peak">Peak level</option>
                <option value="average">Average level</option>
                <option value="rms">RMS level</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="label-sounds-silence">Minimum silence duration (s)</Label>
              <Input id="label-sounds-silence" type="number" min={0.01} max={3600} step={0.01}
                value={Number.isFinite(settings.silenceDuration) ? settings.silenceDuration : ''} disabled={isApplying}
                onChange={(event) => update('silenceDuration', numberValue(event.target.value, event.target.valueAsNumber))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="label-sounds-interval">Minimum label interval (s)</Label>
              <Input id="label-sounds-interval" type="number" min={0.01} max={7200} step={0.01}
                value={Number.isFinite(settings.labelInterval) ? settings.labelInterval : ''} disabled={isApplying}
                onChange={(event) => update('labelInterval', numberValue(event.target.value, event.target.valueAsNumber))} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="label-sounds-type">Label type</Label>
              <select id="label-sounds-type" className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={settings.labelType} disabled={isApplying}
                onChange={(event) => update('labelType', event.target.value as LabelSoundsType)}>
                <option value="before">Point before sound</option>
                <option value="after">Point after sound</option>
                <option value="around">Region around sounds</option>
                <option value="between">Region between sounds</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="label-sounds-leading">Maximum leading silence (s)</Label>
              <Input id="label-sounds-leading" type="number" min={0} step={0.01}
                value={Number.isFinite(settings.leadingSilence) ? settings.leadingSilence : ''} disabled={isApplying}
                onChange={(event) => update('leadingSilence', numberValue(event.target.value, event.target.valueAsNumber))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="label-sounds-trailing">Maximum trailing silence (s)</Label>
              <Input id="label-sounds-trailing" type="number" min={0} step={0.01}
                value={Number.isFinite(settings.trailingSilence) ? settings.trailingSilence : ''} disabled={isApplying}
                onChange={(event) => update('trailingSilence', numberValue(event.target.value, event.target.valueAsNumber))} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="label-sounds-text">Label text</Label>
              <Input id="label-sounds-text" value={settings.labelText} disabled={isApplying}
                onChange={(event) => update('labelText', event.target.value)} />
              <p className="text-[11px] text-muted-foreground">第一组 # 表示编号位数，其后的整数是起始值，例如 Sound ##1 → Sound 01、Sound 02。</p>
            </div>
          </div>
          <p className="text-[11px] leading-4 text-muted-foreground">
            选区：{selectionStart.toFixed(3)}–{selectionEnd.toFixed(3)} 秒 · {sampleRate} Hz。检测按官方插件缩减至约 100 Hz；每个选中轨道独立编号。
          </p>
          {(validationError || applyError) && <p role="alert" className="text-xs text-destructive">{validationError ?? applyError}</p>}
        </div>
        <DialogFooter className="border-t px-5 py-4">
          <Button type="button" variant="outline" disabled={isApplying} onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" disabled={Boolean(validationError) || isApplying} onClick={() => { void apply(); }}>
            {isApplying ? '分析中…' : 'OK'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
