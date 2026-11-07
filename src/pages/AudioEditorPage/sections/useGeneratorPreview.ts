import { useCallback, useEffect, useState } from 'react';
import { GeneratorPreviewPlayer } from '@/lib/generatorPreview';

export function useGeneratorPreview() {
  const [player] = useState(() => new GeneratorPreviewPlayer());
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const stopPreview = useCallback(() => {
    player.stop();
    setIsPreviewing(false);
  }, [player]);

  const startPreview = useCallback(async (
    createSamples: () => Float32Array,
    sampleRate: number,
  ) => {
    setPreviewError(null);
    setIsPreviewing(true);
    try {
      const samples = createSamples();
      await player.play(samples, sampleRate, () => setIsPreviewing(false));
    } catch (error) {
      player.stop();
      setIsPreviewing(false);
      setPreviewError(error instanceof Error ? error.message : '音频试听失败');
    }
  }, [player]);

  useEffect(() => () => player.stop(), [player]);

  return { isPreviewing, previewError, startPreview, stopPreview };
}
