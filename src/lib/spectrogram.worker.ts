import type { ISpectrogramSettings } from '@/types/project';
import {
  computeAudacitySpectrogram,
  createAudacityDirectSpectrogramComputer,
} from '@/lib/spectrogramAlgorithm';
import { getSpectrogramFrameColorValues } from '@/lib/spectrogramDisplay';

interface SpectrogramWorkerRequest {
  data: Float32Array;
  width: number;
  height: number;
  sampleRate: number;
  settings: ISpectrogramSettings;
}

type SpectrogramWorkerResponse =
  | { type: 'chunk'; startFrame: number; completedFrames: number; values: Float32Array }
  | { type: 'done'; frameCount: number }
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

    const flush = (completedFrames: number) => {
      if (batch.length === 0) return;
      const values = new Float32Array(batch.length * height);
      batch.forEach((frameValues, index) => values.set(frameValues, index * height));
      scope.postMessage({ type: 'chunk', startFrame: batchStart, completedFrames, values }, [values.buffer]);
      batch = [];
    };
    const emit = (frame: number, values: Float32Array) => {
      if (batch.length === 0) batchStart = frame;
      batch.push(values);
      if (batch.length >= batchSize) flush(frame + 1);
    };

    let frameCount: number;
    if (settings.algorithm === 'reassignment') {
      // Preserve Audacity's cross-column power accumulation before dB conversion.
      const computation = computeAudacitySpectrogram(data, settings, hopSize);
      frameCount = computation.numFrames;
      for (let frame = 0; frame < frameCount; frame++) {
        const start = frame * computation.numBins;
        emit(frame, getSpectrogramFrameColorValues(
          computation.data.subarray(start, start + computation.numBins),
          computation.fftLength,
          height,
          sampleRate,
          settings,
        ));
        if (batch.length === 0 && (frame + 1) % batchSize === 0) flush(frame + 1);
      }
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
    scope.postMessage({ type: 'done', frameCount });
  } catch (error) {
    scope.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};
