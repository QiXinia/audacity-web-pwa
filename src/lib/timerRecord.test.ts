import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createTimerRecordController,
  createTimerRecordSchedule,
  defaultTimerRecordExportFilename,
  executeTimerRecordCompletion,
  loadTimerRecordAdvancedOptions,
  MAX_TIMER_DELAY_MS,
  normalizeTimerRecordExportFilename,
  parseTimerDurationParts,
  persistTimerRecordAdvancedOptions,
  timerDurationBetween,
  timerDurationToParts,
  type TimerRecordAdvancedOptions,
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
    expect(callbacks.onPhaseChange.mock.calls.map(([phase]) => phase)).toEqual([
      'waiting', 'recording', 'finalizing',
    ]);
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

  it('awaits completion actions and reports their failures', async () => {
    const callbacks = makeCallbacks();
    callbacks.onComplete.mockRejectedValue(new Error('export failed'));
    const controller = createTimerRecordController(callbacks);
    controller.start({ startAt: 0, endAt: 1_000 });

    await vi.advanceTimersByTimeAsync(1_000);
    expect(callbacks.onComplete).toHaveBeenCalledTimes(1);
    expect(callbacks.onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'export failed' }));
    expect(callbacks.onPhaseChange).toHaveBeenLastCalledWith('finalizing');
  });
});

function advancedOptions(
  overrides: Partial<TimerRecordAdvancedOptions> = {},
): TimerRecordAdvancedOptions {
  return {
    automaticSave: false,
    automaticExport: false,
    exportFilename: 'recording.wav',
    postAction: 'nothing',
    ...overrides,
  };
}

describe('Timer Record advanced preferences', () => {
  it('validates browser download filenames and derives a safe project default', () => {
    expect(normalizeTimerRecordExportFilename('take-1')).toBe('take-1.wav');
    expect(normalizeTimerRecordExportFilename('take-1.WAV')).toBe('take-1.WAV');
    expect(normalizeTimerRecordExportFilename('folder/take.wav')).toBeNull();
    expect(normalizeTimerRecordExportFilename('bad?.wav')).toBeNull();
    expect(normalizeTimerRecordExportFilename('bad\u0001.wav')).toBeNull();
    expect(normalizeTimerRecordExportFilename(' ')).toBeNull();
    expect(defaultTimerRecordExportFilename('My/Project')).toBe('My_Project.wav');
    expect(defaultTimerRecordExportFilename('My\u0001Project')).toBe('My_Project.wav');
    expect(defaultTimerRecordExportFilename(' ')).toBe('untitled.wav');
  });

  it('persists only supported options and recovers from corrupt storage', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
    };
    expect(persistTimerRecordAdvancedOptions(advancedOptions({
      automaticSave: true,
      automaticExport: true,
      postAction: 'close-project',
    }), storage)).toBe(true);
    expect(loadTimerRecordAdvancedOptions('My/Project', storage)).toEqual({
      automaticSave: true,
      automaticExport: true,
      exportFilename: 'My_Project.wav',
      postAction: 'close-project',
    });

    values.set('audacity.timerRecord.advanced.v1', '{broken');
    expect(loadTimerRecordAdvancedOptions('Fallback', storage)).toEqual(advancedOptions({
      exportFilename: 'Fallback.wav',
    }));
  });
});

describe('Timer Record completion actions', () => {
  it('runs save and export and permits closing only after both succeed', async () => {
    const actions = { saveProject: vi.fn(), exportWav: vi.fn() };
    const result = await executeTimerRecordCompletion(advancedOptions({
      automaticSave: true,
      automaticExport: true,
      postAction: 'close-project',
    }), actions);

    expect(actions.saveProject).toHaveBeenCalledTimes(1);
    expect(actions.exportWav).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      saveSucceeded: true,
      exportSucceeded: true,
      shouldCloseProject: true,
    });
  });

  it('still exports after a save failure but blocks the post action', async () => {
    const actions = {
      saveProject: vi.fn().mockRejectedValue(new Error('disk full')),
      exportWav: vi.fn().mockResolvedValue(undefined),
    };
    const result = await executeTimerRecordCompletion(advancedOptions({
      automaticSave: true,
      automaticExport: true,
      postAction: 'close-project',
    }), actions);

    expect(actions.exportWav).toHaveBeenCalledTimes(1);
    expect(result.saveSucceeded).toBe(false);
    expect(result.exportSucceeded).toBe(true);
    expect(result.shouldCloseProject).toBe(false);
    expect(result.saveError).toEqual(expect.objectContaining({ message: 'disk full' }));
  });

  it('blocks closing after an export failure and skips unrequested actions', async () => {
    const actions = {
      saveProject: vi.fn(),
      exportWav: vi.fn().mockRejectedValue(new Error('encoder failed')),
    };
    const failed = await executeTimerRecordCompletion(advancedOptions({
      automaticExport: true,
      postAction: 'close-project',
    }), actions);
    expect(failed.shouldCloseProject).toBe(false);
    expect(failed.exportSucceeded).toBe(false);
    expect(actions.saveProject).not.toHaveBeenCalled();

    const idle = await executeTimerRecordCompletion(advancedOptions({
      postAction: 'close-project',
    }), actions);
    expect(idle).toMatchObject({
      saveSucceeded: null,
      exportSucceeded: null,
      shouldCloseProject: false,
    });
  });
});
