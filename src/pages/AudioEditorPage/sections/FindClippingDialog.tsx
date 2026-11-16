import { useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  DEFAULT_FIND_CLIPPING_SETTINGS,
  validateFindClippingSettings,
  type FindClippingSettings,
} from '@/lib/findClipping';

export default function FindClippingDialog({
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
  onApply: (settings: FindClippingSettings) => Promise<void>;
}) {
  const [settings, setSettings] = useState<FindClippingSettings>({ ...DEFAULT_FIND_CLIPPING_SETTINGS });
  const [applyError, setApplyError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSettings({ ...DEFAULT_FIND_CLIPPING_SETTINGS });
    setApplyError(null);
  }, [open]);

  let validationError: string | null = null;
  try {
    validateFindClippingSettings(settings);
  } catch (error) {
    validationError = error instanceof Error ? error.message : String(error);
  }

  async function apply() {
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
      <DialogContent data-testid="find-clipping-dialog" className="max-w-[460px] gap-0 p-0">
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle>Find Clipping</DialogTitle>
          <DialogDescription>Creates labels where clipping is detected. 按声道查找满幅采样并生成 Clipping 标签。</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 px-5 py-5">
          <div className="space-y-1.5">
            <Label htmlFor="find-clipping-start">Start threshold (samples):</Label>
            <Input
              id="find-clipping-start"
              type="number"
              min={1}
              step={1}
              value={Number.isFinite(settings.startThreshold) ? settings.startThreshold : ''}
              disabled={isApplying}
              onChange={(event) => setSettings((current) => ({
                ...current,
                startThreshold: event.target.value === '' ? Number.NaN : event.target.valueAsNumber,
              }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="find-clipping-stop">Stop threshold (samples):</Label>
            <Input
              id="find-clipping-stop"
              type="number"
              min={1}
              step={1}
              value={Number.isFinite(settings.stopThreshold) ? settings.stopThreshold : ''}
              disabled={isApplying}
              onChange={(event) => setSettings((current) => ({
                ...current,
                stopThreshold: event.target.value === '' ? Number.NaN : event.target.valueAsNumber,
              }))}
            />
          </div>
          <p className="text-[11px] leading-4 text-muted-foreground">
            选区：{selectionStart.toFixed(3)}–{selectionEnd.toFixed(3)} 秒 · {sampleRate} Hz。绝对值 ≥ 1 的采样计为削波；标签只在后续非削波采样达到 Stop threshold 后生成。
          </p>
          {(validationError || applyError) && <p role="alert" className="text-xs text-destructive">{validationError ?? applyError}</p>}
        </div>
        <DialogFooter className="items-center border-t px-5 py-4 sm:justify-between">
          <Button asChild type="button" size="sm" variant="ghost">
            <a href="https://manual.audacityteam.org/man/find_clipping.html" target="_blank" rel="noreferrer"><ExternalLink className="mr-1 h-3.5 w-3.5" />Help</a>
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="outline" disabled={isApplying} onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="button" disabled={Boolean(validationError) || isApplying} onClick={() => { void apply(); }}>
              {isApplying ? '分析中…' : 'OK'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
