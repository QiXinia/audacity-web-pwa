import {
  DEFAULT_RECORDING_MONITORING_PREFERENCES,
  RECORDING_MONITORING_PREFERENCES_STORAGE_KEY,
  loadRecordingMonitoringPreferences,
  saveRecordingMonitoringPreferences,
} from './recordingMonitoringPreferences';

function makeStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
    values,
  };
}

describe('recording monitoring preferences', () => {
  it('uses the Audacity 4 defaults when storage is empty or unavailable', () => {
    expect(loadRecordingMonitoringPreferences(makeStorage())).toEqual({
      showMicMetering: true,
      inputMonitoring: false,
    });
    expect(loadRecordingMonitoringPreferences({
      getItem: () => { throw new Error('denied'); },
      setItem: vi.fn(),
    })).toEqual(DEFAULT_RECORDING_MONITORING_PREFERENCES);
  });

  it('restores valid explicit false values and normalizes malformed fields independently', () => {
    const storage = makeStorage({
      [RECORDING_MONITORING_PREFERENCES_STORAGE_KEY]: JSON.stringify({
        showMicMetering: false,
        inputMonitoring: true,
      }),
    });
    expect(loadRecordingMonitoringPreferences(storage)).toEqual({
      showMicMetering: false,
      inputMonitoring: true,
    });
    storage.values.set(RECORDING_MONITORING_PREFERENCES_STORAGE_KEY, JSON.stringify({
      showMicMetering: 'false',
      inputMonitoring: true,
    }));
    expect(loadRecordingMonitoringPreferences(storage)).toEqual({
      showMicMetering: true,
      inputMonitoring: true,
    });
  });

  it('falls back safely for invalid JSON', () => {
    const storage = makeStorage({ [RECORDING_MONITORING_PREFERENCES_STORAGE_KEY]: '{bad json' });
    expect(loadRecordingMonitoringPreferences(storage)).toEqual(DEFAULT_RECORDING_MONITORING_PREFERENCES);
  });

  it('persists both options and reports storage failures without throwing', () => {
    const storage = makeStorage();
    expect(saveRecordingMonitoringPreferences({ showMicMetering: false, inputMonitoring: true }, storage)).toBe(true);
    expect(loadRecordingMonitoringPreferences(storage)).toEqual({
      showMicMetering: false,
      inputMonitoring: true,
    });
    expect(saveRecordingMonitoringPreferences({ showMicMetering: true, inputMonitoring: false }, {
      getItem: vi.fn(),
      setItem: () => { throw new Error('quota'); },
    })).toBe(false);
  });
});
