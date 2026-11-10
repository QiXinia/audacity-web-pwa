import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  DEFAULT_PAULSTRETCH_SETTINGS,
  MAX_PAULSTRETCH_FACTOR,
  MAX_PAULSTRETCH_TIME_RESOLUTION,
  MIN_PAULSTRETCH_FACTOR,
  MIN_PAULSTRETCH_TIME_RESOLUTION,
  paulstretchBufferSize,
  paulstretchMinimumInputLength,
  validatePaulstretchSettings,
  type PaulstretchSettings,
} from '@/lib/paulstretchEffect';

interface PaulstretchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectionDuration: number;
  sampleRate: number;
  hasSelection: boolean;
  applying: boolean;
  onPreview: (settings: PaulstretchSettings) => Promise<Float32Array[]>;
  onApply: (settings: PaulstretchSettings) => Promise<void>;
}

function previewChannels(
  channels: Float32Array[],
  sampleRate: number,
  context: AudioContext,
): AudioBufferSourceNode {
  if (channels.length === 0 || !channels[0] || channels[0].length === 0) {
    throw new Error('选区内没有可试听的采样');
  }
  const length = channels[0].length;
  if (channels.some((channel) => channel.length !== length)) {
    throw new Error('试听声道必须等长');
  }
  const buffer = context.createBuffer(channels.length, length, sampleRate);
  channels.forEach((channel, index) => buffer.getChannelData(index).set(channel));
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.connect(context.destination);
  return source;
}

function settingsError(
  factorDraft: string,
  resolutionDraft: string,
  sampleRate: number,
): string {
  const settings = {
    stretchFactor: factorDraft.trim() === '' ? Number.NaN : Number(factorDraft),
    timeResolution: resolutionDraft.trim() === '' ? Number.NaN : Number(resolutionDraft),
  };
  try {
    validatePaulstretchSettings(settings);
    paulstretchBufferSize(sampleRate, settings.timeResolution);
    return '';
  } catch (error) {
    return error instanceof Error ? error.message : 'Paulstretch 参数无效';
  }
}

export function PaulstretchDialog({
  open,
  onOpenChange,
  selectionDuration,
  sampleRate,
  hasSelection,
  applying,
  onPreview,
  onApply,
}: PaulstretchDialogProps) {
  const [factorDraft, setFactorDraft] = useState(String(DEFAULT_PAULSTRETCH_SETTINGS.stretchFactor));
  const [resolutionDraft, setResolutionDraft] = useState(String(DEFAULT_PAULSTRETCH_SETTINGS.timeResolution));
  const [previewError, setPreviewError] = useState('');
  const [previewing, setPreviewing] = useState(false);
  const previewContextRef = useRef<AudioContext | null>(null);
  const previewSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const previewRunRef = useRef(0);
  const openRef = useRef(open);

  const settings: PaulstretchSettings = {
    stretchFactor: factorDraft.trim() === '' ? Number.NaN : Number(factorDraft),
    timeResolution: resolutionDraft.trim() === '' ? Number.NaN : Number(resolutionDraft),
  };
  const editError = settingsError(factorDraft, resolutionDraft, sampleRate);
  let selectionError = '';
  if (!editError && hasSelection) {
    const bufferSize = paulstretchBufferSize(sampleRate, settings.timeResolution);
    const minimumDuration = paulstretchMinimumInputLength(bufferSize) / sampleRate;
    if (selectionDuration < minimumDuration) {
      selectionError = `选区太短：至少需要 ${minimumDuration.toFixed(3)} 秒，或减小时间分辨率`;
    }
  }
  const valid = !editError && !selectionError;

  function stopPreview() {
    previewRunRef.current += 1;
    const source = previewSourceRef.current;
    previewSourceRef.current = null;
    if (source) {
      source.onended = null;
      try { source.stop(); } catch { /* Already stopped. */ }
      source.disconnect();
    }
    const context = previewContextRef.current;
    previewContextRef.current = null;
    if (context && context.state !== 'closed') void context.close().catch(() => undefined);
    setPreviewing(false);
  }

  useEffect(() => {
    openRef.current = open;
    if (!open) stopPreview();
  }, [open]);

  useEffect(() => () => {
    previewRunRef.current += 1;
    const source = previewSourceRef.current;
    if (source) {
      source.onended = null;
      try { source.stop(); } catch { /* Already stopped. */ }
      source.disconnect();
    }
    const context = previewContextRef.current;
    if (context && context.state !== 'closed') void context.close().catch(() => undefined);
  }, []);

  function reset() {
    if (previewing) stopPreview();
    setFactorDraft(String(DEFAULT_PAULSTRETCH_SETTINGS.stretchFactor));
    setResolutionDraft(String(DEFAULT_PAULSTRETCH_SETTINGS.timeResolution));
    setPreviewError('');
  }

  async function handlePreview() {
    if (!hasSelection || applying || previewing || !valid) return;
    stopPreview();
    const run = ++previewRunRef.current;
    setPreviewError('');
    setPreviewing(true);
    try {
      const channels = await onPreview(settings);
      if (run !== previewRunRef.current || !openRef.current) return;
      const AudioContextConstructor = window.AudioContext
        ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextConstructor) throw new Error('当前浏览器不支持试听');
      const context = new AudioContextConstructor();
      const source = previewChannels(channels, sampleRate, context);
      previewContextRef.current = context;
      previewSourceRef.current = source;
      source.onended = () => {
        if (run !== previewRunRef.current) return;
        stopPreview();
      };
      await context.resume();
      if (run !== previewRunRef.current || !openRef.current) return;
      source.start();
    } catch (error) {
      if (run !== previewRunRef.current) return;
      setPreviewError(error instanceof Error ? `试听失败：${error.message}` : '试听失败');
      stopPreview();
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Paulstretch（极端时间拉伸）</DialogTitle>
          <DialogDescription>
            保留频谱幅度并以确定性随机相位涂抹时间；使用 Hann 窗、FFT 重叠混合和首尾淡化。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-5 py-2">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="paulstretch-factor">拉伸倍数</Label>
              <Input
                id="paulstretch-factor"
                aria-label="拉伸倍数"
                type="number"
                min={MIN_PAULSTRETCH_FACTOR}
                max={MAX_PAULSTRETCH_FACTOR}
                step={0.1}
                value={factorDraft}
                disabled={applying || previewing}
                onChange={(event) => { setFactorDraft(event.target.value); setPreviewError(''); }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="paulstretch-resolution">时间分辨率（秒）</Label>
              <Input
                id="paulstretch-resolution"
                aria-label="时间分辨率（秒）"
                type="number"
                min={MIN_PAULSTRETCH_TIME_RESOLUTION}
                max={MAX_PAULSTRETCH_TIME_RESOLUTION}
                step={0.01}
                value={resolutionDraft}
                disabled={applying || previewing}
                onChange={(event) => { setResolutionDraft(event.target.value); setPreviewError(''); }}
              />
            </div>
          </div>
          <p className="text-muted-foreground text-xs">
            预计输出时长：{valid && Number.isFinite(selectionDuration * settings.stretchFactor)
              ? `${(selectionDuration * settings.stretchFactor).toFixed(3)} 秒`
              : '不可用'}。试听不修改工程；1 倍仍执行频谱涂抹。
          </p>
          <p className="text-muted-foreground text-xs">
            Web 回退采用可复现相位源和精确长度调度，不宣称与 Audacity 平台 rand() 位级一致。
          </p>
          {!hasSelection && <p role="alert" className="text-destructive text-sm">请先选择要处理的音频。</p>}
          {(editError || selectionError || previewError) && (
            <p role="alert" className="text-destructive text-sm">{editError || selectionError || previewError}</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={reset} disabled={applying}>重置</Button>
          <Button
            variant="outline"
            onClick={() => { if (previewing) stopPreview(); else void handlePreview(); }}
            disabled={!previewing && (!hasSelection || applying || !valid)}
          >
            {previewing ? '停止试听' : '试听'}
          </Button>
          <Button
            onClick={() => void onApply(settings)}
            disabled={!hasSelection || applying || previewing || !valid}
          >
            {applying ? '应用中…' : '应用效果'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
