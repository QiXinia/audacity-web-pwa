import { useEffect, useState, type KeyboardEvent } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  MAX_TEMPO,
  MAX_TIME_SIGNATURE_NUMERATOR,
  MIN_TEMPO,
  MIN_TIME_SIGNATURE_NUMERATOR,
  TIME_SIGNATURE_DENOMINATORS,
  validateTempo,
  validateTimeSignature,
  type TimeSignature,
} from '@/lib/musicalTiming';

interface PlaybackTimingControlsProps {
  tempo: number;
  timeSignature: TimeSignature;
  bpmDisabled: boolean;
  onTempoChange: (value: number) => void;
  onTimeSignatureChange: (numerator: number, denominator: number) => void;
}

function commitOnEnter(event: KeyboardEvent<HTMLInputElement>, commit: () => void) {
  if (event.key === 'Enter') {
    event.preventDefault();
    commit();
  }
}

export default function PlaybackTimingControls({
  tempo,
  timeSignature,
  bpmDisabled,
  onTempoChange,
  onTimeSignatureChange,
}: PlaybackTimingControlsProps) {
  const [tempoDraft, setTempoDraft] = useState(String(tempo));
  const [numeratorDraft, setNumeratorDraft] = useState(String(timeSignature.numerator));

  useEffect(() => setTempoDraft(String(tempo)), [tempo]);
  useEffect(() => setNumeratorDraft(String(timeSignature.numerator)), [timeSignature.numerator]);

  function commitTempoDraft() {
    const value = validateTempo(Number(tempoDraft));
    if (value === null || tempoDraft.trim() === '') {
      setTempoDraft(String(tempo));
      return;
    }
    setTempoDraft(String(value));
    if (value !== tempo) onTempoChange(value);
  }

  function stepTempo(delta: number) {
    const next = Math.min(MAX_TEMPO, Math.max(MIN_TEMPO, tempo + delta));
    setTempoDraft(String(next));
    if (next !== tempo) onTempoChange(next);
  }

  function commitNumeratorDraft() {
    const numerator = Number(numeratorDraft);
    const valid = validateTimeSignature(numerator, timeSignature.denominator);
    if (!valid || numeratorDraft.trim() === '') {
      setNumeratorDraft(String(timeSignature.numerator));
      return;
    }
    setNumeratorDraft(String(valid.numerator));
    if (valid.numerator !== timeSignature.numerator) {
      onTimeSignatureChange(valid.numerator, valid.denominator);
    }
  }

  return (
    <section
      aria-label="BPM 与拍号"
      data-testid="playback-timing-controls"
      data-tempo={tempo}
      data-time-signature={`${timeSignature.numerator}/${timeSignature.denominator}`}
      className="flex shrink-0 items-end gap-2 font-mono tabular-nums"
    >
      <label className="flex flex-col gap-0.5 text-[9px] uppercase tracking-wide text-[#aab0b6]">
        BPM
        <span className="flex items-center gap-0.5">
          <input
            aria-label="BPM"
            type="number"
            min={MIN_TEMPO}
            max={MAX_TEMPO}
            step="0.01"
            disabled={bpmDisabled}
            title="每分钟四分音符数，范围 1–999；播放时不可修改"
            className="au-time-field h-7 w-[70px] rounded-sm px-1.5 text-right text-[11px]"
            value={tempoDraft}
            onChange={(event) => setTempoDraft(event.target.value)}
            onBlur={commitTempoDraft}
            onKeyDown={(event) => commitOnEnter(event, commitTempoDraft)}
          />
          <span className="flex flex-col gap-0.5">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-3.5"
              aria-label="增加 BPM"
              title="增加 BPM"
              disabled={bpmDisabled || tempo >= MAX_TEMPO}
              onClick={() => stepTempo(1)}
            >
              <ChevronUp className="size-3" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-3.5"
              aria-label="减少 BPM"
              title="减少 BPM"
              disabled={bpmDisabled || tempo <= MIN_TEMPO}
              onClick={() => stepTempo(-1)}
            >
              <ChevronDown className="size-3" />
            </Button>
          </span>
        </span>
      </label>
      <label className="flex flex-col gap-0.5 text-[9px] uppercase tracking-wide text-[#aab0b6]">
        拍号
        <span className="flex h-7 items-center gap-1 rounded-sm au-time-field px-1.5 text-[11px]">
          <input
            aria-label="拍号分子"
            type="number"
            min={MIN_TIME_SIGNATURE_NUMERATOR}
            max={MAX_TIME_SIGNATURE_NUMERATOR}
            step="1"
            title="拍号分子，整数范围 1–128"
            className="w-10 bg-transparent text-right outline-none"
            value={numeratorDraft}
            onChange={(event) => setNumeratorDraft(event.target.value)}
            onBlur={commitNumeratorDraft}
            onKeyDown={(event) => commitOnEnter(event, commitNumeratorDraft)}
          />
          <span aria-hidden="true">/</span>
          <select
            aria-label="拍号分母"
            className="bg-transparent pr-1 outline-none"
            value={timeSignature.denominator}
            onChange={(event) => onTimeSignatureChange(timeSignature.numerator, Number(event.target.value))}
          >
            {TIME_SIGNATURE_DENOMINATORS.map((denominator) => (
              <option key={denominator} value={denominator}>{denominator}</option>
            ))}
          </select>
        </span>
      </label>
    </section>
  );
}
