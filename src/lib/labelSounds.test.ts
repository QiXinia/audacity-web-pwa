import { describe, expect, it } from 'vitest';
import {
  analyzeLabelSoundsTracks,
  DEFAULT_LABEL_SOUNDS_SETTINGS,
  detectLabelSoundRegions,
  labelsFromSoundRegions,
  validateLabelSoundsSettings,
  type LabelSoundsClip,
  type LabelSoundsSettings,
} from './labelSounds';

function settings(patch: Partial<LabelSoundsSettings> = {}): LabelSoundsSettings {
  return { ...DEFAULT_LABEL_SOUNDS_SETTINGS, ...patch };
}

const SOUNDS = [{ start: 1, end: 3 }, { start: 6, end: 8 }];

 describe('Audacity Label sounds detection', () => {
  it('ports the official silence/sound counters and absolute selection offset', () => {
    const detected = detectLabelSoundRegions(
      [0, 1, 1, 0, 0, 0, 1, 1, 0],
      10,
      1,
      settings({ silenceDuration: 2, labelInterval: 2 }),
    );
    expect(detected).toEqual([{ start: 11, end: 13 }, { start: 16, end: 18 }]);
  });

  it('retains the official final-sound flush even below the minimum interval', () => {
    expect(detectLabelSoundRegions([1], 0, 1, settings({ labelInterval: 2 })))
      .toEqual([{ start: 0, end: 1 }]);
  });

  it('creates before, after and around labels with overlap-safe silence offsets', () => {
    const base = settings({ leadingSilence: 1, trailingSilence: 1 });
    expect(labelsFromSoundRegions('track', SOUNDS, 0, { ...base, labelType: 'around' })).toEqual([
      { trackId: 'track', start: 0, end: 4, text: 'Sound 01' },
      { trackId: 'track', start: 5, end: 9, text: 'Sound 02' },
    ]);
    expect(labelsFromSoundRegions('track', SOUNDS, 0, { ...base, labelType: 'before' }).map(({ start, end }) => [start, end]))
      .toEqual([[0, 0], [5, 5]]);
    expect(labelsFromSoundRegions('track', SOUNDS, 0, { ...base, labelType: 'after' }).map(({ start, end }) => [start, end]))
      .toEqual([[4, 4], [9, 9]]);
  });

  it('labels regions between sounds and collapses crossed offsets to their midpoint', () => {
    expect(labelsFromSoundRegions('track', SOUNDS, 0, settings({
      labelType: 'between', leadingSilence: 1, trailingSilence: 1,
    }))).toEqual([{ trackId: 'track', start: 4, end: 5, text: 'Sound 01' }]);
    expect(labelsFromSoundRegions('track', SOUNDS, 0, settings({
      labelType: 'between', leadingSilence: 10, trailingSilence: 10,
    }))[0]).toMatchObject({ start: 4.5, end: 4.5 });
    expect(() => labelsFromSoundRegions('track', [SOUNDS[0]], 0, settings({ labelType: 'between' })))
      .toThrow('at least two sounds');
  });

  it('supports official zero-padded incremental text and literal hashes', () => {
    expect(labelsFromSoundRegions('track', SOUNDS, 0, settings({ labelText: 'Take ###7' })).map(({ text }) => text))
      .toEqual(['Take 007', 'Take 008']);
    expect(labelsFromSoundRegions('track', SOUNDS, 0, settings({ labelText: 'Sound ##' })).map(({ text }) => text))
      .toEqual(['Sound ##', 'Sound ##']);
    expect(labelsFromSoundRegions('track', SOUNDS, 0, settings({ labelText: '' })).map(({ text }) => text))
      .toEqual(['', '']);
  });

  it('validates every bounded official control', () => {
    expect(() => validateLabelSoundsSettings(settings({ thresholdDb: -101 }))).toThrow('Threshold level');
    expect(() => validateLabelSoundsSettings(settings({ silenceDuration: 0 }))).toThrow('Minimum silence');
    expect(() => validateLabelSoundsSettings(settings({ labelInterval: 0 }))).toThrow('Minimum label');
    expect(() => validateLabelSoundsSettings(settings({ leadingSilence: -1 }))).toThrow('leading silence');
    expect(() => validateLabelSoundsSettings(settings({ trailingSilence: Number.NaN }))).toThrow('trailing silence');
  });
});

describe('Label sounds selected-track timelines', () => {
  function clip(id: string, channels: number[][], sampleRate = 100): LabelSoundsClip {
    return {
      clipId: id,
      startTime: 0,
      duration: channels[0].length / sampleRate,
      sourceOffset: 0,
      channels: channels.map((values) => new Float32Array(values)),
    };
  }

  it('uses stereo peak, average-absolute and combined RMS measurements', () => {
    const tracks = [{ trackId: 'stereo', clips: [clip('stereo', [[1], [0]])] }];
    const selection = { start: 0, end: 0.01 };
    const base = settings({ thresholdDb: -6, silenceDuration: 0.01, labelInterval: 0.01 });
    expect(analyzeLabelSoundsTracks(tracks, selection, 100, { ...base, measurement: 'average' })).toEqual([]);
    expect(analyzeLabelSoundsTracks(tracks, selection, 100, { ...base, measurement: 'peak' }))
      .toHaveLength(1);
    expect(analyzeLabelSoundsTracks(tracks, selection, 100, { ...base, measurement: 'rms' }))
      .toHaveLength(1);
  });

  it('keeps track ownership and restarts official numbering for each track', () => {
    const tracks = ['a', 'b'].map((id) => ({
      trackId: `track-${id}`,
      clips: [clip(id, [[0, 1, 1, 0, 0, 0, 1, 1, 0]], 1)],
    }));
    const labels = analyzeLabelSoundsTracks(
      tracks,
      { start: 0, end: 9 },
      1,
      settings({ silenceDuration: 2, labelInterval: 2 }),
    );
    expect(labels.map(({ trackId, text }) => [trackId, text])).toEqual([
      ['track-a', 'Sound 01'], ['track-a', 'Sound 02'],
      ['track-b', 'Sound 01'], ['track-b', 'Sound 02'],
    ]);
  });

  it('rejects empty input and invalid selections', () => {
    expect(() => analyzeLabelSoundsTracks([], { start: 0, end: 1 }, 100, settings())).toThrow('没有可分析的音频');
    expect(() => analyzeLabelSoundsTracks([], { start: 1, end: 1 }, 100, settings())).toThrow('正长度时间选区');
  });
});
