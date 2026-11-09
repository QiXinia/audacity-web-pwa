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
  calculateDtmfTiming,
  DTMF_DEFAULT_AMPLITUDE,
  DTMF_DEFAULT_DUTY_CYCLE,
  DTMF_DEFAULT_SEQUENCE,
  generateDtmf,
  isValidDtmfSequence,
  type DtmfRequest,
} from '@/lib/dtmfGenerator';
import { formatGeneratorDuration } from '@/lib/generatorDuration';
import { useGeneratorPreview } from './useGeneratorPreview';

interface DtmfGeneratorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sampleRate: number;
  cursorPosition: number;
  defaultDuration: number;
  selectionActive?: boolean;
  replacementPosition?: number;
  replacementEnd?: number;
  isGenerating: boolean;
  onGenerate: (settings: DtmfRequest) => void | Promise<void>;
}

export default function DtmfGeneratorDialog({
  open,
  onOpenChange,
  sampleRate,
  cursorPosition,
  defaultDuration,
  selectionActive = false,
  replacementPosition,
  replacementEnd,
  isGenerating,
  onGenerate,
}: DtmfGeneratorDialogProps) {
  const [sequence, setSequence] = useState(DTMF_DEFAULT_SEQUENCE);
  const [amplitude, setAmplitude] = useState(String(DTMF_DEFAULT_AMPLITUDE));
  const [dutyCycle, setDutyCycle] = useState(String(DTMF_DEFAULT_DUTY_CYCLE));
  const [duration, setDuration] = useState('30');
  const { isPreviewing, previewError, startPreview, stopPreview } = useGeneratorPreview();

  useEffect(() => {
    if (open && Number.isFinite(defaultDuration) && defaultDuration > 0) {
      setDuration(formatGeneratorDuration(defaultDuration));
    }
  }, [open, defaultDuration]);

  useEffect(() => {
    if (!open) stopPreview();
  }, [open, stopPreview]);

  const numericDuration = Number(duration);
  const numericAmplitude = Number(amplitude);
  const numericDutyCycle = Number(dutyCycle);
  const canGenerate = isValidDtmfSequence(sequence)
    && Number.isFinite(numericDuration) && numericDuration > 0
    && Number.isFinite(numericAmplitude) && numericAmplitude >= 0 && numericAmplitude <= 1
    && Number.isFinite(numericDutyCycle) && numericDutyCycle >= 0 && numericDutyCycle <= 100;
  const timing = useMemo(() => {
    if (!canGenerate) return null;
    try {
      return calculateDtmfTiming({ sequence, duration: numericDuration, dutyCycle: numericDutyCycle });
    } catch {
      return null;
    }
  }, [canGenerate, sequence, numericDuration, numericDutyCycle]);

  function changeOpen(nextOpen: boolean) {
    if (!nextOpen) stopPreview();
    onOpenChange(nextOpen);
  }

  function settings(): DtmfRequest {
    return {
      sequence,
      amplitude: numericAmplitude,
      dutyCycle: numericDutyCycle,
      duration: numericDuration,
    };
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!canGenerate) return;
    stopPreview();
    void onGenerate(settings());
  }

  function preview() {
    if (!canGenerate) return;
    void startPreview(() => generateDtmf({ ...settings(), sampleRate }), sampleRate);
  }

  const selectionDescription = replacementPosition !== undefined && replacementEnd !== undefined
    ? `替换选区 ${formatTime(replacementPosition)}–${formatTime(replacementEnd)}`
    : `替换选区起点 ${formatTime(replacementPosition ?? cursorPosition)}`;

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>生成 DTMF 音调</DialogTitle>
          <DialogDescription>
            按 Audacity DTMF Tones 生成电话键盘式双音多频序列，并在音调之间插入静音。
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="dtmf-sequence">DTMF 序列</Label>
                <Input
                  id="dtmf-sequence"
                  value={sequence}
                  onChange={(event) => setSequence(event.target.value)}
                  pattern="[0-9A-Da-z*#]+"
                  title="仅支持 0–9、*、#、大写 A–D 和小写 a–z"
                  autoComplete="off"
                  required
                />
                <p className="text-xs text-muted-foreground">支持 0–9、*、#、A–D 和 a–z；大写 A–D 使用第四列高频。</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="dtmf-amplitude">振幅 (0–1)</Label>
                <Input
                  id="dtmf-amplitude"
                  type="number"
                  min="0"
                  max="1"
                  step="0.01"
                  value={amplitude}
                  onChange={(event) => setAmplitude(event.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="dtmf-duration">时长（秒）</Label>
                <Input
                  id="dtmf-duration"
                  type="number"
                  min={1 / sampleRate}
                  step="any"
                  value={duration}
                  readOnly={selectionActive}
                  aria-readonly={selectionActive}
                  onChange={(event) => setDuration(event.target.value)}
                  required
                />
              </div>
            </div>

            <div className="space-y-3 rounded-md border bg-muted/20 p-3">
              <Label htmlFor="dtmf-duty-cycle">音调/静音比例</Label>
              <input
                type="range"
                aria-label="DTMF 音调静音比例滑块"
                min="0"
                max="100"
                step="0.1"
                value={numericDutyCycle}
                onChange={(event) => setDutyCycle(event.target.value)}
                className="w-full"
              />
              <div className="space-y-2">
                <Label htmlFor="dtmf-duty-cycle">占空比 (%)</Label>
                <Input
                  id="dtmf-duty-cycle"
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  value={dutyCycle}
                  onChange={(event) => setDutyCycle(event.target.value)}
                  required
                />
              </div>
              <dl className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <dt className="text-muted-foreground">音调时长</dt>
                  <dd data-testid="dtmf-tone-duration" className="font-medium">
                    {timing ? `${Math.round(timing.toneDuration * 1000)} ms` : '—'}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">静音时长</dt>
                  <dd data-testid="dtmf-silence-duration" className="font-medium">
                    {timing ? `${Math.round(timing.silenceDuration * 1000)} ms` : '—'}
                  </dd>
                </div>
              </dl>
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            {selectionActive
              ? `采样率 ${sampleRate} Hz · ${selectionDescription} · 时长已锁定到音频采样`
              : `采样率 ${sampleRate} Hz · 插入位置 ${formatTime(cursorPosition)} · 默认 1 秒并记住上次时长 · 每个音调带 4 ms 淡入淡出`}
          </p>
          {previewError && <p role="alert" className="text-xs text-destructive">试听失败：{previewError}</p>}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              aria-pressed={isPreviewing}
              disabled={isGenerating || !canGenerate}
              onClick={isPreviewing ? stopPreview : preview}
            >
              {isPreviewing ? '停止试听' : '试听'}
            </Button>
            <Button type="button" variant="secondary" onClick={() => changeOpen(false)}>取消</Button>
            <Button type="submit" disabled={isGenerating || !canGenerate}>
              {isGenerating ? '正在生成…' : '生成 DTMF'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
