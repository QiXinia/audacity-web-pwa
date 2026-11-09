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
import type { PreviewChannels } from '@/lib/generatorPreview';
import {
  DEFAULT_WAH_WAH_SETTINGS,
  validateWahWahSettings,
  type WahWahSettings,
} from '@/lib/wahWahEffect';
import { useGeneratorPreview } from './useGeneratorPreview';

interface WahWahEffectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sampleRate: number;
  selectionStart: number;
  selectionEnd: number;
  isApplying: boolean;
  onPreview: (settings: WahWahSettings) => Promise<PreviewChannels>;
  onApply: (settings: WahWahSettings) => void | Promise<void>;
}

type WahWahTextSettings = Record<keyof WahWahSettings, string>;

const DEFAULT_TEXT: WahWahTextSettings = {
  frequencyHz: String(DEFAULT_WAH_WAH_SETTINGS.frequencyHz),
  phaseDegrees: String(DEFAULT_WAH_WAH_SETTINGS.phaseDegrees),
  depthPercent: String(DEFAULT_WAH_WAH_SETTINGS.depthPercent),
  resonance: String(DEFAULT_WAH_WAH_SETTINGS.resonance),
  frequencyOffsetPercent: String(DEFAULT_WAH_WAH_SETTINGS.frequencyOffsetPercent),
  outputGainDb: String(DEFAULT_WAH_WAH_SETTINGS.outputGainDb),
};

interface ParameterFieldProps {
  id: string;
  label: string;
  value: string;
  min: number;
  max: number;
  disabled: boolean;
  onChange: (value: string) => void;
}

function ParameterField({ id, label, value, min, max, disabled, onChange }: ParameterFieldProps) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        min={min}
        max={max}
        step="any"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        required
      />
    </div>
  );
}

export default function WahWahEffectDialog({
  open,
  onOpenChange,
  sampleRate,
  selectionStart,
  selectionEnd,
  isApplying,
  onPreview,
  onApply,
}: WahWahEffectDialogProps) {
  const [text, setText] = useState<WahWahTextSettings>({ ...DEFAULT_TEXT });
  const { isPreviewing, previewError, startPreview, stopPreview } = useGeneratorPreview();
  const settings: WahWahSettings = {
    frequencyHz: Number(text.frequencyHz),
    phaseDegrees: Number(text.phaseDegrees),
    depthPercent: Number(text.depthPercent),
    resonance: Number(text.resonance),
    frequencyOffsetPercent: Number(text.frequencyOffsetPercent),
    outputGainDb: Number(text.outputGainDb),
  };

  let validationError = '';
  try {
    validateWahWahSettings(settings);
    if (!Number.isFinite(sampleRate) || sampleRate <= 0) throw new RangeError('工程采样率无效');
  } catch (error) {
    validationError = error instanceof Error ? error.message : 'Wah Wah 参数无效';
  }

  useEffect(() => {
    if (!open) stopPreview();
  }, [open, stopPreview]);

  function update(key: keyof WahWahSettings, value: string) {
    setText((previous) => ({ ...previous, [key]: value }));
  }

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
          <DialogTitle>Wah Wah</DialogTitle>
          <DialogDescription>
            按 Audacity 4.0.2 的 LFO 带通递归处理选区，不改变选区或片段时长。
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <ParameterField id="wah-wah-frequency" label="LFO 频率（Hz）" value={text.frequencyHz} min={0.1} max={4} disabled={isApplying} onChange={(value) => update('frequencyHz', value)} />
            <ParameterField id="wah-wah-phase" label="LFO 起始相位（°）" value={text.phaseDegrees} min={0} max={360} disabled={isApplying} onChange={(value) => update('phaseDegrees', value)} />
            <ParameterField id="wah-wah-depth" label="深度（%）" value={text.depthPercent} min={0} max={100} disabled={isApplying} onChange={(value) => update('depthPercent', value)} />
            <ParameterField id="wah-wah-resonance" label="谐振" value={text.resonance} min={0.1} max={10} disabled={isApplying} onChange={(value) => update('resonance', value)} />
            <ParameterField id="wah-wah-frequency-offset" label="Wah 频率偏移（%）" value={text.frequencyOffsetPercent} min={0} max={100} disabled={isApplying} onChange={(value) => update('frequencyOffsetPercent', value)} />
            <ParameterField id="wah-wah-output-gain" label="输出增益（dB）" value={text.outputGainDb} min={-30} max={30} disabled={isApplying} onChange={(value) => update('outputGainDb', value)} />
          </div>
          <div className="space-y-1 rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
            <p>选区：{formatTime(selectionStart)}–{formatTime(selectionEnd)}，共 {formatTime(selectionEnd - selectionStart)}</p>
            <p data-testid="wah-wah-plan">每 30 个采样重算带通系数；输出增益在递推历史之后应用。</p>
            <p>试听使用第一条含音频轨道的真实选区。时间拉伸选区不会增加输出时长。</p>
          </div>
          {validationError && <p role="alert" className="text-sm text-destructive">{validationError}</p>}
          {previewError && <p role="alert" className="text-sm text-destructive">试听失败：{previewError}</p>}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              aria-pressed={isPreviewing}
              disabled={isApplying || Boolean(validationError)}
              onClick={isPreviewing ? stopPreview : preview}
            >
              {isPreviewing ? '停止试听' : '试听'}
            </Button>
            <Button type="button" variant="secondary" onClick={() => changeOpen(false)}>取消</Button>
            <Button type="submit" disabled={isApplying || Boolean(validationError)}>
              {isApplying ? '正在应用…' : '应用 Wah Wah'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
