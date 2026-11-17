import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createTimerRecordController,
  createTimerRecordSchedule,
  MAX_TIMER_DELAY_MS,
  parseTimerDurationParts,
  timerDurationBetween,
  timerDurationToParts,
} from './timerRecord';

describe('Timer Record schedule', () => {
  it('normalizes a past start to now while preserving the selected duration', () => {
    expect(createTimerRecordSchedule(1_000, 3, 5_000)).toEqual({
      startAt: 5_000,
      endAt: 8_000,
    });
  });

  it('rejects zero, negative and fractional durations', () => {
    expect(() => createTimerRecordSchedule(1_000, 0, 1_000)).toThrow('Duration is zero');
    expect(() => createTimerRecordSchedule(1_000, -1, 1_000)).toThrow('Duration is zero');
    expect(() => createTimerRecordSchedule(1_000, 0.5, 1_000)).toThrow('Duration is zero');
  });

  it('validates duration fields and links start/end to whole seconds', () => {
    expect(parseTimerDurationParts({ hours: 1, minutes: 2, seconds: 3 })).toBe(3723);
    expect(parseTimerDurationParts({ hours: 0, minutes: 60, seconds: 0 })).toBeNull();
    expect(parseTimerDurationParts({ hours: 0, minutes: 0, seconds: 1.5 })).toBeNull();
    expect(timerDurationToParts(3723)).toEqual({ hours: 1, minutes: 2, seconds: 3 });
    expect(timerDurationBetween(1_000, 3_724_000)).toBe(3723);
    expect(timerDurationBetween(4_000, 4_000)).toBeNull();
  });
});

describe('Timer Record controller', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function makeCallbacks() {
    return {
      onStart: vi.fn().mockResolvedValue(undefined),
      onStop: vi.fn().mockResolvedValue(undefined),
      onPhaseChange: vi.fn(),
      onComplete: vi.fn(),
      onError: vi.fn(),
    };
  }

  it('starts at the scheduled time and stops exactly once at the end', async () => {
    const callbacks = makeCallbacks();
    const controller = createTimerRecordController(callbacks);
    controller.start({ startAt: 1_000, endAt: 3_000 });

    await vi.advanceTimersByTimeAsync(999);
    expect(callbacks.onStart).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(callbacks.onStart).toHaveBeenCalledTimes(1);
    expect(callbacks.onStop).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1_999);
    expect(callbacks.onStop).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(callbacks.onStop).toHaveBeenCalledTimes(1);
    expect(callbacks.onComplete).toHaveBeenCalledTimes(1);
    expect(callbacks.onPhaseChange.mock.calls.map(([phase]) => phase)).toEqual(['waiting', 'recording']);
  });

  it('chunks delays above the browser timer limit', async () => {
    const callbacks = makeCallbacks();
    const setTimer = vi.fn((callback: () => void, delay: number) => setTimeout(callback, delay));
    const controller = createTimerRecordController({ ...callbacks, setTimer });
    controller.start({ startAt: MAX_TIMER_DELAY_MS + 1_000, endAt: MAX_TIMER_DELAY_MS + 3_000 });

    expect(setTimer).toHaveBeenNthCalledWith(1, expect.any(Function), MAX_TIMER_DELAY_MS);
    await vi.advanceTimersByTimeAsync(MAX_TIMER_DELAY_MS);
    expect(setTimer).toHaveBeenNthCalledWith(2, expect.any(Function), 1_000);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(callbacks.onStart).toHaveBeenCalledTimes(1);
  });

  it('cancels a waiting recording without starting or stopping the microphone', async () => {
    const callbacks = makeCallbacks();
    const controller = createTimerRecordController(callbacks);
    controller.start({ startAt: 5_000, endAt: 6_000 });
    controller.cancel();

    await vi.advanceTimersByTimeAsync(10_000);
    expect(callbacks.onStart).not.toHaveBeenCalled();
    expect(callbacks.onStop).not.toHaveBeenCalled();
    expect(callbacks.onComplete).not.toHaveBeenCalled();
  });

  it('reports startup failure and does not arm an automatic stop', async () => {
    const callbacks = makeCallbacks();
    callbacks.onStart.mockRejectedValue(new Error('microphone denied'));
    const controller = createTimerRecordController(callbacks);
    controller.start({ startAt: 0, endAt: 1_000 });

    await vi.advanceTimersByTimeAsync(5_000);
    expect(callbacks.onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'microphone denied' }));
    expect(callbacks.onStop).not.toHaveBeenCalled();
    expect(callbacks.onComplete).not.toHaveBeenCalled();
  });

  it('cleans up when cancellation happens while microphone startup is pending', async () => {
    const callbacks = makeCallbacks();
    let resolveStart: (() => void) | undefined;
    callbacks.onStart.mockImplementation(() => new Promise<void>((resolve) => { resolveStart = resolve; }));
    const controller = createTimerRecordController(callbacks);
    controller.start({ startAt: 0, endAt: 1_000 });

    await vi.advanceTimersByTimeAsync(0);
    expect(callbacks.onStart).toHaveBeenCalledTimes(1);
    controller.cancel();
    resolveStart?.();
    await vi.advanceTimersByTimeAsync(0);

    expect(callbacks.onStop).toHaveBeenCalledTimes(1);
    expect(callbacks.onError).not.toHaveBeenCalled();
    expect(callbacks.onComplete).not.toHaveBeenCalled();
  });

  it('suppresses the scheduled second stop after a manual-stop cancellation', async () => {
    const callbacks = makeCallbacks();
    const controller = createTimerRecordController(callbacks);
    controller.start({ startAt: 0, endAt: 10_000 });
    await vi.advanceTimersByTimeAsync(0);
    controller.cancel();

    await vi.advanceTimersByTimeAsync(20_000);
    expect(callbacks.onStop).not.toHaveBeenCalled();
    expect(callbacks.onComplete).not.toHaveBeenCalled();
  });
});
