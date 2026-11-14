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
  DEFAULT_VOCODER_SETTINGS,
  validateVocoderSettings,
  type VocoderOutputChoice,
  type VocoderSettings,
} from '@/lib/vocoderEffect';
import { useGeneratorPreview } from './useGeneratorPreview';

interface VocoderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sampleRate: number;
  selectionStart: number;
  selectionEnd: number;
  isApplying: boolean;
  onPreview: (settings: VocoderSettings) => Promise<PreviewChannels>;
  onApply: (settings: VocoderSettings) => void | Promise<void>;
}

function NumericField({ id, label, value, min, max, step, disabled, onChange }: {
  id: string;
  label: string;
  value: string;
  min: number;
  max: number;
  step: '1' | 'any';
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type="number" min={min} max={max} step={step} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} required />
    </div>
  );
}

export default function VocoderDialog({
  open,
  onOpenChange,
  sampleRate,
  selectionStart,
  selectionEnd,
  isApplying,
  onPreview,
  onApply,
}: VocoderDialogProps) {
  const [distance, setDistance] = useState(String(DEFAULT_VOCODER_SETTINGS.distance));
  const [outputChoice, setOutputChoice] = useState<VocoderOutputChoice>(DEFAULT_VOCODER_SETTINGS.outputChoice);
  const [bandCount, setBandCount] = useState(String(DEFAULT_VOCODER_SETTINGS.bandCount));
  const [carrierWavePercent, setCarrierWavePercent] = useState(String(DEFAULT_VOCODER_SETTINGS.carrierWavePercent));
  const [whiteNoisePercent, setWhiteNoisePercent] = useState(String(DEFAULT_VOCODER_SETTINGS.whiteNoisePercent));
  const [radarNeedlesPercent, setRadarNeedlesPercent] = useState(String(DEFAULT_VOCODER_SETTINGS.radarNeedlesPercent));
  const [radarNeedlesFrequencyHz, setRadarNeedlesFrequencyHz] = useState(String(DEFAULT_VOCODER_SETTINGS.radarNeedlesFrequencyHz));
  const { isPreviewing, previewError, startPreview, stopPreview } = useGeneratorPreview();
  const settings: VocoderSettings = {
    distance: Number(distance),
    outputChoice,
    bandCount: Number(bandCount),
    carrierWavePercent: Number(carrierWavePercent),
    whiteNoisePercent: Number(whiteNoisePercent),
    radarNeedlesPercent: Number(radarNeedlesPercent),
    radarNeedlesFrequencyHz: Number(radarNeedlesFrequencyHz),
  };

  let validationError = '';
  try {
    validateVocoderSettings(settings);
    if (!Number.isFinite(sampleRate) || sampleRate <= 0) throw new RangeError('工程采样率无效');
  } catch (error) {
    validationError = error instanceof Error ? error.message : 'Vocoder 参数无效';
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
          <DialogTitle>Vocoder</DialogTitle>
          <DialogDescription>
            将调制信号频谱施加到载波上，生成机器人声等效果；单声道使用内置载波，立体声右声道作为外部载波。
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="vocoder-output">输出选择</Label>
            <Select value={outputChoice} onValueChange={(value) => setOutputChoice(value as VocoderOutputChoice)} disabled={isApplying}>
              <SelectTrigger id="vocoder-output" aria-label="输出选择">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="bothChannels">Both Channels 双声道</SelectItem>
                <SelectItem value="rightOnly">Right Only 仅结果声道</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <NumericField id="vocoder-distance" label="Distance" value={distance} min={1} max={120} step="any" disabled={isApplying} onChange={setDistance} />
            <NumericField id="vocoder-bands" label="频带数量" value={bandCount} min={10} max={240} step="1" disabled={isApplying} onChange={setBandCount} />
            <NumericField id="vocoder-wave" label="载波振幅（%）" value={carrierWavePercent} min={0} max={100} step="any" disabled={isApplying} onChange={setCarrierWavePercent} />
            <NumericField id="vocoder-noise" label="白噪声振幅（%）" value={whiteNoisePercent} min={0} max={100} step="any" disabled={isApplying} onChange={setWhiteNoisePercent} />
            <NumericField id="vocoder-radar" label="雷达脉冲振幅（%）" value={radarNeedlesPercent} min={0} max={100} step="any" disabled={isApplying} onChange={setRadarNeedlesPercent} />
            <NumericField id="vocoder-radar-freq" label="雷达脉冲频率（Hz）" value={radarNeedlesFrequencyHz} min={1} max={100} step="any" disabled={isApplying} onChange={setRadarNeedlesFrequencyHz} />
          </div>
          <div className="space-y-1 rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
            <p>选区：{formatTime(selectionStart)}–{formatTime(selectionEnd)}，共 {formatTime(selectionEnd - selectionStart)}</p>
            <p data-testid="vocoder-plan">频带按 20 Hz 到 Nyquist/2.205 对数分布，包络按频带频率/Distance 平滑，输出归一化到 0 dB。</p>
          </div>
          {validationError && <p role="alert" className="text-sm text-destructive">{validationError}</p>}
          {previewError && <p role="alert" className="text-sm text-destructive">试听失败：{previewError}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" aria-pressed={isPreviewing} disabled={isApplying || Boolean(validationError)} onClick={isPreviewing ? stopPreview : preview}>
              {isPreviewing ? '停止试听' : '试听'}
            </Button>
            <Button type="button" variant="secondary" onClick={() => changeOpen(false)}>取消</Button>
            <Button type="submit" disabled={isApplying || Boolean(validationError)}>
              {isApplying ? '正在应用…' : '应用 Vocoder'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
