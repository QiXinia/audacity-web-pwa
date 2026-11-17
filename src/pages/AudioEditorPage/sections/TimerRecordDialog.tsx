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
  createTimerRecordSchedule,
  parseDateTimeLocalValue,
  parseTimerDurationParts,
  timerDurationBetween,
  timerDurationToParts,
  toDateTimeLocalValue,
  type TimerRecordSchedule,
} from '@/lib/timerRecord';

interface TimerRecordDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSchedule: (schedule: TimerRecordSchedule) => void;
}

interface DurationText {
  hours: string;
  minutes: string;
  seconds: string;
}

function numericParts(parts: DurationText) {
  const parse = (value: string) => value.trim() === '' ? 0 : Number(value);
  return {
    hours: parse(parts.hours),
    minutes: parse(parts.minutes),
    seconds: parse(parts.seconds),
  };
}

function durationText(durationSeconds: number): DurationText {
  const parts = timerDurationToParts(durationSeconds) ?? { hours: 0, minutes: 0, seconds: 0 };
  return {
    hours: String(parts.hours),
    minutes: String(parts.minutes),
    seconds: String(parts.seconds),
  };
}

export default function TimerRecordDialog({
  open,
  onOpenChange,
  onSchedule,
}: TimerRecordDialogProps) {
  const [startText, setStartText] = useState('');
  const [endText, setEndText] = useState('');
  const [durationTextParts, setDurationTextParts] = useState<DurationText>({
    hours: '1', minutes: '0', seconds: '0',
  });

  useEffect(() => {
    if (!open) return;
    const startAt = Date.now();
    setStartText(toDateTimeLocalValue(startAt));
    setEndText(toDateTimeLocalValue(startAt + 3600_000));
    setDurationTextParts({ hours: '1', minutes: '0', seconds: '0' });
  }, [open]);

  const startAt = parseDateTimeLocalValue(startText);
  const endAt = parseDateTimeLocalValue(endText);
  const durationSeconds = parseTimerDurationParts(numericParts(durationTextParts));
  const validDuration = durationSeconds !== null && durationSeconds > 0;
  const validEnd = startAt !== null && endAt !== null && endAt > startAt;
  const valid = startAt !== null && validDuration && validEnd;

  function updateStart(value: string) {
    setStartText(value);
    const nextStart = parseDateTimeLocalValue(value);
    if (nextStart !== null && validDuration) {
      setEndText(toDateTimeLocalValue(nextStart + durationSeconds * 1000));
    }
  }

  function updateDuration(field: keyof DurationText, value: string) {
    const nextText = { ...durationTextParts, [field]: value };
    setDurationTextParts(nextText);
    const nextDuration = parseTimerDurationParts(numericParts(nextText));
    if (startAt !== null && nextDuration !== null && nextDuration > 0) {
      setEndText(toDateTimeLocalValue(startAt + nextDuration * 1000));
    }
  }

  function updateEnd(value: string) {
    setEndText(value);
    const nextEnd = parseDateTimeLocalValue(value);
    if (startAt === null || nextEnd === null) return;
    const nextDuration = timerDurationBetween(startAt, nextEnd);
    if (nextDuration !== null) setDurationTextParts(durationText(nextDuration));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid || startAt === null || durationSeconds === null) return;
    onSchedule(createTimerRecordSchedule(startAt, durationSeconds));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="timer-record-dialog" className="max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Timer Record… 定时录音…</DialogTitle>
          <DialogDescription>
            按 Audacity 的开始时间和时长自动录音；到点后使用当前录音设备，并把录音保存到当前工程。
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="timer-record-start">Start Date and Time 开始日期和时间</Label>
            <Input
              id="timer-record-start"
              type="datetime-local"
              step="1"
              value={startText}
              onChange={(event) => updateStart(event.target.value)}
              aria-invalid={startAt === null}
              autoFocus
            />
            {startAt !== null && startAt < Date.now() && (
              <p className="text-xs text-muted-foreground">开始时间已过去，提交后将立即开始录音。</p>
            )}
          </div>

          <div className="grid gap-2">
            <Label htmlFor="timer-record-end">End Date and Time 结束日期和时间</Label>
            <Input
              id="timer-record-end"
              type="datetime-local"
              step="1"
              value={endText}
              onChange={(event) => updateEnd(event.target.value)}
              aria-invalid={!validEnd}
            />
          </div>

          <fieldset>
            <legend className="mb-2 text-sm font-medium">Duration 录音时长（时 / 分 / 秒）</legend>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label htmlFor="timer-record-hours">Hours 小时</Label>
                <Input
                  id="timer-record-hours"
                  type="text"
                  inputMode="numeric"
                  value={durationTextParts.hours}
                  onChange={(event) => updateDuration('hours', event.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="timer-record-minutes">Minutes 分钟</Label>
                <Input
                  id="timer-record-minutes"
                  type="text"
                  inputMode="numeric"
                  value={durationTextParts.minutes}
                  onChange={(event) => updateDuration('minutes', event.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="timer-record-seconds">Seconds 秒</Label>
                <Input
                  id="timer-record-seconds"
                  type="text"
                  inputMode="numeric"
                  value={durationTextParts.seconds}
                  onChange={(event) => updateDuration('seconds', event.target.value)}
                />
              </div>
            </div>
          </fieldset>

          {!valid && (
            <p role="alert" className="text-sm text-destructive">
              {durationSeconds === 0
                ? 'Duration is zero. Nothing will be recorded. 时长为零，不会录音。'
                : '请输入有效的开始、结束时间和正整数秒时长；分钟和秒钟须为 0–59。'}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel 取消
            </Button>
            <Button type="submit" disabled={!valid}>
              Start Timer Recording 开始定时录音
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
