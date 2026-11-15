import { useEffect, useRef, useState } from 'react';
import { Download, ExternalLink, RotateCcw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  evaluateContrast,
  formatContrastDifference,
  serializeContrastResults,
  type ContrastMeasurement,
  type ContrastResultKind,
} from '@/lib/contrastAnalysis';

interface ContrastAnalysisDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectName: string;
  onMeasure: () => Promise<ContrastMeasurement>;
}

const RESULT_LABELS: Record<ContrastResultKind, string> = {
  'foreground-too-high': 'Foreground level too high',
  'background-too-high': 'Background level too high',
  'background-higher': 'Background higher than foreground',
  pass: 'WCAG2 Pass',
  fail: 'WCAG2 Fail',
};

function formatTime(value: number | undefined): string {
  if (value === undefined) return '00:00:00.00';
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value - hours * 3600) / 60);
  const seconds = value - hours * 3600 - minutes * 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${seconds.toFixed(2).padStart(5, '0')}`;
}

function formatVolume(measurement: ContrastMeasurement | null): string {
  if (!measurement) return '';
  if (measurement.rmsDb === Number.NEGATIVE_INFINITY) return 'zero';
  return `${measurement.rmsDb.toFixed(2)} dB`;
}

export function ContrastAnalysisDialog({
  open,
  onOpenChange,
  projectName,
  onMeasure,
}: ContrastAnalysisDialogProps) {
  const [foreground, setForeground] = useState<ContrastMeasurement | null>(null);
  const [background, setBackground] = useState<ContrastMeasurement | null>(null);
  const [measuring, setMeasuring] = useState<'foreground' | 'background' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const operationRef = useRef(0);

  useEffect(() => {
    if (open) return;
    operationRef.current += 1;
    setForeground(null);
    setBackground(null);
    setMeasuring(null);
    setError(null);
  }, [open]);

  if (!open) return null;

  const result = foreground && background
    ? evaluateContrast(foreground.rmsDb, background.rmsDb)
    : null;
  const resultText = !foreground && !background
    ? ''
    : !foreground
      ? 'Foreground not yet measured'
      : !background
        ? 'Background not yet measured'
        : RESULT_LABELS[result!.kind];

  async function measure(target: 'foreground' | 'background') {
    const operation = ++operationRef.current;
    setMeasuring(target);
    setError(null);
    try {
      const measurement = await onMeasure();
      if (operation !== operationRef.current) return;
      if (target === 'foreground') setForeground(measurement);
      else setBackground(measurement);
    } catch (reason: unknown) {
      if (operation === operationRef.current) {
        setError(reason instanceof Error ? reason.message : '无法测量当前选区');
      }
    } finally {
      if (operation === operationRef.current) setMeasuring(null);
    }
  }

  function reset() {
    operationRef.current += 1;
    setForeground(null);
    setBackground(null);
    setMeasuring(null);
    setError(null);
  }

  function close() {
    reset();
    onOpenChange(false);
  }

  function exportResults() {
    const blob = new Blob([serializeContrastResults({ projectName, foreground, background })], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'contrast.txt';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <section
      role="dialog"
      aria-modal="false"
      aria-labelledby="contrast-analysis-title"
      className="fixed bottom-4 right-4 z-50 max-h-[calc(100vh-2rem)] w-[min(46rem,calc(100vw-2rem))] overflow-auto rounded-lg border bg-background shadow-2xl"
      onKeyDown={(event) => { if (event.key === 'Escape') close(); }}
    >
      <header className="flex items-start justify-between gap-3 border-b px-4 py-3">
        <div>
          <h2 id="contrast-analysis-title" className="text-base font-semibold">Contrast Analysis (WCAG 2 compliance)</h2>
          <p className="mt-1 text-xs text-muted-foreground">分别选择前景和背景音频，再点击对应的 Measure selection。面板打开时仍可改变时间轴选区。</p>
        </div>
        <Button type="button" variant="ghost" size="icon" aria-label="Close Contrast Analysis" onClick={close}>
          <X className="h-4 w-4" />
        </Button>
      </header>

      <div className="space-y-4 p-4">
        <p className="text-sm">Contrast Analyzer, for measuring RMS volume differences between two selections of audio.</p>
        {error && <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

        <div className="overflow-x-auto rounded-md border">
          <table className="w-full min-w-[620px] border-collapse text-sm">
            <thead className="bg-muted/30 text-xs text-muted-foreground">
              <tr><th className="p-2 text-left">Parameters</th><th className="p-2 text-left">Start</th><th className="p-2 text-left">End</th><th className="p-2" /><th className="p-2 text-left">Volume</th></tr>
            </thead>
            <tbody>
              {(['foreground', 'background'] as const).map((target) => {
                const measurement = target === 'foreground' ? foreground : background;
                const label = target === 'foreground' ? 'Foreground' : 'Background';
                return (
                  <tr key={target} className="border-t">
                    <th className="p-2 text-left font-medium">{label}:</th>
                    <td className="p-2"><input aria-label={`${label} start`} readOnly className="w-32 rounded border bg-muted/10 px-2 py-1 font-mono text-xs" value={formatTime(measurement?.start)} /></td>
                    <td className="p-2"><input aria-label={`${label} end`} readOnly className="w-32 rounded border bg-muted/10 px-2 py-1 font-mono text-xs" value={formatTime(measurement?.end)} /></td>
                    <td className="p-2">
                      <Button type="button" size="sm" variant="outline" aria-label={`Measure ${target} selection`} disabled={measuring !== null} onClick={() => { void measure(target); }}>
                        {measuring === target ? 'Measuring…' : 'Measure selection'}
                      </Button>
                    </td>
                    <td className="p-2"><output aria-label={`${label} volume`} className="block min-w-24 font-mono text-xs">{formatVolume(measurement)}</output></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="grid gap-3 rounded-md border p-3 sm:grid-cols-[1fr_auto]">
          <div className="space-y-3" aria-live="polite">
            <div className="grid gap-1 sm:grid-cols-[9rem_1fr] sm:items-center">
              <span className="text-sm font-medium">Contrast Result:</span>
              <output aria-label="Contrast Result" className="min-h-6 font-mono text-sm">{resultText}</output>
            </div>
            <div className="grid gap-1 sm:grid-cols-[9rem_1fr] sm:items-center">
              <span className="text-sm font-medium">Difference:</span>
              <output aria-label="Difference" className="min-h-6 font-mono text-sm">{result ? formatContrastDifference(result.differenceDb) : ''}</output>
            </div>
          </div>
          <div className="flex gap-2 sm:flex-col">
            <Button type="button" size="sm" variant="outline" onClick={reset}><RotateCcw className="mr-1 h-3.5 w-3.5" />Reset</Button>
            <Button type="button" size="sm" variant="outline" onClick={exportResults}><Download className="mr-1 h-3.5 w-3.5" />Export…</Button>
          </div>
        </div>
      </div>

      <footer className="flex flex-wrap justify-end gap-2 border-t px-4 py-3">
        <Button asChild type="button" size="sm" variant="ghost">
          <a href="https://manual.audacityteam.org/man/contrast.html" target="_blank" rel="noreferrer"><ExternalLink className="mr-1 h-3.5 w-3.5" />Help</a>
        </Button>
        <Button type="button" size="sm" onClick={close}>Close</Button>
      </footer>
    </section>
  );
}
