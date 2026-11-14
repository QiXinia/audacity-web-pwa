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
  DEFAULT_SPECTRAL_EDIT_SETTINGS,
  describeSpectralSelection,
  isSpectralEditBypassed,
  validateSpectralEditSettings,
  type SpectralEditKind,
  type SpectralEditSettings,
} from '@/lib/spectralEditEffect';
import type { PreviewChannels } from '@/lib/generatorPreview';
import { useGeneratorPreview } from './useGeneratorPreview';

interface SpectralEditDialogProps {
  kind: SpectralEditKind | null;
  onOpenChange: (open: boolean) => void;
  sampleRate: number;
  selectionStart: number;
  selectionEnd: number;
  isApplying: boolean;
  onPreview: (settings: SpectralEditSettings) => Promise<PreviewChannels>;
  onApply: (settings: SpectralEditSettings) => void | Promise<void>;
}

const COPY: Record<SpectralEditKind, { title: string; description: string; action: string }> = {
  'delete-selection': {
    title: 'Spectral Edit: Delete selection',
    description: 'Audacity 4 spectral-delete：使用 Blackman 窗口化 sinc FIR，分别低通保留低频、高通保留高频，从而删除频率选区。',
    action: '删除频率选区',
  },
  'delete-center': {
    title: 'Spectral Edit: Delete center frequency',
    description: 'Audacity 4 SpectralEditMulti：notch2 删除频率选区中心；单边界时使用 lowpass2 或 highpass2。',
    action: '删除中心频率',
  },
  'amplify-center': {
    title: 'Spectral Edit: Amplify center frequency',
    description: 'Audacity 4 Parametric EQ：中心频率取几何平均，倍频程宽度取 ln(high / low) / 2。',
    action: '增益中心频率',
  },
  'amplify-selection': {
    title: 'Spectral Edit: Amplify selection',
    description: 'Audacity 4 Shelves：使用 low-shelf / high-shelf 组合保留并增益整个频率选区。',
    action: '增益频率选区',
  },
};

function parseBound(value: string): number | null {
  return value.trim() === '' ? null : Number(value);
}

export default function SpectralEditDialog({
  kind,
  onOpenChange,
  sampleRate,
  selectionStart,
  selectionEnd,
  isApplying,
  onPreview,
  onApply,
}: SpectralEditDialogProps) {
  const [lowText, setLowText] = useState(String(DEFAULT_SPECTRAL_EDIT_SETTINGS.lowHz));
  const [highText, setHighText] = useState(String(DEFAULT_SPECTRAL_EDIT_SETTINGS.highHz));
  const [gainText, setGainText] = useState(String(DEFAULT_SPECTRAL_EDIT_SETTINGS.gainDb));
  const { isPreviewing, previewError, startPreview, stopPreview } = useGeneratorPreview();

  const settings = useMemo<SpectralEditSettings | null>(() => kind ? ({
    kind,
    lowHz: parseBound(lowText),
    highHz: parseBound(highText),
    gainDb: kind === 'delete-selection' || kind === 'delete-center' ? 0 : Number(gainText),
  }) : null, [gainText, highText, kind, lowText]);
  const selection = settings ? describeSpectralSelection(settings) : null;
  const validationError = useMemo(() => {
    if (!settings || (settings.kind !== 'delete-selection' && settings.kind !== 'delete-center' && !gainText.trim())) return settings ? '请填写增益' : '';
    try {
      validateSpectralEditSettings(settings, sampleRate);
      return '';
    } catch (error) {
      return error instanceof Error ? error.message : 'Spectral tools 参数无效';
    }
  }, [gainText, sampleRate, settings]);
  const bypassed = settings ? isSpectralEditBypassed(settings) : false;

  useEffect(() => {
    if (!kind) stopPreview();
  }, [kind, stopPreview]);

  function changeOpen(nextOpen: boolean) {
    if (!nextOpen) stopPreview();
    onOpenChange(nextOpen);
  }

  function reset() {
    setLowText(String(DEFAULT_SPECTRAL_EDIT_SETTINGS.lowHz));
    setHighText(String(DEFAULT_SPECTRAL_EDIT_SETTINGS.highHz));
    setGainText(String(DEFAULT_SPECTRAL_EDIT_SETTINGS.gainDb));
    stopPreview();
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!settings || validationError || bypassed || isApplying) return;
    stopPreview();
    void onApply(settings);
  }

  function preview() {
    if (!settings || validationError || isApplying) return;
    void startPreview(() => onPreview(settings), sampleRate);
  }

  return (
    <Dialog open={kind !== null} onOpenChange={changeOpen}>
      <DialogContent className="max-w-xl" data-testid="spectral-edit-dialog">
        {kind && settings && (
          <>
            <DialogHeader>
              <DialogTitle>{COPY[kind].title}</DialogTitle>
              <DialogDescription>{COPY[kind].description} 选区边缘使用官方 10 ms 包络混合。</DialogDescription>
            </DialogHeader>
            <form onSubmit={submit} className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="spectral-low">Low frequency (Hz){kind !== 'amplify-center' ? '，可留空' : ''}</Label>
                  <Input id="spectral-low" data-testid="spectral-low-input" type="number" min="0" step="any" value={lowText} disabled={isApplying} onChange={(event) => setLowText(event.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="spectral-high">High frequency (Hz){kind !== 'amplify-center' ? '，可留空' : ''}</Label>
                  <Input id="spectral-high" data-testid="spectral-high-input" type="number" min="0" step="any" value={highText} disabled={isApplying} onChange={(event) => setHighText(event.target.value)} />
                </div>
              </div>
              <div className="space-y-1 rounded-md bg-muted/50 p-3 text-xs text-muted-foreground" data-testid="spectral-selection-summary">
                <p>选区：{formatTime(selectionStart)}–{formatTime(selectionEnd)}</p>
                <p>Center: {selection?.centerHz?.toFixed(3) ?? '—'} Hz　Bandwidth: {selection?.bandwidth?.toFixed(6) ?? '—'}　Nyquist: {sampleRate / 2} Hz</p>
              </div>
              {kind !== 'delete-selection' && kind !== 'delete-center' && (
                <div className="space-y-2">
                  <Label htmlFor="spectral-gain">Gain (dB, -24…24)</Label>
                  <Input id="spectral-gain" data-testid="spectral-gain-input" type="number" min="-24" max="24" step="0.1" value={gainText} disabled={isApplying} onChange={(event) => setGainText(event.target.value)} required />
                  <p className="text-xs text-muted-foreground">0 dB 不修改音频，也不会写入历史。</p>
                </div>
              )}
              {validationError && <p role="alert" className="text-sm text-destructive">{validationError}</p>}
              {previewError && <p role="alert" className="text-sm text-destructive">试听失败：{previewError}</p>}
              <DialogFooter>
                <Button type="button" variant="ghost" disabled={isApplying} onClick={reset}>恢复默认</Button>
                <Button type="button" variant="outline" disabled={isApplying || !!validationError || bypassed} onClick={isPreviewing ? stopPreview : preview}>
                  {isPreviewing ? '停止试听' : '试听'}
                </Button>
                <Button type="button" variant="secondary" onClick={() => changeOpen(false)}>取消</Button>
                <Button data-testid="spectral-apply-button" type="submit" disabled={isApplying || !!validationError || bypassed}>{isApplying ? '正在应用…' : COPY[kind].action}</Button>
              </DialogFooter>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
