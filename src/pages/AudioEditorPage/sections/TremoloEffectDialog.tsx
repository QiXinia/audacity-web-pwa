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
import type { PreviewChannels } from '@/lib/generatorPreview';
import {
  DEFAULT_TREMOLO_SETTINGS,
  validateTremoloSettings,
  type TremoloSettings,
  type TremoloWaveform,
} from '@/lib/tremoloEffect';
import { useGeneratorPreview } from './useGeneratorPreview';

interface TremoloEffectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sampleRate: number;
  selectionStart: number;
  selectionEnd: number;
  isApplying: boolean;
  onPreview: (settings: TremoloSettings) => Promise<PreviewChannels>;
  onApply: (settings: TremoloSettings) => void | Promise<void>;
}

const WAVEFORM_LABELS: Record<TremoloWaveform, string> = {
  sine: 'Sine 正弦波',
  triangle: 'Triangle 三角波',
  sawtooth: 'Sawtooth 锯齿波',
  inverseSawtooth: 'Inverse Sawtooth 反向锯齿波',
  square: 'Square 方波',
};

interface NumericFieldProps {
  id: string;
  label: string;
  value: string;
  min: number;
  max: number;
  step: '1' | 'any';
  disabled: boolean;
  onChange: (value: string) => void;
}

function NumericField({ id, label, value, min, max, step, disabled, onChange }: NumericFieldProps) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type="number" min={min} max={max} step={step} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} required />
    </div>
  );
}

export default function TremoloEffectDialog({
  open,
  onOpenChange,
  sampleRate,
  selectionStart,
  selectionEnd,
  isApplying,
  onPreview,
  onApply,
}: TremoloEffectDialogProps) {
  const [waveform, setWaveform] = useState<TremoloWaveform>(DEFAULT_TREMOLO_SETTINGS.waveform);
  const [phaseDegrees, setPhaseDegrees] = useState(String(DEFAULT_TREMOLO_SETTINGS.phaseDegrees));
  const [wetPercent, setWetPercent] = useState(String(DEFAULT_TREMOLO_SETTINGS.wetPercent));
  const [frequencyHz, setFrequencyHz] = useState(String(DEFAULT_TREMOLO_SETTINGS.frequencyHz));
  const { isPreviewing, previewError, startPreview, stopPreview } = useGeneratorPreview();
  const settings: TremoloSettings = {
    waveform,
    phaseDegrees: Number(phaseDegrees),
    wetPercent: Number(wetPercent),
    frequencyHz: Number(frequencyHz),
  };

  let validationError = '';
  try {
    validateTremoloSettings(settings);
    if (!Number.isFinite(sampleRate) || sampleRate <= 0) throw new RangeError('工程采样率无效');
  } catch (error) {
    validationError = error instanceof Error ? error.message : 'Tremolo 参数无效';
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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Tremolo</DialogTitle>
          <DialogDescription>
            按 Audacity 4.0.2 Nyquist Tremolo 调制选区振幅，不改变选区或片段时长。
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="tremolo-waveform">波形类型</Label>
            <Select value={waveform} onValueChange={(value) => setWaveform(value as TremoloWaveform)} disabled={isApplying}>
              <SelectTrigger id="tremolo-waveform" aria-label="波形类型">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(WAVEFORM_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <NumericField id="tremolo-phase" label="起始相位（°）" value={phaseDegrees} min={-180} max={180} step="1" disabled={isApplying} onChange={setPhaseDegrees} />
            <NumericField id="tremolo-wet" label="Wet（%）" value={wetPercent} min={1} max={100} step="1" disabled={isApplying} onChange={setWetPercent} />
            <NumericField id="tremolo-frequency" label="LFO 频率（Hz）" value={frequencyHz} min={0.001} max={1000} step="any" disabled={isApplying} onChange={setFrequencyHz} />
          </div>
          <div className="space-y-1 rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
            <p>选区：{formatTime(selectionStart)}–{formatTime(selectionEnd)}，共 {formatTime(selectionEnd - selectionStart)}</p>
            <p data-testid="tremolo-plan">增益 = 1 − Wet/200 + Wet/200 × 振荡器；同一轨道的所有声道共享连续 LFO。</p>
            <p>试听使用第一条含音频轨道的真实选区。时间拉伸选区不会增加输出时长。</p>
          </div>
          {validationError && <p role="alert" className="text-sm text-destructive">{validationError}</p>}
          {previewError && <p role="alert" className="text-sm text-destructive">试听失败：{previewError}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" aria-pressed={isPreviewing} disabled={isApplying || Boolean(validationError)} onClick={isPreviewing ? stopPreview : preview}>
              {isPreviewing ? '停止试听' : '试听'}
            </Button>
            <Button type="button" variant="secondary" onClick={() => changeOpen(false)}>取消</Button>
            <Button type="submit" disabled={isApplying || Boolean(validationError)}>
              {isApplying ? '正在应用…' : '应用 Tremolo'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
