// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IClip, ITrack } from '@/types/project';
import { ClipPropertiesDialog } from './ClipPropertiesDialog';

const mocks = vi.hoisted(() => ({ loadMetadata: vi.fn() }));

vi.mock('@/services/projectService', () => ({
  projectService: { loadAudioBufferMetadata: mocks.loadMetadata },
}));
vi.mock('@/wasm/processor', () => ({
  isWasmAvailable: vi.fn(() => false),
  wasmProcessor: { spectrogram: vi.fn((_data: Float32Array, windowSize: number) => new Float32Array(windowSize / 2 + 1)) },
}));

const clip: IClip = {
  id: 'clip-a', audioBufferId: 'buffer-a', startTime: 1.25, offset: 0.5,
  duration: 2, originalDuration: 8, stretchRatio: 1.5, pitchCents: 125,
  optimizeForVoice: true, gain: -3, fadeIn: 0.1, fadeOut: 0.2,
  name: 'Voice take', colorIndex: 2, stretchToMatchTempo: true,
  clipTempo: 120, rawAudioTempo: 90,
};

const track: ITrack = {
  id: 'track-a', name: 'Narration', type: 'audio', gain: 0, pan: 0,
  muted: false, solo: false, armed: false, color: '#7aa2f7', clips: [clip], effects: [],
};

function renderDialog(overrides: Partial<IClip> = {}) {
  const onOpenChange = vi.fn();
  const currentClip = { ...clip, ...overrides };
  render(<ClipPropertiesDialog open onOpenChange={onOpenChange} clip={currentClip} track={{ ...track, clips: [currentClip] }} />);
  return onOpenChange;
}

describe('ClipPropertiesDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadMetadata.mockResolvedValue({
      id: 'buffer-a', sampleRate: 48000, channels: 2, length: 384000, duration: 8,
    });
  });

  afterEach(() => cleanup());

  it('shows the actual source metadata and stretched source window without editing', async () => {
    const onOpenChange = renderDialog();
    expect(await screen.findByTestId('clip-property-sample-rate')).toHaveTextContent('48000 Hz');
    expect(screen.getByTestId('clip-property-channels')).toHaveTextContent('Stereo (2 channels)');
    expect(screen.getByTestId('clip-property-source-length')).toHaveTextContent('8.000000 s · 384,000 frames');
    expect(screen.getByTestId('clip-property-timeline-start')).toHaveTextContent('1.250000 s');
    expect(screen.getByTestId('clip-property-timeline-end')).toHaveTextContent('3.250000 s');
    expect(screen.getByTestId('clip-property-source-start')).toHaveTextContent('0.500000 s');
    expect(screen.getByTestId('clip-property-source-end')).toHaveTextContent('3.500000 s');
    expect(screen.getByTestId('clip-property-source-duration')).toHaveTextContent('3.000000 s');
    expect(screen.getByTestId('clip-property-speed')).toHaveTextContent('150.000%');
    expect(screen.getByTestId('clip-property-pitch')).toHaveTextContent('+125 cents total');
    expect(screen.getByText('Violet')).toBeInTheDocument();
    expect(screen.getByText('On · StaffPad phase vocoder + formant shifter')).toBeInTheDocument();
    expect(mocks.loadMetadata).toHaveBeenCalledWith('buffer-a');

    fireEvent.click(screen.getByTestId('clip-properties-close'));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('reports missing source metadata while retaining clip-derived values', async () => {
    mocks.loadMetadata.mockResolvedValue(null);
    renderDialog();
    expect(await screen.findByTestId('clip-properties-metadata-state')).toHaveTextContent('未找到源音频元数据');
    expect(screen.getByTestId('clip-property-sample-rate')).toHaveTextContent('—');
    expect(screen.getByTestId('clip-property-source-end')).toHaveTextContent('3.500000 s');
  });

  it('does not let a stale buffer request overwrite the next clip', async () => {
    let resolveFirst!: (value: unknown) => void;
    let resolveSecond!: (value: unknown) => void;
    mocks.loadMetadata
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveSecond = resolve; }));
    const onOpenChange = vi.fn();
    const { rerender } = render(<ClipPropertiesDialog open onOpenChange={onOpenChange} clip={clip} track={track} />);
    const nextClip = { ...clip, id: 'clip-b', audioBufferId: 'buffer-b', name: 'Second take' };
    rerender(<ClipPropertiesDialog open onOpenChange={onOpenChange} clip={nextClip} track={{ ...track, clips: [nextClip] }} />);

    resolveSecond({ id: 'buffer-b', sampleRate: 44100, channels: 1, length: 44100, duration: 1 });
    expect(await screen.findByTestId('clip-property-sample-rate')).toHaveTextContent('44100 Hz');
    resolveFirst({ id: 'buffer-a', sampleRate: 48000, channels: 2, length: 384000, duration: 8 });
    expect(screen.getByTestId('clip-property-sample-rate')).toHaveTextContent('44100 Hz');
    expect(screen.getByTestId('clip-property-channels')).toHaveTextContent('Mono (1 channel)');
  });
});
