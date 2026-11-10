import { useEffect, useRef, useState } from 'react';
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
import { Slider } from '@/components/ui/slider';
import {
  DEFAULT_CHANGE_PITCH_SETTINGS,
  MAX_CHANGE_PITCH_PERCENT,
  MIN_CHANGE_PITCH_PERCENT,
  PITCH_NAMES,
  isChangePitchBypassed,
  isChangePitchPercentValid,
  nearestPitchFromFrequency,
  percentChangeFromFrequencies,
  percentChangeFromPitchSlider,
  percentChangeFromSemitones,
  pitchToFrequency,
  semitonesFromPercentChange,
  sliderFromPitchPercent,
  targetPitchFromSemitones,
  type ChangePitchSettings,
} from '@/lib/changePitchEffect';

interface ChangePitchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hasSelection: boolean;
  sampleRate: number;
  applying: boolean;
  onPreview: (settings: ChangePitchSettings) => Promise<Float32Array[]>;
  onApply: (settings: ChangePitchSettings) => Promise<void>;
}

const initialFromFrequency = pitchToFrequency(0, 4);

function rounded(value: number, digits: number): number {
  return Number(value.toFixed(digits));
}

function previewChannels(
  channels: Float32Array[],
  sampleRate: number,
  context: AudioContext,
): AudioBufferSourceNode {
  const length = Math.max(...channels.map((channel) => channel.length));
  const buffer = context.createBuffer(channels.length, length, sampleRate);
  channels.forEach((channel, index) => buffer.getChannelData(index).set(channel));
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.connect(context.destination);
  return source;
}

export function ChangePitchDialog({
  open,
  onOpenChange,
  hasSelection,
  sampleRate,
  applying,
  onPreview,
  onApply,
}: ChangePitchDialogProps) {
  const [percentChange, setPercentChange] = useState(DEFAULT_CHANGE_PITCH_SETTINGS.percentChange);
  const [percentDraft, setPercentDraft] = useState('0');
  const [semitonesDraft, setSemitonesDraft] = useState('0');
  const [fromFrequency, setFromFrequency] = useState(initialFromFrequency);
  const [fromFrequencyDraft, setFromFrequencyDraft] = useState(rounded(initialFromFrequency, 3).toString());
  const [toFrequencyDraft, setToFrequencyDraft] = useState(rounded(initialFromFrequency, 3).toString());
  const [fromPitch, setFromPitch] = useState(0);
  const [fromOctave, setFromOctave] = useState(4);
  const [toPitch, setToPitch] = useState(0);
  const [toOctave, setToOctave] = useState(4);
  const [editError, setEditError] = useState('');
  const [previewError, setPreviewError] = useState('');
  const [previewing, setPreviewing] = useState(false);
  const previewContextRef = useRef<AudioContext | null>(null);
  const previewSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const previewRunRef = useRef(0);
  const openRef = useRef(open);

  function stopPreview() {
    previewRunRef.current += 1;
    const source = previewSourceRef.current;
    previewSourceRef.current = null;
    if (source) {
      source.onended = null;
      try { source.stop(); } catch { /* Already stopped. */ }
      source.disconnect();
    }
    const context = previewContextRef.current;
    previewContextRef.current = null;
    if (context && context.state !== 'closed') void context.close().catch(() => undefined);
    setPreviewing(false);
  }

  useEffect(() => {
    openRef.current = open;
    if (!open) stopPreview();
  }, [open]);

  useEffect(() => () => {
    previewRunRef.current += 1;
    const source = previewSourceRef.current;
    if (source) {
      source.onended = null;
      try { source.stop(); } catch { /* Already stopped. */ }
      source.disconnect();
    }
    const context = previewContextRef.current;
    if (context && context.state !== 'closed') void context.close().catch(() => undefined);
  }, []);

  function applyLinkedPercent(
    nextPercent: number,
    nextFromFrequency = fromFrequency,
    nextFromPitch = fromPitch,
    nextFromOctave = fromOctave,
  ) {
    const semitones = semitonesFromPercentChange(nextPercent);
    const nextToFrequency = nextFromFrequency * (1 + nextPercent / 100);
    const nextToPitch = targetPitchFromSemitones(nextFromPitch, semitones);
    const nextToOctave = nearestPitchFromFrequency(nextToFrequency).octave;
    setPercentChange(nextPercent);
    setPercentDraft(rounded(nextPercent, 6).toString());
    setSemitonesDraft(rounded(semitones, 6).toString());
    setFromFrequency(nextFromFrequency);
    setFromFrequencyDraft(rounded(nextFromFrequency, 3).toString());
    setToFrequencyDraft(rounded(nextToFrequency, 3).toString());
    setFromPitch(nextFromPitch);
    setFromOctave(nextFromOctave);
    setToPitch(nextToPitch);
    setToOctave(nextToOctave);
    setEditError('');
    setPreviewError('');
  }

  function parseFinite(value: string, message: string): number | null {
    const parsed = Number(value);
    if (value.trim() === '' || !Number.isFinite(parsed)) {
      setEditError(message);
      return null;
    }
    return parsed;
  }

  function rejectDraft(setDraft: (value: string) => void, value: string, message: string) {
    setDraft(value);
    setPercentChange(Number.NaN);
    setEditError(message);
    setPreviewError('');
  }

  function updatePercent(value: string) {
    const parsed = parseFinite(value, '请输入有限的变化百分比');
    if (parsed === null || !isChangePitchPercentValid(parsed)) {
      rejectDraft(setPercentDraft, value, `请输入 ${MIN_CHANGE_PITCH_PERCENT}% 至 ${MAX_CHANGE_PITCH_PERCENT}% 之间的数值`);
      return;
    }
    applyLinkedPercent(parsed);
  }

  function updateSemitones(value: string) {
    const parsed = parseFinite(value, '请输入有限的半音变化');
    if (parsed === null) {
      rejectDraft(setSemitonesDraft, value, '请输入有限的半音变化');
      return;
    }
    const nextPercent = percentChangeFromSemitones(parsed);
    if (!isChangePitchPercentValid(nextPercent)) {
      rejectDraft(setSemitonesDraft, value, '半音变化对应百分比超出 -99% 至 3000%');
      return;
    }
    applyLinkedPercent(nextPercent);
  }

  function updateFromFrequency(value: string) {
    const parsed = parseFinite(value, '原始频率必须大于零');
    if (parsed === null || parsed <= 0) {
      rejectDraft(setFromFrequencyDraft, value, '原始频率必须大于零');
      return;
    }
    const nearest = nearestPitchFromFrequency(parsed);
    applyLinkedPercent(percentChange, parsed, nearest.pitch, nearest.octave);
  }

  function updateToFrequency(value: string) {
    const parsed = parseFinite(value, '目标频率必须大于零');
    if (parsed === null || parsed <= 0) {
      rejectDraft(setToFrequencyDraft, value, '目标频率必须大于零');
      return;
    }
    const nextPercent = percentChangeFromFrequencies(fromFrequency, parsed);
    if (!isChangePitchPercentValid(nextPercent)) {
      rejectDraft(setToFrequencyDraft, value, '目标频率对应百分比超出 -99% 至 3000%');
      return;
    }
    applyLinkedPercent(nextPercent);
  }

  function updateFromPitch(nextPitch: number) {
    applyLinkedPercent(percentChange, pitchToFrequency(nextPitch, fromOctave), nextPitch, fromOctave);
  }

  function updateFromOctave(nextOctave: number) {
    applyLinkedPercent(percentChange, pitchToFrequency(fromPitch, nextOctave), fromPitch, nextOctave);
  }

  function updateTargetPitch(nextPitch: number, nextOctave: number) {
    const semitones = (nextOctave - fromOctave) * 12 + nextPitch - fromPitch;
    const nextPercent = percentChangeFromSemitones(semitones);
    if (!isChangePitchPercentValid(nextPercent)) {
      setEditError('目标音高对应百分比超出 -99% 至 3000%');
      return;
    }
    applyLinkedPercent(nextPercent);
  }

  async function handlePreview() {
    if (!hasSelection || applying || previewing || isChangePitchBypassed({ percentChange })) return;
    stopPreview();
    const run = ++previewRunRef.current;
    setPreviewError('');
    setPreviewing(true);
    try {
      const channels = await onPreview({ percentChange });
      if (run !== previewRunRef.current || !openRef.current) return;
      const AudioContextConstructor = window.AudioContext
        ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextConstructor) throw new Error('当前浏览器不支持试听');
      const context = new AudioContextConstructor();
      const source = previewChannels(channels, sampleRate, context);
      previewContextRef.current = context;
      previewSourceRef.current = source;
      source.onended = () => {
        if (run !== previewRunRef.current) return;
        stopPreview();
      };
      await context.resume();
      if (run !== previewRunRef.current || !openRef.current) return;
      source.start();
    } catch (error) {
      if (run !== previewRunRef.current) return;
      setPreviewError(error instanceof Error ? `试听失败：${error.message}` : '试听失败');
      stopPreview();
    }
  }

  const settingsValid = isChangePitchPercentValid(percentChange);
  const disabledByNoOp = settingsValid && isChangePitchBypassed({ percentChange });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Change Pitch（保持时长）</DialogTitle>
          <DialogDescription>
            按半音、音名或频率改变音高，保持选区时长和片段边界不变。使用确定性重采样与 WSOLA 回退。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-5 py-2">
          <div className="space-y-2">
            <Label>音高</Label>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <div className="space-y-1">
                <Label htmlFor="change-pitch-from-note">原始音高</Label>
                <select id="change-pitch-from-note" aria-label="原始音高" className="border-input bg-background h-9 w-full rounded-md border px-2 text-sm" value={fromPitch} onChange={(event) => updateFromPitch(Number(event.target.value))}>
                  {PITCH_NAMES.map((name, index) => <option key={name} value={index}>{name}</option>)}
                </select>
              </div>
              <div className="space-y-1"><Label htmlFor="change-pitch-from-octave">原始八度</Label><Input id="change-pitch-from-octave" aria-label="原始八度" type="number" step={1} min={0} max={8} value={fromOctave} onChange={(event) => updateFromOctave(Number(event.target.value))} /></div>
              <div className="space-y-1">
                <Label htmlFor="change-pitch-to-note">目标音高</Label>
                <select id="change-pitch-to-note" aria-label="目标音高" className="border-input bg-background h-9 w-full rounded-md border px-2 text-sm" value={toPitch} onChange={(event) => updateTargetPitch(Number(event.target.value), toOctave)}>
                  {PITCH_NAMES.map((name, index) => <option key={name} value={index}>{name}</option>)}
                </select>
              </div>
              <div className="space-y-1"><Label htmlFor="change-pitch-to-octave">目标八度</Label><Input id="change-pitch-to-octave" aria-label="目标八度" type="number" step={1} min={0} max={8} value={toOctave} onChange={(event) => updateTargetPitch(toPitch, Number(event.target.value))} /></div>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="change-pitch-semitones">半音（半音阶）</Label>
            <Input id="change-pitch-semitones" aria-label="半音（半音阶）" type="number" step="0.01" value={semitonesDraft} onChange={(event) => updateSemitones(event.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2"><Label htmlFor="change-pitch-from-hz">原始频率（Hz）</Label><Input id="change-pitch-from-hz" aria-label="原始频率（Hz）" type="number" step="0.001" min="0.001" value={fromFrequencyDraft} onChange={(event) => updateFromFrequency(event.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="change-pitch-to-hz">目标频率（Hz）</Label><Input id="change-pitch-to-hz" aria-label="目标频率（Hz）" type="number" step="0.001" min="0.001" value={toFrequencyDraft} onChange={(event) => updateToFrequency(event.target.value)} /></div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="change-pitch-percent">变化百分比（%）</Label>
            <Input id="change-pitch-percent" aria-label="变化百分比（%）" type="number" step="0.001" min={MIN_CHANGE_PITCH_PERCENT} max={MAX_CHANGE_PITCH_PERCENT} value={percentDraft} onChange={(event) => updatePercent(event.target.value)} />
            <Slider aria-label="变化百分比滑块" min={MIN_CHANGE_PITCH_PERCENT} max={100} step={1} value={[settingsValid ? sliderFromPitchPercent(percentChange) : 0]} onValueChange={([value]) => applyLinkedPercent(percentChangeFromPitchSlider(value))} />
            <p className="text-muted-foreground text-xs">文本范围 -99% 至 3000%；滑块正半轴非线性映射至约 400%。</p>
          </div>
          <p className="text-muted-foreground text-xs">目标时长 = 原选区时长。0% 是官方 no-op；试听不修改工程。</p>
          {!hasSelection && <p role="alert" className="text-destructive text-sm">请先选择要处理的音频。</p>}
          {(editError || previewError) && <p role="alert" className="text-destructive text-sm">{editError || previewError}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => applyLinkedPercent(0)} disabled={applying || previewing}>重置</Button>
          <Button variant="outline" onClick={() => { if (previewing) stopPreview(); else void handlePreview(); }} disabled={!previewing && (!hasSelection || applying || !settingsValid || disabledByNoOp)}>{previewing ? '停止试听' : '试听'}</Button>
          <Button onClick={() => void onApply({ percentChange })} disabled={!hasSelection || applying || previewing || !settingsValid || disabledByNoOp}>{applying ? '应用中…' : '应用效果'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
