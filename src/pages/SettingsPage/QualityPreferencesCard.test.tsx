import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { QualityPreferencesCard } from './QualityPreferencesCard';
import type { DitherType, HighQualitySampleRateConverter } from '@/types/project';

function renderCard(overrides: {
  value?: DitherType;
  onChange?: (value: DitherType) => void;
  converterValue?: HighQualitySampleRateConverter;
  onConverterChange?: (value: HighQualitySampleRateConverter) => void;
} = {}) {
  return render(
    <QualityPreferencesCard
      value={overrides.value ?? 'shaped'}
      onChange={overrides.onChange ?? vi.fn()}
      converterValue={overrides.converterValue ?? 'bestQuality'}
      onConverterChange={overrides.onConverterChange ?? vi.fn()}
    />,
  );
}

describe('QualityPreferencesCard', () => {
  it('shows official converter order and the Audacity Best Quality default', () => {
    renderCard();
    const converter = screen.getByTestId('sample-rate-converter') as HTMLSelectElement;
    expect(converter.value).toBe('bestQuality');
    expect(Array.from(converter.options).map((option) => [option.value, option.textContent])).toEqual([
      ['lowQuality', 'Low Quality (Fastest)'],
      ['mediumQuality', 'Medium Quality'],
      ['highQuality', 'High Quality'],
      ['bestQuality', 'Best Quality (Slowest)'],
    ]);
    expect(screen.getByTestId('high-quality-dither')).toHaveValue('shaped');
    expect(screen.getByRole('link', { name: /libsoxr 第三方许可/ })).toHaveAttribute(
      'href',
      expect.stringContaining('third-party/NOTICE.md'),
    );
  });

  it('propagates the selected libsoxr converter', () => {
    const onConverterChange = vi.fn();
    renderCard({ onConverterChange });
    fireEvent.change(screen.getByTestId('sample-rate-converter'), {
      target: { value: 'mediumQuality' },
    });
    expect(onConverterChange).toHaveBeenCalledWith('mediumQuality');
  });

  it('shows all four dither algorithms', () => {
    renderCard({ value: 'shaped' });
    expect(screen.getByTestId('high-quality-dither')).toHaveValue('shaped');
    expect(screen.getByRole('option', { name: 'None' })).toHaveValue('none');
    expect(screen.getByRole('option', { name: 'Rectangle' })).toHaveValue('rectangle');
    expect(screen.getByRole('option', { name: 'Triangle' })).toHaveValue('triangle');
    expect(screen.getByRole('option', { name: 'Shaped' })).toHaveValue('shaped');
  });

  it('propagates the selected dither algorithm', () => {
    const onChange = vi.fn();
    renderCard({ value: 'none', onChange });
    fireEvent.change(screen.getByTestId('high-quality-dither'), { target: { value: 'triangle' } });
    expect(onChange).toHaveBeenCalledWith('triangle');
  });
});
