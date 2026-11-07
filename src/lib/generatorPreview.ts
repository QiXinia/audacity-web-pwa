export type AudioContextFactory = () => AudioContext;

function createBrowserAudioContext(): AudioContext {
  const Context = window.AudioContext
    ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Context) throw new Error('当前浏览器不支持音频试听');
  return new Context();
}

function closeContext(context: AudioContext): void {
  void context.close().catch(() => undefined);
}

/**
 * Owns the complete lifetime of one mono generator preview. Starting another
 * preview or closing the dialog always tears down the previous audio graph.
 */
export class GeneratorPreviewPlayer {
  private context: AudioContext | null = null;
  private source: AudioBufferSourceNode | null = null;

  constructor(private readonly contextFactory: AudioContextFactory = createBrowserAudioContext) {}

  async play(samples: Float32Array, sampleRate: number, onEnded: () => void): Promise<void> {
    this.stop();
    if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
      throw new RangeError('试听采样率必须大于零');
    }
    if (samples.length === 0) throw new RangeError('没有可试听的音频采样');

    const context = this.contextFactory();
    this.context = context;

    try {
      if (context.state === 'suspended') await context.resume();
      // stop() may have been called while resume() was awaiting user activation.
      if (this.context !== context) {
        closeContext(context);
        return;
      }

      const buffer = context.createBuffer(1, samples.length, sampleRate);
      buffer.getChannelData(0).set(samples);
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      this.source = source;
      source.onended = () => {
        if (this.source !== source) return;
        this.source = null;
        this.context = null;
        source.onended = null;
        source.disconnect();
        closeContext(context);
        onEnded();
      };
      source.start();
    } catch (error) {
      if (this.context === context) this.stop();
      else closeContext(context);
      throw error;
    }
  }

  stop(): void {
    const source = this.source;
    const context = this.context;
    this.source = null;
    this.context = null;

    if (source) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        // A source that already ended is already silent.
      }
      source.disconnect();
    }
    if (context) closeContext(context);
  }
}
