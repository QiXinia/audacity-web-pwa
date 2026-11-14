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
import { validateClipFixSettings, type ClipFixSettings } from '@/lib/clipFixEffect';
import type { PreviewChannels } from '@/lib/generatorPreview';
import { useGeneratorPreview } from './useGeneratorPreview';

interface ClipFixDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sampleRate: number;
  selectionStart: number;
  selectionEnd: number;
  isApplying: boolean;
  onPreview: (settings: ClipFixSettings) => Promise<PreviewChannels>;
  onApply: (settings: ClipFixSettings) => void | Promise<void>;
}

export default function ClipFixDialog({
  open,
  onOpenChange,
  sampleRate,
  selectionStart,
  selectionEnd,
  isApplying,
  onPreview,
  onApply,
}: ClipFixDialogProps) {
  const [thresholdText, setThresholdText] = useState('95');
  const [gainText, setGainText] = useState('-9');
  const { isPreviewing, previewError, startPreview, stopPreview } = useGeneratorPreview();

  const settings: ClipFixSettings = {
    thresholdPercent: Number(thresholdText),
    reduceGainDb: Number(gainText),
  };
  let validationError = '';
  try {
    validateClipFixSettings(settings);
  } catch (error) {
    validationError = error instanceof Error ? error.message : 'Clip Fix 参数无效';
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
          <DialogTitle>Clip Fix 削波修复</DialogTitle>
          <DialogDescription>检测被压平的波形顶部或底部，并用三次曲线插值重建合理峰值。</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="clip-threshold">削波阈值（%）</Label>
              <Input id="clip-threshold" type="number" min={0} max={100} step="any" value={thresholdText} disabled={isApplying} onChange={(event) => setThresholdText(event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="clip-gain">预留峰值增益（dB）</Label>
              <Input id="clip-gain" type="number" min={-30} max={0} step="any" value={gainText} disabled={isApplying} onChange={(event) => setGainText(event.target.value)} />
            </div>
          </div>
          <div className="space-y-1 rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
            <p>选区：{formatTime(selectionStart)}–{formatTime(selectionEnd)}，共 {formatTime(selectionEnd - selectionStart)}</p>
            <p>削波区域两侧必须存在未削波采样；修复结果为合理重建，不能恢复未记录的原始信号。</p>
          </div>
          {validationError && <p role="alert" className="text-sm text-destructive">{validationError}</p>}
          {previewError && <p role="alert" className="text-sm text-destructive">试听失败：{previewError}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={isApplying || !!validationError} onClick={isPreviewing ? stopPreview : preview}>
              {isPreviewing ? '停止试听' : '试听'}
            </Button>
            <Button type="button" variant="secondary" onClick={() => changeOpen(false)}>取消</Button>
            <Button type="submit" disabled={isApplying || !!validationError}>{isApplying ? '正在应用…' : '应用 Clip Fix'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
