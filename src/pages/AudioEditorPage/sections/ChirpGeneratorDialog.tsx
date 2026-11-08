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
import {
  generateChirp,
  type ChirpInterpolation,
  type ChirpRequest,
} from '@/lib/chirpGenerator';
import { formatGeneratorDuration } from '@/lib/generatorDuration';
import type { ToneWaveform } from '@/lib/toneGenerator';
import { useGeneratorPreview } from './useGeneratorPreview';

interface ChirpGeneratorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sampleRate: number;
  cursorPosition: number;
  defaultDuration: number;
  selectionActive?: boolean;
  replacementPosition?: number;
  replacementEnd?: number;
  isGenerating: boolean;
  onGenerate: (settings: ChirpRequest) => void | Promise<void>;
}

export default function ChirpGeneratorDialog({
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
}: ChirpGeneratorDialogProps) {
  const [waveform, setWaveform] = useState<ToneWaveform>('sine');
  const [interpolation, setInterpolation] = useState<ChirpInterpolation>('linear');
  const [startFrequency, setStartFrequency] = useState('440');
  const [endFrequency, setEndFrequency] = useState('1320');
  const [startAmplitude, setStartAmplitude] = useState('0.8');
  const [endAmplitude, setEndAmplitude] = useState('0.1');
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

  function changeOpen(nextOpen: boolean) {
    if (!nextOpen) stopPreview();
    onOpenChange(nextOpen);
  }

  function settings(): ChirpRequest {
    return {
      waveform,
      interpolation,
      startFrequency: Number(startFrequency),
      endFrequency: Number(endFrequency),
      startAmplitude: Number(startAmplitude),
      endAmplitude: Number(endAmplitude),
      duration: Number(duration),
    };
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    stopPreview();
    void onGenerate(settings());
  }

  function preview() {
    void startPreview(() => generateChirp({ ...settings(), sampleRate }), sampleRate);
  }

  const selectionDescription = replacementPosition !== undefined && replacementEnd !== undefined
    ? `替换选区 ${formatTime(replacementPosition)}–${formatTime(replacementEnd)}`
    : `替换选区起点 ${formatTime(replacementPosition ?? cursorPosition)}`;

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>生成扫频（Chirp）</DialogTitle>
          <DialogDescription>
            按 Audacity Chirp 的线性或对数插值生成频率与振幅连续变化的单声道音频。
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="chirp-waveform">波形</Label>
              <Select value={waveform} onValueChange={(value) => setWaveform(value as ToneWaveform)}>
                <SelectTrigger id="chirp-waveform" aria-label="扫频波形">
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
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium leading-none">频率扫掠</legend>
              <div className="flex h-9 items-center gap-4 text-sm">
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="chirp-interpolation"
                    value="linear"
                    checked={interpolation === 'linear'}
                    onChange={() => setInterpolation('linear')}
                    className="size-4"
                  />
                  线性 (Linear)
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="chirp-interpolation"
                    value="logarithmic"
                    checked={interpolation === 'logarithmic'}
                    onChange={() => setInterpolation('logarithmic')}
                    className="size-4"
                  />
                  对数 (Logarithmic)
                </label>
              </div>
            </fieldset>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="chirp-start-frequency">起始频率 (Hz)</Label>
              <Input
                id="chirp-start-frequency"
                type="number"
                min="1"
                max={sampleRate / 2}
                step="1"
                value={startFrequency}
                onChange={(event) => setStartFrequency(event.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="chirp-end-frequency">结束频率 (Hz)</Label>
              <Input
                id="chirp-end-frequency"
                type="number"
                min="1"
                max={sampleRate / 2}
                step="1"
                value={endFrequency}
                onChange={(event) => setEndFrequency(event.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="chirp-start-amplitude">起始振幅 (0–1)</Label>
              <Input
                id="chirp-start-amplitude"
                type="number"
                min="0"
                max="1"
                step="0.01"
                value={startAmplitude}
                onChange={(event) => setStartAmplitude(event.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="chirp-end-amplitude">结束振幅 (0–1)</Label>
              <Input
                id="chirp-end-amplitude"
                type="number"
                min="0"
                max="1"
                step="0.01"
                value={endAmplitude}
                onChange={(event) => setEndAmplitude(event.target.value)}
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="chirp-duration">时长（秒）</Label>
            <Input
              id="chirp-duration"
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
              : `采样率 ${sampleRate} Hz · 插入位置 ${formatTime(cursorPosition)} · 默认 30 秒并记住上次时长 · 起止频率不得超过 ${sampleRate / 2} Hz`}
          </p>
          {previewError && <p role="alert" className="text-xs text-destructive">试听失败：{previewError}</p>}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              aria-pressed={isPreviewing}
              disabled={isGenerating}
              onClick={isPreviewing ? stopPreview : preview}
            >
              {isPreviewing ? '停止试听' : '试听'}
            </Button>
            <Button type="button" variant="secondary" onClick={() => changeOpen(false)}>取消</Button>
            <Button type="submit" disabled={isGenerating}>
              {isGenerating ? '正在生成…' : '生成扫频'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
