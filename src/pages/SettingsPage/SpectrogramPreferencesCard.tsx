import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  SPECTROGRAM_ALGORITHMS,
  SPECTROGRAM_COLOR_SCHEMES,
  SPECTROGRAM_SCALES,
  SPECTROGRAM_WINDOW_SIZES,
  SPECTROGRAM_WINDOW_TYPES,
  SPECTROGRAM_ZERO_PADDING_FACTORS,
  loadSpectrogramPreferences,
  normalizeSpectrogramSettings,
  saveSpectrogramPreferences,
} from '@/lib/spectrogramSettings';
import type { ISpectrogramPreferences } from '@/types/project';

const SCALE_LABELS = {
  linear: 'Linear', logarithmic: 'Logarithmic', mel: 'Mel', bark: 'Bark', erb: 'ERB', period: 'Period',
} as const;
const COLOR_LABELS = {
  roseus: 'Roseus', classic: 'Classic', grayscale: 'Grayscale', 'inverse-grayscale': 'Inverse grayscale',
} as const;
const ALGORITHM_LABELS = {
  frequencies: 'Frequencies', reassignment: 'Reassignment', pitch: 'Pitch (autocorrelation)',
} as const;
const WINDOW_LABELS = {
  rectangular: 'Rectangular', bartlett: 'Bartlett', hamming: 'Hamming', hann: 'Hann',
  blackman: 'Blackman', 'blackman-harris': 'Blackman-Harris', welch: 'Welch',
  gaussian25: 'Gaussian (a=2.5)', gaussian35: 'Gaussian (a=3.5)', gaussian45: 'Gaussian (a=4.5)',
} as const;

export function SpectrogramPreferencesCard() {
  const [draft, setDraft] = useState<ISpectrogramPreferences>(() => loadSpectrogramPreferences());
  const [status, setStatus] = useState<'idle' | 'saved' | 'error'>('idle');

  function update<K extends keyof ISpectrogramPreferences>(key: K, value: ISpectrogramPreferences[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    setStatus('idle');
  }

  function save() {
    const normalized: ISpectrogramPreferences = {
      ...normalizeSpectrogramSettings(draft, 48000),
      spectralSelectionEnabled: draft.spectralSelectionEnabled,
    };
    if (!saveSpectrogramPreferences(normalized)) {
      setStatus('error');
      return;
    }
    setDraft(normalized);
    setStatus('saved');
  }

  const selectClass = 'border-input bg-background h-9 w-full rounded-md border px-3 text-sm';
  return (
    <section aria-labelledby="spectrogram-preferences-heading" className="space-y-4">
      <h2 id="spectrogram-preferences-heading" className="text-xl font-semibold">Spectrogram</h2>
      <p className="text-sm text-muted-foreground">
        Audacity-compatible defaults for tracks using global spectrogram settings.
      </p>
      <Card>
        <CardContent className="space-y-5 p-5">
          <section aria-label="Spectral selection preferences">
            <h3 className="mb-3 text-sm font-semibold">Selection</h3>
            <label className="flex items-center gap-2 text-sm">
              <input
                data-testid="global-spectral-selection-enabled"
                type="checkbox"
                checked={draft.spectralSelectionEnabled}
                onChange={(event) => update('spectralSelectionEnabled', event.target.checked)}
              />
              Enable spectral selection
            </label>
          </section>

          <section aria-label="Spectrogram scale preferences" className="space-y-3">
            <h3 className="text-sm font-semibold">Scale</h3>
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="global-spectrogram-scale">Scale</Label>
                <select id="global-spectrogram-scale" data-testid="global-spectrogram-scale" className={selectClass}
                  value={draft.scale} onChange={(event) => update('scale', event.target.value as ISpectrogramPreferences['scale'])}>
                  {SPECTROGRAM_SCALES.map((scale) => <option key={scale} value={scale}>{SCALE_LABELS[scale]}</option>)}
                </select>
              </div>
              <div className="space-y-1.5"><Label htmlFor="global-min-frequency">Min frequency (Hz)</Label><Input id="global-min-frequency" data-testid="global-min-frequency" type="number" value={draft.minFreq} onChange={(event) => update('minFreq', Number(event.target.value))} /></div>
              <div className="space-y-1.5"><Label htmlFor="global-max-frequency">Max frequency (Hz)</Label><Input id="global-max-frequency" data-testid="global-max-frequency" type="number" value={draft.maxFreq} onChange={(event) => update('maxFreq', Number(event.target.value))} /></div>
            </div>
          </section>

          <section aria-label="Spectrogram color preferences" className="space-y-3">
            <h3 className="text-sm font-semibold">Colors</h3>
            <div className="grid gap-4 md:grid-cols-4">
              <div className="space-y-1.5"><Label htmlFor="global-spectrogram-gain">Gain (dB)</Label><Input id="global-spectrogram-gain" data-testid="global-spectrogram-gain" type="number" value={draft.gainDb} onChange={(event) => update('gainDb', Number(event.target.value))} /></div>
              <div className="space-y-1.5"><Label htmlFor="global-spectrogram-range">Range (dB)</Label><Input id="global-spectrogram-range" data-testid="global-spectrogram-range" type="number" min={1} value={draft.rangeDb} onChange={(event) => update('rangeDb', Number(event.target.value))} /></div>
              <div className="space-y-1.5"><Label htmlFor="global-spectrogram-boost">High boost (dB/dec)</Label><Input id="global-spectrogram-boost" data-testid="global-spectrogram-boost" type="number" min={0} max={60} value={draft.highBoostDbPerDec} onChange={(event) => update('highBoostDbPerDec', Number(event.target.value))} /></div>
              <div className="space-y-1.5">
                <Label htmlFor="global-spectrogram-colors">Scheme</Label>
                <select id="global-spectrogram-colors" data-testid="global-spectrogram-colors" className={selectClass}
                  value={draft.colorScheme} onChange={(event) => update('colorScheme', event.target.value as ISpectrogramPreferences['colorScheme'])}>
                  {SPECTROGRAM_COLOR_SCHEMES.map((scheme) => <option key={scheme} value={scheme}>{COLOR_LABELS[scheme]}</option>)}
                </select>
              </div>
            </div>
          </section>

          <section aria-label="Spectrogram algorithm preferences" className="space-y-3">
            <h3 className="text-sm font-semibold">Algorithm</h3>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="global-spectrogram-algorithm">Algorithm</Label>
                <select id="global-spectrogram-algorithm" data-testid="global-spectrogram-algorithm" className={selectClass}
                  value={draft.algorithm} onChange={(event) => update('algorithm', event.target.value as ISpectrogramPreferences['algorithm'])}>
                  {SPECTROGRAM_ALGORITHMS.map((algorithm) => <option key={algorithm} value={algorithm}>{ALGORITHM_LABELS[algorithm]}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="global-spectrogram-window-type">Window type</Label>
                <select id="global-spectrogram-window-type" data-testid="global-spectrogram-window-type" className={selectClass}
                  value={draft.windowType} onChange={(event) => update('windowType', event.target.value as ISpectrogramPreferences['windowType'])}>
                  {SPECTROGRAM_WINDOW_TYPES.map((type) => <option key={type} value={type}>{WINDOW_LABELS[type]}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="global-spectrogram-window-size">Window size</Label>
                <select id="global-spectrogram-window-size" data-testid="global-spectrogram-window-size" className={selectClass}
                  value={draft.windowSize} onChange={(event) => update('windowSize', Number(event.target.value))}>
                  {SPECTROGRAM_WINDOW_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="global-spectrogram-zero-padding">Zero padding factor</Label>
                <select id="global-spectrogram-zero-padding" data-testid="global-spectrogram-zero-padding" className={selectClass}
                  value={draft.zeroPaddingFactor} onChange={(event) => update('zeroPaddingFactor', Number(event.target.value))}>
                  {SPECTROGRAM_ZERO_PADDING_FACTORS.map((factor) => <option key={factor} value={factor}>{factor}</option>)}
                </select>
              </div>
            </div>
            {draft.algorithm === 'pitch' && <p className="text-xs text-muted-foreground">Pitch (autocorrelation) uses zero padding factor 1, as in Audacity.</p>}
          </section>

          <div className="flex items-center gap-3">
            <Button data-testid="save-spectrogram-preferences" type="button" onClick={save}>Save spectrogram preferences</Button>
            {status === 'saved' && <span role="status" className="text-sm text-green-700">Spectrogram preferences saved</span>}
            {status === 'error' && <span role="alert" className="text-sm text-destructive">Could not save spectrogram preferences</span>}
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
