import {
  createLimiterState,
  DEFAULT_LIMITER_SETTINGS,
  evaluateLimiterTransferFunction,
  isLimiterBypassed,
  processLimiterChannels,
  processLimiterStream,
  toLimiterCompressorSettings,
  validateLimiterSettings,
  type LimiterSettings,
} from './limiterEffect';

function expectSamples(actual: Float32Array, expected: readonly number[], precision = 5): void {
  expect(actual.length).toBe(expected.length);
  for (let index = 0; index < expected.length; index += 1) {
    expect(actual[index], `sample ${index}`).toBeCloseTo(expected[index], precision);
  }
}

const oracleInput = [
  new Float32Array([
    0, 0.1, -0.25, 0.5, -1, 0.75, -0.5, 0.25, 1, -0.75, 0.5, -0.25,
    0.125, -0.0625, 0.03125, -0.015625, 0.9, -0.8, 0.7, -0.6, 0.4, -0.3, 0.2, -0.1,
  ]),
  new Float32Array([
    0, -0.05, 0.2, -0.4, 0.8, -0.6, 0.4, -0.2, 0.6, -0.4, 0.2, -0.1,
    -0.125, 0.0625, -0.03125, 0.015625, -0.7, 0.6, -0.5, 0.4, -0.3, 0.2, -0.1, 0.05,
  ]),
];

describe('Audacity 4.0.2 LimiterProcessor parity', () => {
  it('maps the official LimiterSettings into the shared dynamic processor', () => {
    expect(toLimiterCompressorSettings({ ...DEFAULT_LIMITER_SETTINGS })).toEqual({
      thresholdDb: -6,
      makeupGainDb: 5,
      kneeWidthDb: 2,
      compressionRatio: Infinity,
      lookaheadMs: 1,
      attackMs: 0,
      releaseMs: 20,
    });
    expect(isLimiterBypassed({
      thresholdDb: 0,
      makeupTargetDb: 0,
      kneeWidthDb: 0,
      lookaheadMs: 0,
      releaseMs: 0,
    })).toBe(false);
  });

  it('matches the unmodified official C++ default stereo PCM oracle with latency compensation', () => {
    const originals = oracleInput.map((channel) => new Float32Array(channel));
    const actual = processLimiterChannels(oracleInput, { ...DEFAULT_LIMITER_SETTINGS }, 1000);

    // Generated with Audacity-4.0.2 CompressorProcessor.cpp,
    // GainReductionComputer.cpp and LookAheadGainReduction.cpp (LimiterSettings).
    expectSamples(actual[0], [
      0, 0.177827939391, -0.444569855928, 0.863301038742, -0.887888252735, 0.675433516502,
      -0.464812010527, 0.239875376225, 0.887888252735, -0.675433516502, 0.464812010527,
      -0.239875376225, 0.123601555824, -0.0635952800512, 0.0326752960682, -0.0167663116008,
      0.888044059277, -0.793965935707, 0.703268527985, -0.614519059658, 0.420852899551,
      -0.323823094368, 0.221202835441, -0.113192871213,
    ]);
    expectSamples(actual[1], [
      0, -0.0889139696956, 0.355655878782, -0.690640866756, 0.710310637951, -0.540346860886,
      0.371849626303, -0.191900297999, 0.532732963562, -0.360231220722, 0.185924813151,
      -0.0959501489997, -0.123601555824, 0.0635952800512, -0.0326752960682, 0.0167663116008,
      -0.690700948238, 0.595474481583, -0.502334654331, 0.409679383039, -0.315639674664,
      0.215882062912, -0.11060141772, 0.0565964356065,
    ]);
    expect(oracleInput[0]).toEqual(originals[0]);
    expect(oracleInput[1]).toEqual(originals[1]);
  });

  it('matches the official zero-attack, zero-release hard-knee mono PCM oracle', () => {
    const settings: LimiterSettings = {
      thresholdDb: -6,
      makeupTargetDb: -1,
      kneeWidthDb: 0,
      lookaheadMs: 0,
      releaseMs: 0,
    };
    const actual = processLimiterChannels([oracleInput[0].slice(0, 12)], settings, 1000);
    expectSamples(actual[0], [
      0, 0.177827939391, -0.444569855928, 0.887888252735, -0.887888252735, 0.89081543684,
      -0.887888252735, 0.444569855928, 0.887888252735, -0.89081543684, 0.887888252735,
      -0.444569855928,
    ]);
  });

  it('keeps streaming output invariant across arbitrary block boundaries and the 512-sample cap', () => {
    const input = [new Float32Array(1031), new Float32Array(1031)];
    for (let index = 0; index < 1031; index += 1) {
      input[0][index] = Math.sin(index * 0.17) * (index % 37 === 0 ? 1 : 0.35);
      input[1][index] = Math.cos(index * 0.11) * (index % 53 === 0 ? 0.9 : 0.2);
    }
    const whole = processLimiterStream(input, createLimiterState({ ...DEFAULT_LIMITER_SETTINGS }, 44100, 2));
    const state = createLimiterState({ ...DEFAULT_LIMITER_SETTINGS }, 44100, 2);
    const chunks = [
      processLimiterStream(input.map((channel) => channel.slice(0, 3)), state),
      processLimiterStream(input.map((channel) => channel.slice(3, 509)), state),
      processLimiterStream(input.map((channel) => channel.slice(509, 514)), state),
      processLimiterStream(input.map((channel) => channel.slice(514)), state),
    ];
    for (let channel = 0; channel < 2; channel += 1) {
      expectSamples(new Float32Array(chunks.flatMap((chunk) => Array.from(chunk[channel]))), Array.from(whole[channel]));
    }
  });

  it('removes initial look-ahead silence and flushes the delayed tail without changing length', () => {
    const input = [new Float32Array(16)];
    input[0][0] = 1;
    input[0][8] = -0.5;
    const actual = processLimiterChannels(input, { ...DEFAULT_LIMITER_SETTINGS }, 1000);
    expect(actual[0].length).toBe(16);
    expect(actual[0][0]).not.toBe(0);
    expect(actual[0][8]).not.toBe(0);
    expect(Array.from(actual[0]).every(Number.isFinite)).toBe(true);
  });

  it('uses one linked stereo sidechain rather than independently limiting channels', () => {
    const left = new Float32Array(oracleInput[0]);
    const rightOnly = [new Float32Array(oracleInput[0].length), new Float32Array(oracleInput[1])];
    const linked = processLimiterChannels([left, new Float32Array(oracleInput[1])], { ...DEFAULT_LIMITER_SETTINGS }, 1000);
    const unlinkedRight = processLimiterChannels(rightOnly, { ...DEFAULT_LIMITER_SETTINGS }, 1000);
    expect(linked[1]).not.toEqual(unlinkedRight[1]);
    for (let index = 0; index < left.length; index += 1) {
      if (left[index] !== 0 && oracleInput[1][index] !== 0) {
        expect(linked[1][index] / oracleInput[1][index]).toBeCloseTo(linked[0][index] / left[index], 4);
      }
    }
  });
});

describe('Limiter transfer function and validation', () => {
  it('uses infinite ratio, zero attack and output-target makeup in hard and soft knees', () => {
    const hard: LimiterSettings = {
      thresholdDb: -6,
      makeupTargetDb: -1,
      kneeWidthDb: 0,
      lookaheadMs: 0,
      releaseMs: 0,
    };
    expect(evaluateLimiterTransferFunction(hard, -12)).toBeCloseTo(-7, 6);
    expect(evaluateLimiterTransferFunction(hard, -6)).toBeCloseTo(-1, 6);
    expect(evaluateLimiterTransferFunction(hard, 0)).toBeCloseTo(-1, 6);
    expect(evaluateLimiterTransferFunction({ ...DEFAULT_LIMITER_SETTINGS }, -6)).toBeCloseTo(-1.25, 6);
    expect(evaluateLimiterTransferFunction({ ...DEFAULT_LIMITER_SETTINGS }, -12)).toBeCloseTo(-7, 6);
  });

  it.each([
    ['thresholdDb', -31], ['thresholdDb', 1], ['makeupTargetDb', -31], ['makeupTargetDb', 1],
    ['kneeWidthDb', -1], ['kneeWidthDb', 11], ['lookaheadMs', -1], ['lookaheadMs', 51],
    ['releaseMs', -1], ['releaseMs', 1001], ['releaseMs', Number.NaN],
  ])('rejects out-of-range %s values', (key, value) => {
    expect(() => validateLimiterSettings({ ...DEFAULT_LIMITER_SETTINGS, [key]: value })).toThrow(RangeError);
  });

  it('rejects invalid layouts, sample rates and non-finite PCM', () => {
    expect(() => createLimiterState({ ...DEFAULT_LIMITER_SETTINGS }, 0, 1)).toThrow(/采样率/);
    expect(() => createLimiterState({ ...DEFAULT_LIMITER_SETTINGS }, 44100, 3)).toThrow(/单声道或立体声/);
    expect(() => processLimiterChannels([], { ...DEFAULT_LIMITER_SETTINGS }, 44100)).toThrow(/单声道或立体声/);
    expect(() => processLimiterChannels([new Float32Array([Number.NaN])], { ...DEFAULT_LIMITER_SETTINGS }, 44100)).toThrow(/非有限值/);
  });

  it('keeps extreme finite PCM finite after Float32 storage', () => {
    const actual = processLimiterChannels(
      [new Float32Array([3.4e38, -3.4e38, 0])],
      { ...DEFAULT_LIMITER_SETTINGS, lookaheadMs: 0 },
      44100,
    );
    expect(Array.from(actual[0]).every(Number.isFinite)).toBe(true);
  });
});
