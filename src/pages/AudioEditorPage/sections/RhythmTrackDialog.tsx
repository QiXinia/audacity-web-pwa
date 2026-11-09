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
  RHYTHM_DEFAULT_BARS,
  RHYTHM_DEFAULT_BEATS_PER_BAR,
  RHYTHM_DEFAULT_STRONG_MIDI,
  RHYTHM_DEFAULT_TEMPO,
  RHYTHM_DEFAULT_WEAK_MIDI,
  RHYTHM_MAX_MIDI,
  RHYTHM_MIN_MIDI,
  generateRhythmTrack,
  getRhythmTrackPlan,
  type RhythmClickType,
  type RhythmTrackPlan,
  type RhythmTrackRequest,
} from '@/lib/rhythmTrackGenerator';
import { useGeneratorPreview } from './useGeneratorPreview';

interface RhythmTrackDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sampleRate: number;
  cursorPosition: number;
  selectionActive?: boolean;
  replacementPosition?: number;
  replacementEnd?: number;
  isGenerating: boolean;
  onGenerate: (settings: RhythmTrackRequest) => void | Promise<void>;
}

const CLICK_OPTIONS: Array<{ value: RhythmClickType; label: string }> = [
  { value: 'metronome', label: 'Metronome Tick（节拍器）' },
  { value: 'pingShort', label: 'Ping (short)（短 ping）' },
  { value: 'pingLong', label: 'Ping (long)（长 ping）' },
  { value: 'cowbell', label: 'Cowbell（牛铃）' },
  { value: 'resonantNoise', label: 'Resonant Noise（共振噪声）' },
  { value: 'noiseClick', label: 'Noise Click（噪声咔哒）' },
  { value: 'dripShort', label: 'Drip (short)（短水滴）' },
  { value: 'dripLong', label: 'Drip (long)（长水滴）' },
];

export default function RhythmTrackDialog({
  open,
  onOpenChange,
  sampleRate,
  cursorPosition,
  selectionActive = false,
  replacementPosition,
  replacementEnd,
  isGenerating,
  onGenerate,
}: RhythmTrackDialogProps) {
  const [tempo, setTempo] = useState(String(RHYTHM_DEFAULT_TEMPO));
  const [beatsPerBar, setBeatsPerBar] = useState(String(RHYTHM_DEFAULT_BEATS_PER_BAR));
  const [swing, setSwing] = useState('0');
  const [bars, setBars] = useState(String(RHYTHM_DEFAULT_BARS));
  const [duration, setDuration] = useState('0');
  const [offset, setOffset] = useState('0');
  const [clickType, setClickType] = useState<RhythmClickType>('metronome');
  const [strongMidi, setStrongMidi] = useState(String(RHYTHM_DEFAULT_STRONG_MIDI));
  const [weakMidi, setWeakMidi] = useState(String(RHYTHM_DEFAULT_WEAK_MIDI));
  const { isPreviewing, previewError, startPreview, stopPreview } = useGeneratorPreview();

  useEffect(() => {
    if (!open) stopPreview();
  }, [open, stopPreview]);

  function settings(): RhythmTrackRequest {
    return {
      tempo: Number(tempo),
      beatsPerBar: Number(beatsPerBar),
      swing: Number(swing),
      bars: Number(bars),
      duration: Number(duration),
      offset: Number(offset),
      clickType,
      strongMidi: Number(strongMidi),
      weakMidi: Number(weakMidi),
      sampleRate,
    };
  }

  const numeric = settings();
  let validationError = '';
  if (!Number.isFinite(numeric.tempo) || numeric.tempo < 30 || numeric.tempo > 300) {
    validationError = '速度须为 30–300 BPM。';
  } else if (!Number.isInteger(numeric.beatsPerBar) || numeric.beatsPerBar < 1 || numeric.beatsPerBar > 20) {
    validationError = '每小节拍数须为 1–20 的整数。';
  } else if (!Number.isFinite(numeric.swing) || numeric.swing < -1 || numeric.swing > 1) {
    validationError = 'Swing 须为 -1–1。';
  } else if (!Number.isInteger(numeric.bars) || numeric.bars < 0 || numeric.bars > 1000) {
    validationError = '小节数须为 0–1000 的整数。';
  } else if (!Number.isFinite(numeric.duration) || numeric.duration < 0) {
    validationError = '节奏音轨时长不得小于 0。';
  } else if (!Number.isFinite(numeric.offset) || numeric.offset < 0) {
    validationError = '起始时间偏移不得小于 0。';
  } else if (!Number.isInteger(numeric.strongMidi) || numeric.strongMidi < RHYTHM_MIN_MIDI || numeric.strongMidi > RHYTHM_MAX_MIDI) {
    validationError = `强拍 MIDI 音高须为 ${RHYTHM_MIN_MIDI}–${RHYTHM_MAX_MIDI} 的整数。`;
  } else if (!Number.isInteger(numeric.weakMidi) || numeric.weakMidi < RHYTHM_MIN_MIDI || numeric.weakMidi > RHYTHM_MAX_MIDI) {
    validationError = `弱拍 MIDI 音高须为 ${RHYTHM_MIN_MIDI}–${RHYTHM_MAX_MIDI} 的整数。`;
  } else if (numeric.bars === 0 && numeric.duration <= 0) {
    validationError = '请将小节数或节奏音轨时长设为大于 0。';
  }

  let plan: RhythmTrackPlan | null = null;
  if (!validationError) {
    try {
      plan = getRhythmTrackPlan(numeric);
    } catch (error) {
      validationError = error instanceof Error && error.message.includes('memory limit')
        ? '生成规模超过浏览器内存限制，请减少小节数、时长或采样率。'
        : error instanceof Error ? error.message : '参数无效';
    }
  }

  function changeOpen(nextOpen: boolean) {
    if (!nextOpen) stopPreview();
    onOpenChange(nextOpen);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!plan) return;
    stopPreview();
    void onGenerate(numeric);
  }

  function preview() {
    if (!plan) return;
    const previewBars = Math.min(plan.barCount, 2);
    void startPreview(() => generateRhythmTrack({
      ...numeric,
      bars: previewBars,
      duration: 0,
      offset: 0,
    }).samples, sampleRate);
  }

  const selectionDescription = replacementPosition !== undefined && replacementEnd !== undefined
    ? `替换选区 ${formatTime(replacementPosition)}–${formatTime(replacementEnd)}`
    : `替换选区起点 ${formatTime(replacementPosition ?? cursorPosition)}`;

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>生成 Rhythm Track 节奏音轨</DialogTitle>
          <DialogDescription>
            对齐 Audacity Nyquist Rhythm Track，按速度、拍号和小节生成节拍。
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="rhythm-tempo">速度（BPM）</Label>
              <Input id="rhythm-tempo" type="number" min={30} max={300} step="any" value={tempo} onChange={(event) => setTempo(event.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rhythm-beats">每小节拍数</Label>
              <Input id="rhythm-beats" type="number" min={1} max={20} step={1} value={beatsPerBar} onChange={(event) => setBeatsPerBar(event.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rhythm-swing">Swing 幅度</Label>
              <Input id="rhythm-swing" type="number" min={-1} max={1} step="any" value={swing} onChange={(event) => setSwing(event.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rhythm-click-type">节拍声音</Label>
              <select
                id="rhythm-click-type"
                value={clickType}
                onChange={(event) => setClickType(event.target.value as RhythmClickType)}
                className="border-input bg-background ring-offset-background focus-visible:ring-ring flex h-9 w-full rounded-md border px-3 py-1 text-sm shadow-sm outline-none focus-visible:ring-1"
              >
                {CLICK_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="rhythm-bars">小节数</Label>
              <Input id="rhythm-bars" type="number" min={0} max={1000} step={1} value={bars} onChange={(event) => setBars(event.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rhythm-duration">节奏音轨时长（秒）</Label>
              <Input id="rhythm-duration" type="number" min={0} step="any" value={duration} onChange={(event) => setDuration(event.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rhythm-offset">起始时间偏移（秒）</Label>
              <Input id="rhythm-offset" type="number" min={0} step="any" value={offset} onChange={(event) => setOffset(event.target.value)} required />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="rhythm-strong-midi">强拍 MIDI</Label>
                <Input id="rhythm-strong-midi" type="number" min={RHYTHM_MIN_MIDI} max={RHYTHM_MAX_MIDI} step={1} value={strongMidi} onChange={(event) => setStrongMidi(event.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="rhythm-weak-midi">弱拍 MIDI</Label>
                <Input id="rhythm-weak-midi" type="number" min={RHYTHM_MIN_MIDI} max={RHYTHM_MAX_MIDI} step={1} value={weakMidi} onChange={(event) => setWeakMidi(event.target.value)} required />
              </div>
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            将小节数设为 0 可启用节奏音轨时长；不足一个完整小节时向上取整。试听最多 2 小节且不包含起始静音。
          </p>
          {plan && (
            <p className="text-xs text-muted-foreground" data-testid="rhythm-plan">
              预计 {plan.barCount} 小节、{plan.beats.length} 拍，输出 {formatTime(plan.duration)}（含起始静音）。
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            {selectionActive
              ? `采样率 ${sampleRate} Hz · ${selectionDescription} · 按实际生成时长替换并平移后续片段`
              : `采样率 ${sampleRate} Hz · 插入位置 ${formatTime(cursorPosition)}`}
          </p>
          {validationError && <p role="alert" className="text-xs text-destructive">{validationError}</p>}
          {previewError && <p role="alert" className="text-xs text-destructive">试听失败：{previewError}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" aria-pressed={isPreviewing} disabled={isGenerating || !plan} onClick={isPreviewing ? stopPreview : preview}>
              {isPreviewing ? '停止试听' : '试听'}
            </Button>
            <Button type="button" variant="secondary" onClick={() => changeOpen(false)}>取消</Button>
            <Button type="submit" disabled={isGenerating || !plan}>
              {isGenerating ? '正在生成…' : '生成 Rhythm Track'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
