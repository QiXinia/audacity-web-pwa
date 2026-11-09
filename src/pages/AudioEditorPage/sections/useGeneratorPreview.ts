import { useCallback, useEffect, useState } from 'react';
import { GeneratorPreviewPlayer, type PreviewChannels } from '@/lib/generatorPreview';

export function useGeneratorPreview() {
  const [player] = useState(() => new GeneratorPreviewPlayer());
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const stopPreview = useCallback(() => {
    player.stop();
    setIsPreviewing(false);
  }, [player]);

  const startPreview = useCallback(async <T extends PreviewChannels>(
    createSamples: () => T | Promise<T>,
    sampleRate: number,
  ) => {
    setPreviewError(null);
    setIsPreviewing(true);
    try {
      const samples = await createSamples();
      if (samples instanceof Float32Array) {
        await player.play(samples, sampleRate, () => setIsPreviewing(false));
      } else {
        await player.playChannels(samples, sampleRate, () => setIsPreviewing(false));
      }
    } catch (error) {
      player.stop();
      setIsPreviewing(false);
      setPreviewError(error instanceof Error ? error.message : '音频试听失败');
    }
  }, [player]);

  useEffect(() => () => player.stop(), [player]);

  return { isPreviewing, previewError, startPreview, stopPreview };
}
