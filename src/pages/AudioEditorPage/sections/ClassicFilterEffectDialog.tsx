import { useEffect, useMemo, useState } from 'react';
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
import {
  DEFAULT_CLASSIC_FILTER_SETTINGS,
  classicFilterMagnitudeAtFrequency,
  validateClassicFilterSettings,
  type ClassicFilterSettings,
  type ClassicFilterSubtype,
  type ClassicFilterType,
} from '@/lib/classicFilterEffect';
import { useGeneratorPreview } from './useGeneratorPreview';

interface ClassicFilterEffectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sampleRate: number;
  selectionStart: number;
  selectionEnd: number;
  isApplying: boolean;
  onPreview: (settings: ClassicFilterSettings) => Promise<Float32Array[]>;
  onApply: (settings: ClassicFilterSettings) => Promise<void>;
}

function initialSettings(sampleRate: number): ClassicFilterSettings {
  return {
    ...DEFAULT_CLASSIC_FILTER_SETTINGS,
    cutoffHz: Math.max(1, Math.min(DEFAULT_CLASSIC_FILTER_SETTINGS.cutoffHz, sampleRate / 2 - 1)),
  };
}

export default function ClassicFilterEffectDialog({
  open,
  onOpenChange,
  sampleRate,
  selectionStart,
  selectionEnd,
  isApplying,
  onPreview,
  onApply,
}: ClassicFilterEffectDialogProps) {
  const [settings, setSettings] = useState<ClassicFilterSettings>(() => initialSettings(sampleRate));
  const [actionError, setActionError] = useState<string | null>(null);
  const {
    isPreviewing,
    previewError,
    startPreview,
    stopPreview,
  } = useGeneratorPreview();

  useEffect(() => {
    if (open) {
      setSettings(initialSettings(sampleRate));
      setActionError(null);
    } else {
      stopPreview();
    }
  }, [open, sampleRate, selectionStart, selectionEnd, stopPreview]);

  const validationError = useMemo(() => {
    try {
      validateClassicFilterSettings(settings, sampleRate);
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : '参数无效';
    }
  }, [sampleRate, settings]);

  const responsePath = useMemo(() => {
    if (validationError) return '';
    const width = 520, height = 150, points = 96;
    const minimumFrequency = Math.min(20, sampleRate / 2 - 1);
    const maximumFrequency = sampleRate / 2 - 1;
    const minimumLog = Math.log10(minimumFrequency);
    const maximumLog = Math.log10(maximumFrequency);
    return Array.from({ length: points + 1 }, (_, index) => {
      const frequency = 10 ** (minimumLog + (maximumLog - minimumLog) * index / points);
      const magnitude = classicFilterMagnitudeAtFrequency(settings, sampleRate, frequency);
      const db = Math.max(-60, Math.min(6, 20 * Math.log10(Math.max(magnitude, 0.000001))));
      const x = index / points * width;
      const y = (6 - db) / 66 * height;
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
    }).join(' ');
  }, [sampleRate, settings, validationError]);

  function update<K extends keyof ClassicFilterSettings>(key: K, value: ClassicFilterSettings[K]) {
    setSettings((current) => ({ ...current, [key]: value }));
    setActionError(null);
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) stopPreview();
    onOpenChange(nextOpen);
  }

  async function handlePreview() {
    if (validationError || isApplying) return;
    setActionError(null);
    try {
      await startPreview(() => onPreview(settings), sampleRate);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '试听失败');
    }
  }

  async function handleApply() {
    if (validationError || isApplying) return;
    setActionError(null);
    stopPreview();
    await onApply(settings);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Classic Filters</DialogTitle>
          <DialogDescription>
            对照 Audacity 4.0.2 ScienFilter；Butterworth、Chebyshev I/II 级联双二阶滤波，不改变选区时长。
          </DialogDescription>
        </DialogHeader>

        <div data-testid="classic-filter-plan" className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
          选区 {selectionStart.toFixed(3)}–{selectionEnd.toFixed(3)} 秒 · {sampleRate} Hz ·
          {Math.floor((settings.order + 1) / 2)} 个 Biquad · Cutoff 上限 {(sampleRate / 2 - 1).toFixed(2)} Hz。
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="classic-filter-type">Filter Type</Label>
            <Select
              value={settings.filterType}
              disabled={isApplying}
              onValueChange={(value) => update('filterType', value as ClassicFilterType)}
            >
              <SelectTrigger id="classic-filter-type" aria-label="Filter Type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="butterworth">Butterworth</SelectItem>
                <SelectItem value="chebyshev1">Chebyshev Type I</SelectItem>
                <SelectItem value="chebyshev2">Chebyshev Type II</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="classic-filter-subtype">Subtype</Label>
            <Select
              value={settings.subtype}
              disabled={isApplying}
              onValueChange={(value) => update('subtype', value as ClassicFilterSubtype)}
            >
              <SelectTrigger id="classic-filter-subtype" aria-label="Subtype">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="lowpass">Lowpass</SelectItem>
                <SelectItem value="highpass">Highpass</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="classic-filter-order">Order</Label>
            <Input
              id="classic-filter-order"
              type="number"
              min={1}
              max={10}
              step={1}
              value={settings.order}
              disabled={isApplying}
              onChange={(event) => update('order', Number(event.target.value))}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="classic-filter-cutoff">Cutoff（Hz）</Label>
            <Input
              id="classic-filter-cutoff"
              type="number"
              min={1}
              max={sampleRate / 2 - 1}
              step={1}
              value={settings.cutoffHz}
              disabled={isApplying}
              onChange={(event) => update('cutoffHz', Number(event.target.value))}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="classic-filter-ripple">Passband Ripple（dB）</Label>
            <Input
              id="classic-filter-ripple"
              type="number"
              min={0}
              max={100}
              step={0.1}
              value={settings.passbandRippleDb}
              disabled={isApplying || settings.filterType !== 'chebyshev1'}
              onChange={(event) => update('passbandRippleDb', Number(event.target.value))}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="classic-filter-stopband">Minimum Stopband Attenuation（dB）</Label>
            <Input
              id="classic-filter-stopband"
              type="number"
              min={0}
              max={100}
              step={0.1}
              value={settings.stopbandAttenuationDb}
              disabled={isApplying || settings.filterType !== 'chebyshev2'}
              onChange={(event) => update('stopbandAttenuationDb', Number(event.target.value))}
            />
          </div>
        </div>

        <div className="rounded-md border bg-muted/20 p-3">
          <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
            <span>Frequency Response</span>
            <span>−60…+6 dB</span>
          </div>
          <svg
            data-testid="classic-filter-response"
            role="img"
            aria-label="Classic Filters 频率响应"
            viewBox="0 0 520 150"
            className="h-36 w-full"
          >
            <path d="M0,136.36 H520" stroke="currentColor" strokeOpacity="0.2" fill="none" />
            <path d="M0,13.64 H520" stroke="currentColor" strokeOpacity="0.2" fill="none" />
            <path d={responsePath} stroke="currentColor" strokeWidth="2" fill="none" />
          </svg>
        </div>

        {(validationError || actionError || previewError) && (
          <p role="alert" className="text-sm text-destructive">
            {validationError ?? actionError ?? previewError}
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" disabled={isApplying} onClick={() => handleOpenChange(false)}>
            取消
          </Button>
          <Button
            variant="outline"
            disabled={isApplying || Boolean(validationError)}
            onClick={isPreviewing ? stopPreview : handlePreview}
          >
            {isPreviewing ? '停止试听' : '试听'}
          </Button>
          <Button disabled={isApplying || Boolean(validationError)} onClick={handleApply}>
            {isApplying ? '应用中…' : '应用'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
