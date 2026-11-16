import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SAMPLE_DATA_EXPORT_SETTINGS,
  collectSampleDataPcm,
  formatSampleDataValue,
  getSampleDataFileFormat,
  serializeSampleDataExport,
  validateSampleDataExportSettings,
  type SampleDataClip,
  type SampleDataExportSettings,
} from './sampleDataExport';

function makeClip(
  channels: number[][],
  overrides: Partial<SampleDataClip> = {},
): SampleDataClip {
  return {
    clipId: 'clip-a',
    startTime: 0,
    duration: channels[0].length / 10,
    sourceOffset: 0,
    channels: channels.map((channel) => new Float32Array(channel)),
    ...overrides,
  };
}

function settings(overrides: Partial<SampleDataExportSettings> = {}): SampleDataExportSettings {
  return { ...DEFAULT_SAMPLE_DATA_EXPORT_SETTINGS, units: 'linear', sampleLimit: 10, ...overrides };
}

function exportWith(
  clips: SampleDataClip[],
  overrides: Partial<SampleDataExportSettings> = {},
  selection = { start: 0, end: 1 },
  sampleRate = 10,
) {
  return serializeSampleDataExport({ clips, selection, sampleRate, settings: settings(overrides) });
}

describe('Sample Data Export settings and PCM collection', () => {
  it('uses file extensions to select TXT, CSV or HTML like the official plug-in', () => {
    expect(getSampleDataFileFormat('sample-data.txt')).toBe('txt');
    expect(getSampleDataFileFormat('samples.CSV')).toBe('csv');
    expect(getSampleDataFileFormat('samples.HTML')).toBe('html');
    expect(getSampleDataFileFormat('samples.htm')).toBe('html');
    expect(getSampleDataFileFormat('samples.data')).toBe('txt');
  });

  it('rejects invalid limits and browser-unsafe filenames', () => {
    for (const sampleLimit of [0, -1, 1.5, 1_000_001, Number.NaN]) {
      expect(() => validateSampleDataExportSettings(settings({ sampleLimit }))).toThrow(/1–1000000/);
    }
    expect(() => validateSampleDataExportSettings(settings({ filename: '../samples.txt' }))).toThrow(/路径/);
    expect(() => validateSampleDataExportSettings(settings({ filename: 'folder\\samples.txt' }))).toThrow(/路径/);
    expect(() => validateSampleDataExportSettings(settings({ filename: '  ' }))).toThrow(/文件名/);
  });

  it('skips timeline gaps but keeps real zero samples and stops at the global limit', () => {
    const clips = [
      makeClip([[1, 0]], { clipId: 'a', duration: 2 }),
      makeClip([[2, 3]], { clipId: 'b', startTime: 5, duration: 2 }),
    ];
    const result = collectSampleDataPcm(clips, { start: 0, end: 7 }, 1, 3);
    expect(result.channels).toEqual([[1, 0, 2]]);
  });

  it('applies selection and source offset cropping before exporting', () => {
    const clip = makeClip([[0, 1, 2, 3, 4, 5]], { duration: 0.4, sourceOffset: 0.1 });
    const result = collectSampleDataPcm([clip], { start: 0.1, end: 0.3 }, 10, 10);
    expect(result.channels[0]).toEqual([2, 3]);
  });

  it('rejects empty, non-finite and inconsistent audio', () => {
    expect(() => collectSampleDataPcm([], { start: 0, end: 1 }, 10, 10)).toThrow(/没有可导出的音频/);
    expect(() => collectSampleDataPcm([makeClip([[Number.NaN]])], { start: 0, end: 1 }, 10, 10)).toThrow(/非有限/);
    expect(() => collectSampleDataPcm([
      makeClip([[0, 1], [0]]),
    ], { start: 0, end: 1 }, 10, 10)).toThrow(/声道长度不一致/);
    expect(() => collectSampleDataPcm([makeClip([[0], [0], [0]])], { start: 0, end: 1 }, 10, 10)).toThrow(/单声道或立体声/);
  });
});

describe('Sample Data Export text and CSV serialization', () => {
  it('formats default dB samples, including digital silence and absolute negative values', () => {
    const result = exportWith([makeClip([[0, 0.5, -0.25]])], { units: 'db' });
    expect(result.content).toBe('[-inf]\n-6.02060\n-12.04120\n');
    expect(result.format).toBe('txt');
    expect(result.mimeType).toBe('text/plain;charset=utf-8');
  });

  it('limits output to the first N samples', () => {
    const result = exportWith([makeClip([[0.1, 0.2, 0.3]])], { sampleLimit: 2 });
    expect(result.content).toBe('0.10000\n0.20000\n');
    expect(result.sampleCount).toBe(2);
  });

  it('reproduces duplicate sample-count indexes for stereo same-line text', () => {
    const result = exportWith([makeClip([[0.5, -0.5], [0.25, 0]])], { index: 'count' });
    expect(result.content).toBe(
      '1\t0.50000\t1\t0.25000\n'
      + '2\t-0.50000\t2\t0.00000\n',
    );
  });

  it('uses five-decimal zero-based time indexes on alternate stereo lines', () => {
    const result = exportWith(
      [makeClip([[0.5, -0.5], [0.25, 0]])],
      { index: 'time', channelLayout: 'alternate' },
    );
    expect(result.content).toBe(
      '0.00000\t0.50000\n0.00000\t0.25000\n'
      + '0.10000\t-0.50000\n0.10000\t0.00000\n',
    );
  });

  it('prints the complete left channel before the right channel when requested', () => {
    const result = exportWith(
      [makeClip([[0.5, -0.5], [0.25, 0]])],
      { channelLayout: 'left-first' },
    );
    expect(result.content).toBe('0.50000\n-0.50000\n\n0.25000\n0.00000\n');
  });

  it('uses CSV columns regardless of the text-only index selection', () => {
    const result = exportWith(
      [makeClip([[0.5], [0.25]])],
      { filename: 'samples.csv', index: 'time', header: 'minimal' },
    );
    expect(result.content).toContain('One column per channel.\n');
    expect(result.content).toContain('0.50000,0.25000\n');
    expect(result.content).not.toContain('0.00000\t');
    expect(result.mimeType).toBe('text/csv;charset=utf-8');
  });

  it('uses one CSV row per channel for left-channel-first output', () => {
    const result = exportWith(
      [makeClip([[0.5, -0.5], [0.25, 0]])],
      { filename: 'samples.csv', channelLayout: 'left-first' },
    );
    expect(result.content).toBe('0.50000,-0.50000,\n0.25000,0.00000,');
  });

  it('keeps the official single-row CSV behavior for mono L Channel First', () => {
    const result = exportWith(
      [makeClip([[0.5, -0.5]])],
      { filename: 'samples.csv', channelLayout: 'left-first' },
    );
    expect(result.content).toBe('0.50000,-0.50000,');
  });

  it('adds official-style full statistics and optional header text', () => {
    const result = exportWith(
      [makeClip([[0.5, -0.5]])],
      { header: 'all', optionalText: 'take 1' },
    );
    expect(result.content).toContain('Length processed: 2 samples, 0.20000 seconds.');
    expect(result.content).toContain('Peak amplitude: 0.50000 (linear) -6.02060 dB.');
    expect(result.content).toContain('Unweighted RMS: -6.02060 dB.');
    expect(result.content).toContain('DC offset: 0.00000 linear, [-inf] dB.');
    expect(result.content).toContain('take 1');
  });
});

describe('Sample Data Export HTML serialization', () => {
  it('always includes linear and dB columns and escapes user-controlled HTML text', () => {
    const result = exportWith(
      [makeClip([[0.5], [-0.25]])],
      {
        filename: 'sample<script>.html',
        units: 'db',
        index: 'count',
        optionalText: '<img src=x onerror=alert(1)>',
      },
    );
    expect(result.content).toContain('<th>Left (linear)</th><th>Right (linear)</th><th>Left (dB)</th><th>Right (dB)</th>');
    expect(result.content).toContain('<td>0.50000</td><td>-0.25000</td><td>-6.02060</td><td>-12.04120</td>');
    expect(result.content).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(result.content).toContain('sample&lt;script&gt;');
    expect(result.content).not.toContain('<img src=x');
    expect(result.mimeType).toBe('text/html;charset=utf-8');
  });

  it('formats zero dB values without platform-dependent infinity text', () => {
    expect(formatSampleDataValue(0, 'db')).toBe('[-inf]');
    expect(formatSampleDataValue(-0.5, 'db')).toBe('-6.02060');
    expect(formatSampleDataValue(-0.5, 'linear')).toBe('-0.50000');
  });
});
