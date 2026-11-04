// Pitch-preserving WSOLA time stretch. The same analysis positions are shared by
// every channel so stereo phase and channel alignment do not drift apart.

function nextPowerOfTwo(value: number): number {
  let result = 1;
  while (result < value) result <<= 1;
  return result;
}

function linearStretchChannel(input: Float32Array, outputLength: number): Float32Array {
  const output = new Float32Array(outputLength);
  if (input.length === 0) return output;
  for (let i = 0; i < outputLength; i++) {
    const position = (i * input.length) / outputLength;
    const left = Math.min(input.length - 1, Math.floor(position));
    const right = Math.min(input.length - 1, left + 1);
    const fraction = position - left;
    output[i] = input[left] * (1 - fraction) + input[right] * fraction;
  }
  return output;
}

/**
 * WSOLA fallback used when WASM is unavailable.
 * speed > 1 shortens audio; speed < 1 lengthens it, while preserving pitch.
 */
export function timeStretchChannelsJs(
  channels: Float32Array[],
  speed: number,
  sampleRate: number,
): Float32Array[] {
  if (channels.length === 0) return [];
  const inputFrames = channels[0].length;
  if (channels.some((channel) => channel.length !== inputFrames)) {
    throw new Error('Audio channels must have equal lengths');
  }
  if (!Number.isFinite(speed) || speed <= 0) throw new Error('Stretch ratio must be positive');
  if (inputFrames === 0) return channels.map(() => new Float32Array());
  if (Math.abs(speed - 1) < 0.000001) return channels.map((channel) => channel.slice());

  const outputLength = Math.max(1, Math.round(inputFrames / speed));
  if (inputFrames < 128) {
    return channels.map((channel) => linearStretchChannel(channel, outputLength));
  }

  let windowSize = Math.min(
    2048,
    nextPowerOfTwo(Math.max(64, Math.round(sampleRate * 0.046))),
  );
  while (windowSize > inputFrames && windowSize > 64) windowSize >>= 1;
  if (windowSize < 64) {
    return channels.map((channel) => linearStretchChannel(channel, outputLength));
  }

  const overlap = windowSize >> 1;
  const synthesisHop = overlap;
  const searchRadius = Math.max(16, overlap >> 2);
  const window = new Float32Array(windowSize);
  for (let i = 0; i < windowSize; i++) {
    window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (windowSize - 1));
  }

  const mono = new Float32Array(inputFrames);
  for (const channel of channels) {
    for (let i = 0; i < inputFrames; i++) mono[i] += channel[i] / channels.length;
  }

  const workLength = outputLength + windowSize;
  const work = channels.map(() => new Float32Array(workLength));
  const normalization = new Float32Array(workLength);
  const maximumPosition = Math.max(0, inputFrames - windowSize);

  function sampleAt(position: number): number {
    return position >= 0 && position < inputFrames ? mono[position] : 0;
  }

  function correlation(previous: number, candidate: number, step: number): number {
    let dot = 0;
    let previousEnergy = 1e-9;
    let candidateEnergy = 1e-9;
    for (let i = 0; i < overlap; i += step) {
      const a = sampleAt(previous + overlap + i);
      const b = sampleAt(candidate + i);
      dot += a * b;
      previousEnergy += a * a;
      candidateEnergy += b * b;
    }
    return dot / Math.sqrt(previousEnergy * candidateEnergy);
  }

  function bestPosition(previous: number, nominal: number): number {
    const center = Math.max(0, Math.min(maximumPosition, Math.round(nominal)));
    let best = center;
    let bestScore = -Infinity;
    const first = Math.max(0, center - searchRadius);
    const last = Math.min(maximumPosition, center + searchRadius);
    for (let candidate = first; candidate <= last; candidate += 8) {
      const score = correlation(previous, candidate, 4);
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
    const coarse = best;
    bestScore = -Infinity;
    for (
      let candidate = Math.max(0, coarse - 7);
      candidate <= Math.min(maximumPosition, coarse + 7);
      candidate++
    ) {
      const score = correlation(previous, candidate, 2);
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
    return best;
  }

  let outputPosition = 0;
  let previousPosition = 0;
  let frameIndex = 0;
  while (outputPosition < outputLength) {
    const nominal = outputPosition * speed;
    const position = frameIndex === 0
      ? Math.max(0, Math.min(maximumPosition, Math.round(nominal)))
      : bestPosition(previousPosition, nominal);

    for (let i = 0; i < windowSize; i++) {
      const target = outputPosition + i;
      if (target >= workLength) break;
      const source = position + i;
      const weight = window[i];
      normalization[target] += weight;
      for (let channel = 0; channel < channels.length; channel++) {
        work[channel][target] += (source < inputFrames ? channels[channel][source] : 0) * weight;
      }
    }
    previousPosition = position;
    outputPosition += synthesisHop;
    frameIndex++;
  }

  return work.map((channel) => {
    const output = new Float32Array(outputLength);
    for (let i = 0; i < outputLength; i++) {
      output[i] = normalization[i] > 1e-6 ? channel[i] / normalization[i] : 0;
    }
    return output;
  });
}
