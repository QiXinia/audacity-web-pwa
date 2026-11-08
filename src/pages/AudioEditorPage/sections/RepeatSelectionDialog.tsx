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
import { getMaxRepeatCount } from '@/lib/repeatEditing';

interface RepeatSelectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectionDuration: number;
  sampleRate: number;
  isRepeating: boolean;
  onRepeat: (repeatCount: number) => void | Promise<void>;
}

export default function RepeatSelectionDialog({
  open,
  onOpenChange,
  selectionDuration,
  sampleRate,
  isRepeating,
  onRepeat,
}: RepeatSelectionDialogProps) {
  const [countText, setCountText] = useState('1');
  const maxCount = getMaxRepeatCount(sampleRate);
  const repeatCount = Number(countText);
  const valid = countText.trim() !== ''
    && Number.isSafeInteger(repeatCount)
    && repeatCount >= 1
    && repeatCount <= maxCount;

  useEffect(() => {
    if (open) setCountText('1');
  }, [open]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (valid && !isRepeating) void onRepeat(repeatCount);
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => {
      if (!isRepeating) onOpenChange(nextOpen);
    }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>重复选区</DialogTitle>
          <DialogDescription>
            按 Audacity Repeat 将选区副本依次插入原选区之后，后续音频自动右移。
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="repeat-selection-count">新增重复次数</Label>
            <Input
              id="repeat-selection-count"
              type="number"
              min={1}
              max={maxCount}
              step={1}
              value={countText}
              disabled={isRepeating}
              onChange={(event) => setCountText(event.target.value)}
              aria-describedby="repeat-selection-times repeat-selection-error"
              autoFocus
            />
          </div>
          <div id="repeat-selection-times" className="space-y-1 rounded-md bg-muted/50 p-3 text-sm">
            <p>当前选区时长：<span className="font-mono">{formatTime(selectionDuration)}</span></p>
            <p>新选区时长：<span className="font-mono">
              {valid ? formatTime(selectionDuration * (repeatCount + 1)) : '—'}
            </span></p>
          </div>
          {!valid && (
            <p id="repeat-selection-error" role="alert" className="text-sm text-destructive">
              请输入 1–{maxCount} 的整数；零次或无效次数不会修改音频。
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="secondary" disabled={isRepeating} onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit" disabled={!valid || isRepeating}>
              {isRepeating ? '重复中…' : '应用重复'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
