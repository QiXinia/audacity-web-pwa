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
  RISSET_DEFAULT_AMPLITUDE,
  RISSET_DEFAULT_BANDWIDTH,
  RISSET_DEFAULT_CENTER_FREQUENCY,
  RISSET_DEFAULT_DECAY,
  RISSET_DEFAULT_FREQUENCY,
  RISSET_DEFAULT_NOISE_PERCENT,
  generateRissetDrum,
  getRissetDrumPlan,
  type RissetDrumPlan,
  type RissetDrumRequest,
} from '@/lib/rissetDrumGenerator';
import { useGeneratorPreview } from './useGeneratorPreview';

interface RissetDrumDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sampleRate: number;
  cursorPosition: number;
  selectionActive?: boolean;
  replacementPosition?: number;
  replacementEnd?: number;
  isGenerating: boolean;
  onGenerate: (settings: RissetDrumRequest) => void | Promise<void>;
}

export default function RissetDrumDialog({
  open,
  onOpenChange,
  sampleRate,
  cursorPosition,
  selectionActive = false,
  replacementPosition,
  replacementEnd,
  isGenerating,
  onGenerate,
}: RissetDrumDialogProps) {
  const [frequency, setFrequency] = useState(String(RISSET_DEFAULT_FREQUENCY));
  const [decay, setDecay] = useState(String(RISSET_DEFAULT_DECAY));
  const [centerFrequency, setCenterFrequency] = useState(String(RISSET_DEFAULT_CENTER_FREQUENCY));
  const [bandwidth, setBandwidth] = useState(String(RISSET_DEFAULT_BANDWIDTH));
  const [noisePercent, setNoisePercent] = useState(String(RISSET_DEFAULT_NOISE_PERCENT));
  const [amplitude, setAmplitude] = useState(String(RISSET_DEFAULT_AMPLITUDE));
  const { isPreviewing, previewError, startPreview, stopPreview } = useGeneratorPreview();

  useEffect(() => {
    if (!open) stopPreview();
  }, [open, stopPreview]);

  function settings(): RissetDrumRequest {
    return {
      frequency: Number(frequency),
      decay: Number(decay),
      centerFrequency: Number(centerFrequency),
      bandwidth: Number(bandwidth),
      noisePercent: Number(noisePercent),
      amplitude: Number(amplitude),
      sampleRate,
    };
  }

  const numeric = settings();
  let validationError = '';
  if (!Number.isFinite(numeric.frequency) || numeric.frequency < 50 || numeric.frequency > 2000) {
    validationError = '主频率须为 50–2000 Hz。';
  } else if (!Number.isFinite(numeric.decay) || numeric.decay < 0.1 || numeric.decay > 60) {
    validationError = '衰减时长须为 0.1–60 秒。';
  } else if (!Number.isFinite(numeric.centerFrequency) || numeric.centerFrequency < 100 || numeric.centerFrequency > 5000) {
    validationError = '噪声中心频率须为 100–5000 Hz。';
  } else if (!Number.isFinite(numeric.bandwidth) || numeric.bandwidth < 10 || numeric.bandwidth > 1000) {
    validationError = '噪声带宽须为 10–1000 Hz。';
  } else if (!Number.isFinite(numeric.noisePercent) || numeric.noisePercent < 0 || numeric.noisePercent > 100) {
    validationError = '噪声混合比例须为 0–100%。';
  } else if (!Number.isFinite(numeric.amplitude) || numeric.amplitude < 0 || numeric.amplitude > 1) {
    validationError = '振幅须为 0–1。';
  }

  let plan: RissetDrumPlan | null = null;
  if (!validationError) {
    try {
      plan = getRissetDrumPlan(numeric);
    } catch (error) {
      validationError = error instanceof Error && error.message.includes('memory limit')
        ? '生成规模超过浏览器内存限制，请缩短衰减时长或降低采样率。'
        : error instanceof Error ? error.message : '参数无效';
    }
  }

  function changeOpen(nextOpen: boolean) {
    if (!nextOpen) stopPreview();
    onOpenChange(nextOpen);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!plan) return;
    stopPreview();
    void onGenerate(numeric);
  }

  function preview() {
    if (!plan) return;
    void startPreview(() => generateRissetDrum({ ...numeric, seed: 1 }).samples, sampleRate);
  }

  const selectionDescription = replacementPosition !== undefined && replacementEnd !== undefined
    ? `替换选区 ${formatTime(replacementPosition)}–${formatTime(replacementEnd)}`
    : `替换选区起点 ${formatTime(replacementPosition ?? cursorPosition)}`;

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>生成 Risset Drum 鼓声</DialogTitle>
          <DialogDescription>
            对齐 Audacity Nyquist Risset Drum，混合非谐波音、调制噪声与基频正弦。
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="risset-frequency">主频率（Hz）</Label>
              <Input id="risset-frequency" type="number" min={50} max={2000} step="any" value={frequency} onChange={(event) => setFrequency(event.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="risset-decay">衰减时长（秒）</Label>
              <Input id="risset-decay" type="number" min={0.1} max={60} step="any" value={decay} onChange={(event) => setDecay(event.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="risset-center-frequency">噪声中心频率（Hz）</Label>
              <Input id="risset-center-frequency" type="number" min={100} max={5000} step="any" value={centerFrequency} onChange={(event) => setCenterFrequency(event.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="risset-bandwidth">噪声带宽（Hz）</Label>
              <Input id="risset-bandwidth" type="number" min={10} max={1000} step="any" value={bandwidth} onChange={(event) => setBandwidth(event.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="risset-noise">噪声混合比例（%）</Label>
              <Input id="risset-noise" type="number" min={0} max={100} step="any" value={noisePercent} onChange={(event) => setNoisePercent(event.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="risset-amplitude">振幅（0–1）</Label>
              <Input id="risset-amplitude" type="number" min={0} max={1} step="any" value={amplitude} onChange={(event) => setAmplitude(event.target.value)} required />
            </div>
          </div>

          {plan && (
            <p className="text-xs text-muted-foreground" data-testid="risset-plan">
              预计 {formatTime(plan.duration)}、{plan.sampleCount} 个采样；非谐波音与噪声在前 {formatTime(plan.enharmonicDecay)} 衰减。
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            {selectionActive
              ? `采样率 ${sampleRate} Hz · ${selectionDescription} · 按实际生成时长替换并平移后续片段`
              : `采样率 ${sampleRate} Hz · 插入位置 ${formatTime(cursorPosition)}`}
          </p>
          {validationError && <p role="alert" className="text-xs text-destructive">{validationError}</p>}
          {previewError && <p role="alert" className="text-xs text-destructive">试听失败：{previewError}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" aria-pressed={isPreviewing} disabled={isGenerating || !plan} onClick={isPreviewing ? stopPreview : preview}>
              {isPreviewing ? '停止试听' : '试听'}
            </Button>
            <Button type="button" variant="secondary" onClick={() => changeOpen(false)}>取消</Button>
            <Button type="submit" disabled={isGenerating || !plan}>
              {isGenerating ? '正在生成…' : '生成 Risset Drum'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
