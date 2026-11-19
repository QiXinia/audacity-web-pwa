export const RECORDING_MONITORING_PREFERENCES_STORAGE_KEY = 'audacity-web:recording-monitoring-preferences:v1';

export interface RecordingMonitoringPreferences {
  showMicMetering: boolean;
  inputMonitoring: boolean;
}

/** Audacity 4 RecordConfiguration defaults: micMetering=true, inputMonitoring=false. */
export const DEFAULT_RECORDING_MONITORING_PREFERENCES: Readonly<RecordingMonitoringPreferences> = Object.freeze({
  showMicMetering: true,
  inputMonitoring: false,
});

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

export function loadRecordingMonitoringPreferences(storage?: StorageLike): RecordingMonitoringPreferences {
  try {
    const target = storage ?? (typeof window === 'undefined' ? undefined : window.localStorage);
    const raw = target?.getItem(RECORDING_MONITORING_PREFERENCES_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_RECORDING_MONITORING_PREFERENCES };
    const parsed = JSON.parse(raw) as Partial<RecordingMonitoringPreferences> | null;
    return {
      showMicMetering: typeof parsed?.showMicMetering === 'boolean'
        ? parsed.showMicMetering
        : DEFAULT_RECORDING_MONITORING_PREFERENCES.showMicMetering,
      inputMonitoring: typeof parsed?.inputMonitoring === 'boolean'
        ? parsed.inputMonitoring
        : DEFAULT_RECORDING_MONITORING_PREFERENCES.inputMonitoring,
    };
  } catch {
    return { ...DEFAULT_RECORDING_MONITORING_PREFERENCES };
  }
}

export function saveRecordingMonitoringPreferences(
  preferences: RecordingMonitoringPreferences,
  storage?: StorageLike,
): boolean {
  if (typeof preferences.showMicMetering !== 'boolean' || typeof preferences.inputMonitoring !== 'boolean') {
    return false;
  }
  try {
    const target = storage ?? (typeof window === 'undefined' ? undefined : window.localStorage);
    if (!target) return false;
    target.setItem(RECORDING_MONITORING_PREFERENCES_STORAGE_KEY, JSON.stringify({
      showMicMetering: preferences.showMicMetering,
      inputMonitoring: preferences.inputMonitoring,
    }));
    return true;
  } catch {
    return false;
  }
}
