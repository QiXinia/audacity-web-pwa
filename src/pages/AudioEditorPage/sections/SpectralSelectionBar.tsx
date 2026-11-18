import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  createFrequencySelectionFromBounds,
  createFrequencySelectionFromCenterBandwidth,
  getFrequencySelectionCenterHz,
  getFrequencySelectionLogBandwidth,
  getSpectrumDisplayMaxHz,
  type FrequencySelection,
} from '@/lib/spectralSelection';
import { getTrackSpectrogramSettings } from '@/lib/spectrogramSettings';
import type { ITrack } from '@/types/project';

type EditMode = 'center-width' | 'low-high';

interface SpectralSelectionBarProps {
  selection: FrequencySelection;
  sampleRate: number;
  track?: ITrack;
  onChange: (selection: FrequencySelection) => void;
}

function draftValue(value: number | null): string {
  return value === null ? '' : String(Number(value.toFixed(9)));
}

export default function SpectralSelectionBar({
  selection,
  sampleRate,
  track,
  onChange,
}: SpectralSelectionBarProps) {
  const [mode, setMode] = useState<EditMode>('center-width');
  const [firstText, setFirstText] = useState('');
  const [secondText, setSecondText] = useState('');
  const [error, setError] = useState('');
  const settings = getTrackSpectrogramSettings(track, sampleRate);
  const maxHz = getSpectrumDisplayMaxHz(sampleRate, settings);
  const centerHz = getFrequencySelectionCenterHz(selection);
  const logBandwidth = getFrequencySelectionLogBandwidth(selection);

  useEffect(() => {
    setError('');
    if (mode === 'center-width') {
      setFirstText(draftValue(centerHz));
      setSecondText(draftValue(logBandwidth));
    } else {
      setFirstText(draftValue(selection.lowHz));
      setSecondText(draftValue(selection.highHz));
    }
  }, [centerHz, logBandwidth, mode, selection.highHz, selection.lowHz]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const first = firstText.trim() === '' ? Number.NaN : Number(firstText);
    const second = secondText.trim() === '' ? Number.NaN : Number(secondText);
    const next = mode === 'center-width'
      ? createFrequencySelectionFromCenterBandwidth(first, second, sampleRate, settings)
      : createFrequencySelectionFromBounds(first, second, sampleRate, settings);
    if (!next) {
      setError(`请输入有效选区：${settings.minFreq} ≤ low < high ≤ ${maxHz} Hz；几何中心与对数带宽必须大于 0。`);
      return;
    }
    setError('');
    onChange(next);
  }

  const centerMode = mode === 'center-width';
  const firstLabel = centerMode ? '几何中心频率（Hz）' : '低频（Hz）';
  const secondLabel = centerMode ? '对数带宽 ln(high/low)' : '高频（Hz）';

  return (
    <section
      aria-label="频率选区工具栏"
      className="au-toolbar flex shrink-0 flex-wrap items-center gap-2 border-t px-3 py-1.5 text-[10px]"
      data-testid="spectral-selection-bar"
    >
      <div className="flex min-w-36 flex-col gap-0.5">
        <span className="font-semibold text-[#e4e5e7]">Spectral Selection</span>
        <span className="text-[#aab0b6]">Canvas 显示范围 {settings.minFreq}–{maxHz} Hz</span>
      </div>
      <Select value={mode} onValueChange={(value) => setMode(value as EditMode)}>
        <SelectTrigger aria-label="频率编辑模式" className="h-7 w-44 text-[10px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="center-width">几何中心与对数带宽</SelectItem>
          <SelectItem value="low-high">低频与高频</SelectItem>
        </SelectContent>
      </Select>
      <form className="flex flex-wrap items-end gap-2" onSubmit={submit} noValidate>
        <label className="flex flex-col gap-0.5 text-[9px] text-[#aab0b6]">
          {firstLabel}
          <Input
            aria-label={firstLabel}
            className="au-time-field h-7 w-36 rounded-sm px-2 font-mono text-[11px]"
            data-testid="spectral-selection-primary-input"
            inputMode="decimal"
            min={centerMode ? undefined : settings.minFreq}
            max={centerMode ? undefined : maxHz}
            step="any"
            type="number"
            value={firstText}
            onChange={(event) => setFirstText(event.target.value)}
          />
        </label>
        <label className="flex flex-col gap-0.5 text-[9px] text-[#aab0b6]">
          {secondLabel}
          <Input
            aria-label={secondLabel}
            className="au-time-field h-7 w-36 rounded-sm px-2 font-mono text-[11px]"
            data-testid="spectral-selection-secondary-input"
            inputMode="decimal"
            min={centerMode ? undefined : settings.minFreq}
            max={centerMode ? undefined : maxHz}
            step="any"
            type="number"
            value={secondText}
            onChange={(event) => setSecondText(event.target.value)}
          />
        </label>
        <Button type="submit" variant="secondary" size="sm" className="h-7 px-2 text-[10px]">
          应用频率边界
        </Button>
      </form>
      <span className="font-mono text-[#fff2a8]" data-testid="spectral-selection-bar-values">
        {selection.lowHz.toFixed(3)}–{selection.highHz.toFixed(3)} Hz
      </span>
      {error && <span role="alert" className="w-full text-destructive">{error}</span>}
    </section>
  );
}
