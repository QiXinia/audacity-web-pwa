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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formatTime } from '@/lib/audioUtils';
import { formatGeneratorDuration } from '@/lib/generatorDuration';
import type { ToneRequest, ToneWaveform } from '@/lib/toneGenerator';

interface ToneGeneratorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sampleRate: number;
  cursorPosition: number;
  defaultDuration: number;
  selectionActive?: boolean;
  replacementPosition?: number;
  replacementEnd?: number;
  isGenerating: boolean;
  onGenerate: (settings: ToneRequest) => void | Promise<void>;
}

export default function ToneGeneratorDialog({
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
}: ToneGeneratorDialogProps) {
  const [waveform, setWaveform] = useState<ToneWaveform>('sine');
  const [frequency, setFrequency] = useState('440');
  const [amplitude, setAmplitude] = useState('0.8');
  const [duration, setDuration] = useState('30');

  useEffect(() => {
    if (open && Number.isFinite(defaultDuration) && defaultDuration > 0) {
      setDuration(formatGeneratorDuration(defaultDuration));
    }
  }, [open, defaultDuration]);

  function submit(event: FormEvent) {
    event.preventDefault();
    void onGenerate({
      waveform,
      frequency: Number(frequency),
      amplitude: Number(amplitude),
      duration: Number(duration),
    });
  }

  const selectionDescription = replacementPosition !== undefined && replacementEnd !== undefined
    ? `替换选区 ${formatTime(replacementPosition)}–${formatTime(replacementEnd)}`
    : `替换选区起点 ${formatTime(replacementPosition ?? cursorPosition)}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>生成音调</DialogTitle>
          <DialogDescription>
            按 Audacity Tone 的恒定频率与振幅生成真实单声道音频片段。
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="tone-waveform">波形</Label>
            <Select value={waveform} onValueChange={(value) => setWaveform(value as ToneWaveform)}>
              <SelectTrigger id="tone-waveform" aria-label="音调波形">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sine">正弦波 (Sine)</SelectItem>
                <SelectItem value="square">方波 (Square)</SelectItem>
                <SelectItem value="sawtooth">锯齿波 (Sawtooth)</SelectItem>
                <SelectItem value="squareNoAlias">无混叠方波 (Square, no alias)</SelectItem>
                <SelectItem value="triangle">三角波 (Triangle)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="tone-frequency">频率 (Hz)</Label>
              <Input
                id="tone-frequency"
                type="number"
                min="1"
                max={sampleRate / 2}
                step="1"
                value={frequency}
                onChange={(event) => setFrequency(event.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tone-amplitude">振幅 (0–1)</Label>
              <Input
                id="tone-amplitude"
                type="number"
                min="0"
                max="1"
                step="0.01"
                value={amplitude}
                onChange={(event) => setAmplitude(event.target.value)}
                required
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="tone-duration">时长（秒）</Label>
            <Input
              id="tone-duration"
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
          <p className="text-xs text-muted-foreground">
            {selectionActive
              ? `采样率 ${sampleRate} Hz · ${selectionDescription} · 时长已锁定到音频采样`
              : `采样率 ${sampleRate} Hz · 插入位置 ${formatTime(cursorPosition)} · 默认 30 秒并记住上次时长 · 频率不得超过 ${sampleRate / 2} Hz`}
          </p>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>取消</Button>
            <Button type="submit" disabled={isGenerating}>
              {isGenerating ? '正在生成…' : '生成音调'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
