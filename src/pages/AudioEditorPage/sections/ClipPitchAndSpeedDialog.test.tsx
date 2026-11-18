import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { IClip } from '@/types/project';
import { ClipPitchAndSpeedDialog } from './ClipPitchAndSpeedDialog';

const clip: IClip = {
  id: 'clip-a', audioBufferId: 'buffer-a', startTime: 0, offset: 0,
  duration: 3, originalDuration: 3, stretchRatio: 1.5,
  pitchCents: 125, optimizeForVoice: false,
  gain: 0, fadeIn: 0, fadeOut: 0, name: 'Voice',
};

describe('ClipPitchAndSpeedDialog', () => {
  it('loads official pitch/speed fields and applies normalized values', async () => {
    const apply = vi.fn().mockResolvedValue(undefined);
    const openChange = vi.fn();
    render(<ClipPitchAndSpeedDialog open onOpenChange={openChange} clip={clip} isPlaying={false} onApply={apply} />);

    expect(screen.getByRole('heading', { name: 'Pitch and speed' })).toBeInTheDocument();
    expect(screen.getByLabelText('Semitones')).toHaveValue(1);
    expect(screen.getByLabelText('Cents')).toHaveValue(25);
    expect(screen.getByRole('spinbutton', { name: 'Clip speed' })).toHaveValue(150);
    fireEvent.change(screen.getByLabelText('Semitones'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Cents'), { target: { value: '-10' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Clip speed' }), { target: { value: '150.12349' } });
    fireEvent.click(screen.getByLabelText(/Optimize for voice/));
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));

    await waitFor(() => expect(apply).toHaveBeenCalledWith({
      pitchCents: 190,
      speedPercentage: 150.123,
      optimizeForVoice: true,
    }));
    expect(openChange).toHaveBeenCalledWith(false);
  });

  it('disables Clip speed during playback but keeps pitch editable', async () => {
    const apply = vi.fn().mockResolvedValue(undefined);
    render(<ClipPitchAndSpeedDialog open onOpenChange={vi.fn()} clip={clip} isPlaying onApply={apply} />);
    expect(screen.getByRole('spinbutton', { name: 'Clip speed' })).toBeDisabled();
    expect(screen.getByLabelText('Semitones')).toBeEnabled();
    fireEvent.change(screen.getByLabelText('Semitones'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(apply).toHaveBeenCalledWith({
      pitchCents: 225,
      speedPercentage: 150,
      optimizeForVoice: false,
    }));
  });

  it('clamps official boundary inputs instead of producing invalid clip data', async () => {
    const apply = vi.fn().mockResolvedValue(undefined);
    render(<ClipPitchAndSpeedDialog open onOpenChange={vi.fn()} clip={clip} isPlaying={false} onApply={apply} />);
    fireEvent.change(screen.getByLabelText('Semitones'), { target: { value: '20' } });
    fireEvent.change(screen.getByLabelText('Cents'), { target: { value: '100' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Clip speed' }), { target: { value: '0.1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(apply).toHaveBeenCalledWith({
      pitchCents: 1200,
      speedPercentage: 1,
      optimizeForVoice: false,
    }));
  });
});
