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
  DEFAULT_COMPRESSOR_SETTINGS,
  evaluateCompressorTransferFunction,
  getMaxCompressorCompressionDb,
  validateCompressorSettings,
  type CompressorSettings,
} from '@/lib/compressorEffect';
import { useGeneratorPreview } from './useGeneratorPreview';

interface CompressorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sampleRate: number;
  selectionStart: number;
  selectionEnd: number;
  hasSelection: boolean;
  isApplying: boolean;
  onPreview: (settings: CompressorSettings) => Promise<Float32Array[]>;
  onApply: (settings: CompressorSettings) => void | Promise<void>;
}

type NumericField = keyof CompressorSettings;
type Drafts = Record<NumericField, string>;

const DEFAULT_DRAFTS: Drafts = {
  thresholdDb: String(DEFAULT_COMPRESSOR_SETTINGS.thresholdDb),
  makeupGainDb: String(DEFAULT_COMPRESSOR_SETTINGS.makeupGainDb),
  kneeWidthDb: String(DEFAULT_COMPRESSOR_SETTINGS.kneeWidthDb),
  compressionRatio: String(DEFAULT_COMPRESSOR_SETTINGS.compressionRatio),
  lookaheadMs: String(DEFAULT_COMPRESSOR_SETTINGS.lookaheadMs),
  attackMs: String(DEFAULT_COMPRESSOR_SETTINGS.attackMs),
  releaseMs: String(DEFAULT_COMPRESSOR_SETTINGS.releaseMs),
};

const CONTROLS: Record<NumericField, {
  label: string;
  unit: string;
  minimum: number;
  maximum: number;
  step: number;
}> = {
  thresholdDb: { label: '阈值', unit: 'dB', minimum: -60, maximum: 0, step: 0.1 },
  makeupGainDb: { label: '补偿增益', unit: 'dB', minimum: -30, maximum: 30, step: 0.1 },
  kneeWidthDb: { label: '拐点宽度', unit: 'dB', minimum: 0, maximum: 30, step: 0.1 },
  compressionRatio: { label: '压缩比', unit: ':1', minimum: 1, maximum: 100, step: 0.1 },
  lookaheadMs: { label: 'Look-ahead', unit: 'ms', minimum: 0, maximum: 100, step: 0.1 },
  attackMs: { label: 'Attack', unit: 'ms', minimum: 0, maximum: 200, step: 0.1 },
  releaseMs: { label: 'Release', unit: 'ms', minimum: 0, maximum: 1000, step: 1 },
};

interface CompressorControlProps {
  field: NumericField;
  value: string;
  onChange: (value: string) => void;
}

function CompressorControl({ field, value, onChange }: CompressorControlProps) {
  const control = CONTROLS[field];
  const id = `compressor-${field}`;
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

function CompressionCurve({ settings }: { settings: CompressorSettings }) {
  const width = 480;
  const height = 230;
  const padding = 28;
  const minimumDb = -60;
  const maximumDb = 30;
  const x = (inputDb: number) => padding + ((inputDb + 60) / 60) * (width - padding * 2);
  const y = (outputDb: number) => height - padding - ((outputDb - minimumDb) / (maximumDb - minimumDb)) * (height - padding * 2);
  const path = useMemo(() => {
    let value = '';
    for (let index = 0; index <= 120; index += 1) {
      const inputDb = -60 + index * 0.5;
      const outputDb = Math.max(minimumDb, Math.min(maximumDb, evaluateCompressorTransferFunction(settings, inputDb)));
      value += `${index === 0 ? 'M' : 'L'}${x(inputDb).toFixed(2)},${y(outputDb).toFixed(2)} `;
    }
    return value.trim();
  }, [settings]);
  const maximumCompression = getMaxCompressorCompressionDb(settings);

  return (
    <figure className="space-y-2 rounded-md border p-3" aria-label="压缩特性">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img" aria-label="压缩传递曲线">
        {[-60, -40, -20, 0].map((tick) => (
          <g key={`x-${tick}`}>
            <line x1={x(tick)} x2={x(tick)} y1={padding} y2={height - padding} className="stroke-muted" strokeWidth="1" />
            <text x={x(tick)} y={height - 8} textAnchor="middle" className="fill-muted-foreground text-[10px]">{tick}</text>
          </g>
        ))}
        {[-60, -40, -20, 0, 20].map((tick) => (
          <g key={`y-${tick}`}>
            <line x1={padding} x2={width - padding} y1={y(tick)} y2={y(tick)} className="stroke-muted" strokeWidth="1" />
            <text x={padding - 5} y={y(tick) + 3} textAnchor="end" className="fill-muted-foreground text-[10px]">{tick}</text>
          </g>
        ))}
        <line x1={x(-60)} x2={x(0)} y1={y(-60)} y2={y(0)} className="stroke-muted-foreground" strokeDasharray="4 4" strokeWidth="1" />
        <path d={path} fill="none" className="stroke-primary" strokeWidth="2.5" strokeLinejoin="round" />
        <text x={width / 2} y={14} textAnchor="middle" className="fill-muted-foreground text-[11px]">输入（dB）→ 输出（dB）</text>
      </svg>
      <figcaption className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
        <span>0 dB 输入时最大压缩：{maximumCompression.toFixed(2)} dB</span>
        <span>立体声共享侧链 · 离线延迟补偿</span>
      </figcaption>
    </figure>
  );
}

export default function CompressorDialog({
  open,
  onOpenChange,
  sampleRate,
  selectionStart,
  selectionEnd,
  hasSelection,
  isApplying,
  onPreview,
  onApply,
}: CompressorDialogProps) {
  const [drafts, setDrafts] = useState<Drafts>({ ...DEFAULT_DRAFTS });
  const { isPreviewing, previewError, startPreview, stopPreview } = useGeneratorPreview();
  const settings = useMemo<CompressorSettings>(() => ({
    thresholdDb: Number(drafts.thresholdDb),
    makeupGainDb: Number(drafts.makeupGainDb),
    kneeWidthDb: Number(drafts.kneeWidthDb),
    compressionRatio: Number(drafts.compressionRatio),
    lookaheadMs: Number(drafts.lookaheadMs),
    attackMs: Number(drafts.attackMs),
    releaseMs: Number(drafts.releaseMs),
  }), [drafts]);

  const validationError = useMemo(() => {
    if (Object.values(drafts).some((value) => !value.trim())) return '请填写全部 Compressor 参数';
    try {
      validateCompressorSettings(settings);
      return '';
    } catch (error) {
      return error instanceof Error ? error.message : 'Compressor 参数无效';
    }
  }, [drafts, settings]);

  useEffect(() => {
    if (!open) stopPreview();
  }, [open, stopPreview]);

  function changeOpen(nextOpen: boolean) {
    if (!nextOpen) stopPreview();
    onOpenChange(nextOpen);
  }

  function changeDraft(field: NumericField, value: string) {
    stopPreview();
    setDrafts((current) => ({ ...current, [field]: value }));
  }

  function reset() {
    setDrafts({ ...DEFAULT_DRAFTS });
    stopPreview();
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (validationError || !hasSelection || isApplying) return;
    stopPreview();
    void onApply(settings);
  }

  function preview() {
    if (validationError || !hasSelection || isApplying) return;
    void startPreview(() => onPreview(settings), sampleRate);
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Compressor 压缩器</DialogTitle>
          <DialogDescription>
            按 Audacity 4 的动态范围处理器压缩选区，支持软/硬拐点、动态平滑与 look-ahead。
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <fieldset className="grid gap-4 rounded-md border p-4 lg:grid-cols-2" disabled={isApplying}>
            <legend className="px-1 text-sm font-medium">Compressor 参数</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              {(['attackMs', 'releaseMs', 'lookaheadMs', 'thresholdDb', 'compressionRatio', 'kneeWidthDb', 'makeupGainDb'] as NumericField[]).map((field) => (
                <CompressorControl key={field} field={field} value={drafts[field]} onChange={(value) => changeDraft(field, value)} />
              ))}
            </div>
            {!validationError ? <CompressionCurve settings={settings} /> : (
              <div className="flex min-h-48 items-center justify-center rounded-md border text-sm text-muted-foreground">
                修正参数后显示压缩传递曲线
              </div>
            )}
          </fieldset>
          <p className="text-sm text-muted-foreground">
            试听范围：{selectionStart.toFixed(3)}–{selectionEnd.toFixed(3)} 秒；输出保持原选区时长与时间位置。
          </p>
          {!hasSelection && <p className="text-sm text-destructive">请先在含音频的轨道上建立选区。</p>}
          {(validationError || previewError) && (
            <p className="text-sm text-destructive" role="alert">{validationError || previewError}</p>
          )}
          <DialogFooter className="gap-2 sm:justify-between">
            <Button type="button" variant="outline" onClick={reset} disabled={isApplying}>恢复 Audacity 默认值</Button>
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => changeOpen(false)} disabled={isApplying}>取消</Button>
              <Button type="button" variant="outline" onClick={preview} disabled={!hasSelection || Boolean(validationError) || isApplying}>
                {isPreviewing ? '试听中…' : '试听'}
              </Button>
              <Button type="submit" disabled={!hasSelection || Boolean(validationError) || isApplying}>
                {isApplying ? '应用中…' : '应用'}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
