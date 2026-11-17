// Audacity 4.0.2 share/nyquist-plug-ins/sample-data-import.ny parsing rules.
export type SampleDataInvalidDataHandling = 'throw-error' | 'read-as-zero';
export type SampleDataImportChannelCount = 1 | 2;

export interface SampleDataImportOptions {
  channelCount: SampleDataImportChannelCount;
  invalidDataHandling: SampleDataInvalidDataHandling;
}

export interface SampleDataImportResult {
  channels: Float32Array[];
  /** Frames per channel; stereo input contains left/right value pairs. */
  sampleCount: number;
  /** Number of Lisp-style values read before channel deinterleaving. */
  valueCount: number;
  invalidValueCount: number;
  /** A final unpaired left value receives a silent right sample. */
  paddedRightSample: boolean;
}

interface SampleDataObject {
  text: string;
  byteNumber: number;
}

const ASCII_WHITESPACE = new Set([' ', '\t', '\n', '\r', '\f', '\v']);
const NUMBER_PATTERN = /^[+-]?(?:(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)$/;
const RATIO_PATTERN = /^([+-]?\d+)\/(\d+)$/;

function isAsciiWhitespace(character: string | undefined): boolean {
  return character !== undefined && ASCII_WHITESPACE.has(character);
}

function skipIgnored(text: string, initialIndex: number): number {
  let index = initialIndex;
  while (index < text.length) {
    if (isAsciiWhitespace(text[index])) {
      index += 1;
      continue;
    }
    if (text[index] === ';') {
      while (index < text.length && text[index] !== '\n' && text[index] !== '\r') index += 1;
      continue;
    }
    break;
  }
  return index;
}

function skipString(text: string, initialIndex: number): number {
  let index = initialIndex + 1;
  while (index < text.length) {
    if (text[index] === '\\') {
      index = Math.min(text.length, index + 2);
      continue;
    }
    if (text[index] === '"') return index + 1;
    index += 1;
  }
  return index;
}

function skipAggregate(text: string, initialIndex: number): number {
  const closing: string[] = [];
  let index = initialIndex;
  while (index < text.length) {
    const character = text[index];
    if (character === '"') {
      index = skipString(text, index);
      continue;
    }
    if (character === ';') {
      index = skipIgnored(text, index);
      continue;
    }
    if (character === '(' || character === '[') {
      closing.push(character === '(' ? ')' : ']');
      index += 1;
      continue;
    }
    if (character === ')' || character === ']') {
      if (closing.at(-1) === character) closing.pop();
      index += 1;
      if (closing.length === 0) return index;
      continue;
    }
    index += 1;
  }
  return index;
}

/** Read one XLISP-like object so lists and strings count as one invalid value. */
function readObject(text: string, initialIndex: number): { object: SampleDataObject; nextIndex: number } | null {
  const start = skipIgnored(text, initialIndex);
  if (start >= text.length) return null;
  const character = text[start];

  if (character === "'" || character === '`' || character === ',') {
    const quoted = readObject(text, start + 1);
    if (quoted) {
      return {
        object: { text: text.slice(start, quoted.nextIndex), byteNumber: start + 1 },
        nextIndex: quoted.nextIndex,
      };
    }
  }

  let end: number;
  if (character === '"') end = skipString(text, start);
  else if (character === '(' || character === '[') end = skipAggregate(text, start);
  else {
    end = start;
    while (end < text.length) {
      const current = text[end]!;
      if (isAsciiWhitespace(current) || current === ';' || current === '(' || current === ')' || current === '[' || current === ']' || current === '"') break;
      end += 1;
    }
    if (end === start) end += 1;
  }

  return {
    object: { text: text.slice(start, end), byteNumber: start + 1 },
    nextIndex: end,
  };
}

export function readSampleDataObjects(text: string): SampleDataObject[] {
  const objects: SampleDataObject[] = [];
  let index = 0;
  while (index < text.length) {
    const next = readObject(text, index);
    if (!next) break;
    objects.push(next.object);
    if (next.nextIndex <= index) throw new Error('采样文本解析未能前进');
    index = next.nextIndex;
  }
  return objects;
}

function parseNumericValue(text: string): number | null {
  let value: number;
  const ratio = RATIO_PATTERN.exec(text);
  if (ratio) {
    const denominator = Number(ratio[2]);
    if (denominator === 0) return null;
    value = Number(ratio[1]) / denominator;
  } else if (NUMBER_PATTERN.test(text)) {
    value = Number(text);
  } else {
    return null;
  }
  return Number.isFinite(value) ? value : null;
}

function displayObject(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ');
  return oneLine.length > 80 ? `${oneLine.slice(0, 77)}…` : oneLine;
}

export function validateSampleDataAscii(bytes: Uint8Array): void {
  for (let index = 0; index < bytes.length; index += 1) {
    const value = bytes[index]!;
    if (value > 127) {
      throw new RangeError(`The file must contain only plain ASCII text. (Invalid byte ‘${value}’ at byte number: ${index + 1})`);
    }
  }
}

export function parseSampleDataImport(
  bytes: Uint8Array,
  options: SampleDataImportOptions,
): SampleDataImportResult {
  if (options.channelCount !== 1 && options.channelCount !== 2) {
    throw new RangeError('Sample Data Import 仅支持单声道或立体声目标轨');
  }
  if (options.invalidDataHandling !== 'throw-error' && options.invalidDataHandling !== 'read-as-zero') {
    throw new RangeError('未知无效数据处理选项');
  }
  validateSampleDataAscii(bytes);
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const objects = readSampleDataObjects(text);
  if (objects.length === 0) throw new RangeError('文件不包含任何采样值');

  const values = new Float32Array(objects.length);
  let invalidValueCount = 0;
  objects.forEach((object, index) => {
    const value = parseNumericValue(object.text);
    if (value === null) {
      invalidValueCount += 1;
      if (options.invalidDataHandling === 'throw-error') {
        throw new RangeError(`Data must be numbers in plain ASCII text. ‘${displayObject(object.text)}’ is not a numeric value (byte ${object.byteNumber}).`);
      }
      values[index] = 0;
    } else {
      values[index] = value;
    }
  });

  if (options.channelCount === 1) {
    return {
      channels: [values],
      sampleCount: values.length,
      valueCount: values.length,
      invalidValueCount,
      paddedRightSample: false,
    };
  }

  const sampleCount = Math.ceil(values.length / 2);
  const left = new Float32Array(sampleCount);
  const right = new Float32Array(sampleCount);
  const paddedRightSample = values.length % 2 === 1;
  for (let frame = 0; frame < sampleCount; frame += 1) {
    left[frame] = values[frame * 2]!;
    right[frame] = values[frame * 2 + 1] ?? 0;
  }
  return {
    channels: [left, right],
    sampleCount,
    valueCount: values.length,
    invalidValueCount,
    paddedRightSample,
  };
}
