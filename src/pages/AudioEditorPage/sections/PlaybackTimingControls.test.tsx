// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import PlaybackTimingControls from '@/pages/AudioEditorPage/sections/PlaybackTimingControls';

afterEach(cleanup);

function renderControls(overrides: Partial<Parameters<typeof PlaybackTimingControls>[0]> = {}) {
  const props = {
    tempo: 120,
    timeSignature: { numerator: 4, denominator: 4 },
    bpmDisabled: false,
    onTempoChange: vi.fn(),
    onTimeSignatureChange: vi.fn(),
    ...overrides,
  };
  return { ...render(<PlaybackTimingControls {...props} />), props };
}

describe('PlaybackTimingControls', () => {
  it('exposes current values and official BPM arrow boundaries', () => {
    const view = renderControls();
    expect(view.getByTestId('playback-timing-controls').getAttribute('data-time-signature')).toBe('4/4');
    fireEvent.click(view.getByLabelText('增加 BPM'));
    expect(view.props.onTempoChange).toHaveBeenCalledWith(121);
    fireEvent.click(view.getByLabelText('减少 BPM'));
    expect(view.props.onTempoChange).toHaveBeenCalledWith(119);
    view.unmount();

    const minimum = renderControls({ tempo: 1 });
    expect((minimum.getByLabelText('减少 BPM') as HTMLButtonElement).disabled).toBe(true);
    minimum.unmount();
    const maximum = renderControls({ tempo: 999 });
    expect((maximum.getByLabelText('增加 BPM') as HTMLButtonElement).disabled).toBe(true);
  });

  it('commits a valid fractional BPM and restores an invalid draft without writing', () => {
    const view = renderControls();
    const input = view.getByLabelText('BPM') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '90.5' } });
    fireEvent.blur(input);
    expect(view.props.onTempoChange).toHaveBeenCalledWith(90.5);

    fireEvent.change(input, { target: { value: '1000' } });
    fireEvent.blur(input);
    expect(view.props.onTempoChange).toHaveBeenCalledTimes(1);
    expect(input.value).toBe('120');
  });

  it('disables BPM during playback without disabling the time-signature editor', () => {
    const view = renderControls({ bpmDisabled: true });
    expect((view.getByLabelText('BPM') as HTMLInputElement).disabled).toBe(true);
    expect((view.getByLabelText('增加 BPM') as HTMLButtonElement).disabled).toBe(true);
    expect((view.getByLabelText('拍号分子') as HTMLInputElement).disabled).toBe(false);
    expect((view.getByLabelText('拍号分母') as HTMLSelectElement).disabled).toBe(false);
  });

  it('writes valid time-signature numerator and denominator changes', () => {
    const view = renderControls();
    const numerator = view.getByLabelText('拍号分子') as HTMLInputElement;
    fireEvent.change(numerator, { target: { value: '6' } });
    fireEvent.keyDown(numerator, { key: 'Enter' });
    expect(view.props.onTimeSignatureChange).toHaveBeenCalledWith(6, 4);

    fireEvent.change(view.getByLabelText('拍号分母'), { target: { value: '8' } });
    expect(view.props.onTimeSignatureChange).toHaveBeenCalledWith(4, 8);
  });

  it('rejects invalid time-signature numerators and restores the project value', () => {
    const view = renderControls();
    const numerator = view.getByLabelText('拍号分子') as HTMLInputElement;
    for (const value of ['0', '129', '3.5', '']) {
      fireEvent.change(numerator, { target: { value } });
      fireEvent.blur(numerator);
      expect(numerator.value).toBe('4');
    }
    expect(view.props.onTimeSignatureChange).not.toHaveBeenCalled();
  });
});
