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
import { formatTime } from '@/lib/audioUtils';
import {
  PLUCK_DEFAULT_MIDI,
  PLUCK_MAX_DURATION,
  PLUCK_MAX_MIDI,
  PLUCK_MIN_MIDI,
  generatePluck,
  isPluckMidiSupported,
  midiToHz,
  type PluckFade,
  type PluckRequest,
} from '@/lib/pluckGenerator';
import { formatGeneratorDuration } from '@/lib/generatorDuration';
import { useGeneratorPreview } from './useGeneratorPreview';

interface PluckGeneratorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sampleRate: number;
  cursorPosition: number;
  defaultDuration: number;
  selectionActive?: boolean;
  replacementPosition?: number;
  replacementEnd?: number;
  isGenerating: boolean;
  onGenerate: (settings: PluckRequest) => void | Promise<void>;
}

const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

function midiNoteName(midi: number): string {
  if (!Number.isInteger(midi) || midi < 0 || midi > 127) return '—';
  return `${NOTE_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
}

export default function PluckGeneratorDialog({
  open,
  onOpenChange,
  sampleRate,
  cursorPosition,
  defaultDuration,
  selectionActive = false,
  replacementPosition,
  replacementEnd,
  isGenerating,
  onGenerate,
}: PluckGeneratorDialogProps) {
  const [midi, setMidi] = useState(String(PLUCK_DEFAULT_MIDI));
  const [fade, setFade] = useState<PluckFade>('abrupt');
  const [duration, setDuration] = useState('1');
  const { isPreviewing, previewError, startPreview, stopPreview } = useGeneratorPreview();

  useEffect(() => {
    if (open && Number.isFinite(defaultDuration) && defaultDuration > 0) {
      setDuration(formatGeneratorDuration(defaultDuration));
    }
  }, [open, defaultDuration]);

  useEffect(() => {
    if (!open) stopPreview();
  }, [open, stopPreview]);

  const numericMidi = Number(midi);
  const numericDuration = Number(duration);
  const minimumDuration = 1 / sampleRate;
  const pitchSupported = isPluckMidiSupported(numericMidi, sampleRate);
  const durationSupported = Number.isFinite(numericDuration)
    && numericDuration >= minimumDuration
    && numericDuration <= PLUCK_MAX_DURATION;
  const canGenerate = pitchSupported && durationSupported;
  const validationError = !pitchSupported
    ? `当前采样率不支持该音高；MIDI 须为 ${PLUCK_MIN_MIDI}–${PLUCK_MAX_MIDI} 的整数，且频率低于采样率的 1/3。`
    : !durationSupported
      ? `时长须为 ${minimumDuration}–${PLUCK_MAX_DURATION} 秒。`
      : '';

  function changeOpen(nextOpen: boolean) {
    if (!nextOpen) stopPreview();
    onOpenChange(nextOpen);
  }

  function settings(): PluckRequest {
    return {
      midi: numericMidi,
      fade,
      duration: numericDuration,
      sampleRate,
    };
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!canGenerate) return;
    stopPreview();
    void onGenerate(settings());
  }

  function preview() {
    if (!canGenerate) return;
    void startPreview(() => generatePluck(settings()), sampleRate);
  }

  const selectionDescription = replacementPosition !== undefined && replacementEnd !== undefined
    ? `替换选区 ${formatTime(replacementPosition)}–${formatTime(replacementEnd)}`
    : `替换选区起点 ${formatTime(replacementPosition ?? cursorPosition)}`;

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>生成 Pluck 拨弦</DialogTitle>
          <DialogDescription>
            对齐 Audacity Nyquist Pluck，以物理建模延迟线生成拨弦音。
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="pluck-midi">MIDI 音高</Label>
              <Input
                id="pluck-midi"
                type="number"
                min={PLUCK_MIN_MIDI}
                max={PLUCK_MAX_MIDI}
                step={1}
                value={midi}
                onChange={(event) => setMidi(event.target.value)}
                required
              />
              <p className="text-xs text-muted-foreground">
                {midiNoteName(numericMidi)} · {midi !== '' && Number.isFinite(numericMidi) ? `${midiToHz(numericMidi).toFixed(2)} Hz` : '—'}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="pluck-fade">淡出类型</Label>
              <select
                id="pluck-fade"
                value={fade}
                onChange={(event) => setFade(event.target.value as PluckFade)}
                className="border-input bg-background ring-offset-background focus-visible:ring-ring flex h-9 w-full rounded-md border px-3 py-1 text-sm shadow-sm outline-none focus-visible:ring-1"
              >
                <option value="abrupt">Abrupt（快速）</option>
                <option value="gradual">Gradual（渐进）</option>
              </select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="pluck-duration">时长（秒）</Label>
            <Input
              id="pluck-duration"
              type="number"
              min={minimumDuration}
              max={PLUCK_MAX_DURATION}
              step="any"
              value={duration}
              onChange={(event) => setDuration(event.target.value)}
              required
            />
          </div>

          <p className="text-xs text-muted-foreground">
            {selectionActive
              ? `采样率 ${sampleRate} Hz · ${selectionDescription} · 按指定时长替换并平移后续片段`
              : `采样率 ${sampleRate} Hz · 插入位置 ${formatTime(cursorPosition)} · 默认 1 秒并独立记住上次时长 · 最长 ${PLUCK_MAX_DURATION} 秒`}
          </p>
          {validationError && <p role="alert" className="text-xs text-destructive">{validationError}</p>}
          {previewError && <p role="alert" className="text-xs text-destructive">试听失败：{previewError}</p>}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              aria-pressed={isPreviewing}
              disabled={isGenerating || !canGenerate}
              onClick={isPreviewing ? stopPreview : preview}
            >
              {isPreviewing ? '停止试听' : '试听'}
            </Button>
            <Button type="button" variant="secondary" onClick={() => changeOpen(false)}>取消</Button>
            <Button type="submit" disabled={isGenerating || !canGenerate}>
              {isGenerating ? '正在生成…' : '生成 Pluck'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
