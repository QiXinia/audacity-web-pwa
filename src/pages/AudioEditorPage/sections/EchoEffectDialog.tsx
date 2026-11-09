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
import {
  ECHO_DEFAULT_DECAY,
  ECHO_DEFAULT_DELAY_SECONDS,
  ECHO_MIN_DELAY_SECONDS,
  getEchoPlan,
  type EchoPlan,
} from '@/lib/echoEffect';
import type { PreviewChannels } from '@/lib/generatorPreview';
import { useGeneratorPreview } from './useGeneratorPreview';

interface EchoEffectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sampleRate: number;
  selectionStart: number;
  selectionEnd: number;
  isApplying: boolean;
  onPreview: (delaySeconds: number, decay: number) => Promise<PreviewChannels>;
  onApply: (delaySeconds: number, decay: number) => void | Promise<void>;
}

export default function EchoEffectDialog({
  open,
  onOpenChange,
  sampleRate,
  selectionStart,
  selectionEnd,
  isApplying,
  onPreview,
  onApply,
}: EchoEffectDialogProps) {
  const [delayText, setDelayText] = useState(String(ECHO_DEFAULT_DELAY_SECONDS));
  const [decayText, setDecayText] = useState(String(ECHO_DEFAULT_DECAY));
  const { isPreviewing, previewError, startPreview, stopPreview } = useGeneratorPreview();
  const delaySeconds = Number(delayText);
  const decay = Number(decayText);

  let validationError = '';
  let plan: EchoPlan | null = null;
  try {
    plan = getEchoPlan(delaySeconds, decay, sampleRate);
  } catch (error) {
    validationError = error instanceof Error ? error.message : '回声参数无效';
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
    if (!plan || isApplying) return;
    stopPreview();
    void onApply(delaySeconds, decay);
  }

  function preview() {
    if (!plan || isApplying) return;
    void startPreview(() => onPreview(delaySeconds, decay), sampleRate);
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Echo 回声</DialogTitle>
          <DialogDescription>
            按 Audacity Echo 递归叠加固定延迟的选区副本，不延长选区或片段。
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="echo-delay">延迟时间（秒）</Label>
              <Input
                id="echo-delay"
                type="number"
                min={ECHO_MIN_DELAY_SECONDS}
                step="any"
                value={delayText}
                disabled={isApplying}
                onChange={(event) => setDelayText(event.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="echo-decay">衰减因子</Label>
              <Input
                id="echo-decay"
                type="number"
                min={0}
                step="any"
                value={decayText}
                disabled={isApplying}
                onChange={(event) => setDecayText(event.target.value)}
                required
              />
            </div>
          </div>
          <div className="space-y-1 rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
            <p>选区：{formatTime(selectionStart)}–{formatTime(selectionEnd)}，共 {formatTime(selectionEnd - selectionStart)}</p>
            {plan && <p data-testid="echo-plan">延迟 {plan.delaySamples} 个采样；每条轨道、每个声道独立保留递归历史。</p>}
            <p>延迟不短于选区时不会产生回声；衰减大于 1 会逐次增强。试听仅使用第一条含音频的轨道。</p>
          </div>
          {validationError && <p role="alert" className="text-sm text-destructive">{validationError}</p>}
          {previewError && <p role="alert" className="text-sm text-destructive">试听失败：{previewError}</p>}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              aria-pressed={isPreviewing}
              disabled={isApplying || !plan}
              onClick={isPreviewing ? stopPreview : preview}
            >
              {isPreviewing ? '停止试听' : '试听'}
            </Button>
            <Button type="button" variant="secondary" onClick={() => changeOpen(false)}>取消</Button>
            <Button type="submit" disabled={isApplying || !plan}>
              {isApplying ? '正在应用…' : '应用回声'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
