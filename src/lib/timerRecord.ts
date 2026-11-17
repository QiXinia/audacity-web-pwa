export interface TimerRecordSchedule {
  startAt: number;
  endAt: number;
}

export interface TimerDurationParts {
  hours: number;
  minutes: number;
  seconds: number;
}

export type TimerRecordPhase = 'waiting' | 'recording';

type TimerHandle = ReturnType<typeof setTimeout>;
type SetTimer = (callback: () => void, delay: number) => TimerHandle;
type ClearTimer = (handle: TimerHandle) => void;

interface TimerRecordControllerOptions {
  onStart: () => void | Promise<void>;
  onStop: () => void | Promise<void>;
  onPhaseChange: (phase: TimerRecordPhase) => void;
  onComplete: () => void;
  onError: (error: unknown) => void;
  now?: () => number;
  setTimer?: SetTimer;
  clearTimer?: ClearTimer;
}

export interface TimerRecordController {
  start: (schedule: TimerRecordSchedule) => void;
  cancel: () => void;
}

// Browsers clamp larger delays. Long recordings are therefore armed in chunks.
export const MAX_TIMER_DELAY_MS = 2_147_483_647;

export function parseTimerDurationParts(parts: TimerDurationParts): number | null {
  const { hours, minutes, seconds } = parts;
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || !Number.isInteger(seconds)) return null;
  if (hours < 0 || minutes < 0 || minutes > 59 || seconds < 0 || seconds > 59) return null;
  const duration = hours * 3600 + minutes * 60 + seconds;
  return Number.isSafeInteger(duration) ? duration : null;
}

export function timerDurationToParts(durationSeconds: number): TimerDurationParts | null {
  if (!Number.isSafeInteger(durationSeconds) || durationSeconds < 0) return null;
  return {
    hours: Math.floor(durationSeconds / 3600),
    minutes: Math.floor((durationSeconds % 3600) / 60),
    seconds: durationSeconds % 60,
  };
}

export function timerDurationBetween(startAt: number, endAt: number): number | null {
  if (!Number.isFinite(startAt) || !Number.isFinite(endAt) || endAt <= startAt) return null;
  const duration = (endAt - startAt) / 1000;
  return Number.isSafeInteger(duration) ? duration : null;
}

export function createTimerRecordSchedule(
  startAt: number,
  durationSeconds: number,
  now = Date.now(),
): TimerRecordSchedule {
  if (!Number.isFinite(startAt) || !Number.isFinite(now)) {
    throw new RangeError('Timer Record 开始时间无效');
  }
  if (!Number.isSafeInteger(durationSeconds) || durationSeconds <= 0) {
    throw new RangeError('Duration is zero. Nothing will be recorded.');
  }
  const normalizedStart = Math.max(startAt, now);
  const endAt = normalizedStart + durationSeconds * 1000;
  if (!Number.isFinite(endAt) || !Number.isSafeInteger(Math.round(endAt))) {
    throw new RangeError('Timer Record 结束时间超出范围');
  }
  return { startAt: normalizedStart, endAt };
}

export function toDateTimeLocalValue(timestamp: number): string {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return '';
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function parseDateTimeLocalValue(value: string): number | null {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function createTimerRecordController({
  onStart,
  onStop,
  onPhaseChange,
  onComplete,
  onError,
  now = Date.now,
  setTimer = (callback, delay) => setTimeout(callback, delay),
  clearTimer = (handle) => clearTimeout(handle),
}: TimerRecordControllerOptions): TimerRecordController {
  let active = false;
  let cancelled = false;
  let started = false;
  let timer: TimerHandle | null = null;
  let wake: (() => void) | null = null;

  function clearArmedTimer() {
    if (timer !== null) clearTimer(timer);
    timer = null;
  }

  function cancel() {
    if (!active || cancelled) return;
    cancelled = true;
    clearArmedTimer();
    wake?.();
  }

  async function waitUntil(target: number): Promise<boolean> {
    return new Promise((resolve) => {
      const finish = (result: boolean) => {
        clearArmedTimer();
        wake = null;
        resolve(result);
      };
      wake = () => finish(false);
      const tick = () => {
        if (cancelled) {
          finish(false);
          return;
        }
        const remaining = target - now();
        if (remaining <= 0) {
          finish(true);
          return;
        }
        clearArmedTimer();
        timer = setTimer(tick, Math.min(remaining, MAX_TIMER_DELAY_MS));
      };
      tick();
    });
  }

  async function run(schedule: TimerRecordSchedule) {
    try {
      onPhaseChange('waiting');
      if (!await waitUntil(schedule.startAt)) return;

      onPhaseChange('recording');
      await onStart();
      started = true;

      // Cancellation while permission/startup is pending must still close a
      // microphone that became active after the cancellation request.
      if (cancelled) {
        await onStop();
        return;
      }
      if (!await waitUntil(schedule.endAt)) return;

      await onStop();
      if (!cancelled) onComplete();
    } catch (error) {
      if (!cancelled || started) onError(error);
    } finally {
      active = false;
      clearArmedTimer();
      wake = null;
    }
  }

  function start(schedule: TimerRecordSchedule) {
    if (active) throw new Error('Timer Record 已在运行');
    if (!Number.isFinite(schedule.startAt) || !Number.isFinite(schedule.endAt)
      || schedule.endAt <= schedule.startAt) {
      throw new RangeError('Timer Record 调度区间无效');
    }
    active = true;
    cancelled = false;
    started = false;
    void run(schedule);
  }

  return { start, cancel };
}
