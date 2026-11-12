/**
 * Audacity 4.0.2 Repair / InterpolateAudio.
 *
 * Up to 128 damaged samples are replaced by least-squares autoregression
 * using the surrounding audio. The small amount of dither noise and the
 * Gauss-Jordan elimination follow the official implementation; a glibc-
 * compatible generator makes browser runs reproducible and independently
 * comparable with the C++ implementation.
 */

export const MAX_REPAIR_SAMPLES = 128;
const RAND_MAX = 2147483647;

export type RepairRandom = () => number;
type Matrix = Float64Array[];

/** Match glibc rand()/random() with a deterministic seed (default 1). */
export function createRepairRandom(seed = 1): RepairRandom {
  const state: number[] = [seed === 0 ? 1 : seed >>> 0];
  for (let index = 1; index <= 30; index += 1) {
    state[index] = (16807 * state[index - 1]) % RAND_MAX;
  }
  state[31] = state[0];
  state[32] = state[1];
  state[33] = state[2];
  for (let index = 34; index < 344; index += 1) {
    state[index] = (state[index - 31] + state[index - 3]) >>> 0;
  }
  return () => {
    const value = (state[state.length - 31] + state[state.length - 3]) >>> 0;
    state.push(value);
    return value >>> 1;
  };
}

function makeMatrix(rows: number, cols: number): Matrix {
  return Array.from({ length: rows }, () => new Float64Array(cols));
}

function transposeMatrix(input: Matrix): Matrix {
  const output = makeMatrix(input[0]?.length ?? 0, input.length);
  for (let row = 0; row < input.length; row += 1) {
    for (let col = 0; col < (input[row]?.length ?? 0); col += 1) {
      output[col][row] = input[row][col];
    }
  }
  return output;
}

function multiplyMatrix(left: Matrix, right: Matrix): Matrix {
  const output = makeMatrix(left.length, right[0]?.length ?? 0);
  for (let row = 0; row < left.length; row += 1) {
    for (let col = 0; col < (right[0]?.length ?? 0); col += 1) {
      for (let index = 0; index < right.length; index += 1) {
        output[row][col] += left[row][index] * right[index][col];
      }
    }
  }
  return output;
}

function multiplyMatrixVector(left: Matrix, right: Float64Array): Float64Array {
  const output = new Float64Array(left.length);
  for (let row = 0; row < left.length; row += 1) {
    for (let col = 0; col < right.length; col += 1) {
      output[row] += left[row][col] * right[col];
    }
  }
  return output;
}

/** Official Matrix.cpp Gauss-Jordan inversion, including pivot order. */
function invertMatrix(input: Matrix): Matrix | null {
  const size = input.length;
  const work = input.map((row) => new Float64Array(row));
  const inverse = makeMatrix(size, size);
  for (let index = 0; index < size; index += 1) inverse[index][index] = 1;

  for (let column = 0; column < size; column += 1) {
    let absoluteMaximum = 0;
    let argumentMaximum = 0;
    for (let row = column; row < size; row += 1) {
      if (Math.abs(work[row][column]) > absoluteMaximum) {
        absoluteMaximum = Math.abs(work[row][column]);
        argumentMaximum = row;
      }
    }
    if (absoluteMaximum === 0) return null;

    if (column !== argumentMaximum) {
      [work[column], work[argumentMaximum]] = [work[argumentMaximum], work[column]];
      [inverse[column], inverse[argumentMaximum]] = [inverse[argumentMaximum], inverse[column]];
    }

    let factor = 1 / work[column][column];
    for (let index = 0; index < size; index += 1) {
      work[column][index] *= factor;
      inverse[column][index] *= factor;
    }

    for (let row = 0; row < size; row += 1) {
      if (row === column || Math.abs(work[row][column]) <= 0) continue;
      factor = work[row][column];
      for (let index = 0; index < size; index += 1) {
        work[row][index] -= work[column][index] * factor;
        inverse[row][index] -= inverse[column][index] * factor;
      }
    }
  }
  return inverse;
}

function linearInterpolateAudio(
  buffer: Float32Array,
  firstBad: number,
  numBad: number,
): void {
  const length = buffer.length;
  const decay = 0.9;
  if (firstBad === 0) {
    let delta = Math.fround(buffer[numBad] - buffer[numBad + 1]);
    let value = buffer[numBad];
    for (let index = numBad - 1; index >= 0; index -= 1) {
      value = Math.fround(value + delta);
      buffer[index] = value;
      value = Math.fround(value * decay);
      delta = Math.fround(delta * decay);
    }
  } else if (firstBad + numBad === length) {
    let delta = firstBad >= 2
      ? Math.fround(buffer[firstBad - 1] - buffer[firstBad - 2])
      : 0;
    let value = buffer[firstBad - 1];
    for (let index = firstBad; index < firstBad + numBad; index += 1) {
      value = Math.fround(value + delta);
      buffer[index] = value;
      value = Math.fround(value * decay);
      delta = Math.fround(delta * decay);
    }
  } else {
    const left = buffer[firstBad - 1];
    const right = buffer[firstBad + numBad];
    let value = left;
    const delta = Math.fround((right - left) / (numBad + 1));
    for (let index = firstBad; index < firstBad + numBad; index += 1) {
      value = Math.fround(value + delta);
      buffer[index] = value;
    }
  }
}

/**
 * Return a repaired copy of one channel. firstBad and numBad refer to the
 * supplied context window, not the whole project. The input is never mutated.
 */
export function interpolateRepairAudio(
  input: Float32Array,
  firstBad: number,
  numBad: number,
  random: RepairRandom = createRepairRandom(),
): Float32Array {
  const length = input.length;
  if (!Number.isInteger(firstBad) || !Number.isInteger(numBad)
    || firstBad < 0 || numBad < 0 || firstBad + numBad > length) {
    throw new RangeError('Repair 插值范围无效');
  }
  const output = new Float32Array(input);
  if (numBad === 0 || numBad >= length) return output;

  // The official algorithm reverses left-edge repairs to avoid its LSAR
  // asymmetry, then restores the original channel order.
  if (firstBad === 0) {
    const reversed = new Float32Array(length);
    for (let index = 0; index < length; index += 1) reversed[index] = input[length - 1 - index];
    const repaired = interpolateRepairAudio(reversed, length - numBad, numBad, random);
    for (let index = 0; index < length; index += 1) output[index] = repaired[length - 1 - index];
    return output;
  }

  const order = Math.min(
    Math.min(numBad * 3, 50),
    Math.max(firstBad - 1, length - (firstBad + numBad) - 1),
  );
  if (order < 3 || order >= length) {
    linearInterpolateAudio(output, firstBad, numBad);
    return output;
  }

  const signal = new Float64Array(length);
  for (let index = 0; index < length; index += 1) {
    signal[index] = input[index] + (random() - RAND_MAX / 2) / (RAND_MAX * 10000);
  }

  const covariance = makeMatrix(order, order);
  const target = new Float64Array(order);
  for (let index = 0; index + order < length; index += 1) {
    if (index + order < firstBad || index >= firstBad + numBad) {
      for (let row = 0; row < order; row += 1) {
        for (let col = 0; col < order; col += 1) {
          covariance[row][col] += signal[index + row] * signal[index + col];
        }
        target[row] += signal[index + order] * signal[index + row];
      }
    }
  }

  const covarianceInverse = invertMatrix(covariance);
  if (!covarianceInverse) {
    linearInterpolateAudio(output, firstBad, numBad);
    return output;
  }
  const coefficients = multiplyMatrixVector(covarianceInverse, target);

  const toeplitzRows = length - order;
  const unknown = makeMatrix(toeplitzRows, numBad);
  const known = makeMatrix(toeplitzRows, length - numBad);
  const knownSignal = new Float64Array(length - numBad);
  let knownIndex = 0;
  for (let index = 0; index < length; index += 1) {
    if (index < firstBad || index >= firstBad + numBad) {
      knownSignal[knownIndex] = signal[index];
      knownIndex += 1;
    }
  }
  for (let row = 0; row < toeplitzRows; row += 1) {
    let knownColumn = 0;
    for (let col = 0; col < length; col += 1) {
      let value = 0;
      if (col >= row && col < row + order) value = -coefficients[col - row];
      if (col === row + order) value = 1;
      if (col >= firstBad && col < firstBad + numBad) {
        unknown[row][col - firstBad] = value;
      } else {
        known[row][knownColumn] = value;
        knownColumn += 1;
      }
    }
  }

  const unknownTranspose = transposeMatrix(unknown);
  const normal = multiplyMatrix(unknownTranspose, unknown);
  const normalInverse = invertMatrix(normal);
  if (!normalInverse) {
    linearInterpolateAudio(output, firstBad, numBad);
    return output;
  }
  const negativeInverse = normalInverse.map((row) => {
    const scaled = new Float64Array(row.length);
    for (let index = 0; index < row.length; index += 1) scaled[index] = row[index] * -1;
    return scaled;
  });
  const repaired = multiplyMatrixVector(
    multiplyMatrix(multiplyMatrix(negativeInverse, unknownTranspose), known),
    knownSignal,
  );
  for (let index = 0; index < numBad; index += 1) output[firstBad + index] = repaired[index];
  return output;
}
