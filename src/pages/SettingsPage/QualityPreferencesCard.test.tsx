import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QualityPreferencesCard } from './QualityPreferencesCard';

describe('QualityPreferencesCard', () => {
  afterEach(cleanup);

  it('exposes the four official algorithms and reports the persisted selection', () => {
    const onChange = vi.fn();
    const { rerender } = render(<QualityPreferencesCard value="shaped" onChange={onChange} />);
    const select = screen.getByTestId('high-quality-dither');
    expect(select).toHaveValue('shaped');
    expect(Array.from((select as HTMLSelectElement).options, (option) => option.value)).toEqual([
      'none', 'rectangle', 'triangle', 'shaped',
    ]);
    expect(screen.getByTestId('quality-preferences-card')).toHaveTextContent('High-quality Conversion');

    fireEvent.change(select, { target: { value: 'triangle' } });
    expect(onChange).toHaveBeenCalledWith('triangle');
    rerender(<QualityPreferencesCard value="none" onChange={onChange} />);
    expect(screen.getByTestId('high-quality-dither')).toHaveValue('none');
  });
});
