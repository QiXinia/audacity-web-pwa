import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useGeneratorPreview } from './useGeneratorPreview';
import {
  DEFAULT_PASS_FILTER_SETTINGS,
  PASS_FILTER_ROLLOFFS,
  validatePassFilterSettings,
  type PassFilterKind,
  type PassFilterRolloff,
  type PassFilterSettings,
} from '@/lib/passFilterEffect';

export default function PassFilterDialog({
  kind,
  open,
  onOpenChange,
  sampleRate,
  selectionStart,
  selectionEnd,
  isApplying,
  onPreview,
  onApply,
}: {
  kind: PassFilterKind;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sampleRate: number;
  selectionStart: number;
  selectionEnd: number;
  isApplying: boolean;
  onPreview: (settings: PassFilterSettings) => Promise<Float32Array[]>;
  onApply: (settings: PassFilterSettings) => Promise<void>;
}) {
  const [settings, setSettings] = useState<PassFilterSettings>({
    ...DEFAULT_PASS_FILTER_SETTINGS,
    kind,
  });
  const title = kind === 'highpass' ? 'High-pass filter' : 'Low-pass filter';
  const description = kind === 'highpass'
    ? '衰减截止频率以下的频率，并保持选区时长不变。'
    : '衰减截止频率以上的频率，并保持选区时长不变。';
  const { isPreviewing, previewError, startPreview, stopPreview } = useGeneratorPreview();

  useEffect(() => {
    if (open) {
      setSettings({ ...DEFAULT_PASS_FILTER_SETTINGS, kind });
    } else {
      stopPreview();
    }
  }, [kind, open, stopPreview]);

  function openChanged(next: boolean) {
    if (next) {
      setSettings({ ...DEFAULT_PASS_FILTER_SETTINGS, kind });
      onOpenChange(true);
    } else {
      stopPreview();
      onOpenChange(false);
    }
  }

  function preview() {
    if (error || isApplying) return;
    void startPreview(() => onPreview(settings), sampleRate);
  }

  function apply() {
    if (error || isApplying) return;
    stopPreview();
    void onApply(settings);
  }

  let error: string | null = null;
  if (open) {
    try {
      validatePassFilterSettings(settings, sampleRate);
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    }
  }

  return (
    <Dialog open={open} onOpenChange={openChanged}>
      <DialogContent data-testid={`${kind}-dialog`} className="max-w-[420px] gap-0 p-0">
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 px-5 py-5">
          <div className="space-y-1.5">
            <Label htmlFor={`${kind}-frequency`}>Frequency (Hz)</Label>
            <Input
              id={`${kind}-frequency`}
              type="number"
              min={0.1}
              step={0.1}
              value={Number.isFinite(settings.frequencyHz) ? settings.frequencyHz : ''}
              disabled={isApplying || isPreviewing}
              onChange={(event) => setSettings((current) => ({
                ...current,
                frequencyHz: event.target.value === '' ? Number.NaN : event.target.valueAsNumber,
              }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Roll-off (dB per octave)</Label>
            <Select
              value={String(settings.rolloff)}
              disabled={isApplying || isPreviewing}
              onValueChange={(value) => setSettings((current) => ({
                ...current,
                rolloff: Number(value) as PassFilterRolloff,
              }))}
            >
              <SelectTrigger aria-label="Roll-off (dB per octave)" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PASS_FILTER_ROLLOFFS.map((rolloff) => (
                  <SelectItem key={rolloff} value={String(rolloff)}>{rolloff} dB</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p className="text-[11px] leading-4 text-muted-foreground">
            选区：{selectionStart.toFixed(3)}–{selectionEnd.toFixed(3)} 秒。轨道采样率：{sampleRate} Hz。Frequency 至少为 0.1 Hz，且必须小于 {sampleRate / 2} Hz。
          </p>
          {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
          {previewError && <p role="alert" className="text-xs text-destructive">{previewError}</p>}
        </div>
        <DialogFooter className="border-t px-5 py-4">
          <Button variant="outline" disabled={isApplying} onClick={() => openChanged(false)}>
            取消
          </Button>
          <Button
            variant="outline"
            disabled={Boolean(error) || isApplying}
            onClick={isPreviewing ? stopPreview : preview}
          >
            {isPreviewing ? '停止试听' : '试听'}
          </Button>
          <Button
            disabled={Boolean(error) || isApplying}
            onClick={apply}
          >
            {isApplying ? '应用中…' : '应用'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
