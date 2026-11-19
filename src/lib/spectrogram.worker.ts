import type { ISpectrogramSettings } from '@/types/project';
import {
  computeAudacityReassignmentSpectrogramStreaming,
  createAudacityDirectSpectrogramComputer,
} from '@/lib/spectrogramAlgorithm';
import {
  applySpectrogramPowerCorrections,
  createSpectrogramBinRanges,
  getSpectrogramColorValuesFromDbMaxima,
  getSpectrogramFrameColorValues,
  getSpectrogramFrameDbMaxima,
} from '@/lib/spectrogramDisplay';

interface SpectrogramWorkerRequest {
  data: Float32Array;
  width: number;
  height: number;
  sampleRate: number;
  settings: ISpectrogramSettings;
}

type SpectrogramWorkerResponse =
  | { type: 'chunk'; startFrame: number; completedFrames: number; values: Float32Array }
  | {
    type: 'done';
    frameCount: number;
    bufferedFrames: number;
    distantBinCount: number;
    cachedContributionCount: number;
    totalContributionCount: number;
    usedContributionCache: boolean;
  }
  | { type: 'error'; message: string };

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<SpectrogramWorkerRequest>) => void) | null;
  postMessage: (message: SpectrogramWorkerResponse, transfer?: Transferable[]) => void;
};

scope.onmessage = ({ data: request }) => {
  try {
    const { data, width, height, sampleRate, settings } = request;
    const hopSize = Math.floor(data.length / width) || 1;
    const batchSize = 8;
    let batchStart = 0;
    let batch: Float32Array[] = [];
    let completedUniqueFrames = 0;

    const flush = (completedFrames: number) => {
      if (batch.length === 0) return;
      const values = new Float32Array(batch.length * height);
      batch.forEach((frameValues, index) => values.set(frameValues, index * height));
      scope.postMessage({ type: 'chunk', startFrame: batchStart, completedFrames, values }, [values.buffer]);
      batch = [];
    };
    const emit = (frame: number, values: Float32Array) => {
      if (batch.length > 0 && frame !== batchStart + batch.length) flush(completedUniqueFrames);
      if (batch.length === 0) batchStart = frame;
      batch.push(values);
      completedUniqueFrames = Math.max(completedUniqueFrames, frame + 1);
      if (batch.length >= batchSize) flush(completedUniqueFrames);
    };

    let frameCount: number;
    let bufferedFrames = 0;
    let distantBinCount = 0;
    let cachedContributionCount = 0;
    let totalContributionCount = 0;
    let usedContributionCache = false;
    if (settings.algorithm === 'reassignment') {
      const fftLength = settings.windowSize * settings.zeroPaddingFactor;
      const ranges = createSpectrogramBinRanges(fftLength, height, sampleRate, settings);
      const maximumDbByFrame: Float64Array[] = [];
      const computation = computeAudacityReassignmentSpectrogramStreaming(
        data,
        settings,
        hopSize,
        (frame, frameValues) => {
          const maximumDb = getSpectrogramFrameDbMaxima(
            frameValues, fftLength, height, sampleRate, settings, ranges,
          );
          maximumDbByFrame[frame] = maximumDb;
          emit(frame, getSpectrogramColorValuesFromDbMaxima(maximumDb, settings));
        },
        (frame, corrections) => {
          const maximumDb = applySpectrogramPowerCorrections(
            maximumDbByFrame[frame]!, corrections, fftLength, height, sampleRate, settings, ranges,
          );
          maximumDbByFrame[frame] = maximumDb;
          emit(frame, getSpectrogramColorValuesFromDbMaxima(maximumDb, settings));
        },
      );
      frameCount = computation.numFrames;
      bufferedFrames = computation.bufferedFrames;
      distantBinCount = computation.distantBinCount;
      cachedContributionCount = computation.cachedContributionCount;
      totalContributionCount = computation.totalContributionCount;
      usedContributionCache = computation.usedContributionCache;
      flush(frameCount);
    } else {
      const computer = createAudacityDirectSpectrogramComputer(data, settings, hopSize);
      frameCount = computer.numFrames;
      for (let frame = 0; frame < frameCount; frame++) {
        emit(frame, getSpectrogramFrameColorValues(
          computer.computeFrame(frame),
          computer.fftLength,
          height,
          sampleRate,
          settings,
        ));
        if (batch.length === 0 && (frame + 1) % batchSize === 0) flush(frame + 1);
      }
      flush(frameCount);
    }
    scope.postMessage({
      type: 'done', frameCount, bufferedFrames, distantBinCount, cachedContributionCount,
      totalContributionCount, usedContributionCache,
    });
  } catch (error) {
    scope.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};
