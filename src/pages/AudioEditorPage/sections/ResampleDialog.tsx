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
import {
  MAX_RESAMPLE_RATE,
  MIN_RESAMPLE_RATE,
  parseResampleRate,
  RESAMPLE_RATE_CHOICES,
} from '@/lib/resampleEffect';

interface ResampleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectSampleRate: number;
  selectedTrackCount: number;
  isResampling: boolean;
  onResample: (newRate: number) => void | Promise<void>;
  title?: string;
}

export default function ResampleDialog({
  open,
  onOpenChange,
  projectSampleRate,
  selectedTrackCount,
  isResampling,
  onResample,
  title = 'Resample 重采样',
}: ResampleDialogProps) {
  const [rateText, setRateText] = useState(String(Math.round(projectSampleRate)));
  const newRate = parseResampleRate(rateText);

  useEffect(() => {
    if (open) setRateText(String(Math.round(projectSampleRate)));
  }, [open, projectSampleRate]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (newRate !== null && !isResampling) void onResample(newRate);
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => {
      if (!isResampling) onOpenChange(nextOpen);
    }}>
      <DialogContent data-testid="resample-dialog" className="max-w-[460px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            按 Audacity 整轨命令重采样选中轨道的全部原始片段；时间位置、裁剪、拉伸和效果保持不变。
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="resample-rate">New sample rate (Hz): 新采样率（Hz）</Label>
            <Input
              id="resample-rate"
              data-testid="resample-input"
              type="text"
              inputMode="numeric"
              list="resample-rate-choices"
              value={rateText}
              disabled={isResampling}
              onChange={(event) => setRateText(event.target.value)}
              aria-describedby="resample-rate-help resample-rate-error"
              aria-invalid={newRate === null}
              autoFocus
            />
            <datalist id="resample-rate-choices">
              {RESAMPLE_RATE_CHOICES.map((rate) => <option key={rate} value={rate} />)}
            </datalist>
            <p id="resample-rate-help" className="text-xs text-muted-foreground">
              输入 {MIN_RESAMPLE_RATE.toLocaleString()}–{MAX_RESAMPLE_RATE.toLocaleString()} Hz 的整数；
              将处理 {selectedTrackCount} 条选中轨道。
            </p>
          </div>
          {newRate === null && (
            <p id="resample-rate-error" role="alert" className="text-sm text-destructive">
              The entered value is invalid. 请输入 1–1000000 Hz 的整数采样率。
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="secondary" disabled={isResampling} onClick={() => onOpenChange(false)}>
              Cancel 取消
            </Button>
            <Button type="submit" data-testid="resample-confirm" disabled={newRate === null || isResampling || selectedTrackCount === 0}>
              {isResampling ? 'Resampling… 重采样中…' : 'Resample 应用'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
