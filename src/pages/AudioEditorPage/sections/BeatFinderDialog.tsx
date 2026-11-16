import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  DEFAULT_BEAT_FINDER_SETTINGS,
  validateBeatFinderSettings,
  type BeatFinderSettings,
} from '@/lib/beatFinder';

export default function BeatFinderDialog({
  open,
  onOpenChange,
  selectionStart,
  selectionEnd,
  isApplying,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectionStart: number;
  selectionEnd: number;
  isApplying: boolean;
  onApply: (settings: BeatFinderSettings) => Promise<void>;
}) {
  const [settings, setSettings] = useState<BeatFinderSettings>({ ...DEFAULT_BEAT_FINDER_SETTINGS });
  const [applyError, setApplyError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSettings({ ...DEFAULT_BEAT_FINDER_SETTINGS });
    setApplyError(null);
  }, [open]);

  let validationError: string | null = null;
  try {
    validateBeatFinderSettings(settings);
  } catch (error) {
    validationError = error instanceof Error ? error.message : String(error);
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
      <DialogContent data-testid="beat-finder-dialog" className="max-w-[480px] gap-0 p-0">
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle>Beat finder</DialogTitle>
          <DialogDescription>
            Detects beats and creates point labels. 按低频包络检测节拍，并在选中轨道上生成 B 点标签。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 px-5 py-5">
          <div className="space-y-1.5">
            <Label htmlFor="beat-finder-threshold">Threshold Percentage</Label>
            <Input
              id="beat-finder-threshold"
              type="number"
              min={5}
              max={100}
              step={1}
              value={Number.isFinite(settings.thresholdPercentage) ? settings.thresholdPercentage : ''}
              disabled={isApplying}
              onChange={(event) => setSettings({
                thresholdPercentage: event.target.value === '' ? Number.NaN : event.target.valueAsNumber,
              })}
              required
            />
            <p className="text-[11px] text-muted-foreground">官方范围 5–100，默认 65。数值是检测包络峰值的百分比。</p>
          </div>
          <p className="text-[11px] leading-4 text-muted-foreground">
            选区：{selectionStart.toFixed(3)}–{selectionEnd.toFixed(3)} 秒。立体声先求和，跟踪 50 Hz 低频包络；低于阈值后才会重新触发。
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
