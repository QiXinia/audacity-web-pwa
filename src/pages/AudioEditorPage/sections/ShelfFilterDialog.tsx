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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatTime } from '@/lib/audioUtils';
import {
  DEFAULT_SHELF_FILTER_SETTINGS,
  validateShelfFilterSettings,
  type ShelfFilterKind,
  type ShelfFilterSettings,
} from '@/lib/shelfFilterEffect';
import type { PreviewChannels } from '@/lib/generatorPreview';
import { useGeneratorPreview } from './useGeneratorPreview';

interface ShelfFilterDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sampleRate: number;
  selectionStart: number;
  selectionEnd: number;
  isApplying: boolean;
  onPreview: (settings: ShelfFilterSettings) => Promise<PreviewChannels>;
  onApply: (settings: ShelfFilterSettings) => void | Promise<void>;
}

export default function ShelfFilterDialog({
  open,
  onOpenChange,
  sampleRate,
  selectionStart,
  selectionEnd,
  isApplying,
  onPreview,
  onApply,
}: ShelfFilterDialogProps) {
  const [type, setType] = useState<ShelfFilterKind>(DEFAULT_SHELF_FILTER_SETTINGS.type);
  const [frequencyText, setFrequencyText] = useState(String(DEFAULT_SHELF_FILTER_SETTINGS.frequencyHz));
  const [gainText, setGainText] = useState(String(DEFAULT_SHELF_FILTER_SETTINGS.gainDb));
  const { isPreviewing, previewError, startPreview, stopPreview } = useGeneratorPreview();

  const settings = useMemo<ShelfFilterSettings>(() => ({
    type,
    frequencyHz: Number(frequencyText),
    gainDb: Number(gainText),
  }), [type, frequencyText, gainText]);
  const validationError = useMemo(() => {
    if (!frequencyText.trim() || !gainText.trim()) return '请填写频率和增益';
    try {
      validateShelfFilterSettings(settings, sampleRate);
      return '';
    } catch (error) {
      return error instanceof Error ? error.message : 'Shelf Filter 参数无效';
    }
  }, [frequencyText, gainText, sampleRate, settings]);
  const bypassed = !validationError && settings.gainDb === 0;

  useEffect(() => {
    if (!open) stopPreview();
  }, [open, stopPreview]);

  function changeOpen(nextOpen: boolean) {
    if (!nextOpen) stopPreview();
    onOpenChange(nextOpen);
  }

  function reset() {
    setType(DEFAULT_SHELF_FILTER_SETTINGS.type);
    setFrequencyText(String(DEFAULT_SHELF_FILTER_SETTINGS.frequencyHz));
    setGainText(String(DEFAULT_SHELF_FILTER_SETTINGS.gainDb));
    stopPreview();
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (validationError || bypassed || isApplying) return;
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
          <DialogTitle>Shelf Filter 搁架滤波</DialogTitle>
          <DialogDescription>按 Audacity 4.0.0 的 slope=1 二阶滤波器提升或削减低频 / 高频。</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="shelf-filter-type">滤波类型</Label>
            <select
              id="shelf-filter-type"
              value={type}
              disabled={isApplying}
              onChange={(event) => setType(event.target.value as ShelfFilterKind)}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="low">Low-shelf 低架</option>
              <option value="high">High-shelf 高架</option>
            </select>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="shelf-filter-frequency">频率（Hz）</Label>
              <Input id="shelf-filter-frequency" type="number" min={10} max={10000} step={1} value={frequencyText} disabled={isApplying} onChange={(event) => setFrequencyText(event.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="shelf-filter-gain">增益（dB）</Label>
              <Input id="shelf-filter-gain" type="number" min={-72} max={72} step={1} value={gainText} disabled={isApplying} onChange={(event) => setGainText(event.target.value)} required />
            </div>
          </div>
          <div className="space-y-1 rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
            <p>选区：{formatTime(selectionStart)}–{formatTime(selectionEnd)}，共 {formatTime(Math.max(0, selectionEnd - selectionStart))}</p>
            <p>频率须低于 {sampleRate / 2} Hz；接近 Nyquist 时按官方逻辑在双倍采样率处理。0 dB 可直接试听，但不写入无效历史。</p>
          </div>
          {bypassed && <p className="text-xs text-muted-foreground">当前为 0 dB，无实际处理；请选择非零增益后应用。</p>}
          {validationError && <p role="alert" className="text-sm text-destructive">{validationError}</p>}
          {previewError && <p role="alert" className="text-sm text-destructive">试听失败：{previewError}</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={isApplying} onClick={reset}>恢复默认</Button>
            <Button type="button" variant="outline" disabled={isApplying || !!validationError} onClick={isPreviewing ? stopPreview : preview}>
              {isPreviewing ? '停止试听' : '试听'}
            </Button>
            <Button type="button" variant="secondary" onClick={() => changeOpen(false)}>取消</Button>
            <Button type="submit" disabled={isApplying || !!validationError || bypassed}>{isApplying ? '正在应用…' : '应用 Shelf Filter'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
