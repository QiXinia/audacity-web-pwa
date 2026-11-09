import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import RhythmTrackDialog from './RhythmTrackDialog';

const mockGenerateRhythm = vi.hoisted(() => vi.fn(() => ({
  samples: new Float32Array([0, 0.75, -0.5, 0]),
})));
const mockStartPreview = vi.hoisted(() => vi.fn());
const mockStopPreview = vi.hoisted(() => vi.fn());
const previewState = vi.hoisted(() => ({ isPreviewing: false, previewError: null as string | null }));

vi.mock('@/lib/rhythmTrackGenerator', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/rhythmTrackGenerator')>()),
  generateRhythmTrack: mockGenerateRhythm,
}));
vi.mock('./useGeneratorPreview', () => ({
  useGeneratorPreview: () => ({
    isPreviewing: previewState.isPreviewing,
    previewError: previewState.previewError,
    startPreview: mockStartPreview,
    stopPreview: mockStopPreview,
  }),
}));

function renderDialog(overrides: Partial<Parameters<typeof RhythmTrackDialog>[0]> = {}) {
  const onGenerate = vi.fn().mockResolvedValue(undefined);
  const onOpenChange = vi.fn();
  render(
    <RhythmTrackDialog
      open
      onOpenChange={onOpenChange}
      sampleRate={1000}
      cursorPosition={0}
      isGenerating={false}
      onGenerate={onGenerate}
      {...overrides}
    />,
  );
  return { onGenerate, onOpenChange };
}

describe('RhythmTrackDialog', () => {
  beforeEach(() => {
    mockGenerateRhythm.mockClear();
    mockStartPreview.mockReset();
    mockStopPreview.mockClear();
    previewState.isPreviewing = false;
    previewState.previewError = null;
  });

  it('opens with the current official controls and all eight beat sounds', () => {
    renderDialog();
    expect(screen.getByLabelText('速度（BPM）')).toHaveValue(120);
    expect(screen.getByLabelText('每小节拍数')).toHaveValue(4);
    expect(screen.getByLabelText('Swing 幅度')).toHaveValue(0);
    expect(screen.getByLabelText('小节数')).toHaveValue(16);
    expect(screen.getByLabelText('节奏音轨时长（秒）')).toHaveValue(0);
    expect(screen.getByLabelText('起始时间偏移（秒）')).toHaveValue(0);
    expect(screen.getByLabelText('强拍 MIDI')).toHaveValue(84);
    expect(screen.getByLabelText('弱拍 MIDI')).toHaveValue(80);
    expect(screen.getByLabelText('节拍声音').querySelectorAll('option')).toHaveLength(8);
    expect(screen.getByTestId('rhythm-plan')).toHaveTextContent('预计 16 小节、64 拍');
  });

  it('submits tempo, swing, sound, pitches, bars, and offset', async () => {
    const { onGenerate } = renderDialog();
    fireEvent.change(screen.getByLabelText('速度（BPM）'), { target: { value: '90' } });
    fireEvent.change(screen.getByLabelText('每小节拍数'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('Swing 幅度'), { target: { value: '0.5' } });
    fireEvent.change(screen.getByLabelText('小节数'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('起始时间偏移（秒）'), { target: { value: '0.25' } });
    fireEvent.change(screen.getByLabelText('节拍声音'), { target: { value: 'pingLong' } });
    fireEvent.change(screen.getByLabelText('强拍 MIDI'), { target: { value: '90' } });
    fireEvent.change(screen.getByLabelText('弱拍 MIDI'), { target: { value: '72' } });
    fireEvent.click(screen.getByRole('button', { name: '生成 Rhythm Track' }));

    await waitFor(() => expect(onGenerate).toHaveBeenCalledWith({
      tempo: 90,
      beatsPerBar: 3,
      swing: 0.5,
      bars: 2,
      duration: 0,
      offset: 0.25,
      clickType: 'pingLong',
      strongMidi: 90,
      weakMidi: 72,
      sampleRate: 1000,
    }));
    expect(mockStopPreview).toHaveBeenCalled();
  });

  it('uses duration only when bars is zero and rounds up to a whole bar', () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText('小节数'), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText('节奏音轨时长（秒）'), { target: { value: '2.01' } });
    expect(screen.getByTestId('rhythm-plan')).toHaveTextContent('预计 2 小节、8 拍');
    expect(screen.getByTestId('rhythm-plan')).toHaveTextContent('00:04.000');
  });

  it('blocks the official zero-bar fallback until duration is positive', () => {
    const { onGenerate } = renderDialog();
    fireEvent.change(screen.getByLabelText('小节数'), { target: { value: '0' } });
    expect(screen.getByRole('alert')).toHaveTextContent('请将小节数或节奏音轨时长设为大于 0');
    expect(screen.getByRole('button', { name: '生成 Rhythm Track' })).toBeDisabled();
    expect(onGenerate).not.toHaveBeenCalled();
  });

  it('previews at most two bars and omits start offset without committing audio', async () => {
    const { onGenerate } = renderDialog();
    fireEvent.change(screen.getByLabelText('起始时间偏移（秒）'), { target: { value: '3' } });
    mockStartPreview.mockImplementation(async (createSamples: () => Float32Array) => {
      createSamples();
    });
    fireEvent.click(screen.getByRole('button', { name: '试听' }));
    await waitFor(() => expect(mockStartPreview).toHaveBeenCalledTimes(1));
    expect(mockGenerateRhythm).toHaveBeenCalledWith(expect.objectContaining({
      bars: 2,
      duration: 0,
      offset: 0,
      sampleRate: 1000,
    }));
    expect(mockStartPreview.mock.calls[0][1]).toBe(1000);
    expect(onGenerate).not.toHaveBeenCalled();
  });

  it('keeps generation duration editable for a selection and reports tail movement', () => {
    renderDialog({ selectionActive: true, replacementPosition: 0.25, replacementEnd: 2 });
    expect(screen.getByLabelText('小节数')).not.toHaveAttribute('readonly');
    expect(screen.getByLabelText('节奏音轨时长（秒）')).not.toHaveAttribute('readonly');
    expect(screen.getByText(/按实际生成时长替换并平移后续片段/)).toBeInTheDocument();
  });

  it('blocks out-of-range tempo before generation', () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText('速度（BPM）'), { target: { value: '301' } });
    expect(screen.getByRole('alert')).toHaveTextContent('速度须为 30–300 BPM');
    expect(screen.getByRole('button', { name: '生成 Rhythm Track' })).toBeDisabled();
  });

  it('blocks out-of-range MIDI pitches before generation', () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText('强拍 MIDI'), { target: { value: '117' } });
    expect(screen.getByRole('alert')).toHaveTextContent('强拍 MIDI 音高须为 18–116 的整数');
    expect(screen.getByRole('button', { name: '生成 Rhythm Track' })).toBeDisabled();
    expect(mockGenerateRhythm).not.toHaveBeenCalled();
  });
});
