import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { Plus, RotateCcw, Trash2, ZoomIn, ZoomOut } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  DEFAULT_FILTER_CURVE_EQ_SETTINGS,
  FILTER_CURVE_EQ_LO_FREQ,
  FILTER_CURVE_EQ_MAX_POINTS,
  FILTER_CURVE_EQ_PRESETS,
  evaluateFilterCurveDb,
  validateFilterCurveEqSettings,
  type FilterCurveEqSettings,
  type FilterCurvePoint,
} from '@/lib/filterCurveEffect';

interface FilterCurveEqDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectionStart: number;
  selectionEnd: number;
  sampleRate: number;
  hasSelection: boolean;
  isApplying: boolean;
  onPreview: (settings: FilterCurveEqSettings) => Promise<Float32Array[]>;
  onApply: (settings: FilterCurveEqSettings) => Promise<void>;
}

interface EditorPoint extends FilterCurvePoint { id: number }

const WIDTH = 800;
const HEIGHT = 320;
const LEFT = 48;
const RIGHT = 16;
const TOP = 16;
const BOTTOM = 38;
const PLOT_WIDTH = WIDTH - LEFT - RIGHT;
const PLOT_HEIGHT = HEIGHT - TOP - BOTTOM;
const MIN_DB = -120;
const MAX_DB = 60;
const ZOOM_STEP = 6;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

export function FilterCurveEqDialog({
  open,
  onOpenChange,
  selectionStart,
  selectionEnd,
  sampleRate,
  hasSelection,
  isApplying,
  onPreview,
  onApply,
}: FilterCurveEqDialogProps) {
  const [points, setPoints] = useState<EditorPoint[]>([]);
  const [filterLength, setFilterLength] = useState(DEFAULT_FILTER_CURVE_EQ_SETTINGS.filterLength);
  const [linearFrequencyScale, setLinearFrequencyScale] = useState(false);
  const [gridLines, setGridLines] = useState(true);
  const [dbMin, setDbMin] = useState(-30);
  const [dbMax, setDbMax] = useState(30);
  const [preset, setPreset] = useState('flat');
  const [selectedPointId, setSelectedPointId] = useState<number | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const nextPointId = useRef(1);
  const activePointId = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const previewSourceRef = useRef<AudioBufferSourceNode | null>(null);

  useEffect(() => {
    if (open) {
      setPoints([]);
      setFilterLength(DEFAULT_FILTER_CURVE_EQ_SETTINGS.filterLength);
      setLinearFrequencyScale(false);
      setGridLines(true);
      setDbMin(-30);
      setDbMax(30);
      setPreset('flat');
      setSelectedPointId(null);
      setPreviewError(null);
      setIsPreviewing(false);
    } else {
      previewSourceRef.current?.stop();
      previewSourceRef.current = null;
      setIsPreviewing(false);
    }
  }, [open]);

  useEffect(() => () => {
    previewSourceRef.current?.stop();
    void audioContextRef.current?.close();
  }, []);

  const hiFreq = sampleRate / 2;
  const settings = useMemo<FilterCurveEqSettings>(() => ({
    points: points.map(({ frequency, gainDb }) => ({ frequency, gainDb })),
    filterLength,
    linearFrequencyScale,
  }), [points, filterLength, linearFrequencyScale]);
  const selectedPoint = points.find(({ id }) => id === selectedPointId) ?? null;
  const canZoomIn = (dbMax - dbMin) / 2 > ZOOM_STEP;
  const canZoomOut = dbMin > MIN_DB || dbMax < MAX_DB;

  function frequencyToX(frequency: number): number {
    if (linearFrequencyScale) return frequency / hiFreq;
    return (Math.log10(frequency) - Math.log10(FILTER_CURVE_EQ_LO_FREQ))
      / (Math.log10(hiFreq) - Math.log10(FILTER_CURVE_EQ_LO_FREQ));
  }

  function xToFrequency(x: number): number {
    const normalized = clamp(x, 0, 1);
    return linearFrequencyScale
      ? FILTER_CURVE_EQ_LO_FREQ + normalized * (hiFreq - FILTER_CURVE_EQ_LO_FREQ)
      : 10 ** (Math.log10(FILTER_CURVE_EQ_LO_FREQ)
        + normalized * (Math.log10(hiFreq) - Math.log10(FILTER_CURVE_EQ_LO_FREQ)));
  }

  function gainToY(gain: number): number {
    return TOP + (dbMax - gain) / (dbMax - dbMin) * PLOT_HEIGHT;
  }

  function eventToCurve(event: ReactMouseEvent<SVGSVGElement>): { frequency: number; gainDb: number } {
    const bounds = event.currentTarget.getBoundingClientRect();
    const svgX = (event.clientX - bounds.left) / bounds.width * WIDTH;
    const svgY = (event.clientY - bounds.top) / bounds.height * HEIGHT;
    return {
      frequency: xToFrequency((svgX - LEFT) / PLOT_WIDTH),
      gainDb: clamp(dbMax - (svgY - TOP) / PLOT_HEIGHT * (dbMax - dbMin), dbMin, dbMax),
    };
  }

  function markCustom() {
    setPreset('custom');
    setPreviewError(null);
  }

  function choosePreset(value: string) {
    setPreset(value);
    setSelectedPointId(null);
    setPreviewError(null);
    if (value === 'flat') { setPoints([]); return; }
    if (value === 'custom') return;
    const factory = FILTER_CURVE_EQ_PRESETS.find(({ name }) => name === value);
    if (factory) {
      setPoints(factory.points.map((point) => ({ ...point, id: nextPointId.current++ })));
    }
  }

  function addPoint(frequency?: number, gainDb = 0) {
    if (points.length >= FILTER_CURVE_EQ_MAX_POINTS) return;
    const centre = linearFrequencyScale
      ? (FILTER_CURVE_EQ_LO_FREQ + hiFreq) / 2
      : Math.sqrt(FILTER_CURVE_EQ_LO_FREQ * hiFreq);
    let candidate = clamp(frequency ?? centre, FILTER_CURVE_EQ_LO_FREQ, hiFreq);
    while (points.some((point) => Math.abs(point.frequency - candidate) < 1e-6) && candidate < hiFreq) {
      candidate = Math.min(hiFreq, candidate * 1.01 + 0.001);
    }
    const id = nextPointId.current++;
    setPoints((current) => [...current, { id, frequency: candidate, gainDb: clamp(gainDb, dbMin, dbMax) }]);
    setSelectedPointId(id);
    markCustom();
  }

  function updatePoint(id: number, patch: Partial<FilterCurvePoint>) {
    setPoints((current) => current.map((point) => point.id === id ? { ...point, ...patch } : point));
    markCustom();
  }

  function deletePoint(id: number) {
    setPoints((current) => current.filter((point) => point.id !== id));
    setSelectedPointId((current) => current === id ? null : current);
    markCustom();
  }

  function zoomIn() {
    const halfRange = (dbMax - dbMin) / 2;
    if (halfRange <= ZOOM_STEP) return;
    const nextHalf = Math.max(ZOOM_STEP, halfRange - ZOOM_STEP);
    const centre = (dbMax + dbMin) / 2;
    setDbMin(Math.max(MIN_DB, centre - nextHalf));
    setDbMax(Math.min(MAX_DB, centre + nextHalf));
  }

  function zoomOut() {
    if (dbMin > MIN_DB) setDbMin(Math.max(MIN_DB, dbMin - ZOOM_STEP));
    if (dbMax < MAX_DB) setDbMax(Math.min(MAX_DB, dbMax + ZOOM_STEP));
  }

  function handleStopPreview() {
    previewSourceRef.current?.stop();
    previewSourceRef.current = null;
    setIsPreviewing(false);
  }

  async function handlePreview() {
    setPreviewError(null);
    handleStopPreview();
    try {
      validateFilterCurveEqSettings(settings);
      const channels = await onPreview(settings);
      const AudioContextClass = window.AudioContext;
      if (!AudioContextClass) throw new Error('当前浏览器不支持音频试听');
      const context = audioContextRef.current ?? new AudioContextClass();
      audioContextRef.current = context;
      await context.resume();
      const length = channels[0]?.length ?? 0;
      if (!length) throw new Error('没有可试听的音频');
      const buffer = context.createBuffer(channels.length, length, sampleRate);
      channels.forEach((channel, index) => buffer.getChannelData(index).set(channel));
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
      setIsPreviewing(true);
      source.start();
    } catch (error) {
      setIsPreviewing(false);
      setPreviewError(error instanceof Error ? error.message : '试听失败');
    }
  }

  async function handleApply() {
    setPreviewError(null);
    handleStopPreview();
    try {
      validateFilterCurveEqSettings(settings);
      await onApply(settings);
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : '应用失败');
    }
  }

  const path = Array.from({ length: 161 }, (_, index) => {
    const x = LEFT + index / 160 * PLOT_WIDTH;
    const frequency = xToFrequency(index / 160);
    const gain = evaluateFilterCurveDb(points, frequency, sampleRate, linearFrequencyScale);
    return `${index === 0 ? 'M' : 'L'}${x.toFixed(2)},${gainToY(gain).toFixed(2)}`;
  }).join(' ');
  const frequencyTicks = linearFrequencyScale
    ? Array.from({ length: 6 }, (_, index) => FILTER_CURVE_EQ_LO_FREQ
      + index / 5 * (hiFreq - FILTER_CURVE_EQ_LO_FREQ))
    : [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000].filter((tick) => tick <= hiFreq);
  const dbTicks = Array.from({ length: 5 }, (_, index) => dbMin + index / 4 * (dbMax - dbMin));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl! max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Filter Curve EQ</DialogTitle>
          <DialogDescription>
            Audacity 4.0.2 · 16384 点 FFT · Blackman FIR · 重叠相加
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="space-y-1 text-sm sm:col-span-2">
              <span>工厂预设</span>
              <select
                aria-label="工厂预设"
                className="border-input bg-background flex h-9 w-full rounded-md border px-3 text-sm"
                value={preset}
                onChange={(event) => choosePreset(event.target.value)}
              >
                <option value="flat">平直（0 dB）</option>
                <option value="custom">自定义</option>
                {FILTER_CURVE_EQ_PRESETS.map(({ name }) => <option key={name} value={name}>{name}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span>Filter Length (taps)</span>
              <input
                aria-label="Filter Length (taps)"
                className="border-input bg-background flex h-9 w-full rounded-md border px-3 text-sm"
                type="number" min={21} max={8191} step={2} value={filterLength}
                onChange={(event) => {
                  if (!Number.isNaN(event.target.valueAsNumber)) setFilterLength(event.target.valueAsNumber);
                  setPreviewError(null);
                }}
              />
            </label>
            <div className="flex items-end gap-2 pb-1">
              <Button type="button" variant="outline" size="sm" onClick={zoomIn} disabled={!canZoomIn} aria-label="放大 dB 范围">
                <ZoomIn className="size-4" />放大
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={zoomOut} disabled={!canZoomOut} aria-label="缩小 dB 范围">
                <ZoomOut className="size-4" />缩小
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox" checked={linearFrequencyScale}
                onChange={(event) => { setLinearFrequencyScale(event.target.checked); markCustom(); }}
              />
              Linear frequency scale
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={gridLines} onChange={(event) => setGridLines(event.target.checked)} />
              Grid lines
            </label>
            <Button type="button" variant="outline" size="sm" onClick={() => { setPoints([]); setPreset('flat'); setSelectedPointId(null); }}>
              <RotateCcw className="size-4" />重置曲线
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => {
              setPoints((current) => current.map((point) => ({ ...point, gainDb: clamp(-point.gainDb, MIN_DB, MAX_DB) })));
              markCustom();
            }}>
              Invert
            </Button>
            <span className="text-muted-foreground text-xs">dB {dbMin}…{dbMax} · 20…{Math.round(hiFreq)} Hz</span>
          </div>

          <svg
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            className="bg-background text-foreground h-auto w-full touch-none rounded-md border select-none"
            role="img"
            aria-label="Filter Curve EQ 曲线图；双击添加控制点，拖动控制点编辑"
            onDoubleClick={(event) => {
              if ((event.target as Element).tagName.toLowerCase() === 'circle') return;
              const point = eventToCurve(event);
              addPoint(point.frequency, point.gainDb);
            }}
            onPointerMove={(event) => {
              if (activePointId.current === null) return;
              const point = eventToCurve(event);
              updatePoint(activePointId.current, point);
            }}
            onPointerUp={() => { activePointId.current = null; }}
            onPointerCancel={() => { activePointId.current = null; }}
          >
            <rect x={LEFT} y={TOP} width={PLOT_WIDTH} height={PLOT_HEIGHT} className="fill-muted/20" />
            {gridLines && frequencyTicks.map((tick) => {
              const x = LEFT + frequencyToX(tick) * PLOT_WIDTH;
              return <line key={`f-${tick}`} x1={x} x2={x} y1={TOP} y2={TOP + PLOT_HEIGHT} className="stroke-border" strokeWidth={1} />;
            })}
            {gridLines && dbTicks.map((tick) => {
              const y = gainToY(tick);
              return <line key={`db-${tick}`} x1={LEFT} x2={LEFT + PLOT_WIDTH} y1={y} y2={y} className="stroke-border" strokeWidth={1} />;
            })}
            <line x1={LEFT} x2={LEFT + PLOT_WIDTH} y1={gainToY(0)} y2={gainToY(0)} className="stroke-muted-foreground" strokeDasharray="4 4" />
            <path d={path} fill="none" className="stroke-primary" strokeWidth={2.5} strokeLinejoin="round" />
            {points.map((point) => {
              const x = LEFT + frequencyToX(point.frequency) * PLOT_WIDTH;
              if (x < LEFT || x > LEFT + PLOT_WIDTH) return null;
              return (
                <circle
                  key={point.id}
                  cx={x} cy={gainToY(point.gainDb)} r={selectedPointId === point.id ? 7 : 5}
                  className={selectedPointId === point.id ? 'fill-primary stroke-background' : 'fill-background stroke-primary'}
                  strokeWidth={2.5} role="button" tabIndex={0}
                  aria-label={`控制点 ${point.frequency.toFixed(2)} Hz ${point.gainDb.toFixed(2)} dB`}
                  onPointerDown={(event) => {
                    event.preventDefault();
                    event.currentTarget.setPointerCapture(event.pointerId);
                    activePointId.current = point.id;
                    setSelectedPointId(point.id);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') setSelectedPointId(point.id);
                    if (event.key === 'Delete') deletePoint(point.id);
                  }}
                />
              );
            })}
            {frequencyTicks.map((tick) => {
              const x = LEFT + frequencyToX(tick) * PLOT_WIDTH;
              return <text key={`fl-${tick}`} x={x} y={HEIGHT - 12} textAnchor="middle" className="fill-muted-foreground text-[11px]">{tick >= 1000 ? `${(tick / 1000).toFixed(tick % 1000 ? 1 : 0)}k` : Math.round(tick)}</text>;
            })}
            {dbTicks.map((tick) => <text key={`dt-${tick}`} x={LEFT - 7} y={gainToY(tick) + 4} textAnchor="end" className="fill-muted-foreground text-[11px]">{tick.toFixed(0)}</text>)}
            <text x={WIDTH / 2} y={HEIGHT - 1} textAnchor="middle" className="fill-muted-foreground text-[11px]">Frequency (Hz)</text>
          </svg>

          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <div className="flex min-h-9 flex-wrap items-center gap-2">
              {points.length === 0 && <span className="text-muted-foreground text-sm">当前为平直曲线。双击图形或点击“添加控制点”开始编辑。</span>}
              {[...points].sort((a, b) => a.frequency - b.frequency).map((point) => (
                <Button
                  key={point.id} type="button" size="sm"
                  variant={point.id === selectedPointId ? 'default' : 'outline'}
                  onClick={() => setSelectedPointId(point.id)}
                >
                  {point.frequency.toFixed(point.frequency < 100 ? 1 : 0)} Hz · {point.gainDb.toFixed(1)} dB
                </Button>
              ))}
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => addPoint()} disabled={points.length >= FILTER_CURVE_EQ_MAX_POINTS}>
              <Plus className="size-4" />添加控制点
            </Button>
          </div>

          {selectedPoint && (
            <div className="grid items-end gap-3 rounded-md border p-3 sm:grid-cols-[1fr_1fr_auto]">
              <label className="space-y-1 text-sm">
                <span>控制点频率（Hz）</span>
                <input
                  aria-label="控制点频率（Hz）" type="number" min={0.000001} max={1000000} step="any"
                  className="border-input bg-background flex h-9 w-full rounded-md border px-3 text-sm"
                  value={selectedPoint.frequency}
                  onChange={(event) => {
                    if (!Number.isNaN(event.target.valueAsNumber)) updatePoint(selectedPoint.id, { frequency: event.target.valueAsNumber });
                  }}
                />
              </label>
              <label className="space-y-1 text-sm">
                <span>控制点增益（dB）</span>
                <input
                  aria-label="控制点增益（dB）" type="number" min={-120} max={60} step="any"
                  className="border-input bg-background flex h-9 w-full rounded-md border px-3 text-sm"
                  value={selectedPoint.gainDb}
                  onChange={(event) => {
                    if (!Number.isNaN(event.target.valueAsNumber)) updatePoint(selectedPoint.id, { gainDb: event.target.valueAsNumber });
                  }}
                />
              </label>
              <Button type="button" variant="outline" size="sm" onClick={() => deletePoint(selectedPoint.id)}>
                <Trash2 className="size-4" />删除控制点
              </Button>
            </div>
          )}

          <div className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs">
            <span>选区：{selectionStart.toFixed(3)}–{selectionEnd.toFixed(3)} 秒</span>
            <span>采样率：{sampleRate} Hz</span>
            <span>控制点：{points.length}/{FILTER_CURVE_EQ_MAX_POINTS}</span>
          </div>
          {!hasSelection && <p className="text-destructive text-sm">请先选择要处理的音频。</p>}
          {previewError && <p role="alert" className="text-destructive text-sm">{previewError}</p>}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" disabled={!hasSelection || isApplying} onClick={isPreviewing ? handleStopPreview : () => void handlePreview()}>
            {isPreviewing ? '停止试听' : '试听'}
          </Button>
          <Button type="button" disabled={!hasSelection || isApplying || isPreviewing} onClick={() => void handleApply()}>
            {isApplying ? '应用中…' : '应用'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
