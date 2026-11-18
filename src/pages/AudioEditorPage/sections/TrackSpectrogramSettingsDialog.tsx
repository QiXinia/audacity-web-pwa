import { useEffect, useState } from 'react';
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
  getDefaultSpectrogramSettings,
  getTrackSpectrogramSettings,
  isTrackSpectrogramUsingGlobalSettings,
} from '@/lib/spectrogramSettings';
import type {
  ISpectrogramSettings,
  ITrack,
  SpectrogramColorScheme,
  SpectrogramScale,
} from '@/types/project';

interface TrackSpectrogramSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  track: ITrack;
  sampleRate: number;
  onApply: (settings: ISpectrogramSettings, useGlobalSettings: boolean) => Promise<void>;
}

type NumericKey = 'minFreq' | 'maxFreq' | 'gainDb' | 'rangeDb' | 'highBoostDbPerDec';
type Draft = Record<NumericKey, string> & Pick<ISpectrogramSettings, 'scale' | 'colorScheme'>;

function toDraft(settings: ISpectrogramSettings): Draft {
  return {
    scale: settings.scale,
    colorScheme: settings.colorScheme,
    minFreq: String(settings.minFreq),
    maxFreq: String(settings.maxFreq),
    gainDb: String(settings.gainDb),
    rangeDb: String(settings.rangeDb),
    highBoostDbPerDec: String(settings.highBoostDbPerDec),
  };
}

export function TrackSpectrogramSettingsDialog({
  open,
  onOpenChange,
  track,
  sampleRate,
  onApply,
}: TrackSpectrogramSettingsDialogProps) {
  const [useGlobalSettings, setUseGlobalSettings] = useState(true);
  const [draft, setDraft] = useState<Draft>(() => toDraft(getDefaultSpectrogramSettings(sampleRate)));
  const [error, setError] = useState('');
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    if (!open) return;
    setUseGlobalSettings(isTrackSpectrogramUsingGlobalSettings(track));
    setDraft(toDraft(getTrackSpectrogramSettings(track, sampleRate)));
    setError('');
    setApplying(false);
  }, [open, sampleRate, track]);

  function change<Key extends keyof Draft>(key: Key, value: Draft[Key]) {
    setUseGlobalSettings(false);
    setError('');
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function setGlobal(enabled: boolean) {
    setUseGlobalSettings(enabled);
    setError('');
    if (enabled) setDraft(toDraft(getDefaultSpectrogramSettings(sampleRate)));
  }

  async function apply() {
    const numeric = Object.fromEntries(
      (['minFreq', 'maxFreq', 'gainDb', 'rangeDb', 'highBoostDbPerDec'] as const)
        .map((key) => [key, Number(draft[key])]),
    ) as Record<NumericKey, number>;
    if (Object.values(numeric).some((value) => !Number.isInteger(value))) {
      setError('频率与颜色参数必须是有效整数');
      return;
    }
    const nyquist = sampleRate / 2;
    if (numeric.minFreq < 0 || numeric.maxFreq > nyquist || numeric.minFreq >= numeric.maxFreq) {
      setError(`频率范围必须满足 0 ≤ Min < Max ≤ ${nyquist} Hz`);
      return;
    }
    if ((draft.scale === 'logarithmic' || draft.scale === 'period') && numeric.minFreq < 1) {
      setError('Logarithmic 与 Period 刻度的 Min frequency 必须至少为 1 Hz');
      return;
    }
    if (numeric.rangeDb < 1) {
      setError('Range 必须至少为 1 dB');
      return;
    }
    if (numeric.highBoostDbPerDec < 0 || numeric.highBoostDbPerDec > 60) {
      setError('High boost 必须在 0…60 dB/dec 之间');
      return;
    }
    setApplying(true);
    setError('');
    try {
      await onApply({
        scale: draft.scale,
        colorScheme: draft.colorScheme,
        ...numeric,
      }, useGlobalSettings);
      onOpenChange(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法保存 Spectrogram 设置');
    } finally {
      setApplying(false);
    }
  }

  function numberField(key: NumericKey, label: string, unit: string, min?: number, max?: number) {
    return (
      <div className="space-y-1.5">
        <Label htmlFor={`spectrogram-${key}`}>{label}</Label>
        <div className="relative">
          <Input
            id={`spectrogram-${key}`}
            data-testid={`spectrogram-${key}`}
            type="number"
            step={1}
            min={min}
            max={max}
            value={draft[key]}
            onChange={(event) => change(key, event.target.value)}
            className="pr-16"
          />
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">{unit}</span>
        </div>
      </div>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[620px]" data-testid="track-spectrogram-settings-dialog">
        <DialogHeader>
          <DialogTitle>Spectrogram settings</DialogTitle>
          <DialogDescription>{track.name} · Audacity 4 track display settings</DialogDescription>
        </DialogHeader>

        <section aria-labelledby="spectrogram-selection-heading" className="space-y-3 rounded-md border p-4">
          <h3 id="spectrogram-selection-heading" className="text-sm font-semibold">Selection</h3>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              data-testid="spectrogram-use-global"
              checked={useGlobalSettings}
              onChange={(event) => setGlobal(event.target.checked)}
            />
            Use global settings
          </label>
          <p className="text-xs text-muted-foreground">修改任一参数会关闭全局同步；重新启用会复制全局默认值。</p>
        </section>

        <section aria-labelledby="spectrogram-scale-heading" className="space-y-3 rounded-md border p-4">
          <h3 id="spectrogram-scale-heading" className="text-sm font-semibold">Scale</h3>
          <div className="space-y-1.5">
            <Label htmlFor="spectrogram-scale">Scale</Label>
            <select
              id="spectrogram-scale"
              data-testid="spectrogram-scale"
              aria-label="Spectrogram scale"
              className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
              value={draft.scale}
              onChange={(event) => change('scale', event.target.value as SpectrogramScale)}
            >
              <option value="linear">Linear</option>
              <option value="logarithmic">Logarithmic</option>
              <option value="mel">Mel</option>
              <option value="bark">Bark</option>
              <option value="erb">ERB</option>
              <option value="period">Period</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {numberField('minFreq', 'Min frequency', 'Hz', 0, sampleRate / 2)}
            {numberField('maxFreq', 'Max frequency', 'Hz', 1, sampleRate / 2)}
          </div>
        </section>

        <section aria-labelledby="spectrogram-colors-heading" className="space-y-3 rounded-md border p-4">
          <h3 id="spectrogram-colors-heading" className="text-sm font-semibold">Colors</h3>
          <div className="grid grid-cols-3 gap-3">
            {numberField('gainDb', 'Gain', 'dB')}
            {numberField('rangeDb', 'Range', 'dB', 1)}
            {numberField('highBoostDbPerDec', 'High boost', 'dB/dec', 0, 60)}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="spectrogram-color-scheme">Scheme</Label>
            <select
              id="spectrogram-color-scheme"
              data-testid="spectrogram-color-scheme"
              aria-label="Spectrogram color scheme"
              className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
              value={draft.colorScheme}
              onChange={(event) => change('colorScheme', event.target.value as SpectrogramColorScheme)}
            >
              <option value="roseus">Roseus</option>
              <option value="classic">Classic</option>
              <option value="grayscale">Grayscale</option>
              <option value="inverse-grayscale">Inverse grayscale</option>
            </select>
          </div>
        </section>

        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button type="button" variant="outline" data-testid="spectrogram-cancel" onClick={() => onOpenChange(false)} disabled={applying}>Cancel</Button>
          <Button type="button" data-testid="spectrogram-apply" onClick={() => void apply()} disabled={applying}>{applying ? 'Applying…' : 'OK'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
