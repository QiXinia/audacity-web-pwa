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
import { validateDelaySettings, type DelaySettings } from '@/lib/delayEffect';
import type { PreviewChannels } from '@/lib/generatorPreview';
import { useGeneratorPreview } from './useGeneratorPreview';

interface DelayEffectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sampleRate: number;
  selectionStart: number;
  selectionEnd: number;
  isApplying: boolean;
  onPreview: (settings: DelaySettings) => Promise<PreviewChannels>;
  onApply: (settings: DelaySettings) => void | Promise<void>;
}

export default function DelayEffectDialog({
  open,
  onOpenChange,
  sampleRate,
  selectionStart,
  selectionEnd,
  isApplying,
  onPreview,
  onApply,
}: DelayEffectDialogProps) {
  const [delayType, setDelayType] = useState<DelaySettings['delayType']>('regular');
  const [delayLevelText, setDelayLevelText] = useState('-6');
  const [delaySecondsText, setDelaySecondsText] = useState('0.3');
  const [pitchMode, setPitchMode] = useState<DelaySettings['pitchMode']>('pitchTempo');
  const [pitchText, setPitchText] = useState('0');
  const [echoCountText, setEchoCountText] = useState('5');
  const [allowDurationChange, setAllowDurationChange] = useState(true);
  const { isPreviewing, previewError, startPreview, stopPreview } = useGeneratorPreview();

  const settings: DelaySettings = {
    delayType,
    delayLevelDb: Number(delayLevelText),
    delaySeconds: Number(delaySecondsText),
    pitchMode,
    pitchChangeSemitones: Number(pitchText),
    echoCount: Number(echoCountText),
    allowDurationChange,
  };
  let validationError = '';
  try {
    validateDelaySettings(settings);
  } catch (error) {
    validationError = error instanceof Error ? error.message : 'Delay 参数无效';
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
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Delay 延迟</DialogTitle>
          <DialogDescription>按 Audacity Nyquist Delay 生成有限数量的延迟副本，支持弹跳节奏与音高变化。</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="delay-type">延迟类型</Label>
              <select
                id="delay-type"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={delayType}
                disabled={isApplying}
                onChange={(event) => setDelayType(event.target.value as DelaySettings['delayType'])}
              >
                <option value="regular">Regular 常规</option>
                <option value="bouncingBall">Bouncing Ball 弹跳球</option>
                <option value="reverseBouncingBall">Reverse Bouncing Ball 反向弹跳球</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="delay-level">每回声电平（dB）</Label>
              <Input id="delay-level" type="number" min={-30} max={1} step="any" value={delayLevelText} disabled={isApplying} onChange={(event) => setDelayLevelText(event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="delay-time">延迟时间（秒）</Label>
              <Input id="delay-time" type="number" min={0} max={5} step="any" value={delaySecondsText} disabled={isApplying} onChange={(event) => setDelaySecondsText(event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pitch-mode">音高效果</Label>
              <select
                id="pitch-mode"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={pitchMode}
                disabled={isApplying}
                onChange={(event) => setPitchMode(event.target.value as DelaySettings['pitchMode'])}
              >
                <option value="pitchTempo">Pitch/Tempo 音高与速度</option>
                <option value="lowQualityPitchShift">Low-quality Pitch Shift 低质量移调</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="pitch-change">每回声音高变化（半音）</Label>
              <Input id="pitch-change" type="number" min={-2} max={2} step="any" value={pitchText} disabled={isApplying} onChange={(event) => setPitchText(event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="echo-count">回声数量</Label>
              <Input id="echo-count" type="number" min={1} max={30} step={1} value={echoCountText} disabled={isApplying} onChange={(event) => setEchoCountText(event.target.value)} />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={allowDurationChange} disabled={isApplying} onChange={(event) => setAllowDurationChange(event.target.checked)} />
            允许时长改变；取消后输出截断为原选区长度
          </label>
          <div className="space-y-1 rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
            <p>选区：{formatTime(selectionStart)}–{formatTime(selectionEnd)}，共 {formatTime(selectionEnd - selectionStart)}</p>
            <p>弹跳球模式下，延迟时间表示最大延迟间隔。</p>
          </div>
          {validationError && <p role="alert" className="text-sm text-destructive">{validationError}</p>}
          {previewError && <p role="alert" className="text-sm text-destructive">试听失败：{previewError}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={isApplying || !!validationError} onClick={isPreviewing ? stopPreview : preview}>
              {isPreviewing ? '停止试听' : '试听'}
            </Button>
            <Button type="button" variant="secondary" onClick={() => changeOpen(false)}>取消</Button>
            <Button type="submit" disabled={isApplying || !!validationError}>{isApplying ? '正在应用…' : '应用 Delay'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
