import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Pause, Play, RotateCcw } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import {
  DEFAULT_CHANGE_SPEED_SETTINGS,
  MAX_CHANGE_SPEED_PERCENT,
  MIN_CHANGE_SPEED_PERCENT,
  durationAfterChangeSpeed,
  isChangeSpeedPercentValid,
  percentChangeFromMultiplier,
  percentChangeFromSpeedDuration,
  percentChangeFromSpeedSlider,
  percentChangeFromVinyl,
  sliderFromSpeedPercent,
  vinylTransitionFromPercent,
  type ChangeSpeedSettings,
  type VinylSpeed,
} from '@/lib/changeSpeedEffect';

interface ChangeSpeedDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectionDuration: number;
  hasSelection: boolean;
  sampleRate: number;
  applying: boolean;
  onPreview: (settings: ChangeSpeedSettings) => Promise<Float32Array[]>;
  onApply: (settings: ChangeSpeedSettings) => Promise<void>;
}

type VinylChoice = VinylSpeed | 'na';
type ParameterSource = 'percent' | 'multiplier' | 'length' | 'vinyl' | 'slider';

function formatPercent(value: number): string {
  return String(Number(value.toFixed(5)));
}

function formatMultiplier(percentChange: number): string {
  return String(Number((1 + percentChange / 100).toFixed(6)));
}

export function ChangeSpeedDialog({
  open,
  onOpenChange,
  selectionDuration,
  hasSelection,
  sampleRate,
  applying,
  onPreview,
  onApply,
}: ChangeSpeedDialogProps) {
  const [percentChange, setPercentChange] = useState(0);
  const [percentDraft, setPercentDraft] = useState('0');
  const [multiplierDraft, setMultiplierDraft] = useState('1');
  const [lengthDraft, setLengthDraft] = useState('0');
  const [fromVinyl, setFromVinyl] = useState<VinylChoice>('33.333333333333336');
  const [toVinyl, setToVinyl] = useState<VinylChoice>('33.333333333333336');
  const [editError, setEditError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const previewRequestRef = useRef(0);
  const openGenerationRef = useRef(0);

  const stopPreview = useCallback(() => {
    previewRequestRef.current += 1;
    const source = sourceRef.current;
    sourceRef.current = null;
    if (source) {
      source.onended = null;
      try { source.stop(); } catch { /* Already stopped. */ }
      source.disconnect();
    }
    const context = audioContextRef.current;
    audioContextRef.current = null;
    if (context && context.state !== 'closed') void context.close().catch(() => undefined);
    setPreviewing(false);
  }, []);

  useEffect(() => {
    if (!open) {
      openGenerationRef.current += 1;
      stopPreview();
      return;
    }
    openGenerationRef.current += 1;
    setPercentChange(0);
    setPercentDraft('0');
    setMultiplierDraft('1');
    setLengthDraft(String(Number(selectionDuration.toFixed(5))));
    setFromVinyl('33.333333333333336');
    setToVinyl('33.333333333333336');
    setEditError(null);
    setPreviewError(null);
  }, [open, selectionDuration, stopPreview]);

  useEffect(() => () => {
    openGenerationRef.current += 1;
    const source = sourceRef.current;
    sourceRef.current = null;
    if (source) {
      source.onended = null;
      try { source.stop(); } catch { /* Already stopped. */ }
      source.disconnect();
    }
    const context = audioContextRef.current;
    audioContextRef.current = null;
    if (context && context.state !== 'closed') void context.close().catch(() => undefined);
  }, []);

  function updatePercent(next: number, source: ParameterSource) {
    setPercentChange(next);
    if (source !== 'percent') setPercentDraft(formatPercent(next));
    if (!isChangeSpeedPercentValid(next)) {
      setEditError(`速度变化必须在 ${MIN_CHANGE_SPEED_PERCENT}% 至 ${MAX_CHANGE_SPEED_PERCENT}% 之间`);
      return;
    }
    setEditError(null);
    if (source !== 'multiplier') setMultiplierDraft(formatMultiplier(next));
    if (source !== 'length') {
      setLengthDraft(String(Number(durationAfterChangeSpeed(selectionDuration, {
        percentChange: next,
      }).toFixed(5))));
    }
    if (source !== 'vinyl') {
      const transition = vinylTransitionFromPercent(next);
      if (transition) {
        setFromVinyl(transition[0]);
        setToVinyl(transition[1]);
      } else if (Math.abs(next) < 0.005) {
        setToVinyl(fromVinyl);
      } else {
        setToVinyl('na');
      }
    }
  }

  function changePercentDraft(value: string) {
    setPercentDraft(value);
    const parsed = Number(value);
    if (value.trim() === '' || !Number.isFinite(parsed)) {
      setPercentChange(Number.NaN);
      setEditError('请输入有限的速度变化百分比');
      return;
    }
    updatePercent(parsed, 'percent');
  }

  function changeMultiplierDraft(value: string) {
    setMultiplierDraft(value);
    const parsed = Number(value);
    if (value.trim() === '' || !Number.isFinite(parsed) || parsed <= 0) {
      setEditError('速度倍率必须大于零');
      return;
    }
    updatePercent(percentChangeFromMultiplier(parsed), 'multiplier');
  }

  function changeLengthDraft(value: string) {
    setLengthDraft(value);
    const parsed = Number(value);
    if (value.trim() === '' || !Number.isFinite(parsed) || parsed <= 0) {
      setEditError('目标时长必须大于零');
      return;
    }
    updatePercent(percentChangeFromSpeedDuration(selectionDuration, parsed), 'length');
  }

  function changeVinyl(kind: 'from' | 'to', value: VinylChoice) {
    const nextFrom = kind === 'from' ? value : fromVinyl;
    const nextTo = kind === 'to' ? value : toVinyl;
    setFromVinyl(nextFrom);
    setToVinyl(nextTo);
    if (nextFrom === 'na' || nextTo === 'na') return;
    updatePercent(percentChangeFromVinyl(nextFrom, nextTo), 'vinyl');
  }

  async function handlePreview() {
    if (!hasSelection || !isChangeSpeedPercentValid(percentChange) || percentChange === 0) return;
    stopPreview();
    const request = ++previewRequestRef.current;
    const generation = openGenerationRef.current;
    setPreviewing(true);
    setPreviewError(null);
    try {
      const channels = await onPreview({ percentChange });
      if (request !== previewRequestRef.current || generation !== openGenerationRef.current) return;
      const frameLength = channels[0]?.length ?? 0;
      if (channels.length === 0 || frameLength < 1) throw new Error('试听没有可用音频');
      const AudioContextConstructor = window.AudioContext
        ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextConstructor) throw new Error('当前浏览器不支持 Web Audio 试听');
      const context = new AudioContextConstructor({ sampleRate });
      audioContextRef.current = context;
      const buffer = context.createBuffer(channels.length, frameLength, sampleRate);
      channels.forEach((channel, index) => buffer.getChannelData(index).set(channel));
      const source = context.createBufferSource();
      sourceRef.current = source;
      source.buffer = buffer;
      source.connect(context.destination);
      source.onended = () => {
        if (sourceRef.current !== source) return;
        source.disconnect();
        sourceRef.current = null;
        audioContextRef.current = null;
        void context.close().catch(() => undefined);
        setPreviewing(false);
      };
      source.start();
      await context.resume();
    } catch (error) {
      if (request !== previewRequestRef.current || generation !== openGenerationRef.current) return;
      setPreviewError(error instanceof Error ? error.message : '试听失败');
      stopPreview();
    }
  }

  const valid = isChangeSpeedPercentValid(percentChange);
  const invalidForPreview = !hasSelection || !valid || percentChange === 0 || applying || !!editError;
  const invalidForApply = invalidForPreview || previewing;

  return (
    <Dialog open={open} onOpenChange={(next) => {
      if (!next && (previewing || applying)) return;
      onOpenChange(next);
    }}>
      <DialogContent className="sm:max-w-lg" aria-label="Change Speed 效果对话框">
        <DialogHeader>
          <DialogTitle>Change Speed（速度及音高）</DialogTitle>
          <DialogDescription>
            按 Audacity 的恒速重采样同时改变速度与音高；范围 {MIN_CHANGE_SPEED_PERCENT}% 至 {MAX_CHANGE_SPEED_PERCENT}%，0% 不处理。
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="change-speed-multiplier">速度倍率</Label>
              <Input id="change-speed-multiplier" type="number" min="0.01" max="50" step="0.01"
                value={multiplierDraft} onChange={(event) => changeMultiplierDraft(event.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="change-speed-percent">变化百分比（%）</Label>
              <Input id="change-speed-percent" type="number" min={MIN_CHANGE_SPEED_PERCENT}
                max={MAX_CHANGE_SPEED_PERCENT} step="0.01" value={percentDraft}
                onChange={(event) => changePercentDraft(event.target.value)} />
            </div>
          </div>
          <div className="grid gap-2">
            <Label>变化百分比滑块</Label>
            <Slider aria-label="变化百分比滑块" min={MIN_CHANGE_SPEED_PERCENT} max={100} step={0.01}
              value={[valid ? sliderFromSpeedPercent(percentChange) : 0]}
              onValueChange={([value]) => updatePercent(percentChangeFromSpeedSlider(value), 'slider')} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="change-speed-from-vinyl">原始唱片转速</Label>
              <select id="change-speed-from-vinyl" aria-label="原始唱片转速" className="echo-input h-9 w-full"
                value={fromVinyl} onChange={(event) => changeVinyl('from', event.target.value as VinylChoice)}>
                <option value="33.333333333333336">33⅓ RPM</option>
                <option value="45">45 RPM</option>
                <option value="78">78 RPM</option>
              </select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="change-speed-to-vinyl">目标唱片转速</Label>
              <select id="change-speed-to-vinyl" aria-label="目标唱片转速" className="echo-input h-9 w-full"
                value={toVinyl} onChange={(event) => changeVinyl('to', event.target.value as VinylChoice)}>
                <option value="na">n/a</option>
                <option value="33.333333333333336">33⅓ RPM</option>
                <option value="45">45 RPM</option>
                <option value="78">78 RPM</option>
              </select>
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="change-speed-length">目标时长（秒）</Label>
            <Input id="change-speed-length" type="number" min="0.00001" step="0.01"
              value={lengthDraft} onChange={(event) => changeLengthDraft(event.target.value)} />
            <p className="text-xs text-muted-foreground">原选区 {selectionDuration.toFixed(5)} 秒；加速缩短时长并升高音高，减速反之。</p>
          </div>
          {!hasSelection && <p className="text-sm text-destructive">请先选择音频选区</p>}
          {editError && <p role="alert" className="text-sm text-destructive">{editError}</p>}
          {previewError && <p role="alert" className="text-sm text-destructive">试听失败：{previewError}</p>}
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          <Button type="button" variant="outline" onClick={() => updatePercent(
            DEFAULT_CHANGE_SPEED_SETTINGS.percentChange, 'slider',
          )}>
            <RotateCcw className="mr-2 h-4 w-4" />重置
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="outline" disabled={invalidForPreview} onClick={() => {
              if (previewing) stopPreview();
              else void handlePreview();
            }}>
              {previewing ? <Pause className="mr-2 h-4 w-4" /> : <Play className="mr-2 h-4 w-4" />}
              {previewing ? '停止试听' : '试听'}
            </Button>
            <Button type="button" disabled={invalidForApply} onClick={() => void onApply({ percentChange })}>
              {applying && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}应用效果
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
