import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  DEFAULT_REGULAR_INTERVAL_LABELS_SETTINGS,
  validateRegularIntervalLabelsSettings,
  type RegularIntervalLabelsSettings,
  type RegularIntervalMode,
  type RegularIntervalNumbering,
  type RegularIntervalVerbosity,
} from '@/lib/regularIntervalLabels';

export default function RegularIntervalLabelsDialog({
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
  onApply: (settings: RegularIntervalLabelsSettings) => Promise<void>;
}) {
  const [settings, setSettings] = useState<RegularIntervalLabelsSettings>({
    ...DEFAULT_REGULAR_INTERVAL_LABELS_SETTINGS,
  });
  const [applyError, setApplyError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSettings({ ...DEFAULT_REGULAR_INTERVAL_LABELS_SETTINGS });
    setApplyError(null);
  }, [open]);

  let validationError: string | null = null;
  try {
    validateRegularIntervalLabelsSettings(settings);
  } catch (error) {
    validationError = error instanceof Error ? error.message : String(error);
  }

  function update<K extends keyof RegularIntervalLabelsSettings>(
    key: K,
    value: RegularIntervalLabelsSettings[K],
  ): void {
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
      <DialogContent data-testid="regular-interval-labels-dialog" className="max-w-[680px] gap-0 p-0">
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle>Regular interval labels</DialogTitle>
          <DialogDescription>按数量或固定间隔创建点标签和区域标签，并自动添加连续编号。</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 px-5 py-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="regular-label-mode">Create labels based on</Label>
              <select id="regular-label-mode" className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={settings.mode} disabled={isApplying}
                onChange={(event) => update('mode', event.target.value as RegularIntervalMode)}>
                <option value="both">Number and Interval</option>
                <option value="number">Number of Labels</option>
                <option value="interval">Label Interval</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="regular-label-count">Number of labels</Label>
              <Input id="regular-label-count" type="number" min={1} max={1000} step={1}
                value={Number.isFinite(settings.totalNumber) ? settings.totalNumber : ''} disabled={isApplying}
                onChange={(event) => update('totalNumber', numberValue(event.target.value, event.target.valueAsNumber))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="regular-label-interval">Label interval (seconds)</Label>
              <Input id="regular-label-interval" type="number" min={0.001} max={3600} step={0.001}
                value={Number.isFinite(settings.interval) ? settings.interval : ''} disabled={isApplying}
                onChange={(event) => update('interval', numberValue(event.target.value, event.target.valueAsNumber))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="regular-label-region">Length of label region (seconds)</Label>
              <Input id="regular-label-region" type="number" min={0} max={3600} step={0.001}
                value={Number.isFinite(settings.regionLength) ? settings.regionLength : ''} disabled={isApplying}
                onChange={(event) => update('regionLength', numberValue(event.target.value, event.target.valueAsNumber))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="regular-label-adjust">Adjust label interval to fit length</Label>
              <select id="regular-label-adjust" className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={settings.adjustToFit ? 'yes' : 'no'} disabled={isApplying}
                onChange={(event) => update('adjustToFit', event.target.value === 'yes')}>
                <option value="no">No</option>
                <option value="yes">Yes</option>
              </select>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="regular-label-text">Label text</Label>
              <Input id="regular-label-text" value={settings.labelText} disabled={isApplying}
                onChange={(event) => update('labelText', event.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="regular-label-numbering">Minimum number of digits in label</Label>
              <select id="regular-label-numbering" className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={settings.numbering} disabled={isApplying}
                onChange={(event) => update('numbering', Number(event.target.value) as RegularIntervalNumbering)}>
                <option value={0}>None - Text Only</option>
                <option value={1}>1 (Before Label)</option>
                <option value={2}>2 (Before Label)</option>
                <option value={3}>3 (Before Label)</option>
                <option value={4}>1 (After Label)</option>
                <option value={5}>2 (After Label)</option>
                <option value={6}>3 (After Label)</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="regular-label-first">Begin numbering from</Label>
              <Input id="regular-label-first" type="number" min={0} step={1}
                value={Number.isFinite(settings.firstNumber) ? settings.firstNumber : ''} disabled={isApplying}
                onChange={(event) => update('firstNumber', numberValue(event.target.value, event.target.valueAsNumber))} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="regular-label-verbosity">Message on completion</Label>
              <select id="regular-label-verbosity" className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={settings.verbosity} disabled={isApplying}
                onChange={(event) => update('verbosity', event.target.value as RegularIntervalVerbosity)}>
                <option value="details">Details</option>
                <option value="warnings">Warnings only</option>
                <option value="none">None</option>
              </select>
            </div>
          </div>
          <p className="text-[11px] leading-4 text-muted-foreground">
            选区：{selectionStart.toFixed(3)}–{selectionEnd.toFixed(3)} 秒。与官方插件一致，只生成一组标签并归入最后一个目标轨道。
          </p>
          {(validationError || applyError) && <p role="alert" className="text-xs text-destructive">{validationError ?? applyError}</p>}
        </div>
        <DialogFooter className="border-t px-5 py-4">
          <Button type="button" variant="outline" disabled={isApplying} onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" disabled={Boolean(validationError) || isApplying} onClick={() => { void apply(); }}>
            {isApplying ? '创建中…' : 'OK'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
