import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, RotateCcw } from 'lucide-react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  analyzePlotSpectrum,
  findNearestPlotSpectrumPeak,
  frequencyToPitchName,
  PLOT_SPECTRUM_ALGORITHMS,
  PLOT_SPECTRUM_SIZES,
  PLOT_SPECTRUM_WINDOWS,
  samplePlotSpectrum,
  serializePlotSpectrum,
  type PlotSpectrumAlgorithm,
  type PlotSpectrumAudio,
  type PlotSpectrumResult,
  type PlotSpectrumWindow,
} from '@/lib/plotSpectrum';

interface PlotSpectrumDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectionStart: number;
  selectionEnd: number;
  sampleRate: number;
  onLoadAudio: () => Promise<PlotSpectrumAudio>;
}

type AxisChoice = 'linear' | 'log';

interface CursorReadout {
  position: number;
  value: number;
  peakPosition: number;
  peakValue: number;
}

const WIDTH = 960;
const HEIGHT = 360;
const PLOT_LEFT = 70;
const PLOT_RIGHT = 18;
const PLOT_TOP = 18;
const PLOT_BOTTOM = 50;
const PLOT_WIDTH = WIDTH - PLOT_LEFT - PLOT_RIGHT;
const PLOT_HEIGHT = HEIGHT - PLOT_TOP - PLOT_BOTTOM;

function formatAxisValue(value: number): string {
  const absolute = Math.abs(value);
  if (absolute >= 1000) return `${Number((value / 1000).toFixed(2))}k`;
  if (absolute > 0 && absolute < 0.01) return value.toExponential(1);
  return String(Number(value.toFixed(2)));
}

function frequencyTicks(minimum: number, maximum: number, axis: AxisChoice): number[] {
  if (axis === 'linear') return Array.from({ length: 6 }, (_, index) => minimum + (maximum - minimum) * index / 5);
  const ticks: number[] = [];
  for (let exponent = Math.floor(Math.log10(minimum)); exponent <= Math.ceil(Math.log10(maximum)); exponent += 1) {
    for (const multiplier of [1, 2, 5]) {
      const value = multiplier * 10 ** exponent;
      if (value >= minimum && value <= maximum) ticks.push(value);
    }
  }
  return ticks;
}

function formatCursor(readout: CursorReadout | null, spectrum: boolean, peak = false): string {
  if (!readout) return '移动光标读取';
  const position = peak ? readout.peakPosition : readout.position;
  const value = peak ? readout.peakValue : readout.value;
  if (spectrum) {
    return `${position.toFixed(1)} Hz (${frequencyToPitchName(position)}) = ${value.toFixed(1)} dB`;
  }
  const frequency = position > 0 ? 1 / position : 0;
  return `${position.toFixed(6)} s (${frequency.toFixed(1)} Hz, ${frequencyToPitchName(frequency)}) = ${value.toFixed(4)}`;
}

export function PlotSpectrumDialog({
  open, onOpenChange, selectionStart, selectionEnd, sampleRate, onLoadAudio,
}: PlotSpectrumDialogProps) {
  const [algorithm, setAlgorithm] = useState<PlotSpectrumAlgorithm>('spectrum');
  const [size, setSize] = useState(1024);
  const [windowFunction, setWindowFunction] = useState<PlotSpectrumWindow>('hann');
  const [axis, setAxis] = useState<AxisChoice>('log');
  const [drawGrid, setDrawGrid] = useState(true);
  const [audio, setAudio] = useState<PlotSpectrumAudio | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [reloadIndex, setReloadIndex] = useState(0);
  const [cursor, setCursor] = useState<CursorReadout | null>(null);
  const loadAudioRef = useRef(onLoadAudio);
  loadAudioRef.current = onLoadAudio;

  useEffect(() => {
    if (!open) return;
    let active = true;
    setAudio(null);
    setCursor(null);
    setLoadError(null);
    setIsLoading(true);
    void loadAudioRef.current().then((loaded) => {
      if (active) setAudio(loaded);
    }).catch((error: unknown) => {
      if (active) setLoadError(error instanceof Error ? error.message : '无法读取选区音频');
    }).finally(() => {
      if (active) setIsLoading(false);
    });
    return () => { active = false; };
  }, [open, reloadIndex]);

  const analysis = useMemo<{ result: PlotSpectrumResult | null; error: string | null }>(() => {
    if (!audio || audio.samples.length < size) return { result: null, error: null };
    try {
      return { result: analyzePlotSpectrum(audio.samples, { algorithm, size, window: windowFunction, sampleRate }), error: null };
    } catch (error) {
      return { result: null, error: error instanceof Error ? error.message : '频谱分析失败' };
    }
  }, [algorithm, audio, sampleRate, size, windowFunction]);
  const result = analysis.result;
  const isSpectrum = algorithm === 'spectrum';
  const effectiveAxis: AxisChoice = isSpectrum ? axis : 'linear';

  const plot = useMemo(() => {
    if (!result) return null;
    const xMin = isSpectrum ? sampleRate / size : 0;
    const xMax = isSpectrum ? sampleRate / 2 : result.values.length / sampleRate;
    let yMin = isSpectrum ? Math.max(-90, result.yMin) : result.yMin;
    let yMax = isSpectrum ? (result.yMax <= -90 ? -80 : result.yMax + 0.5) : result.yMax;
    if (!(yMax > yMin) || !Number.isFinite(yMax - yMin)) {
      yMin = Number.isFinite(yMin) ? yMin - 0.5 : -90;
      yMax = Number.isFinite(yMax) ? yMax + 0.5 : -80;
    }
    const xToSvg = (value: number) => PLOT_LEFT + (effectiveAxis === 'log'
      ? Math.log(value / xMin) / Math.log(xMax / xMin)
      : (value - xMin) / (xMax - xMin)) * PLOT_WIDTH;
    const yToSvg = (value: number) => PLOT_TOP + (yMax - value) / (yMax - yMin) * PLOT_HEIGHT;
    const commands: string[] = [];
    for (let pixel = 0; pixel < PLOT_WIDTH; pixel += 1) {
      const ratio0 = pixel / PLOT_WIDTH;
      const ratio1 = (pixel + 1) / PLOT_WIDTH;
      const first = effectiveAxis === 'log'
        ? xMin * (xMax / xMin) ** ratio0
        : xMin + (xMax - xMin) * ratio0;
      const second = effectiveAxis === 'log'
        ? xMin * (xMax / xMin) ** ratio1
        : xMin + (xMax - xMin) * ratio1;
      const value = samplePlotSpectrum(result, first, second);
      if (!Number.isFinite(value)) continue;
      const x = PLOT_LEFT + pixel + 0.5;
      const y = Math.max(PLOT_TOP, Math.min(PLOT_TOP + PLOT_HEIGHT, yToSvg(value)));
      commands.push(`M${x.toFixed(1)},${(PLOT_TOP + PLOT_HEIGHT).toFixed(1)}L${x.toFixed(1)},${y.toFixed(1)}`);
    }
    const xTicks = frequencyTicks(xMin, xMax, effectiveAxis).filter((tick) => effectiveAxis !== 'log' || tick > 0);
    const yTicks = Array.from({ length: 6 }, (_, index) => yMin + (yMax - yMin) * index / 5);
    return { xMin, xMax, yMin, yMax, xToSvg, yToSvg, commands: commands.join(''), xTicks, yTicks };
  }, [effectiveAxis, isSpectrum, result, sampleRate, size]);

  function updateCursor(clientX: number, element: SVGSVGElement): void {
    if (!result || !plot) return;
    const rectangle = element.getBoundingClientRect();
    if (rectangle.width <= 0) return;
    const svgX = (clientX - rectangle.left) * WIDTH / rectangle.width;
    if (svgX < PLOT_LEFT || svgX > WIDTH - PLOT_RIGHT) { setCursor(null); return; }
    const ratio = (svgX - PLOT_LEFT) / PLOT_WIDTH;
    const position = effectiveAxis === 'log'
      ? plot.xMin * (plot.xMax / plot.xMin) ** ratio
      : plot.xMin + (plot.xMax - plot.xMin) * ratio;
    const nextRatio = Math.min(1, ratio + 1 / PLOT_WIDTH);
    const nextPosition = effectiveAxis === 'log'
      ? plot.xMin * (plot.xMax / plot.xMin) ** nextRatio
      : plot.xMin + (plot.xMax - plot.xMin) * nextRatio;
    const value = samplePlotSpectrum(result, position, nextPosition);
    const peak = findNearestPlotSpectrumPeak(result, position);
    if (!peak || !Number.isFinite(value)) { setCursor(null); return; }
    setCursor({ position, value, peakPosition: peak.position, peakValue: peak.value });
  }

  function handleExport(): void {
    if (!result) return;
    const blob = new Blob([serializePlotSpectrum(result)], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'spectrum.txt';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  const error = loadError ?? analysis.error;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[94vh] w-[calc(100vw-24px)] max-w-6xl flex-col overflow-hidden sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle>Plot Spectrum · 频率分析</DialogTitle>
          <DialogDescription>
            选区 {selectionStart.toFixed(3)}–{selectionEnd.toFixed(3)} 秒 · Audacity 4.0.2 SpectrumAnalyst · 只读分析，不修改工程
          </DialogDescription>
        </DialogHeader>

        <div className="grid shrink-0 grid-cols-1 gap-3 rounded-md border bg-muted/10 p-3 sm:grid-cols-2 lg:grid-cols-5">
          <label className="space-y-1 text-xs">Algorithm
            <select aria-label="分析算法" className="h-9 w-full rounded-md border bg-background px-2" value={algorithm}
              onChange={(event) => { setAlgorithm(event.target.value as PlotSpectrumAlgorithm); setCursor(null); }}>
              {PLOT_SPECTRUM_ALGORITHMS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>
          <label className="space-y-1 text-xs">Size
            <select aria-label="FFT Size" className="h-9 w-full rounded-md border bg-background px-2" value={size}
              onChange={(event) => { setSize(Number(event.target.value)); setCursor(null); }}>
              {PLOT_SPECTRUM_SIZES.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <label className="space-y-1 text-xs">Function
            <select aria-label="窗函数" className="h-9 w-full rounded-md border bg-background px-2" value={windowFunction}
              onChange={(event) => { setWindowFunction(event.target.value as PlotSpectrumWindow); setCursor(null); }}>
              {PLOT_SPECTRUM_WINDOWS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>
          <label className="space-y-1 text-xs">Axis
            <select aria-label="频率轴" className="h-9 w-full rounded-md border bg-background px-2 disabled:opacity-50"
              value={effectiveAxis} disabled={!isSpectrum} onChange={(event) => setAxis(event.target.value as AxisChoice)}>
              <option value="linear">Linear frequency</option>
              <option value="log">Log frequency</option>
            </select>
          </label>
          <label className="flex items-end gap-2 pb-2 text-xs">
            <input type="checkbox" aria-label="显示网格" checked={drawGrid} onChange={(event) => setDrawGrid(event.target.checked)} />
            Grids · 显示网格
          </label>
        </div>

        <div className="min-h-0 flex-1 overflow-auto rounded-md border bg-[#11161b] p-2">
          {isLoading && <p role="status" className="p-12 text-center text-sm text-muted-foreground">正在读取并分析选区…</p>}
          {!isLoading && error && <p role="alert" className="p-8 text-center text-sm text-destructive">{error}</p>}
          {!isLoading && !error && audio && audio.samples.length < size && (
            <p role="status" className="p-12 text-center text-sm text-warning">
              所选音频只有 {audio.samples.length} 个采样，不足当前 FFT Size {size}；请选择更小的 Size 或扩大选区。
            </p>
          )}
          {!isLoading && !error && result && plot && (
            <svg
              viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
              className="h-auto min-h-[280px] w-full select-none"
              role="img"
              aria-label={`${PLOT_SPECTRUM_ALGORITHMS.find((item) => item.id === algorithm)?.label} 频谱分析图，${result.windowCount} 个分析窗`}
              onPointerMove={(event) => updateCursor(event.clientX, event.currentTarget)}
              onPointerDown={(event) => updateCursor(event.clientX, event.currentTarget)}
              onPointerLeave={() => setCursor(null)}
            >
              <rect x={0} y={0} width={WIDTH} height={HEIGHT} fill="#11161b" />
              {drawGrid && <g stroke="#33404b" strokeWidth={1}>
                {plot.xTicks.map((tick) => <line key={`x-grid-${tick}`} x1={plot.xToSvg(tick)} x2={plot.xToSvg(tick)} y1={PLOT_TOP} y2={PLOT_TOP + PLOT_HEIGHT} />)}
                {plot.yTicks.map((tick) => <line key={`y-grid-${tick}`} x1={PLOT_LEFT} x2={WIDTH - PLOT_RIGHT} y1={plot.yToSvg(tick)} y2={plot.yToSvg(tick)} />)}
              </g>}
              <rect x={PLOT_LEFT} y={PLOT_TOP} width={PLOT_WIDTH} height={PLOT_HEIGHT} fill="none" stroke="#75828d" />
              <path data-testid="spectrum-plot-path" d={plot.commands} stroke="#62c6ff" strokeWidth={1} fill="none" />
              {cursor && <line data-testid="spectrum-peak-line" x1={plot.xToSvg(cursor.peakPosition)} x2={plot.xToSvg(cursor.peakPosition)}
                y1={PLOT_TOP} y2={PLOT_TOP + PLOT_HEIGHT} stroke="#ff6b75" strokeWidth={1.5} />}
              <g fill="#b4bec6" fontSize={11} textAnchor="middle">
                {plot.xTicks.map((tick) => <text key={`x-label-${tick}`} x={plot.xToSvg(tick)} y={PLOT_TOP + PLOT_HEIGHT + 18}>{formatAxisValue(tick)}</text>)}
                <text x={PLOT_LEFT + PLOT_WIDTH / 2} y={HEIGHT - 8}>{isSpectrum ? 'Frequency (Hz)' : 'Lag (seconds)'}</text>
              </g>
              <g fill="#b4bec6" fontSize={11} textAnchor="end">
                {plot.yTicks.map((tick) => <text key={`y-label-${tick}`} x={PLOT_LEFT - 8} y={plot.yToSvg(tick) + 4}>{formatAxisValue(tick)}</text>)}
                <text x={PLOT_LEFT - 8} y={12}>{isSpectrum ? 'dB' : 'Level'}</text>
              </g>
            </svg>
          )}
        </div>

        <div className="grid shrink-0 grid-cols-1 gap-2 text-xs sm:grid-cols-2">
          <output aria-label="光标读数" className="rounded bg-muted/20 px-3 py-2 font-mono">Cursor: {formatCursor(cursor, isSpectrum)}</output>
          <output aria-label="峰值读数" className="rounded bg-muted/20 px-3 py-2 font-mono">Peak: {formatCursor(cursor, isSpectrum, true)}</output>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <span>
            {audio ? `${audio.samples.length} 个采样 · ${audio.trackCount} 轨` : '尚未读取音频'}
            {result ? ` · ${result.windowCount} 个半窗重叠分析窗` : ''}
          </span>
          {audio?.truncated && <span className="text-warning">选区过长，仅分析前 {audio.samples.length} 个采样（共 {audio.sourceSamples}）</span>}
        </div>
        <DialogFooter className="shrink-0">
          <Button type="button" variant="outline" onClick={() => setReloadIndex((value) => value + 1)} disabled={isLoading}>
            <RotateCcw className="size-4" />Replot · 重新读取
          </Button>
          <Button type="button" variant="outline" onClick={handleExport} disabled={!result}>
            <Download className="size-4" />Export · 导出文本
          </Button>
          <Button type="button" onClick={() => onOpenChange(false)}>关闭</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default PlotSpectrumDialog;
