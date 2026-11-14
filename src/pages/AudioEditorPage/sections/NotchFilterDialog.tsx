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
import { validateNotchFilterSettings, type NotchFilterSettings } from '@/lib/notchFilterEffect';
import type { PreviewChannels } from '@/lib/generatorPreview';
import { useGeneratorPreview } from './useGeneratorPreview';

interface NotchFilterDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sampleRate: number;
  selectionStart: number;
  selectionEnd: number;
  isApplying: boolean;
  onPreview: (settings: NotchFilterSettings) => Promise<PreviewChannels>;
  onApply: (settings: NotchFilterSettings) => void | Promise<void>;
}

export default function NotchFilterDialog({
  open,
  onOpenChange,
  sampleRate,
  selectionStart,
  selectionEnd,
  isApplying,
  onPreview,
  onApply,
}: NotchFilterDialogProps) {
  const [frequencyText, setFrequencyText] = useState('60');
  const [qText, setQText] = useState('1');
  const { isPreviewing, previewError, startPreview, stopPreview } = useGeneratorPreview();

  const settings: NotchFilterSettings = {
    frequencyHz: Number(frequencyText),
    q: Number(qText),
  };
  let validationError = '';
  try {
    validateNotchFilterSettings(settings, sampleRate);
  } catch (error) {
    validationError = error instanceof Error ? error.message : 'Notch Filter 参数无效';
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
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Notch Filter 陷波滤波</DialogTitle>
          <DialogDescription>移除单一中心频率周围的窄带，同时尽量保留其他频率。</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="notch-frequency">频率（Hz）</Label>
              <Input id="notch-frequency" type="number" min={0.1} step="any" value={frequencyText} disabled={isApplying} onChange={(event) => setFrequencyText(event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="notch-q">Q（数值越高，频带越窄）</Label>
              <Input id="notch-q" type="number" min={0.1} max={1000} step="any" value={qText} disabled={isApplying} onChange={(event) => setQText(event.target.value)} />
            </div>
          </div>
          <div className="space-y-1 rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
            <p>选区：{formatTime(selectionStart)}–{formatTime(selectionEnd)}，共 {formatTime(selectionEnd - selectionStart)}</p>
            <p>频率必须低于当前 Nyquist 频率（{sampleRate / 2} Hz）；Q 范围为 0.1–1000。</p>
          </div>
          {validationError && <p role="alert" className="text-sm text-destructive">{validationError}</p>}
          {previewError && <p role="alert" className="text-sm text-destructive">试听失败：{previewError}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={isApplying || !!validationError} onClick={isPreviewing ? stopPreview : preview}>
              {isPreviewing ? '停止试听' : '试听'}
            </Button>
            <Button type="button" variant="secondary" onClick={() => changeOpen(false)}>取消</Button>
            <Button type="submit" disabled={isApplying || !!validationError}>{isApplying ? '正在应用…' : '应用 Notch Filter'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
