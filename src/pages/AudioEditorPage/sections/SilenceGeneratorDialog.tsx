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
import { formatGeneratorDuration } from '@/lib/generatorDuration';

interface SilenceGeneratorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sampleRate: number;
  cursorPosition: number;
  defaultDuration: number;
  selectionActive: boolean;
  isGenerating: boolean;
  onGenerate: (duration: number) => void | Promise<void>;
}

export default function SilenceGeneratorDialog({
  open,
  onOpenChange,
  sampleRate,
  cursorPosition,
  defaultDuration,
  selectionActive,
  isGenerating,
  onGenerate,
}: SilenceGeneratorDialogProps) {
  const [duration, setDuration] = useState('30');

  useEffect(() => {
    if (open && Number.isFinite(defaultDuration) && defaultDuration > 0) {
      setDuration(formatGeneratorDuration(defaultDuration));
    }
  }, [open, defaultDuration]);

  function submit(event: FormEvent) {
    event.preventDefault();
    void onGenerate(Number(duration));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>生成静默</DialogTitle>
          <DialogDescription>
            {selectionActive
              ? '按 Audacity Silence Audio 语义，将当前轨道选区替换为零振幅音频，不改变片段边界。'
              : '在光标处插入 Audacity 风格的零振幅单声道音频片段。'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="silence-duration">时长（秒）</Label>
            <Input
              id="silence-duration"
              type="number"
              min={1 / sampleRate}
              step="any"
              value={duration}
              onChange={(event) => setDuration(event.target.value)}
              readOnly={selectionActive}
              aria-readonly={selectionActive}
              required
            />
          </div>
          <p className="text-xs text-muted-foreground">
            采样率 {sampleRate} Hz · {selectionActive
              ? '选区时长与 Audacity 一样固定为当前选区长度'
              : `插入位置 ${formatTime(cursorPosition)} · 默认 30 秒并记住上次时长`}
          </p>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>取消</Button>
            <Button type="submit" disabled={isGenerating}>
              {isGenerating ? '正在生成…' : '生成静默'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
