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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formatTime } from '@/lib/audioUtils';
import type { PreviewChannels } from '@/lib/generatorPreview';
import {
  DEFAULT_AUTO_DUCK_SETTINGS,
  validateAutoDuckSettings,
  type AutoDuckSettings,
} from '@/lib/autoDuckEffect';
import { useGeneratorPreview } from './useGeneratorPreview';

interface AutoDuckTrackOption {
  id: string;
  name: string;
}

interface AutoDuckEffectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tracks: readonly AutoDuckTrackOption[];
  sampleRate: number;
  selectionStart: number;
  selectionEnd: number;
  isApplying: boolean;
  onPreview: (settings: AutoDuckSettings, controlTrackId: string) => Promise<PreviewChannels>;
  onApply: (settings: AutoDuckSettings, controlTrackId: string) => void | Promise<void>;
}

interface NumericFieldProps {
  id: string;
  label: string;
  value: string;
  min: number;
  max?: number;
  disabled: boolean;
  onChange: (value: string) => void;
}

function NumericField({ id, label, value, min, max, disabled, onChange }: NumericFieldProps) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        min={min}
        max={max}
        step="any"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        required
      />
    </div>
  );
}

export default function AutoDuckEffectDialog({
  open,
  onOpenChange,
  tracks,
  sampleRate,
  selectionStart,
  selectionEnd,
  isApplying,
  onPreview,
  onApply,
}: AutoDuckEffectDialogProps) {
  const [controlTrackId, setControlTrackId] = useState(tracks.at(-1)?.id ?? '');
  const [duckAmountDb, setDuckAmountDb] = useState(String(DEFAULT_AUTO_DUCK_SETTINGS.duckAmountDb));
  const [maximumPause, setMaximumPause] = useState(String(DEFAULT_AUTO_DUCK_SETTINGS.maximumPause));
  const [outerFadeDownLen, setOuterFadeDownLen] = useState(String(DEFAULT_AUTO_DUCK_SETTINGS.outerFadeDownLen));
  const [outerFadeUpLen, setOuterFadeUpLen] = useState(String(DEFAULT_AUTO_DUCK_SETTINGS.outerFadeUpLen));
  const [innerFadeDownLen, setInnerFadeDownLen] = useState(String(DEFAULT_AUTO_DUCK_SETTINGS.innerFadeDownLen));
  const [innerFadeUpLen, setInnerFadeUpLen] = useState(String(DEFAULT_AUTO_DUCK_SETTINGS.innerFadeUpLen));
  const [thresholdDb, setThresholdDb] = useState(String(DEFAULT_AUTO_DUCK_SETTINGS.thresholdDb));
  const { isPreviewing, previewError, startPreview, stopPreview } = useGeneratorPreview();
  const settings: AutoDuckSettings = {
    duckAmountDb: Number(duckAmountDb),
    maximumPause: Number(maximumPause),
    outerFadeDownLen: Number(outerFadeDownLen),
    outerFadeUpLen: Number(outerFadeUpLen),
    innerFadeDownLen: Number(innerFadeDownLen),
    innerFadeUpLen: Number(innerFadeUpLen),
    thresholdDb: Number(thresholdDb),
  };

  let validationError = '';
  try {
    validateAutoDuckSettings(settings);
    if (!Number.isFinite(sampleRate) || sampleRate <= 0) throw new RangeError('工程采样率无效');
    if (tracks.length < 2) throw new Error('Auto Duck 需要选区内至少两条含音频轨道');
    if (!tracks.some((track) => track.id === controlTrackId)) throw new Error('请选择控制轨');
  } catch (error) {
    validationError = error instanceof Error ? error.message : 'Auto Duck 参数无效';
  }

  useEffect(() => {
    if (!tracks.some((track) => track.id === controlTrackId)) {
      setControlTrackId(tracks.at(-1)?.id ?? '');
    }
  }, [controlTrackId, tracks]);

  useEffect(() => {
    if (!open) stopPreview();
  }, [open, stopPreview]);

  function changeOpen(nextOpen: boolean) {
    if (!nextOpen) stopPreview();
    onOpenChange(nextOpen);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (validationError || isApplying) return;
    stopPreview();
    void onApply(settings, controlTrackId);
  }

  function preview() {
    if (validationError || isApplying) return;
    void startPreview(() => onPreview(settings, controlTrackId), sampleRate);
  }

  const baseline = 45;
  const ducked = baseline - settings.duckAmountDb * 6;
  const points = [
    [10, baseline],
    [150 - settings.outerFadeDownLen * 40, baseline],
    [150 + settings.innerFadeDownLen * 40, ducked],
    [450 - settings.innerFadeUpLen * 40, ducked],
    [450 + settings.outerFadeUpLen * 40, baseline],
    [590, baseline],
  ].map(([x, y]) => `${x},${y}`).join(' ');

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Auto Duck</DialogTitle>
          <DialogDescription>
            当控制轨超过阈值时，按 Audacity 4.0.2 的 RMS 检测与指数淡变降低其他轨道音量。
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="auto-duck-control">控制轨（使用第一声道）</Label>
            <Select value={controlTrackId} onValueChange={setControlTrackId} disabled={isApplying}>
              <SelectTrigger id="auto-duck-control" aria-label="控制轨（使用第一声道）">
                <SelectValue placeholder="选择控制轨" />
              </SelectTrigger>
              <SelectContent>
                {tracks.map((track) => <SelectItem key={track.id} value={track.id}>{track.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="rounded-md border bg-muted/20 p-3">
            <svg
              viewBox="0 0 600 210"
              className="h-40 w-full"
              role="img"
              aria-label="Auto Duck 淡变曲线"
              data-testid="auto-duck-curve"
            >
              <line x1="150" y1="10" x2="150" y2="195" stroke="currentColor" strokeDasharray="4 4" opacity="0.35" />
              <line x1="450" y1="10" x2="450" y2="195" stroke="currentColor" strokeDasharray="4 4" opacity="0.35" />
              <polyline points={points} fill="none" stroke="currentColor" strokeWidth="3" />
              <text x="300" y={Math.min(205, ducked + 20)} textAnchor="middle" fill="currentColor" fontSize="12">
                {settings.duckAmountDb} dB
              </text>
            </svg>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <NumericField id="auto-duck-amount" label="Duck amount（dB）" value={duckAmountDb} min={-24} max={0} disabled={isApplying} onChange={setDuckAmountDb} />
            <NumericField id="auto-duck-pause" label="Maximum pause（秒）" value={maximumPause} min={0} disabled={isApplying} onChange={setMaximumPause} />
            <NumericField id="auto-duck-outer-down" label="Outer fade down（秒）" value={outerFadeDownLen} min={0} max={3} disabled={isApplying} onChange={setOuterFadeDownLen} />
            <NumericField id="auto-duck-outer-up" label="Outer fade up（秒）" value={outerFadeUpLen} min={0} max={3} disabled={isApplying} onChange={setOuterFadeUpLen} />
            <NumericField id="auto-duck-inner-down" label="Inner fade down（秒）" value={innerFadeDownLen} min={0} max={3} disabled={isApplying} onChange={setInnerFadeDownLen} />
            <NumericField id="auto-duck-inner-up" label="Inner fade up（秒）" value={innerFadeUpLen} min={0} max={3} disabled={isApplying} onChange={setInnerFadeUpLen} />
            <NumericField id="auto-duck-threshold" label="Threshold（dB）" value={thresholdDb} min={-100} max={0} disabled={isApplying} onChange={setThresholdDb} />
          </div>

          <div className="space-y-1 rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
            <p>选区：{formatTime(selectionStart)}–{formatTime(selectionEnd)}，共 {formatTime(selectionEnd - selectionStart)}</p>
            <p data-testid="auto-duck-plan">100 采样 RMS 窗；暂停不足 Maximum pause 时合并压降区域；控制轨不会被修改。</p>
            <p>试听使用第一条非控制轨的真实选区。应用不改变选区、片段时长或时间线几何。</p>
          </div>
          {validationError && <p role="alert" className="text-sm text-destructive">{validationError}</p>}
          {previewError && <p role="alert" className="text-sm text-destructive">试听失败：{previewError}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" aria-pressed={isPreviewing} disabled={isApplying || Boolean(validationError)} onClick={isPreviewing ? stopPreview : preview}>
              {isPreviewing ? '停止试听' : '试听'}
            </Button>
            <Button type="button" variant="secondary" onClick={() => changeOpen(false)}>取消</Button>
            <Button type="submit" disabled={isApplying || Boolean(validationError)}>
              {isApplying ? '正在应用…' : '应用 Auto Duck'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
