import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SpectrogramPreferencesCard } from './SpectrogramPreferencesCard';
import {
  SPECTROGRAM_PREFERENCES_STORAGE_KEY,
  loadSpectrogramPreferences,
} from '@/lib/spectrogramSettings';

describe('SpectrogramPreferencesCard', () => {
  beforeEach(() => localStorage.clear());
  afterEach(cleanup);

  it('saves and restores the official Selection, Scale, Colors and Algorithm groups', () => {
    render(<SpectrogramPreferencesCard />);
    expect(screen.getByTestId('global-spectral-selection-enabled')).toBeChecked();
    expect(screen.getByTestId('global-spectrogram-algorithm')).toHaveValue('frequencies');
    expect(screen.getByTestId('global-spectrogram-window-type')).toHaveValue('hann');
    expect(screen.getByTestId('global-spectrogram-window-size')).toHaveValue('2048');
    expect(screen.getByTestId('global-spectrogram-zero-padding')).toHaveValue('2');

    fireEvent.click(screen.getByTestId('global-spectral-selection-enabled'));
    fireEvent.change(screen.getByTestId('global-spectrogram-scale'), { target: { value: 'logarithmic' } });
    fireEvent.change(screen.getByTestId('global-min-frequency'), { target: { value: '20' } });
    fireEvent.change(screen.getByTestId('global-max-frequency'), { target: { value: '18000' } });
    fireEvent.change(screen.getByTestId('global-spectrogram-gain'), { target: { value: '30' } });
    fireEvent.change(screen.getByTestId('global-spectrogram-range'), { target: { value: '70' } });
    fireEvent.change(screen.getByTestId('global-spectrogram-boost'), { target: { value: '8' } });
    fireEvent.change(screen.getByTestId('global-spectrogram-colors'), { target: { value: 'classic' } });
    fireEvent.change(screen.getByTestId('global-spectrogram-algorithm'), { target: { value: 'pitch' } });
    fireEvent.change(screen.getByTestId('global-spectrogram-window-type'), { target: { value: 'gaussian35' } });
    fireEvent.change(screen.getByTestId('global-spectrogram-window-size'), { target: { value: '4096' } });
    fireEvent.change(screen.getByTestId('global-spectrogram-zero-padding'), { target: { value: '8' } });
    fireEvent.click(screen.getByTestId('save-spectrogram-preferences'));

    expect(screen.getByRole('status')).toHaveTextContent('Spectrogram preferences saved');
    const stored = JSON.parse(localStorage.getItem(SPECTROGRAM_PREFERENCES_STORAGE_KEY)!) as Record<string, unknown>;
    expect(stored).toMatchObject({
      spectralSelectionEnabled: false,
      scale: 'logarithmic', minFreq: 20, maxFreq: 18000,
      gainDb: 30, rangeDb: 70, highBoostDbPerDec: 8, colorScheme: 'classic',
      algorithm: 'pitch', windowType: 'gaussian35', windowSize: 4096, zeroPaddingFactor: 8,
    });

    cleanup();
    render(<SpectrogramPreferencesCard />);
    expect(screen.getByTestId('global-spectral-selection-enabled')).not.toBeChecked();
    expect(screen.getByTestId('global-spectrogram-algorithm')).toHaveValue('pitch');
    expect(screen.getByTestId('global-spectrogram-window-type')).toHaveValue('gaussian35');
    expect(screen.getByTestId('global-spectrogram-window-size')).toHaveValue('4096');
    expect(screen.getByTestId('global-spectrogram-zero-padding')).toHaveValue('8');
    expect(loadSpectrogramPreferences().spectralSelectionEnabled).toBe(false);
  });
});
