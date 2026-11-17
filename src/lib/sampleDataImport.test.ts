import { describe, expect, it } from 'vitest';
import {
  parseSampleDataImport,
  readSampleDataObjects,
  validateSampleDataAscii,
} from '@/lib/sampleDataImport';
import { serializeSampleDataExport } from '@/lib/sampleDataExport';

const encoder = new TextEncoder();

function bytes(text: string): Uint8Array {
  return encoder.encode(text);
}

describe('Sample Data Import ASCII and Lisp-style reader', () => {
  it('reads decimal, exponent and rational samples with comments and CRLF', () => {
    const result = parseSampleDataImport(bytes('0 -1 .5 1. 2e-1 1/4 -2/8 ; ignored 99\r\n+0.75'), {
      channelCount: 1,
      invalidDataHandling: 'throw-error',
    });
    expect(Array.from(result.channels[0])).toEqual([0, -1, 0.5, 1, 0.20000000298023224, 0.25, -0.25, 0.75]);
    expect(result).toMatchObject({ sampleCount: 8, valueCount: 8, invalidValueCount: 0, paddedRightSample: false });
  });

  it('treats lists, strings and quoted forms as single non-numeric objects', () => {
    const objects = readSampleDataObjects('(1 2) "hello world" \'foo [-inf] 12');
    expect(objects.map((object) => object.text)).toEqual(['(1 2)', '"hello world"', "'foo", '[-inf]', '12']);
    const result = parseSampleDataImport(bytes('(1 2) "hello world" \'foo [-inf] 12'), {
      channelCount: 1,
      invalidDataHandling: 'read-as-zero',
    });
    expect(Array.from(result.channels[0])).toEqual([0, 0, 0, 0, 12]);
    expect(result.invalidValueCount).toBe(4);
  });

  it('rejects the first invalid value by default with its byte position', () => {
    expect(() => parseSampleDataImport(bytes('0 0.25 bad 0.75'), {
      channelCount: 1,
      invalidDataHandling: 'throw-error',
    })).toThrow(/‘bad’ is not a numeric value \(byte 8\)/);
  });

  it('replaces every invalid value with zero in read-as-zero mode', () => {
    const result = parseSampleDataImport(bytes('0 [-inf] NaN 1e999 1/0 0.5'), {
      channelCount: 1,
      invalidDataHandling: 'read-as-zero',
    });
    expect(Array.from(result.channels[0])).toEqual([0, 0, 0, 0, 0, 0.5]);
    expect(result.invalidValueCount).toBe(4);
  });

  it('rejects non-ASCII bytes instead of allowing replacement characters', () => {
    const input = Uint8Array.from([48, 10, 195, 169, 10, 49]);
    expect(() => validateSampleDataAscii(input)).toThrow(/Invalid byte ‘195’ at byte number: 3/);
    expect(() => parseSampleDataImport(input, { channelCount: 1, invalidDataHandling: 'read-as-zero' })).toThrow(/plain ASCII/);
  });

  it('rejects empty and comment-only files', () => {
    for (const text of ['', ' \t\r\n', '; no samples\n ; still empty']) {
      expect(() => parseSampleDataImport(bytes(text), {
        channelCount: 1,
        invalidDataHandling: 'read-as-zero',
      })).toThrow(/不包含任何采样值/);
    }
  });

  it('deinterleaves stereo left/right pairs and applies invalid handling per value', () => {
    const result = parseSampleDataImport(bytes('0.1 -0.1 bad 0.4 0.5 -0.5'), {
      channelCount: 2,
      invalidDataHandling: 'read-as-zero',
    });
    expect(Array.from(result.channels[0])).toEqual([0.10000000149011612, 0, 0.5]);
    expect(Array.from(result.channels[1])).toEqual([-0.10000000149011612, 0.4000000059604645, -0.5]);
    expect(result).toMatchObject({ sampleCount: 3, valueCount: 6, invalidValueCount: 1 });
  });

  it('pads only the final unpaired stereo right sample with silence', () => {
    const result = parseSampleDataImport(bytes('0.1 -0.1 0.2 -0.2 0.3'), {
      channelCount: 2,
      invalidDataHandling: 'throw-error',
    });
    expect(Array.from(result.channels[0])).toEqual([0.10000000149011612, 0.20000000298023224, 0.30000001192092896]);
    expect(Array.from(result.channels[1])).toEqual([-0.10000000149011612, -0.20000000298023224, 0]);
    expect(result.paddedRightSample).toBe(true);
  });

  it('validates channel count and invalid-data options explicitly', () => {
    expect(() => parseSampleDataImport(bytes('0'), { channelCount: 3 as 1, invalidDataHandling: 'throw-error' })).toThrow(/仅支持单声道或立体声/);
    expect(() => parseSampleDataImport(bytes('0'), { channelCount: 1, invalidDataHandling: 'ignore' as 'throw-error' })).toThrow(/未知无效数据/);
  });
});

describe('Sample Data Export / Import interoperability', () => {
  it('round-trips linear mono TXT values produced by Sample Data Export', () => {
    const exported = serializeSampleDataExport({
      clips: [{ clipId: 'a', startTime: 0, duration: 4, sourceOffset: 0, channels: [Float32Array.from([0, 0.5, -0.25, 1])] }],
      selection: { start: 0, end: 4 },
      sampleRate: 1,
      settings: {
        sampleLimit: 4, units: 'linear', filename: 'sample-data.txt', index: 'none', header: 'none',
        optionalText: '', channelLayout: 'same-line', messages: 'yes',
      },
    });
    const imported = parseSampleDataImport(bytes(exported.content), { channelCount: 1, invalidDataHandling: 'throw-error' });
    expect(Array.from(imported.channels[0])).toEqual([0, 0.5, -0.25, 1]);
  });

  it('round-trips same-line stereo TXT and preserves zero values in linear scale', () => {
    const exported = serializeSampleDataExport({
      clips: [{
        clipId: 'a', startTime: 0, duration: 2, sourceOffset: 0,
        channels: [Float32Array.from([0, 0.5]), Float32Array.from([-0.25, 1])],
      }],
      selection: { start: 0, end: 2 },
      sampleRate: 1,
      settings: {
        sampleLimit: 2, units: 'linear', filename: 'sample-data.txt', index: 'none', header: 'none',
        optionalText: '', channelLayout: 'same-line', messages: 'yes',
      },
    });
    const imported = parseSampleDataImport(bytes(exported.content), { channelCount: 2, invalidDataHandling: 'throw-error' });
    expect(Array.from(imported.channels[0])).toEqual([0, 0.5]);
    expect(Array.from(imported.channels[1])).toEqual([-0.25, 1]);
  });

  it('matches official [-inf] handling for dB text according to the selected policy', () => {
    const input = bytes('[-inf]\n-6.02060\n');
    expect(() => parseSampleDataImport(input, { channelCount: 1, invalidDataHandling: 'throw-error' })).toThrow(/not a numeric value/);
    const imported = parseSampleDataImport(input, { channelCount: 1, invalidDataHandling: 'read-as-zero' });
    expect(imported.channels[0][0]).toBe(0);
    expect(imported.channels[0][1]).toBeCloseTo(-6.0206, 4);
  });
});
