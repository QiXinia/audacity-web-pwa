import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  DEFAULT_GRAPHIC_EQ_SETTINGS,
  GRAPHIC_EQ_FREQUENCIES,
  GRAPHIC_EQ_MAX_GAIN_DB,
  GRAPHIC_EQ_MIN_GAIN_DB,
  GRAPHIC_EQ_FILTER_LENGTH,
  graphicEqBandsInUse,
  type GraphicEqSettings,
} from '@/lib/graphicEqEffect';

interface GraphicEqDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectionStart: number;
  selectionEnd: number;
  sampleRate: number;
  hasSelection: boolean;
  isApplying: boolean;
  onPreview: (settings: GraphicEqSettings) => Promise<Float32Array[]>;
  onApply: (settings: GraphicEqSettings) => Promise<void>;
}

function formatFrequency(frequency: number): string {
  return frequency >= 1000 ? `${frequency / 1000}k` : String(frequency);
}

export function GraphicEqDialog({
  open, onOpenChange, selectionStart, selectionEnd, sampleRate, hasSelection, isApplying, onPreview, onApply,
}: GraphicEqDialogProps) {
  const [gainsDb, setGainsDb] = useState<number[]>([...DEFAULT_GRAPHIC_EQ_SETTINGS.gainsDb]);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const previewSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const bandsInUse = useMemo(() => {
    try { return graphicEqBandsInUse(sampleRate); } catch { return 0; }
  }, [sampleRate]);

  const stopPreview = useCallback(() => {
    try { previewSourceRef.current?.stop(); } catch { /* already stopped */ }
    previewSourceRef.current = null;
    setIsPreviewing(false);
  }, []);

  useEffect(() => {
    if (open) {
      setGainsDb([...DEFAULT_GRAPHIC_EQ_SETTINGS.gainsDb]);
      setPreviewError(null);
      stopPreview();
    } else stopPreview();
  }, [open, stopPreview]);

  useEffect(() => () => {
    stopPreview();
    void audioContextRef.current?.close();
  }, [stopPreview]);

  function updateGain(index: number, value: number): void {
    if (!Number.isFinite(value)) return;
    setGainsDb((current) => current.map((gain, band) => (
      band === index ? Math.max(GRAPHIC_EQ_MIN_GAIN_DB, Math.min(GRAPHIC_EQ_MAX_GAIN_DB, value)) : gain
    )));
    setPreviewError(null);
  }

  async function handlePreview(): Promise<void> {
    if (isPreviewing) { stopPreview(); return; }
    setPreviewError(null);
    setIsPreviewing(true);
    try {
      const channels = await onPreview({ gainsDb: [...gainsDb] });
      const AudioContextClass = window.AudioContext
        ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) throw new Error('当前浏览器不支持试听音频');
      if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
        audioContextRef.current = new AudioContextClass();
      }
      const context = audioContextRef.current;
      const buffer = context.createBuffer(channels.length, channels[0]?.length ?? 0, sampleRate);
      channels.forEach((samples, index) => buffer.getChannelData(index).set(samples));
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      source.onended = () => {
        if (previewSourceRef.current === source) {
          previewSourceRef.current = null;
          setIsPreviewing(false);
        }
      };
      previewSourceRef.current = source;
      await context.resume();
      source.start();
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : '试听失败');
      stopPreview();
    }
  }

  const settings = { gainsDb: [...gainsDb] };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] w-[calc(100vw-24px)] max-w-6xl flex-col overflow-hidden sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle>Graphic EQ</DialogTitle>
          <DialogDescription>
            选区 {selectionStart.toFixed(3)}–{selectionEnd.toFixed(3)} 秒 · Audacity 4.0.2 三分之一倍频程 B-spline FIR
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-x-auto overflow-y-auto rounded-lg border border-border bg-muted/10 p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">31 个频段 · 16384 FFT · Blackman · {GRAPHIC_EQ_FILTER_LENGTH} taps</span>
            <div className="flex gap-2">
              <Button type="button" size="sm" variant="outline" disabled={!hasSelection || isApplying}
                onClick={() => { setGainsDb([...DEFAULT_GRAPHIC_EQ_SETTINGS.gainsDb]); setPreviewError(null); }}>
                <RotateCcw className="h-3.5 w-3.5" />Reset
              </Button>
              <Button type="button" size="sm" variant="outline" disabled={!hasSelection || isApplying}
                onClick={() => { setGainsDb((current) => current.map((gain) => -gain)); setPreviewError(null); }}>
                Invert
              </Button>
            </div>
          </div>
          <div className="grid min-w-[1120px] grid-cols-[repeat(31,minmax(30px,1fr))] gap-x-1 gap-y-2">
            {GRAPHIC_EQ_FREQUENCIES.map((frequency, index) => {
              const enabled = index < bandsInUse && hasSelection && !isApplying;
              return (
                <div key={frequency} className={`flex flex-col items-center gap-1 ${index < bandsInUse ? '' : 'opacity-30'}`}>
                  <output className="h-4 text-[10px] tabular-nums text-muted-foreground" aria-label={`${frequency} Hz 当前增益`}>
                    {gainsDb[index].toFixed(1)}
                  </output>
                  <input
                    type="range"
                    min={GRAPHIC_EQ_MIN_GAIN_DB}
                    max={GRAPHIC_EQ_MAX_GAIN_DB}
                    step={0.1}
                    value={gainsDb[index]}
                    disabled={!enabled}
                    aria-label={`${frequency} Hz Graphic EQ 增益（dB）`}
                    onChange={(event) => updateGain(index, Number(event.target.value))}
                    onDoubleClick={() => updateGain(index, 0)}
                    className="h-[220px] w-6 cursor-ns-resize accent-primary disabled:cursor-not-allowed"
                    style={{ writingMode: 'vertical-lr', direction: 'rtl' }}
                  />
                  <span className="text-[10px] whitespace-nowrap text-muted-foreground">{formatFrequency(frequency)}</span>
                </div>
              );
            })}
          </div>
          <div className="mt-2 flex justify-between text-[10px] text-muted-foreground">
            <span>双击滑杆归零</span><span>范围 −25 至 +25 dB · 超过 Nyquist 的频段停用</span>
          </div>
        </div>
        {previewError && <p className="text-xs text-destructive">试听失败：{previewError}</p>}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={!hasSelection || isApplying || bandsInUse < 2} onClick={() => void handlePreview()}>
            {isPreviewing ? '停止试听' : '试听'}
          </Button>
          <Button type="button" variant="outline" disabled={isApplying} onClick={() => onOpenChange(false)}>取消</Button>
          <Button type="button" disabled={!hasSelection || isApplying || bandsInUse < 2} onClick={() => void onApply(settings)}>
            {isApplying ? '应用中…' : '应用'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
