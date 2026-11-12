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
import {
  DEFAULT_LIMITER_SETTINGS,
  evaluateLimiterTransferFunction,
  validateLimiterSettings,
  type LimiterSettings,
} from '@/lib/limiterEffect';
import { useGeneratorPreview } from './useGeneratorPreview';

export interface LimiterPreview {
  /** The concatenated, unprocessed selection used for the preview. */
  inputChannels: Float32Array[];
  /** The latency-compensated processed selection. */
  channels: Float32Array[];
}

interface LimiterDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sampleRate: number;
  selectionStart: number;
  selectionEnd: number;
  hasSelection: boolean;
  isApplying: boolean;
  onPreview: (settings: LimiterSettings) => Promise<LimiterPreview>;
  onApply: (settings: LimiterSettings) => void | Promise<void>;
}

type NumericField = keyof LimiterSettings;
type Drafts = Record<NumericField, string>;

const DEFAULT_DRAFTS: Drafts = {
  thresholdDb: String(DEFAULT_LIMITER_SETTINGS.thresholdDb),
  makeupTargetDb: String(DEFAULT_LIMITER_SETTINGS.makeupTargetDb),
  lookaheadMs: String(DEFAULT_LIMITER_SETTINGS.lookaheadMs),
  kneeWidthDb: String(DEFAULT_LIMITER_SETTINGS.kneeWidthDb),
  releaseMs: String(DEFAULT_LIMITER_SETTINGS.releaseMs),
};

const CONTROLS: Record<NumericField, {
  label: string;
  unit: string;
  minimum: number;
  maximum: number;
  step: number;
}> = {
  thresholdDb: { label: 'Threshold 阈值', unit: 'dB', minimum: -30, maximum: 0, step: 0.1 },
  makeupTargetDb: { label: 'Output 输出目标', unit: 'dB', minimum: -30, maximum: 0, step: 0.1 },
  lookaheadMs: { label: 'Lookahead', unit: 'ms', minimum: 0, maximum: 50, step: 0.01 },
  kneeWidthDb: { label: 'Knee width 拐点宽度', unit: 'dB', minimum: 0, maximum: 10, step: 0.1 },
  releaseMs: { label: 'Release', unit: 'ms', minimum: 0, maximum: 1000, step: 0.1 },
};

function LimiterControl({ field, value, onChange }: {
  field: NumericField;
  value: string;
  onChange: (value: string) => void;
}) {
  const control = CONTROLS[field];
  const id = `limiter-${field}`;
  const accessibleLabel = `${control.label}（${control.unit}）`;
  const numericValue = Number(value);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={id}>{accessibleLabel}</Label>
        <Input
          id={id}
          type="number"
          min={control.minimum}
          max={control.maximum}
          step={control.step}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-8 w-24"
          required
        />
      </div>
      <input
        type="range"
        aria-label={`${accessibleLabel}滑块`}
        min={control.minimum}
        max={control.maximum}
        step={control.step}
        value={Number.isFinite(numericValue) ? numericValue : control.minimum}
        onChange={(event) => onChange(event.target.value)}
        className="w-full accent-primary"
      />
    </div>
  );
}

function TransferCurve({ settings, valid }: { settings: LimiterSettings; valid: boolean }) {
  const curveSettings = valid ? settings : DEFAULT_LIMITER_SETTINGS;
  const width = 480;
  const height = 190;
  const padding = 26;
  const minimumDb = -30;
  const maximumDb = 6;
  const x = (inputDb: number) => padding + ((inputDb + 30) / 36) * (width - padding * 2);
  const y = (outputDb: number) => height - padding - ((outputDb - minimumDb) / (maximumDb - minimumDb)) * (height - padding * 2);
  const path = useMemo(() => {
    let value = '';
    for (let index = 0; index <= 144; index += 1) {
      const inputDb = -30 + index * 0.25;
      const outputDb = Math.max(minimumDb, Math.min(maximumDb, evaluateLimiterTransferFunction(curveSettings, inputDb)));
      value += `${index === 0 ? 'M' : 'L'}${x(inputDb).toFixed(2)},${y(outputDb).toFixed(2)} `;
    }
    return value.trim();
  }, [curveSettings]);
  return (
    <figure className="space-y-2 rounded-md border p-3" aria-label="Limiter 传递特性">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img" aria-label="Limiter 传递曲线">
        {[-30, -20, -10, 0].map((tick) => (
          <g key={`x-${tick}`}>
            <line x1={x(tick)} x2={x(tick)} y1={padding} y2={height - padding} className="stroke-muted" strokeWidth="1" />
            <text x={x(tick)} y={height - 7} textAnchor="middle" className="fill-muted-foreground text-[10px]">{tick}</text>
          </g>
        ))}
        {[-30, -20, -10, 0].map((tick) => (
          <g key={`y-${tick}`}>
            <line x1={padding} x2={width - padding} y1={y(tick)} y2={y(tick)} className="stroke-muted" strokeWidth="1" />
            <text x={padding - 5} y={y(tick) + 3} textAnchor="end" className="fill-muted-foreground text-[10px]">{tick}</text>
          </g>
        ))}
        <line x1={x(-30)} x2={x(0)} y1={y(-30)} y2={y(0)} className="stroke-muted-foreground" strokeDasharray="4 4" strokeWidth="1" />
        <path d={path} fill="none" className="stroke-primary" strokeWidth="2.5" strokeLinejoin="round" />
        <text x={width / 2} y={14} textAnchor="middle" className="fill-muted-foreground text-[11px]">输入（dB）→ 输出（dB）</text>
      </svg>
      <figcaption className="text-xs text-muted-foreground">无限压缩比 · Attack 0 ms · 输出目标 {curveSettings.makeupTargetDb.toFixed(1)} dB</figcaption>
    </figure>
  );
}

interface HistoryPoint {
  inputDb: number;
  outputDb: number;
  compressionDb: number;
}

const HISTORY_POINTS = 160;
const HISTORY_MIN_DB = -12;

function dbFromPeak(value: number): number {
  return value > 0 ? Math.max(HISTORY_MIN_DB, Math.min(0, 20 * Math.log10(value))) : HISTORY_MIN_DB;
}

function makeHistory(preview: LimiterPreview | null, sampleRate: number, makeupGainDb: number): HistoryPoint[] {
  if (!preview || preview.channels.length === 0 || preview.inputChannels.length !== preview.channels.length) return [];
  const length = preview.channels[0]?.length ?? 0;
  if (length === 0 || preview.inputChannels.some((channel) => channel.length !== length) || preview.channels.some((channel) => channel.length !== length)) return [];
  const windowLength = Math.min(length, Math.max(1, Math.round(sampleRate * 2)));
  const start = length - windowLength;
  const points: HistoryPoint[] = [];
  for (let point = 0; point < HISTORY_POINTS; point += 1) {
    const from = start + Math.floor(point * windowLength / HISTORY_POINTS);
    const to = start + Math.max(Math.floor((point + 1) * windowLength / HISTORY_POINTS), Math.floor(point * windowLength / HISTORY_POINTS) + 1);
    let inputPeak = 0;
    let outputPeak = 0;
    for (let index = from; index < Math.min(to, length); index += 1) {
      for (let channel = 0; channel < preview.channels.length; channel += 1) {
        inputPeak = Math.max(inputPeak, Math.abs(preview.inputChannels[channel][index]));
        outputPeak = Math.max(outputPeak, Math.abs(preview.channels[channel][index]));
      }
    }
    const inputDb = dbFromPeak(inputPeak);
    const outputDb = dbFromPeak(outputPeak);
    points.push({
      inputDb,
      outputDb,
      compressionDb: Math.max(HISTORY_MIN_DB, Math.min(0, outputDb - inputDb - makeupGainDb)),
    });
  }
  return points;
}

function DynamicsHistory({ preview, settings, sampleRate }: {
  preview: LimiterPreview | null;
  settings: LimiterSettings;
  sampleRate: number;
}) {
  const [showInput, setShowInput] = useState(true);
  const [showOutput, setShowOutput] = useState(true);
  const [showActual, setShowActual] = useState(true);
  const history = useMemo(
    () => makeHistory(preview, sampleRate, settings.makeupTargetDb - settings.thresholdDb),
    [preview, sampleRate, settings.makeupTargetDb, settings.thresholdDb],
  );
  const width = 480;
  const height = 160;
  const padding = 28;
  const x = (index: number) => padding + index / (HISTORY_POINTS - 1) * (width - padding * 2);
  const y = (db: number) => padding + (-db / 12) * (height - padding * 2);
  const path = (key: keyof HistoryPoint) => history.map((point, index) => `${index === 0 ? 'M' : 'L'}${x(index).toFixed(2)},${y(point[key]).toFixed(2)}`).join(' ');
  return (
    <figure className="space-y-2 rounded-md border p-3" aria-label="Limiter 动态历史面板">
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <span className="font-medium">显示：</span>
        <label className="flex items-center gap-1"><input type="checkbox" checked={showInput} onChange={(event) => setShowInput(event.target.checked)} />输入</label>
        <label className="flex items-center gap-1"><input type="checkbox" checked={showOutput} onChange={(event) => setShowOutput(event.target.checked)} />输出</label>
        <label className="flex items-center gap-1"><input type="checkbox" checked={showActual} onChange={(event) => setShowActual(event.target.checked)} />压缩</label>
        <span className="ml-auto text-muted-foreground">选区预览 · 2 秒窗口</span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img" aria-label="Limiter 动态历史（2 秒，-12 dB 至 0 dB，3 dB 网格）">
        {[0, -3, -6, -9, -12].map((tick) => (
          <g key={`db-${tick}`}>
            <line x1={padding} x2={width - padding} y1={y(tick)} y2={y(tick)} className="stroke-muted" strokeWidth="1" />
            <text x={padding - 5} y={y(tick) + 3} textAnchor="end" className="fill-muted-foreground text-[10px]">{tick}</text>
          </g>
        ))}
        {[-2, -1.5, -1, -0.5, 0].map((tick, index) => (
          <g key={`time-${tick}`}>
            <line x1={x(index * (HISTORY_POINTS - 1) / 4)} x2={x(index * (HISTORY_POINTS - 1) / 4)} y1={padding} y2={height - padding} className="stroke-muted" strokeWidth="1" />
            <text x={x(index * (HISTORY_POINTS - 1) / 4)} y={height - 8} textAnchor="middle" className="fill-muted-foreground text-[10px]">{tick}s</text>
          </g>
        ))}
        {showInput && history.length > 0 && <path d={path('inputDb')} fill="none" className="stroke-muted-foreground" strokeWidth="1.5" />}
        {showOutput && history.length > 0 && <path d={path('outputDb')} fill="none" className="stroke-primary" strokeWidth="2" />}
        {showActual && history.length > 0 && <path d={path('compressionDb')} fill="none" className="stroke-destructive" strokeWidth="1.5" strokeDasharray="4 3" />}
        <text x={width / 2} y={14} textAnchor="middle" className="fill-muted-foreground text-[11px]">输入 / 输出 / 实际压缩（dB）</text>
      </svg>
      <figcaption className="text-xs text-muted-foreground">
        {history.length > 0 ? '输入、输出与实际压缩来自当前选区试听 PCM；无 clipping 指示（Limiter 输出受限）。' : '试听以填充当前选区的动态历史；显示范围为 −12…0 dB，3 dB 网格；无 clipping 指示。'}
      </figcaption>
    </figure>
  );
}

export default function LimiterDialog({
  open,
  onOpenChange,
  sampleRate,
  selectionStart,
  selectionEnd,
  hasSelection,
  isApplying,
  onPreview,
  onApply,
}: LimiterDialogProps) {
  const [drafts, setDrafts] = useState<Drafts>({ ...DEFAULT_DRAFTS });
  const [preview, setPreview] = useState<LimiterPreview | null>(null);
  const { isPreviewing, previewError, startPreview, stopPreview } = useGeneratorPreview();
  const settings = useMemo<LimiterSettings>(() => ({
    thresholdDb: Number(drafts.thresholdDb),
    makeupTargetDb: Number(drafts.makeupTargetDb),
    lookaheadMs: Number(drafts.lookaheadMs),
    kneeWidthDb: Number(drafts.kneeWidthDb),
    releaseMs: Number(drafts.releaseMs),
  }), [drafts]);

  const validationError = useMemo(() => {
    if (Object.values(drafts).some((value) => !value.trim())) return '请填写全部 Limiter 参数';
    try {
      validateLimiterSettings(settings);
      return '';
    } catch (error) {
      return error instanceof Error ? error.message : 'Limiter 参数无效';
    }
  }, [drafts, settings]);

  useEffect(() => {
    if (!open) {
      stopPreview();
      setPreview(null);
    }
  }, [open, stopPreview]);

  function changeOpen(nextOpen: boolean) {
    if (!nextOpen) {
      stopPreview();
      setPreview(null);
    }
    onOpenChange(nextOpen);
  }

  function changeDraft(field: NumericField, value: string) {
    stopPreview();
    setPreview(null);
    setDrafts((current) => ({ ...current, [field]: value }));
  }

  function reset() {
    setDrafts({ ...DEFAULT_DRAFTS });
    setPreview(null);
    stopPreview();
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (validationError || !hasSelection || isApplying) return;
    stopPreview();
    void onApply(settings);
  }

  function previewSelection() {
    if (validationError || !hasSelection || isApplying) return;
    void startPreview(async () => {
      const result = await onPreview(settings);
      setPreview(result);
      return result.channels;
    }, sampleRate);
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Limiter 限制器</DialogTitle>
          <DialogDescription>
            Audacity 4.0.2 动态范围处理器：无限压缩比、零 Attack、输出目标补偿，增强响度并尽量减少失真。
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            选区 {selectionStart.toFixed(3)}–{selectionEnd.toFixed(3)} 秒 · 采样率 {sampleRate} Hz
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <LimiterControl field="thresholdDb" value={drafts.thresholdDb} onChange={(value) => changeDraft('thresholdDb', value)} />
            <LimiterControl field="makeupTargetDb" value={drafts.makeupTargetDb} onChange={(value) => changeDraft('makeupTargetDb', value)} />
            <LimiterControl field="lookaheadMs" value={drafts.lookaheadMs} onChange={(value) => changeDraft('lookaheadMs', value)} />
            <LimiterControl field="kneeWidthDb" value={drafts.kneeWidthDb} onChange={(value) => changeDraft('kneeWidthDb', value)} />
            <LimiterControl field="releaseMs" value={drafts.releaseMs} onChange={(value) => changeDraft('releaseMs', value)} />
          </div>
          <DynamicsHistory preview={preview} settings={settings} sampleRate={sampleRate} />
          <TransferCurve settings={settings} valid={!validationError} />
          {validationError && <p role="alert" className="text-sm text-destructive">{validationError}</p>}
          {previewError && <p role="alert" className="text-sm text-destructive">{previewError}</p>}
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={reset}>恢复 Audacity 默认值</Button>
            <Button type="button" variant="secondary" disabled={!hasSelection || isApplying || Boolean(validationError)} onClick={isPreviewing ? stopPreview : previewSelection}>
              {isPreviewing ? '停止试听' : '试听'}
            </Button>
            <Button type="submit" disabled={!hasSelection || isApplying || Boolean(validationError)}>
              {isApplying ? '应用中…' : '应用'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
