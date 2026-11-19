import { useEffect, useState } from 'react';
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
import type { IClip } from '@/types/project';
import {
  MAX_CLIP_SPEED_PERCENT,
  MIN_CLIP_SPEED_PERCENT,
  composeClipPitchCents,
  getClipOptimizeForVoice,
  getClipPitchCents,
  getClipSpeedPercentage,
  normalizeClipSpeedPercentage,
  splitClipPitchCents,
  type ClipPitchAndSpeedSettings,
} from '@/lib/clipPitchSpeed';

interface ClipPitchAndSpeedDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clip: IClip;
  isPlaying: boolean;
  onApply: (settings: ClipPitchAndSpeedSettings) => Promise<void>;
}

export function ClipPitchAndSpeedDialog({
  open,
  onOpenChange,
  clip,
  isPlaying,
  onApply,
}: ClipPitchAndSpeedDialogProps) {
  const [semitones, setSemitones] = useState('0');
  const [cents, setCents] = useState('0');
  const [speed, setSpeed] = useState('100.000');
  const [optimizeForVoice, setOptimizeForVoice] = useState(false);
  const [error, setError] = useState('');
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    if (!open) return;
    const pitch = splitClipPitchCents(getClipPitchCents(clip));
    setSemitones(String(pitch.semitones));
    setCents(String(pitch.cents));
    setSpeed(getClipSpeedPercentage(clip).toFixed(3));
    setOptimizeForVoice(getClipOptimizeForVoice(clip));
    setError('');
    setApplying(false);
  }, [open, clip]);

  async function handleDone() {
    const semitoneValue = Number(semitones);
    const centValue = Number(cents);
    const speedValue = Number(speed);
    if (!Number.isFinite(semitoneValue) || !Number.isFinite(centValue)) {
      setError('Semitones 和 Cents 必须是有效数字');
      return;
    }
    if (!Number.isFinite(speedValue) || speedValue <= 0) {
      setError('Clip speed 必须是大于零的有效数字');
      return;
    }
    if (isPlaying && Math.abs(speedValue - getClipSpeedPercentage(clip)) > 0.0005) {
      setError('播放运行时不能更改 Clip speed，请先停止播放');
      return;
    }
    setApplying(true);
    setError('');
    try {
      await onApply({
        pitchCents: composeClipPitchCents(semitoneValue, centValue),
        speedPercentage: normalizeClipSpeedPercentage(speedValue),
        optimizeForVoice,
      });
      onOpenChange(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法应用片段音高与速度');
    } finally {
      setApplying(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]" data-testid="clip-pitch-speed-dialog">
        <DialogHeader>
          <DialogTitle>Pitch and speed</DialogTitle>
          <DialogDescription>
            {clip.name || '音频片段'} · 非破坏性调整，播放和导出使用同一处理链路。
          </DialogDescription>
        </DialogHeader>

        <section aria-labelledby="clip-pitch-heading" className="space-y-3 rounded-md border p-4">
          <h3 id="clip-pitch-heading" className="text-sm font-semibold">Clip pitch</h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="clip-semitones">Semitones</Label>
              <Input
                id="clip-semitones"
                aria-label="Semitones"
                type="number"
                min={-12}
                max={12}
                step={1}
                value={semitones}
                onChange={(event) => setSemitones(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="clip-cents">Cents</Label>
              <Input
                id="clip-cents"
                aria-label="Cents"
                type="number"
                min={-99}
                max={100}
                step={1}
                value={cents}
                onChange={(event) => setCents(event.target.value)}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">总音高范围 −1200…1200 cents，最终值按整数 cent 保存。</p>
        </section>

        <section aria-labelledby="clip-speed-heading" className="space-y-3 rounded-md border p-4">
          <h3 id="clip-speed-heading" className="text-sm font-semibold">Clip speed</h3>
          <div className="space-y-1.5">
            <Label htmlFor="clip-speed-percentage">Speed percentage</Label>
            <div className="relative">
              <Input
                id="clip-speed-percentage"
                aria-label="Clip speed"
                type="number"
                min={MIN_CLIP_SPEED_PERCENT}
                max={MAX_CLIP_SPEED_PERCENT}
                step={0.001}
                value={speed}
                disabled={isPlaying}
                onChange={(event) => setSpeed(event.target.value)}
                className="pr-10"
              />
              <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">%</span>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            {isPlaying ? '播放运行时禁止更改速度。' : '范围 1…1000%，保留三位小数；改变速度不会改变可见源音频区间。'}
          </p>
        </section>

        <label className="flex items-start gap-2 rounded-md border p-3 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={optimizeForVoice}
            onChange={(event) => setOptimizeForVoice(event.target.checked)}
          />
          <span>
            <span className="font-medium">Optimize for voice</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              按 Audacity GetFftSize 公式使用更短的 WSOLA 分析窗（44.1kHz：普通 4096、语音 2048）；仅对齐官方窗长，不包含 StaffPad 共振峰补偿。
            </span>
          </span>
        </label>

        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={applying}>Cancel</Button>
          <Button type="button" onClick={handleDone} disabled={applying}>{applying ? 'Applying…' : 'Done'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
